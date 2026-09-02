@echo off
REM Ensayo TRIMESTRAL de restauracion de la copia de seguridad.
REM
REM La copia diaria demuestra que se hace; esto demuestra que SIRVE: carga la
REM ultima copia entera en el esquema aparte `restauracion`, compara recuentos
REM con el manifiesto y lo limpia. No toca las tablas reales. Tarda unos
REM minutos. Deja latido "prueba-restauracion" (lo vigila el vigilante: mas de
REM 130 dias sin ensayo es una averia). Hasta el 02-09-2026 se lanzaba a mano.
REM
REM Se programa con (ver scripts/arreglar-tareas.ps1, que la crea si no existe):
REM   schtasks /Create /TN "Lasarte - Ensayo restauracion" /SC MONTHLY /M JAN,APR,JUL,OCT /D 2 /ST 22:45

chcp 65001 > nul
cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"

echo --- %DATE% %TIME% --- >> "outputs\log-restaurar-copia.txt"
call node scripts\restaurar-copia.mjs >> "outputs\log-restaurar-copia.txt" 2>&1
if errorlevel 1 echo ERROR: el ensayo de restauracion NO cuadro (el latido lo dice; mirar arriba) >> "outputs\log-restaurar-copia.txt"
