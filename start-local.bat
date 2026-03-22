@echo off
setlocal

set "DEV_WINDOW_TITLE=MK-EDITOR-DEV"

echo Starting local dev server in a new terminal window...
start "%DEV_WINDOW_TITLE%" cmd /k "cd /d %~dp0 && npm run dev"

echo Dev server launch command sent.
echo Window title: %DEV_WINDOW_TITLE%
