@echo off
REM Copia de seguridad diaria de la Herramienta. A las 21:30, cuando el dia ya
REM esta entero (palets incluidos), con reintento cada 30 min por si el equipo
REM estaba dormido o sin red: el propio script se planta si la copia de hoy ya
REM esta hecha y verificada, asi que repetirlo no cuesta nada.
REM
REM Que guarda y donde, en la cabecera de scripts/copia-seguridad.mjs.
REM La restauracion (de prueba o de verdad): scripts/restaurar-copia.mjs.
REM
REM Se programa con (ver scripts/arreglar-tareas.ps1):
REM   schtasks /Create /TN "Lasarte - Copia de seguridad" /SC DAILY /ST 21:30

chcp 65001 > nul
cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"

echo --- %DATE% %TIME% --- >> "outputs\log-copia-seguridad.txt"
call node scripts\copia-seguridad.mjs >> "outputs\log-copia-seguridad.txt" 2>&1
if errorlevel 1 echo ERROR: la copia fallo, se reintentara en 30 min >> "outputs\log-copia-seguridad.txt"
