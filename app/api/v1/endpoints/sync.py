"""
Sync endpoints.
Matches src/controllers/syncController.js.
"""

import asyncio
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, Body, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db
from app.models import Company, SyncState, Voucher, Ledger, unwrap_row
from app.services.storage import company_folder_service
from app.services.sync import tally_sync_engine
from app.services.sync.scheduler import background_scheduler
from app.services.tally.tally_client import tally_client

router = APIRouter(prefix="/sync", tags=["Sync"])

@router.get("/reports")
async def get_supported_reports():
    """Returns the 8-stage Magenta BI-style extraction pipeline reports."""
    return {
        "success": True,
        "data": {
            "pipeline": tally_sync_engine.REPORT_PIPELINE,
            "chunkSize": tally_sync_engine.CHUNK_SIZE,
            "descriptions": {
                "CM": "Customer Master (Sundry Debtors)",
                "CMGRP": "Customer Master Groups",
                "IM": "Item Master (Stock Items)",
                "IMGRP": "Item Master Groups",
                "SPCD": "Sales, Purchase, Credit Note, Debit Note Vouchers",
                "BPBR": "Bank Payment & Bank Receipt Vouchers",
                "LEDGER": "General Chart of Accounts Ledgers",
                "COA": "Customer Outstanding Adjustment (Bill-Wise Receivables)",
                "VOA": "Vendor Outstanding Adjustment (Bill-Wise Payables)"
            }
        }
    }

@router.get("/status")
async def get_sync_status(
    companyId: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    live_status = tally_sync_engine.get_sync_status(companyId)
    query = select(SyncState).limit(20)
    if companyId:
        query = select(SyncState).where(SyncState.companyId == companyId)
    result = await db.execute(query)
    states = result.scalars().all()
    unwrapped_states = [unwrap_row(s) for s in states]

    # Shape company mirror list to match frontend expectations
    companies = []
    latest_finished_at = None
    for s in unwrapped_states:
        finished_at = s.get("lastFinishedAt")
        if finished_at and (not latest_finished_at or str(finished_at) > str(latest_finished_at)):
            latest_finished_at = str(finished_at)
        cid = s.get("companyId", "")
        folder_meta = company_folder_service.ensure_company_structure(cid) if cid else {}
        db_path = company_folder_service.get_company_db_path(cid) if cid else None
        has_local = db_path.exists() and db_path.stat().st_size > 0 if db_path else False

        companies.append({
            "companyId": cid,
            "companyName": s.get("companyName"),
            "status": s.get("status") or "IDLE",
            "lastRunId": s.get("lastRunId"),
            "lastStartedAt": s.get("lastStartedAt"),
            "lastFinishedAt": s.get("lastFinishedAt"),
            "lastDurationMs": s.get("lastDurationMs") or 0,
            "lastSuccessAt": s.get("lastSuccessAt"),
            "lastError": s.get("lastError"),
            "totalRecords": s.get("totalRecords") or 0,
            "changedRecords": s.get("changedRecords") or 0,
            "runCount": s.get("runCount") or 0,
            "domains": s.get("domains") or {},
            "folderName": folder_meta.get("folderName"),
            "isLocalAvailable": has_local,
            "databaseSizeBytes": db_path.stat().st_size if has_local else 0
        })

    is_running = live_status.get("isRunning", False)
    active_sync = live_status.get("activeSync", {})
    sched_status = background_scheduler.get_status()
    tally_probe = await tally_client.probe_connection()

    payload = {
        "success": True,
        "status": "SYNCING" if is_running else "READY",
        "activeSync": active_sync,
        "mirror": {
            "enabled": True,
            "connected": True,
            "uri": "sqlite:///cfo_yantra.sqlite",
            "lastError": None
        },
        "source": {
            "connected": tally_probe.get("connected", False),
            "status": tally_probe.get("status", "OFFLINE"),
            "operatingMode": tally_probe.get("operatingMode", "STOPPED"),
            "isAvailable": tally_probe.get("isAvailable", False),
            "message": tally_probe.get("message", ""),
            "activeCompanies": tally_probe.get("activeCompanies", [])
        },
        "autoSync": {
            "enabled": sched_status["enabled"],
            "isPaused": sched_status["isPaused"],
            "running": is_running,
            "intervalMinutes": sched_status["intervalMinutes"],
            "intervalSeconds": sched_status["intervalSeconds"],
            "lastRunAt": sched_status["lastRunAt"],
            "nextRunAt": sched_status["nextRunAt"],
            "runningCompanies": sched_status["runningCompanies"]
        },
        "companyCount": len(companies),
        "companies": companies,
        "lastSync": latest_finished_at,
        "data": {
            **live_status,
            "states": unwrapped_states,
            "companies": companies,
            "activeSync": active_sync,
            "scheduler": sched_status,
            "source": tally_probe,
            "mirror": {
                "enabled": True,
                "connected": True,
                "uri": "sqlite:///cfo_yantra.sqlite"
            },
            "autoSync": {
                "enabled": sched_status["enabled"],
                "isPaused": sched_status["isPaused"],
                "running": is_running,
                "intervalMinutes": sched_status["intervalMinutes"]
            }
        }
    }
    return payload

@router.post("/run")
async def run_sync_now(payload: Optional[Dict[str, Any]] = Body(default=None)):
    body = payload or {}
    company_id = body.get("companyId", "DEFAULT_COMPANY")
    company_name = body.get("companyName")
    from_date = body.get("fromDate")
    to_date = body.get("toDate")
    reports = body.get("reports")

    active_progress = tally_sync_engine.get_active_progress()
    if active_progress.get("isSyncing"):
        return {
            "success": True,
            "message": "A sync cycle is already running in background",
            "alreadyRunning": True,
            "data": active_progress,
            "activeSync": active_progress
        }

    # Launch background task so HTTP request returns immediately
    asyncio.create_task(
        tally_sync_engine.run_sync(
            company_id=company_id,
            company_name=company_name,
            from_date=from_date,
            to_date=to_date,
            reports_to_run=reports
        )
    )

    initial_sync = tally_sync_engine.get_active_progress()
    return {
        "success": True,
        "message": "Sync cycle initiated successfully in background",
        "data": initial_sync,
        "activeSync": initial_sync
    }

@router.get("/companies")
async def get_mirrored_companies(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Company))
    companies = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(c) for c in companies]
    }

# --------------------------------------------------------------------------
# BACKGROUND SCHEDULER MANAGEMENT ENDPOINTS (Static routes before /{companyId})
# --------------------------------------------------------------------------

@router.get("/scheduler")
async def get_scheduler_status():
    """Returns background synchronization scheduler telemetry and status."""
    return {
        "success": True,
        "data": background_scheduler.get_status()
    }

@router.post("/scheduler/enable")
async def enable_scheduler():
    background_scheduler.set_enabled(True)
    return {
        "success": True,
        "message": "Background automatic synchronization enabled",
        "data": background_scheduler.get_status()
    }

@router.post("/scheduler/disable")
async def disable_scheduler():
    background_scheduler.set_enabled(False)
    return {
        "success": True,
        "message": "Background automatic synchronization disabled",
        "data": background_scheduler.get_status()
    }

@router.post("/scheduler/pause")
async def pause_scheduler():
    background_scheduler.pause()
    return {
        "success": True,
        "message": "Background automatic synchronization paused",
        "data": background_scheduler.get_status()
    }

@router.post("/scheduler/resume")
async def resume_scheduler():
    background_scheduler.resume()
    return {
        "success": True,
        "message": "Background automatic synchronization resumed",
        "data": background_scheduler.get_status()
    }

@router.post("/scheduler/interval")
async def set_scheduler_interval(payload: Dict[str, Any] = Body(...)):
    minutes = payload.get("intervalMinutes") or payload.get("minutes") or 15
    background_scheduler.set_global_interval(int(minutes))
    return {
        "success": True,
        "message": f"Global auto-sync interval set to {minutes} minutes",
        "data": background_scheduler.get_status()
    }

@router.get("/{companyId}/counts")
async def get_mirror_counts(companyId: str, db: AsyncSession = Depends(get_db)):
    v_count = await db.scalar(select(func.count(Voucher.id)).where(Voucher.companyId == companyId))
    l_count = await db.scalar(select(func.count(Ledger.id)).where(Ledger.companyId == companyId))
    return {
        "success": True,
        "data": {
            "companyId": companyId,
            "vouchers": v_count or 0,
            "ledgers": l_count or 0
        }
    }

@router.get("/{companyId}/state")
async def get_sync_state_for_company(companyId: str):
    """Retrieves sync-state.json checkpoints and telemetry for a specific company."""
    state = company_folder_service.load_sync_state(companyId)
    return {
        "success": True,
        "companyId": companyId,
        "data": state
    }

@router.get("/{companyId}/errors")
async def get_sync_errors_for_company(companyId: str, limit: int = 50):
    """Retrieves sync error history from sync/sync-errors.log."""
    sync_dir = company_folder_service.get_company_sync_dir(companyId)
    log_file = sync_dir / "sync-errors.log"
    errors = []
    if log_file.exists():
        with open(log_file, "r", encoding="utf-8") as f:
            errors = [l.strip() for l in f.readlines() if l.strip()]
    return {
        "success": True,
        "companyId": companyId,
        "count": len(errors),
        "data": errors[-limit:]
    }

@router.post("/{companyId}/retry")
async def retry_sync_for_company(companyId: str, payload: Optional[Dict[str, Any]] = Body(default=None)):
    """Triggers an immediate background synchronization retry for the specified company."""
    body = payload or {}
    meta = company_folder_service.ensure_company_structure(companyId)
    comp_name = body.get("companyName") or meta.get("companyName") or companyId
    
    active = tally_sync_engine.get_active_progress()
    if active.get("isSyncing"):
        return {
            "success": True,
            "message": "A sync cycle is already running in background",
            "alreadyRunning": True,
            "data": active
        }

    asyncio.create_task(
        tally_sync_engine.run_sync(
            company_id=companyId,
            company_name=comp_name,
            from_date=body.get("fromDate"),
            to_date=body.get("toDate"),
            reports_to_run=body.get("reports")
        )
    )

    return {
        "success": True,
        "message": f"Sync retry launched for company '{comp_name}'",
        "companyId": companyId
    }

@router.post("/{companyId}/schedule")
async def configure_company_schedule(
    companyId: str,
    payload: Dict[str, Any] = Body(...)
):
    """Configures company-specific automatic synchronization parameters."""
    enabled = payload.get("enabled")
    interval_minutes = payload.get("intervalMinutes")
    background_scheduler.set_company_config(
        company_id=companyId,
        enabled=enabled,
        interval_minutes=interval_minutes
    )
    return {
        "success": True,
        "message": f"Schedule configuration updated for company '{companyId}'",
        "data": background_scheduler.get_company_config(companyId)
    }

@router.get("/tally-event", operation_id="get_tally_webhook_event")
@router.post("/tally-event", operation_id="post_tally_webhook_event")
async def handle_tally_webhook_event(request: Request):
    try:
        body = await request.body()
        content_type = request.headers.get("content-type", "")
        if body:
            raw_text = body.decode("utf-8", errors="ignore")
            is_xml = "xml" in content_type or raw_text.strip().startswith("<")
            company_folder_service.save_snapshot(
                company_id="DEFAULT_SYNC",
                snapshot_type="webhook_event",
                data=raw_text if is_xml else (await request.json() if "json" in content_type else raw_text),
                is_xml=is_xml
            )
    except Exception:
        pass
    return {
        "success": True,
        "message": "Tally webhook event acknowledged"
    }
