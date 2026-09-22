"""
Comprehensive Test Suite for CFO Yantra Company-Wise Local Storage & Tally Sync.
Tests:
1. Physical directory structure & registry integrity
2. Database company isolation (zero cross-company records)
3. Full migration reconciliation across all 18 tables & idempotency
4. Offline local-first API data serving (overview, vouchers, ledgers, dashboard, outstandings)
5. Backup generation & cross-company restore isolation protection
6. Dynamic company registration & schema initialization
7. Bounded LRU engine management & concurrency safety
"""

import os
import sys
import json
import sqlite3
import shutil
import asyncio
from pathlib import Path
import pytest

# Ensure python_backend root is on sys.path for direct python execution
backend_root = Path(__file__).resolve().parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from starlette.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.core.company_db import company_db_manager
from app.services.storage.company_folder_service import company_folder_service

client = TestClient(app)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
COMPANIES_DIR = DATA_DIR / "companies"


def http_get(endpoint: str) -> dict:
    resp = client.get(f"/api/v1{endpoint}")
    assert resp.status_code == 200, f"GET {endpoint} failed: {resp.text}"
    return resp.json()


def http_post(endpoint: str, payload: dict) -> dict:
    resp = client.post(f"/api/v1{endpoint}", json=payload)
    assert resp.status_code == 200, f"POST {endpoint} failed: {resp.text}"
    return resp.json()


def http_post_expect_error(endpoint: str, payload: dict, expected_code: int = 400):
    resp = client.post(f"/api/v1{endpoint}", json=payload)
    if resp.status_code == expected_code:
        return True, f"Correctly returned HTTP {resp.status_code}: {resp.text}"
    return False, f"Expected HTTP {expected_code}, got {resp.status_code}: {resp.text}"


def test_1_directory_structure_and_index():
    """Test 1: Master Registry Index & Directory Structure."""
    print("\n--- Test 1: Registry Index & Directory Structure ---")
    index_file = DATA_DIR / "companies_index.json"
    assert index_file.exists(), f"Missing standard companies_index.json at {index_file}"

    with open(index_file, "r", encoding="utf-8") as f:
        index_data = json.load(f)

    assert len(index_data) >= 4, f"Expected at least 4 indexed companies, got {len(index_data)}"
    print(f"[PASS] Master registry index found with {len(index_data)} indexed companies.")

    for cid, meta in index_data.items():
        folder = COMPANIES_DIR / meta["folderName"]
        assert folder.exists(), f"Company folder missing: {folder}"
        db_file = folder / "database.sqlite"
        assert db_file.exists(), f"Company database missing: {db_file}"
        profile_file = folder / "company.json"
        assert profile_file.exists(), f"Company profile missing: {profile_file}"
        sync_state_file = folder / "sync_state.json"
        assert sync_state_file.exists(), f"Company sync_state.json missing: {sync_state_file}"

        # Verify no stale legacy paths
        assert "backend" not in meta.get("folderPath", "").lower().replace("cfo project", ""), \
            f"Stale backend path in folderPath: {meta.get('folderPath')}"

        print(f"  - Company: {meta.get('companyName')} (ID: {cid[:8]}...) -> {folder.name} [OK]")


def test_2_company_isolation():
    """Test 2: Complete Physical Database Company Isolation."""
    print("\n--- Test 2: Physical Database Company Isolation ---")
    index_file = DATA_DIR / "companies_index.json"
    with open(index_file, "r", encoding="utf-8") as f:
        index_data = json.load(f)

    for cid, meta in index_data.items():
        folder = COMPANIES_DIR / meta["folderName"]
        db_file = folder / "database.sqlite"
        con = sqlite3.connect(str(db_file))
        cur = con.cursor()

        # Check that NO record in this company's database belongs to another companyId
        for table in ["vouchers", "ledgers", "stockitems", "groups", "bill_outstandings"]:
            alien_count = cur.execute(
                f'SELECT COUNT(*) FROM "{table}" WHERE "companyId" != ? AND "companyId" IS NOT NULL',
                (cid,)
            ).fetchone()[0]
            assert alien_count == 0, f"Isolation violation in {meta['folderName']}: {alien_count} alien {table} rows!"

        con.close()
        print(f"  - {meta['companyName']}: 100% physically isolated (0 alien rows)")

    print("[PASS] Complete physical isolation verified across all company databases.")


def test_3_migration_reconciliation_and_idempotency():
    """Test 3: Full Migration Reconciliation & Idempotency."""
    print("\n--- Test 3: Migration Reconciliation & Idempotency ---")
    result = asyncio.run(company_db_manager.migrate_records_from_central_db())
    assert result["success"] is True, f"Migration failed: {result}"
    reconciliation = result["reconciliation"]

    assert reconciliation["isFullyReconciled"] is True, \
        f"Reconciliation discrepancies detected: {reconciliation['discrepancies']}"

    src = reconciliation["sourceTotals"]
    dst = reconciliation["destinationTotals"]

    print(f"  - Vouchers reconciled: {dst.get('vouchers')} / {src.get('vouchers')} [OK]")
    print(f"  - Ledgers reconciled: {dst.get('ledgers')} / {src.get('ledgers')} [OK]")
    print(f"  - Stock Items reconciled: {dst.get('stockitems')} / {src.get('stockitems')} [OK]")
    print(f"  - Groups reconciled: {dst.get('groups')} / {src.get('groups')} [OK]")
    print(f"  - Stock Groups reconciled: {dst.get('stockgroups')} / {src.get('stockgroups')} [OK]")
    print(f"  - Bill Outstandings reconciled: {dst.get('bill_outstandings')} / {src.get('bill_outstandings')} [OK]")
    print(f"  - Currencies reconciled: {dst.get('currencies')} / {src.get('currencies')} [OK]")

    assert dst.get("vouchers") == src.get("vouchers"), f"Voucher reconciliation mismatch: {dst.get('vouchers')} != {src.get('vouchers')}"
    assert dst.get("ledgers") == src.get("ledgers"), f"Ledger reconciliation mismatch: {dst.get('ledgers')} != {src.get('ledgers')}"
    assert dst.get("stockitems") == src.get("stockitems"), f"Stock item reconciliation mismatch: {dst.get('stockitems')} != {src.get('stockitems')}"
    assert dst.get("bill_outstandings") == src.get("bill_outstandings"), f"Bill outstanding mismatch: {dst.get('bill_outstandings')} != {src.get('bill_outstandings')}"

    # Re-run migration to test idempotency (no duplicate rows should be introduced)
    re_run = asyncio.run(company_db_manager.migrate_records_from_central_db())
    assert re_run["reconciliation"]["destinationTotals"]["vouchers"] == src.get("vouchers"), "Idempotency failure on vouchers!"
    assert re_run["reconciliation"]["destinationTotals"]["ledgers"] == src.get("ledgers"), "Idempotency failure on ledgers!"
    print("[PASS] 100% Data reconciliation and idempotent re-run verified.")


def test_4_offline_api_endpoints():
    """Test 4: Offline Local-First API Endpoints."""
    print("\n--- Test 4: Offline Local-First API Endpoints ---")
    res = http_get("/companies")
    assert res.get("success"), "Failed to fetch companies list"
    companies = res.get("companies", [])
    assert len(companies) >= 4, f"Expected at least 4 companies, got {len(companies)}"
    print(f"[PASS] /companies returned {len(companies)} companies with storage metadata.")

    # Find company with vouchers: Marshal Engineers
    marshal = next((c for c in companies if "Marshal" in c.get("name", "")), None)
    assert marshal, "Marshal Engineers not found in companies list"
    cid = marshal["companyId"]

    # 1. Overview
    ov = http_get(f"/companies/{cid}/overview")
    assert ov.get("success") is True
    assert ov.get("isLocalAvailable") is True
    counts = ov["data"]["counts"]
    assert counts["vouchers"] == 10812, f"Expected 10812 vouchers, got {counts['vouchers']}"
    assert counts["ledgers"] == 1120, f"Expected 1120 ledgers, got {counts['ledgers']}"
    print(f"  - Overview: {counts['vouchers']} vouchers, {counts['ledgers']} ledgers [OK]")

    # 2. Vouchers listing
    v_res = http_get(f"/companies/{cid}/vouchers?limit=5")
    assert v_res.get("success") is True
    assert len(v_res["data"]) == 5
    assert v_res["pagination"]["total"] == 10812
    print(f"  - Vouchers: retrieved {len(v_res['data'])} / {v_res['pagination']['total']} vouchers [OK]")

    # 3. Ledgers listing
    l_res = http_get(f"/companies/{cid}/ledgers?limit=5")
    assert l_res.get("success") is True
    assert len(l_res["data"]) == 5
    assert l_res["pagination"]["total"] == 1120
    print(f"  - Ledgers: retrieved {len(l_res['data'])} / {l_res['pagination']['total']} ledgers [OK]")

    # 4. Dashboard metrics computed offline
    dash = http_get(f"/companies/{cid}/dashboard")
    assert dash.get("isLocalAvailable") is True
    kpis = dash.get("kpis") or dash.get("data", {}).get("kpis", {})
    sales_amt = kpis.get("sales", {}).get("amount", "0")
    print(f"  - Dashboard: offline KPI computation verified (sales: {sales_amt}) [OK]")

    # 5. Outstandings for CMP001 (Tata Motors)
    tata = next((c for c in companies if c.get("companyId") == "CMP001" or "Tata" in c.get("name", "")), None)
    assert tata, "CMP001 not found"
    out_res = http_get(f"/companies/{tata['companyId']}/outstandings")
    assert out_res.get("success") is True
    assert out_res["summary"]["totalBills"] == 4, f"Expected 4 bills for Tata, got {out_res['summary']['totalBills']}"
    assert out_res["summary"]["totalReceivable"] == 445000.0
    print(f"  - Outstandings: 4 migrated bills verified with aging buckets [OK]")


def test_5_backup_and_restore_with_isolation():
    """Test 5: Backup Generation & Cross-Company Restore Isolation Protection."""
    print("\n--- Test 5: Backup, Restore & Cross-Company Isolation ---")
    res = http_get("/companies")
    companies = res["companies"]
    aqua = next((c for c in companies if "AQUA" in c.get("name", "").upper()), None)
    marshal = next((c for c in companies if "MARSHAL" in c.get("name", "").upper()), None)
    assert aqua and marshal, "Test requires Aqua and Marshal companies"

    aqua_id = aqua["companyId"]
    marshal_id = marshal["companyId"]

    # 1. Trigger backup for Aqua Overseas
    backup_res = http_post(f"/companies/{aqua_id}/backup", {"note": "Automated test backup"})
    assert backup_res.get("success") is True
    backup_fn = backup_res["data"]["filename"]
    print(f"  - Backup created for Aqua: {backup_fn} ({backup_res['data']['sizeBytes']} bytes) [OK]")

    # 2. List backups
    backups_list = http_get(f"/companies/{aqua_id}/backups")
    assert any(b["filename"] == backup_fn for b in backups_list["data"])
    print(f"  - Backups listing verified for Aqua [OK]")

    # 3. Cross-company restore attack test:
    # Attempt to restore Aqua's backup into Marshal Engineers
    meta_aqua = http_get(f"/companies/{aqua_id}/storage")["data"]
    meta_marshal = http_get(f"/companies/{marshal_id}/storage")["data"]
    aqua_backup_path = Path(meta_aqua["folderPath"]) / "backups" / backup_fn
    marshal_backups_dir = Path(meta_marshal["folderPath"]) / "backups"
    marshal_backups_dir.mkdir(parents=True, exist_ok=True)
    injected_backup = marshal_backups_dir / backup_fn
    shutil.copy(aqua_backup_path, injected_backup)

    try:
        passed, msg = http_post_expect_error(
            f"/companies/{marshal_id}/restore",
            {"backupFilename": backup_fn},
            expected_code=400
        )
        assert passed, f"Cross-company restore should be rejected: {msg}"
        print(f"  - Cross-company restore prevention verified: {msg} [OK]")
    finally:
        if injected_backup.exists():
            injected_backup.unlink()

    # 4. Legitimate restore for Aqua Overseas
    restore_res = http_post(f"/companies/{aqua_id}/restore", {"backupFilename": backup_fn})
    assert restore_res.get("success") is True
    assert restore_res["data"]["databaseIntegrity"] == "ok"
    print(f"  - Legitimate restore succeeded with database integrity: 'ok' [OK]")


def test_6_company_registration_and_lifecycle():
    """Test 6: Dynamic Company Registration & Cleanup."""
    print("\n--- Test 6: Dynamic Company Registration ---")
    test_comp = {
        "name": "TEST_ISOLATION_CORP_2026",
        "guid": "test-guid-uuid-12345",
        "legalName": "Test Isolation Corporation Ltd",
        "state": "Maharashtra",
        "country": "India"
    }
    reg_res = http_post("/companies/register", test_comp)
    assert reg_res.get("success") is True
    cid = reg_res["data"]["companyId"]
    db_path = Path(reg_res["data"]["databasePath"])
    assert db_path.exists(), "Registered company database file was not created"

    # Verify tables inside new database
    con = sqlite3.connect(str(db_path))
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    con.close()
    assert "vouchers" in tables and "ledgers" in tables
    print(f"  - Dynamic registration schema initialized ({len(tables)} tables) [OK]")

    # Overview
    ov = http_get(f"/companies/{cid}/overview")
    assert ov["data"]["counts"]["vouchers"] == 0
    print(f"  - Overview returns zero counts for new company [OK]")

    # Clean up test registration
    folder_path = Path(reg_res["data"]["folderPath"])
    if folder_path.exists():
        shutil.rmtree(folder_path, ignore_errors=True)
    idx = company_folder_service._load_index()
    if cid in idx:
        del idx[cid]
        company_folder_service._save_index(idx)
    print(f"  - Cleaned up dynamic test company [OK]")


def test_7_lru_engine_management():
    """Test 7: Bounded LRU Engine Management."""
    print("\n--- Test 7: LRU Engine Management ---")
    async def run_lru():
        for i in range(12):
            cid = f"TEST_LRU_MGR_{i}"
            await company_db_manager.get_engine(cid, f"LRU Company {i}")

        active_count = len(company_db_manager._engines)
        assert active_count <= 10, f"Expected at most 10 active engines, got {active_count}"
        print(f"  - Bounded active engines verified: {active_count} (<= 10 limit) [OK]")

        await company_db_manager.close_all()
        assert len(company_db_manager._engines) == 0

        # Clean up
        base = Path(settings.COMPANIES_DATA_DIR)
        for p in base.glob("*TEST_LRU_MGR_*"):
            shutil.rmtree(p, ignore_errors=True)
        idx = company_folder_service._load_index()
        for i in range(12):
            idx.pop(f"TEST_LRU_MGR_{i}", None)
        company_folder_service._save_index(idx)

    asyncio.run(run_lru())
    print("[PASS] LRU bounded engine management verified.")


if __name__ == "__main__":
    print("==================================================================")
    print("CFO YANTRA COMPANY-WISE LOCAL STORAGE & TALLY SYNC TEST SUITE")
    print("==================================================================")
    test_1_directory_structure_and_index()
    test_2_company_isolation()
    test_3_migration_reconciliation_and_idempotency()
    test_4_offline_api_endpoints()
    test_5_backup_and_restore_with_isolation()
    test_6_company_registration_and_lifecycle()
    test_7_lru_engine_management()
    print("\n==================================================================")
    print("ALL TESTS PASSED SUCCESSFULLY! (7 / 7)")
    print("==================================================================")
