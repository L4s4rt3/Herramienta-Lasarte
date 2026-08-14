@echo off
REM Arranca el receptor de informes del calibrador si no esta ya escuchando.
REM
REM Pensado para que lo llame una tarea programada cada pocos minutos: si el
REM receptor ya esta vivo, este intento muere solo y no pasa nada.
REM
REM POR QUE MUERE, que no es lo que ponia aqui antes. La idea original era que
REM node arrancase, viera el puerto ocupado (EADDRINUSE) y saliera. En realidad
REM node NI SIQUIERA ARRANCA: el receptor que ya esta vivo tiene abierto
REM log-receptor.txt por la redireccion, y el `>>` de abajo falla antes con "el
REM proceso no tiene acceso al archivo porque esta siendo utilizado por otro
REM proceso". El resultado es el mismo y esta bien, pero conviene saberlo.
REM
REM Y DE AHI EL SEGUNDO FICHERO. Ese fallo se lo come cmd por una salida que
REM nadie ve (el .vbs la lanza sin ventana), asi que los intentos no dejaban
REM rastro: el 14-08-2026 el receptor se murio, la tarea reintento, y no habia
REM forma de saber si habia llegado a intentarlo. El log de intentos se abre y
REM se cierra en el mismo echo, asi que nunca se queda bloqueado y siempre se
REM puede escribir.
REM
REM Como se lee: dos lineas seguidas con la MISMA hora = no tomo, el receptor
REM ya estaba vivo. Una linea de intento y la de fin horas despues = ese SI era
REM el receptor, y murio a la hora que diga el fin.

chcp 65001 > nul
cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"

set "INTENTOS=outputs\log-receptor-intentos.txt"

>> "%INTENTOS%" echo [%date% %time%] intento de arranque
node scripts\receptor-informes-calibrador.mjs >> "outputs\log-receptor.txt" 2>&1
>> "%INTENTOS%" echo [%date% %time%] fin (codigo %errorlevel%)
