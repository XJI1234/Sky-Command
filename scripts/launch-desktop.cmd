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

rem Installed Sky Command.exe and a leftover `npm run desktop` both bind 8080.
taskkill /IM "Sky Command.exe" /F >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'Name=''electron.exe''' | Where-Object { $_.CommandLine -like '*Sky Command*node_modules*electron.exe*electron\main.mjs*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

start "" "%CD%\node_modules\electron\dist\electron.exe" electron\main.mjs
