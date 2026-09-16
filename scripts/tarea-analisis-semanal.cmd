@echo off
REM Tarea SEMANAL (lunes 05:45): el analisis completo de la empresa de la semana anterior.
REM
REM POR QUE EXISTE. Jose Maria pidio que cada lunes hubiera un analisis completo de la
REM empresa. Antes se hacia a mano (dos dias de trabajo para la semana 37). Esto lanza
REM scripts\analisis-semanal-empresa.mjs, que lee el ERP, la app y la carpeta de Calidad
REM de la LAN, deja el Excel en outputs\analisis-semanal\ y manda el correo a soporte@
REM (Vadim lo revisa y se lo pasa a Jose Maria).
REM
REM CUANDO. Lunes a las 05:45, ANTES de las 06:00: regla de Vadim (16-09-2026), de 06:00 a
REM 15:00 el ERP tiene que funcionar perfecto y nosotros no nos metemos por medio. A esa
REM hora Mercadona aun no esta facturada: el correo lo marca como ESTIMADO y el analisis se
REM puede volver a sacar a mano por la tarde (node scripts\analisis-semanal-empresa.mjs --enviar)
REM cuando la oficina haya facturado. Lo mismo si RRHH deja la hoja de horas mas tarde.
REM
REM Necesita la red de la oficina (ERP y LAN). Deja rastro en sistema_ejecuciones y latido
REM "analisis-semanal-empresa"; el vigilante avisa si un lunes no corre.
REM
REM Se programa desde scripts\arreglar-tareas.ps1 (entrada "Lasarte - Analisis semanal").

chcp 65001 > nul
cd /d "%~dp0.."
if not exist "outputs\analisis-semanal" mkdir "outputs\analisis-semanal"

echo. >> "outputs\analisis-semanal\log.txt"
echo ===== %DATE% %TIME% ===== >> "outputs\analisis-semanal\log.txt"
call node scripts\analisis-semanal-empresa.mjs --enviar >> "outputs\analisis-semanal\log.txt" 2>&1
echo Fin (codigo %ERRORLEVEL%) >> "outputs\analisis-semanal\log.txt"
