@echo off
REM Foto del total de palets del ERP. Cada hora de 06:00 a 00:00.
REM
REM Sirve para dos cosas (ver scripts/lib-cierre-alta.mjs):
REM   1. Deducir a que hora se termina de dar de alta, sin tener que preguntarlo
REM      cada vez que cambia el turno.
REM   2. Medir lo que quedo SIN DAR DE ALTA: la diferencia entre la foto del
REM      cierre y la de la mañana siguiente. Por eso empieza a las 06:00, para
REM      tener foto temprana, y por eso cada pasada fotografia AYER ademas de HOY.
REM
REM No escribe en ningun parte ni toca el ERP: solo SELECT y una fila en
REM erp_palets_foto.
REM
REM Se programa con (ver scripts/arreglar-tareas.ps1):
REM   /SC DAILY /ST 06:00 /RI 60 /DU 0018:00

chcp 65001 > nul
cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"

echo --- %DATE% %TIME% --- >> "outputs\log-foto-palets.txt"
call node scripts\capturar-palets-erp.mjs >> "outputs\log-foto-palets.txt" 2>&1
if errorlevel 1 echo ERROR: no se pudo tomar la foto >> "outputs\log-foto-palets.txt"
