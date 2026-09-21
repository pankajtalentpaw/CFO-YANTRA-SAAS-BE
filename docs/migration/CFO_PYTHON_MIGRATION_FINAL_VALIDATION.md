# CFO YANTRA — FINAL TECHNICAL VALIDATION OF PYTHON MIGRATION PLAN
**Document ID:** `CFO-YANTRA-VAL-FINAL-001`  
**Date:** September 19, 2026  
**Lead Auditor & Validator:** Senior Python Backend Architect, Financial Systems & Reliability Engineer  
**Target Repository:** `pankajtalentpaw/CFO-YANTRA-SAAS-BE`  
**Validated Document:** `CFO_YANTRA_PYTHON_MIGRATION_PLAN.md`  
**Output Target:** `CFO_PYTHON_MIGRATION_FINAL_VALIDATION.md`  
**Status:** COMPLETED FINAL VALIDATION (PLANNING ONLY)

---

## 1. Executive Summary

This document presents the **final technical validation** of the proposed Node.js-to-Python migration plan for **CFO Yantra**. Every structural claim, database pattern, mathematical formula, network protocol, and security boundary in `CFO_YANTRA_PYTHON_MIGRATION_PLAN.md` was audited against the active Node.js repository source code, unit test suites, configuration schemas, and live process telemetry.

### Core Verdict
The migration from Node.js (Express 4.21.2) to Python 3.12+ (FastAPI 0.111+ / Pydantic v2 / SQLAlchemy 2.0 Async) is **architecturally viable and strongly recommended**. The existing backend's clean pure function-based modular architecture maps cleanly to FastAPI's dependency injection and functional route handlers.

However, this validation identified **6 critical engineering risks and discrepancies** in the initial migration plan that would cause **financial divergence, process deadlocks, or security leaks** if left uncorrected prior to implementation:

1. **Rounding Terminology & Precision Mismatch (`CRITICAL`):** The previous plan conflated `ROUND_HALF_UP` with "Banker's rounding" (`ROUND_HALF_EVEN`). Python's `decimal` module defaults to `ROUND_HALF_EVEN`. If Python's default rounding is retained, calculations will diverge from the Node.js implementation (`decimal.js`) on `.5` values, causing failures in CV01–CV16 cross-verification checks.
2. **Multi-Worker Duplicate Sync & Database Deadlock (`CRITICAL`):** Running FastAPI under standard multi-worker configurations (e.g., `uvicorn --workers 4`) would cause each worker to instantiate its own auto-sync loop and CDC engine. This would quadruple polling against TallyPrime's single-threaded HTTP port, lock the local SQLite database (`SQLITE_BUSY`), and corrupt AlterID cursors.
3. **Socket.io Multi-Tenant Data Leak in Cloud Mode (`HIGH`):** The current Socket.io implementation (`src/services/realtimeSocket.service.js`) allows unauthenticated connections and permits clients to join any `company:<id>` room without verification. In cloud SaaS mode, this represents an unauthorized multi-tenant data exposure risk.
4. **Tally Single-Threaded HTTP Serialization (`HIGH`):** TallyPrime cannot handle concurrent HTTP requests. The existing Node backend uses a single-socket HTTP agent (`maxSockets: 1`) and an exclusive mutex lock (`breaker.runExclusive`). Python's `httpx.AsyncClient` must implement an equivalent `asyncio.Lock()` to prevent TallyPrime socket queue overflows.
5. **JSON Data Column Property Hoisting (`HIGH`):** Sequelize's `sqlModelCompat.js` implements `unwrapRow()`, which unpacks attributes from the JSON `data` column to the root object. In Python, querying SQLAlchemy models without an equivalent unpacker will return records with missing root properties.
6. **Unmounted Route Inventory Discrepancy (`MEDIUM`):** `experimentsRoutes.js` (11 endpoints) exists in `src/routes/` but is **not mounted** in `src/routes/index.js`. The API inventory must distinguish active production routes from unmounted diagnostic scripts.

---

## 2. Validation Scope and Limitations

### Verified Evidence Sources
* **Application Core:** `src/server.js`, `src/versioning/apiVersion.js`, `src/config/db.js`, `src/config/env.js`.
* **Database Models:** `src/models/` (16 tables: 5 core + 11 dynamic master domains) and `src/models/sqlModelCompat.js`.
* **API Routing & Controllers:** All 8 mounted router modules in `src/routes/` and corresponding controllers in `src/controllers/`.
* **Tally Gateway & Protocols:** `src/integrations/tally/` (`tally.client.js`, `tally.breaker.js`, `tally.readonly.js`, `xml.transport.js`, `json.transport.js`, `tally_webhook.tdl`).
* **Synchronization & CDC:** `src/services/sync/cdcEngine.service.js`, `mirror.service.js`, `deletionDetector.service.js`, `src/jobs/tallySync.job.js`.
* **Decision Intelligence Layer:** `src/analytics/` (3D Cube builder, 18 Lenses, 160 Analysis Blocks, CV01–CV16 engine).
* **Financial Arithmetic:** `src/utils/financialDecimal.js` and test suite `tests/financialDecimal.test.js`.

### Explicit Documentation of Limitations
* **Frontend Source Code Accessibility:** Per system workspace constraints, the user workspace is strictly bound to `c:\Users\admin\Desktop\CFO PROJECT\backend`. Direct filesystem reads to `c:\Users\admin\Desktop\CFO PROJECT\frontend` were blocked by default security policies.
* **Electron Packaging Verification:** Frontend interaction was validated through backend request logs, Zod schema contracts, and active runtime process telemetry (`npm run electron:dev` running in parent directory). Direct inspection of Electron's `main.js` and `preload.js` remains an unverified dependency that must be inspected prior to final desktop binary distribution.

---

## 3. Confirmed Technical Findings

The following technical foundations from the migration plan were validated against active code:

| Component | Verified Fact | Source Evidence |
|---|---|---|
| **Dual-Read Engine** | Masters and vouchers check the local database mirror first. If records exist, data returns in `<15ms`. If missing or bypassed (`?force=1`), it executes live Tally XML extraction and asynchronously updates the mirror. | `src/services/companyData.service.js:153-169`, `src/services/companyData.service.js:191-195` |
| **Read-Only Barrier** | Fails closed. Rejects payloads not starting with `<ENVELOPE` or `<?xml`. Rejects regex patterns for `<importdata`, `<action>create|alter|delete</action>`, `<voucher action="create|alter|delete"`. Enforces `TALLYREQUEST == "export"`. | `src/integrations/tally/tally.readonly.js:10-77` |
| **Circuit Breaker** | Tracks consecutive connection failures. Trips to `OPEN` state after 3 failures. Fast-fails requests for 10 seconds before probing in `HALF_OPEN`. | `src/integrations/tally/tally.breaker.js:15-84` |
| **Single-Socket Agent** | Dedicated Node HTTP agent with `maxSockets: 1, maxFreeSockets: 1, keepAlive: true` to prevent TallyPrime socket exhaustion. | `src/integrations/tally/tally.client.js:11-16` |
| **AlterID CDC Cursors** | Tracks per-company `lastVoucherAlterId` in memory and persists to `sync_states.domains.cdc.lastAlterId`. Queries `$AlterId > currentAlterId`. | `src/services/sync/cdcEngine.service.js:53-87` |
| **TDL Real-Time Hook** | Hooks `Form Accept` and `Form Delete` on `Voucher` forms; executes HTTP POST to `/api/v1/sync/tally-event` with `action`, `guid`, `voucherNumber`. | `src/integrations/tally/tally_webhook.tdl:10-25` |
| **Process Guards** | Catches `unhandledRejection` and `uncaughtException` to prevent single bad Tally responses from crashing the server. Traps `ELECTRON_RUN_AS_NODE===1` and exits on IPC disconnect. | `src/server.js:82-98` |

---

## 4. Detailed Validation Tasks & Analysis

### Task 1: Financial Precision & Rounding Discrepancy Analysis

#### Findings & Evidence
In `src/utils/financialDecimal.js`:
```javascript
const Decimal = require("decimal.js");
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9,
  toExpPos: 28
});
```
In `tests/financialDecimal.test.js`:
```javascript
test("rounds to specified decimal places with HALF_UP", () => {
  expect(formatFinancial(round("123.456", 2), 2)).toBe("123.46");
  expect(formatFinancial(round("123.454", 2), 2)).toBe("123.45");
  expect(formatFinancial(round("123.455", 2), 2)).toBe("123.46");
});
```

#### The Conflict
The previous migration plan stated: *"Banker's rounding (`ROUND_HALF_UP`)"*. This is a **technical contradiction**:
* **Banker's Rounding** is mathematically defined as **Round Half to Even** (`ROUND_HALF_EVEN`). Under Banker's rounding, `123.445` rounds to `123.44` (nearest even), while `123.455` rounds to `123.46`.
* **Round Half Up** (`ROUND_HALF_UP`) is standard symmetric arithmetic rounding. Under Half-Up, `123.445` rounds to `123.45`, and `123.455` rounds to `123.46`.
* **Python's Default:** In Python, `decimal.getcontext().rounding` defaults to `ROUND_HALF_EVEN` (Banker's Rounding).

#### Impact & Required Plan Correction
If Python uses its default rounding context, calculations involving `.005` amounts (e.g., GST multi-item tax splits, average rate divisions, waterfall attribution shares) will diverge by 1 paisa / 0.01 units from the Node.js baseline. This will break CV09–CV11 share sum validations ($100.00\%$) and CV12–CV14 waterfall bridge conservation.

**Mandatory Python Implementation:**
```python
import decimal

# Explicit global configuration
FINANCIAL_CONTEXT = decimal.Context(
    prec=28,
    rounding=decimal.ROUND_HALF_UP,
    Emin=-999999,
    Emax=999999
)
decimal.setcontext(FINANCIAL_CONTEXT)

def round_financial(val: decimal.Decimal, places: int = 2) -> decimal.Decimal:
    q = decimal.Decimal("10") ** -places
    return val.quantize(q, rounding=decimal.ROUND_HALF_UP)
```

---

### Task 2: Background Jobs & Multi-Worker Concurrency Safety

#### Findings & Evidence
In `src/server.js:126-131`:
```javascript
connectDatabase().then(async () => {
  await initTallyConfig();
  tallySyncJob.start();
  startCdcEngine();
});
```
In `src/jobs/tallySync.job.js:83`:
```javascript
timer = setInterval(tick, env.sync.intervalMs);
```
In `src/services/sync/cdcEngine.service.js:294`:
```javascript
cdcTimer = setInterval(cdcTick, intervalMs);
```

#### The Problem with Multi-Worker Deployments
If FastAPI is deployed in a standard multi-worker configuration (e.g., `uvicorn main:app --workers 4` or Gunicorn Uvicorn workers):
1. **Lifespan Duplication:** Every worker process executes the FastAPI `lifespan` startup handler.
2. **Concurrent Tally Polling:** 4 independent worker processes will execute `tallySyncJob` and `cdcEngine`. TallyPrime (`:9000`) will receive 4 concurrent requests every 30 seconds. Because Tally is single-threaded, requests will queue, timeout, and trigger circuit breaker trips.
3. **SQLite Lock Contention:** SQLite does not support concurrent write transactions from multiple operating system processes. 4 workers attempting simultaneous upserts will trigger `sqlite3.OperationalError: database is locked`.
4. **CDC Cursor Desynchronization:** Workers 1 and 2 will read the same `lastAlterId`, fetch duplicate vouchers, and emit duplicate Socket.io events.

#### Required Single-Owner Architecture

```mermaid
graph TD
    subgraph Deployment Topologies
        subgraph Desktop / Electron Environment
            Proc1[FastAPI Process --workers 1]
            Proc1 --> Sync1[Background Sync & CDC Active]
            Proc1 --> DB1[(SQLite Mirror)]
        end

        subgraph Cloud SaaS Multi-Worker Environment
            LB[Load Balancer / Ingress]
            W1[FastAPI Worker 1 - API Only]
            W2[FastAPI Worker 2 - API Only]
            W3[FastAPI Worker 3 - API Only]
            SyncWorker[Dedicated Scheduler / Sync Worker]
            
            LB --> W1
            LB --> W2
            LB --> W3
            SyncWorker -->|Exclusive Sync Loop| CloudDB[(PostgreSQL)]
            W1 --> CloudDB
            W2 --> CloudDB
            W3 --> CloudDB
        end
    end
```

**Mandatory Rules:**
* **Desktop Mode (Electron):** Must strictly run with a **single worker process** (`workers=1`).
* **Cloud SaaS Mode:** Background jobs must **not** run inside general web API workers. An environment variable `ENABLE_BACKGROUND_JOBS=true` must be set exclusively on a single worker instance, or workers must acquire an election lock via PostgreSQL advisory locks (`pg_try_advisory_lock(0xCF0_SYNC)`).
* **Shadow Replay Testing Safety:** During shadow testing (where Node and Python run side-by-side on ports 5000 and 5001), Python must run with `SYNC_ENABLED=false` to prevent concurrent writes to `cfo_yantra.sqlite`.

---

### Task 3: Socket.io Protocol & Multi-Tenant Security

#### Findings & Evidence
In `src/services/realtimeSocket.service.js:10-37`:
```javascript
io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
io.on("connection", (socket) => {
  socket.on("subscribe:company", (companyId) => {
    if (companyId) socket.join(`company:${companyId}`);
  });
});
```

#### Security Gap Identification
1. **Unauthenticated WebSocket Handshake:** The existing Socket.io server performs no handshake authentication. Any client on the network can establish a WebSocket connection.
2. **Unauthorized Room Subscriptions:** Any connected client can emit `socket.emit("subscribe:company", "target_company_id")`. The server joins the socket without verifying if the user has authorization for that tenant.
3. **Data Leak Risk:** When vouchers are synced or altered, `emitVoucherInserted()` broadcasts the full voucher payload to `company:${companyId}`. In cloud SaaS mode, any authenticated or unauthenticated user could eavesdrop on real-time sales transactions of competitor companies.

#### Required Security Controls for Python Migration
1. **Handshake Authentication:**
   ```python
   @sio.event
   async def connect(sid, environ, auth):
       token = auth.get("token") if auth else None
       if not token and "HTTP_AUTHORIZATION" in environ:
           token = environ["HTTP_AUTHORIZATION"].replace("Bearer ", "")
       
       user = verify_session_token(token)
       if not user and APP_MODE != "desktop":
           raise ConnectionRefusedError("Authentication failed")
       
       await sio.save_session(sid, {"user": user or {"id": "cfo-admin", "role": "Owner"}})
   ```
2. **Room Subscription Authorization:**
   ```python
   @sio.event
   async def subscribe_company(sid, company_id):
       session = await sio.get_session(sid)
       user = session.get("user")
       if not user_has_company_access(user, company_id):
           await sio.emit("error", {"message": "Unauthorized company subscription"}, to=sid)
           return
       await sio.enter_room(sid, f"company:{company_id}")
   ```
3. **CORS Hardening:** Restrict CORS in production from `*` to configured frontend origins (or Electron protocol `file://`).

---

### Task 4: Frontend and Electron Compatibility — Verified vs. Inferred

To avoid assumptions, we categorize frontend contracts into verified vs. inferred:

| Compatibility Area | Classification | Evidence / Source | Implementation Requirement |
|---|---|---|---|
| **Base API Route Prefix** | **VERIFIED** | `src/server.js:20`, `src/versioning/apiVersion.js:148` | All endpoints mounted strictly at `/api/v1/`. |
| **Response Envelope (`ListEnvelope`)** | **VERIFIED** | `src/controllers/companiesController.js:69-80` | `{ success: true, companyId, available, source, items, pagination, warning }`. |
| **Error Envelope (`ErrorPayload`)** | **VERIFIED** | `src/constants/statusCodes.js:235-247` | `{ success: false, statusCode, errorCode, error, details, userAction, timestamp }`. |
| **Date Query Parameter Format** | **VERIFIED** | `src/validations/common.validation.js:8-11` | YYYYMMDD 8-digit string regex (`^\d{8}$`). |
| **JSON Property Casing** | **VERIFIED** | `src/controllers/companiesController.js`, `models/` | `camelCase` keys across all returned objects. |
| **Socket.io Event Names** | **VERIFIED** | `src/services/realtimeSocket.service.js:55-114` | `voucher:sync`, `tally:voucher:inserted`, `tally:voucher:updated`, `tally:voucher:deleted`, `sync:status`. |
| **Electron Process Spawner** | **INFERRED** | `src/server.js:83` (`ELECTRON_RUN_AS_NODE===1`) | Must inspect Electron `main.js` to confirm launch arguments, IPC pipes, and stdout triggers. |
| **Frontend Axios Interceptors** | **INFERRED** | Backend test responses | Must verify if React UI checks `res.data.success === true` or throws on HTTP error status. |

---

### Task 5: API Inventory & Database Parity Verification

#### Route Discrepancy Found
* In `src/routes/experimentsRoutes.js`, 11 routes are defined (`GET /api/v1/experiments/`, `GET /api/v1/experiments/01` to `10`).
* **Inspection Result:** `src/routes/index.js` **does not mount** `experimentsRoutes`.
* **Resolution:** These endpoints are internal research scripts. They should be ported to Python as diagnostic utilities but excluded from the core production router.

#### Route Shadowing Risk in FastAPI
In `src/routes/companiesRoutes.js`:
* Line 7: `router.get("/:companyId", c.getCompany);`
* Line 38: `router.get("/reports/report5/analytics/catalog", c.getReport5AnalyticsIndex);`
* Line 39: `router.get("/:companyId/reports/report5/analytics/catalog", c.getReport5AnalyticsIndex);`

In Express, route resolution occurs in registration order. If line 7 matches first, a call to `/companies/reports/report5/analytics/catalog` could bind `:companyId = "reports"`.
In FastAPI, static sub-paths must be declared **before** parameterized paths:
```python
# CORRECT DECLARATION ORDER IN FASTAPI
@router.get("/reports/report5/analytics/catalog")  # Static route MUST come first
async def get_global_catalog(): ...

@router.get("/{company_id}")                       # Parameterized route comes after
async def get_company(company_id: str): ...
```

#### Database Schema & Model Parity
Inspection of all models in `src/models/` confirms:
1. `companies` (PK: `companyId` VARCHAR)
2. `vouchers` (PK: `id` INTEGER AUTO)
3. `sync_states` (PK: `companyId` VARCHAR)
4. `system_settings` (PK: `key` VARCHAR)
5. `users` (PK: `id` INTEGER AUTO, UK: `mobile`)
6. **11 Dynamic Master Domain Tables:** `ledgers`, `groups`, `stock_items`, `stock_groups`, `stock_categories`, `units`, `godowns`, `cost_centres`, `cost_categories`, `voucher_types`, `currencies`.

**JSON Column Hoisting Requirement:**
Sequelize models use `attachCompat()` (`sqlModelCompat.js`), which unpacks `row.data` into root attributes.
In Python:
```python
def unwrap_row(obj):
    if not obj:
        return None
    data_dict = obj.data if isinstance(obj.data, dict) else (json.loads(obj.data) if obj.data else {})
    res = {**data_dict, **{k: v for k, v in obj.__dict__.items() if not k.startswith("_") and k != "data"}}
    if "isDeleted" in res: res["isDeleted"] = bool(res["isDeleted"])
    if "isOpen" in res: res["isOpen"] = bool(res["isOpen"])
    return res
```

---

### Task 6: TallyPrime Safety & Serial Execution

#### Read-Only Policy Analysis
`src/integrations/tally/tally.readonly.js` is thoroughly designed:
1. Rejects any payload containing: `<importdata`, `<svimportformat`, `<action>create|alter|delete</action>`, `<voucher action="create|alter|delete"`.
2. Parses XML and enforces that `<ENVELOPE><HEADER><TALLYREQUEST>` equals `"export"`.

#### Unaddressed Vulnerability in Existing Code
In `src/integrations/tally/transports/json.transport.js`:
* `sendJsonRequest()` dispatches HTTP POST payloads to TallyPrime's port 9000.
* **Finding:** `sendJsonRequest()` **does not call `validateReadOnlyXml()`** or inspect JSON request bodies for mutation verbs!
* **Python Correction:** Python's outbound gateway must inspect all outgoing requests—both XML and JSON payloads—through an integrated read-only filter before sending over the wire.

#### Serial Execution Lock
In `src/integrations/tally/tally.client.js`:
* Node uses `breaker.runExclusive(async () => { ... })` and a single-socket HTTP agent (`maxSockets: 1`).
* **Python Implementation Requirement:**
  ```python
  tally_lock = asyncio.Lock()

  async def send_exclusive_tally_request(payload: str, is_xml: bool = True):
      async with tally_lock:
          return await client.post(url, content=payload, headers=headers)
  ```

---

### Task 7: Testing Strategy & Quantitative Acceptance Gates

The existing Jest test harness contains **35 test suites and 1,105 test cases**. To guarantee parity, these must be ported to Pytest across 5 measurable tiers:

| Tier | Test Scope | Target Test Cases | Measurable Acceptance Criteria |
|---|---|---|---|
| **Tier 1** | Financial Arithmetic & Decimal Precision | ~60 tests | Zero difference to 28 decimal places against `tests/financialDecimal.test.js`. Exact match on Banker's vs Half-Up edge cases (`123.455 -> 123.46`, `123.445 -> 123.45`). |
| **Tier 2** | Canonical Master & Voucher Normalizers | ~280 tests | Parse recorded XML/JSON responses; assert 100% field equality against Jest snapshots. |
| **Tier 3** | 3D Analytics Cube & 18 Lenses (160 Blocks) | ~450 tests | Execute all 160 Analysis Blocks on `WORKBOOK_FACTS`. JSON diff between Node and Python outputs must be identical across all fields. |
| **Tier 4** | Cross-Verification Rules (CV01–CV16) | ~120 tests | 100% pass rate on mathematical trial balance conservation and waterfall attribution rules. |
| **Tier 5** | REST API & WebSocket Contracts | ~195 tests | Replay 52 endpoints against mock Tally; assert identical status codes, headers, and envelope structures. |

---

### Task 8: Production Deployment, Lifecycles & Rollback

#### Desktop Electron Packaging
* **Process Model:** Python executable compiled via PyInstaller (`cfo-backend.exe`).
* **IPC Lifecycle:**
  ```python
  import sys, os, signal

  def install_process_guards():
      if os.environ.get("ELECTRON_RUN_AS_NODE") == "1":
          # On Windows, monitor stdin EOF or parent process termination
          pass
  ```
* **Port Conflict Handling:** Must catch `socket.error` with `errno.EADDRINUSE` (WinError 10048) on port 5000 and print clear user guidance.

#### Zero-Downtime Instant Rollback
Because the migration enforces the **Zero DDL Modification Rule**:
1. If the Python backend encounters an unexpected production fault, the Electron main process can immediately switch its child process target back to `node src/server.js`.
2. The SQLite database remains 100% structurally valid and readable by Sequelize, enabling instant rollback without data loss.

---

## 5. Summary of Discovered Contradictions & Missing Requirements

```text
+---------------------------------------------------------------------------------------------------------+
| Discovered Issues in Previous Migration Plan                                                            |
+-------------------+--------------------+----------------------------------------------------------------+
| Issue Category    | Severity           | Technical Detail & Resolution                                  |
+-------------------+--------------------+----------------------------------------------------------------+
| Financial Math    | CRITICAL           | Plan conflated ROUND_HALF_UP with Banker's rounding. Must      |
|                   |                    | explicitly set decimal.ROUND_HALF_UP in Python.                |
| Multi-Worker Sync | CRITICAL           | Multi-worker FastAPI would quadruple Tally polling and lock DB. |
|                   |                    | Enforce workers=1 (Desktop) or dedicated Sync Worker (Cloud).  |
| WebSocket Security| HIGH               | Socket.io has no auth or company room access checks.           |
|                   |                    | Must add token validation and tenant authorization in Python.  |
| Tally Gateway     | HIGH               | Tally requires serial requests. Must port single-socket lock.  |
| Route Shadowing   | MEDIUM             | /reports/... shadowed by /:companyId in FastAPI if not ordered.|
| JSON ReadOnly     | MEDIUM             | Existing JSON transport skipped read-only validation. Fix it.  |
| Unmounted Routes  | LOW                | experimentsRoutes.js is unmounted in index.js. Exclude it.     |
+-------------------+--------------------+----------------------------------------------------------------+
```

---

## 6. Security and Reliability Risk Register

| Finding ID | Severity | Source File | Risk Description | Required Control in Python | Status |
|---|---|---|---|---|---|
| **SEC-01** | `HIGH` | `src/services/realtimeSocket.service.js` | Unauthenticated WebSocket connection allows arbitrary tenant eavesdropping in cloud mode. | Implement connection handshake JWT auth and room subscription permission checks. | **Verified Risk** |
| **SEC-02** | `MEDIUM` | `src/integrations/tally/transports/json.transport.js` | JSON transport did not validate read-only status before dispatching to Tally. | Wrap all HTTP requests (XML and JSON) through unified read-only safety guard. | **Verified Risk** |
| **REL-01** | `CRITICAL` | `src/server.js`, `src/jobs/tallySync.job.js` | Multiple FastAPI workers running auto-sync and CDC simultaneously against Tally and SQLite. | Enforce single-worker execution on desktop; leader election on cloud. | **Verified Risk** |
| **REL-02** | `HIGH` | `src/integrations/tally/tally.client.js` | Concurrent requests freeze Tally's single-threaded runtime. | Enforce `asyncio.Lock()` serial queue on loopback HTTP requests. | **Verified Risk** |
| **ACC-01** | `CRITICAL` | `src/utils/financialDecimal.js` | Divergence between `ROUND_HALF_UP` and Python's default `ROUND_HALF_EVEN`. | Set `decimal.getcontext().rounding = decimal.ROUND_HALF_UP`. | **Verified Risk** |
| **ACC-02** | `HIGH` | `src/models/sqlModelCompat.js` | Missing `data` JSON column hoisting in SQLAlchemy queries. | Implement `unwrap_row()` deserializer in Python base model. | **Verified Risk** |

---

## 7. Implementation Blockers

The following items must be acknowledged or resolved before executing Phase 1 code generation:

1. **Frontend / Electron Source Inspection Access (`BLOCKER`):** Direct inspection of `c:\Users\admin\Desktop\CFO PROJECT\frontend\src\main` (Electron main process) is required to verify the exact command-line arguments, environment flags, and stdout patterns used by Electron to spawn the backend process.
2. **Desktop Distribution Packaging Choice (`DECISION`):** Confirm whether the Python backend will be distributed as:
   * **Option A (Recommended):** A single standalone directory (`cfo-backend/`) compiled via PyInstaller (faster application startup).
   * **Option B:** A single-file executable (`cfo-backend.exe`) (simpler packaging, slower startup due to temp extraction).
3. **Shadow Test Isolation Protocol (`PROCESS`):** Agreement that during Phase 5 parity testing on developer machines, the Node.js backend background sync will be stopped when the Python backend sync is tested to prevent database contention.

---

## 8. Final Go / No-Go Readiness Checklist

| Category | Readiness Criterion | Status |
|---|---|---|
| **Architecture** | Target stack (FastAPI + Pydantic v2 + SQLAlchemy 2.0 Async) fully evaluated and validated against pure function requirements. | **GO** |
| **Financial Accuracy**| Rounding discrepancy resolved (`ROUND_HALF_UP` explicitly specified; Banker's rounding conflation corrected). | **GO** |
| **Database Parity** | All 16 tables mapped; hybrid JSON envelope hoisting specified; zero-migration strategy confirmed. | **GO** |
| **API Surface** | All 52 mounted endpoints inventoried; route declaration ordering verified to prevent shadowing. | **GO** |
| **Tally Safety** | Read-only XML/JSON gate and serial execution locks specified to protect TallyPrime single-threaded runtime. | **GO** |
| **Concurrency** | Single-worker enforcement for desktop and leader-election lock for cloud specified. | **GO** |
| **Security** | Handshake auth and room subscription authorization designed for Socket.io. | **GO** |
| **Electron Integration** | Desktop process lifecycle and port conflict handling defined (pending Electron main.js file access). | **CONDITIONAL GO** |
| **Testing** | 5-tier testing framework matching all 1,105 Jest tests with quantitative acceptance gates defined. | **GO** |

---

## 9. Final Conclusion & Recommendation

The Node.js-to-Python migration plan is **technically sound, comprehensive, and ready for execution planning**. The architectural discrepancies and concurrency risks identified in this validation have been fully analyzed and resolved with concrete Python engineering specifications.

No application source code, configuration, dependencies, or database records were modified during this validation.
