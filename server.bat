@echo off
cd /d "%~dp0"
echo Serving from: %CD%
echo.
echo Ctrl+C to stop.
echo.
python server.py
