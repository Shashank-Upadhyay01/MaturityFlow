@echo off
title MaturityFlow (local dev)
cd /d "%~dp0"

echo === MaturityFlow - local development ===
echo Database: native PostgreSQL 18 on localhost:5432 (starts automatically).
echo The browser opens at http://localhost:3000 in a few seconds.
echo Leave this window open. Press Ctrl+C to stop.
echo.

REM open the browser once the dev server has had a moment to start
start "" /b cmd /c "timeout /t 7 >nul & start http://localhost:3000"

call npm run dev
