-- El dueño de un lote del calibrador se casaba por el código CRUDO: todo lote
-- DOCX con anotación del operario caía en "(lote sin entrada de bascula)".
--
-- SÍNTOMA. El 31-08 los 31.035 kg del día salían enteros sin productor en
-- calibrador_aprovechamiento_productor, cuando 25.939 kg son del 26082901 y
-- 5.095 del 26082701 — los dos de LASARTE EXPORT S.L. Harrie Goesten. La causa:
-- el join `dueno d on d.lote = b.lote` compara el texto que teclea el operario
-- en el Sizer ("26082901 -95 BOX", "26051507  34 BOX") con entradas_bascula.lote,
-- que lleva el código pelado AAMMDDNN.
--
-- LA REGLA. La de scripts/lib-lotes.mjs (codigoBaseLote): el emparejado va por
-- el grupo de 8 dígitos, y lo que no lo lleva se compara tal cual. En SQL:
-- coalesce(substring(lote from '\d{8}'), lote).
--
-- LA RAMA VOLCADO NO CAMBIA DE NÚMEROS: sus códigos o son pelados (la
-- normalización es identidad) o son texto sin ningún grupo de 8 dígitos dentro
-- ("PREC 28/04", "RECICLAJE", "7852" — comprobados los 24 que existen), que cae
-- al crudo y sigue sin casar. Por eso en la RPC la normalización puede ser
-- uniforme. En la vista solo se toca el join de la rama DOCX (la única que
-- lleva códigos anotados); la rama del volcado se deja tal cual.
--
-- `lotes` pasa a contar códigos BASE: con el join arreglado, un lote que entró
-- por volcado un día (código pelado) y por DOCX anotado otro día contaría 2
-- para su productor siendo la misma fruta física.
--
-- Verificación hecha al aplicar: la huella md5 por productor hasta el 10-08
-- (era del volcado) queda idéntica; el total de campaña no se mueve
-- (22.662.441 kg); el 31-08 pasa entero de "(lote sin entrada de bascula)" a
-- Harrie Goesten.

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
-- El DISTINCT ON de aquí es la frescura por PASADA (base + fecha + comienzo):
-- del mismo lote re-guardado con otro nombre solo queda el informe más nuevo.
docx_inf AS (
  SELECT DISTINCT ON (
           coalesce(substring(i.lote FROM '\d{8}'), upper(btrim(i.lote))),
           i.fecha,
           i.comienzo
         )
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
   ORDER BY coalesce(substring(i.lote FROM '\d{8}'), upper(btrim(i.lote))),
            i.fecha,
            i.comienzo,
            i.recibido_at DESC NULLS LAST
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
-- El dueño se busca por el código BASE: el crudo lleva lo que tecleó el
-- operario y no casa con nada. Sin 8 dígitos se compara el texto entero.
LEFT JOIN public.productor_lote_dominante pd ON pd.lote = coalesce(d.base8, d.lote)
LEFT JOIN public.partes_diarios pa ON pa.date = d.fecha;

GRANT SELECT ON public.clasificacion_lote TO anon, authenticated, service_role;

-- La RPC del dossier por productor: mismo join por código base, y `lotes`
-- cuenta códigos base para no contar dos veces la misma fruta física.
create or replace function public.calibrador_aprovechamiento_productor(
  desde date default null, hasta date default null)
returns table(
  productor_id uuid, productor text, lotes bigint,
  kg_total numeric, kg_exportacion numeric, kg_no_exportacion numeric,
  kg_industria numeric, kg_mujeres numeric, kg_otros numeric,
  pct_exportacion numeric, kg_provisional numeric)
language sql stable as $function$
  with volcado as (
    select cc.lote, cc.peso_kg, cc.grupo_destino, false as provisional
      from public.calibrador_clasificacion cc
      join public.calibrador_batch cb on cb.batch_id = cc.batch_id
     where cc.batch_id > 0
       and (desde is null or cb.inicio::date >= desde)
       and (hasta is null or cb.inicio::date <= hasta)
  ),
  -- Frescura por PASADA (base + fecha + comienzo): del mismo informe
  -- re-guardado con el nombre editado solo cuenta el más reciente.
  docx_vigente as (
    select distinct on (
             coalesce(substring(i.lote from '\d{8}'), upper(btrim(i.lote))),
             i.fecha,
             i.comienzo)
           i.batch_id, i.lote, i.fecha
      from public.calibrador_informe i
     where i.batch_id < 0
     order by coalesce(substring(i.lote from '\d{8}'), upper(btrim(i.lote))),
              i.fecha,
              i.comienzo,
              i.recibido_at desc nulls last
  ),
  docx as (
    select cc.lote, cc.peso_kg, cc.grupo_destino, true as provisional
      from public.calibrador_clasificacion cc
      join docx_vigente ci on ci.batch_id = cc.batch_id
     where (desde is null or ci.fecha >= desde)
       and (hasta is null or ci.fecha <= hasta)
       and not exists (
         select 1 from public.calibrador_batch b
          where b.inicio::date = ci.fecha
            and substring(b.lote from '\d{8}') = substring(ci.lote from '\d{8}'))
  ),
  base as (
    select lote, peso_kg, provisional,
           -- codigoBaseLote (scripts/lib-lotes.mjs): el grupo de 8 dígitos, o el
           -- texto tal cual si no lo hay. Es identidad para el volcado.
           coalesce(substring(lote from '\d{8}'), lote) as lote_base,
           translate(upper(coalesce(grupo_destino, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') as grupo
      from (select * from volcado union all select * from docx) t
  ),
  prec as (
    select eo.lote_reentrada as lote, e.productor_id,
           coalesce(cp.nombre, e.agricultor) as productor,
           eo.kg_atribuidos / nullif(sum(eo.kg_atribuidos) over (partition by eo.lote_reentrada), 0) as fraccion
      from public.erp_precalibrado_origen eo
      join public.entradas_bascula e on e.lote = eo.lote_origen
      left join public.calidad_productores cp on cp.id = e.productor_id
  ),
  normal as (
    select e.lote, e.productor_id, coalesce(cp.nombre, e.agricultor) as productor,
           1::numeric as fraccion
      from public.entradas_bascula e
      left join public.calidad_productores cp on cp.id = e.productor_id
     where not exists (select 1 from public.erp_precalibrado_origen eo
                        where eo.lote_reentrada = e.lote)
  ),
  dueno as (
    select * from prec where fraccion > 0
    union all
    select * from normal
  ),
  atribuido as (
    select b.lote, b.lote_base, b.grupo, b.provisional,
           b.peso_kg * coalesce(d.fraccion, 1) as kg,
           d.productor_id,
           case when b.lote is null then '(sin lote legible en el calibrador)'
                else coalesce(d.productor, '(lote sin entrada de bascula)') end as productor_nombre
      from base b
      left join dueno d on d.lote = b.lote_base
  )
  select productor_id, productor_nombre as productor,
         count(distinct lote_base) as lotes,
         round(sum(kg)) as kg_total,
         round(sum(kg) filter (where grupo = 'EXPORTACION')) as kg_exportacion,
         round(sum(kg) filter (where grupo = 'NO EXPORTACION')) as kg_no_exportacion,
         round(sum(kg) filter (where grupo like '%INDUSTRIA%' or grupo = 'NO COMERCIAL')) as kg_industria,
         round(sum(kg) filter (where grupo = 'MUJERES')) as kg_mujeres,
         round(sum(kg) filter (where grupo not in ('EXPORTACION','NO EXPORTACION','MUJERES','NO COMERCIAL')
                                 and grupo not like '%INDUSTRIA%')) as kg_otros,
         round(100.0 * sum(kg) filter (where grupo = 'EXPORTACION') / nullif(sum(kg), 0), 1) as pct_exportacion,
         round(sum(kg) filter (where provisional)) as kg_provisional
    from atribuido
   group by productor_id, productor_nombre
   order by kg_total desc;
$function$;
