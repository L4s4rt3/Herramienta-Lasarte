@echo off
REM Tarea diaria: trae del ERP las entradas de fruta y la trazabilidad de palets,
REM y manda el aviso con el resultado.
REM
REM Va en un solo .cmd a proposito: los dos sincronizadores NO deben solaparse,
REM y el aviso tiene que ir despues para poder contar lo que ha pasado.
REM
REM SE REINTENTA HASTA QUE SALE BIEN. La tarea se dispara a las 07:40 (hasta el
REM 03-09-2026 a las 07:10: el informe del ultimo lote del dia llega al buzon
REM hacia las 07:15 del dia siguiente y el correo salia sin calibrador) y se repite
REM cada 20 minutos hasta las 12:40, pero en cuanto un dia termina entero no
REM vuelve a hacer nada.
REM
REM POR QUE. El 14-08-2026 corrio a las 07:10 con el portatil recien despierto y
REM todavia sin red: los dos sincronizadores murieron con EHOSTUNREACH
REM 192.168.1.10:3306, el aviso con "fetch failed", y hasta el dia siguiente no
REM lo intento nadie. Se perdieron el correo del dia y los partes del 12 y el 13.
REM La red tardo minutos en subir, no horas: un reintento a los 20 minutos lo
REM habria salvado entero.
REM
REM DOS MARCAS, PORQUE SON DOS COSAS DISTINTAS
REM
REM   ultimo-aviso-ok.txt        el correo del dia YA SALIO. Los reintentos que
REM                              queden siguen creando y analizando partes (el
REM                              aviso hace las dos cosas antes de enviar), pero
REM                              con --sin-enviar: nadie recibe el mismo correo
REM                              dos veces.
REM   ultima-tarea-diaria-ok.txt el dia entero fue bien, sincronizadores
REM                              incluidos. Esta es la que corta los reintentos.
REM
REM Con una sola marca habia que elegir entre reenviar el correo o dar por bueno
REM un dia con el ERP a medias, que es lo que pasa cuando Supabase responde y el
REM ERP no. Con dos, cada cosa se reintenta hasta que le toca y nada se repite.
REM Los sincronizadores son idempotentes: repetirlos cuesta unos segundos.
REM
REM Se programa con:
REM   schtasks /Create /TN "Lasarte - Sincronizar ERP" /TR "<ruta a este .cmd>" /SC DAILY /ST 07:40 /F
REM y despues scripts\arreglar-tareas.ps1, que le pone el reintento y los ajustes
REM de energia.

REM UTF-8: sin esto el log sale con acentos y tablas rotas, y el log es
REM justo lo que se mira cuando algo falla.
chcp 65001 > nul
setlocal enabledelayedexpansion

cd /d "%~dp0.."
if not exist "outputs" mkdir "outputs"

set LOG=outputs\log-tarea-diaria.txt
set MARCA=outputs\ultima-tarea-diaria-ok.txt
set MARCA_AVISO=outputs\ultimo-aviso-ok.txt

REM Si el dia ya salio entero, este reintento no tiene nada que hacer.
if exist "%MARCA%" (
  set /p HECHO=<"%MARCA%"
  if "!HECHO!"=="%DATE%" exit /b 0
)

set FALLO=0

echo. >> "%LOG%"
echo ================================================================ >> "%LOG%"
echo INICIO %DATE% %TIME% >> "%LOG%"

echo --- entradas de fruta --- >> "%LOG%"
call node scripts\sincronizar-entradas-erp.mjs --aplicar --rellenar-huecos >> "%LOG%" 2>&1
if errorlevel 1 (
  set FALLO=1
  echo ERROR: fallo la sincronizacion de entradas >> "%LOG%"
)

echo --- trazabilidad de palets --- >> "%LOG%"
call node scripts\sincronizar-trazabilidad-palet-erp.mjs --aplicar >> "%LOG%" 2>&1
if errorlevel 1 (
  set FALLO=1
  echo ERROR: fallo la sincronizacion de palets >> "%LOG%"
)

REM De que finca era la fruta que vuelve del almacen de precalibrado: sin esto,
REM sus kilos cuelgan de un almacen en vez de un productor.
echo --- origen del precalibrado --- >> "%LOG%"
call node scripts\sincronizar-precalibrado-origen-erp.mjs --aplicar >> "%LOG%" 2>&1
if errorlevel 1 (
  set FALLO=1
  echo ERROR: fallo la sincronizacion del origen del precalibrado >> "%LOG%"
)

REM El aviso crea los partes del dia anterior (y repasa la semana), les sube el
REM GSTOCK, analiza los que tengan informes y manda el correo. Va el ultimo
REM porque cuenta lo que han hecho los sincronizadores de arriba.
set ENVIAR=1
if exist "%MARCA_AVISO%" (
  set /p AVISADO=<"%MARCA_AVISO%"
  if "!AVISADO!"=="%DATE%" set ENVIAR=0
)
set EXTRA=
if "!ENVIAR!"=="0" set EXTRA=--sin-enviar

echo --- aviso !EXTRA! --- >> "%LOG%"
call node scripts\aviso-diario-erp.mjs !EXTRA! >> "%LOG%" 2>&1
if errorlevel 1 (
  set FALLO=1
  echo ERROR: fallo el aviso, se reintentara en 20 min >> "%LOG%"
) else (
  if "!ENVIAR!"=="1" (> "%MARCA_AVISO%" echo %DATE%)
)

if "!FALLO!"=="0" (
  > "%MARCA%" echo %DATE%
  echo Dia completo: no habra mas reintentos hasta el dia siguiente. >> "%LOG%"
)

echo FIN %DATE% %TIME% >> "%LOG%"
