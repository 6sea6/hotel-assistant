@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 936 >nul

cd /d "%~dp0"

set "NO_PAUSE=%NO_PAUSE%"
set "EXIT_CODE=0"

for /f "delims=" %%I in ('node -p "require('./package.json').version" 2^>nul') do set "APP_VERSION=%%I"
if not defined APP_VERSION set "APP_VERSION=unknown"

title 宾馆比较终极版打包工具 v%APP_VERSION%

echo ========================================
echo   宾馆比较终极版打包工具 v%APP_VERSION%
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js。
    set "EXIT_CODE=1"
    goto END
)

echo.
echo [1/1] 开始打包...
node scripts\package\run-build.js
if errorlevel 1 (
    echo [错误] 打包失败。
    set "EXIT_CODE=1"
    goto END
)

echo.
echo ========================================
echo   打包完成
echo ========================================
if exist dist\last-successful-setup.txt (
    echo.
    echo 安装包路径：
    type dist\last-successful-setup.txt
)

:END
echo.
if not "%EXIT_CODE%"=="0" (
    if "%NO_PAUSE%"=="1" exit /b %EXIT_CODE%
    pause
    exit /b %EXIT_CODE%
)
if "%NO_PAUSE%"=="1" exit /b 0
pause
exit /b 0