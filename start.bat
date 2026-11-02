@echo off
rem Run ChurchStream from source (developers). Most people should use ChurchStream.exe instead.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 or newer is required: https://nodejs.org & pause & exit /b 1)
node server.js
pause
