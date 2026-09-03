-- Mix de clasificación por lote, agregado en servidor (03-09-2026).
--
-- POR QUÉ. La pestaña "Campaña" de Entradas necesita, para cada lote, cuántos
-- kg fueron a cada destino, a cada clase y a cada formato de Mercadona. La
-- fuente es la vista clasificacion_lote (volcado SQL + Excel + DOCX, regla de
-- frescura por lote-día): ~260.000 filas. Bajarlas al navegador son ~300
-- páginas de PostgREST; y la vista sola ya roza el statement timeout de 8 s de
-- los usuarios. Esta vista MATERIALIZADA la agrega en servidor y la RPC la
-- entrega en un solo jsonb, como ya hace clasificacion_productor_periodo.
--
-- ESTA PRIMERA VERSIÓN agregaba por (lote, producto, destino, clase) y salió a
-- 110.248 filas (~13 MB): la migración siguiente (20260903071115) la sustituye
-- por el pivot por (lote, producto). Se conserva tal cual porque así se aplicó.
--
-- El formato de Mercadona NO se deduce aquí: lo hace la función TypeScript
-- compartida (_shared/mdnaMix.ts) sobre el nombre del producto, la misma que
-- usan el script y la página. Aquí solo se suman kilos.
--
-- Se refresca cada hora en horario de trabajo (pg_cron, como postgres: sin
-- timeout) y la tabla *_meta dice cuándo fue la última vez, para enseñarlo.

create materialized view if not exists public.clasificacion_lote_mix_mv as
select
  lote_codigo_base                   as lote8,
  producto,
  grupo_destino,
  clase,
  sum(peso_kg)::numeric              as peso_kg,
  count(*)::integer                  as n_filas,
  bool_or(fuente = 'docx')           as con_docx,
  min(fecha)                         as fecha_min,
  max(fecha)                         as fecha_max
from public.clasificacion_lote
where lote_codigo_base is not null
group by 1, 2, 3, 4
with no data;

create index if not exists clasificacion_lote_mix_mv_lote8_idx on public.clasificacion_lote_mix_mv (lote8);

create table if not exists public.clasificacion_lote_mix_meta (
  id            boolean primary key default true check (id),
  refrescado_en timestamptz,
  filas         integer,
  duracion_ms   integer
);
insert into public.clasificacion_lote_mix_meta (id) values (true) on conflict do nothing;

-- Quien refresca: pg_cron (postgres) o una llamada de mantenimiento con service_role.
create or replace function public.refrescar_clasificacion_lote_mix()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t0 timestamptz := clock_timestamp();
begin
  refresh materialized view public.clasificacion_lote_mix_mv;
  update public.clasificacion_lote_mix_meta
     set refrescado_en = now(),
         filas = (select count(*) from public.clasificacion_lote_mix_mv),
         duracion_ms = (extract(epoch from clock_timestamp() - t0) * 1000)::integer
   where id;
end;
$$;
revoke all on function public.refrescar_clasificacion_lote_mix() from public, anon, authenticated;
grant execute on function public.refrescar_clasificacion_lote_mix() to service_role;

-- Lo que lee la app: todas las filas del agregado en un solo jsonb (esquiva el
-- recorte de 1.000 de PostgREST) y la fecha del último refresco.
create or replace function public.clasificacion_mix_lotes()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'refrescado_en', (select refrescado_en from public.clasificacion_lote_mix_meta where id),
    'filas', coalesce(jsonb_agg(jsonb_build_object(
      'lote8', lote8, 'producto', producto, 'grupo_destino', grupo_destino, 'clase', clase,
      'peso_kg', peso_kg, 'n_filas', n_filas, 'con_docx', con_docx
    )), '[]'::jsonb)
  )
  from public.clasificacion_lote_mix_mv;
$$;

alter table public.clasificacion_lote_mix_meta enable row level security;
drop policy if exists "clasificacion_lote_mix_meta_select" on public.clasificacion_lote_mix_meta;
create policy "clasificacion_lote_mix_meta_select" on public.clasificacion_lote_mix_meta
  for select to authenticated using (true);
grant select on public.clasificacion_lote_mix_mv to authenticated, service_role;
grant execute on function public.clasificacion_mix_lotes() to authenticated, service_role;
revoke all on public.clasificacion_lote_mix_mv from anon;

-- Cada hora en horario de trabajo (UTC): el volcado y los DOCX entran de día.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'clasificacion-mix-refresco') then
    perform cron.unschedule('clasificacion-mix-refresco');
  end if;
end
$do$;
select cron.schedule('clasificacion-mix-refresco', '20 5-20 * * *', $job$select public.refrescar_clasificacion_lote_mix();$job$);
