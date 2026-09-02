@echo off
REM Fichas mensuales de trabajadores: asistencia del reloj + efecto presencia
REM con el historico, y rubrica en blanco para la encargada. Sin euros.
REM Uso: doble clic (mes en curso) o: generar-fichas.cmd --mes=2026-07
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
echo === Fichas de trabajadores ===
if exist asistencias.xlsx (
  echo [1/3] Leyendo el reloj de presencia...
  python parsear_asistencias.py
  if errorlevel 1 goto :error
)
echo [2/3] Cruzando asistencia e historico de produccion...
cd /d "%~dp0..\.."
node node_modules/vite-node/vite-node.mjs scripts/informe-produccion/fichas-personas.ts %*
if errorlevel 1 goto :error
cd /d "%~dp0"
echo [3/3] Montando las fichas y el PDF...
python build_fichas.py
if errorlevel 1 goto :error
for %%f in ("salida\PLANTILLA*.xlsx") do (
  powershell -NoProfile -ExecutionPolicy Bypass -File recalc_excel.ps1 -Ruta "%%~f" -Pdf "%%~dpnf.pdf"
)
echo.
echo LISTO: salida\PLANTILLA...pdf (una pagina con toda la plantilla)
pause
exit /b 0
:error
echo.
echo HA FALLADO UN PASO (mira el mensaje de arriba).
pause
exit /b 1
