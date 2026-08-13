-- `comercial` en la vista, y la vista deja de mentir por omisión.
--
-- La versión anterior heredaba el filtro `num_cajas > 0 AND lote <> ''` que
-- traía la sincronización, y por eso enseñaba 19.027 t donde el ERP tiene
-- 20.700 t. Ahora `erp_palet` guarda los 42.534 palets con su marca, así que la
-- vista los enseña todos y quien pregunte por ventas filtra por `comercial`.
--
-- Regla para quien la use:
--   · balance de masa / DSJ / merma  → TODOS (la fruta salió de la línea)
--   · cliente, albarán, factura      → WHERE comercial
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
       p.comercial,
       (p.articulo ~* 'EGIPTO')          AS egipto,
       (p.articulo ~* 'CAMPO|CAMPI')     AS campo,
       (p.articulo ~* 'PRE[0-9]|PRECAL') AS precalibrado,
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
  'Los palets, desde el ERP: los 42.534 de la campaña (20.699.533 kg), no solo '
  'los comerciales. `comercial` = false son granel y precalibrado (1.570 palets, '
  '1.656.698 kg): cuentan para el balance de masa porque salieron de la línea, '
  'no para las pantallas de venta. Trae además cliente, albarán, factura e '
  'importe, part_id para los hooks que filtran por parte, y dia_cerrado para '
  'que el día en curso no se presente como definitivo.';

GRANT SELECT ON public.palets TO anon, authenticated, service_role;
