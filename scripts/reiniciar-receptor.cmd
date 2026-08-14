@echo off
REM Reinicia el receptor de informes del calibrador SIN pensar: mata el proceso
REM que escucha el puerto 25 y deja que su tarea programada lo relance (cada
REM 5 min dentro de su ventana 06:00-22:00; fuera de ella, al dia siguiente a
REM las 06:00 ? por eso reiniciar de noche no pierde nada).
REM
REM PARA QUE. Un proceso Node no se entera de que sus ficheros han cambiado:
REM cada vez que se toque el codigo del receptor hay que reiniciarlo, y hacerlo
REM a mano con el administrador de tareas invita a matar el proceso que no es.
REM Existe tambien como tarea programada "Lasarte - Reiniciar receptor": darle
REM a Ejecutar en el Programador de tareas hace esto mismo.

chcp 65001 > nul
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 25 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force; Write-Host ('receptor parado (PID ' + $_ + ')') }"
echo Hecho: si escuchaba, ya esta parado. Su tarea lo relanza sola.
