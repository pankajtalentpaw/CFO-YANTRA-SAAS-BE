"""
Tally schemas.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
from app.schemas.base import BaseCamelModel

class TallySettingsDto(BaseCamelModel):
    tally_host: str = "127.0.0.1"
    tally_port: int = 9000
    protocol: str = "http"
    connection_mode: str = "DIRECT"
    target_company: str = ""
    timeout_ms: int = 120000
    probe_timeout_ms: int = 8000
    auto_sync_enabled: bool = True
    sync_interval_ms: int = 300000
    last_known_status: str = "UNKNOWN"
    last_connected_at: Optional[datetime] = None

class TallyTestConnectionResult(BaseCamelModel):
    connected: bool
    status: str
    response_time_ms: int
    message: str
    active_companies: List[str] = []

class SyncStatusDto(BaseCamelModel):
    status: str = "IDLE"
    is_running: bool = False
    last_run_id: Optional[str] = None
    last_started_at: Optional[datetime] = None
    last_finished_at: Optional[datetime] = None
    last_success_at: Optional[datetime] = None
    total_records: int = 0
    changed_records: int = 0
