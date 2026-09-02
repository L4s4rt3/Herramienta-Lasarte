-- Copia de seguridad propia con restauración probada (cierre de la Fase 1,
-- docs/SISTEMA_LASARTE.md).
--
-- POR QUÉ UNA COPIA PROPIA. Las copias de Supabase viven DENTRO de Supabase:
-- protegen de un fallo suyo, pero no de perder el acceso a la cuenta ni valen
-- de nada si un día hay que irse. La copia propia baja cada noche todas las
-- tablas a ficheros del portátil (outputs/copias/, que OneDrive sube solo a la
-- nube: segunda ubicación sin montar nada) y el espejo del storage.
--
-- POR QUÉ RPCs. En este equipo no hay pg_dump ni Docker ni contraseña directa
-- de Postgres: la copia va por la API REST con la service role, y estas
-- funciones le dan lo que la API no da — el recuento exacto por tabla (para
-- verificar el volcado), la lista de archivos del storage (para el espejo
-- incremental) y un esquema aparte donde ENSAYAR la restauración de verdad.
--
-- SEGURIDAD: todas son SECURITY DEFINER y solo las puede ejecutar la service
-- role. Ninguna escribe en public: la restauración de prueba vive en el esquema
-- `restauracion`, que se crea y se tira entero.

-- ── El manifiesto: qué tablas hay, su clave primaria y cuántas filas exactas ──
create or replace function public.copia_manifiesto()
returns table (tabla text, pk text[], filas bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n bigint;
begin
  for r in
    select c.relname::text as nombre,
           coalesce((
             select array_agg(kcu.column_name::text order by kcu.ordinal_position)
             from information_schema.table_constraints tc
             join information_schema.key_column_usage kcu
               on kcu.constraint_name = tc.constraint_name
              and kcu.table_schema = tc.table_schema
             where tc.constraint_type = 'PRIMARY KEY'
               and tc.table_schema = 'public'
               and tc.table_name = c.relname
           ), '{}') as pk
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    execute format('select count(*) from public.%I', r.nombre) into n;
    tabla := r.nombre;
    pk := r.pk;
    filas := n;
    return next;
  end loop;
end
$$;

-- La versión del esquema que acompaña a cada copia: sin ella, en un desastre no
-- se sabría QUÉ migraciones aplicar antes de restaurar.
create or replace function public.copia_version_esquema()
returns text
language sql security definer set search_path = supabase_migrations, pg_temp as $$
  select version from supabase_migrations.schema_migrations order by version desc limit 1;
$$;

-- Los archivos del storage, para el espejo incremental: la API de listado va
-- por carpetas y a trompicones; storage.objects lo da entero de una vez.
create or replace function public.copia_archivos_manifiesto()
returns table (cubo text, nombre text, bytes bigint, actualizado timestamptz)
language sql security definer set search_path = storage, pg_temp as $$
  select bucket_id::text, name::text,
         coalesce((metadata->>'size')::bigint, 0),
         updated_at
  from storage.objects
  where name is not null
  order by bucket_id, name;
$$;

-- ── La restauración de prueba: un esquema aparte donde ensayar de verdad ─────
-- El mismo cargador que restauraría en un desastre (scripts/restaurar-copia.mjs)
-- mete aquí los ficheros de la copia, y se comparan recuentos y huellas. Las
-- tablas se crean con LIKE a secas (sin identity ni generados): así las columnas
-- aceptan los valores explícitos del fichero.

create or replace function public.restauracion_preparar(tablas text[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t text;
begin
  execute 'drop schema if exists restauracion cascade';
  execute 'create schema restauracion';
  foreach t in array tablas loop
    -- Solo tablas que existan en public: el nombre viene de fuera y format(%I)
    -- ya lo confina, pero un nombre inexistente debe fallar claro aquí.
    perform 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind = 'r' and c.relname = t;
    if not found then
      raise exception 'no existe la tabla public.%', t;
    end if;
    execute format('create table restauracion.%I (like public.%I)', t, t);
  end loop;
end
$$;

create or replace function public.restauracion_cargar(tabla text, filas jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  execute format(
    'insert into restauracion.%I select * from jsonb_populate_recordset(null::restauracion.%I, $1)',
    tabla, tabla
  ) using filas;
  get diagnostics n = row_count;
  return n;
end
$$;

-- Recuento y huella (md5 de los md5 de cada fila, ordenados) de cada tabla
-- restaurada y de su original. La huella se ordena por sí misma para no
-- depender de la clave primaria. OJO: si la base siguió moviéndose desde que
-- se hizo la copia, la huella del original ya no coincidirá — el criterio de
-- éxito de la PRUEBA es filas_restauradas == filas del manifiesto de la copia;
-- la huella solo confirma igualdad campo a campo cuando se prueba en caliente.
create or replace function public.restauracion_comparar()
returns table (tabla text, filas_restauradas bigint, filas_publico bigint,
               huella_restaurada text, huella_publico text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in
    select c.relname::text as nombre
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'restauracion' and c.relkind = 'r'
    order by c.relname
  loop
    tabla := r.nombre;
    execute format(
      'select count(*), coalesce(md5(string_agg(h, '''' order by h)), '''') from (select md5(x::text) as h from restauracion.%I x) s',
      r.nombre) into filas_restauradas, huella_restaurada;
    execute format(
      'select count(*), coalesce(md5(string_agg(h, '''' order by h)), '''') from (select md5(x::text) as h from public.%I x) s',
      r.nombre) into filas_publico, huella_publico;
    return next;
  end loop;
end
$$;

create or replace function public.restauracion_limpiar()
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  execute 'drop schema if exists restauracion cascade';
end
$$;

-- Solo la service role: ni anon ni authenticated pueden ni verlas correr.
revoke execute on function public.copia_manifiesto() from public, anon, authenticated;
revoke execute on function public.copia_version_esquema() from public, anon, authenticated;
revoke execute on function public.copia_archivos_manifiesto() from public, anon, authenticated;
revoke execute on function public.restauracion_preparar(text[]) from public, anon, authenticated;
revoke execute on function public.restauracion_cargar(text, jsonb) from public, anon, authenticated;
revoke execute on function public.restauracion_comparar() from public, anon, authenticated;
revoke execute on function public.restauracion_limpiar() from public, anon, authenticated;

grant execute on function public.copia_manifiesto() to service_role;
grant execute on function public.copia_version_esquema() to service_role;
grant execute on function public.copia_archivos_manifiesto() to service_role;
grant execute on function public.restauracion_preparar(text[]) to service_role;
grant execute on function public.restauracion_cargar(text, jsonb) to service_role;
grant execute on function public.restauracion_comparar() to service_role;
grant execute on function public.restauracion_limpiar() to service_role;
