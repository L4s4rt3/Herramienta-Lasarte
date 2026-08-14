-- La comparación de la restauración, POR TABLA.
--
-- POR QUÉ. La versión original comparaba las 72 tablas (recuento + huella de
-- ambos lados) en UNA sola llamada: 144 barridos en una sentencia, y saltó el
-- statement_timeout en la primera prueba real (14-08). El timeout es por
-- sentencia, así que la vuelta es una llamada por tabla: cada una tiene su
-- propio límite y las dos gigantes (259k y 270k filas) entran de sobra.
-- El script (restaurar-copia.mjs) recorre y, si aun así una tabla no diera
-- huella a tiempo, lo dice y sigue: el veredicto de la prueba son los
-- RECUENTOS, la huella es información.

drop function if exists public.restauracion_comparar();

create or replace function public.restauracion_comparar(tabla_pedida text)
returns table (tabla text, filas_restauradas bigint, filas_publico bigint,
               huella_restaurada text, huella_publico text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Solo tablas que de verdad estén en el esquema de ensayo.
  perform 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'restauracion' and c.relkind = 'r' and c.relname = tabla_pedida;
  if not found then
    raise exception 'no hay ninguna tabla restauracion.%', tabla_pedida;
  end if;

  tabla := tabla_pedida;
  execute format(
    'select count(*), coalesce(md5(string_agg(h, '''' order by h)), '''') from (select md5(x::text) as h from restauracion.%I x) s',
    tabla_pedida) into filas_restauradas, huella_restaurada;
  execute format(
    'select count(*), coalesce(md5(string_agg(h, '''' order by h)), '''') from (select md5(x::text) as h from public.%I x) s',
    tabla_pedida) into filas_publico, huella_publico;
  return next;
end
$$;

revoke execute on function public.restauracion_comparar(text) from public, anon, authenticated;
grant execute on function public.restauracion_comparar(text) to service_role;
