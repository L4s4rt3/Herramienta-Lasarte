-- ─────────────────────────────────────────────────────────────────────────────
-- Los palets pasan a salir del ERP (decisión del dueño, 13-08-2026).
--
-- CUÁL DE LAS DOS LECTURAS DEL ERP. El ERP se puede leer de dos formas y no dan
-- lo mismo (día 11-08: 131 palets/41.171 kg contra 139/65.560):
--
--   · erp_palet       — palet a palet, con lote, cliente, albarán, factura e
--                       importe. Filtra `num_cajas > 0 AND lote <> ''`.
--   · erp_palets_foto — el total del día, cada hora, sin filtrar.
--
-- Manda `erp_palet`: es la única que sabe de qué lote sale cada palet y a quién
-- se vendió. La foto NO compite — su trabajo es decir cuándo el día ha dejado
-- de moverse (ver `palets_dia_cerrado` más abajo).
--
-- EGIPTO Y CAMPO, QUE EN LA APP ESTABAN VACÍOS. `palets_dia` tiene 26 palets
-- cuyo producto se llama EGIPTO y la marca `egipto` a false en TODOS; el ERP
-- reconoce 48 (57.041 kg). Como la cascada resta los kilos de Egipto
-- (src/lib/exportPartes.ts), esa fruta se estaba contando como producción
-- propia. Aquí se deriva del artículo con la MISMA regla que ya usaban el
-- parser del Excel (/EGIPTO/i, /CAMPO|CAMPI/i) y la foto horaria del ERP
-- (scripts/lib-palets-erp.mjs) — misma regla, tercera fuente, sin copiarla a
-- mano en ningún sitio nuevo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Cuándo un día de palets está cerrado ─────────────────────────────────────
-- MEDIDO, NO SUPUESTO. La foto horaria del 12-08-2026: el día se queda plano a
-- las 13:35 con 120 palets, aguanta diecisiete horas... y a las 07:00 del día
-- SIGUIENTE entra un palet más (+845 kg). El día 11 ya estaba cerrado a las
-- 13:35 del 12. Sacar los palets el mismo día, aunque sea a las 22:00, deja
-- fuera ese palet: por eso el dueño siempre los sacaba al día siguiente.
--
-- Solo hay dos curvas completas (la foto arrancó el 12-08), así que la hora NO
-- se codifica a pelo. Se piden las tres condiciones, y la foto sigue corriendo
-- cada hora para poder comprobar la regla según se acumulen días.
CREATE OR REPLACE VIEW public.palets_dia_cerrado AS
WITH ultima AS (
  SELECT DISTINCT ON (dia) dia, tomada_a, sin_valorar, kg_netos, palets, kg_mayor_palet
    FROM public.erp_palets_foto
   ORDER BY dia, tomada_a DESC
),
estable_desde AS (
  -- Desde cuándo la foto no cambia: la toma más antigua cuyo (kg, palets)
  -- coincide con el de la última, sin ningún cambio por medio.
  SELECT f.dia, min(f.tomada_a) AS desde
    FROM public.erp_palets_foto f
    JOIN ultima u ON u.dia = f.dia
   WHERE f.kg_netos = u.kg_netos AND f.palets = u.palets
     AND NOT EXISTS (
       SELECT 1 FROM public.erp_palets_foto g
        WHERE g.dia = f.dia AND g.tomada_a > f.tomada_a AND g.tomada_a < u.tomada_a
          AND (g.kg_netos <> u.kg_netos OR g.palets <> u.palets))
   GROUP BY f.dia
)
SELECT d.fecha AS dia,
       -- 1) Ya son las 09:00 del día siguiente (la entrada de las 07:00 ya pasó).
       (now() AT TIME ZONE 'Europe/Madrid') >= (d.fecha + 1)::timestamp + interval '9 hours'
       -- 2) Ningún palet sin valorar (kg todavía a cero).
       AND coalesce(u.sin_valorar, 0) = 0
       -- 3) La foto lleva 3 h sin moverse. Si no hay foto de ese día (todo lo
       --    anterior al 12-08-2026) manda la condición 1 sola: son días que
       --    llevan cerrados meses.
       AND (es.desde IS NULL OR u.tomada_a - es.desde >= interval '3 hours'
            OR (now() AT TIME ZONE 'Europe/Madrid') >= (d.fecha + 2)::timestamp)
         AS cerrado,
       u.tomada_a  AS ultima_foto,
       u.sin_valorar,
       u.kg_mayor_palet
  FROM (SELECT DISTINCT fecha FROM public.erp_palet) d
  LEFT JOIN ultima u ON u.dia = d.fecha
  LEFT JOIN estable_desde es ON es.dia = d.fecha;

COMMENT ON VIEW public.palets_dia_cerrado IS
  'Si un día de palets ya no se mueve: pasadas las 09:00 del día siguiente, sin '
  'palets sin valorar y con la foto horaria quieta 3 h. Medido sobre la foto del '
  '12-08-2026, donde entró un palet a las 07:00 del día siguiente.';

-- ── Los palets ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.palets AS
SELECT p.numero                          AS palet_id,
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
       -- Misma regla que el parser del Excel y la foto del ERP.
       (p.articulo ~* 'EGIPTO')          AS egipto,
       (p.articulo ~* 'CAMPO|CAMPI')     AS campo,
       -- Lo que la app tenía delante y no usaba.
       p.serie_albaran_venta,
       p.num_albaran_venta,
       p.linea_venta,
       p.importe_venta,
       p.fecha_venta,
       p.num_factura,
       p.fecha_factura,
       (p.num_albaran_venta IS NOT NULL)  AS vendido,
       coalesce(c.cerrado, false)         AS dia_cerrado,
       p.sincronizado_at
  FROM public.erp_palet p
  LEFT JOIN public.palets_dia_cerrado c ON c.dia = p.fecha;

COMMENT ON VIEW public.palets IS
  'Los palets, desde el ERP. Sustituye a palets_dia como fuente: la app tenía '
  '20.776 t contra 19.027 t del ERP (224 palets repetidos y 908 filas sin '
  'número). Añade cliente, albarán, factura e importe, y marca dia_cerrado para '
  'que el día en curso no se presente como definitivo.';

GRANT SELECT ON public.palets_dia_cerrado TO anon, authenticated, service_role;
GRANT SELECT ON public.palets             TO anon, authenticated, service_role;
