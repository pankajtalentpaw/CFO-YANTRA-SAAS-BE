"""
Standardized Application Error Codes, Exceptions, and Handlers.
Guarantees 100% parity with src/constants/statusCodes.js.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

class AppErrorCodes:
    INVALID_QUERY_PARAMS = "INVALID_QUERY_PARAMS"
    INVALID_PAYLOAD = "INVALID_PAYLOAD"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    COMPANY_NOT_FOUND = "COMPANY_NOT_FOUND"
    ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND"
    UNAUTHORIZED_ACCESS = "UNAUTHORIZED_ACCESS"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    API_VERSION_UNSUPPORTED = "API_VERSION_UNSUPPORTED"
    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR"
    TALLY_CONNECTION_FAILED = "TALLY_CONNECTION_FAILED"
    TALLY_TIMEOUT = "TALLY_TIMEOUT"
    TALLY_BUSY = "TALLY_BUSY"
    DB_CONNECTION_FAILED = "DB_CONNECTION_FAILED"
    DB_SYNC_FAILED = "DB_SYNC_FAILED"

ERROR_PLAN: Dict[str, Dict[str, str]] = {
    AppErrorCodes.ROUTE_NOT_FOUND: {
        "diagnosticHint": "Requested API endpoint URL or HTTP method does not match any registered route.",
        "actionPlan": "Inspect API route registration in python_backend/app/api/v1.",
        "userAction": "Check endpoint URL and method in the API documentation (/api/v1/health)."
    },
    AppErrorCodes.COMPANY_NOT_FOUND: {
        "diagnosticHint": "Specified company ID not found in database.",
        "actionPlan": "Verify company exists via GET /api/v1/companies.",
        "userAction": "Select an active company from the sidebar."
    },
    AppErrorCodes.TALLY_CONNECTION_FAILED: {
        "diagnosticHint": "TCP connection to TallyPrime refused (host/port unreachable).",
        "actionPlan": "1. Check if TallyPrime is running.\n2. Confirm port in Tally F1 > Settings matches .env.",
        "userAction": "Ensure TallyPrime is running on the system with ODBC/HTTP connectivity enabled on the configured port."
    },
    AppErrorCodes.TALLY_BUSY: {
        "diagnosticHint": "TallyPrime is currently executing another heavy extraction job.",
        "actionPlan": "Queue request or return 503 with retry-after header. Concurrency with Tally is serial.",
        "userAction": "TallyPrime is currently busy with another report. Please wait a few seconds and retry."
    }
}

def create_error_payload(
    status_code: int,
    message: str,
    error_code: Optional[str] = None,
    details: Optional[Any] = None
) -> Dict[str, Any]:
    """Builds identical JSON error payload matching Node.js createErrorPayload."""
    code = error_code or (
        AppErrorCodes.INTERNAL_SERVER_ERROR if status_code >= 500 else AppErrorCodes.VALIDATION_FAILED
    )
    plan = ERROR_PLAN.get(code)
    payload = {
        "success": False,
        "statusCode": status_code,
        "errorCode": code,
        "error": message,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    if details is not None:
        payload["details"] = details
    if plan and "userAction" in plan:
        payload["userAction"] = plan["userAction"]
    return payload

class ApiError(Exception):
    def __init__(
        self,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        message: str = "Internal server error",
        error_code: Optional[str] = None,
        details: Optional[Any] = None
    ):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.error_code = error_code or (
            AppErrorCodes.INTERNAL_SERVER_ERROR if status_code >= 500 else AppErrorCodes.VALIDATION_FAILED
        )
        self.details = details

    @classmethod
    def bad_request(cls, message: str, error_code: str = AppErrorCodes.INVALID_QUERY_PARAMS, details: Any = None):
        return cls(status.HTTP_400_BAD_REQUEST, message, error_code, details)

    @classmethod
    def not_found(cls, message: str, error_code: str = AppErrorCodes.RESOURCE_NOT_FOUND, details: Any = None):
        return cls(status.HTTP_404_NOT_FOUND, message, error_code, details)

    @classmethod
    def bad_gateway(cls, message: str, error_code: str = AppErrorCodes.TALLY_CONNECTION_FAILED, details: Any = None):
        return cls(status.HTTP_502_BAD_GATEWAY, message, error_code, details)

    @classmethod
    def service_unavailable(cls, message: str, error_code: str = AppErrorCodes.TALLY_BUSY, details: Any = None):
        return cls(status.HTTP_503_SERVICE_UNAVAILABLE, message, error_code, details)

async def api_error_handler(request: Request, exc: ApiError):
    return JSONResponse(
        status_code=exc.status_code,
        content=create_error_payload(exc.status_code, exc.message, exc.error_code, exc.details)
    )

async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    error_code = AppErrorCodes.ROUTE_NOT_FOUND if exc.status_code == 404 else None
    return JSONResponse(
        status_code=exc.status_code,
        content=create_error_payload(exc.status_code, str(exc.detail), error_code)
    )

async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=create_error_payload(
            status.HTTP_400_BAD_REQUEST,
            "Validation failed for request parameters or payload",
            AppErrorCodes.VALIDATION_FAILED,
            details=exc.errors()
        )
    )

async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=create_error_payload(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            str(exc) if str(exc) else "Internal server error",
            AppErrorCodes.INTERNAL_SERVER_ERROR
        )
    )
