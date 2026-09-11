-- Tercera tanda de enlaces (investigación 2 del 11-09-2026): el catálogo
-- completo del ERP (articulo_general) tiene artículos dados de alta aunque no
-- se hayan comprado por líneas; se enlazan para que el día que se compren el
-- precio entre solo. Y dos enlaces del 09-09 se corrigen con lo aprendido.

-- Existen en el catálogo (sin compras registradas por líneas).
UPDATE public.stock_consumibles SET erp_codigo = 10003653, erp_factor = 1 WHERE nombre = 'Banda FRESHY' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003637, erp_factor = 1 WHERE nombre = 'Corbata (Banda cartón caja) RUMBA' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003636, erp_factor = 1 WHERE nombre = 'Stiker RUMBA' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003887, erp_factor = 1 WHERE nombre = 'Stiker ORRI' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003364, erp_factor = 1 WHERE nombre = 'Stiker LASARTE PORTUGAL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003462, erp_factor = 1 WHERE nombre = 'Papel de seda LASARTE PORTUGAL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10001975, erp_factor = 1 WHERE nombre = 'Caja madera 15 Kg. GENERICA BLANCA' AND almacen = 'central';
-- La "10 Kg. genérica blanca" es la 495x290x160 BLANCAS (0,885 € en abr-2025 vs 0,86 nuestro).
UPDATE public.stock_consumibles SET erp_codigo = 100000586, erp_factor = 1 WHERE nombre = 'Caja madera 10 Kg. GENERICA BLANCA' AND almacen = 'central';

-- EPS mod. 18: caja Europool 18 azul (0,75) + su fianza (3,86) = 4,61, el precio exacto que teníamos.
UPDATE public.stock_consumibles SET erp_codigo = 100000068, erp_factor = 1, erp_codigo_extra = 10000628 WHERE nombre = 'Caja plástico EPS MOD. 18' AND almacen = 'central';

-- Corbata C2C "A Jus - Prosol": nuestro precio (0,03728) es exactamente el de
-- CORBATA LASARTE C2C (37,28 €/millar, 2023); la de PRIX MALIN es otro cliente.
UPDATE public.stock_consumibles SET erp_codigo = 10003408, erp_factor = 1 WHERE nombre = 'Corbata (ETIQUETA TIPO C2C) A JUS - PROSOL' AND almacen = 'central';

-- Correcciones: "*44" es el ancho 440 mm (el artículo 420x290x160 es otra caja);
-- el palet LPR rojo 120x80 tiene artículo propio (el 1200x1000 es otro palet).
UPDATE public.stock_consumibles SET erp_codigo = 10000960, erp_factor = 1 WHERE nombre = 'Caja madera 10 Kg. LASARTE *44' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000448, erp_factor = 1 WHERE nombre = 'Palet LPR Rojo 120 x 80' AND almacen = 'central';
