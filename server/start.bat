@echo off
setlocal
title Connect PWA - Server

echo ==========================================
echo          CONNECT PWA - SERVER START       
echo ==========================================

cd /d "%~dp0"

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Check if npm is installed
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm is not installed.
    pause
    exit /b 1
)

:: Install dependencies if node_modules doesn't exist
if not exist node_modules\ (
    echo Installing dependencies...
    call npm install
)

echo Starting server...
call npm start

pause
