"""
API v1 Central Router.
Mounts all endpoints matching src/routes/index.js.
"""

from fastapi import APIRouter
from app.api.v1.endpoints import (
    health,
    auth,
    settings,
    tally,
    companies,
    diagnostics,
    sync,
    cloud,
    storage
)

api_router = APIRouter(prefix="/api/v1")

# Mount all endpoint routers
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(settings.router)
api_router.include_router(tally.router)
api_router.include_router(companies.router)
api_router.include_router(diagnostics.router)
api_router.include_router(sync.router)
api_router.include_router(cloud.router)
api_router.include_router(storage.router)

from app.services.analytics.catalog import get_catalog_summary

# Direct route matching frontend salesService.getReport5AnalyticsCatalog
@api_router.get("/reports/report5/analytics/catalog", tags=["Analytics"])
async def get_report5_analytics_catalog():
    return {
        "success": True,
        "data": get_catalog_summary()
    }

