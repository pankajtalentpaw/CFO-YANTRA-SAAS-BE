@echo off
title Stop CFO Yantra Backend Server
echo ===================================================
echo   Stopping CFO Yantra Backend Server (Port 5000)...
echo ===================================================

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5000 ^| findstr LISTENING') do (
    echo Terminating PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [OK] Port 5000 has been cleared.
echo.
pause
