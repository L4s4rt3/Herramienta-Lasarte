@echo off
REM Tarea SEMANAL: lleva los fichajes del reloj a la asistencia de la app.
REM
REM POR QUE EXISTE. Hasta el 04-09-2026 la asistencia solo entraba a mano desde
REM la pantalla, y estuvo un MES parada (04-08 -> 04-09) mientras habia
REM produccion todos los dias. Sin asistencia no hay personas, y sin personas
REM la rentabilidad del dia, el analisis por tipo de dia y el semaforo de
REM rendimiento se quedan ciegos: eso es lo que paso en agosto.
REM
REM CUANDO. Los lunes, que es cuando se volcaba a mano y cuando estan las
REM semanas COMPLETAS (la semana en curso siempre esta vacia a proposito).
REM
REM EL PASO HUMANO QUE QUEDA: alguien tiene que exportar la semana del programa
REM del reloj a scripts\informe-produccion\ (asistencias*.xlsx). Si el fichero
REM no esta, el script NO inventa nada: lo dice en el log y en la base
REM (sistema_ejecuciones), y el vigilante avisa por correo.
REM
REM Sin argumentos coge desde el dia siguiente al ultimo cargado hasta ayer, y
REM nunca pisa un dia ya tecleado en la app (para eso haria falta --forzar).

cd /d "%~dp0.."

echo(>> "outputs\log-asistencia-reloj.txt"
echo ===== %DATE% %TIME% =====>> "outputs\log-asistencia-reloj.txt"
call node scripts\importar-asistencia-reloj.mjs --aplicar >> "outputs\log-asistencia-reloj.txt" 2>&1
echo Fin (codigo %ERRORLEVEL%)>> "outputs\log-asistencia-reloj.txt"
