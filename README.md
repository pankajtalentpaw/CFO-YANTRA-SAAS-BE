# 🏛️ CFO Yantra – Enterprise Backend Engine & Financial Intelligence Service

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-black.svg)](https://expressjs.com/)
[![Database](https://img.shields.io/badge/SQL%20Database-Sequelize%20(SQLite%20%2F%20PostgreSQL)-blue.svg)](https://sequelize.org/)
[![TallyPrime](https://img.shields.io/badge/TallyPrime%20API-Native%20JSON%20%26%20XML%20(Port%209000)-orange.svg)](https://tallysolutions.com/tallyprime-api-explorer/)
[![Tests](https://img.shields.io/badge/Tests-1105%20Passed%20%2F%2035%20Suites-brightgreen.svg)]()
[![Decimal.js](https://img.shields.io/badge/Arithmetic-Decimal.js%20(28--Digit%20Precision)-blue.svg)]()
[![Architecture](https://img.shields.io/badge/Architecture-Pure%20Function--Based%20Modular-orange.svg)]()

> **Master Technical & Architectural Documentation**  
> Comprehensive guide to system architecture, TallyPrime API Explorer JSON & XML ingestion pipelines, SQL database mirroring (Sequelize), canonical models, high-precision financial arithmetic, the 18 Analytical Lenses (160 Decision Intelligence Analyses), automated cross-verification matrices (CV01–CV16), role-based dashboards, and REST API contracts.

---

## 📑 Table of Contents

1. [Executive Overview & Core Tenets](#1-executive-overview--core-tenets)
2. [High-Level System Architecture](#2-high-level-system-architecture)
3. [TallyPrime API Explorer & Ingestion Pipeline](#3-tallyprime-api-explorer--ingestion-pipeline)
   - [Native JSON-First Protocol Architecture](#native-json-first-protocol-architecture)
   - [Full Catalog of 63 API Explorer Endpoints](#full-catalog-of-63-api-explorer-endpoints)
   - [Safety Gates & Read-Only Barrier](#safety-gates--read-only-barrier)
   - [Incremental Sync, SHA-256 Hashing & Tombstoning](#incremental-sync-sha-256-hashing--tombstoning)
   - [Dual-Read Path (SQL-First Local Mirror + Live Fallback)](#dual-read-path-sql-first-local-mirror--live-fallback)
4. [Data Normalization & Canonical Schema Engine](#4-data-normalization--canonical-schema-engine)
5. [Relational SQL Database Layer (Sequelize)](#5-relational-sql-database-layer-sequelize)
6. [Financial Mathematics & Analytical Algorithms](#6-financial-mathematics--analytical-algorithms)
   - [Arbitrary-Precision Arithmetic (`decimal.js`)](#arbitrary-precision-arithmetic-decimaljs)
   - [Voucher Ledger Breakdown & Tax Reconciliation](#voucher-ledger-breakdown--tax-reconciliation)
   - [The 18 Analytical Lenses & Decision Intelligence Suite (160 Analyses)](#the-18-analytical-lenses--decision-intelligence-suite-160-analyses)
   - [Standard Analysis Block Contract](#standard-analysis-block-contract)
   - [Cross-Verification Matrix (CV01–CV16)](#cross-verification-matrix-cv01cv16)
   - [Cost of Inaction (COI) & Trend Formulas](#cost-of-inaction-coi--trend-formulas)
   - [Concentration & Volatility Indices (HHI, Peak/Trough)](#concentration--volatility-indices-hhi-peaktrough)
   - [AI Virtual CFO Scorecard Scoring Algorithm](#ai-virtual-cfo-scorecard-scoring-algorithm)
7. [Modular Codebase Organization](#7-modular-codebase-organization)
8. [Complete REST API Reference (50+ Endpoints)](#8-complete-rest-api-reference-50-endpoints)
9. [Configuration & Environment Variables (.env)](#9-configuration--environment-variables-env)
10. [Verification, Testing & Diagnostics](#10-verification-testing--diagnostics)

---

## 1. Executive Overview & Core Tenets

**CFO Yantra** is an autonomous, read-only Financial Intelligence & Virtual CFO Engine built specifically for SMEs and mid-market enterprises running on **TallyPrime**.

```mermaid
graph LR
    A[TallyPrime :9000] -->|Native JSON / XML Loopback| B[CFO Yantra Backend Engine]
    B -->|Incremental Auto-Sync| C[(Relational SQL Database - SQLite / PostgreSQL)]
    B -->|Decision Intelligence 160 Blocks| D[Analytics Cube & Verifier]
    B -->|REST APIs :5000| E[CFO Yantra React Frontend]
```

### Core Tenets & Capabilities:
- **Zero-Latency Ingestion**: Direct native JSON & XML communication with local TallyPrime HTTP loopback (`127.0.0.1:9000`).
- **TallyPrime API Explorer Standard**: Native implementation of the complete 63-endpoint catalog documented at [TallyPrime API Explorer](https://tallysolutions.com/tallyprime-api-explorer/).
- **Strict Read-Only Guarantee**: Impossible for the engine to alter, corrupt, insert, or delete any record in TallyPrime.
- **Relational SQL Mirror (Sequelize)**: High-speed relational caching in SQLite (edge/desktop) or PostgreSQL (cloud/enterprise) that offloads heavy analytical compute from Tally's single-threaded runtime.
- **28-Digit Arbitrary Precision Math**: Zero floating-point drift across millions of transactions using `decimal.js` and Banker's rounding (`ROUND_HALF_UP`).
- **18 Analytical Lenses & 160 Decision Blocks**: Institutional-grade decision intelligence covering revenue trends, geographic penetration, product portfolios, concentration risks, waterfall attributions, volatility, and prescriptive management action protocols.
- **Deterministic Cross-Verification (CV01–CV16)**: Real-time mathematical proof guaranteeing zero discrepancy between report figures and Tally DayBook totals.

---

## 2. High-Level System Architecture

### Pure Function-Based Modular Architecture
The backend strictly adheres to a **pure function-based modular architecture** (eliminating stateful OOP abstractions and unnecessary classes):
- **Controllers** (`src/controllers/`): Validate input payloads, resolve company tenant scopes, orchestrate service calls, and shape standard HTTP envelopes.
- **Routes** (`src/routes/`): Modular Express routers defining endpoint paths, query validations, and HTTP verbs.
- **Models** (`src/models/`): Sequelize relational schemas for SQL mirroring with indexed composite keys (`companyId`, `sourceObjectId`) and content hashes.
- **Services** (`src/services/`): Pure business logic, caching layers, extraction orchestrators, and analytics aggregators.
- **Analytics Engine** (`src/analytics/`): In-memory 3D analytical cube builder, 18 lens compute modules, 160 analysis blocks, role-based dashboards, and cross-verification engine.
- **Integrations** (`src/integrations/tally/`): Native JSON & XML protocol drivers, Tally API Explorer catalog, request builders, and canonical schema normalizers.

---

## 3. TallyPrime API Explorer & Ingestion Pipeline

### Native JSON-First Protocol Architecture
Following the official [TallyPrime API Explorer](https://tallysolutions.com/tallyprime-api-explorer/) specification, requests are dispatched as clean native JSON payloads over HTTP POST to port `9000`.

#### Standard Request Headers:
```http
POST / HTTP/1.1
Host: 127.0.0.1:9000
Content-Type: application/json; charset=utf-8
version: 1
tallyrequest: export
type: collection | data
id: <Entity/Collection ID>
```

#### JSON Payload Examples:
**1. Master Collection Request (e.g. Pull All Ledgers):**
```json
{
  "static_variables": [
    { "name": "svExportFormat", "value": "jsonex" },
    { "name": "svCurrentCompany", "value": "Demo Company Ltd" }
  ]
}
```

**2. Vouchers with Period Filter (e.g. Sales Vouchers):**
```json
{
  "static_variables": [
    { "name": "svExportFormat", "value": "jsonex" },
    { "name": "svCurrentCompany", "value": "Demo Company Ltd" }
  ],
  "tdlmessage": [
    {
      "definitions": [
        {
          "metadata": { "name": "TSPLSalesVouchers", "type": "Collection" },
          "attributes": [
            { "Type": "Vouchers:VoucherType" },
            { "Child Of": "$$VchTypeSales" },
            { "Native Method": "Date, VoucherTypeName, VoucherNumber, Partyledgername, Amount" },
            { "Filters": "Period Filter" }
          ]
        },
        {
          "metadata": { "name": "PeriodFilter", "type": "System", "sys_type": "Formulae", "ismodify": true },
          "value": "$Date >= ($$Date:\"01-04-2025\") AND $Date <= ($$Date:\"31-03-2026\")"
        }
      ]
    }
  ]
}
```

**3. Financial Reports (e.g. Trial Balance Detailed):**
```json
{
  "static_variables": [
    { "name": "svExportFormat", "value": "jsonex" },
    { "name": "svCurrentCompany", "value": "Demo Company Ltd" },
    { "name": "svFromDate", "value": "20250401" },
    { "name": "svToDate", "value": "20250430" },
    { "name": "ExplodeFlag", "value": "Yes" },
    { "name": "ExplodeAllLevels", "value": "Yes" }
  ]
}
```

---

### Full Catalog of 63 API Explorer Endpoints

The system includes a complete, pre-built catalog in [`src/integrations/tally/catalog/tallyApiExplorer.catalog.js`](file:///c:/Users/admin/Desktop/CFO%20PROJECT/backend/src/integrations/tally/catalog/tallyApiExplorer.catalog.js):

| Category | Entity | Action / Endpoint Key | Description |
| :--- | :--- | :--- | :--- |
| **Accounting Masters** | **Ledger** | `pull-all-ledger` | Pulls all ledgers in company |
| | | `pull-a-ledger` | Pulls single ledger with selected `fetch_list` |
| | | `pull-ledgers-of-group` | Pulls ledgers filtered by parent group (e.g. `$$GroupBank`) |
| | | `create-ledger`, `alter-ledger`, `delete-ledger` | Mutation schemas |
| | **Group** | `pull-all-groups` | Pulls all account groups |
| | | `pull-group` | Pulls single group with `fetch_list` |
| | | `pull-groups-of-group` | Pulls groups under parent (e.g. `$$GroupCurrentAssets`) |
| | | `create-group`, `alter-group`, `delete-group` | Mutation schemas |
| **Inventory Masters** | **Stock Item** | `pull-all-stock-items` | Pulls all product SKUs & stock items |
| | | `pull-stock-item` | Pulls single stock item details |
| | | `pull-stock-items-of-stock-group` | Pulls stock items under a group |
| | | `create-stock-item`, `alter-stock-item`, `delete-stock-item` | Mutation schemas |
| | **Stock Group** | `pull-all-stock-groups` | Pulls all inventory categories & groups |
| | | `pull-stock-group` | Pulls single stock group |
| | | `pull-stock-group-zero-balance` | Pulls stock groups with zero balances |
| | | `create-stock-group`, `alter-stock-group`, `delete-stock-group`| Mutation schemas |
| | **Units** | `pull-all-units` | Pulls all measurement units (PCS, KGS, NOS) |
| | | `pull-unit` | Pulls single measurement unit |
| | | `create-simple-unit`, `create-compound-unit`, `alter-unit` | Mutation schemas |
| **Transactions** | **Payment** | `payment-pull-all`, `payment-pull-period` | Pulls payment vouchers (all / period filtered) |
| | **Receipt** | `receipt-pull-all`, `receipt-pull-period` | Pulls receipt vouchers (all / period filtered) |
| | **Sales** | `sales-pull-all`, `sales-pull-period` | Pulls sales invoices & vouchers |
| | **Purchase** | `purchase-pull-all`, `purchase-pull-period` | Pulls purchase invoices & vouchers |
| **Reports** | **Trial Balance** | `pull-trial-balance-period` | Trial Balance bounded by date range |
| | | `pull-trial-balance-detailed` | Detailed multi-level exploded Trial Balance |
| | | `pull-trial-balance-plain` | Plain unformatted report structure |
| | | `pull-trial-balance-empty-fields`| Includes zero/empty field records |
| | | `pull-trial-balance-ledger-wise`| Group-free ledger-wise report |
| | | `pull-trial-balance-group` | Trial Balance filtered by specific account group |
| | **Sales Register**| `pull-sales-register-period` | Complete sales register for financial period |
| | | `pull-sales-register-plain` | Plain unformatted register |
| | | `pull-sales-register-empty-fields`| Includes empty fields |

---

### Safety Gates & Read-Only Barrier
1. **Hard Read-Only Assertion Gate** (`validateReadOnlyXml` / `tally.readonly.js`):
   - Structural and pattern verification rejects any payload attempting mutations on read-only flows.
2. **Company Safety Gate** (`isCompanyStillOpen`):
   - Verifies target company presence before query execution.
3. **Circuit Breaker** (`tally.breaker.js`):
   - Automatically pauses requests when Tally is unresponsive or overloaded, preventing cascading backend timeouts.

### Incremental Sync, SHA-256 Hashing & Tombstoning
```mermaid
flowchart TD
    T[Tally Live Extraction] --> N[Canonical Normalizer]
    N --> H[Compute SHA-256 Content Hash]
    H --> C{Hash == Existing SQL Record?}
    C -->|Yes| S[Skip Disk Write]
    C -->|No| U[Atomic SQL Upsert + Update syncedAt]
    T --> D{Record Missing in Tally?}
    D -->|Yes| TM[Mark isDeleted: true & Set deletedAt]
```

### Dual-Read Path (SQL-First Local Mirror + Live Fallback)
1. **Primary Read Path (Local SQL Mirror)**: Ultra-fast read ($< 5\text{ms}$ - $50\text{ms}$) from local SQLite / PostgreSQL. Serves vouchers, line items, and dimensions without touching TallyPrime's single-threaded event loop.
2. **Secondary Read Path (Live Fallback)**: If mirror is not yet populated, queries are executed live against TallyPrime with in-memory caching.
3. **Offline Operation**: Once synced, the software operates 100% offline without requiring TallyPrime to be open.

---

## 4. Data Normalization & Canonical Schema Engine

Raw Tally XML and typed JSON (`{ type, value }`) structures are normalized into standardized JS objects:

### Canonical Entity Models:
- **Canonical Company**: `{ companyId, name, legalName, formalName, guid, masterId, alterId, startingFrom, booksFrom, baseCurrency, country, state, pinCode, email, phone, mobile, gstin, pan, cin, features, isOpen, lastSeenAt, checksum }`
- **Canonical Ledger**: `{ companyId, sourceObjectId, name, parent, openingBalance, closingBalance, isParty, isDebtor, isCreditor, address, gstin }`
- **Canonical Stock Item**: `{ companyId, sourceObjectId, name, parent, category, baseUnit, openingBalance, openingValue, standardCost, standardSellingPrice }`
- **Canonical Voucher**: `{ companyId, sourceVoucherId, sourceVoucherNumber, voucherType, voucherDate, partyLedgerName, amount, amountIsCredit, isCancelled, ledgerEntries: [...], inventoryEntries: [...] }`

---

## 5. Relational SQL Database Layer (Sequelize)

The backend uses **Sequelize ORM** supporting **SQLite** (default zero-config local engine) and **PostgreSQL** (enterprise multi-user deployments).

### Relational Tables & Models:
- **`users`**: System users, bcrypt passwords, verification states.
- **`companies`**: Tenant companies, statutory registrations (`gstin`, `pan`, `cin`), periods, financial flags.
- **`sync_states`**: Synchronization metrics, run IDs, domain execution status.
- **`system_settings`**: Dynamic Tally host, port, protocol, and connection configurations.
- **`vouchers`**: Transaction headers, line item entries, JSON payload, and SHA-256 content hashes.
- **Master Tables**: `ledgers`, `groups`, `stock_items`, `stock_groups`, `stock_categories`, `units`, `godowns`, `cost_centres`, `cost_categories`, `voucher_types`, `currencies`.

---

## 6. Financial Mathematics & Analytical Algorithms

### Arbitrary-Precision Arithmetic (`decimal.js`)
All monetary and percentage computations use `decimal.js` configured with 28-digit precision and Banker's rounding (`ROUND_HALF_UP`) to guarantee zero balance sheet drift:

```javascript
const Decimal = require("decimal.js");
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });
```

---

### Voucher Ledger Breakdown & Tax Reconciliation
Every voucher is decomposed into its taxable turnover, tax lines, auxiliary charges, and discounts:

$$\text{Total Invoice Amount} = \text{Taxable Turnover} + \text{CGST} + \text{SGST} + \text{IGST} + \text{Charges} + \text{Round Off} - \text{Discount}$$

$$\Delta_{\text{Reconciliation}} = \left| \text{Header Total} - \sum_{i=1}^n \text{Ledger Line Amount}_i \right| \equiv 0.00$$

---

### The 18 Analytical Lenses & Decision Intelligence Suite (160 Analyses)

The backend features an analytics engine computing **18 Analytical Lenses** comprising **160 deterministic decision blocks** without LLM hallucination:

| Lens ID | Lens Name | Key Analyses Computed | Core Formulas & Algorithms | Strategic Insight |
| :---: | :--- | :--- | :--- | :--- |
| **Lens 0** | **Executive Overview** | L0.A01–L0.A04 | Composite Health Score (0–100), 3M Momentum %, Run-Rate | High-level 360° health overview and board-ready KPIs. |
| **Lens 1** | **City Revenue Trend** | L1.A01–L1.A10 | Linear Regression Slope $m$, Consecutive Decline Streak, Peak Run-Rate Gap | Detects multi-month territory volume and revenue decline streaks. |
| **Lens 2** | **City Totals Reference** | L2.A01–L2.A10 | $\text{Share}_C = \frac{\text{Rev}_C}{\text{Total}} \times 100$, Equal-Share Benchmark $\frac{100}{N}\%$ | Identifies geographic surplus vs underserved territory segments. |
| **Lens 3** | **Product Totals by City** | L3.A01–L3.A10 | 2D Cross-Tab $\sum \text{Rev}(P, C)$, Dependency Ratio $\frac{\text{Top Product}}{\text{City Total}}$ | Surfaces single-product vulnerability in regional markets (>75%). |
| **Lens 4** | **Product Contribution Share** | L4.A01–L4.A10 | Pareto Analysis, Top 3 & Top 5 SKU Contribution Cumulative % | Evaluates portfolio concentration and reliance on flagship SKUs. |
| **Lens 5** | **Company-Wide Monthly Trend** | L5.A01–L5.A10 | MoM Growth %, Quarterly Velocity, Zero-Month Preservation | Tracks overall company trajectory and inflection points. |
| **Lens 6** | **Product Month Mix & Momentum** | L6.A01–L6.A10 | 100% Stacked Monthly Mix, Seasonality Index $\frac{\text{Month Rev}}{\text{Avg Monthly Rev}}$ | Classifies seasonal vs evergreen product performance. |
| **Lens 7** | **Product Head-to-Head (A vs B)** | L7.A01–L7.A10 | Pairwise Delta ($\Delta$), Advantage %, City-by-City Win Count | Direct competitive comparison between any two product lines. |
| **Lens 8** | **Product Market Power Ranking** | L8.A01–L8.A10 | Dense Rank within city + Market Power Classification (`DOMINANT`/`COMPETITIVE`/`NICHE`) | Evaluates cross-territory product market dominance. |
| **Lens 9** | **Concentration Risk (Dual HHI)** | L9.A01–L9.A10 | $\text{HHI}_{\text{prod}} = \sum s_p^2, \ \text{HHI}_{\text{city}} = \sum s_c^2, \ \text{HHI}_{\text{month}}$ | Company-wide product, geographic, and monthly concentration risks. |
| **Lens 10** | **Top Combos (Pareto 80/20)** | L10.A01–L10.A10 | $\text{Combo Share} = \frac{\text{Turnover}_{P \times C}}{\text{Total Revenue}} \times 100$, Cumulative 80/20 | Identifies critical revenue pillars (Top 1 > 15%, Top 3 > 40%). |
| **Lens 11** | **Product Contribution Bridge** | L11.A01–L11.A10 | Waterfall Attribution: $\Delta \text{Prod}_i / \|\Delta \text{Total}\| \times 100$ | Product-level root cause of start-to-end period revenue changes. |
| **Lens 12** | **Monthly Contribution Distribution**| L12.A01–L12.A10 | Month-over-Month Waterfall Bridges across consecutive calendar months | Pinpoints exact monthly drivers of revenue expansions or contractions. |
| **Lens 13** | **Month vs Month Head-to-Head** | L13.A01–L13.A10 | Pairwise Month Delta ($\Delta$) and Growth Multipliers | Direct comparative analysis between any two reporting months. |
| **Lens 14** | **Monthly Consistency Ranking** | L14.A01–L14.A10 | Borda Count / Average Cross-Market Rank per month | Evaluates which calendar months perform consistently nationwide. |
| **Lens 15** | **Peak & Trough Volatility** | L15.A01–L15.A10 | $\text{Ratio} = \frac{\text{Peak}}{\text{Trough}}$ (RED $\ge 3.0$x, AMBER $\ge 2.0$x), Reliability Gap | Quantifies SKU demand volatility and supply-chain risk gaps. |
| **Lens 16** | **Management Action Protocols** | L16.A01–L16.A10 | 18 automated protocols (5 RED, 5 AMBER, 8 GREEN) | Prescribes prioritized executive action items with ₹ exposure. |
| **Lens 17** | **Dictionary, Filters & Audit** | L17.A01–L17.A10 | $\text{Variance} = \text{Tally DayBook Total} - \text{Cube Total} \equiv 0.00$ | Mathematical proof guaranteeing 100% reconciliation against Tally. |

---

### Cross-Verification Matrix (CV01–CV16)

The engine executes **16 automated mathematical verification checks** across all partitions of the 3D data cube:

- **CV01 (Grand Identity):** $\sum \text{Fact Table} \equiv \text{Tally DayBook Net Total}$
- **CV02–CV05 (Partition Sums):** $\sum \text{City Totals} = \sum \text{Product Totals} = \sum \text{Monthly Totals} = \sum \text{Combo Totals} \equiv \text{Total Revenue}$
- **CV06–CV08 (Cross-Tab Integrity):** Row sums and column sums in the 2D product-city matrix reconcile to individual dimension totals.
- **CV09–CV11 (Share Sums):** $\sum \text{Product Shares} = \sum \text{City Shares} = \sum \text{Monthly Mix Shares} \equiv 100.00\%$
- **CV12–CV14 (Waterfall Bridge):** $\sum \Delta \text{Product}_i \equiv \Delta \text{Total}$ (Zero-variance bridge conservation).
- **CV15 (Non-Negativity):** Turnover values satisfy non-negativity constraints after credit note netting.
- **CV16 (Voucher Count):** Fact table transaction count strictly equals Tally DayBook voucher count.

---

## 7. Modular Codebase Organization

```text
backend/
├── data/                                # SQLite data directory (*.sqlite, *.db)
├── src/
│   ├── analytics/                       # Decision Intelligence Suite (160 Analyses)
│   │   ├── compute/                     # 18 Lens calculation engines
│   │   ├── dashboards/                  # Role-tailored views (Owner, Sales Mgr)
│   │   ├── engine/                      # Registry, Catalog, Evaluator, Runner
│   │   ├── models/                      # Standard Analysis Block schema contracts
│   │   └── prescriptive/                # Prescriptive action protocols
│   │
│   ├── config/                          # Environment variables & Sequelize DB connection
│   │   ├── db.js                        # Sequelize SQL initialization (SQLite/PostgreSQL)
│   │   └── env.js                       # Validated environment configuration
│   │
│   ├── controllers/                     # Pure Function-Based HTTP Controllers
│   │   ├── authController.js            # User authentication
│   │   ├── companiesController.js       # Company masters, registers & analytics
│   │   ├── diagnosticsController.js     # Health probe & live diagnostics
│   │   ├── settingsController.js        # Dynamic Tally endpoint configuration
│   │   ├── syncController.js            # SQL local mirror sync triggers
│   │   └── tallyController.js           # Tally gateway controller
│   │
│   ├── integrations/                    # Tally Loopback & Protocol Drivers
│   │   └── tally/
│   │       ├── canonical/               # Normalizers & reconciliation engine
│   │       ├── catalog/                 # 63 API Explorer endpoint catalog
│   │       ├── parsers/                 # Typed JSON & XML parsers
│   │       ├── requests/                # Native JSON & XML request builders
│   │       ├── transports/              # JSON, XML, JSONEx HTTP clients
│   │       └── tallyExplorer.service.js # High-level API Explorer extraction service
│   │
│   ├── jobs/                            # Auto-sync background daemon
│   │   └── tallySync.job.js
│   │
│   ├── models/                          # Relational Sequelize SQL Models
│   │   ├── companyModel.js              # companies table
│   │   ├── userModel.js                 # users table
│   │   ├── syncStateModel.js            # sync_states table
│   │   ├── systemSettingsModel.js       # system_settings table
│   │   ├── voucherModel.js              # vouchers table
│   │   ├── mirrorModel.factory.js       # 11 dynamic master domain tables
│   │   └── sqlModelCompat.js            # Backward-compatibility query layer
│   │
│   ├── routes/                          # Express Router Modules
│   │   ├── companiesRoutes.js
│   │   ├── syncRoutes.js
│   │   ├── tallyRoutes.js
│   │   └── index.js
│   │
│   ├── scripts/                         # Verification & demo execution scripts
│   │   ├── testTallyJsonExtraction.js   # Live report & collection JSON extraction
│   │   └── demoTallyApiExplorerPull.js  # Complete 63-endpoint category pull runner
│   │
│   ├── services/                        # Business Logic Services
│   │   ├── companyData.service.js
│   │   ├── companyScope.service.js
│   │   ├── dashboard.service.js
│   │   ├── report5Analytics.service.js
│   │   └── sync/                        # Mirror, CDC & deletion detection
│   │
│   └── server.js                        # Express bootstrap & process lifecycle
│
├── tests/                               # 35 Jest Test Suites (1,105 Tests Passed)
├── package.json
└── README.md
```

---

## 8. Complete REST API Reference (50+ Endpoints)

### 1. Root & System Health
- `GET /` — Root API manifest, operational status & target Tally host/port
- `GET /api/health` — Backend service health, version, and server timestamp

### 2. Authentication & Profile (`/api/auth`)
- `POST /api/auth/send-otp` — Request 6-digit OTP
- `POST /api/auth/verify-otp` — Verify OTP and issue JWT token
- `GET /api/auth/me` — Authenticated user profile

### 3. Tally Integration & Gateway (`/api/tally`)
- `GET /api/tally/health` — Probe TallyPrime HTTP port reachability
- `GET /api/tally/status` — Tally latency and active company status
- `GET /api/tally/capabilities` — Protocol support matrix (XML, JSON, JSONEx)
- `GET /api/tally/company` — Discovered loaded companies in TallyPrime

### 4. Settings & Tally Endpoint Config (`/api/settings`)
- `GET /api/settings/tally` — Current configured Tally host, port, and connection flags
- `POST /api/settings/tally` — Update Tally connection target settings
- `POST /api/settings/tally/test` — Test connectivity to specified host:port

### 5. Company Explorer & Masters (`/api/companies`)
- `GET /api/companies` — List all open & mirrored companies (`?force=1` for live refresh)
- `GET /api/companies/:companyId` — Detailed company metadata & capability map
- `GET /api/companies/:companyId/overview` — Summary counts (ledgers, stock items, vouchers)
- `GET /api/companies/:companyId/ledgers` — Paginated ledger master list
- `GET /api/companies/:companyId/groups` — Account groups hierarchy
- `GET /api/companies/:companyId/stock-items` — Inventory item masters
- `GET /api/companies/:companyId/stock-groups` — Stock group tree
- `GET /api/companies/:companyId/units` — Measurement units
- `GET /api/companies/:companyId/voucher-types` — Voucher types

### 6. Transactions & Core Financial Analysis (`/api/companies/:companyId`)
- `GET /api/companies/:companyId/vouchers` — Paginated vouchers with line items
- `GET /api/companies/:companyId/sales-analysis` — Multi-dimensional sales analysis
- `GET /api/companies/:companyId/purchase-analysis` — Procurement analysis
- `GET /api/companies/:companyId/dashboard` — Aggregated executive dashboard KPIs
- `GET /api/companies/:companyId/reconciliation-report` — Tally Trial Balance reconciliation
- `GET /api/companies/:companyId/reports/report5` — MIS Report 5 (18 Lens Matrix Engine)

### 7. Decision Intelligence Layer (160 Analyses)
- `GET /api/companies/reports/report5/analytics/catalog` — Complete metadata index of all 160 analyses
- `GET /api/companies/:companyId/reports/report5/analytics/dashboards` — Role-tailored dashboards (`ownerTop5`, `salesManagerTop10`)
- `GET /api/companies/:companyId/reports/report5/analytics/verification` — Automated CV01–CV16 cross-verification report
- `GET /api/companies/:companyId/reports/report5/analytics` — Run all 18 lenses / 160 analyses with status filters

### 8. SQL Database Mirror & Sync (`/api/sync`)
- `GET /api/sync/status` — Auto-sync loop state, tick statistics, and collection sync outcomes
- `POST /api/sync/run` — Trigger immediate manual sync cycle
- `GET /api/sync/companies` — Mirrored companies in SQL database
- `GET /api/sync/:companyId/counts` — Record counts per mirrored table

---

## 9. Configuration & Environment Variables (.env)

```ini
PORT=5000
NODE_ENV=development

# TallyPrime Bridge Target (HTTP Loopback)
TALLY_HOST=127.0.0.1
TALLY_PORT=9000
TALLY_TIMEOUT_MS=120000
TALLY_PROBE_TIMEOUT_MS=8000

# Relational SQL Database Mirror (Sequelize)
DB_ENABLED=true
DATABASE_URL=sqlite:./data/cfo_yantra.sqlite
# For PostgreSQL: DATABASE_URL=postgres://user:password@localhost:5432/cfo_yantra
DB_LOGGING=false
DB_CONNECT_TIMEOUT_MS=10000

# Background Auto-Sync Daemon
SYNC_ENABLED=true
SYNC_INTERVAL_MS=300000
SYNC_START_DELAY_MS=5000
SYNC_VOUCHERS=true
SYNC_VOUCHER_ENTRIES=true

# Logging
LOG_LEVEL=info
```

---

## 10. Verification, Testing & Diagnostics

### Run All Automated Tests
```powershell
npm test
```
- **Test Suite Results**: **35 Test Suites, 1,105 Tests Passed (100% Pass Rate)**
- **Coverage**:
  - TallyPrime API Explorer Complete 63-Endpoint Catalog
  - Native JSON Request Builders & Typed JSON Normalizer
  - Relational SQL Database Mirroring & Atomic Upserts
  - Canonical Master Parsers & Normalizers
  - High-Precision Decimal Math & Banker's Rounding
  - Full Voucher Deconstruction & Tax Reconciliation
  - In-Memory 3D Analytics Cube Builder
  - 18 Analytical Lenses & 160 Decision Intelligence Blocks
  - CV01–CV16 Mathematical Cross-Verification Matrix
  - Multi-Company Tenant Scoping & Fallback Resilience

### Code Linting
```powershell
npm run lint
```
*(0 errors, 0 warnings)*

### Run Tally API Explorer Extraction Demo
```powershell
node src/scripts/demoTallyApiExplorerPull.js
```

### Start Development Server
```powershell
npm run dev
```

---

**© 2026 CFO Yantra Platforms.** Built with zero-compromise precision engineering for enterprise financial intelligence.