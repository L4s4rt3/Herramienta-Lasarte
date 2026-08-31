-- La vista clasificacion_lote se quedó CIEGA el 11-08: le faltaba la rama DOCX.
--
-- SÍNTOMA. Rentabilidad, el informe semanal, el podrido de mermas, el dossier
-- por productor y todo lo que cuelga de `clasificacion_lote` no ve nada desde
-- el 11-08-2026 — la producción SAF (28-08, 17.147 kg del lote 26082701)
-- existe en la base pero ninguna página la enseña.
--
-- LA CAUSA. La vista tenía DOS ramas: el volcado SQL del Sizer (batch_id > 0)
-- y el import manual del Excel (lote_clasificacion). El volcado murió el 11-08
-- (desde entonces el Sizer solo manda DOCX por correo) y el Excel dejó de
-- importarse al acabar la campaña. Los DOCX del buzón SÍ llegan cada día al
-- espejo (calibrador_informe/calibrador_clasificacion con batch_id NEGATIVO,
-- migración 20260814092533) pero la vista no los miraba.
--
-- EL ARREGLO. Tercera rama: los informes DOCX cuyos lote-DÍA no estén ya
-- cubiertos ni por el volcado ni por el import manual — la MISMA regla de
-- frescura por lote-día que ya aplica la RPC calibrador_aprovechamiento_
-- productor (volcado manda; DOCX es el respaldo). El emparejado es por el
-- grupo de 8 dígitos del lote (o el nombre exacto cuando no lo hay), y por
-- FECHA: el mismo lote puede entrar en línea varios días.
--
-- La exclusión contra el import manual se hace por (fecha, lote) simple: hoy
-- las dos poblaciones son disjuntas en el tiempo (manual ≤ 10-08, DOCX ≥
-- 11-08) y, si mañana alguien importa el Excel de un día ya cubierto por
-- DOCX, gana el Excel (más completo: el DOCX de una pasada re-guardada solo
-- trae la última versión).
--
-- fuente = 'docx' marca estas filas: quien consuma la vista puede enseñar que
-- el dato es del respaldo. Los pct_* vienen tal cual del DOCX (ya calculados
-- por pasada), a diferencia de la rama del volcado que los recalcula por lote.
--
-- La exclusión corre por INFORME (49 hoy), no por línea (~7.400): la lección
-- de la migración 20260814150000 (dueño por índice) — los NOT EXISTS con
-- substring() no escalan por fila.

-- El anti-join nuevo busca lote_clasificacion por fecha: sin índice sería un
-- seq-scan de 259k filas por informe.
create index if not exists lote_clasificacion_fecha_idx
  on public.lote_clasificacion (fecha);

CREATE OR REPLACE VIEW public.clasificacion_lote AS
WITH cal AS (
  SELECT c.batch_id,
         b.lote,
         (b.inicio AT TIME ZONE 'Europe/Madrid')::date AS fecha,
         b.inicio,
         b.fin,
         c.producto, c.calidad, c.clase, c.grupo_destino, c.tamano,
         c.piezas, c.peso_kg, c.cartons
    FROM public.calibrador_clasificacion c
    JOIN public.calibrador_batch b ON b.batch_id = c.batch_id
   WHERE c.batch_id > 0
),
informe AS (
  SELECT DISTINCT ON (lote) lote, toneladas_hora, peso_fruta_media_g
    FROM public.calibrador_informe
   ORDER BY lote, recibido_at DESC NULLS LAST
),
-- Informes DOCX (batch_id < 0) cuyo lote-día NO cubre ninguna otra rama.
docx_inf AS (
  SELECT DISTINCT ON (i.batch_id)
         i.batch_id, i.lote, i.fecha, i.productor, i.toneladas_hora,
         i.peso_fruta_media_g, i.tiempo_lote, i.recibido_at,
         substring(i.lote FROM '\d{8}') AS base8
    FROM public.calibrador_informe i
   WHERE i.batch_id < 0
     AND i.fecha IS NOT NULL
     -- ¿Ese lote-día ya está en la rama del volcado? Entonces el DOCX sobra.
     AND NOT EXISTS (
       SELECT 1
         FROM public.calibrador_batch b
        WHERE (b.inicio AT TIME ZONE 'Europe/Madrid')::date = i.fecha
          AND (b.lote = i.lote
               OR substring(b.lote FROM '\d{8}') = substring(i.lote FROM '\d{8}'))
          AND EXISTS (SELECT 1 FROM public.calibrador_clasificacion c
                       WHERE c.batch_id = b.batch_id AND c.batch_id > 0)
     )
     -- ¿O en la del import manual del Excel (mismo día)? El Excel gana.
     AND NOT EXISTS (
       SELECT 1
         FROM public.lote_clasificacion lc
        WHERE lc.fecha = i.fecha
          AND (lc.lote_codigo = i.lote
               OR substring(lc.lote_codigo FROM '\d{8}') = substring(i.lote FROM '\d{8}'))
     )
   ORDER BY i.batch_id, i.recibido_at DESC NULLS LAST
)
SELECT
  md5(cal.batch_id::text || '|' || coalesce(cal.producto,'') || '|' || coalesce(cal.calidad,'')
      || '|' || coalesce(cal.clase,'') || '|' || coalesce(cal.tamano,'')
      || '|' || coalesce(cal.grupo_destino,''))::uuid AS id,
  pa.id                                   AS part_id,
  NULL::uuid                              AS user_id,
  NULL::uuid                              AS archivo_id,
  NULL::uuid                              AS lote_dia_id,
  cal.lote                                AS lote_codigo,
  substring(cal.lote FROM '\d{8}')        AS lote_codigo_base,
  pd.productor,
  pd.productor_id,
  cal.fecha,
  inf.toneladas_hora,
  inf.peso_fruta_media_g                  AS peso_fruta_promedio_g,
  CASE WHEN cal.fin > cal.inicio
       THEN round(extract(epoch FROM (cal.fin - cal.inicio)) / 60.0, 2)
  END                                     AS duracion_min,
  cal.producto, cal.calidad, cal.clase, cal.grupo_destino, cal.tamano,
  cal.piezas,
  cal.piezas  / nullif(sum(cal.piezas)  OVER (PARTITION BY cal.lote), 0) AS pct_piezas,
  cal.peso_kg,
  cal.peso_kg / nullif(sum(cal.peso_kg) OVER (PARTITION BY cal.lote), 0) AS pct_peso,
  cal.cartons,
  cal.cartons / nullif(sum(cal.cartons) OVER (PARTITION BY cal.lote), 0) AS pct_cartons,
  cal.inicio                              AS created_at,
  'calibrador'::text                      AS fuente,
  coalesce(pd.fraccion, 1)                AS fraccion_productor,
  cal.batch_id
FROM cal
LEFT JOIN public.productor_lote_dominante pd ON pd.lote = cal.lote
LEFT JOIN public.partes_diarios pa ON pa.date = cal.fecha
LEFT JOIN informe inf ON inf.lote = cal.lote

UNION ALL

SELECT
  lc.id, lc.part_id, lc.user_id, lc.archivo_id, lc.lote_dia_id,
  lc.lote_codigo, lc.lote_codigo_base, lc.productor,
  ld.productor_id,
  lc.fecha, lc.toneladas_hora, lc.peso_fruta_promedio_g, lc.duracion_min,
  lc.producto, lc.calidad, lc.clase, lc.grupo_destino, lc.tamano,
  lc.piezas, lc.pct_piezas, lc.peso_kg, lc.pct_peso, lc.cartons, lc.pct_cartons,
  lc.created_at,
  'parte'::text AS fuente,
  1::numeric    AS fraccion_productor,
  NULL::integer AS batch_id
FROM public.lote_clasificacion lc
LEFT JOIN LATERAL (
  SELECT pl.productor_id
    FROM public.productor_lote pl
   WHERE pl.lote = lc.lote_codigo
   ORDER BY pl.fraccion DESC, pl.productor
   LIMIT 1
) ld ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.calibrador_batch b
   WHERE b.lote = lc.lote_codigo
     AND EXISTS (SELECT 1 FROM public.calibrador_clasificacion c
                  WHERE c.batch_id = b.batch_id AND c.batch_id > 0)
)

UNION ALL

SELECT
  md5(c.batch_id::text || '|' || coalesce(c.producto,'') || '|' || coalesce(c.calidad,'')
      || '|' || coalesce(c.clase,'') || '|' || coalesce(c.tamano,'')
      || '|' || coalesce(c.grupo_destino,''))::uuid AS id,
  pa.id                                   AS part_id,
  NULL::uuid                              AS user_id,
  NULL::uuid                              AS archivo_id,
  NULL::uuid                              AS lote_dia_id,
  d.lote                                  AS lote_codigo,
  d.base8                                 AS lote_codigo_base,
  coalesce(pd.productor, d.productor)     AS productor,
  pd.productor_id,
  d.fecha,
  d.toneladas_hora,
  d.peso_fruta_media_g                    AS peso_fruta_promedio_g,
  CASE WHEN d.tiempo_lote ~ '^\d{1,3}:\d{2}(:\d{2})?$'
       THEN round(extract(epoch FROM d.tiempo_lote::interval) / 60.0, 2)
  END                                     AS duracion_min,
  c.producto, c.calidad, c.clase, c.grupo_destino, c.tamano,
  c.piezas, c.pct_piezas, c.peso_kg, c.pct_peso, c.cartons, c.pct_cartons,
  d.recibido_at                           AS created_at,
  'docx'::text                            AS fuente,
  coalesce(pd.fraccion, 1)                AS fraccion_productor,
  c.batch_id
FROM docx_inf d
JOIN public.calibrador_clasificacion c ON c.batch_id = d.batch_id
LEFT JOIN public.productor_lote_dominante pd ON pd.lote = d.lote
LEFT JOIN public.partes_diarios pa ON pa.date = d.fecha;

GRANT SELECT ON public.clasificacion_lote TO anon, authenticated, service_role;
