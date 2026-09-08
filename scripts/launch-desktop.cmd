@echo off
setlocal
cd /d "%~dp0.."

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is missing. Run npm install in this folder.
  pause
  exit /b 1
)
if not exist "electron\main.mjs" (
  echo Desktop build is missing. Run npm run build first.
  pause
  exit /b 1
)

rem The installed Sky Command.exe binds 8080/19500 and is a stale package.
taskkill /IM "Sky Command.exe" /F >nul 2>&1

start "" "%CD%\node_modules\electron\dist\electron.exe" electron\main.mjs
