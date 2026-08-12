-- El dueño de un lote, siguiendo la cadena del precalibrado hacia atrás.
--
-- Un lote de re-entrada de precalibrado no tiene productor propio (es un
-- movimiento interno del almacén), pero SÍ se sabe de qué lotes salió esa fruta
-- (erp_precalibrado_origen). Esta función devuelve, para cada lote, uno o varios
-- productores con su fracción — así los kilos vuelven a las fincas de las que
-- eran en vez de quedarse colgando de un almacén.
--
-- Un lote normal devuelve una sola fila con fraccion = 1.
-- Un lote de precalibrado CON origen devuelve una fila por productor original.
-- Un lote de precalibrado SIN origen devuelve su propio "productor" (el almacén),
-- que la pantalla enseña aparte: el hueco se ve, no se reparte a ojo.
DROP FUNCTION IF EXISTS public.productor_por_lote(text[]);

CREATE FUNCTION public.productor_por_lote(lotes text[])
RETURNS TABLE (lote text, productor_id uuid, productor text, fraccion numeric)
LANGUAGE sql
STABLE
AS $function$
  with pedidos as (
    select unnest(lotes) as lote
  ),
  desde_prec as (
    select p.lote,
           eo.lote_origen,
           eo.kg_atribuidos / nullif(sum(eo.kg_atribuidos) over (partition by p.lote), 0) as fraccion
    from pedidos p
    join public.erp_precalibrado_origen eo on eo.lote_reentrada = p.lote
  )
  select d.lote,
         e.productor_id,
         coalesce(cp.nombre, e.agricultor) as productor,
         d.fraccion
    from desde_prec d
    join public.entradas_bascula e on e.lote = d.lote_origen
    left join public.calidad_productores cp on cp.id = e.productor_id
   where d.fraccion > 0

  union all

  select p.lote, e.productor_id, coalesce(cp.nombre, e.agricultor), 1::numeric
    from pedidos p
    join public.entradas_bascula e on e.lote = p.lote
    left join public.calidad_productores cp on cp.id = e.productor_id
   where not exists (select 1 from desde_prec d where d.lote = p.lote);
$function$;

COMMENT ON FUNCTION public.productor_por_lote(text[]) IS
  'Dueño de cada lote. Un lote de re-entrada de precalibrado se resuelve hacia atras contra erp_precalibrado_origen y devuelve VARIAS filas (una por productor original, con su fraccion); el resto devuelve una sola con fraccion 1.';
