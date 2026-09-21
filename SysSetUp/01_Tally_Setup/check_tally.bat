@echo off
title TallyPrime Connectivity Test - CFO Yantra
echo ===================================================
echo   Checking TallyPrime Connection on Port 9000...
echo ===================================================
python "%~dp0check_tally.py"
echo.
pause
