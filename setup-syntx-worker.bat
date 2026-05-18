@echo off
title Syntx worker setup
cd /d "%~dp0"

set "ROOT=%~dp0"
set "PY=%ROOT%.venv\Scripts\python.exe"

echo.
echo  === Syntx worker - first-time setup ===
echo.

where python >nul 2>&1
if errorlevel 1 goto no_python

echo Python:
python --version
echo.

if exist "%PY%" goto have_venv
echo Creating .venv ...
python -m venv "%ROOT%.venv"
if errorlevel 1 goto venv_fail
if not exist "%PY%" goto venv_fail

:have_venv
echo Installing Python packages...
"%PY%" -m pip install --upgrade pip
if errorlevel 1 goto pip_fail
"%PY%" -m pip install -r "%ROOT%workers\requirements.txt"
if errorlevel 1 goto pip_fail

echo.
echo Installing Chromium for Playwright - may take a few minutes...
"%PY%" -m playwright install chromium
if errorlevel 1 goto playwright_fail

if exist "%ROOT%.env" goto have_env
echo.
echo Creating .env from template...
copy /Y "%ROOT%workers\env.worker.example" "%ROOT%.env" >nul
echo.
echo  IMPORTANT: open .env in Notepad in this folder
echo  and set SITE_BASE_URL and AUTOMATION_WORKER_TOKEN.
echo.

:have_env
echo.
"%PY%" "%ROOT%workers\start_worker.py" --setup-check

echo.
echo Next:
echo   1. Edit .env if you have not yet
echo   2. Run syntx-login.bat
echo   3. Run start-syntx-worker.bat
echo.
pause
exit /b 0

:no_python
echo [ERROR] Python not found.
echo.
echo Install Python 3.10+ from https://www.python.org/downloads/
echo Check "Add python.exe to PATH" during install.
echo.
pause
exit /b 1

:venv_fail
echo [ERROR] Failed to create .venv
pause
exit /b 1

:pip_fail
echo [ERROR] pip install failed
pause
exit /b 1

:playwright_fail
echo [ERROR] playwright install failed
pause
exit /b 1
