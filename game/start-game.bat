@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" http://localhost:3000/host
node server.js
pause
