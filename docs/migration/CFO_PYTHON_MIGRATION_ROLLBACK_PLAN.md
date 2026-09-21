# CFO YANTRA — MIGRATION ROLLBACK & DATA RECONCILIATION PLAN

## Executive Summary
This document specifies the rollback protocol and data preservation procedures in the event of unforeseen behavioral, financial, or stability discrepancies during migration cutover. Because no destructive schema changes are introduced to the SQLite or PostgreSQL databases, instant fallback to the Node.js backend is guaranteed with zero data loss.

---

## 1. Rollback Triggers

A rollback to the Node.js backend must be initiated immediately if any of the following conditions occur:
1. **Financial Discrepancy (Critical)**: Any deviation (> $0.00) between Node and Python calculations on standard trial balance or balance sheet reports.
2. **Tally Connection Deadlock**: Socket starvation or unhandled connection locks preventing voucher synchronization.
3. **Database Write Lock Contention**: Persistent `database is locked` errors lasting > 30 seconds on SQLite.
4. **Electron Crash**: Backend failure causing the Electron desktop window to fail startup.

---

## 2. Step-by-Step Rollback Execution

### Desktop (Electron) Environment:
1. **Stop Python Process**: Electron sends `SIGTERM` / `SIGKILL` to `cfo-backend.exe` / `python_backend/run.py`.
2. **Switch Backend Executable**: Revert Electron main process configuration `BACKEND_TYPE` from `python` to `node`.
3. **Launch Node Backend**: Electron spawns `node src/server.js` on the standard port.
4. **Database Verification**: Since Python and Node share identical SQLite table definitions and commit transactions using standard SQLite WAL checkpoints, all records written by Python remain immediately readable by Sequelize in Node.js.

### Cloud / Docker Environment:
1. **Traffic Switch**: Update Nginx upstream proxy or load balancer to route incoming traffic back to the Node container cluster:
   ```bash
   docker-compose stop api worker
   docker-compose up -d node_backend
   ```
2. **Verify Health**: Probe `http://api.cfoyantra.com/health` to confirm Node.js Express service restoration.

---

## 3. Data Reconciliation Procedure
Because both implementations write to the exact same database tables with identical column constraints and JSON payloads:
- All vouchers and ledgers synchronized by Python have valid `AlterID` checkpoints recorded in `sync_checkpoints`.
- Upon Node.js resumption, the Node CDC runner reads the latest `AlterID` from `sync_checkpoints` and resumes without duplicate syncs or missing transactions.
