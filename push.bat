@echo off
REM ============================================
REM  BSC Group Portal - Backend : push to GitHub
REM  Stages all changes, commits, and pushes.
REM ============================================

cd /d "%~dp0"

echo.
echo === Staging changes ===
git add .

REM Ask for a commit message; use a default if left blank
set "msg="
set /p msg="Commit message (press Enter for default): "
if "%msg%"=="" set "msg=Update backend"

echo.
echo === Committing: %msg% ===
git commit -m "%msg%"

echo.
echo === Pushing to GitHub ===
git push

echo.
echo === Done ===
pause
