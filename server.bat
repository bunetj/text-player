@echo off
cd /d "%~dp0"
echo Serving from: %CD%
echo.
echo   Cheatread:  http://localhost:8731/telegram/index.html?mode=reader
echo   Roleplay:   http://localhost:8731/telegram/index.html?mode=roleplay
echo.
echo Ctrl+C to stop.
echo.
python -m http.server 8731
