# CFO YANTRA — SYSTEM BASELINE AUDIT REPORT
**Document ID:** `CFO-BASE-AUDIT-001`  
**Date:** September 19, 2026  
**Auditor:** Principal Software Architect & QA Automation Lead  
**Target Repository:** `pankajtalentpaw/CFO-YANTRA-SAAS-BE`  
**Execution Status:** EMPIRICALLY VERIFIED AGAINST ACTIVE RUNTIME & TESTS

---

## 1. Executive Summary & Verification Methodology

This baseline audit report establishes the verified empirical foundation of the CFO Yantra codebase prior to any architectural modifications or migration steps. All findings in this document are categorized by strict evidence levels:
* **[VERIFIED FACT]:** Confirmed by direct code execution, test runs, or explicit lines in the active codebase.
* **[EXISTING DEFECT]:** Confirmed design or implementation flaw in the existing codebase.
* **[INFERRED BEHAVIOR]:** Logically deduced from contracts, configuration, and runtime telemetry.
* **[MISSING INFORMATION]:** Files or configurations not present in the accessible repository.
* **[ENVIRONMENT-DEPENDENT]:** Behavior contingent on host OS, local ports, or TallyPrime presence.

---

## 2. Technical Stack Baseline

| Layer | Verified Component | Version / Specification | Evidence Source | Evidence Level |
|---|---|---|---|---|
| **Runtime** | Node.js | v18+ to v22+ (tested on Windows host) | `package.json:43-58` | `[VERIFIED FACT]` |
| **Backend Framework** | Express.js | 4.21.2 | `package.json:48` | `[VERIFIED FACT]` |
| **Database ORM** | Sequelize | 6.37.8 | `package.json:53` | `[VERIFIED FACT]` |
| **Database Engine (Local)**| SQLite3 | 6.0.1 (`./data/cfo_yantra.sqlite`) | `package.json:55`, `src/config/db.js:26` | `[VERIFIED FACT]` |
| **Database Engine (Cloud)**| PostgreSQL | `pg` 8.23.0 / `pg-hstore` 2.3.4 | `package.json:50-51` | `[VERIFIED FACT]` |
| **Validation Engine** | Zod | 4.4.3 | `package.json:57` | `[VERIFIED FACT]` |
| **Financial Math Engine** | Decimal.js | 10.6.0 (precision 28, `ROUND_HALF_UP`) | `package.json:46`, `src/utils/financialDecimal.js:4` | `[VERIFIED FACT]` |
| **XML Parser** | fast-xml-parser | 5.11.0 | `package.json:49` | `[VERIFIED FACT]` |
| **HTTP Client** | Axios | 1.19.0 | `package.json:44` | `[VERIFIED FACT]` |
| **WebSockets** | Socket.io | 4.8.3 | `package.json:54` | `[VERIFIED FACT]` |
| **Structured Logger** | Pino | 10.3.1 | `package.json:52` | `[VERIFIED FACT]` |
| **Test Runner** | Jest | 30.4.2 | `package.json:63` | `[VERIFIED FACT]` |
| **Frontend Framework** | Electron + React 18 SPA | Active terminal running `npm run electron:dev` in `c:\Users\admin\Desktop\CFO PROJECT\frontend` | Terminal process telemetry | `[INFERRED BEHAVIOR]` |

---

## 3. Empirical Test Suite Baseline Execution

On September 19, 2026, the complete automated test harness was executed via `npm test` from the active repository root:

```text
Test Suites: 35 passed, 35 total
Tests:       1113 passed, 1113 total
Snapshots:   0 total
Time:        3.439 s, estimated 6 s
Ran all test suites.
```

### Verified Test Suite Breakdown (35 Passed Suites)
1. `tests/multiTransport.test.js` — XML, JSON, JSONEx format capabilities
2. `tests/analytics/blockContract.test.js` — 160 Analysis Block schema validation
3. `tests/mirrorSync.test.js` — Database mirror upsert & soft deletion
4. `tests/tally.health.companies.test.js` — Tally health probe & company extraction
5. `tests/analytics/workbookParity.test.js` — Parity against financial workbook fixtures
6. `tests/tallyExplorerCatalog.test.js` — 63-endpoint API Explorer validation
7. `tests/analytics/cube.test.js` — 3D sparse `AnalyticsCube` construction
8. `tests/exp03_exp10.test.js` — Experimental pipeline regression tests
9. `tests/tally.company-discovery.test.js` — Dynamic loaded company discovery
10. `tests/tally.readonly.test.js` — Strict read-only XML guard validation
11. `tests/factSales.test.js` — FACT_SALES ingestion & normalization pipeline
12. `tests/reconciliation.test.js` — Accounting trial balance reconciliation
13. `tests/diagnostics.test.js` — Multi-transport benchmark tests
14. `tests/analytics/verification.test.js` — Mathematical verification rules (CV01–CV16)
15. `tests/salesPurchaseTallyConsistency.test.js` — Cross-register consistency
16. `tests/tally.requests.test.js` — Tally export XML request generators
17. `tests/masters.canonical.test.js` — Master domain canonical normalizers
18. `tests/financialDecimal.test.js` — 28-digit precision arithmetic & Half-Up rounding
19. `tests/analytics/stats.test.js` — Descriptive statistical algorithms
20. `tests/misReport5.test.js` — MIS Report 5 (16 Matrix Filters)
21. `tests/tally.parser.test.js` — Typed Tally XML response parser
22. `tests/analytics/period.test.js` — Financial year and date window slicing
23. `tests/company.canonical.test.js` — Company metadata canonical normalization
24. `tests/accounting.canonical.test.js` — Accounting ledger & group normalizers
25. `tests/checksum.test.js` — SHA-256 content hashing & change detection
26. `tests/tallyJsonParser.test.js` — Native Tally JSON response parser
27. `tests/tally.collection-tdl.test.js` — Dynamic TDL collection generators
28. `tests/tallyJsonBuilder.test.js` — Native JSON request payload builders
29. `tests/voucherExtraction.test.js` — Batch voucher extraction & line breakdown
30. `tests/companyExplorer.test.js` — Complete company domain explorer
31. `tests/dashboard.test.js` — Executive dashboard aggregation KPIs
32. `tests/analytics/genericity.test.js` — Hostile cube edge cases (empty, zero, single)
33. `tests/analytics/service.test.js` — Analytics service endpoints & catalog index
34. `tests/tallyResilience.test.js` — Circuit breaker timeouts & fallback recovery
35. `tests/setupTestEnv.js` — In-memory test environment isolation (`sqlite::memory:`)

---

## 4. Current Database Schema & Storage Baseline

### Table Inventory (16 Total Tables)
Inspection of `src/models/` confirms the following physical schema:
* **Core Entity Tables (5):**
  1. `companies` (PK: `companyId` VARCHAR) — Company metadata, GSTIN, PAN, periods, feature matrix.
  2. `vouchers` (PK: `id` INTEGER AUTO) — Vouchers indexed by `[companyId, sourceObjectId]`, `voucherDate`, `sourceVoucherNumber`, `isDeleted`.
  3. `sync_states` (PK: `companyId` VARCHAR) — Sync progress, AlterID cursors (`domains.cdc.lastAlterId`), error logs.
  4. `system_settings` (PK: `key` VARCHAR) — Target Tally host, port, timeout, connection mode.
  5. `users` (PK: `id` INTEGER AUTO, UK: `mobile`) — User authentication, role (`Owner`/`admin`), verification flag.
* **Dynamic Master Domain Mirror Tables (11):**
  Generated via `mirrorModel.factory.js`: `ledgers`, `groups`, `stock_items`, `stock_groups`, `stock_categories`, `units`, `godowns`, `cost_centres`, `cost_categories`, `voucher_types`, `currencies`.
  * **Envelope Columns:** `id`, `companyId`, `sourceObjectId`, `objectType`, `name`, `parent`, `checksum`, `contentHash`, `isDeleted`, `deletedAt`, `syncedAt`, `lastRunId`, `data` (JSON).

### Critical Data Access Pattern: Hybrid JSON Hoisting (`unwrapRow`)
* In `src/models/sqlModelCompat.js:41-54`, `unwrapRow()` extracts attributes from the JSON `data` column and merges them into root object properties.
* **Baseline Finding:** Downstream services expect properties stored in `data` (e.g. `openingBalance`, `partNo`, `taxRate`) to be accessible directly on the row object.

---

## 5. Current API Surface & Route Baseline

Inspection of `src/routes/index.js` confirms exactly **52 mounted production endpoints**:
* **Mounted Modules:**
  * `/api/v1/auth` (5 endpoints)
  * `/api/v1/settings` (3 endpoints)
  * `/api/v1/tally` (7 endpoints)
  * `/api/v1/companies` (24 endpoints)
  * `/api/v1/sync` (6 endpoints)
  * `/api/v1/diagnostics` (2 endpoints)
  * `/api/v1/cloud` (1 endpoint)
  * `/api/v1/health` (1 endpoint)
  * `/` (1 root manifest endpoint)
* **Unmounted Modules [EXISTING DEFECT / UNMOUNTED]:**
  * `src/routes/experimentsRoutes.js` defines 11 routes (`/api/v1/experiments/...`) but is **not imported or mounted** in `src/routes/index.js`.

---

## 6. Financial Arithmetic & Rounding Baseline

* **Engine:** `decimal.js` configured with `precision: 28` and `rounding: Decimal.ROUND_HALF_UP` (`src/utils/financialDecimal.js:4-9`).
* **Rounding Rule:** **Round Half Up (Symmetric Arithmetic Rounding)**.
  * `123.455` rounded to 2 places = `123.46`.
  * `123.445` rounded to 2 places = `123.45`.
  * **Baseline Finding:** This is **not** Banker's rounding (`ROUND_HALF_EVEN`). Python's default rounding mode is `ROUND_HALF_EVEN`, which would round `123.445` to `123.44`.

---

## 7. TallyPrime Integration & Real-time Baseline

* **Loopback Target:** `http://127.0.0.1:9000` (`src/config/env.js:45-46`).
* **Connection Agent:** Node `http.Agent` with `maxSockets: 1, maxFreeSockets: 1, keepAlive: true` (`src/integrations/tally/tally.client.js:11-16`).
* **Concurrency:** Guaranteed serial execution via mutex `breaker.runExclusive()` (`src/integrations/tally/tally.client.js:141`).
* **Read-Only Enforcement:** Regex pattern matching against mutation instructions in XML (`src/integrations/tally/tally.readonly.js:10-77`).
* **WebSockets:** Socket.io mounted on HTTP server, emitting `voucher:sync`, `tally:voucher:*`, and `sync:status` to room `company:<id>`.
* **Sync Loops:**
  * Auto-sync polling every 60s (`src/jobs/tallySync.job.js`).
  * CDC AlterID polling every 30s (`src/services/sync/cdcEngine.service.js`).
  * Deletion detection every 40 ticks (~20 min).

---

## 8. Baseline Defects & Risks Identified

1. **[EXISTING DEFECT] JSON Transport Lacks Read-Only Guard:** `src/integrations/tally/transports/json.transport.js` sends POST requests to port 9000 without executing `validateReadOnlyXml()`.
2. **[EXISTING DEFECT] Socket.io Lacks Tenant Authorization:** `src/services/realtimeSocket.service.js` permits unauthenticated clients to join any company room via `subscribe:company`.
3. **[EXISTING DEFECT] Unmounted Route Module:** `src/routes/experimentsRoutes.js` exists but is orphaned from the application router.
4. **[ENVIRONMENT DEFECT] Multi-Worker Sync Hazard:** Express starts background jobs in-process (`src/server.js:129-130`). If a multi-worker ASGI server is launched, all workers would poll Tally simultaneously.
