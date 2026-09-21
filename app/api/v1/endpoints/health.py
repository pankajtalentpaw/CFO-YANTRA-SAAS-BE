"""
Health & Root diagnostics endpoints.
"""

from datetime import datetime, timezone
from fastapi import APIRouter
from app.schemas.common import HealthResponse

router = APIRouter(tags=["Health"])

@router.get("/health", response_model=HealthResponse)
async def get_health():
    return HealthResponse(
        status="HEALTHY",
        service="cfo-yantra-backend",
        version="1.0.0",
        timestamp=datetime.now(timezone.utc).isoformat()
    )
