@echo off
setlocal
echo ============================================================
echo   BlockX: Disabling Local Machine Sharing
echo ============================================================
echo.

where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
    py "%~dp0disable_local_sharing.py" %*
    goto end
)

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    python "%~dp0disable_local_sharing.py" %*
    goto end
)

where python3 >nul 2>&1
if %ERRORLEVEL% equ 0 (
    python3 "%~dp0disable_local_sharing.py" %*
    goto end
)

echo [ERROR] Python was not found on your system.
echo Please install Python 3 from https://python.org and tick "Add Python to PATH".
echo.

:end
echo.
pause
