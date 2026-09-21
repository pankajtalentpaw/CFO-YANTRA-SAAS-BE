"""
Storage and Tally Company Folders API Endpoints.
Provides inspection, snapshot generation, zip backups, and Windows Explorer integration.
"""

import os
import platform
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

from app.core.exceptions import ApiError, AppErrorCodes
from app.services.storage import company_folder_service

router = APIRouter(prefix="/storage", tags=["Storage & Tally Data Folders"])


@router.get("/overview")
@router.get("/status")
async def get_storage_overview():
    """Returns telemetry of Tally data storage root, disk space, and all registered companies."""
    stats = company_folder_service.get_overall_stats()
    return {
        "success": True,
        "data": stats
    }


@router.post("/path")
async def set_storage_path(payload: Dict[str, str] = Body(...)):
    """Sets a custom root directory for Tally company data folders (e.g. D:\\TallyData)."""
    new_path = payload.get("dataDir")
    if not new_path:
        raise ApiError.bad_request("Field 'dataDir' is required.", AppErrorCodes.INVALID_PAYLOAD)

    try:
        company_folder_service.set_custom_data_dir(new_path)
        stats = company_folder_service.get_overall_stats()
        return {
            "success": True,
            "message": f"Storage directory relocated to: {new_path}",
            "data": stats
        }
    except Exception as e:
        raise ApiError(500, f"Failed to set storage directory: {str(e)}", AppErrorCodes.INTERNAL_ERROR)


@router.get("/companies/{companyId}")
async def get_company_storage_info(companyId: str):
    """Retrieves disk usage, file count, and folder details for a given company."""
    stats = company_folder_service.get_storage_stats(companyId)
    return {
        "success": True,
        "companyId": companyId,
        "data": stats
    }


@router.post("/companies/{companyId}/ensure")
async def ensure_company_folder(
    companyId: str,
    payload: Optional[Dict[str, Any]] = Body(default=None)
):
    """Ensures Tally-style folder structure exists for the company."""
    company_name = (payload or {}).get("companyName")
    meta = company_folder_service.ensure_company_structure(companyId, company_name)
    stats = company_folder_service.get_storage_stats(companyId)
    return {
        "success": True,
        "message": f"Company folder initialized successfully: {meta['folderName']}",
        "data": {
            "meta": meta,
            "stats": stats
        }
    }


@router.post("/companies/{companyId}/snapshots")
async def save_company_snapshot(
    companyId: str,
    payload: Dict[str, Any] = Body(...)
):
    """Saves raw sync snapshot (masters, vouchers, ledgers) into company's sync_snapshots/ folder."""
    snapshot_type = payload.get("snapshotType", "sync_data")
    data = payload.get("data", {})
    company_name = payload.get("companyName")
    is_xml = payload.get("isXml", False)

    snapshot_info = company_folder_service.save_snapshot(
        company_id=companyId,
        snapshot_type=snapshot_type,
        data=data,
        company_name=company_name,
        is_xml=is_xml
    )
    return {
        "success": True,
        "message": f"Snapshot saved successfully: {snapshot_info['filename']}",
        "data": snapshot_info
    }


@router.get("/companies/{companyId}/snapshots")
async def list_company_snapshots(companyId: str):
    """Lists all stored sync snapshots for the company."""
    snapshots = company_folder_service.list_snapshots(companyId)
    return {
        "success": True,
        "companyId": companyId,
        "count": len(snapshots),
        "data": snapshots
    }


@router.post("/companies/{companyId}/backups")
async def create_company_backup(
    companyId: str,
    payload: Optional[Dict[str, Any]] = Body(default=None)
):
    """Creates a compressed standalone .zip backup in the company's backups/ folder."""
    note = (payload or {}).get("note", "Manual Tally-style backup")
    try:
        backup = company_folder_service.create_backup(companyId, note=note)
        return {
            "success": True,
            "message": f"Backup created successfully: {backup['filename']}",
            "data": backup
        }
    except Exception as e:
        raise ApiError(500, f"Failed to create backup: {str(e)}", AppErrorCodes.INTERNAL_ERROR)


@router.get("/companies/{companyId}/backups")
async def list_company_backups(companyId: str):
    """Lists all available .zip backups for the company."""
    backups = company_folder_service.list_backups(companyId)
    return {
        "success": True,
        "companyId": companyId,
        "count": len(backups),
        "data": backups
    }


@router.get("/companies/{companyId}/backups/{filename}")
async def download_company_backup(companyId: str, filename: str):
    """Downloads a specific .zip backup file."""
    folder = company_folder_service.get_company_folder(companyId)
    if not folder:
        raise ApiError.not_found(f"Company folder for {companyId} not found", AppErrorCodes.RESOURCE_NOT_FOUND)

    safe_filename = Path(filename).name
    backups_dir = (folder / "backups").resolve()
    backup_path = (backups_dir / safe_filename).resolve()
    if not str(backup_path).startswith(str(backups_dir)):
        raise ApiError.bad_request("Invalid backup filename", AppErrorCodes.INVALID_PAYLOAD)
    if not backup_path.exists() or not backup_path.is_file():
        raise ApiError.not_found(f"Backup file '{filename}' not found", AppErrorCodes.RESOURCE_NOT_FOUND)

    return FileResponse(
        path=str(backup_path),
        filename=filename,
        media_type="application/zip"
    )


@router.post("/companies/{companyId}/open-folder")
async def open_company_folder_in_explorer(companyId: str):
    """Desktop helper to open the company folder directly in Windows Explorer."""
    folder = company_folder_service.get_company_folder(companyId)
    if not folder or not folder.exists():
        raise ApiError.not_found(f"Company folder for {companyId} not found", AppErrorCodes.RESOURCE_NOT_FOUND)

    path_str = str(folder.resolve())
    try:
        if platform.system() == "Windows":
            os.startfile(path_str)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", path_str])
        else:
            subprocess.Popen(["xdg-open", path_str])

        return {
            "success": True,
            "message": f"Opened folder: {path_str}",
            "data": {"folderPath": path_str}
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Could not open file manager: {str(e)}",
            "data": {"folderPath": path_str}
        }
