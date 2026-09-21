@echo off
cd /d "%~dp0"
echo Serving from: %CD%
echo.
echo   text player: http://localhost:8731/
echo.
echo Ctrl+C to stop.
echo.
python -m http.server 8731
