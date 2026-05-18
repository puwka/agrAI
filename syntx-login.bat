@echo off
title Syntx login
cd /d "%~dp0"

set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" goto need_setup

"%PY%" workers\start_worker.py --login
echo.
pause
exit /b 0

:need_setup
echo.
echo  Run setup-syntx-worker.bat first.
echo.
pause
exit /b 1
