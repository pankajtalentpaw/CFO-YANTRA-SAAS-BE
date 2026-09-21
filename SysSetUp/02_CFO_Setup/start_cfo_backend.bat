@echo off
title CFO Yantra Backend Server (Port 5000)
echo ===================================================
echo   Starting CFO Yantra FastAPI Backend Server...
echo ===================================================
if exist "%~dp0..\..\run.py" (
    cd /d "%~dp0..\.."
) else if exist "%~dp0..\..\backend\python_backend\run.py" (
    cd /d "%~dp0..\..\backend\python_backend"
)

if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)

python run.py
pause
