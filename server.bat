@echo off
cd /d "%~dp0"
start "" /b py server.py --no-browser --port 8731
start "" "C:\Program Files\Mozilla Firefox\firefox.exe" "http://127.0.0.1:8731"