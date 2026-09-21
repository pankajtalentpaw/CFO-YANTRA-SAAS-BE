# CFO YANTRA — DESKTOP PACKAGING & DISTRIBUTION SPECIFICATION

## Executive Summary
This document specifies the PyInstaller desktop packaging configuration, binary layout, dependency bundling, and Electron sidecar distribution for the Python backend.

---

## 1. PyInstaller Build Architecture

```
+-------------------------------------------------------------+
|                     PyInstaller Engine                      |
|                                                             |
|  Entrypoint: python_backend/run.py                          |
|  Output: resources/bin/cfo-backend.exe (Windows)            |
|                                                             |
|  Bundled Runtimes & Dependencies:                           |
|   - Embedded Python 3.12+ DLLs                              |
|   - aiosqlite, greenlet, sqlalchemy dialects                |
|   - uvicorn, starlette, pydantic, python-socketio           |
|   - defusedxml, passlib, pyjwt                              |
+-------------------------------------------------------------+
```

### PyInstaller Spec File (`python_backend/cfo-backend.spec`):
```python
# -*- mode: python ; coding: utf-8 -*-
block_cipher = None

a = Analysis(
    ['run.py'],
    pathex=['.'],
    binaries=[],
    datas=[('app', 'app')],
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
    console=False,  # Headless background process for Electron
)
```

---

## 2. Build Commands & Verification

### Build Command:
```bash
pyinstaller python_backend/cfo-backend.spec --distpath resources/bin
```

### Electron Pre-Launch Check:
Electron verifies binary existence at `resources/bin/cfo-backend.exe`. If missing, it falls back to development execution (`python python_backend/run.py`).
