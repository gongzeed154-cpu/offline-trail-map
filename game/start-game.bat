@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install from https://nodejs.org then run this file again. & pause & exit /b 1)
rem Start the game server in its own window, wait, then open the teacher screen
start "Game Server - do not close" cmd /k node server.js
timeout /t 3 /nobreak >nul
start "" http://localhost:3000/host
echo.
echo Teacher screen: http://localhost:3000/host
echo If the map is blank, open the check page: http://localhost:3000/check
echo You may close THIS window, but do NOT close the "Game Server" window.
pause
