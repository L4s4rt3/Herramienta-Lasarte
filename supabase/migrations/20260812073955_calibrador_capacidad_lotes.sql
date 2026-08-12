-- Cuanto le queda por procesar a cada lote, para poder repartir las pasadas que
-- nombran varios sin inventarse nada (regla del dueño 21-jul-2026, fase 1 de
-- conciliacionKg.ts: en el orden del texto y con tope en el pendiente de cada uno).
--
-- `kg_atribuido_simple` es lo que ya se llevo el lote por pasadas que SOLO le
-- nombran a el: eso no se discute y se descuenta del pendiente antes de repartir.
-- Lo que viene de pasadas compuestas se deja fuera a proposito, porque es
-- precisamente lo que se va a redistribuir.
CREATE OR REPLACE FUNCTION public.calibrador_capacidad_lotes()
RETURNS TABLE (
  lote text,
  kg_entrada numeric,
  kg_atribuido_simple numeric
)
LANGUAGE sql
STABLE
AS $function$
  with compuestas as (
    select cb.batch_id
    from public.calibrador_batch cb
    where cb.batch_name ~ '\d{8}.*\d{8}'
  ),
  simple as (
    select cc.lote, sum(cc.peso_kg) as kg
    from public.calibrador_clasificacion cc
    where cc.batch_id > 0
      and cc.lote is not null
      and cc.batch_id not in (select batch_id from compuestas)
    group by cc.lote
  )
  select e.lote,
         sum(e.kg_entrada)::numeric,
         coalesce(max(s.kg), 0)::numeric
  from public.entradas_bascula e
  left join simple s on s.lote = e.lote
  group by e.lote;
$function$;
