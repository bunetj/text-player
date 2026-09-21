@echo off
cd /d "%~dp0"
echo Serving from: %CD%
echo.
echo   Cheatread:  http://localhost:8731/CHEATREAD/telegram/index.html
echo   Roleplay:   http://localhost:8731/SELF-PLAY/TELEGRAM/index.html
echo.
echo Ctrl+C to stop.
echo.
python -m http.server 8731
