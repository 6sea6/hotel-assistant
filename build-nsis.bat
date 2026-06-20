@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

cd /d "%~dp0"

set "NO_PAUSE=%NO_PAUSE%"
set "EXIT_CODE=0"
set "AMAP_KEY_ARG=--select-amap-key"
if "%NO_PAUSE%"=="1" set "AMAP_KEY_ARG=--with-amap-key"

title hotel-comparison-app packager

if /I "%~1"=="--with-amap-key" set "AMAP_KEY_ARG=--with-amap-key"
if /I "%~1"=="--no-amap-key" set "AMAP_KEY_ARG=--no-amap-key"
if /I "%~1"=="--without-amap-key" set "AMAP_KEY_ARG=--no-amap-key"

where node >nul 2>&1
if errorlevel 1 (
    echo [error] Node.js was not found.
    set "EXIT_CODE=1"
    goto END
)

node scripts\package\run-build.js %AMAP_KEY_ARG%
if errorlevel 1 (
    echo [error] Build failed.
    set "EXIT_CODE=1"
    goto END
)

if exist dist\last-successful-setup.txt (
    echo.
    echo Installer path:
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
