@echo off
REM Foto del total de palets del ERP. Se lanza cada hora de 12:00 a 00:00 para
REM averiguar a que hora el ERP dice lo mismo que el Excel del GSTOCK, y de paso
REM medir lo que queda sin dar de alta al cierre.
REM
REM No escribe en ningun parte ni toca el ERP: solo SELECT y una fila en
REM erp_palets_foto. Ver scripts/capturar-palets-erp.mjs.
REM
REM Se programa con:
REM   schtasks /Create /TN "Lasarte - Foto palets ERP" /TR "<ruta>\foto-palets.cmd" ^
REM     /SC DAILY /ST 12:00 /RI 60 /DU 0012:00 /F

chcp 65001 > nul
cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"

echo --- %DATE% %TIME% --- >> "outputs\log-foto-palets.txt"
call node scripts\capturar-palets-erp.mjs >> "outputs\log-foto-palets.txt" 2>&1
if errorlevel 1 echo ERROR: no se pudo tomar la foto >> "outputs\log-foto-palets.txt"
