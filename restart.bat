@echo off
REM ============================================================
REM  Better phpMyAdmin - sauberer Neustart
REM  Beendet gezielt nur den Server auf Port 8009 und startet
REM  ihn frisch, damit Code-Aenderungen wirklich geladen werden.
REM ============================================================
cd /d "%~dp0"

echo Beende laufenden Server auf Port 8009 (falls vorhanden)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8009" ^| findstr "LISTENING"') do (
  echo   -> beende PID %%p
  taskkill /PID %%p /F >nul 2>nul
)

echo.
echo Starte Better phpMyAdmin frisch auf http://localhost:8009 ...
echo (Fenster offen lassen, solange der Server laufen soll. Beenden mit Strg+C.)
echo.
node server.js
pause
