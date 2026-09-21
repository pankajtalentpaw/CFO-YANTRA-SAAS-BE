# CFO YANTRA — DESKTOP PACKAGING & ELECTRON INTEGRATION PLAN

## Executive Summary
CFO Yantra distributes as an Electron desktop application on Windows, macOS, and Linux. The backend runs as a local sidecar process launched and monitored by Electron's main process. This document specifies the packaging pipeline using PyInstaller, dynamic port allocation, health check readiness probing, and graceful shutdown signal propagation.

---

## 1. Electron Main Process Lifecycle Integration

### 1.1. Process Spawning & Dynamic Port Binding
When Electron launches:
1. Electron selects an available ephemeral port (default `5001`, with fallback scan from `5001` to `5050`).
2. Electron spawns the backend binary:
   - Development: `python python_backend/run.py --port 5001`
   - Production: `resources/bin/cfo-backend.exe --port 5001`
3. Electron waits for the health check probe (`GET http://127.0.0.1:5001/health`) to return `{ "status": "ok" }` before loading the React browser window.

### 1.2. Graceful Shutdown & Process Cleanup
On `window-all-closed` or `app.quit()`:
1. Electron sends `SIGINT` (or `SIGTERM`) to the child process.
2. The FastAPI application catches the signal via lifespan shutdown, closes active SQLite connections, flushes WAL logs, and exits with code 0.
3. If the process does not terminate within 5 seconds, Electron issues `SIGKILL` to prevent orphaned background zombies.

---

## 2. PyInstaller Packaging Specification

### Specification File: `cfo-backend.spec`
```python
# -*- mode: python ; coding: utf-8 -*-
block_cipher = None

a = Analysis(
    ['python_backend/run.py'],
    pathex=['python_backend'],
    binaries=[],
    datas=[
        ('python_backend/app', 'app'),
    ],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespans',
        'uvicorn.lifespans.on',
        'aiosqlite',
        'sqlalchemy.dialects.sqlite',
        'engineio.async_drivers.asgi',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'notebook', 'scipy'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='cfo-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Set to True for dev/debug, False for silent prod window
)
```
