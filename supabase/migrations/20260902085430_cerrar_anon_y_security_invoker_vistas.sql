-- Auditoría 02-09-2026: datos de negocio legibles SIN iniciar sesión.
--
-- SÍNTOMA. Con la anon key (pública: viaja en el bundle de la app) y sin
-- token, `GET /rest/v1/palets` devolvía las 43.403 filas de palets del ERP;
-- lo mismo productor_lote, palets_dia_cerrado, clasificacion_lote y los
-- agregados lote_clasificacion_*_agg.
--
-- LA CAUSA, dos cosas que se suman:
--   1. Las vistas se crearon sin `security_invoker`: una vista corre con los
--      privilegios de su DUEÑO (postgres) y por tanto SALTA la RLS de las
--      tablas de debajo. Las vistas de ventas_categoria_* y las dos del
--      dashboard mensual sí lo llevaban; las de agosto no.
--   2. Los privilegios por defecto de Supabase conceden TODO a `anon` sobre
--      cada tabla/vista/función nueva de `public`. En las tablas no importa
--      (la RLS lo frena, ninguna política nombra a anon); en las vistas sí.
--
-- EL ARREGLO.
--   a) security_invoker=on en las 7 vistas que no lo tenían: la vista pasa a
--      evaluarse con el rol que la consulta y la RLS de las tablas manda.
--      Todas sus tablas base tienen SELECT para `authenticated` (comprobado),
--      así que la app logueada ve exactamente lo mismo que antes.
--   b) Se retira a `anon` todo privilegio sobre tablas, vistas, secuencias y
--      funciones de `public`, y se cambia el privilegio POR DEFECTO para que
--      lo nuevo que cree `postgres` tampoco se lo dé. La app nunca lee datos
--      sin sesión (el login es GoTrue, no PostgREST); las edge functions y
--      los scripts del portátil usan service_role.
--   c) saf_camiones: la política de escritura era `using (true)` para
--      cualquier autenticado — cualquiera podía cambiar el precio Laadbon
--      con el que el vigía detecta desviaciones. Pasa a solo admin.
--
-- REGLA para las vistas que vengan: `create view ... with (security_invoker = on)`
-- SIEMPRE. Y nada de `grant ... to anon`.

alter view public.clasificacion_lote set (security_invoker = on);
alter view public.productor_lote set (security_invoker = on);
alter view public.productor_lote_dominante set (security_invoker = on);
alter view public.palets set (security_invoker = on);
alter view public.palets_dia_cerrado set (security_invoker = on);
alter view public.lote_clasificacion_podrido_agg set (security_invoker = on);
alter view public.lote_clasificacion_productor_agg set (security_invoker = on);

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke all privileges on all functions in schema public from anon;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

drop policy if exists "saf_camiones_write" on public.saf_camiones;
create policy "saf_camiones_write" on public.saf_camiones
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
