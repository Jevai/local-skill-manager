@echo off
cd /d "%~dp0"

set PYTHON=%~dp0.venv\Scripts\python.exe
set MAIN=%~dp0main.py
set PORT=7788

:: Check Python exists
if not exist "%PYTHON%" (
    echo [ERROR] Python not found: %PYTHON%
    echo Run: python -m venv .venv ^&^& .venv\Scripts\pip install fastapi uvicorn
    pause
    exit /b 1
)

:: Check main.py exists
if not exist "%MAIN%" (
    echo [ERROR] main.py not found
    pause
    exit /b 1
)

:: Check if port is already in use and kill the old process
set OLD_PID=
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R ":7788.*LISTENING" 2^>nul') do set OLD_PID=%%a

if not "%OLD_PID%"=="" (
    echo Port %PORT% occupied by PID %OLD_PID% -- killing...
    taskkill /PID %OLD_PID% /F >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Failed to kill PID %OLD_PID%
        pause
        exit /b 1
    )
    timeout /t 1 /nobreak >nul
)

:: Start server in minimized window
start "" /min "%PYTHON%" "%MAIN%"

:: Wait for server to be ready, then open browser
echo Starting SkillManager...
timeout /t 3 /nobreak >nul
start http://127.0.0.1:%PORT%

echo Done. Server running minimized on http://127.0.0.1:%PORT%

:: Auto-close this window after 2 seconds
timeout /t 2 /nobreak >nul
