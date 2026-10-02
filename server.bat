@echo off
cd /d "%~dp0"
start "" /b py server.py --no-browser --port 8731
timeout /t 2 /nobreak >nul
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://127.0.0.1:8731/index.html --window-size=1100,800
