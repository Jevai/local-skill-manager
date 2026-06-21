@echo off
cd /d "%~dp0"
echo Starting SkillManager...
"%~dp0.venv\Scripts\python.exe" main.py
pause
