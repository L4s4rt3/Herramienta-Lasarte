-- `situacion` y `destino` en la vista de palets, para que los consumidores solo
-- cambien el nombre de la tabla.
--
-- SITUACIÓN, DEDUCIDA DEL PROPIO ERP. `palets_dia.situacion` traía A/F/S del
-- Excel y nadie tenía escrito qué significaban. Cruzando los 42.963 palets de
-- la app con el albarán y la factura del ERP sale solo:
--
--   F (36.686 palets) → 36.564 tienen factura   (99,7%)
--   A (   100 palets) → 100 no tienen albarán   (100%)
--   S ( 1.626 palets) → 1.239 sin albarán, y 659 ni existen en el ERP
--
-- O sea: F = facturado, A = en almacén, S = servido pendiente de facturar. Se
-- deriva de albarán/factura, que es el dato de verdad, en vez de arrastrar una
-- letra que venía de un Excel.
--
-- DESTINO va a NULL a propósito: está a null en las 42.963 filas de
-- `palets_dia`. Es una columna muerta y se expone solo para no romper los
-- SELECT que la piden.
DROP VIEW IF EXISTS public.palets;

CREATE VIEW public.palets AS
SELECT p.numero                          AS palet_id,
       pa.id                             AS part_id,
       p.fecha,
       p.articulo                        AS producto,
       p.lote_confeccion                 AS lote_codigo,
       p.cliente,
       p.cliente_codigo,
       p.kg_netos                        AS kg_neto,
       p.kg_brutos,
       p.num_cajas                       AS n_cajas,
       p.referencia,
       p.codigo_sscc,
       (p.articulo ~* 'EGIPTO')          AS egipto,
       (p.articulo ~* 'CAMPO|CAMPI')     AS campo,
       CASE WHEN p.num_factura IS NOT NULL        THEN 'F'
            WHEN p.num_albaran_venta IS NOT NULL  THEN 'S'
            ELSE 'A'
       END                               AS situacion,
       NULL::text                        AS destino,
       p.serie_albaran_venta,
       p.num_albaran_venta,
       p.linea_venta,
       p.importe_venta,
       p.fecha_venta,
       p.num_factura,
       p.fecha_factura,
       (p.num_albaran_venta IS NOT NULL) AS vendido,
       coalesce(c.cerrado, false)        AS dia_cerrado,
       p.sincronizado_at
  FROM public.erp_palet p
  LEFT JOIN public.palets_dia_cerrado c ON c.dia = p.fecha
  LEFT JOIN public.partes_diarios pa ON pa.date = p.fecha;

COMMENT ON VIEW public.palets IS
  'Los palets, desde el ERP. Sustituye a palets_dia como fuente: la app tenía '
  '20.776 t contra 19.027 t del ERP (224 palets repetidos y 908 filas sin '
  'número). Añade cliente, albarán, factura e importe, part_id para los hooks '
  'que filtran por parte, situacion deducida de albarán/factura, y dia_cerrado '
  'para que el día en curso no se presente como definitivo.';

GRANT SELECT ON public.palets TO anon, authenticated, service_role;
