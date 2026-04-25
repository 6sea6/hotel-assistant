@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 936 >nul

cd /d "%~dp0"

set "BUILD_MODE=%BUILD_MODE%"
set "NO_PAUSE=%NO_PAUSE%"
set "EXIT_CODE=0"

for /f "delims=" %%I in ('node -p "require('./package.json').version" 2^>nul') do set "APP_VERSION=%%I"
if not defined APP_VERSION set "APP_VERSION=unknown"

title Hotel Comparison Packager v%APP_VERSION%

echo ========================================
echo   Hotel Comparison Packager v%APP_VERSION%
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    set "EXIT_CODE=1"
    goto END
)

echo [1/2] Choose build mode
echo.
echo   1. Base package
echo   2. Full package with scraper resources
echo.
if "%BUILD_MODE%"=="1" goto BUILD
if "%BUILD_MODE%"=="2" goto BUILD
set /p BUILD_MODE=Select mode (1/2, default 1): 
if not defined BUILD_MODE set "BUILD_MODE=1"
if not "%BUILD_MODE%"=="1" if not "%BUILD_MODE%"=="2" set "BUILD_MODE=1"

:BUILD
echo.
echo [2/2] Running Node packaging pipeline...
node scripts\package\run-build.js --mode %BUILD_MODE%
if errorlevel 1 (
    echo [ERROR] Packaging failed.
    set "EXIT_CODE=1"
    goto END
)

echo.
echo ========================================
echo   Build completed
echo ========================================
if exist dist\last-successful-setup.txt (
    echo.
    echo Latest installer:
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
