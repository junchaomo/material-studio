@echo off
cd /d "%~dp0"
node scripts/launch-local.mjs
if errorlevel 1 pause
