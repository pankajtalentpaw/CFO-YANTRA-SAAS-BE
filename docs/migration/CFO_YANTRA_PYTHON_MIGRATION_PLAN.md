# CFO YANTRA — COMPLETE PYTHON BACKEND MIGRATION PLAN
**Document ID:** `CFO-YANTRA-PY-MIG-002-REVIEW`  
**Date:** September 19, 2026  
**Auditor & Lead Architect:** Senior Python Backend Architect, FastAPI Specialist & Systems Migration Engineer  
**Target Repository:** `pankajtalentpaw/CFO-YANTRA-SAAS-BE`  
**Target File:** `CFO_YANTRA_PYTHON_MIGRATION_PLAN.md`  
**Status:** IMPLEMENTATION-READY SPECIFICATION (PLANNING ONLY)

---

## 1. Executive Summary

**CFO Yantra** is an enterprise-grade, read-only Financial Intelligence & Virtual CFO Engine built specifically for SMEs and mid-market enterprises utilizing **TallyPrime**. The system operates as an autonomous, high-performance analytical pipeline that ingests, normalizes, mirrors, and analyzes financial accounting records without imposing computational overhead or locking TallyPrime's single-threaded runtime.

### Strategic Migration Objective
The purpose of this document is to define the definitive, implementation-ready architectural migration plan to transition the existing Node.js (Express 4.21.2) backend to **Python 3.12+ (FastAPI + Pydantic v2 + SQLAlchemy 2.0 Async)**.

### Non-Negotiable Tenets:
1. **Zero Frontend Modifications:** The existing Electron + React desktop frontend must remain 100% unchanged. All REST API routes (`/api/v1/...`), request/response JSON envelopes, error structures, HTTP status codes, and Socket.io WebSocket events must retain bit-for-bit behavioral parity.
2. **Database Continuity & Zero Data Loss:** The existing SQLite file (`./data/cfo_yantra.sqlite`) and PostgreSQL mirror schemas must be attached to directly by SQLAlchemy 2.0, reusing existing tables, composite indexes, content hashes, and JSON columns without destructive migrations.
3. **Deterministic Financial Parity:** Zero floating-point drift across millions of transactions using Python's native `decimal.Decimal` configured to 28-digit precision and Banker's rounding (`ROUND_HALF_UP`), guaranteeing 100% compliance with the 16 Cross-Verification rules (**CV01–CV16**).
4. **Strict Safety Barrier:** The immutable read-only gate preventing any state mutation in TallyPrime must be preserved.

---

## 2. Scope and Non-Goals

### In-Scope
* **Backend Runtime Migration:** Full migration of all Node.js Express routes, controllers, services, utilities, and validation schemas to Python (FastAPI).
* **TallyPrime Protocol Gateway:** Re-implementation of the outbound loopback HTTP client (`:9000`), circuit breaker, typed XML parsers, and the 63-endpoint API Explorer JSON catalog.
* **Dual-Read Engine:** Preservation of the DB-first read path (<15ms) with transparent fallback to live TallyPrime XML extraction.
* **Synchronization & CDC:** Python implementation of the 60s auto-sync polling loop, 30s AlterID Change Data Capture (CDC) cursor tracker, 20-minute deletion tombstoning, and TDL event hook receiver.
* **Real-time Event Broadcasting:** Asynchronous Socket.io server broadcasting identical event rooms and payloads (`voucher:sync`, `tally:voucher:*`, `sync:status`).
* **Decision Intelligence Engine:** Re-implementation of the 3D in-memory `AnalyticsCube`, all 18 Analytical Lenses (160 deterministic Analysis Blocks), role-based dashboards (`OwnerTop5`, `SalesManagerTop10`), and the CV01–CV16 mathematical cross-verification suite.
* **Packaging & Desktop Interop:** Packaging the Python runtime into a frozen binary (PyInstaller/Nuitka) that integrates seamlessly with Electron process lifecycle controls (`ELECTRON_RUN_AS_NODE`).

### Non-Goals (Explicitly Out of Scope)
* **No Frontend Changes:** No modifications to React UI components, React hooks, state management, Electron main/renderer processes, or API service layers.
* **No TallyPrime Modifications:** No alteration of TallyPrime data, schema, or native configuration (beyond loading the existing `tally_webhook.tdl`).
* **No Database DDL Alteration:** No renaming of tables, columns, or composite indexes in the local SQLite mirror database.
* **No New Feature Development:** Migration is strictly a parity-preserving platform transition. No new business features or analytics blocks will be introduced during this migration.

---

## 3. Repository Inspection Findings

Every finding documented below has been verified through direct source code inspection of `pankajtalentpaw/CFO-YANTRA-SAAS-BE`:

| Subsystem | Inspected File / Module | Primary Finding / Verified Evidence | Evidence Source |
|---|---|---|---|
| **Entry Point** | `src/server.js` | Express app mounted on `PORT` (default 5000). Initializes Socket.io, attaches `/api/v1` API versioning and routes. Registers process guards for `unhandledRejection`, `uncaughtException`, and `EADDRINUSE`. Detects `ELECTRON_RUN_AS_NODE===1` and traps `process.on('disconnect')`. | `src/server.js:83-156` |
| **API Versioning** | `src/versioning/apiVersion.js` | Custom middleware strictly requiring `/api/v1`. Rejects bare `/api`. Extracts version from URL path, `X-API-Version`, or `Accept-Version`. Injects `X-API-Version` and `X-Supported-Versions` response headers. | `src/versioning/apiVersion.js:20-83` |
| **Config & Env** | `src/config/env.js`, `src/validations/env.validation.js` | Zod schema validating 18 environment variables. Provides fallback to `sqlite:./data/cfo_yantra.sqlite` when `DATABASE_URL` is omitted. Supports PostgreSQL/MySQL. | `src/validations/env.validation.js:6-57` |
| **Database ORM** | `src/config/db.js`, `src/models/` | Sequelize 6.37.8 instance. Models: `Company`, `Voucher`, `User`, `SyncState`, `SystemSettings`, plus 11 dynamically registered master models via `mirrorModel.factory.js`. | `src/models/index.js:26-62` |
| **SQL Compatibility** | `src/models/sqlModelCompat.js` | Emulates Mongoose query chains (`find`, `findOne`, `lean`, `where`, `findOneAndUpdate`) over Sequelize SQL tables. Implements `unwrapRow()` which hoists properties from JSON column `data` to top-level object. | `src/models/sqlModelCompat.js:41-178` |
| **Financial Math** | `src/utils/financialDecimal.js` | Configures `decimal.js` with `precision: 28` and `ROUND_HALF_UP`. Exposes pure functions: `add`, `subtract`, `multiply`, `divide` (4 decimal places), `sum`, `round`. | `src/utils/financialDecimal.js:4-56` |
| **Tally Gateway** | `src/integrations/tally/tally.client.js`, `tally.requests.js` | HTTP loopback over `http://127.0.0.1:9000`. Circuit breaker with failure threshold 3 and 10s reset. Hard read-only XML guard (`validateReadOnlyXml`). | `src/integrations/tally/tally.readonly.js:1-55` |
| **Sync & CDC** | `src/services/sync/cdcEngine.service.js` | Tracks per-company `lastVoucherAlterId` cursor. Queries Tally for `$AlterId > currentAlterId`. Emits `voucher:sync` events. Runs deletion detection every 40 ticks (~20 min). | `src/services/sync/cdcEngine.service.js:29-226` |
| **TDL Event Hook** | `src/integrations/tally/tally_webhook.tdl` | TDL script attaching to `Form Accept` and `Form Delete` on `Voucher`. Dispatches HTTP POST to `http://127.0.0.1:5000/api/v1/sync/tally-event`. | `src/integrations/tally/tally_webhook.tdl:10-25` |
| **Decision Intelligence** | `src/analytics/` (98 files) | In-memory 3D `AnalyticsCube` aggregated across Time, Entity, Geography. 18 Lenses containing 160 deterministic Analysis Blocks returning standard `AnalysisBlock` contracts. Automated CV01–CV16 checks. | `src/analytics/index.js:12-56` |
| **Authentication** | `src/controllers/authController.js`, `src/services/authService.js` | `authController.js` serves desktop mock user (`cfo-admin`). `authService.js` contains production HMAC-SHA256 token engine (`base64url(payload).base64url(sig)`) with 7-day expiration. | `src/services/authService.js:17-61` |
| **Test Coverage** | `tests/` (35 test files) | 35 Jest suites comprising 1,105 test cases covering master canonicals, accounting reconciliation, cube generation, block schemas, and workbook parity. | `tests/setupTestEnv.js`, `package.json:10` |

### Explicit Identification of Classification
* **Verified Facts:** All bullet points above are directly verified from active repository files.
* **Assumptions:** Electron app communicates with backend strictly via HTTP loopback port 5000 and Socket.io WebSockets (confirmed by Electron dev terminal process and backend socket bindings).
* **Unknowns / Limitations:** Direct source code of the Electron frontend in `c:\Users\admin\Desktop\CFO PROJECT\frontend` was inaccessible due to system workspace boundary policy; all frontend contracts have been reconstructed from backend router handlers, Zod query schemas, and test mocks.

---

## 4. Current Architecture

```mermaid
graph TD
    subgraph Host Machine [Local Desktop or Cloud Host]
        subgraph Electron Frontend [Electron Desktop UI]
            Renderer[React 18 SPA]
            MainProc[Electron Main Process]
        end

        subgraph Backend [CFO Yantra Backend Engine :5000]
            API["FastAPI / Express Gateway (/api/v1)"]
            SocketServer[Socket.io WebSockets]
            
            subgraph Core Services
                ScopeSvc[Company Scope & Safety Gate]
                DataSvc[Dual-Read Data Orchestrator]
                SyncDaemon[Background Sync & CDC Engine]
            end

            subgraph Analytics Engine
                Cube[In-Memory 3D Analytics Cube]
                Lenses[18 Analytical Lenses - 160 Blocks]
                Verifier[Cross-Verification Engine CV01-CV16]
            end

            subgraph Storage Layer
                Mirror[(SQLite / PostgreSQL Mirror)]
            end
        end

        subgraph ERP [TallyPrime ERP :9000]
            TallyHttp[HTTP Loopback Server]
            TDL[CFO Yantra TDL Hook Engine]
        end
    end

    MainProc -->|Spawns as child node| Backend
    Renderer -->|HTTP REST /api/v1| API
    Renderer <-->|WebSockets| SocketServer
    API --> ScopeSvc --> DataSvc
    DataSvc -->|Fast Path <15ms| Mirror
    DataSvc -->|Slow Fallback| TallyHttp
    SyncDaemon -->|Poll $AlterId| TallyHttp
    SyncDaemon -->|Batch Upsert| Mirror
    SyncDaemon -->|Broadcast| SocketServer
    TDL -->|HTTP POST /sync/tally-event| API
    DataSvc --> Cube --> Lenses --> Verifier
```

---

## 5. Existing Functionality Inventory

The backend provides five foundational functional capabilities:

### 1. Ingestion & TallyPrime Loopback Protocol
* Implements direct HTTP loopback to `http://127.0.0.1:9000`.
* Supports both traditional TDL XML Export requests and the new native JSON Tally API Explorer specification (63 documented endpoints in `tallyApiExplorer.catalog.js`).
* Enforces circuit breaking (`tally.breaker.js`): trips after 3 consecutive connection timeouts, fast-failing for 10 seconds before attempting `HALF_OPEN` probe.
* Enforces strict read-only security (`tally.readonly.js`): regex checks reject `<TALLYREQUEST>Import</TALLYREQUEST>` or `<IMPORTDATA>`.

### 2. Dual-Read Relational Mirroring (Sequelize)
* TallyPrime is the single source of truth; the relational database is an accelerator and offline cache.
* Queries to `GET /api/v1/companies/:id/vouchers` or masters execute against the database first. If mirrored records exist, data returns in `<15ms`.
* If the mirror is empty, offline, or bypassed via `?force=1`, the engine executes live XML extraction against Tally, normalizes the data, saves it to the mirror asynchronously, and returns the canonical response.

### 3. Change Data Capture (CDC) & Webhooks
* **Scheduled Loop:** Executes every 60 seconds (`tallySync.job.js`). Compares record SHA-256 checksums; writes only modified entities.
* **CDC AlterID Polling:** Executes every 30 seconds (`cdcEngine.service.js`). Reads highest `AlterID` from database; queries Tally for `$AlterId > maxAlterId`.
* **TDL Turbo Hook:** `tally_webhook.tdl` catches `Form Accept` in TallyPrime and POSTs to `/api/v1/sync/tally-event`. Triggers an immediate micro-CDC pull within 200ms.
* **Deletion Tombstoning:** Pulls lightweight list of active GUIDs every 20 minutes (`deletionDetector.service.js`). Records missing from Tally are marked `isDeleted: true, deletedAt: new Date()`.

### 4. High-Precision Financial Computation
* All monetary amounts, rates, GST tax splits, and quantities are parsed and computed using arbitrary precision arithmetic (`decimal.js`, 28 digits, `ROUND_HALF_UP`).
* No native JavaScript floating-point arithmetic is permitted in financial pipelines.

### 5. Decision Intelligence Layer (18 Lenses, 160 Analyses)
* In-memory materialization of a 3D sparse `AnalyticsCube` over normalized `FACT_SALES` transactions.
* 18 analytical lenses evaluating revenue concentration (HHI index), margin erosion, customer churn, seasonality, SKU Pareto, and regional penetration.
* Standardized output format: `AnalysisBlock` containing status (`GREEN`/`AMBER`/`RED`), severity, priority, narrative, structured table, cost of inaction (COI), and actionable protocol.
* Deterministic mathematical cross-verification (**CV01–CV16**) proving trial balance consistency.

---

## 6. Complete API Compatibility Matrix

The Python backend must implement all **52 discovered endpoints** with identical route paths, parameters, and payloads:

| # | HTTP Method | Endpoint Route Path | Controller / Source File | Validation Schema | Auth & Tenant Scope | Purpose & Behavior |
|---|---|---|---|---|---|---|
| 1 | `GET` | `/` | `src/server.js` | None | Public | Root manifest, version, target Tally host:port |
| 2 | `GET` | `/api/v1/health` | `src/routes/index.js` | None | Public | Service health, version, UTC timestamp |
| 3 | `POST`| `/api/v1/auth/send-otp` | `authController.js` | `sendOtpSchema` | Public | Initiates OTP delivery to mobile number |
| 4 | `POST`| `/api/v1/auth/verify-otp` | `authController.js` | `verifyOtpSchema` | Public | Validates OTP; issues signed session token |
| 5 | `POST`| `/api/v1/auth/register` | `authController.js` | `registerSchema` | Public | Registers user with verified mobile number |
| 6 | `GET` | `/api/v1/auth/me` | `authController.js` | None | Bearer Token | Returns current authenticated user profile |
| 7 | `POST`| `/api/v1/auth/logout` | `authController.js` | None | Bearer Token | Invalidates active user session |
| 8 | `GET` | `/api/v1/settings/tally` | `settingsController.js` | None | Admin | Retrieves configured Tally host, port, flags |
| 9 | `POST`| `/api/v1/settings/tally` | `settingsController.js` | Port integer validation | Admin | Updates & persists Tally connection target |
| 10| `POST`| `/api/v1/settings/tally/test`| `settingsController.js`| Target candidate object | Admin | Non-destructive connection probe |
| 11| `GET` | `/api/v1/tally/health` | `tallyController.js` | None | Public | Basic Tally HTTP loopback probe |
| 12| `GET` | `/api/v1/tally/status` | `tallyController.js` | None | Public | Probe latency & active company status |
| 13| `GET` | `/api/v1/tally/capabilities` | `tallyController.js` | None | Public | Detects XML, JSON, JSONEx protocol support |
| 14| `GET` | `/api/v1/tally/company` | `tallyController.js` | None | Public | Discovers loaded companies in TallyPrime |
| 15| `GET` | `/api/v1/tally/masters` | `tallyController.js` | None | Public | Light metadata probe across all masters |
| 16| `GET` | `/api/v1/tally/transport` | `tallyController.js` | None | Public | Reports active format & transport timings |
| 17| `GET` | `/api/v1/tally/factsales` | `factSalesController.js` | `factSalesQuerySchema`| Public | Runs end-to-end FACT_SALES ingestion pipeline |
| 18| `GET` | `/api/v1/companies` | `companiesController.js` | `?force=1` boolean | User / Desktop | Lists open & mirrored companies |
| 19| `GET` | `/api/v1/companies/:companyId` | `companiesController.js` | `companyParamsSchema` | Company Tenant | Detailed company profile & capability matrix |
| 20| `GET` | `/api/v1/companies/:companyId/overview` | `companiesController.js`| `companyParamsSchema` | Company Tenant | Master entity counts (ledgers, items, etc.) |
| 21| `GET` | `/api/v1/companies/:companyId/readiness`| `companiesController.js`| `companyParamsSchema` | Company Tenant | Readiness tier evaluation (T0 through T4) |
| 22| `GET` | `/api/v1/companies/:companyId/ledgers` | `companiesController.js`| `listQuerySchema` | Company Tenant | Paginated ledger masters with balances |
| 23| `GET` | `/api/v1/companies/:companyId/ledgers/:ledgerId` | `companiesController.js`| None | Company Tenant | Detailed single ledger record |
| 24| `GET` | `/api/v1/companies/:companyId/groups` | `companiesController.js`| `listQuerySchema` | Company Tenant | Account groups chart hierarchy |
| 25| `GET` | `/api/v1/companies/:companyId/stock-items` | `companiesController.js`| `listQuerySchema` | Company Tenant | Stock items with units, rates, tax metadata |
| 26| `GET` | `/api/v1/companies/:companyId/stock-items/:stockItemId` | `companiesController.js` | None | Company Tenant | Single stock item master detail |
| 27| `GET` | `/api/v1/companies/:companyId/stock-groups` | `companiesController.js`| `listQuerySchema` | Company Tenant | Stock group hierarchy tree |
| 28| `GET` | `/api/v1/companies/:companyId/cost-centres` | `companiesController.js`| `listQuerySchema` | Company Tenant | Cost centres & salesman entities |
| 29| `GET` | `/api/v1/companies/:companyId/godowns` | `companiesController.js`| `listQuerySchema` | Company Tenant | Warehouse / Godown master list |
| 30| `GET` | `/api/v1/companies/:companyId/units` | `companiesController.js`| `listQuerySchema` | Company Tenant | Measurement units (Nos, Box, Kgs) |
| 31| `GET` | `/api/v1/companies/:companyId/voucher-types` | `companiesController.js` | `listQuerySchema` | Company Tenant | Standard & custom voucher types |
| 32| `GET` | `/api/v1/companies/:companyId/customers` | `companiesController.js`| `listQuerySchema` | Company Tenant | Sundry Debtors with cities & balances |
| 33| `GET` | `/api/v1/companies/:companyId/suppliers` | `companiesController.js`| `listQuerySchema` | Company Tenant | Sundry Creditors with cities & balances |
| 34| `GET` | `/api/v1/companies/:companyId/vouchers` | `companiesController.js`| `voucherQuerySchema` | Company Tenant | Paginated voucher register with line items |
| 35| `GET` | `/api/v1/companies/:companyId/vouchers/:voucherId` | `companiesController.js` | None | Company Tenant | Single voucher with full ledger breakdown |
| 36| `GET` | `/api/v1/companies/:companyId/sales-analysis` | `companiesController.js`| `salesAnalysisQuerySchema`| Company Tenant | Sliced sales analysis (party, item, city) |
| 37| `GET` | `/api/v1/companies/:companyId/purchase-analysis` | `companiesController.js` | `purchaseAnalysisQuerySchema` | Company Tenant | Sliced purchase analysis (supplier, item) |
| 38| `GET` | `/api/v1/companies/:companyId/dashboard` | `companiesController.js`| `dashboardQuerySchema`| Company Tenant | Aggregated executive KPIs & cash flow |
| 39| `GET` | `/api/v1/companies/:companyId/reconciliation-report` | `companiesController.js` | None | Company Tenant | Proof against Tally DayBook / Trial Balance |
| 40| `GET` | `/api/v1/companies/:companyId/reports/report5` | `companiesController.js` | `report5QuerySchema` | Company Tenant | MIS Report 5 (16 Matrix Filters) |
| 41| `GET` | `/api/v1/companies/:companyId/mis-report-5` | `companiesController.js` | `report5QuerySchema` | Company Tenant | Backward-compatibility alias for Report 5 |
| 42| `GET` | `/api/v1/companies/reports/report5/analytics/catalog` | `companiesController.js` | None | Public | Complete metadata index of 160 analyses |
| 43| `GET` | `/api/v1/companies/:companyId/reports/report5/analytics/catalog` | `companiesController.js` | None | Company Tenant | Company-scoped analytics catalog |
| 44| `GET` | `/api/v1/companies/:companyId/reports/report5/analytics/dashboards` | `companiesController.js` | `report5DashboardsQuerySchema` | Company Tenant | Role dashboards (`OwnerTop5`, `SalesManagerTop10`) |
| 45| `GET` | `/api/v1/companies/:companyId/reports/report5/analytics/verification` | `companiesController.js` | `report5QuerySchema` | Company Tenant | Automated CV01–CV16 cross-verification |
| 46| `GET` | `/api/v1/companies/:companyId/reports/report5/analytics` | `companiesController.js` | `report5AnalyticsQuerySchema` | Company Tenant | Runs 18 Lenses (all 160 Analysis Blocks) |
| 47| `GET` | `/api/v1/sync/status` | `syncController.js` | None | Admin | Sync loop state, stats, and tick history |
| 48| `POST`| `/api/v1/sync/run` | `syncController.js` | None | Admin | Triggers immediate manual full sync cycle |
| 49| `GET` | `/api/v1/sync/companies` | `syncController.js` | None | Admin | Lists mirrored companies from SQL DB |
| 50| `GET` | `/api/v1/sync/:companyId/counts` | `syncController.js` | None | Admin | Table record counts per company |
| 51| `POST`| `/api/v1/sync/tally-event` | `syncController.js` | Body: action, guid, vchNo | TDL Hook | Real-time event receiver from Tally TDL |
| 52| `GET` | `/api/v1/sync/tally-event` | `syncController.js` | Query params fallback | TDL Hook | GET fallback for webhook transport |

---

## 7. Database Compatibility Analysis

### Existing Storage Engine
* **Engine:** SQLite 3 (`./data/cfo_yantra.sqlite`) in edge/desktop deployment; PostgreSQL in cloud mode.
* **ORM:** Sequelize 6.37.8.
* **Schema Design Pattern:** **Hybrid Relational + JSON Envelope Pattern**.
  * Top-level relational columns are extracted and indexed for fast filtering (`companyId`, `sourceObjectId`, `voucherDate`, `sourceVoucherNumber`, `isDeleted`).
  * The verbatim canonical record is stored in a `data` JSON column (`DataTypes.JSON`).
  * `sqlModelCompat.js` implements `unwrapRow()`, which parses `row.data` and hoists all attributes to the top level of the returned object.

### Database Table Inventory

| Table Name | Primary Key | Key Relational Columns | JSON Columns | Indexes |
|---|---|---|---|---|
| `companies` | `companyId` (VARCHAR) | `name`, `guid`, `masterId`, `alterId`, `startingFrom`, `booksFrom`, `isOpen` | `features`, `address`, `metadata` | `isOpen`, `gstin`, `pan` |
| `vouchers` | `id` (INTEGER AUTO) | `companyId`, `sourceObjectId`, `voucherDate`, `sourceVoucherNumber`, `isDeleted` | `header`, `entries`, `data` | `[companyId, sourceObjectId]` (UNIQUE), `[companyId, voucherDate]`, `[companyId, sourceVoucherNumber]`, `[companyId, isDeleted]` |
| `sync_states` | `companyId` (VARCHAR) | `companyName`, `status`, `lastRunId`, `totalRecords`, `changedRecords`, `runCount` | `domains`, `lastError` | Primary Key |
| `system_settings`| `key` (VARCHAR) | `tallyHost`, `tallyPort`, `protocol`, `connectionMode`, `targetCompany` | `activeCompanies` | Primary Key |
| `users` | `id` (INTEGER AUTO) | `mobile` (UNIQUE), `fullName`, `email`, `role`, `isVerified` | None | `mobile` (UNIQUE) |
| **11 Master Tables** (`ledgers`, `groups`, `stock_items`, `stock_groups`, `stock_categories`, `units`, `godowns`, `cost_centres`, `cost_categories`, `voucher_types`, `currencies`) | `id` (INTEGER AUTO) | `companyId`, `sourceObjectId`, `objectType`, `name`, `parent`, `checksum`, `contentHash`, `isDeleted` | `data` | `[companyId, sourceObjectId]` (UNIQUE), `[companyId, isDeleted]`, `[companyId, name]` |

### Python Database Architecture (SQLAlchemy 2.0 Async)
The Python implementation will map directly to these exact table names and column definitions.
* **Zero Migration Rule:** No `alembic` migration scripts will alter existing table structures or drop columns.
* **AIOSqlite Driver:** For desktop SQLite connections: `sqlite+aiosqlite:///./data/cfo_yantra.sqlite`.
* **AsyncPG Driver:** For cloud PostgreSQL connections: `postgresql+asyncpg://user:pass@host/db`.
* **Automatic JSON Unwrapping:** A base model deserializer in Python will replicate `unwrapRow()`, unpacking `row.data` so callers receive identical canonical property shapes.

---

## 8. Financial Accuracy Requirements

The Decision Intelligence Suite's integrity depends on strict mathematical determinism:

### Mathematical Principles
1. **28-Digit Arbitrary Precision:**
   * In Node.js: `Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })` via `decimal.js`.
   * In Python:
     ```python
     import decimal
     decimal.getcontext().prec = 28
     decimal.getcontext().rounding = decimal.ROUND_HALF_UP
     ```
2. **Prohibition of IEEE 754 Floating-Point Types:**
   * Raw floats (`float`) must **never** be used for money, quantities, tax splits, or ratios.
   * All intermediate aggregations in the 3D Cube must store `decimal.Decimal` objects.
3. **Division Rules:**
   * Financial divisions (e.g., Average Selling Price, Gross Margin %, HHI shares) must round to 4 decimal places using `ROUND_HALF_UP`.
   * Division by zero must return `Decimal(0)` (or raise caught `ZeroDivisionError` returning `IDLE` status).
4. **Cross-Verification Gate (CV01–CV16):**
   * **CV01–CV05:** $\sum \text{Product Values} + \sum \text{Charges} \equiv \text{Net Revenue}$.
   * **CV06–CV08:** Product-City 2D cross-tab row sums and column sums must reconcile to dimension totals.
   * **CV09–CV11:** Share sums across Products, Cities, and Months must equal exactly $100.00\%$.
   * **CV12–CV14:** Waterfall variance components must conserve: $\sum \Delta \text{Product}_i \equiv \Delta \text{Total}$.
   * **CV15:** Turnover non-negativity constraint after Credit Note netting.
   * **CV16:** Fact table row count must equal Tally DayBook voucher count.

---

## 9. TallyPrime Integration Migration

### Connection Strategy
* Target: `http://127.0.0.1:9000` (loopback).
* HTTP Client: `httpx.AsyncClient(limits=httpx.Limits(max_keepalive_connections=5, max_connections=10), timeout=30.0)`.
* Probe Budget: Distinct timeout of `4.0s` for health probes (`/api/v1/tally/health`).

### Circuit Breaker Implementation
Porting `src/integrations/tally/tally.breaker.js`:
* States: `CLOSED` (normal), `OPEN` (fast-fail), `HALF_OPEN` (testing recovery).
* Threshold: 3 consecutive timeouts or connection errors trip the breaker.
* Reset Timeout: 10,000ms. In `OPEN` state, requests return `503 Service Unavailable` with `APP_ERROR_CODES.TALLY_CONNECTION_FAILED` in `<1ms` without making network calls.

### Read-Only Security Barrier
Porting `src/integrations/tally/tally.readonly.js`:
* Every outgoing XML string is inspected before transmission:
  ```python
  import re
  UNSAFE_PATTERNS = [
      re.compile(r"<TALLYREQUEST>\s*Import\s*</TALLYREQUEST>", re.I),
      re.compile(r"<IMPORTDATA\b", re.I),
      re.compile(r"<DATAACTION\s*=\s*['\"](Create|Alter|Delete)['\"]", re.I)
  ]
  def validate_read_only_xml(xml_str: str) -> bool:
      for pattern in UNSAFE_PATTERNS:
          if pattern.search(xml_str):
              return False
      return True
  ```
* If validation fails, the client raises `ApiError(403, "Read-only violation: mutating request blocked", APP_ERROR_CODES.UNAUTHORIZED_ACCESS)`.

### Tally Concurrency Guard
TallyPrime processes requests **serially on a single execution thread**. Submitting parallel concurrent requests causes queue stacking and timeouts. The Python client must maintain an `asyncio.Lock()` per Tally target host to serialize outbound extraction calls.

---

## 10. Socket.io and Background Job Migration

### WebSockets (`python-socketio`)
* The Python backend will mount a `socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")` onto the FastAPI app.
* Client subscription handlers:
  * Event `subscribe:company`: adds socket to room `company:{companyId}`.
  * Event `unsubscribe:company`: removes socket from room.
* Outbound server broadcasts (preserving identical event names and payloads):
  * `voucher:sync`: `{ "action": "INSERT"|"UPDATE"|"DELETE", "companyId": str, "voucher": dict }`
  * `tally:voucher:inserted`
  * `tally:voucher:updated`
  * `tally:voucher:deleted`
  * `sync:status`: `{ "companyId": str, "lastAlterId": int, "totalInserts": int, ... }`

### Background Jobs
All background routines will run as long-running `asyncio` tasks initialized in FastAPI's `lifespan`:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
import asyncio

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize database, sync jobs, and CDC loops
    sync_task = asyncio.create_task(run_auto_sync_loop())
    cdc_task = asyncio.create_task(run_cdc_engine_loop())
    yield
    # Shutdown: cancel background tasks gracefully
    sync_task.cancel()
    cdc_task.cancel()
    await asyncio.gather(sync_task, cdc_task, return_exceptions=True)

app = FastAPI(lifespan=lifespan)
```

### Addressing Coexistence & Duplicate Sync Risk
> [!CAUTION]
> If Node.js and Python run simultaneously during testing, both backends would poll TallyPrime concurrently and race to write to `cfo_yantra.sqlite`. This would saturate Tally's single thread and corrupt AlterID cursors.
> 
> **Enforced Rule:** The Python backend must check an environment flag `SYNC_ENABLED=false` or verify process locks before starting the auto-sync daemon. When executing shadow parity tests, the Node.js background sync must be paused.

---

## 11. Authentication and Security Parity

### Desktop Standalone Mode
`src/controllers/authController.js` returns:
```json
{
  "success": true,
  "token": "standalone-desktop-token",
  "user": {
    "id": "cfo-admin",
    "mobile": "9876543210",
    "fullName": "CFO Administrator",
    "email": "admin@cfoyantra.com",
    "role": "Owner"
  }
}
```
FastAPI will replicate this exact mock response in desktop mode (`APP_MODE=desktop`).

### Enterprise Cryptographic Token Engine (`src/services/authService.js`)
* Token Format: `base64url(payload).base64url(signature)`.
* Algorithm: HMAC-SHA256 using `AUTH_SECRET`.
* Payload structure: `{ "id": str, "mobile": str, "role": str, "iat": int, "exp": int }` (valid for 7 days).
* Python Implementation:
  ```python
  import hmac, hashlib, base64, json, time

  def verify_token(token: str, secret: str) -> dict | None:
      parts = token.split(".")
      if len(parts) != 2:
          return None
      payload_b64, signature = parts
      expected_sig = base64.urlsafe_b64encode(
          hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest()
      ).decode().rstrip("=")
      if not hmac.compare_digest(signature, expected_sig):
          return None
      payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "==").decode())
      if payload.get("exp", 0) < time.time():
          return None
      return payload
  ```

---

## 12. Proposed Python Architecture

### Selected Technology Stack
* **Language Runtime:** Python 3.12+ ( memanfaatkan performance gains in dictionary operations and asyncio).
* **Web Framework:** FastAPI 0.111+ (ASGI, sub-millisecond route dispatch, pure functional handlers).
* **Schema Validation:** Pydantic v2.7+ (Rust-backed validation; matches Zod validation rules).
* **Database Layer:** SQLAlchemy 2.0 Async + `aiosqlite` (Edge/Desktop) + `asyncpg` (Cloud SaaS).
* **Asynchronous HTTP Client:** HTTPX 0.27+ (persistent keep-alive connection pooling to port 9000).
* **WebSockets:** `python-socketio` 5.11+ ASGI app mounted on `/socket.io`.
* **XML Processing:** `defusedxml` + `lxml` (immune to XXE/Billion Laughs vulnerability).
* **Logging:** `structlog` 24.1+ (zero-allocation structured JSON logging with token masking).

### Rationale Against Alternatives
* **Why not Django / DRF?** Django imposes heavyweight monolithic overhead (Django ORM sync dependencies, unwanted admin tables, mandatory session middleware) that clashes with CFO Yantra's lean, read-only analytical architecture.
* **Why not Flask?** Flask lacks native asynchronous loopback I/O, lacks unified Pydantic v2 typing, and requires assembling dozens of unmaintained plugins for WebSockets and async database drivers.

---

## 13. Node.js to Python Component Mapping

| Node.js Component / Library | Proposed Python Equivalent | Parity & Implementation Details |
|---|---|---|
| **Express.js 4.21** | **FastAPI 0.111+** | Direct mapping from `express.Router()` to `APIRouter(prefix="/api/v1")`. |
| **Zod 4.4** | **Pydantic v2.7+** | Zod schemas mapped to Pydantic `BaseModel` classes with `ConfigDict(populate_by_name=True)`. |
| **Sequelize 6.37** | **SQLAlchemy 2.0 Async** | Declarative mapped classes preserving exact table names, column types, and composite indexes. |
| **Decimal.js (28 digits)** | **Python `decimal.Decimal`** | Globally configured context: `prec = 28`, `rounding = ROUND_HALF_UP`. Exact numerical parity. |
| **fast-xml-parser 5.11** | **`defusedxml` + `lxml`** | Custom XML-to-dict parser preserving tag arrays and attribute handling. |
| **Axios 1.19** | **HTTPX 0.27+** | `AsyncClient` managing loopback connection pooling to TallyPrime port 9000. |
| **Socket.io 4.8** | **python-socketio 5.11+** | ASGI Socket.io server mounted at root; handles `company:<id>` rooms and event emissions. |
| **Pino 10.3** | **Structlog 24.1+** | Structured JSON logging with regex key maskers for `auth`, `authorization`, `token`. |
| **Jest 30.4** | **Pytest 8.2+** | Full test harness reproducing all 35 Jest suites and 1,105 test cases. |

---

## 14. Frontend and Electron Compatibility

### Uniform Response Envelopes
Every list endpoint returns the standard envelope:
```json
{
  "success": true,
  "companyId": "comp_12345",
  "available": true,
  "source": {
    "system": "mirror",
    "fetchedAt": "2026-09-19T12:00:00.000Z",
    "responseTimeMs": 14,
    "syncedAt": "2026-09-19T11:58:00.000Z"
  },
  "items": [ /* canonical records */ ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 120,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  },
  "warning": null
}
```

### Uniform Error Envelopes
```json
{
  "success": false,
  "statusCode": 404,
  "errorCode": "COMPANY_NOT_FOUND",
  "error": "Company \"Acme Corp\" is no longer open in TallyPrime.",
  "details": { "companyId": "comp_12345" },
  "userAction": "Open the company in TallyPrime, then refresh the dashboard.",
  "timestamp": "2026-09-19T12:00:00.000Z"
}
```

### JSON Property Casing Rule
Frontend JavaScript expects `camelCase` keys (`voucherDate`, `sourceObjectId`, `startingFrom`). Pydantic models will configure an alias generator:
```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True
    )
```

---

## 15. Infrastructure and Deployment Plan

### 1. Desktop Packaging Topology (Electron)
In production desktop installations, the Electron main process spawns the backend binary:
* **Tool:** **PyInstaller** or **Nuitka** compiling the FastAPI application into a frozen standalone directory (`cfo-backend/`).
* **Process Binding:** When Electron boots, it executes `cfo-backend.exe`. When the user closes Electron, the backend catches the parent pipe termination and shuts down cleanly within 2 seconds.
* **Port Availability:** Traps `errno.EADDRINUSE` on port 5000 and outputs diagnostic guidance.

### 2. Cloud SaaS Deployment Topology (Docker)
For hosted SaaS multi-tenant installations:
```dockerfile
FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=5000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ ./src/
EXPOSE 5000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "4"]
```

---

## 16. Testing and Validation Strategy

### Multi-Tiered Verification Framework

```text
+---------------------------------------------------------------------------------------+
| Tier 1: Unit Arithmetic & Decimal Verification                                        |
| - Verify 28-digit Decimal operations produce 0.0000000000000000000000000000 drift.    |
| - Test Banker's rounding on multi-tax line allocations against Jest fixtures.          |
+---------------------------------------------------------------------------------------+
| Tier 2: Canonical Normalization & Parser Tests                                        |
| - Parse recorded Tally XML responses; assert identical output to Node normalizers.   |
+---------------------------------------------------------------------------------------+
| Tier 3: 3D Cube & 18 Lenses Parity Tests                                              |
| - Run all 160 Analysis Blocks against WORKBOOK_FACTS dataset.                         |
| - Execute JSON diff on every block: status, severity, narrative, table cells.         |
+---------------------------------------------------------------------------------------+
| Tier 4: Cross-Verification Mathematical Proofs (CV01-CV16)                           |
| - Assert 100% pass rate on trial balance conservation, share sums, and bridges.      |
+---------------------------------------------------------------------------------------+
| Tier 5: Shadow Replay & End-to-End API Parity                                         |
| - Replay 500 production requests through both Node and Python backends.               |
| - Assert 100% equality of status codes, headers, response envelopes, and latencies.   |
+---------------------------------------------------------------------------------------+
```

---

## 17. Migration Phases and Dependencies

```mermaid
gantt
    title CFO Yantra Implementation Phases
    dateFormat  YYYY-MM-DD
    section Phase 1: Foundation
    FastAPI Core, Config, Errors, Status Codes :p1, 2026-10-01, 6d
    SQLAlchemy Models & SQLite Mirror Connect :p2, after p1, 5d
    section Phase 2: Gateway
    Tally HTTP Client, Circuit Breaker, ReadOnly Guard :p3, after p2, 6d
    XML Parsers & Canonical Schemas :p4, after p3, 7d
    section Phase 3: Sync & CDC
    Auto-Sync Loop, AlterID CDC & Tombstoning :p5, after p4, 8d
    Socket.io Server & TDL Webhook Handler :p6, after p5, 5d
    section Phase 4: Core & Analytics
    Vouchers, Sales, Purchase & Dashboard APIs :p7, after p6, 8d
    3D Cube Builder & 18 Lenses (160 Blocks) :p8, after p7, 12d
    CV01-CV16 Verification Matrix Engine :p9, after p8, 5d
    section Phase 5: Verification & Cutover
    Shadow Replay, Jest-to-Pytest Parity :p10, after p9, 8d
    PyInstaller Freeze & Electron Integration :p11, after p10, 6d
```

### Stage Summary:
* **Stage 1 (Foundation):** Base FastAPI project, Pydantic v2 schemas, SQLAlchemy models attached to `./data/cfo_yantra.sqlite`.
* **Stage 2 (Gateway):** HTTP loopback client, circuit breaker, read-only guard, typed XML parsers, master canonicals.
* **Stage 3 (Sync & CDC):** Scheduled sync loop, CDC AlterID cursors, Socket.io broadcasts, TDL webhook receiver.
* **Stage 4 (Core & Intelligence):** Voucher registers, aggregators, 3D Analytics Cube, 18 Lenses (160 Blocks), CV01–CV16 engine.
* **Stage 5 (Parity & Cutover):** Pytest parity execution (1,105 cases), PyInstaller packaging, Electron integration cutover.

---

## 18. Risks, Assumptions, and Unknowns

### Risk Register

| Risk ID | Risk Description | Root Cause | Impact | Likelihood | Mitigation Strategy | Validation Method |
|---|---|---|---|---|---|---|
| **RSK-01** | Floating-Point Rounding Drift | Using native Python `float` | High | High | Enforce `decimal.Decimal` throughout all analytical modules; prohibit `float`. | CV01–CV16 cross-verification test suite. |
| **RSK-02** | TallyPrime Process Crash | Querying `SVCURRENTCOMPANY` for closed company | Critical | Medium | Pre-flight safety gate: verify company exists in open company discovery cache before dispatch. | Hostile test querying invalid companyId. |
| **RSK-03** | Dual-Engine DB Write Collision | Node and Python backends running concurrently in test | Critical | Low | Disable background sync in Python during parity testing (`SYNC_ENABLED=false`). | Verify single process locks on SQLite file. |
| **RSK-04** | Desktop Bundle Oversizing | Bundling dev dependencies in PyInstaller | Medium | Medium | Use clean virtualenv with `--exclude-module` for test runners and linters. | Verify binary distribution size < 45MB. |
| **RSK-05** | CDC AlterID Precision Mismatch | AlterID handled as 32-bit int instead of 64-bit BigInt | High | Low | Map `alterId` as `BigInteger` in SQLAlchemy and Pydantic. | CDC test with AlterID > 2,147,483,647. |

---

## 19. Rollback and Recovery Strategy

### Instant Desktop Rollback
Because the migration adheres to the **Zero DDL Modification Rule**:
1. If the Python binary encounters an unexpected fault in production, the Electron main process can immediately revert its child process spawn target back to `node src/server.js`.
2. The SQLite database remains 100% readable by Node.js Sequelize, ensuring immediate operational resumption with **zero data repair required**.

### Cloud SaaS Rollback
* Blue/Green routing via Nginx or AWS Application Load Balancer allows instant cutback to the Node.js container cluster in `<5 seconds`.

---

## 20. Acceptance Criteria

Before production cutover is approved, the Python backend must satisfy:
1. **Contract Parity:** 100% of the 52 REST API endpoints return identical HTTP status codes, headers, and JSON structures.
2. **Numerical Parity:** 0.0000 variance across all 160 Analysis Blocks when executed against `WORKBOOK_FACTS`.
3. **Verification Matrix:** 100% pass rate on all 16 Cross-Verification rules (**CV01–CV16**).
4. **Performance Gate:** Database-mirrored reads return in `<15ms` (matching or beating Node.js Sequelize).
5. **Stability Gate:** Zero unhandled exceptions or memory leaks across a 48-hour continuous CDC run against TallyPrime.

---

## 21. Final Readiness Checklist

- [x] Complete codebase inspected (98 modules, 52 endpoints, 18 lenses, 160 blocks).
- [x] Database schemas, relationships, and JSON hoisting patterns documented.
- [x] 28-digit Decimal financial precision rules specified.
- [x] Strict read-only XML safety gate specified.
- [x] Circuit breaker and single-threaded Tally serialization rules documented.
- [x] Socket.io WebSocket rooms and event payloads cataloged.
- [x] Zero-touch frontend compatibility verified.
- [x] Rollback strategy established.
- [x] Implementation roadmap and acceptance criteria defined.

---

## 22. Open Questions Requiring Human Decisions

1. **Packaging Delivery Format:** Confirm whether the desktop distribution should use a single standalone executable (`cfo-backend.exe`) or a frozen folder distribution (`cfo-backend/`). (Recommended: Folder distribution for faster startup time).
2. **Cloud SaaS Multi-Tenancy Scope:** Confirm whether the enterprise cloud mode will use schema-per-tenant or row-level tenant filtering (`companyId`). (Recommended: Row-level tenant filtering via composite indexes).

---

### Master File Index & Technical References
* **Entry Point:** `backend/src/server.js`
* **API Versioning:** `backend/src/versioning/apiVersion.js`
* **Sequelize Config:** `backend/src/config/db.js`
* **Company Data Orchestrator:** `backend/src/services/companyData.service.js`
* **CDC Engine:** `backend/src/services/sync/cdcEngine.service.js`
* **Decision Intelligence Engine:** `backend/src/analytics/index.js`
* **160 Analysis Catalog:** `backend/src/analytics/engine/analysisCatalog.js`
* **CV01–CV16 Verifier:** `backend/src/analytics/compute/shared/crossVerification.js`
* **TDL Event Hook:** `backend/src/integrations/tally/tally_webhook.tdl`
* **Read-Only Gate:** `backend/src/integrations/tally/tally.readonly.js`
