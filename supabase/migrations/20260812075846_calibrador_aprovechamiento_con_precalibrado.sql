-- El aprovechamiento por productor, siguiendo el precalibrado hasta su finca.
--
-- QUE CAMBIA. Un lote de re-entrada de precalibrado no tiene productor propio:
-- es un movimiento interno del almacen. Antes sus kilos se agrupaban bajo
-- "LASARTE ALMACEN PRECALIBRADO" (274.924 kg colgando de un almacen en un
-- ranking de fincas). Ahora, cuando se sabe de donde salio esa fruta
-- (erp_precalibrado_origen), sus kilos se reparten entre los productores
-- originales en proporcion a lo que dice la trazabilidad del ERP.
--
-- LO QUE NO SE SABE SIGUE VIENDOSE. El 73% del precalibrado no tiene origen
-- registrado (lo apartado no siempre se pesa: 506 t registradas frente a 792 t
-- reintroducidas). Esos kilos se quedan bajo el nombre del almacen, que la
-- pantalla saca del ranking y enseña aparte. Nunca se reparten a ojo.
CREATE OR REPLACE FUNCTION public.calibrador_aprovechamiento_productor(
  desde date DEFAULT NULL,
  hasta date DEFAULT NULL
)
RETURNS TABLE (
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
LANGUAGE sql
STABLE
AS $function$
  with base as (
    select cc.lote, cc.peso_kg,
           translate(upper(coalesce(cc.grupo_destino, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') as grupo
    from public.calibrador_clasificacion cc
    join public.calibrador_batch cb on cb.batch_id = cc.batch_id
    where cc.batch_id > 0
      and (desde is null or cb.inicio::date >= desde)
      and (hasta is null or cb.inicio::date <= hasta)
  ),
  -- Precalibrado con origen conocido: una fila por productor original.
  prec as (
    select eo.lote_reentrada as lote,
           e.productor_id,
           coalesce(cp.nombre, e.agricultor) as productor,
           eo.kg_atribuidos / nullif(sum(eo.kg_atribuidos) over (partition by eo.lote_reentrada), 0) as fraccion
    from public.erp_precalibrado_origen eo
    join public.entradas_bascula e on e.lote = eo.lote_origen
    left join public.calidad_productores cp on cp.id = e.productor_id
  ),
  -- Todo lo demas: su propio productor, entero.
  normal as (
    select e.lote, e.productor_id,
           coalesce(cp.nombre, e.agricultor) as productor,
           1::numeric as fraccion
    from public.entradas_bascula e
    left join public.calidad_productores cp on cp.id = e.productor_id
    where not exists (select 1 from public.erp_precalibrado_origen eo where eo.lote_reentrada = e.lote)
  ),
  dueno as (
    select * from prec where fraccion > 0
    union all
    select * from normal
  ),
  atribuido as (
    select b.lote,
           b.grupo,
           b.peso_kg * coalesce(d.fraccion, 1) as kg,
           d.productor_id,
           case
             when b.lote is null then '(sin lote legible en el calibrador)'
             else coalesce(d.productor, '(lote sin entrada de bascula)')
           end as productor_nombre
    from base b
    left join dueno d on d.lote = b.lote
  )
  select
    productor_id,
    productor_nombre as productor,
    count(distinct lote) as lotes,
    round(sum(kg)) as kg_total,
    round(sum(kg) filter (where grupo = 'EXPORTACION')) as kg_exportacion,
    round(sum(kg) filter (where grupo = 'NO EXPORTACION')) as kg_no_exportacion,
    round(sum(kg) filter (where grupo like '%INDUSTRIA%' or grupo = 'NO COMERCIAL')) as kg_industria,
    round(sum(kg) filter (where grupo = 'MUJERES')) as kg_mujeres,
    round(sum(kg) filter (where grupo not in ('EXPORTACION','NO EXPORTACION','MUJERES','NO COMERCIAL')
                                and grupo not like '%INDUSTRIA%')) as kg_otros,
    round(100.0 * sum(kg) filter (where grupo = 'EXPORTACION') / nullif(sum(kg), 0), 1) as pct_exportacion
  from atribuido
  group by productor_id, productor_nombre
  order by kg_total desc;
$function$;
