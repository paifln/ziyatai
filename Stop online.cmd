@echo off
cd /d "%~dp0"
node scripts\deploy\laptop-backend.mjs stop
pause
