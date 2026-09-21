# CFO YANTRA — BACKGROUND JOBS & SYNCHRONIZATION RUNNER

## Executive Summary
This document defines the architecture, worker lifecycle, ownership enforcement, and error recovery mechanisms for CFO Yantra's background tasks. It addresses the critical multi-worker concurrency hazard to ensure that polling, Tally sync loops, and CDC jobs never execute concurrently across multiple processes.

---

## 1. Single-Worker Ownership Architecture

### The Concurrency Hazard
Running a FastAPI application with multiple ASGI workers (`uvicorn app.main:app --workers 4`) starts the lifespan startup handler in *every* worker process. If background jobs are initialized in the lifespan handler, all 4 processes will simultaneously poll TallyPrime on port 9000 and write to the local SQLite database. This produces:
1. HTTP 503 socket starvation on Tally.
2. `sqlite3.OperationalError: database is locked` on the local database.

### Mitigation Strategy
1. **Desktop / Electron Deployment**:
   - The Electron main process launches the Python backend with `--workers 1`.
   - A single background `asyncio` task loop is started during the application lifespan.
2. **Cloud / Multi-Tenant Deployment**:
   - API workers run with `ENABLE_BACKGROUND_JOBS=false`.
   - A dedicated worker container (or single Celery / Arq instance) runs with `ENABLE_BACKGROUND_JOBS=true`.

```python
# python_backend/app/main.py
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    if settings.ENABLE_BACKGROUND_JOBS:
        sync_runner = get_sync_runner()
        sync_task = asyncio.create_task(sync_runner.start_polling_loop())
    yield
    # Shutdown
    if settings.ENABLE_BACKGROUND_JOBS:
        sync_runner.stop()
        await sync_task
```

---

## 2. Background Task Inventory

| Task Name | Schedule / Trigger | Responsibility | Concurrency Lock |
| :--- | :--- | :--- | :--- |
| `tally_cdc_poll` | Every 60 seconds (configurable) | Fetch new vouchers with AlterID > checkpoint | Exclusive company lock |
| `cache_invalidation` | On voucher update | Purge 3D cube slices affected by altered vouchers | Async company lock |
| `auto_backup` | Daily at 02:00 AM | Creates a snapshot copy of `cfo_yantra.sqlite` | File lock |
| `cross_verification_check` | Post-sync event | Runs CV01–CV16 verification engine | Non-blocking background worker |

---

## 3. Error Handling & Stale Lock Recovery
- **Exponential Backoff**: If TallyPrime is unreachable (connection refused / timeout), the polling loop enters exponential backoff (5s, 10s, 30s, max 60s).
- **Graceful Cancellation**: Background loops observe `asyncio.CancelledError` on server shutdown, allowing active in-flight database transactions to commit before process termination.
