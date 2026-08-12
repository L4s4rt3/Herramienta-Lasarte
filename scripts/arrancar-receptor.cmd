@echo off
REM Arranca el receptor de informes del calibrador si no esta ya escuchando.
REM
REM Pensado para que lo llame una tarea programada cada pocos minutos: si el
REM receptor ya esta vivo, el puerto 25 esta ocupado, este intento muere solo en
REM menos de un segundo y no pasa nada. Si no esta, arranca y se queda.
REM
REM No hace falta comprobar nada aqui: el propio receptor detecta EADDRINUSE y
REM sale. Menos codigo que pueda equivocarse.

chcp 65001 > nul
cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"
node scripts\receptor-informes-calibrador.mjs >> "outputs\log-receptor.txt" 2>&1
