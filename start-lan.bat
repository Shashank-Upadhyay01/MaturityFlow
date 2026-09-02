@echo off
title KGGNL Core (LAN)
cd /d "%~dp0"

echo === Building KGGNL Core (production) ===
call npm run build
if errorlevel 1 (
  echo.
  echo Build FAILED. Fix the errors above, then run this again.
  pause
  exit /b 1
)

echo.
echo === Addresses branch PCs can use ===
ipconfig | findstr /C:"IPv4"
echo.
echo   This PC:   http://localhost:3000
echo   Branches:  http://^<the 192.168.x.x address above^>:3000
echo.
echo One time only, in an Administrator terminal, allow the port through the firewall:
echo   netsh advfirewall firewall add rule name="MaturityFlow" dir=in action=allow protocol=TCP localport=3000
echo.
echo Make sure .env has APP_URL set to the LAN address and COOKIE_SECURE=false.
echo (Over plain HTTP a Secure cookie is dropped and nobody can sign in.)
echo.
echo === Starting server - leave this window open ===
call npm run start
