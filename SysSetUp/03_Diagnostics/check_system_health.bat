@echo off
title CFO Yantra & Tally End-to-End System Diagnostics
echo ===================================================
echo   Running Complete System Diagnostic Suite...
echo ===================================================
cd /d "%~dp0"
python check_system_health.py
echo.
pause
