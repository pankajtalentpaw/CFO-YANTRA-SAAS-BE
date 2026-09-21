# CFO YANTRA — ELECTRON & REACT INTEGRATION SPECIFICATION

## Executive Summary
This document specifies how the Electron desktop frontend coordinates with the Python/FastAPI backend in `python_backend/`. It covers child process spawning, port discovery, readiness probing on `/health`, IPC handlers, and clean process lifecycle termination.

---

## 1. Process Lifecycle & Port Discovery

1. **Port Allocation**:
   - Default Port: `5001`.
   - Electron inspects port availability. If `5001` is busy, it probes ephemeral ports incrementally up to `5050`.
2. **Spawning Command**:
   - In Development:
     ```bash
     python python_backend/run.py --host 127.0.0.1 --port 5001 --workers 1
     ```
   - In Production Package:
     ```bash
     resources/bin/cfo-backend.exe --host 127.0.0.1 --port 5001 --workers 1
     ```
3. **Readiness Probe**:
   - Electron polls `GET http://127.0.0.1:5001/health` every 100ms for up to 15 seconds.
   - Upon receiving HTTP 200 `{ "status": "HEALTHY" }`, Electron initializes the React `BrowserWindow` and passes `http://127.0.0.1:5001/api/v1` as `window.ENV.API_BASE_URL`.

---

## 2. Graceful Shutdown

1. When the user closes the Electron window (`app.on("window-all-closed")` or `app.quit()`):
   - Electron sends `SIGINT` (or `SIGTERM`) to the Python child process.
   - The FastAPI lifespan shutdown handler executes, cleans up active async database sessions, and terminates cleanly.
   - If the process does not terminate within 5 seconds, Electron issues `SIGKILL` to prevent background zombie processes.

---

## 3. Frontend Zero-Change Compatibility Verification
- Response envelopes (`{ success: true, data: ..., message: ... }`) match 100%.
- CamelCase JSON serialization via Pydantic v2 `BaseCamelModel` ensures React components read `companyId`, `voucherNumber`, `alterId` without modification.
- Socket.io connection (`/socket.io/`) supported natively via `python-socketio` ASGI mount.
