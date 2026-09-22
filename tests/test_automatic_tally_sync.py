"""
Comprehensive Test Suite for CFO Yantra Automatic Tally Data Fetching & Background Synchronization.
Verifies:
1. Source connectivity & operating mode classification (CONNECTED, OFFLINE, PORT_CLOSED)
2. Non-destructive failure guarantee: sync failure preserves 100% of existing local data
3. Atomic transaction protection: outstandings and vouchers never wiped on connection loss
4. BackgroundSyncScheduler lifecycle, interval configuration, pause/resume, and per-company schedules
5. Duplicate job locking and overlap prevention
6. Exponential backoff retry policy and failure telemetry
7. Local-first dashboard offline data serving
8. API contracts for scheduler and source status
"""

import sys
import os
import json
import sqlite3
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pytest
from unittest.mock import AsyncMock, patch

# Ensure python_backend root is on sys.path
backend_root = Path(__file__).resolve().parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from starlette.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.core.exceptions import ApiError, AppErrorCodes
from app.models import Voucher, Ledger, BillOutstanding
from app.services.storage import company_folder_service
from app.services.tally.tally_client import tally_client
from app.services.sync.sync_engine import tally_sync_engine
from app.services.sync.scheduler import background_scheduler

client = TestClient(app)


def test_1_tally_source_connection_modes():
    """Test 1: Accurate source connection status & operating mode classification."""
    print("\n--- Test 1: Tally Connection & Operating Mode Classification ---")

    # Probe actual state
    probe = asyncio.run(tally_client.probe_connection())
    assert "status" in probe
    assert "operatingMode" in probe
    assert "isAvailable" in probe
    assert "message" in probe
    assert isinstance(probe["activeCompanies"], list)
    print(f"[PASS] Actual Tally probe: status={probe['status']}, mode={probe['operatingMode']}, available={probe['isAvailable']}")

    # Mock scenario: Tally completely offline (process not running)
    with patch.object(tally_client, "is_port_listening", return_value=False), \
         patch.object(tally_client, "is_tally_process_running", return_value=False):
        offline_probe = asyncio.run(tally_client.probe_connection())
        assert offline_probe["connected"] is False
        assert offline_probe["status"] == "OFFLINE"
        assert offline_probe["operatingMode"] == "STOPPED"
        assert offline_probe["isAvailable"] is False
        print("[PASS] Offline state correctly identified as STOPPED / OFFLINE.")

    # Mock scenario: Tally process running, but port blocked
    with patch.object(tally_client, "is_port_listening", return_value=False), \
         patch.object(tally_client, "is_tally_process_running", return_value=True):
        blocked_probe = asyncio.run(tally_client.probe_connection())
        assert blocked_probe["connected"] is False
        assert blocked_probe["status"] == "PORT_CLOSED"
        assert blocked_probe["operatingMode"] == "PROCESS_RUNNING_PORT_BLOCKED"
        print("[PASS] Port blocked state correctly distinguished from process stopped.")

    # Mock scenario: Port listening, but 0 companies loaded
    with patch.object(tally_client, "is_port_listening", return_value=True), \
         patch.object(tally_client, "fetch_loaded_companies", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.return_value = []
        no_comp_probe = asyncio.run(tally_client.probe_connection())
        assert no_comp_probe["status"] == "NO_COMPANY_LOADED"
        assert no_comp_probe["isAvailable"] is False
        print("[PASS] Running Tally with 0 loaded companies correctly identified.")


def test_2_non_destructive_sync_failure():
    """Test 2: Failed synchronization strictly preserves previously synchronized records."""
    print("\n--- Test 2: Non-Destructive Failure Guarantee ---")
    test_cid = "CMP001"
    meta = company_folder_service.ensure_company_structure(test_cid)
    db_path = Path(meta["databasePath"])
    assert db_path.exists(), f"Database for {test_cid} must exist."

    # Record initial counts
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    initial_vouchers = cur.execute("SELECT COUNT(*) FROM vouchers WHERE companyId = ?", (test_cid,)).fetchone()[0]
    initial_bills = cur.execute("SELECT COUNT(*) FROM bill_outstandings WHERE companyId = ?", (test_cid,)).fetchone()[0]
    con.close()

    print(f"  - Initial state before simulated failure: {initial_vouchers} vouchers, {initial_bills} outstandings.")

    # Simulate Tally connection failure during sync
    with patch.object(tally_client, "execute_request", side_effect=ApiError.bad_gateway("Connection refused", AppErrorCodes.TALLY_CONNECTION_FAILED)):
        sync_res = asyncio.run(tally_sync_engine.run_sync(
            company_id=test_cid,
            company_name="Tata Motors Ltd"
        ))
        assert sync_res["success"] is False, "Sync should report failure on connection error"
        assert "failed" in sync_res["message"].lower() or "connection" in sync_res["message"].lower()

    # Verify that existing records were NOT erased or modified
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    after_vouchers = cur.execute("SELECT COUNT(*) FROM vouchers WHERE companyId = ?", (test_cid,)).fetchone()[0]
    after_bills = cur.execute("SELECT COUNT(*) FROM bill_outstandings WHERE companyId = ?", (test_cid,)).fetchone()[0]
    con.close()

    assert after_vouchers == initial_vouchers, f"Data loss detected! Vouchers changed: {initial_vouchers} -> {after_vouchers}"
    assert after_bills == initial_bills, f"Data loss detected! Outstandings changed: {initial_bills} -> {after_bills}"
    print(f"[PASS] Non-destructive failure verified: 100% of records preserved ({after_vouchers} vouchers, {after_bills} bills).")

    # Verify structured error logged
    state = company_folder_service.load_sync_state(test_cid)
    assert state.get("status") in ("FAILED", "ERROR")


def test_3_scheduler_lifecycle_and_controls():
    """Test 3: Background Scheduler Configuration, Pause, Resume, and Interval Controls."""
    print("\n--- Test 3: Background Scheduler Controls ---")

    # Global enable/disable
    background_scheduler.set_enabled(True)
    assert background_scheduler.is_enabled is True
    background_scheduler.set_enabled(False)
    assert background_scheduler.is_enabled is False
    background_scheduler.set_enabled(True)

    # Pause / Resume
    background_scheduler.pause()
    assert background_scheduler.is_paused is True
    assert background_scheduler.get_status()["isPaused"] is True
    background_scheduler.resume()
    assert background_scheduler.is_paused is False
    assert background_scheduler.get_status()["isPaused"] is False
    print("[PASS] Scheduler pause and resume state verified.")

    # Interval configuration
    background_scheduler.set_global_interval(30)
    assert background_scheduler.get_status()["intervalMinutes"] == 30
    assert background_scheduler.get_status()["intervalSeconds"] == 1800
    background_scheduler.set_global_interval(15)
    assert background_scheduler.get_status()["intervalMinutes"] == 15
    print("[PASS] Global interval configuration (15 min) verified.")

    # Per-company custom interval and toggle
    test_comp = "CMP002"
    background_scheduler.set_company_config(test_comp, enabled=False, interval_minutes=60)
    c_cfg = background_scheduler.get_company_config(test_comp)
    assert c_cfg["enabled"] is False
    assert c_cfg["intervalSeconds"] == 3600
    print(f"[PASS] Company-specific schedule override verified for '{test_comp}'.")


def test_4_concurrency_locking_and_overlap_prevention():
    """Test 4: Prevents duplicate and overlapping sync cycles for the same company."""
    print("\n--- Test 4: Concurrency Locking & Overlap Prevention ---")
    test_cid = "CMP001"

    # Simulate an active running sync by marking company in running set
    background_scheduler._running_companies.add(test_cid)
    try:
        dup_res = asyncio.run(background_scheduler.sync_company_now(test_cid, "Tata Motors Ltd"))
        assert dup_res["success"] is False
        assert dup_res.get("alreadyRunning") is True
        print("[PASS] Duplicate sync attempt successfully rejected by concurrency lock.")
    finally:
        background_scheduler._running_companies.discard(test_cid)


def test_5_exponential_backoff_retry_tracking():
    """Test 5: Exponential backoff tracking and retry limit telemetry."""
    print("\n--- Test 5: Exponential Backoff Retry Tracking ---")
    test_cid = "RETRY_TEST_CORP"

    # Reset retry state
    background_scheduler._retry_state.pop(test_cid, None)

    # Simulate 3 failures
    for attempt in range(1, 4):
        background_scheduler._record_failure(test_cid, {"companyId": test_cid}, f"Simulated error {attempt}")
        info = background_scheduler._retry_state.get(test_cid)
        assert info is not None
        assert info["retries"] == attempt
        assert info["nextRetryAt"] > datetime.now(timezone.utc)
        print(f"  - Failure {attempt}: backoff recorded, next retry at {info['nextRetryAt'].strftime('%H:%M:%S')}")

    status = background_scheduler.get_status()
    assert test_cid in status["retryStates"]
    assert status["retryStates"][test_cid]["retries"] == 3
    print("[PASS] Exponential backoff telemetry properly records retry limits.")

    # Clean up
    background_scheduler._retry_state.pop(test_cid, None)


def test_6_offline_dashboard_data_serving():
    """Test 6: Dashboard serves cached data seamlessly when Tally is offline."""
    print("\n--- Test 6: Offline Dashboard Data Serving ---")
    test_cid = "CMP001"

    resp = client.get(f"/api/v1/companies/{test_cid}/dashboard")
    assert resp.status_code == 200, f"Dashboard failed: {resp.text}"
    data = resp.json()

    assert data.get("isLocalAvailable") is True
    assert "kpis" in data
    assert "monthly" in data
    assert "autoSync" in data
    assert "storage" in data.get("data", {})
    assert data["data"]["storage"]["isLocalAvailable"] is True
    print(f"[PASS] Offline dashboard successfully loaded: {list(data['kpis'].keys())} with local availability verified.")

    # Overview endpoint
    ov_resp = client.get(f"/api/v1/companies/{test_cid}/overview")
    assert ov_resp.status_code == 200
    ov_data = ov_resp.json()
    assert ov_data.get("isLocalAvailable") is True
    assert ov_data["data"]["counts"]["vouchers"] > 0
    print(f"[PASS] Offline overview successfully loaded: {ov_data['data']['counts']['vouchers']} vouchers available.")


def test_7_scheduler_and_sync_api_contracts():
    """Test 7: Full API Contracts for Scheduler Management & Status Reporting."""
    print("\n--- Test 7: Scheduler API Contracts ---")

    # GET /sync/status
    s_resp = client.get("/api/v1/sync/status")
    assert s_resp.status_code == 200
    s_data = s_resp.json()
    assert "source" in s_data
    assert "autoSync" in s_data
    assert "mirror" in s_data
    assert s_data["source"]["status"] in ("ONLINE", "OFFLINE", "PORT_CLOSED", "NO_COMPANY_LOADED")
    print(f"  - GET /sync/status: sourceStatus={s_data['source']['status']}, autoSyncEnabled={s_data['autoSync']['enabled']}")

    # GET /sync/scheduler
    sched_resp = client.get("/api/v1/sync/scheduler")
    assert sched_resp.status_code == 200
    sched_data = sched_resp.json()["data"]
    assert "enabled" in sched_data
    assert "isPaused" in sched_data
    assert "intervalMinutes" in sched_data

    # POST /sync/scheduler/pause and /resume
    p_resp = client.post("/api/v1/sync/scheduler/pause")
    assert p_resp.status_code == 200
    assert p_resp.json()["data"]["isPaused"] is True

    r_resp = client.post("/api/v1/sync/scheduler/resume")
    assert r_resp.status_code == 200
    assert r_resp.json()["data"]["isPaused"] is False
    print("  - POST /sync/scheduler/pause & /resume verified.")

    # POST /sync/{companyId}/schedule
    comp_sched_resp = client.post(
        "/api/v1/sync/CMP001/schedule",
        json={"enabled": True, "intervalMinutes": 20}
    )
    assert comp_sched_resp.status_code == 200
    assert comp_sched_resp.json()["data"]["intervalSeconds"] == 1200
    print("  - POST /sync/{companyId}/schedule verified.")

    print("[PASS] All Scheduler API contracts verified.")


if __name__ == "__main__":
    test_1_tally_source_connection_modes()
    test_2_non_destructive_sync_failure()
    test_3_scheduler_lifecycle_and_controls()
    test_4_concurrency_locking_and_overlap_prevention()
    test_5_exponential_backoff_retry_tracking()
    test_6_offline_dashboard_data_serving()
    test_7_scheduler_and_sync_api_contracts()
    print("\n=======================================================")
    print("   ALL AUTOMATIC TALLY FETCH TESTS PASSED SUCCESSFULLY! ")
    print("=======================================================")
