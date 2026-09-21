"""
Diagnostics endpoints.
Matches src/controllers/diagnosticsController.js.
"""

from fastapi import APIRouter
import platform
import sys

router = APIRouter(prefix="/diagnostics", tags=["Diagnostics"])

@router.get("", include_in_schema=False)
@router.get("/")
async def get_diagnostics():

    return {
        "success": True,
        "data": {
            "platform": platform.platform(),
            "pythonVersion": sys.version,
            "architecture": platform.architecture(),
            "status": "HEALTHY"
        }
    }

@router.get("/logs")
async def get_logs():
    return {
        "success": True,
        "data": {
            "logs": []
        }
    }
