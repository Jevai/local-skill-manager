@echo off
cd /d "%~dp0"
echo Starting SkillManager...
"C:\Users\31585\.workbuddy\binaries\python\versions\3.13.12\python.exe" -m pip install -q fastapi uvicorn pyyaml
start http://127.0.0.1:7788
"C:\Users\31585\.workbuddy\binaries\python\versions\3.13.12\python.exe" main.py
pause
