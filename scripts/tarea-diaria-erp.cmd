@echo off
REM Tarea diaria: trae del ERP las entradas de fruta y la trazabilidad de palets,
REM y manda el aviso con el resultado.
REM
REM Va en un solo .cmd a proposito: los dos sincronizadores NO deben solaparse,
REM y el aviso tiene que ir despues para poder contar lo que ha pasado.
REM
REM Se programa con:
REM   schtasks /Create /TN "Lasarte - Sincronizar ERP" /TR "<ruta a este .cmd>" /SC DAILY /ST 06:00 /F

REM UTF-8: sin esto el log sale con acentos y tablas rotas, y el log es
REM justo lo que se mira cuando algo falla.
chcp 65001 > nul

cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"

set LOG=outputs\log-tarea-diaria.txt

echo. >> "%LOG%"
echo ================================================================ >> "%LOG%"
echo INICIO %DATE% %TIME% >> "%LOG%"

echo --- entradas de fruta --- >> "%LOG%"
call node scripts\sincronizar-entradas-erp.mjs --aplicar --rellenar-huecos >> "%LOG%" 2>&1
if errorlevel 1 echo ERROR: fallo la sincronizacion de entradas >> "%LOG%"

echo --- trazabilidad de palets --- >> "%LOG%"
call node scripts\sincronizar-trazabilidad-palet-erp.mjs --aplicar >> "%LOG%" 2>&1
if errorlevel 1 echo ERROR: fallo la sincronizacion de palets >> "%LOG%"

REM De que finca era la fruta que vuelve del almacen de precalibrado: sin esto,
REM sus kilos cuelgan de un almacen en vez de un productor.
echo --- origen del precalibrado --- >> "%LOG%"
call node scripts\sincronizar-precalibrado-origen-erp.mjs --aplicar >> "%LOG%" 2>&1
if errorlevel 1 echo ERROR: fallo la sincronizacion del origen del precalibrado >> "%LOG%"

REM El aviso ya crea los partes del dia anterior, los analiza si tienen informes
REM subidos y manda el correo. Va el ultimo porque cuenta lo que han hecho los
REM sincronizadores de arriba.
echo --- aviso --- >> "%LOG%"
call node scripts\aviso-diario-erp.mjs >> "%LOG%" 2>&1
if errorlevel 1 echo ERROR: no se pudo enviar el aviso >> "%LOG%"

echo FIN %DATE% %TIME% >> "%LOG%"
