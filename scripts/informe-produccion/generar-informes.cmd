@echo off
REM Genera los informes de produccion: dos Excel completos (pantalla) y un
REM paquete de IMPRESION de 3 paginas (el PDF que se lleva a la reunion).
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
echo === Informes de produccion Lasarte ===
if exist asistencias.xlsx (
  echo [1/4] Leyendo el reloj de presencia...
  python parsear_asistencias.py
  if errorlevel 1 goto :error
) else (
  echo [1/4] SIN asistencias.xlsx: los dias nuevos saldran sin personas.
)
if exist lotes-extra\*.xlsx python parsear_lotes_extra.py
echo [2/4] Calculando con los datos del calibrador, bascula y ERP...
cd /d "%~dp0..\.."
node node_modules/vite-node/vite-node.mjs scripts/informe-produccion/informe-produccion.ts %*
if errorlevel 1 goto :error
cd /d "%~dp0"
echo [3/4] Montando los Excel completos y el paquete de impresion...
python build_A.py
if errorlevel 1 goto :error
python build_B.py
if errorlevel 1 goto :error
python build_B_print.py
if errorlevel 1 goto :error
python build_dia_print.py
if errorlevel 1 goto :error
echo [4/4] Recalculando, validando y sacando el PDF de 3 paginas...
del /q "salida\*.pdf" 2>nul
for %%f in ("salida\Informe *.xlsx") do (
  powershell -NoProfile -ExecutionPolicy Bypass -File recalc_excel.ps1 -Ruta "%%~f"
)
for %%f in ("salida\IMPRIMIR*.xlsx") do (
  powershell -NoProfile -ExecutionPolicy Bypass -File recalc_excel.ps1 -Ruta "%%~f" -Pdf "%%~dpnf.pdf"
)
echo.
echo LISTO: salida\IMPRIMIR...pdf es el de la reunion (3 paginas); los Excel completos, para pantalla.
pause
exit /b 0
:error
echo.
echo HA FALLADO UN PASO (mira el mensaje de arriba).
pause
exit /b 1
