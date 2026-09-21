"""
Settings endpoints.
Matches src/controllers/settingsController.js.
"""

from typing import Any, Dict
from fastapi import APIRouter, Depends, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.models.system import SystemSetting
from app.models.base import unwrap_row
from app.services.tally.tally_client import tally_client

router = APIRouter(prefix="/settings", tags=["Settings"])

@router.get("/tally")
async def get_tally_settings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == "tally"))
    setting = result.scalar_one_or_none()
    if not setting:
        return {
            "success": True,
            "data": {
                "tallyHost": "127.0.0.1",
                "tallyPort": 9000,
                "protocol": "http",
                "connectionMode": "DIRECT",
                "targetCompany": "",
                "timeoutMs": 120000,
                "probeTimeoutMs": 8000,
                "autoSyncEnabled": True,
                "syncIntervalMs": 300000,
                "lastKnownStatus": "UNKNOWN"
            }
        }
    return {
        "success": True,
        "data": unwrap_row(setting)
    }

@router.post("/tally")
async def update_tally_settings(payload: Dict[str, Any] = Body(...), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == "tally"))
    setting = result.scalar_one_or_none()
    if not setting:
        setting = SystemSetting(key="tally", **payload)
        db.add(setting)
    else:
        for k, v in payload.items():
            if hasattr(setting, k):
                setattr(setting, k, v)
    await db.commit()
    await db.refresh(setting)
    return {
        "success": True,
        "message": "Settings updated successfully",
        "data": unwrap_row(setting)
    }

@router.post("/tally/test")
async def test_tally_connection():
    result = await tally_client.probe_connection()
    return {
        "success": result["connected"],
        "data": result
    }
