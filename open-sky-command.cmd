@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing Sky Command desktop dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check the network and retry.
    pause
    exit /b 1
  )
)
if not exist "electron\main.mjs" (
  echo Building Sky Command desktop app...
  call npm run build
  if errorlevel 1 (
    echo npm run build failed.
    pause
    exit /b 1
  )
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0electron\main.mjs"
