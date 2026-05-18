@echo off
title Syntx worker
cd /d "%~dp0"

set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" goto need_setup

"%PY%" workers\start_worker.py
if errorlevel 1 pause
exit /b %errorlevel%

:need_setup
echo.
echo  Run setup-syntx-worker.bat first.
echo.
pause
exit /b 1
