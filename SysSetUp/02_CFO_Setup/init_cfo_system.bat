@echo off
title CFO Yantra System Setup Initializer
echo ===================================================
echo   Initializing CFO Yantra System Environment...
echo ===================================================
cd /d "%~dp0"
python init_cfo_system.py
echo.
pause
