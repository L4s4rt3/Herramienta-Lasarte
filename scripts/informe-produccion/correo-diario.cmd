@echo off
REM Correo automatico diario de RENDIMIENTO (sin euros): el dia de ayer +
REM el acumulado de la semana, a las 09:00. Gemelo diario del informe del
REM lunes, pero corre en el portatil porque necesita los DOCX del calibrador
REM y el export del reloj. Deja rastro en sistema_ejecuciones (vigilante).
set PYTHONIOENCODING=utf-8
cd /d "%~dp0..\.."
node scripts/informe-produccion/correo-diario.mjs %* >> scripts/informe-produccion/salida/correo-diario.log 2>&1
