@echo off
REM ============================================================
REM  Better phpMyAdmin launcher (Windows)
REM ============================================================
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH.
  echo Download it from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies, please wait...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Better phpMyAdmin on http://localhost:8009 ...
node server.js
pause
