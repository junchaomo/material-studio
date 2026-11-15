@echo off
cd /d "%~dp0"
node scripts/open-admin.mjs
if errorlevel 1 pause
