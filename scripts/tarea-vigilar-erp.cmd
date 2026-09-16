@echo off
REM Tarea HORARIA (06:05 a 15:05): que el ERP no tenga consultas congeladas.
REM
REM POR QUE EXISTE. El 16-09-2026 una consulta exploratoria nuestra se quedo colgada en el
REM servidor MySQL del ERP y dejo sin servicio a toda la oficina hasta que el tecnico del
REM ERP aviso. Regla de Vadim: de 06:00 a 15:00 el ERP tiene que funcionar perfecto sin que
REM nosotros estorbemos, no se hacen consultas grandes, y cada hora se revisa que no haya
REM nada congelado.
REM
REM QUE HACE. Lanza scripts\vigilar-erp-consultas.mjs: lista los procesos del servidor,
REM cancela las consultas de ESTE equipo que lleven mas de 60 s y deja aviso (latido
REM "vigilar-erp") si hay ajenas de mas de 120 s, bloqueos o transacciones viejas. A las
REM sesiones de los demas equipos no las toca nunca.
REM
REM Se programa con (una sola vez):
REM   schtasks /Create /TN "Lasarte - Vigilar ERP" /TR "\"<ruta>\scripts\tarea-vigilar-erp.cmd\"" /SC HOURLY /ST 06:05 /ET 15:10 /F
REM y despues scripts\arreglar-tareas.ps1 para los ajustes de energia.

chcp 65001 > nul
cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"

echo. >> "outputs\log-vigilar-erp.txt"
echo ===== %DATE% %TIME% ===== >> "outputs\log-vigilar-erp.txt"
call node scripts\vigilar-erp-consultas.mjs >> "outputs\log-vigilar-erp.txt" 2>&1
echo Fin (codigo %ERRORLEVEL%) >> "outputs\log-vigilar-erp.txt"
