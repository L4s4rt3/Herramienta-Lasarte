-- El aprovechamiento por productor enseñaba 21.783.807 kg cuando el calibrador
-- clasificó 21.925.879: faltaban 142.073 kg (0,65%) y la pantalla no lo decía.
--
-- POR QUÉ SE PERDÍAN. La versión anterior unía con `calibrador_informe` por
-- lote. Las pasadas cuyo BatchName no lleva ningún grupo de 8 dígitos ("22/07
-- 22 BOX - 23/07 43 BOX") se importan con lote NULL, así que ese JOIN las
-- tiraba enteras — en silencio, que es lo peor.
--
-- QUÉ CAMBIA. La fecha se toma de `calibrador_batch.inicio`, que existe SIEMPRE
-- (es la pasada real de la máquina), en vez de `calibrador_informe.fecha`, que
-- solo existe si el lote se pudo leer. Los kilos que no se pueden atribuir a
-- nadie salen agrupados bajo un productor con `productor_id = NULL` y nombre
-- '(sin lote legible en el calibrador)': la pantalla los separa y los enseña
-- aparte, en vez de hacerlos desaparecer.
--
-- Regla del proyecto que aplica: nunca se inventa un cuadre, y los huecos se
-- ven (docs/TRAZABILIDAD_REFUNDACION.md).

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
    select
      cc.lote,
      cc.peso_kg,
      translate(upper(coalesce(cc.grupo_destino, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') as grupo,
      e.productor_id,
      -- Sin lote legible no hay a quién atribuirlo: se dice, no se esconde.
      case
        when cc.lote is null then '(sin lote legible en el calibrador)'
        else coalesce(cp.nombre, e.agricultor, '(lote sin entrada de bascula)')
      end as productor_nombre
    from public.calibrador_clasificacion cc
    -- La pasada SIEMPRE existe; el informe solo si el lote se pudo leer.
    join public.calibrador_batch cb on cb.batch_id = cc.batch_id
    left join public.entradas_bascula e on e.lote = cc.lote
    left join public.calidad_productores cp on cp.id = e.productor_id
    where cc.batch_id > 0  -- solo el volcado SQL completo, nunca los provisionales de DOCX
      and (desde is null or cb.inicio::date >= desde)
      and (hasta is null or cb.inicio::date <= hasta)
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
$function$;
