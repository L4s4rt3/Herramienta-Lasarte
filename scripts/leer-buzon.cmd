@echo off
REM Lee el buzon de soporte@lasartesat.es y mete lo que llegue en la Herramienta.
REM Cada 30 minutos, en la misma ventana que el receptor.
REM
REM Mientras no esten las credenciales en el .env, deja un aviso en el log y no
REM hace nada mas. Ver scripts/leer-buzon-correo.mjs.

chcp 65001 > nul
cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"

echo --- %DATE% %TIME% --- >> "outputs\log-buzon.txt"
call node scripts\leer-buzon-correo.mjs --aplicar >> "outputs\log-buzon.txt" 2>&1
if errorlevel 1 echo ERROR: no se pudo leer el buzon >> "outputs\log-buzon.txt"
