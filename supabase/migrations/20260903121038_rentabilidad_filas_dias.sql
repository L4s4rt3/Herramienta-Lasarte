-- Análisis económico por tipo de día como página (03-09-2026).
--
-- La página necesita, para cada día desde mayo, las filas del calibrador al
-- grano que pide computeRentabilidadDia (lote × producto × clase, con la
-- duración y las t/h de la pasada): unas 33.000 filas para 90 días, frente a
-- las 96.000 del detalle por calibre y las 300.000 de la vista canónica.
--
-- 1. clasificacion_lote_detalle_mv gana tres columnas que ya trae la vista y
--    dependen solo de la pasada (productor, duracion_min, toneladas_hora) y un
--    índice por fecha. Mismo número de filas.
-- 2. RPC rentabilidad_filas_dias(desde, hasta): las filas agregadas por
--    (fecha, lote, productor, producto, clase), posicionales. El destino de
--    cada fila (MDNA 3 kg, industria, podrido…) lo decide el TypeScript
--    (clasificarDestinoRentabilidad), la misma regla que /economico/rentabilidad.

drop materialized view if exists public.clasificacion_lote_detalle_mv;

create materialized view public.clasificacion_lote_detalle_mv as
select
  lote_codigo_base                                  as lote8,
  fecha,
  batch_id,
  fuente,
  lote_codigo,
  productor,
  producto,
  clase,
  public.clase_letra(clase)                         as letra,
  public.clase_destino(grupo_destino, clase)        as destino,
  coalesce(nullif(btrim(tamano), ''), '—')          as tamano,
  max(duracion_min)::numeric                        as duracion_min,
  max(toneladas_hora)::numeric                      as toneladas_hora,
  sum(peso_kg)::numeric                             as kg,
  sum(piezas)::numeric                              as piezas,
  count(*)::integer                                 as n_filas
from public.clasificacion_lote
where lote_codigo_base is not null
group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
with no data;

create index if not exists clasificacion_lote_detalle_mv_lote8_idx on public.clasificacion_lote_detalle_mv (lote8);
create index if not exists clasificacion_lote_detalle_mv_fecha_idx on public.clasificacion_lote_detalle_mv (fecha);
grant select on public.clasificacion_lote_detalle_mv to authenticated, service_role;
revoke all on public.clasificacion_lote_detalle_mv from anon;

-- Filas POSICIONALES (contrato con src/hooks/useTipoDia.ts): 0 fecha,
-- 1 lote_codigo, 2 productor, 3 producto, 4 clase, 5 kg, 6 duracion_min,
-- 7 toneladas_hora.
create or replace function public.rentabilidad_filas_dias(desde date, hasta date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'refrescado_en', (select refrescado_en from public.clasificacion_lote_mix_meta where id),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_array(
        x.fecha, x.lote_codigo, x.productor, x.producto, x.clase, x.kg, x.duracion_min, x.toneladas_hora
      ) order by x.fecha, x.lote_codigo, x.producto, x.clase)
      from (
        select fecha, lote_codigo, productor, producto, clase,
               sum(kg) as kg, max(duracion_min) as duracion_min, max(toneladas_hora) as toneladas_hora
        from public.clasificacion_lote_detalle_mv
        where fecha between desde and hasta
        group by 1, 2, 3, 4, 5
      ) x
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.rentabilidad_filas_dias(date, date) to authenticated, service_role;

select public.refrescar_clasificacion_lote_mix();
