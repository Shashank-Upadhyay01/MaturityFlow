@echo off
cd /d "%~dp0"
git push origin payout-cadence-phase-1
echo.
echo Done. Vercel will start building within a few seconds.
pause
