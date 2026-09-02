-- El dossier por productor dejaba de cargar: 19,7 s para 1.000 filas.
--
-- SÍNTOMA. `/productores` (pestaña "Dossier por productor") tiraba en consola
--   Error inesperado fetching lote_clasificacion:
--   canceling statement due to statement timeout (57014)
-- y la pestaña se quedaba sin perfil de destino. No es la tabla: es esta vista.
--
-- LA CAUSA, en una línea del plan:
--
--   Nested Loop Left Join ... Join Filter: (d_2.lote = lc.lote_codigo)
--   Rows Removed by Join Filter: 45097204
--
-- 45 millones de comparaciones. El respaldo (los lotes que el calibrador no
-- tiene) unía `lote_clasificacion` con `productor_lote_dominante`, que es una
-- vista con DISTINCT ON y por tanto NO SE PUEDE INDEXAR: para cada una de las
-- 33.806 líneas se rescaneaban sus 1.334 filas enteras. El planificador lo
-- eligió porque estimaba UNA fila donde había 33.806 — el anti-join contra el
-- calibrador le sale rematadamente mal.
--
-- EL ARREGLO. Un LATERAL con LIMIT 1 en vez del join. El predicado
-- `pl.lote = lc.lote_codigo` baja hasta las ramas de `productor_lote` y ahí sí
-- hay índices (`entradas_bascula_lote_key`, `erp_precalibrado_origen_reentrada_idx`),
-- así que 45 millones de comparaciones pasan a 33.806 búsquedas por índice.
--
--   antes:  19.727 ms
--   ahora:     774 ms   (25 veces más rápido)
--
-- MISMO RESULTADO, no es un atajo: `productor_lote_dominante` es
-- DISTINCT ON (lote) ... ORDER BY lote, fraccion DESC, productor, y el LATERAL
-- ordena por fraccion DESC, productor con LIMIT 1. Misma fila y mismo desempate.
-- La vista se queda como está para sus otros consumidores; solo deja de usarse
-- AQUÍ, que es donde su forma no dejaba trabajar al planificador.
--
-- La rama del calibrador no se toca: son 1.309 pasadas y ahí el join va por
-- merge en milisegundos.
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
);

GRANT SELECT ON public.clasificacion_lote TO anon, authenticated, service_role;
