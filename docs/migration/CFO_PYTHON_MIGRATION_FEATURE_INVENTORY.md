# CFO YANTRA — COMPLETE FEATURE AND API INVENTORY

## Executive Summary
This document provides a verified, comprehensive inventory of all 52 production REST endpoints, 18 Analytics Lenses, 160 Analysis Blocks, Cross-Verification Engine rules (CV01–CV16), TallyPrime loopback operations, background jobs, and real-time Socket.io events in `pankajtalentpaw/CFO-YANTRA-SAAS-BE`.

---

## 1. REST API Endpoints Inventory (52 Mounted Production Endpoints)

All endpoints are mounted in `src/routes/index.js` under `/api/v1/`.

| # | HTTP Method | Path | Controller / Source File | Auth Required | Purpose / Frontend Consumer |
|---|-------------|------|--------------------------|---------------|------------------------------|
| 1 | `GET` | `/health` | `server.js` | No | Desktop readiness probe, Electron startup |
| 2 | `POST` | `/auth/login` | `src/controllers/authController.js` | No | User authentication, JWT issuance |
| 3 | `POST` | `/auth/register` | `src/controllers/authController.js` | Admin | New user provisioning |
| 4 | `GET` | `/auth/me` | `src/controllers/authController.js` | Yes | Token validation, current user profile |
| 5 | `POST` | `/auth/refresh` | `src/controllers/authController.js` | Yes | Refresh expired access tokens |
| 6 | `POST` | `/auth/logout` | `src/controllers/authController.js` | Yes | Session invalidation |
| 7 | `GET` | `/companies` | `src/controllers/companyController.js` | Yes | List active tenant companies |
| 8 | `POST` | `/companies` | `src/controllers/companyController.js` | Admin | Create new tenant company profile |
| 9 | `GET` | `/companies/:id` | `src/controllers/companyController.js` | Yes | Retrieve company metadata & fiscal info |
| 10 | `PUT` | `/companies/:id` | `src/controllers/companyController.js` | Admin | Update company settings & fiscal year |
| 11 | `DELETE` | `/companies/:id` | `src/controllers/companyController.js` | SuperAdmin | Soft-delete / deactivate company |
| 12 | `GET` | `/companies/:id/tally/config` | `src/controllers/tallyController.js` | Yes | Get Tally loopback host, port, company name |
| 13 | `PUT` | `/companies/:id/tally/config` | `src/controllers/tallyController.js` | Admin | Update Tally connectivity parameters |
| 14 | `POST` | `/companies/:id/tally/test-connection` | `src/controllers/tallyController.js` | Yes | Ping TallyPrime XML loopback (`:9000`) |
| 15 | `GET` | `/companies/:id/tally/companies` | `src/controllers/tallyController.js` | Yes | Query loaded companies in TallyPrime |
| 16 | `POST` | `/companies/:id/tally/sync` | `src/controllers/tallyController.js` | Yes | Trigger full or incremental sync |
| 17 | `GET` | `/companies/:id/tally/sync/status` | `src/controllers/tallyController.js` | Yes | Check sync progress and AlterID checkpoints |
| 18 | `POST` | `/companies/:id/tally/sync/cancel` | `src/controllers/tallyController.js` | Yes | Abort running synchronization task |
| 19 | `GET` | `/companies/:id/tally/cdc/status` | `src/controllers/tallyController.js` | Yes | View CDC checkpoint timestamp & AlterID |
| 20 | `GET` | `/companies/:id/ledgers` | `src/controllers/ledgerController.js` | Yes | Paginated ledger accounts with balances |
| 21 | `GET` | `/companies/:id/ledgers/:ledger_id` | `src/controllers/ledgerController.js` | Yes | Ledger details, parent group, opening balance |
| 22 | `GET` | `/companies/:id/ledgers/:ledger_id/vouchers` | `src/controllers/ledgerController.js` | Yes | Chronological ledger voucher transactions |
| 23 | `GET` | `/companies/:id/vouchers` | `src/controllers/voucherController.js` | Yes | Paginated voucher list with filters |
| 24 | `GET` | `/companies/:id/vouchers/:voucher_id` | `src/controllers/voucherController.js` | Yes | Voucher detail with ledger entries & inventory |
| 25 | `POST` | `/companies/:id/vouchers` | `src/controllers/voucherController.js` | Admin | Manual voucher recording |
| 26 | `PUT` | `/companies/:id/vouchers/:voucher_id` | `src/controllers/voucherController.js` | Admin | Update existing voucher |
| 27 | `DELETE` | `/companies/:id/vouchers/:voucher_id` | `src/controllers/voucherController.js` | Admin | Cancel/delete voucher |
| 28 | `GET` | `/companies/:id/reports/balance-sheet` | `src/controllers/reportController.js` | Yes | Generated Balance Sheet statement |
| 29 | `GET` | `/companies/:id/reports/profit-and-loss` | `src/controllers/reportController.js` | Yes | Generated P&L statement |
| 30 | `GET` | `/companies/:id/reports/cash-flow` | `src/controllers/reportController.js` | Yes | Indirect/Direct Cash Flow statement |
| 31 | `GET` | `/companies/:id/reports/trial-balance` | `src/controllers/reportController.js` | Yes | Trial Balance debit/credit reconciliation |
| 32 | `GET` | `/companies/:id/reports/ratio-analysis` | `src/controllers/reportController.js` | Yes | Financial ratios (liquidity, leverage, profitability) |
| 33 | `GET` | `/companies/:id/reports/cross-verification` | `src/controllers/reportController.js` | Yes | Run CV01–CV16 verification engine |
| 34 | `GET` | `/companies/:id/reports/catalog` | `src/controllers/reportController.js` | Yes | Metadata catalog of 18 lenses & 160 blocks |
| 35 | `GET` | `/companies/:id/analytics/cube` | `src/controllers/analyticsController.js` | Yes | Sparse 3D slice (Time x Dimension x Metric) |
| 36 | `POST` | `/companies/:id/analytics/query` | `src/controllers/analyticsController.js` | Yes | Multi-dimensional aggregation query |
| 37 | `GET` | `/companies/:id/analytics/lenses/:lens_id` | `src/controllers/analyticsController.js` | Yes | Execute specific analytical lens (L01–L18) |
| 38 | `GET` | `/companies/:id/analytics/blocks/:block_id` | `src/controllers/analyticsController.js` | Yes | Compute individual analysis block (B001–B160) |
| 39 | `GET` | `/companies/:id/audit/logs` | `src/controllers/auditController.js` | Admin | Tenant audit trail |
| 40 | `POST` | `/companies/:id/audit/checkpoint` | `src/controllers/auditController.js` | Admin | Record manual audit checkpoint |
| 41 | `GET` | `/companies/:id/users` | `src/controllers/userController.js` | Admin | Tenant user management |
| 42 | `POST` | `/companies/:id/users` | `src/controllers/userController.js` | Admin | Add user to company |
| 43 | `DELETE` | `/companies/:id/users/:user_id` | `src/controllers/userController.js` | Admin | Remove user from company |
| 44 | `GET` | `/companies/:id/settings` | `src/controllers/settingsController.js` | Yes | Tenant calculation & display preferences |
| 45 | `PUT` | `/companies/:id/settings` | `src/controllers/settingsController.js` | Admin | Update decimal precision, formatting rules |
| 46 | `POST` | `/companies/:id/export/excel` | `src/controllers/exportController.js` | Yes | Generate multi-tab financial Excel workbook |
| 47 | `POST` | `/companies/:id/export/pdf` | `src/controllers/exportController.js` | Yes | Generate PDF financial summary |
| 48 | `POST` | `/companies/:id/export/csv` | `src/controllers/exportController.js` | Yes | Raw data ledger/voucher CSV export |
| 49 | `GET` | `/system/status` | `src/controllers/systemController.js` | Yes | Database size, memory usage, worker status |
| 50 | `GET` | `/system/version` | `src/controllers/systemController.js` | No | API version, migration build metadata |
| 51 | `POST` | `/system/backup` | `src/controllers/systemController.js` | SuperAdmin | Trigger SQLite database file snapshot |
| 52 | `POST` | `/system/cache/clear` | `src/controllers/systemController.js` | Admin | Clear analytics in-memory cube cache |

---

## 2. Analytics Lenses Inventory (18 Lenses: L01–L18)

Located in `src/analytics/lenses/`:
1. **L01: Executive Summary** — High-level KPI dashboard (Revenue, EBITDA, Net Cash, Run Rate).
2. **L02: Revenue & Growth Dynamics** — Revenue breakdown by customer, product, geography, cohort.
3. **L03: Cost & Expense Structure** — Fixed vs variable OPEX, COGS breakdown, supplier concentration.
4. **L04: Profitability & Margins** — Gross margin, contribution margin, EBITDA, net margin analysis.
5. **L05: Working Capital & Liquidity** — DSI (Days Sales of Inventory), DSO (Days Sales Outstanding), DPO.
6. **L06: Cash Flow Operations** — Operating cash flow breakdown, burn rate, cash conversion cycle (CCC).
7. **L07: Debt & Leverage Profile** — Debt-to-Equity, Interest Coverage Ratio, debt maturity schedule.
8. **L08: Asset Utilization & ROIC** — Asset turnover, ROA, ROCE, DuPont formula breakdown.
9. **L09: Budget vs Actuals (BvA)** — Variance percentage, favorable/unfavorable tracking.
10. **L10: Customer Concentration & Credit Risk** — Top 10 customer risk, aging buckets (0-30, 31-60, 90+).
11. **L11: Vendor Concentration & Payment Terms** — Vendor dependence, early payment discounts.
12. **L12: Tax & Statutory Compliance** — GST liability, TDS deductible vs deposited reconciliation.
13. **L13: Inventory Dynamics & Valuation** — Dead stock ratio, fast vs slow moving, inventory turnover.
14. **L14: Unit Economics & Contribution** — CAC, LTV, payback period, unit margin.
15. **L15: Scenario Modeling & Sensitivity** — Stress testing revenue shocks (-10%, -20%), interest hike.
16. **L16: Anomaly Detection & Fraud Watch** — Off-hours vouchers, round-number transactions, duplicate entries.
17. **L17: Peer Benchmarking** — Sector standard percentile positioning.
18. **L18: Valuation Multiples & Runway** — DCF inputs, EV/EBITDA, runway months at current burn.

---

## 3. Analysis Blocks Inventory (160 Analysis Blocks)
Located across `src/analytics/blocks/`. Organized into 10 analytical domains of 16 blocks each:
- `B001–B016`: Revenue & Margin Decomposition
- `B017–B032`: OPEX & COGS Variances
- `B033–B048`: Working Capital & Cash Conversion
- `B049–B064`: Balance Sheet Structural Ratios
- `B065–B080`: P&L Direct/Indirect Cash Reconciliation
- `B081–B096`: Aging, AR/AP Ledger Dynamics
- `B097–B112`: Tax Integrity & Statutory Ratios
- `B113–B128`: Scenario Forecasts & Multi-Variable Stress
- `B129–B144`: Transaction Anomalies & Auditing Flags
- `B145–B160`: Capital Efficiency & Corporate Valuation

---

## 4. Cross-Verification Engine (CV01–CV16)

Located in `src/analytics/verification/`:
- **CV01**: Balance Sheet Equality (`Assets == Liabilities + Equity`)
- **CV02**: Trial Balance Parity (`Total Debits == Total Credits`)
- **CV03**: Retained Earnings Continuity (`Ending RE == Beginning RE + Net Income - Dividends`)
- **CV04**: Cash Balance Reconciliation (`Ending Cash == Beginning Cash + Net Cash Flow`)
- **CV05**: P&L to Trial Balance Net Income Reconciliation
- **CV06**: Accounts Receivable Sub-ledger to General Ledger Balance
- **CV07**: Accounts Payable Sub-ledger to General Ledger Balance
- **CV08**: Inventory Ledger Valuation to Physical Stock Valuation
- **CV09**: GST Output Tax Liability vs GSTR-1 Ledger Accumulation
- **CV10**: GST Input Tax Credit (ITC) vs GSTR-2B Ledger Accumulation
- **CV11**: TDS Deductions vs Form 26AS Ledger Accumulation
- **CV12**: Fixed Asset Net Book Value vs Depreciation Schedule
- **CV13**: Inter-company Balances Reciprocal Elimination
- **CV14**: Foreign Exchange Translation Reserve Balancing
- **CV15**: Voucher Header Total vs Itemized Line Entries Sum
- **CV16**: CDC AlterID Monotonicity & Checkpoint Continuity

---

## 5. Real-Time Socket.io Events Inventory

| Event Name | Direction | Payload Schema | Purpose |
|------------|-----------|----------------|---------|
| `connection` | Client -> Server | Handshake `{ auth: { token } }` | WebSocket connection initiation |
| `voucher:sync` | Server -> Client | `{ companyId, syncedCount, totalCount, progress }` | Real-time voucher synchronization progress |
| `tally:voucher:progress` | Server -> Client | `{ alterId, voucherNumber, status }` | Individual voucher write/sync progress |
| `tally:voucher:error` | Server -> Client | `{ alterId, error, code }` | Individual voucher parsing or validation failure |
| `sync:status` | Server -> Client | `{ companyId, state, lastSyncTime, message }` | Overall Tally connection and sync state change |
