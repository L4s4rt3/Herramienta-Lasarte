-- El cerrojo anti-duplicado es por (lote, DIA), no por lote.
--
-- LA MIGRACION DE HACE UN RATO SE EQUIVOCO, y conviene que quede escrito porque
-- es el error natural al leer estas tablas. Decia: "si un lote tiene volcado,
-- ignora sus filas provisionales". Pero un mismo lote entra en linea VARIOS
-- DIAS — el 26051506 y el 26051907 se pasaron el 11 (volcado) y otra vez el 12
-- (solo DOCX). Con la regla por lote, el dia 12 perdia sus kilos porque el 11
-- estaba volcado: 2 informes y 22.598 kg que desaparecieron del parte del 12
-- hasta que se restauraron desde los .docx del disco.
--
-- La regla buena: una pasada de DOCX solo sobra si el volcado cubre ESE LOTE
-- ESE DIA. Los 8 digitos se comparan normalizados porque las dos fuentes
-- escriben el lote distinto: el volcado guarda el codigo pelado (26051507) y el
-- informe, lo que tecleo el operario ("26051507  34 BOX").
--
-- Misma correccion en scripts/lib-subir-informe-calibrador.mjs (que decide si
-- escribir las lineas de un informe) y en
-- scripts/backfill-batch-id-informes.mjs (que limpia lo que ya hubiera).
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
  docx as (
    select cc.lote, cc.peso_kg, cc.grupo_destino, true as provisional
      from public.calibrador_clasificacion cc
      join public.calibrador_informe ci on ci.batch_id = cc.batch_id
     where cc.batch_id < 0
       and (desde is null or ci.fecha >= desde)
       and (hasta is null or ci.fecha <= hasta)
       and not exists (
         select 1 from public.calibrador_batch b
          where b.inicio::date = ci.fecha
            and substring(b.lote from '\d{8}') = substring(ci.lote from '\d{8}'))
  ),
  base as (
    select lote, peso_kg, provisional,
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
    select b.lote, b.grupo, b.provisional,
           b.peso_kg * coalesce(d.fraccion, 1) as kg,
           d.productor_id,
           case when b.lote is null then '(sin lote legible en el calibrador)'
                else coalesce(d.productor, '(lote sin entrada de bascula)') end as productor_nombre
      from base b
      left join dueno d on d.lote = b.lote
  )
  select productor_id, productor_nombre as productor,
         count(distinct lote) as lotes,
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
