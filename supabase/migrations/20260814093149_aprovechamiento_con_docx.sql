-- El aprovechamiento por productor cuenta tambien los informes DOCX.
--
-- POR QUE CAMBIA. Hasta hoy esta RPC solo miraba el volcado SQL del Sizer
-- (`batch_id > 0`), porque de un lote con varias pasadas el DOCX solo trae la
-- ULTIMA y mezclarlos dejaria los kilos cortos. Pero el volcado hay que
-- exportarlo a mano y ya no se va a hacer: desde el 14-08-2026 los informes del
-- calibrador entran como DOCX (decision del dueño). Con la regla vieja, el 12 y
-- el 13 de agosto salian a CERO kilos en la pagina teniendo sus informes en la
-- base.
--
-- LO QUE SE PIERDE, dicho claro: dentro de un mismo dia, un lote que pasa dos
-- veces por la linea solo enseña la ultima pasada. Medido sobre la campaña son
-- 37 de 1.271 pares (lote, dia) — un 2,9%. Por eso la RPC devuelve ademas
-- `kg_provisional`: los kilos que vienen de informes y no del volcado, para que
-- la pantalla pueda decirlo en vez de dar un numero corto por bueno.
--
-- NUNCA SE SUMAN LAS DOS FUENTES DEL MISMO LOTE. Si un lote tiene volcado, sus
-- filas provisionales se ignoran aunque existan. Hacia falta de verdad: el
-- 11-08 el volcado entro el dia 12 y sus DOCX llegaron el 13, asi que 6 lotes
-- acabaron con las dos (121.703 kg que se habrian contado por duplicado).
-- Ademas subirInforme ya no escribe lineas de un lote volcado, y el importador
-- del volcado sigue limpiando lo provisional que encuentra: tres cerrojos para
-- el mismo agujero, porque los informes y el volcado llegan en cualquier orden.
--
-- La fecha de una pasada de DOCX sale de `calibrador_informe.fecha`, atada a sus
-- lineas por `calibrador_informe.batch_id` (migracion 20260814140000).

drop function if exists public.calibrador_aprovechamiento_productor(date, date);

create function public.calibrador_aprovechamiento_productor(
  desde date default null, hasta date default null)
returns table(
  productor_id uuid, productor text, lotes bigint,
  kg_total numeric, kg_exportacion numeric, kg_no_exportacion numeric,
  kg_industria numeric, kg_mujeres numeric, kg_otros numeric,
  pct_exportacion numeric, kg_provisional numeric)
language sql stable as $function$
  -- El volcado SQL: la verdad completa, todas las pasadas.
  with volcado as (
    select cc.lote, cc.peso_kg, cc.grupo_destino, false as provisional
      from public.calibrador_clasificacion cc
      join public.calibrador_batch cb on cb.batch_id = cc.batch_id
     where cc.batch_id > 0
       and (desde is null or cb.inicio::date >= desde)
       and (hasta is null or cb.inicio::date <= hasta)
  ),
  -- Los informes DOCX, solo de los lotes que el volcado NO cubre.
  docx as (
    select cc.lote, cc.peso_kg, cc.grupo_destino, true as provisional
      from public.calibrador_clasificacion cc
      join public.calibrador_informe ci on ci.batch_id = cc.batch_id
     where cc.batch_id < 0
       and (desde is null or ci.fecha >= desde)
       and (hasta is null or ci.fecha <= hasta)
       and not exists (
         select 1 from public.calibrador_clasificacion v
          where v.lote = cc.lote and v.batch_id > 0)
  ),
  base as (
    select lote, peso_kg, provisional,
           translate(upper(coalesce(grupo_destino, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') as grupo
      from (select * from volcado union all select * from docx) t
  ),
  -- Precalibrado con origen conocido: una fila por productor original.
  prec as (
    select eo.lote_reentrada as lote, e.productor_id,
           coalesce(cp.nombre, e.agricultor) as productor,
           eo.kg_atribuidos / nullif(sum(eo.kg_atribuidos) over (partition by eo.lote_reentrada), 0) as fraccion
      from public.erp_precalibrado_origen eo
      join public.entradas_bascula e on e.lote = eo.lote_origen
      left join public.calidad_productores cp on cp.id = e.productor_id
  ),
  -- Todo lo demas: su propio productor, entero.
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
