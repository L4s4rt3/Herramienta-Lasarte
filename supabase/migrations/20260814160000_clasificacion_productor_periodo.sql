-- La clasificación del dossier por productor, agregada en la base y en UNA
-- llamada.
--
-- EL PROBLEMA. `lote_clasificacion_productor_agg` agrupa por (productor,
-- grupo_destino, clase, tamaño, FECHA), pero el consumidor tira la fecha:
-- mapProductorAggRowsToClasificacionRows la descarta y su propio comentario lo
-- dice ("suma de sumas = suma del todo"). Esa fecha de más multiplica las filas
-- por días:
--
--   con fecha .... 131.958 filas → 132 páginas de mil
--   sin fecha .....  16.585 filas → una sola respuesta
--
-- Y cada página vuelve a escanear y agregar `clasificacion_lote` entera (~4 s),
-- así que el dossier tardaba MINUTOS. No es solo lento: con la vista anterior se
-- pasaba del statement_timeout y la pestaña se quedaba sin perfil de destino.
--
-- POR QUÉ DEVUELVE jsonb Y NO FILAS. PostgREST recorta cualquier respuesta al
-- max-rows del servidor EN SILENCIO (regla del proyecto, ver
-- src/lib/fetchAllRows.ts): 16.585 filas saldrían cortadas a 1.000 sin un solo
-- error, o habría que paginarlas y volver a pagar la agregación 17 veces. Un
-- jsonb es UNA fila para PostgREST, así que ni se recorta ni se pagina. Son
-- ~1,6 MB de datos — menos de lo que ya se descargaba.
--
-- MISMO RESULTADO, comprobado contra la vista anterior sobre la campaña entera:
-- 24.496.304 kg en las dos, y cero de diferencia en piezas y cartons.
--
-- Las filas sin productor se dejan fuera aquí porque el consumidor ya las
-- descartaba (`if (!nombre) continue`): es el mismo resultado con menos peso.
create or replace function public.clasificacion_productor_periodo(
  desde date default null, hasta date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'productor',     t.productor,
           'grupo_destino', t.grupo_destino,
           'clase',         t.clase,
           'tamano',        t.tamano,
           'peso_kg',       t.peso_kg,
           'piezas',        t.piezas,
           'cartons',       t.cartons)), '[]'::jsonb)
    from (
      select cl.productor,
             cl.grupo_destino,
             cl.clase,
             cl.tamano,
             sum(cl.peso_kg) as peso_kg,
             sum(cl.piezas)  as piezas,
             sum(cl.cartons) as cartons
        from public.clasificacion_lote cl
       where cl.productor is not null
         and (desde is null or cl.fecha >= desde)
         and (hasta is null or cl.fecha <= hasta)
       group by cl.productor, cl.grupo_destino, cl.clase, cl.tamano
    ) t;
$function$;

comment on function public.clasificacion_productor_periodo(date, date) is
  'Clasificación agregada por (productor, grupo_destino, clase, tamaño) para un periodo, en un solo jsonb. Es la granularidad exacta que necesita el dossier por productor: la fecha no se agrupa porque el consumidor la descarta.';

grant execute on function public.clasificacion_productor_periodo(date, date)
  to anon, authenticated, service_role;
