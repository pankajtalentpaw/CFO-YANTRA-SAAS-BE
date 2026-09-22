# CFO Yantra — Automatic Tally Data Fetching Feasibility Audit

## 1. Executive Summary & Audit Context

* **Audit Target:** CFO Yantra Python Backend & TallyPrime Integration Layer
* **Host Operating System:** Microsoft Windows 11 Pro / Enterprise (x64)
* **Tally Installation Found:** TallyPrime Edit Log at `C:\Program Files\TallyPrimeEditLog (1)\tally.exe`
* **Tally Configuration:** `C:\Program Files\TallyPrimeEditLog (1)\tally.ini`
* **Tally Data Path:** `C:\Users\Public\TallyPrimeEditLog\data\`
* **Active Company:** `RAVI ENGINEERING CO.2024-26` (`Folder: 100000`, preloaded via `Load=100000`)
* **Core Audit Question:** Can CFO Yantra automatically fetch and synchronize Tally accounting data **without requiring the user to manually open TallyPrime every time data is needed**?

---

## 2. Existing Integration Architecture

CFO Yantra's existing architecture consists of:
1. **FastAPI Async Backend** (`app/main.py`, `run.py` on port 5000) using SQLAlchemy 2.0 and `aiosqlite`.
2. **Company-Wise Local Storage** (`app/core/company_db.py`, `app/services/storage/company_folder_service.py`):
   - Dedicated SQLite databases: `data/companies/{comp_num}_{comp_name}/database.sqlite`.
   - SQLite WAL mode (`PRAGMA journal_mode=WAL`), `PRAGMA busy_timeout=5000`, `PRAGMA synchronous=NORMAL`.
   - Central catalog mirror: `data/cfo_yantra.sqlite` and `data/companies_index.json`.
3. **Tally Client** (`app/services/tally/tally_client.py`):
   - Sends XML export requests via HTTP POST to `http://127.0.0.1:9000`.
   - Serialized requests with `asyncio.Lock()` to protect Tally's single-threaded HTTP listener.
   - Read-only firewall blocking mutations (`CREATE`, `ALTER`, `DELETE`).
4. **Sync Engine** (`app/services/sync/sync_engine.py`):
   - 8-stage extraction pipeline (`CM`, `CMGRP`, `IM`, `IMGRP`, `SPCD`, `BPBR`, `LEDGER`, `COA`, `VOA`).
   - Incremental `AlterID` queries and monthly batch slices for vouchers.
   - Bulk upserts into per-company SQLite database and central mirror.

---

## 3. Mandatory Feasibility Investigation: Closed-Tally Data Access

### A. Tally Native Data Format & Direct Access (Mode A)
* **Data Format:** Tally stores data in proprietary ISAM object files (`.1800` for TallyPrime Edit Log, `.900` for standard TallyPrime), e.g. `Company.1800`, `Manager.1800`, `TranMgr.1800`, `Index.1800`, `TACCESS.TSF`.
* **Empirical Test:** A direct SQLite connection attempt against `C:\Users\Public\TallyPrimeEditLog\data\100000\Company.1800` was executed:
  ```text
  SQLite verification result: DatabaseError: file is not a database
  ```
* **Format Structure:** The `.1800` / `.900` files utilize proprietary binary B-tree indexing, custom object compression, proprietary hashing, schema dictionaries, and memory rollback journals.
* **Integrity & Safety Assessment:**
  1. No official driver or reverse-engineering specification exists for reading raw `.1800`/`.900` files without the Tally runtime engine.
  2. Attempting to bypass Tally to read or parse raw blocks while files are open or closed risks reading inconsistent dirty transaction blocks, causes file access contention, and risks permanent database corruption.
  3. **Audit Verdict on Mode A:** **Direct native file reading while Tally is closed is STRICTLY UNSUPPORTED and DANGEROUS for proprietary Tally databases.**

### B. Tally HTTP Port (9000) & ODBC Server Availability
* **Port Binding:** TCP port 9000 is hosted directly inside the user-space process `tally.exe`.
* **Process Inspection:**
  - `tally.exe` (PID 10304) is the only process listening on `0.0.0.0:9000`.
  - `tallygatewayserver.exe` (port 9999) is a Windows Service for licensing broadcast only (`DESKTOP-70BVNA5:9999`). It does **not** expose accounting data or TDL endpoints.
  - `tallyscheduler.exe` is an internal service for scheduled intra-Tally backups, not an open public data API.
* **When `tally.exe` is closed:**
  - Port 9000 is closed immediately.
  - All HTTP requests to `127.0.0.1:9000` fail with `[WinError 10061] No connection could be made because the target machine actively refused it`.
  - Empirical logs from existing tools (e.g. Magenta BI mSync64) confirm this exact failure signature when Tally is closed:
    ```text
    Connection Error, Tally Was Open , But Port Was Not Available: HTTPConnectionPool(host='localhost', port=9000):
    Max retries exceeded with url: / (Caused by NewConnectionError: [WinError 10061] No connection could be made)
    ```

---

## 4. Critical Defect Discovered in Existing Codebase

During the audit of `app/services/sync/sync_engine.py`, a critical integrity flaw was identified:
```python
# sync_engine.py (Lines 813-818)
async def _safe_tally_request(self, xml_payload: str) -> str:
    """Executes request toward Tally with fallback on mock if Tally is offline."""
    try:
        return await tally_client.execute_request(xml_payload)
    except Exception:
        return "<ENVELOPE><HEADER><STATUS>OFFLINE</STATUS></HEADER><BODY><DATA></DATA></BODY></ENVELOPE>"
```
**Impact of this defect:**
When Tally was closed, `_safe_tally_request` swallowed the connection exception and returned `<STATUS>OFFLINE</STATUS>`. The calling stages parsed 0 masters and 0 vouchers.
In stage `COA`/`VOA`, the engine executed:
```python
await db.execute(delete(BillOutstanding).where(BillOutstanding.companyId == companyId, ...))
```
This **wiped out all existing outstanding receivables and payables from the database**, and subsequently marked the sync status as `SUCCESS` with 0 records!
This directly violated non-negotiable rules:
* Rule 4: "Do not fake successful data fetching."
* Rule 5: "Do not silently serve stale data as current."
* Rule 8: "Do not silently discard accounting records."
* Rule 9: "If data cannot be fetched, explain why instead of displaying misleading success messages."

**Remediation:** `_safe_tally_request` must be replaced by strict error detection that fails the job safely, halts execution before data mutation, preserves all existing records, and records the exact reason (`TallyPrime is closed / offline`).

---

## 5. Distinction Between Operating States

To avoid misleading the user, CFO Yantra must explicitly detect and distinguish four separate states:

| State | Process (`tally.exe`) | HTTP Port 9000 | Company Loaded | Action Supported |
| :--- | :--- | :--- | :--- | :--- |
| **`CONNECTED`** | Running | Active (200 OK) | Yes (`activeCompanies` > 0) | Full / Incremental Sync |
| **`NO_COMPANY_LOADED`** | Running | Active (200 OK) | No | Prompt user to load company / auto-load |
| **`BACKGROUND_RUNNING`**| Running (No UI / Minimized)| Active (200 OK)| Yes | Background Auto-Sync |
| **`SOURCE_OFFLINE`** | Not Running / Refused | Closed (10061) | N/A | Offline Local-First Serving (no sync) |

---

## 6. Recommended Multi-Mode Architecture

### Mode A — Direct Local File Access (Audited & Blocked)
* **Status:** Blocked for native `.900`/`.1800` Tally files due to proprietary binary encoding and corruption hazards.
* **Local Data Serving:** Fully supported for CFO Yantra's own company SQLite databases (`data/companies/{company}/database.sqlite`).

### Mode B — Background Tally Connector & Automated Scheduler
* Implement `BackgroundSyncScheduler` running inside FastAPI lifespan.
* Configurable sync interval (e.g. 15 minutes, company-specific overrides).
* Checks Tally availability. If Tally is running (in UI or background), automatically extracts data via incremental `AlterID` queries without requiring user manual intervention.
* If configured with `TALLY_ALLOW_HEADLESS_SPAWN=true` and an authorized path, can spawn/monitor Tally in the background with `ShowDashboardOnCompanyLoad=No`.

### Mode C — Non-Destructive Offline Local-First Fallback
* When Tally is closed or unreachable:
  1. The scheduler and manual sync halt safely without touching existing company records.
  2. The company database retains 100% of previously synchronized vouchers, ledgers, and outstandings.
  3. The API and Dashboard serve all KPIs, reports, and charts from the local SQLite database.
  4. The UI displays clear freshness indicators (`LOCAL_DATA_AVAILABLE`, `STALE_DATA`, `TALLY_OFFLINE`, `Last Sync: X minutes ago`).
  5. The scheduler enters exponential backoff and automatically resumes when Tally becomes available.

---

## 7. Audit Conclusion & Approval Status

* Closed-Tally data reading directly from `.1800` files is technically unsound and dangerous.
* Automatic synchronization without manual user opening is achieved through:
  1. An independent **Background Sync Scheduler** in CFO Yantra.
  2. Pre-loading companies via `tally.ini` (`Load=100000`) so Tally operates unattended.
  3. Optional background process management for `tally.exe`.
  4. Local-first offline serving from SQLite so the CFO Yantra dashboard never depends on a live Tally connection.
