"""
End-to-End System Health & Diagnostic Suite for Tally & CFO Yantra.
Probes TallyPrime loopback, SQLite DB integrity, Company Storage, Backend API, and Frontend.
"""

import sys
import os
import time
import urllib.request
import urllib.error
import json
import sqlite3
from pathlib import Path

# Flexible Paths (supports running from python_backend/SysSetUp or root SysSetUp)
SETUP_DIR = Path(__file__).resolve().parent
if (SETUP_DIR.parent.parent / "run.py").exists():
    PYTHON_BE_DIR = SETUP_DIR.parent.parent
    ROOT_DIR = PYTHON_BE_DIR.parent.parent
    DATA_DIR = PYTHON_BE_DIR.parent / "data"
elif (SETUP_DIR.parent.parent / "backend" / "python_backend" / "run.py").exists():
    ROOT_DIR = SETUP_DIR.parent.parent
    PYTHON_BE_DIR = ROOT_DIR / "backend" / "python_backend"
    DATA_DIR = ROOT_DIR / "backend" / "data"
else:
    PYTHON_BE_DIR = SETUP_DIR.parent.parent
    DATA_DIR = PYTHON_BE_DIR / "data"

DB_FILE = DATA_DIR / "cfo_yantra.sqlite"
COMPANIES_DIR = DATA_DIR / "companies"

TALLY_URL = "http://127.0.0.1:9000"
BACKEND_HEALTH_URL = "http://127.0.0.1:5000/api/v1/health"
FRONTEND_URL = "http://127.0.0.1:5001"

def print_header(title):
    print("\n" + "=" * 65)
    print(f"   {title}")
    print("=" * 65)

def check_http_endpoint(url, timeout=2):
    start = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CFO-Diagnostic"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = int((time.time() - start) * 1000)
            return True, resp.status, elapsed, resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return False, 0, elapsed, str(e)

def run_diagnostics():
    print_header("CFO YANTRA & TALLY SYSTEM HEALTH DIAGNOSTICS")

    results = []

    # 1. TallyPrime HTTP Gateway
    print("\n[1] Testing TallyPrime HTTP Gateway (Port 9000)...")
    tally_ok, tally_status, tally_ms, tally_resp = check_http_endpoint(TALLY_URL, timeout=3)
    if tally_ok:
        print(f"    Status   : ONLINE (HTTP {tally_status}, {tally_ms} ms)")
        results.append(("TallyPrime (Port 9000)", "ONLINE", f"{tally_ms} ms"))
    else:
        print(f"    Status   : OFFLINE / Not Detected on port 9000 ({tally_ms} ms)")
        print("    Note     : Open TallyPrime -> F12 -> Advanced Config -> Enable ODBC/HTTP: Yes, Port: 9000")
        results.append(("TallyPrime (Port 9000)", "OFFLINE", "Not Running"))

    # 2. CFO SQLite Database
    print("\n[2] Testing CFO Database Integrity...")
    if DB_FILE.exists():
        try:
            conn = sqlite3.connect(str(DB_FILE))
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [row[0] for row in cursor.fetchall() if not row[0].startswith("sqlite_")]
            cursor.execute("PRAGMA journal_mode;")
            journal_mode = cursor.fetchone()[0]
            conn.close()
            size_mb = round(DB_FILE.stat().st_size / (1024 * 1024), 2)
            print(f"    Database : {DB_FILE.name} ({size_mb} MB)")
            print(f"    Tables   : {len(tables)} active tables ({', '.join(tables[:5])}...)")
            print(f"    Journal  : {journal_mode.upper()} mode")
            results.append(("SQLite Database", "HEALTHY", f"{len(tables)} tables, {journal_mode.upper()}"))
        except Exception as e:
            print(f"    Database Error: {e}")
            results.append(("SQLite Database", "ERROR", str(e)))
    else:
        print("    Database : Not found. Run init_cfo_system.bat to create.")
        results.append(("SQLite Database", "MISSING", "Run init_cfo_system.bat"))

    # 3. Company Storage Folders
    print("\n[3] Testing Tally-Style Company Storage Isolation...")
    index_file = COMPANIES_DIR / "companies_index.json"
    if COMPANIES_DIR.exists() and index_file.exists():
        try:
            with open(index_file, "r", encoding="utf-8") as f:
                index_data = json.load(f)
            registered = len(index_data)
            print(f"    Storage  : {COMPANIES_DIR}")
            print(f"    Companies: {registered} isolated company folders tracked")
            results.append(("Company Storage", "READY", f"{registered} companies tracked"))
        except Exception as e:
            print(f"    Index Error: {e}")
            results.append(("Company Storage", "ERROR", str(e)))
    else:
        print("    Storage  : Not initialized. Run init_cfo_system.bat")
        results.append(("Company Storage", "NOT INIT", "Run init_cfo_system.bat"))

    # 4. CFO Backend Server
    print("\n[4] Testing CFO Backend Server (Port 5000)...")
    be_ok, be_status, be_ms, be_resp = check_http_endpoint(BACKEND_HEALTH_URL, timeout=2)
    if be_ok:
        print(f"    Backend  : ONLINE (HTTP {be_status}, {be_ms} ms)")
        results.append(("CFO Backend (Port 5000)", "ONLINE", f"{be_ms} ms"))
    else:
        print(f"    Backend  : NOT RUNNING on port 5000 ({be_ms} ms)")
        print("    Note     : Start backend using 'start_cfo_backend.bat'")
        results.append(("CFO Backend (Port 5000)", "STOPPED", "Start via start_cfo_backend.bat"))

    # 5. Frontend UI Server
    print("\n[5] Testing Frontend UI Dev Server (Port 5001)...")
    fe_ok, fe_status, fe_ms, fe_resp = check_http_endpoint(FRONTEND_URL, timeout=2)
    if fe_ok:
        print(f"    Frontend : ONLINE (HTTP {fe_status}, {fe_ms} ms)")
        results.append(("Frontend UI (Port 5001)", "ONLINE", f"{fe_ms} ms"))
    else:
        print(f"    Frontend : NOT RUNNING on port 5173 ({fe_ms} ms)")
        results.append(("Frontend UI (Port 5001)", "STOPPED", "Run npm run dev in frontend"))

    # Summary
    print_header("SYSTEM DIAGNOSTIC SUMMARY")
    print(f"{'Component':<28} | {'Status':<12} | {'Details'}")
    print("-" * 65)
    for comp, stat, det in results:
        indicator = "[OK]" if stat in ("ONLINE", "HEALTHY", "READY") else "[!]"
        print(f"{indicator} {comp:<24} | {stat:<12} | {det}")
    print("=" * 65)

if __name__ == "__main__":
    run_diagnostics()
