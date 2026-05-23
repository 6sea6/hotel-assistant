@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

cd /d "%~dp0"

set "BUILD_MODE=%BUILD_MODE%"
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

echo [1/2] 选择打包模式
echo.
echo   1. 基础版安装包
echo   2. 完整版安装包（包含采集模块资源）
echo.
if "%BUILD_MODE%"=="1" goto BUILD
if "%BUILD_MODE%"=="2" goto BUILD
set /p BUILD_MODE=请选择打包模式（1/2，默认 1）：
if not defined BUILD_MODE set "BUILD_MODE=1"
if not "%BUILD_MODE%"=="1" if not "%BUILD_MODE%"=="2" set "BUILD_MODE=1"

:BUILD
echo.
echo [2/2] 开始打包...
node scripts\package\run-build.js --mode %BUILD_MODE%
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
