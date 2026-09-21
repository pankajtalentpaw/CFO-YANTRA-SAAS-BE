# CFO YANTRA — DATABASE MIGRATION & DATA SAFETY PLAN

## Executive Summary
CFO Yantra operates on a local SQLite database (`./data/cfo_yantra.sqlite`) in desktop mode and PostgreSQL in cloud multi-tenant mode. A primary requirement is that the Python FastAPI migration **must not destroy, alter, or drop existing data or tables**. The Python backend attaches directly to the existing database schema.

---

## 1. Inventory of Existing Tables (16 Tables)

| # | Table Name | Purpose | Primary Key | Key Relationships / Indices |
|---|------------|---------|-------------|------------------------------|
| 1 | `companies` | Tenant business entities | `id` (INTEGER / UUID) | `unique(name)`, `created_at` |
| 2 | `company_settings` | Financial year & precision configs | `id` | `fk(company_id -> companies.id)` |
| 3 | `users` | System authentication accounts | `id` | `unique(email)`, `role` |
| 4 | `company_users` | Multi-tenant RBAC association | `id` | `fk(company_id)`, `fk(user_id)` |
| 5 | `ledgers` | Chart of Accounts | `id` | `fk(company_id)`, `unique(company_id, name)` |
| 6 | `ledger_groups` | Hierarchical ledger groups | `id` | `fk(company_id)`, `parent_id` |
| 7 | `vouchers` | Financial transaction headers | `id` | `fk(company_id)`, `unique(company_id, voucher_number, date)` |
| 8 | `voucher_entries` | Debit/Credit transaction line items | `id` | `fk(voucher_id)`, `fk(ledger_id)` |
| 9 | `tally_configs` | Tally loopback connection config | `id` | `fk(company_id)` |
| 10 | `sync_checkpoints` | CDC AlterID checkpoints | `id` | `fk(company_id)`, `checkpoint_time` |
| 11 | `sync_logs` | Audit trail of Tally synchronizations | `id` | `fk(company_id)`, `status` |
| 12 | `audit_logs` | User actions & system checkpoints | `id` | `fk(company_id)`, `timestamp` |
| 13 | `analytics_cache` | Pre-aggregated 3D sparse cube slices | `id` | `unique(company_id, cache_key)` |
| 14 | `reports_metadata` | Saved reports & catalogs | `id` | `fk(company_id)` |
| 15 | `tax_reconciliation` | GST/TDS mismatch records | `id` | `fk(company_id)` |
| 16 | `schema_migrations` | Sequelize migration history | `name` | Tracks migration version state |

---

## 2. SQLAlchemy 2.0 Async Models Strategy

1. **Direct Attachment**: SQLAlchemy declarative models mirror existing Sequelize table and column definitions without altering names, types, or nullability.
2. **SQLite WAL Mode**: To ensure non-blocking concurrent reads and safe writes, the SQLite connection executes:
   ```sql
   PRAGMA journal_mode=WAL;
   PRAGMA busy_timeout=5000;
   PRAGMA synchronous=NORMAL;
   ```
3. **JSON Column Unwrapping**: As established in `sqlModelCompat.js:41-54`, columns storing JSON blobs (`data`, `metadata`) are unpacked seamlessly by the model base class or query mapper.

```python
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import inspect

class Base(DeclarativeBase):
    def to_dict(self) -> dict:
        d = {c.key: getattr(self, c.key) for c in inspect(self).mapper.column_attrs}
        # Hoist JSON data payload if present
        if "data" in d and isinstance(d["data"], dict):
            payload = d.pop("data")
            return {**payload, **d}
        return d
```

---

## 3. Data Safety & Zero-DDL Policy

- **No `Base.metadata.drop_all()`**: Strictly forbidden under any environment.
- **No `create_all()` in Production**: Models assume tables already exist. For fresh test runs, an isolated in-memory or scratch SQLite database is provisioned.
- **Rollback Safety**: Since no destructive DDL is run, the existing Node.js backend can be restarted at any point without data loss.
