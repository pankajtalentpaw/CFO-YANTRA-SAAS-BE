# CFO YANTRA — COMPANY-WISE LOCAL DATABASE & TALLY SYNCHRONIZATION ARCHITECTURE

**Document Version**: 2.0.0-PROD  
**System**: CFO Yantra Desktop & Financial Analytics Platform  
**Target Storage Engine**: Multi-Instance SQLite with WAL Mode  

---

## 1. Physical Directory Architecture

```text
CFO PROJECT/
├── data/
│   ├── cfo_yantra.sqlite                   # Central Catalog Mirror & Global Cache
│   ├── companies_index.json                # Master Company Registry
│   └── companies/
│       ├── 10002_RAVI_ENGINEERING_CO.2024-26/
│       │   ├── database.sqlite             # Dedicated physical SQLite database (WAL)
│       │   ├── company.json                # Company profile & metadata
│       │   ├── sync_state.json             # Realtime checkpoint, alterId, record counts
│       │   ├── sync_log.json               # Chronological sync execution & error log
│       │   ├── sync/
│       │   │   ├── sync-state.json         # Compatibility mirror
│       │   │   └── sync-errors.log         # Detailed failure logs
│       │   ├── backups/                    # Standalone compressed .zip archives
│       │   ├── sync_snapshots/             # Raw Tally XML/JSON payloads
│       │   ├── exports/                    # Generated Excel, CSV, PDF exports
│       │   └── audit_logs/                 # Access & mutation traces
│       │
│       ├── 10003_AQUA_OVERSEAS/
│       │   ├── database.sqlite
│       │   ├── company.json
│       │   ├── sync_state.json
│       │   ├── sync_log.json
│       │   └── ...
```

---

## 2. Company Registry Specifications (`data/companies_index.json`)

The central registry serves as the authoritative map between stable internal company IDs and their physical storage locations on disk.

### Schema:
```json
{
  "318ee1e6-1ffc-4348-b53e-8b0836c48bbd": {
    "companyId": "318ee1e6-1ffc-4348-b53e-8b0836c48bbd",
    "companyNumber": 10005,
    "companyName": "Marshal Engineers (24-27) R",
    "folderName": "10005_Marshal_Engineers_(24-27)_R",
    "folderPath": "C:/Users/admin/Desktop/CFO PROJECT/data/companies/10005_Marshal_Engineers_(24-27)_R",
    "databasePath": "C:/Users/admin/Desktop/CFO PROJECT/data/companies/10005_Marshal_Engineers_(24-27)_R/database.sqlite",
    "guid": "318ee1e6-1ffc-4348-b53e-8b0836c48bbd",
    "masterId": 10005,
    "registrationStatus": "ACTIVE",
    "syncStatus": "COMPLETED",
    "lastSyncTime": "2026-09-21T06:31:38.081739Z",
    "createdAt": "2026-09-21T08:41:50.023435+00:00",
    "updatedAt": "2026-09-21T08:41:50.023444+00:00"
  }
}
```

### Safety & Concurrency Rules:
1. **Atomic Writes**: Written to `companies_index.json.tmp` and atomically replaced via `os.replace` to prevent corrupted partial reads.
2. **Path Normalization**: Absolute paths are stored in normalized forward-slash format pointing strictly inside `data/companies/`.
3. **Legacy Fallback**: Loads from `data/companies_index.json` first; falls back to `data/companies/companies_index.json` if necessary, migrating contents automatically.

---

## 3. Database Ownership & Isolation Guarantees

1. **Physical Isolation**: Company A's financial vouchers are stored in `data/companies/{compA}/database.sqlite`, and Company B's in `data/companies/{compB}/database.sqlite`. It is physically impossible for a query in Company A's database to access Company B's rows.
2. **Backend Query Enforcement**: All company-scoped API endpoints and backend services obtain database sessions via `CompanyDatabaseManager.get_session(company_id)`, strictly parameterizing queries with `WHERE companyId = :cid`.
3. **Identical Voucher Numbers**: Two different companies may have invoice `INV-001`. Because each company has its own database, zero unique constraint conflicts or cross-tenant overwrites can occur.
4. **Authoritative Source of Truth**:
   - Company-specific financial entities (`vouchers`, `ledgers`, `groups`, `stockitems`, `stockgroups`, `vouchertypes`, `bill_outstandings`, `costcategories`, `godowns`, `currencies`): **Company database is authoritative**.
   - Global catalog & user authentication (`system_settings`, `users`): **Central database (`cfo_yantra.sqlite`) is authoritative**.

---

## 4. SQLite Engine Lifecycle & Connection Management

To prevent unbounded connection resource leaks while maintaining sub-millisecond query performance:
1. **Bounded LRU Engine Cache**:
   - Maximum active engines: **10 engines** (`MAX_ACTIVE_ENGINES = 10`).
   - Eviction policy: Least Recently Used (LRU) based on access timestamp.
   - On eviction, the SQLAlchemy AsyncEngine is explicitly disposed (`await engine.dispose()`) to close all underlying SQLite file handles.
2. **High-Concurrency SQLite PRAGMA Configuration**:
   ```sql
   PRAGMA journal_mode = WAL;
   PRAGMA busy_timeout = 5000;
   PRAGMA synchronous = NORMAL;
   PRAGMA foreign_keys = ON;
   ```
   - **WAL (Write-Ahead Logging)**: Allows concurrent readers while a background sync write is in progress.
   - **Busy Timeout**: Sets a 5,000 ms lock retry window to gracefully handle transient concurrent write attempts.
   - **Synchronous Normal**: Provides ACID compliance with minimal disk I/O latency.
   - **Foreign Keys ON**: Enforces referential integrity between master entities and transactions.

---

## 5. Synchronization Lifecycle & Dual-Database Consistency

### 5.1 Pipeline Stages
1. **Discovery**: Verify active Tally company via loopback HTTP (`127.0.0.1:9000`).
2. **Master Ingestion**: Extract Debtors (`CM`), Account Groups (`CMGRP`), Items (`IM`), Item Groups (`IMGRP`), General Ledgers (`LEDGER`).
3. **Voucher Ingestion**: Extract Sales/Purchase/Notes (`SPCD`) and Bank Payment/Receipt (`BPBR`) in 500-voucher batches.
4. **Outstandings Ingestion**: Calculate Bill-Wise Receivables (`COA`) and Payables (`VOA`) with 4 aging buckets (0-30, 31-60, 61-90, 90+ days).
5. **Durable Checkpoint**: Record `maxAlterId`, processed records, and success timestamp to `sync_state.json` and `sync_log.json`.

### 5.2 Dual-Database Consistency Strategy
Because the company database and central database are physically separate SQLite files, distributed 2-phase commit is not natively supported:
1. **Company Database First**: Transactions are committed to the company database first (`comp_db.commit()`).
2. **Central Mirror Reconciliation**: Once the company database commit succeeds, the central mirror is updated.
3. **Durable Recovery**: If the central mirror update fails, the failure is logged to `sync_log.json`. The central mirror can be repaired at any time by executing the reconciliation migration from the company database.
4. **Idempotent Upsert**: All database writes use `INSERT OR REPLACE INTO` indexed by `(companyId, sourceObjectId)`, guaranteeing that repeated or interrupted sync cycles never produce duplicate accounting records.

---

## 6. Offline-First API Architecture

1. **Zero-Dependency Serving**: All dashboards, financial KPIs, voucher listings, ledger reports, and outstanding summaries query the company's dedicated `database.sqlite`.
2. **Tally Disconnect Resilience**: When Tally is not running or disconnected, requests complete in < 5ms from local storage.
3. **Metadata Freshness Reporting**: Every response enriches the payload with:
   ```json
   {
     "isLocalAvailable": true,
     "localDatabaseSize": 22982656,
     "lastSyncTime": "2026-09-21T06:31:38.081739Z",
     "isStale": false,
     "syncStatus": "COMPLETED"
   }
   ```

---

## 7. Security & Backup Isolation

1. **Path Traversal Protection**: Folder names are sanitized using regex (`re.sub(r'[\\/*?:"<>| ]+', "_", ...)`), rejecting relative path separators (`..`).
2. **Safe Backup Archives**:
   - `database.sqlite` WAL is flushed prior to backup using `PRAGMA wal_checkpoint(FULL)`.
   - Zipped into `backups/backup_{companyId}_{timestamp}.zip` containing `database.sqlite`, `company.json`, `sync_state.json`, and `backup_manifest.json`.
3. **Cross-Company Restore Attack Prevention**:
   - The restore handler inspects `backup_manifest.json` inside the archive prior to extraction.
   - If `manifest["companyId"] != targetCompanyId`, the restore is aborted immediately with HTTP 400.
   - After extraction, `PRAGMA integrity_check` is executed to verify SQLite file validity.
