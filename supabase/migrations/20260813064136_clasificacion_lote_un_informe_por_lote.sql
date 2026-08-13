-- Arreglo: `calibrador_informe` puede tener MÁS DE UN informe para el mismo lote
-- (975 informes para 974 lotes). Uniéndolo a pelo, ese lote duplicaba TODAS sus
-- líneas de clasificación — 168 filas fantasma con sus kilos contados dos veces.
-- Se toma el último informe recibido de cada lote: los campos que aporta
-- (toneladas/hora, peso medio de la fruta) son de cabecera, no kilos, así que
-- quedarse con el más reciente no pierde nada.
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
LEFT JOIN public.productor_lote_dominante ld ON ld.lote = lc.lote_codigo
WHERE NOT EXISTS (
  SELECT 1 FROM public.calibrador_batch b
   WHERE b.lote = lc.lote_codigo
     AND EXISTS (SELECT 1 FROM public.calibrador_clasificacion c
                  WHERE c.batch_id = b.batch_id AND c.batch_id > 0)
);

GRANT SELECT ON public.clasificacion_lote TO anon, authenticated, service_role;
