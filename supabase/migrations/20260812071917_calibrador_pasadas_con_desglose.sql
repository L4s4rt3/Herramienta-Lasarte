-- Las pasadas cuyo nombre dice que se echo algo mas, con sus kg POR DESTINO, para
-- poder repartirlas con src/lib/desgloseBox.ts sin duplicar aqui ni una linea de
-- ese parser (que es texto libre y tiene sus reglas: el box va unas veces antes y
-- otras despues, "4K" no son box, el reciclaje no atribuye kg...).
--
-- El reparto NO se guarda: se deriva al leer, como manda la regla de oro de
-- docs/TRAZABILIDAD_REFUNDACION.md. Aqui solo se sirven los hechos.
CREATE OR REPLACE FUNCTION public.calibrador_pasadas_con_desglose(
  desde date DEFAULT NULL,
  hasta date DEFAULT NULL
)
RETURNS TABLE (
  batch_id integer,
  batch_name text,
  lote text,
  fecha date,
  kg_total numeric,
  kg_exportacion numeric,
  kg_no_exportacion numeric,
  kg_industria numeric,
  kg_mujeres numeric,
  kg_otros numeric
)
LANGUAGE sql
STABLE
AS $function$
  with g as (
    select cb.batch_id, cb.batch_name, cb.lote, cb.inicio::date as fecha,
           cc.peso_kg,
           translate(upper(coalesce(cc.grupo_destino, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') as grupo
    from public.calibrador_batch cb
    join public.calibrador_clasificacion cc on cc.batch_id = cb.batch_id
    where cc.batch_id > 0
      and cb.lote ~ '^\d{8}$'
      and cb.batch_name ~* 'box|prec|recicl|\+|[0-9]{1,2}/[0-9]{1,2}'
      and (desde is null or cb.inicio::date >= desde)
      and (hasta is null or cb.inicio::date <= hasta)
  )
  select batch_id, batch_name, lote, fecha,
         round(sum(peso_kg), 4),
         round(sum(peso_kg) filter (where grupo = 'EXPORTACION'), 4),
         round(sum(peso_kg) filter (where grupo = 'NO EXPORTACION'), 4),
         round(sum(peso_kg) filter (where grupo like '%INDUSTRIA%' or grupo = 'NO COMERCIAL'), 4),
         round(sum(peso_kg) filter (where grupo = 'MUJERES'), 4),
         round(sum(peso_kg) filter (where grupo not in ('EXPORTACION','NO EXPORTACION','MUJERES','NO COMERCIAL')
                                          and grupo not like '%INDUSTRIA%'), 4)
  from g
  group by batch_id, batch_name, lote, fecha;
$function$;

-- Quien es el dueño de cada lote de entrada, por su codigo canonico. Hace falta
-- para poder mover los kg al productor correcto cuando una pasada nombra varios.
-- (Se reemplaza en 20260812075757 para seguir tambien la cadena del precalibrado.)
CREATE OR REPLACE FUNCTION public.productor_por_lote(lotes text[])
RETURNS TABLE (lote text, productor_id uuid, productor text)
LANGUAGE sql
STABLE
AS $function$
  select e.lote, e.productor_id, coalesce(cp.nombre, e.agricultor)
  from public.entradas_bascula e
  left join public.calidad_productores cp on cp.id = e.productor_id
  where e.lote = any(lotes);
$function$;
