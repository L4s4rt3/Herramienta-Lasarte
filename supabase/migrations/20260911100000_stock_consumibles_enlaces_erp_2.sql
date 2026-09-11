-- Segunda tanda de enlaces consumible ↔ ERP (investigación del 11-09-2026).
-- El primer cruce solo miraba artículos con precio_ult_compra informado (214);
-- buscando en las LÍNEAS de compra reales aparecen 820 artículos no-fruta, y
-- entre ellos cantoneras, corbatas, etiquetas, alveolos, papel seda, stikers y
-- toda la postcosecha, casi siempre con el precio clavado al nuestro. Muchos
-- tienen precio_ult_compra = 0 en el ERP (artículos antiguos): el sync semanal
-- cae entonces a la última línea real (ver sincronizar-precios-consumibles-erp.mjs).

-- Alveolos: el artículo vivo de Ecoenvases es "PET ... NEGROS VARIOS" (los N.º
-- sueltos son altas de 2013-2019); 30x50 y 40x60 según el formato.
UPDATE public.stock_consumibles SET erp_codigo = 10000874, erp_factor = 1 WHERE nombre LIKE 'Alveolo 50 x 30 cm%' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000119, erp_factor = 1 WHERE nombre LIKE 'Alveolo 60 x 40 cm%' AND almacen = 'central';

-- Bandas con artículo propio (precio exacto por millar).
UPDATE public.stock_consumibles SET erp_codigo = 10002774, erp_factor = 1 WHERE nombre = 'Banda Aldi Sur - SAFT Orangen' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000018, erp_factor = 1 WHERE nombre = 'Banda JUARRANZ' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003839, erp_factor = 1 WHERE nombre = 'Banda LA MEJOR' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000021, erp_factor = 1 WHERE nombre = 'Banda GENERICA - VASO DE ZUMO' AND almacen = 'central';

-- Camisas.
UPDATE public.stock_consumibles SET erp_codigo = 10003922, erp_factor = 1 WHERE nombre = 'Camisa fondo caja BELLE ANDALOUSE' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000607, erp_factor = 1 WHERE nombre = 'Camisa fondo caja LASARTE' AND almacen = 'central';

-- Cantoneras (sí existen: familia CANT, compras 2026).
UPDATE public.stock_consumibles SET erp_codigo = 10001314, erp_factor = 1 WHERE nombre = 'Cantonera GENERICA BLANCA 1,78 m.' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000043, erp_factor = 1 WHERE nombre = 'Cantonera GENERICA NARANJA 2,20 m' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002560, erp_factor = 1 WHERE nombre = 'Cantonera GENERICA NEGRA 2,20 m.' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000042, erp_factor = 1 WHERE nombre = 'Cantonera LASARTE 2,20 m.' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000602, erp_factor = 1 WHERE nombre = 'Cantonera MI PRIMA LA FEA 2,20 m' AND almacen = 'central';

-- Corbatas de cartón (familia BANDERO).
UPDATE public.stock_consumibles SET erp_codigo = 10002740, erp_factor = 1 WHERE nombre = 'Corbata (Banda cartón caja) FRUTAMINE' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003897, erp_factor = 1 WHERE nombre = 'Corbata (Banda cartón caja) LA MARTINA' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000488, erp_factor = 1 WHERE nombre = 'Corbata (Banda cartón caja) LASARTE ECOENVASES' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000524, erp_factor = 1 WHERE nombre = 'Corbata (Banda cartón caja) LASARTE PIDUVAL HENDIOS LST' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10001973, erp_factor = 1 WHERE nombre = 'Corbata (Banda cartón caja) PLATINUM' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003581, erp_factor = 1 WHERE nombre = 'Corbata (Banda cartón caja) SCRIG' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003879, erp_factor = 1 WHERE nombre = 'Corbata (Banda cartón caja) V-ROS' AND almacen = 'central';

-- Cubres: dos nuevos y dos enlaces más precisos que el genérico "CUBRE LASARTE".
UPDATE public.stock_consumibles SET erp_codigo = 10002742, erp_factor = 1 WHERE nombre = 'Cubre FRUTAMINE' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10000998, erp_factor = 1 WHERE nombre = 'Cubres PLATINUM' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002586, erp_factor = 1 WHERE nombre = 'Cubre LASARTE "PITUFOS"' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002347, erp_factor = 1 WHERE nombre = 'Cubre LASARTE BLOOD ORANGES' AND almacen = 'central';

-- Envases.
UPDATE public.stock_consumibles SET erp_codigo = 10001011, erp_factor = 1 WHERE nombre = 'Bins cartón 1,20 x 0,85 m.' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000487, erp_factor = 1 WHERE nombre = 'Caja cartón 08 Kg. LASARTE MANTO' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002095, erp_factor = 1 WHERE nombre = 'Caja madera 10 Kg. CATARINA' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002095, erp_factor = 1 WHERE nombre = 'Caja madera 11 Kg. GENERICA 495*290X110 CATARINA' AND almacen = 'central';

-- Etiquetas (adhesivas anónimas y precorte de cartón).
UPDATE public.stock_consumibles SET erp_codigo = 10002789, erp_factor = 1 WHERE nombre = 'Etiquetas Adhesivas 5 x 3 cm AMARILLAS' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10001099, erp_factor = 1 WHERE nombre = 'Etiquetas Adhesivas 5 x 3 cm BLANCAS' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000025, erp_factor = 0.001 WHERE nombre = 'Etiquetas Adhesivas 7,8 x 4,3 cm BLANCAS' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000025, erp_factor = 0.001 WHERE nombre = 'Etiquetas Adhesivas 6,8 x 4,3 cm BLANCAS (GS NETTO)' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003861, erp_factor = 1 WHERE nombre = 'Etiquetas cartón Pre-Corte 4,4 x 12,7 cm (PROSOL)' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003838, erp_factor = 1 WHERE nombre = 'Etiquetas cartón Pre-Corte 74 x 102 cm (MERCADONA)' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000665, erp_factor = 1 WHERE nombre = 'Etiquetas cartón Pre-Corte 8,8 x 3,5 cm (G&G)' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000664, erp_factor = 1 WHERE nombre = 'Etiquetas cartón Pre-Corte 8,8 x 3,5 cm (Herztucke)' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003862, erp_factor = 1 WHERE nombre = 'Etiquetas cartón Pre-Corte 8,8 x 7 cm (EPS)' AND almacen = 'central';

-- Mallas.
UPDATE public.stock_consumibles SET erp_codigo = 10002086, erp_factor = 1 WHERE nombre = 'Malla AMARILLA GIRSAC/D-PACK' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10000995, erp_factor = 1 WHERE nombre = 'Malla VERDE C2C' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000015, erp_factor = 1 WHERE nombre = 'Malla VERDE GIRSAC/D-PACK' AND almacen = 'central';

-- Palets.
UPDATE public.stock_consumibles SET erp_codigo = 100000037, erp_factor = 1 WHERE nombre = 'Palet CHEP 120 X 80' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10000963, erp_factor = 1 WHERE nombre = 'Palet ESPIGA 120 X 103' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000034, erp_factor = 1 WHERE nombre = 'Palet EUROPALET 120 X 80' AND almacen = 'central';

-- Papel de seda.
UPDATE public.stock_consumibles SET erp_codigo = 10003885, erp_factor = 1 WHERE nombre = 'Papel de seda LA MARTINA' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002376, erp_factor = 1 WHERE nombre = 'Papel de seda LASARTE' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10000616, erp_factor = 1 WHERE nombre = 'Papel de seda LASARTE BLOOD ORANGE' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003877, erp_factor = 1 WHERE nombre = 'Papel de seda V-ROS' AND almacen = 'central';

-- Postcosecha (el ERP factura por litro; Brili y Negrol pasan de envase a L).
UPDATE public.stock_consumibles SET erp_codigo = 100000339, erp_factor = 1, unidad = 'L', stock = 80,
  nota = '4 garrafas de 20 L = 80 L (el ERP factura por litro). Enlazado al ERP el 11-09.'
  WHERE nombre = 'Post cosecha BRILI' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003863, erp_factor = 1, unidad = 'L', stock = 60,
  nota = '1 bidón de 60 L (el ERP factura por litro). Enlazado al ERP el 11-09.'
  WHERE nombre = 'Post cosecha NEGROL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003482, erp_factor = 1 WHERE nombre = 'Post cosecha CITROPYR' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10000481, erp_factor = 1 WHERE nombre = 'Post cosecha CITROSOL 500' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003540, erp_factor = 1 WHERE nombre = 'Post cosecha DETERSOL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000365, erp_factor = 1 WHERE nombre = 'Post cosecha ORTOCIL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000352, erp_factor = 1 WHERE nombre = 'Post cosecha FRUIT FOG' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003086, erp_factor = 1 WHERE nombre = 'Post cosecha FUMI ESPORE' AND almacen = 'central';

-- Stikers de marcas.
UPDATE public.stock_consumibles SET erp_codigo = 10001948, erp_factor = 1 WHERE nombre = 'Stiker DRIE DOCHTERS' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002741, erp_factor = 1 WHERE nombre = 'Stiker FRUTAMINE' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003886, erp_factor = 1 WHERE nombre = 'Stiker LA MARTINA' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000030, erp_factor = 1 WHERE nombre = 'Stiker LASARTE BLOOD ORANGES' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003005, erp_factor = 1 WHERE nombre = 'Stiker LASARTE CIRULARES' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003568, erp_factor = 1 WHERE nombre = 'Stiker OTELLO' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10000997, erp_factor = 1 WHERE nombre = 'Stiker PLATINUM' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002582, erp_factor = 1 WHERE nombre = 'Stiker PLATINUM AZUL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003582, erp_factor = 1 WHERE nombre = 'Stiker SCRIG' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002604, erp_factor = 1 WHERE nombre = 'Stiker SELECTION GOUT PEQUEÑO' AND almacen = 'central';
