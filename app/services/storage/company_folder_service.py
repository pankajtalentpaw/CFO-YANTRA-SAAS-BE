"""
Tally-Style Company Folder Storage Service.
Provides dedicated directory isolation per company (mirroring Tally's 10000, 10001 pattern),
automated snapshot preservation, timestamped zip backups, and storage telemetry.
"""

import json
import os
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings


class CompanyFolderService:
    STARTING_COMPANY_NUMBER = 10000

    def __init__(self, companies_dir: Optional[str] = None):
        self._custom_dir: Optional[Path] = Path(companies_dir) if companies_dir else None

    @property
    def root_data_dir(self) -> Path:
        if self._custom_dir:
            return self._custom_dir.parent
        return Path(settings.DATA_ROOT_DIR)

    @property
    def base_dir(self) -> Path:
        if self._custom_dir:
            return self._custom_dir
        return Path(settings.COMPANIES_DATA_DIR)

    @property
    def index_file(self) -> Path:
        """Standard central registry path: data/companies_index.json."""
        return self.root_data_dir / "companies_index.json"

    @property
    def legacy_index_file(self) -> Path:
        """Legacy compatibility path: data/companies/companies_index.json."""
        return self.base_dir / "companies_index.json"

    def _sanitize_name(self, name: str) -> str:
        """Sanitizes company name for Windows/Unix folder naming compatibility."""
        cleaned = re.sub(r'[\\/*?:"<>| ]+', "_", name.strip())
        return cleaned.strip("_") or "COMPANY"

    def _load_index(self) -> Dict[str, Any]:
        """Loads companies index mapping companyId -> folder details with path normalization."""
        self.root_data_dir.mkdir(parents=True, exist_ok=True)
        self.base_dir.mkdir(parents=True, exist_ok=True)

        data = {}
        source_file = None
        if self.index_file.exists():
            source_file = self.index_file
        elif self.legacy_index_file.exists():
            source_file = self.legacy_index_file

        if source_file:
            try:
                with open(source_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}

        # Normalize paths and enrich required registry fields
        modified = False
        for cid, meta in data.items():
            folder_name = meta.get("folderName")
            if folder_name:
                normalized_folder = (self.base_dir / folder_name).resolve()
                if meta.get("folderPath") != str(normalized_folder):
                    meta["folderPath"] = str(normalized_folder)
                    modified = True
                db_path = str((normalized_folder / "database.sqlite").resolve())
                if meta.get("databasePath") != db_path:
                    meta["databasePath"] = db_path
                    modified = True
            if not meta.get("registrationStatus"):
                meta["registrationStatus"] = "ACTIVE"
                modified = True
            if not meta.get("syncStatus"):
                db_file = Path(meta.get("databasePath", ""))
                meta["syncStatus"] = "COMPLETED" if (db_file.exists() and db_file.stat().st_size > 0) else "PENDING"
                modified = True

        if modified or (source_file == self.legacy_index_file and not self.index_file.exists()):
            self._save_index(data)

        return data

    def _save_index(self, index_data: Dict[str, Any]) -> None:
        """Atomically saves companies index to both standard and legacy paths."""
        self.root_data_dir.mkdir(parents=True, exist_ok=True)
        self.base_dir.mkdir(parents=True, exist_ok=True)

        # 1. Primary standard write: data/companies_index.json
        tmp_file = self.index_file.with_suffix(".tmp")
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(index_data, f, indent=2, ensure_ascii=False)
        tmp_file.replace(self.index_file)

        # 2. Compatibility mirror: data/companies/companies_index.json
        legacy_tmp = self.legacy_index_file.with_suffix(".tmp")
        with open(legacy_tmp, "w", encoding="utf-8") as f:
            json.dump(index_data, f, indent=2, ensure_ascii=False)
        legacy_tmp.replace(self.legacy_index_file)

    def _get_next_company_number(self, index: Dict[str, Any]) -> int:
        """Generates next 5-digit Tally company number (e.g., 10000, 10001...)."""
        max_num = self.STARTING_COMPANY_NUMBER - 1
        for meta in index.values():
            num = meta.get("companyNumber", 0)
            if isinstance(num, int) and num > max_num:
                max_num = num
        return max_num + 1

    def ensure_company_structure(self, company_id: str, company_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Creates or retrieves the Tally-style folder structure for a given company.
        Subdirectories:
          - sync/           (sync-state.json, sync-errors.log)
          - sync_snapshots/ (raw JSON/XML payloads from Tally syncs)
          - backups/        (standalone .zip archives)
          - exports/        (PDF/Excel/CSV exports)
          - audit_logs/     (sync logs & audit traces)
        """
        index = self._load_index()
        company_id_str = str(company_id).strip()

        if company_id_str in index:
            meta = index[company_id_str]
            folder_name = meta.get("folderName")
            folder_path = (self.base_dir / folder_name).resolve() if folder_name else Path(meta["folderPath"]).resolve()
            meta["folderPath"] = str(folder_path)
            meta["databasePath"] = str(folder_path / "database.sqlite")
            if not meta.get("registrationStatus"):
                meta["registrationStatus"] = "ACTIVE"
            if company_name and meta.get("companyName") != company_name:
                meta["companyName"] = company_name
                meta["updatedAt"] = datetime.now(timezone.utc).isoformat()
                self._save_index(index)
        else:
            comp_num = self._get_next_company_number(index)
            safe_name = self._sanitize_name(company_name or company_id_str)
            folder_name = f"{comp_num}_{safe_name}"
            folder_path = (self.base_dir / folder_name).resolve()

            meta = {
                "companyId": company_id_str,
                "companyNumber": comp_num,
                "companyName": company_name or company_id_str,
                "folderName": folder_name,
                "folderPath": str(folder_path),
                "databasePath": str(folder_path / "database.sqlite"),
                "guid": company_id_str,
                "masterId": comp_num,
                "registrationStatus": "ACTIVE",
                "syncStatus": "PENDING",
                "lastSyncTime": None,
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "updatedAt": datetime.now(timezone.utc).isoformat()
            }
            index[company_id_str] = meta
            self._save_index(index)

        # Create primary folder and subfolders
        folder_path.mkdir(parents=True, exist_ok=True)
        (folder_path / "sync").mkdir(parents=True, exist_ok=True)
        (folder_path / "sync_snapshots").mkdir(parents=True, exist_ok=True)
        (folder_path / "backups").mkdir(parents=True, exist_ok=True)
        (folder_path / "exports").mkdir(parents=True, exist_ok=True)
        (folder_path / "audit_logs").mkdir(parents=True, exist_ok=True)

        return meta

    def get_company_folder(self, company_id: str) -> Optional[Path]:
        """Returns Path to company's folder if indexed and exists."""
        index = self._load_index()
        cid_str = str(company_id).strip()
        meta = index.get(cid_str)
        if meta:
            folder_name = meta.get("folderName")
            if folder_name:
                p = self.base_dir / folder_name
                if p.exists():
                    return p
            if "folderPath" in meta:
                p = Path(meta["folderPath"])
                if p.exists():
                    return p
        # Fallback: check direct folder existence
        candidate = self.base_dir / cid_str
        if candidate.exists():
            return candidate
        return None

    def get_company_db_path(self, company_id: str) -> Path:
        """Returns Path to the company's dedicated database.sqlite."""
        folder = self.get_company_folder(company_id)
        if not folder:
            meta = self.ensure_company_structure(company_id)
            folder = Path(meta["folderPath"])
        return folder / "database.sqlite"

    def get_company_sync_dir(self, company_id: str) -> Path:
        """Returns and ensures the company's sync/ metadata folder."""
        folder = self.get_company_folder(company_id)
        if not folder:
            meta = self.ensure_company_structure(company_id)
            folder = Path(meta["folderPath"])
        sync_dir = folder / "sync"
        sync_dir.mkdir(parents=True, exist_ok=True)
        return sync_dir

    def save_sync_state(self, company_id: str, state_dict: Dict[str, Any]) -> Path:
        """
        Saves current checkpoints and run state to:
        1. {company_folder}/sync_state.json (target root structure)
        2. {company_folder}/sync/sync-state.json (nested compatibility)
        Also updates registry syncStatus and lastSyncTime.
        """
        folder = self.get_company_folder(company_id)
        if not folder:
            meta = self.ensure_company_structure(company_id)
            folder = Path(meta["folderPath"])

        state_dict["updatedAt"] = datetime.now(timezone.utc).isoformat()

        # 1. Root sync_state.json
        root_state_file = folder / "sync_state.json"
        tmp_file = folder / "sync_state.json.tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(state_dict, f, indent=2, default=str, ensure_ascii=False)
        tmp_file.replace(root_state_file)

        # 2. Nested sync/sync-state.json
        sync_dir = folder / "sync"
        sync_dir.mkdir(parents=True, exist_ok=True)
        nested_file = sync_dir / "sync-state.json"
        tmp_nested = sync_dir / "sync-state.json.tmp"
        with open(tmp_nested, "w", encoding="utf-8") as f:
            json.dump(state_dict, f, indent=2, default=str, ensure_ascii=False)
        tmp_nested.replace(nested_file)

        # 3. Update central registry index
        try:
            index = self._load_index()
            cid = str(company_id).strip()
            if cid in index:
                if state_dict.get("status"):
                    index[cid]["syncStatus"] = state_dict["status"]
                last_sync = state_dict.get("finishedAt") or state_dict.get("lastSyncTime") or state_dict.get("lastSuccessAt")
                if last_sync:
                    index[cid]["lastSyncTime"] = str(last_sync)
                index[cid]["updatedAt"] = datetime.now(timezone.utc).isoformat()
                self._save_index(index)
        except Exception:
            pass

        return root_state_file

    def load_sync_state(self, company_id: str) -> Dict[str, Any]:
        """Loads sync metadata from sync_state.json or sync/sync-state.json."""
        folder = self.get_company_folder(company_id)
        if not folder:
            return {}

        candidates = [
            folder / "sync_state.json",
            folder / "sync" / "sync-state.json"
        ]
        for candidate in candidates:
            if candidate.exists():
                try:
                    with open(candidate, "r", encoding="utf-8") as f:
                        return json.load(f)
                except Exception:
                    continue
        return {}

    def log_sync_error(self, company_id: str, error_message: str, stage: str, run_id: Optional[str] = None):
        """Appends an error record to sync_log.json and sync/sync-errors.log."""
        folder = self.get_company_folder(company_id)
        if not folder:
            meta = self.ensure_company_structure(company_id)
            folder = Path(meta["folderPath"])

        ts = datetime.now(timezone.utc).isoformat()
        entry = {
            "timestamp": ts,
            "runId": run_id or "NO_RUN_ID",
            "stage": stage,
            "error": error_message
        }

        # 1. Root sync_log.json (structured JSON lines)
        log_json_file = folder / "sync_log.json"
        try:
            with open(log_json_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            pass

        # 2. Nested sync/sync-errors.log (human readable log)
        sync_dir = folder / "sync"
        sync_dir.mkdir(parents=True, exist_ok=True)
        log_file = sync_dir / "sync-errors.log"
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(f"[{ts}] [{run_id or 'NO_RUN_ID'}] [STAGE: {stage}] ERROR: {error_message}\n")
        except Exception:
            pass

    def save_company_profile(self, company_id: str, profile_dict: Dict[str, Any]) -> Path:
        """Saves company profile to company.json in the root of the company directory."""
        meta = self.ensure_company_structure(company_id, profile_dict.get("name") or profile_dict.get("companyName"))
        folder = Path(meta["folderPath"])
        profile_file = folder / "company.json"
        profile_dict["_tallyFolder"] = meta.get("folderName")
        profile_dict["_tallyCompanyNumber"] = meta.get("companyNumber")
        profile_dict["_lastUpdated"] = datetime.now(timezone.utc).isoformat()
        with open(profile_file, "w", encoding="utf-8") as f:
            json.dump(profile_dict, f, indent=2, default=str, ensure_ascii=False)
        return profile_file

    @staticmethod
    def derive_stable_company_id(guid: Optional[str], master_id: Optional[Any], name: Optional[str]) -> str:
        """
        Derives a deterministic, reliable company ID:
        1. Tally GUID (UUID)
        2. Tally MasterId (MID_...)
        3. SHA-256 hash of company name (HASH_...)
        4. Fallback UUID
        """
        import hashlib, uuid
        if guid and str(guid).strip() and str(guid).strip() not in ("0", "None"):
            return str(guid).strip()
        if master_id is not None and str(master_id).strip() and str(master_id).strip() not in ("0", "None"):
            return f"MID_{str(master_id).strip()}"
        if name and str(name).strip():
            h = hashlib.sha256(str(name).strip().encode("utf-8")).hexdigest()[:16]
            return f"HASH_{h}"
        return f"GEN_{uuid.uuid4()}"

    def save_profile(self, company_id: str, profile_data: Dict[str, Any]) -> Path:
        """Saves company metadata profile to company_profile.json inside company folder."""
        meta = self.ensure_company_structure(company_id, profile_data.get("name"))
        folder_path = Path(meta["folderPath"])
        profile_file = folder_path / "company_profile.json"

        profile_data["_lastUpdated"] = datetime.now(timezone.utc).isoformat()
        profile_data["_tallyFolder"] = meta["folderName"]
        profile_data["_tallyCompanyNumber"] = meta["companyNumber"]

        with open(profile_file, "w", encoding="utf-8") as f:
            json.dump(profile_data, f, indent=2, default=str, ensure_ascii=False)
        
        # Also mirror to company.json for target structure parity
        self.save_company_profile(company_id, profile_data)
        return profile_file

    def save_snapshot(
        self,
        company_id: str,
        snapshot_type: str,
        data: Any,
        company_name: Optional[str] = None,
        is_xml: bool = False
    ) -> Dict[str, Any]:
        """
        Saves a raw sync snapshot (masters, vouchers, daybook, etc.) with timestamp.
        """
        meta = self.ensure_company_structure(company_id, company_name)
        snapshots_dir = Path(meta["folderPath"]) / "sync_snapshots"
        snapshots_dir.mkdir(parents=True, exist_ok=True)

        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        ext = ".xml" if is_xml else ".json"
        filename = f"{ts}_{snapshot_type}{ext}"
        filepath = snapshots_dir / filename

        if is_xml:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(str(data))
        else:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump({
                    "companyId": company_id,
                    "snapshotType": snapshot_type,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "recordCount": len(data) if isinstance(data, list) else (1 if data else 0),
                    "payload": data
                }, f, indent=2, default=str, ensure_ascii=False)

        stat = filepath.stat()
        return {
            "filename": filename,
            "filepath": str(filepath.resolve()),
            "sizeBytes": stat.st_size,
            "snapshotType": snapshot_type,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    def list_snapshots(self, company_id: str) -> List[Dict[str, Any]]:
        """Lists all snapshots stored in the company folder."""
        folder = self.get_company_folder(company_id)
        if not folder:
            return []
        snapshots_dir = folder / "sync_snapshots"
        if not snapshots_dir.exists():
            return []

        results = []
        for file in sorted(snapshots_dir.iterdir(), key=os.path.getmtime, reverse=True):
            if file.is_file():
                stat = file.stat()
                results.append({
                    "filename": file.name,
                    "sizeBytes": stat.st_size,
                    "createdAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "isXml": file.suffix.lower() == ".xml"
                })
        return results

    def create_backup(self, company_id: str, note: Optional[str] = None) -> Dict[str, Any]:
        """
        Creates a standalone, compressed .zip backup archive containing:
        - company_profile.json
        - sync_snapshots/
        - exports/
        - audit_logs/
        Saved inside the company's backups/ folder.
        """
        folder = self.get_company_folder(company_id)
        if not folder or not folder.exists():
            raise ValueError(f"Company folder for {company_id} does not exist.")

        backups_dir = folder / "backups"
        backups_dir.mkdir(parents=True, exist_ok=True)

        # Checkpoint WAL before backing up to ensure database.sqlite is fully up-to-date
        db_file = folder / "database.sqlite"
        if db_file.exists():
            try:
                import sqlite3
                conn = sqlite3.connect(str(db_file))
                conn.execute("PRAGMA wal_checkpoint(FULL)")
                conn.close()
            except Exception:
                pass

        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        zip_filename = f"backup_{company_id}_{ts}.zip"
        zip_path = backups_dir / zip_filename

        # Compress company contents excluding existing backups to avoid recursion
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(folder):
                # Exclude the backups directory itself
                if "backups" in dirs:
                    dirs.remove("backups")
                for file in files:
                    file_full_path = Path(root) / file
                    rel_path = file_full_path.relative_to(folder)
                    zipf.write(file_full_path, arcname=str(rel_path))

            # Store backup manifest inside zip
            manifest = {
                "companyId": company_id,
                "backupTimestamp": datetime.now(timezone.utc).isoformat(),
                "note": note or "Automated Tally-style backup",
                "version": "1.0"
            }
            zipf.writestr("backup_manifest.json", json.dumps(manifest, indent=2))

        stat = zip_path.stat()
        return {
            "filename": zip_filename,
            "filepath": str(zip_path.resolve()),
            "sizeBytes": stat.st_size,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "note": note
        }

    def list_backups(self, company_id: str) -> List[Dict[str, Any]]:
        """Lists all backup archives for a company."""
        folder = self.get_company_folder(company_id)
        if not folder:
            return []
        backups_dir = folder / "backups"
        if not backups_dir.exists():
            return []

        backups = []
        for file in sorted(backups_dir.glob("*.zip"), key=os.path.getmtime, reverse=True):
            stat = file.stat()
            backups.append({
                "filename": file.name,
                "filepath": str(file.resolve()),
                "sizeBytes": stat.st_size,
                "createdAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            })
        return backups

    def restore_backup(self, company_id: str, backup_filename: str) -> Dict[str, Any]:
        """
        Safely restores a company's data and database from a designated .zip backup.
        Verifies:
        1. Backup archive exists
        2. Manifest companyId matches requested companyId (prevents cross-company contamination)
        3. Restores files safely
        4. Validates restored SQLite database integrity
        """
        import sqlite3
        folder = self.get_company_folder(company_id)
        if not folder or not folder.exists():
            raise ValueError(f"Company folder for {company_id} does not exist.")

        backups_dir = folder / "backups"
        backup_path = backups_dir / backup_filename
        if not backup_path.exists():
            raise FileNotFoundError(f"Backup file {backup_filename} not found.")

        # Inspect manifest without extracting
        with zipfile.ZipFile(backup_path, "r") as zipf:
            namelist = zipf.namelist()
            if "backup_manifest.json" not in namelist:
                raise ValueError("Invalid backup archive: missing backup_manifest.json")

            with zipf.open("backup_manifest.json") as mf:
                manifest = json.load(mf)
                archive_company_id = manifest.get("companyId")
                if archive_company_id and str(archive_company_id).strip() != str(company_id).strip():
                    raise ValueError(
                        f"Cross-company restore violation! Archive belongs to company '{archive_company_id}', "
                        f"cannot restore into '{company_id}'."
                    )

            # Safely extract files
            restored_files = []
            for member in zipf.infolist():
                if member.filename in ("backup_manifest.json",):
                    continue
                # Guard against path traversal
                target_path = folder / member.filename
                if not str(target_path.resolve()).startswith(str(folder.resolve())):
                    raise ValueError(f"Unsafe path detected in backup archive: {member.filename}")

                zipf.extract(member, folder)
                restored_files.append(member.filename)

        # Integrity check on database.sqlite if restored
        db_file = folder / "database.sqlite"
        integrity_result = "unknown"
        if db_file.exists():
            conn = sqlite3.connect(str(db_file))
            try:
                row = conn.execute("PRAGMA integrity_check").fetchone()
                integrity_result = row[0] if row else "unknown"
            finally:
                conn.close()

        return {
            "success": True,
            "companyId": company_id,
            "backupFilename": backup_filename,
            "restoredFilesCount": len(restored_files),
            "restoredFiles": restored_files,
            "databaseIntegrity": integrity_result,
            "restoredAt": datetime.now(timezone.utc).isoformat()
        }

    def get_storage_stats(self, company_id: str) -> Dict[str, Any]:
        """Calculates disk space, snapshot counts, and backup history for a company."""
        index = self._load_index()
        meta = index.get(str(company_id).strip())

        folder = self.get_company_folder(company_id)
        if not folder or not folder.exists():
            return {
                "exists": False,
                "companyId": company_id,
                "folderPath": None,
                "totalSizeBytes": 0,
                "snapshotCount": 0,
                "backupCount": 0,
                "exportCount": 0
            }

        total_bytes = 0
        file_count = 0
        for root, _, files in os.walk(folder):
            for f in files:
                fp = Path(root) / f
                if fp.is_file():
                    total_bytes += fp.stat().st_size
                    file_count += 1

        snapshots = self.list_snapshots(company_id)
        backups = self.list_backups(company_id)

        exports_dir = folder / "exports"
        export_count = len([f for f in exports_dir.iterdir() if f.is_file()]) if exports_dir.exists() else 0

        return {
            "exists": True,
            "companyId": company_id,
            "companyNumber": meta.get("companyNumber") if meta else None,
            "folderName": folder.name,
            "folderPath": str(folder.resolve()),
            "totalSizeBytes": total_bytes,
            "totalSizeFormatted": f"{total_bytes / (1024 * 1024):.2f} MB" if total_bytes >= 1048576 else f"{total_bytes / 1024:.2f} KB",
            "fileCount": file_count,
            "snapshotCount": len(snapshots),
            "backupCount": len(backups),
            "exportCount": export_count,
            "lastBackupAt": backups[0]["createdAt"] if backups else None,
            "lastSnapshotAt": snapshots[0]["createdAt"] if snapshots else None
        }

    def get_overall_stats(self) -> Dict[str, Any]:
        """Telemetry across all companies in the Tally storage root."""
        self.base_dir.mkdir(parents=True, exist_ok=True)
        index = self._load_index()

        total_bytes = 0
        total_files = 0
        for root, _, files in os.walk(self.base_dir):
            for f in files:
                fp = Path(root) / f
                if fp.is_file():
                    total_bytes += fp.stat().st_size
                    total_files += 1

        # Check disk free space
        try:
            total_disk, used_disk, free_disk = shutil.disk_usage(self.base_dir)
        except Exception:
            total_disk, used_disk, free_disk = 0, 0, 0

        return {
            "dataRoot": str(self.base_dir.resolve()),
            "totalCompanies": len(index),
            "totalStorageBytes": total_bytes,
            "totalStorageFormatted": f"{total_bytes / (1024 * 1024):.2f} MB" if total_bytes >= 1048576 else f"{total_bytes / 1024:.2f} KB",
            "totalFiles": total_files,
            "diskFreeBytes": free_disk,
            "diskFreeFormatted": f"{free_disk / (1024 * 1024 * 1024):.2f} GB",
            "companies": list(index.values())
        }

    def set_custom_data_dir(self, new_dir: str) -> None:
        """Allows user to relocate the data directory to another drive or folder."""
        p = Path(new_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        self._custom_dir = p


company_folder_service = CompanyFolderService()
