@echo off
REM Tarea SEMANAL: actualiza los precios del stock de consumibles desde el ERP.
REM
REM POR QUE EXISTE. Revisar los precios con cada factura de materiales le comia
REM horas a Jesus. El ERP ya mantiene el ultimo precio de compra por articulo
REM al registrar cada entrada de proveedor: esto solo lo LEE (al ERP nunca se
REM le escribe) y lo lleva a stock_consumibles para los articulos enlazados.
REM
REM CUANDO. Los lunes a las 08:45, con la semana de facturas cerrada y despues
REM del sync diario del ERP (07:40). Necesita la red de la oficina.
REM
REM GUARDARRAIL. Un precio fuera de [1/3x, 3x] del vigente NO se aplica: queda
REM como nota CONFIRMAR en /consumibles (asi un cambio de unidades en el ERP no
REM cuela un precio x1000). Deja rastro en sistema_ejecuciones y el vigilante
REM avisa si un lunes no corre.

cd /d "%~dp0.."

echo(>> "outputs\log-precios-consumibles.txt"
echo ===== %DATE% %TIME% =====>> "outputs\log-precios-consumibles.txt"
call node scripts\sincronizar-precios-consumibles-erp.mjs --aplicar >> "outputs\log-precios-consumibles.txt" 2>&1
echo Fin (codigo %ERRORLEVEL%)>> "outputs\log-precios-consumibles.txt"
