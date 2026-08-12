-- Aprovechamiento del calibrador por productor: cuánto de cada uno va a
-- Exportación / Industria / Mujeres, con TODAS las pasadas.
--
-- Identidad del productor: por CÓDIGO DE LOTE, no por nombre. La clasificación
-- del calibrador (lote AAMMDDNN) se cruza con entradas_bascula (lote UNIQUE) y
-- se usa su productor_id canónico — comprobado biyectivo con el ERP. Los lotes
-- del calibrador que no estén en báscula caen en "(sin productor en báscula)".
--
-- El grupo llega con dos grafías (EXPORTACION / EXPORTACIÓN): se normaliza
-- quitando tildes antes de agrupar, o se contaría doble.
--
-- OJO: esta version se REEMPLAZA mas adelante (ver
-- 20260812065150_calibrador_aprovechamiento_sin_huecos y
-- 20260812075846_calibrador_aprovechamiento_con_precalibrado). Se conserva para
-- que el historial de migraciones se pueda reproducir en orden.

create or replace function public.calibrador_aprovechamiento_productor(
  desde date default null,
  hasta date default null
)
returns table (
  productor_id uuid,
  productor text,
  lotes bigint,
  kg_total numeric,
  kg_exportacion numeric,
  kg_no_exportacion numeric,
  kg_industria numeric,
  kg_mujeres numeric,
  kg_otros numeric,
  pct_exportacion numeric
)
language sql
stable
as $$
  with base as (
    select
      cc.lote,
      cc.peso_kg,
      -- grupo sin tildes y en mayúsculas
      translate(upper(coalesce(cc.grupo_destino, '')),
                'ÁÉÍÓÚÜ', 'AEIOUU') as grupo,
      e.productor_id,
      coalesce(cp.nombre, e.agricultor, '(sin productor en báscula)') as productor_nombre
    from public.calibrador_clasificacion cc
    join public.calibrador_informe ci on ci.lote = cc.lote
    left join public.entradas_bascula e on e.lote = cc.lote
    left join public.calidad_productores cp on cp.id = e.productor_id
    where cc.batch_id > 0  -- solo el volcado SQL completo, nunca los provisionales de DOCX
      and (desde is null or ci.fecha >= desde)
      and (hasta is null or ci.fecha <= hasta)
  )
  select
    productor_id,
    productor_nombre as productor,
    count(distinct lote) as lotes,
    round(sum(peso_kg)) as kg_total,
    round(sum(peso_kg) filter (where grupo = 'EXPORTACION')) as kg_exportacion,
    round(sum(peso_kg) filter (where grupo = 'NO EXPORTACION')) as kg_no_exportacion,
    round(sum(peso_kg) filter (where grupo like '%INDUSTRIA%' or grupo = 'NO COMERCIAL')) as kg_industria,
    round(sum(peso_kg) filter (where grupo = 'MUJERES')) as kg_mujeres,
    round(sum(peso_kg) filter (where grupo not in ('EXPORTACION','NO EXPORTACION','MUJERES','NO COMERCIAL')
                                     and grupo not like '%INDUSTRIA%')) as kg_otros,
    round(100.0 * sum(peso_kg) filter (where grupo = 'EXPORTACION') / nullif(sum(peso_kg), 0), 1) as pct_exportacion
  from base
  group by productor_id, productor_nombre
  order by kg_total desc;
$$;
