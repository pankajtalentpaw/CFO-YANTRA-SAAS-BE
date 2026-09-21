"""
Cloud status endpoints.
Matches src/controllers/cloudController.js.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/cloud", tags=["Cloud"])

@router.get("/status")
async def get_cloud_status():
    return {
        "success": True,
        "data": {
            "status": "DISCONNECTED",
            "mode": "DESKTOP_LOCAL",
            "syncEnabled": False
        }
    }
