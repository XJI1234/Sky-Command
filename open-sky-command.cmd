@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 正在安装 Sky Command 桌面运行依赖，请稍候...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
if not exist "electron\main.mjs" (
  echo 正在构建 Sky Command 桌面程序，请稍候...
  call npm run build
  if errorlevel 1 (
    echo 构建失败。
    pause
    exit /b 1
  )
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0electron\main.mjs"
