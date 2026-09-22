@echo off
REM Windows launcher for the Paseo Desktop dev startup script (turn-recovery).
REM Runs the sibling start-paseo-dev.ps1 from this same directory.
REM Usage: double-click this file, or run it from a terminal:
REM     .\scripts\start-paseo-dev.bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-paseo-dev.ps1"