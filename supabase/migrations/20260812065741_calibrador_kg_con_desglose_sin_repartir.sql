-- Cuantos kilos vienen de pasadas donde el operario escribio que se echo ALGO
-- MAS en la linea ("26051904-15 BOX +7 BOX DE RECICLAJE", "26013107+26012608")
-- y que hoy se atribuyen ENTEROS al primer codigo del nombre.
--
-- No reparte nada: solo lo cuenta, para que la pantalla pueda decirlo en vez de
-- presentar una atribucion como si fuera exacta. El reparto de verdad lo hace
-- src/lib/desgloseBox.ts, que necesita los box de cada linea y decisiones que
-- son de una persona (a que re-entrada de PREC corresponde una fecha).
CREATE OR REPLACE FUNCTION public.calibrador_desglose_sin_repartir(
  desde date DEFAULT NULL,
  hasta date DEFAULT NULL
)
RETURNS TABLE (
  pasadas bigint,
  kg numeric,
  pasadas_varios_lotes bigint
)
LANGUAGE sql
STABLE
AS $function$
  with marcadas as (
    select cb.batch_id,
           (cb.batch_name ~ '\d{8}.*\d{8}') as varios_lotes,
           sum(cc.peso_kg) as kg
    from public.calibrador_batch cb
    join public.calibrador_clasificacion cc on cc.batch_id = cb.batch_id
    where cc.batch_id > 0
      and cb.lote ~ '^\d{8}$'
      and cb.batch_name ~* 'box|prec|recicl|\+|[0-9]{1,2}/[0-9]{1,2}'
      and (desde is null or cb.inicio::date >= desde)
      and (hasta is null or cb.inicio::date <= hasta)
    group by cb.batch_id, cb.batch_name
  )
  select count(*)::bigint,
         round(sum(kg)),
         count(*) filter (where varios_lotes)::bigint
  from marcadas;
$function$;
