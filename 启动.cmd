@echo off
chcp 65001 >nul
node "%~dp0bin\start.mjs"
if errorlevel 1 pause
