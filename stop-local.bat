@echo off
setlocal

set "DEV_WINDOW_TITLE=MK-EDITOR-DEV"

echo Stopping local dev server window...
taskkill /FI "WINDOWTITLE eq %DEV_WINDOW_TITLE%" /T /F >nul 2>&1

if %errorlevel%==0 (
  echo Dev server window closed.
) else (
  echo No dev server window found with title: %DEV_WINDOW_TITLE%
)
