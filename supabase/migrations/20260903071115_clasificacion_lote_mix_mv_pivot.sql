-- El mix por lote, PIVOTADO por producto (03-09-2026).
--
-- La primera versión agregaba por (lote, producto, destino, clase): 110.248
-- filas, ~13 MB en un solo jsonb — demasiado para bajarlo al navegador y al
-- borde del statement timeout de 8 s. Pivotando los destinos y los grupos de
-- clase en columnas, la clave queda (lote, producto): 20.940 filas.
--
-- Lo que decide el TypeScript sigue decidiéndolo el TypeScript: el FORMATO de
-- Mercadona se deduce del nombre del producto en _shared/mdnaMix.ts. Aquí solo
-- se normaliza el texto para agrupar: destino sin acentos y en mayúsculas
-- ("EXPORTACIÓN" y "EXPORTACION" conviven en la base) y la letra que el
-- calibrador escribe delante de la clase ("(C) Cat1 A" → C). Esas dos
-- normalizaciones son las mismas que destinoNorm/letraClase de mdnaMix.ts;
-- si se tocan allí, se tocan aquí.

drop materialized view if exists public.clasificacion_lote_mix_mv;

create materialized view public.clasificacion_lote_mix_mv as
with f as (
  select
    lote_codigo_base as lote8,
    producto,
    peso_kg,
    fuente,
    btrim(upper(translate(coalesce(grupo_destino, ''), 'ÁÉÍÓÚÜáéíóúüÑñ', 'AEIOUUaeiouuNn'))) as destino,
    upper(substring(coalesce(clase, '') from '^\s*\(([A-Za-z])\)')) as letra
  from public.clasificacion_lote
  where lote_codigo_base is not null
)
select
  lote8,
  producto,
  sum(peso_kg)::numeric                                                              as kg_clasificado,
  coalesce(sum(peso_kg) filter (where destino = 'EXPORTACION'), 0)::numeric          as kg_exportacion,
  coalesce(sum(peso_kg) filter (where destino = 'NO EXPORTACION'), 0)::numeric       as kg_no_exportacion,
  coalesce(sum(peso_kg) filter (where destino = 'MUJERES'), 0)::numeric              as kg_mujeres,
  coalesce(sum(peso_kg) filter (where destino = 'NO COMERCIAL'), 0)::numeric         as kg_no_comercial,
  coalesce(sum(peso_kg) filter (where letra in ('A','B','C','D','E','F')), 0)::numeric as kg_clase_apta,
  coalesce(sum(peso_kg) filter (where letra = 'J'), 0)::numeric                      as kg_clase_podrido,
  coalesce(sum(peso_kg) filter (where letra = 'I'), 0)::numeric                      as kg_clase_industria,
  count(*)::integer                                                                  as n_filas,
  bool_or(fuente = 'docx')                                                           as con_docx
from f
group by 1, 2
with no data;

create index if not exists clasificacion_lote_mix_mv_lote8_idx on public.clasificacion_lote_mix_mv (lote8);
grant select on public.clasificacion_lote_mix_mv to authenticated, service_role;
revoke all on public.clasificacion_lote_mix_mv from anon;

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
      'lote8', lote8, 'producto', producto,
      'kg_clasificado', kg_clasificado, 'kg_exportacion', kg_exportacion,
      'kg_no_exportacion', kg_no_exportacion, 'kg_mujeres', kg_mujeres,
      'kg_no_comercial', kg_no_comercial, 'kg_clase_apta', kg_clase_apta,
      'kg_clase_podrido', kg_clase_podrido, 'kg_clase_industria', kg_clase_industria,
      'n_filas', n_filas, 'con_docx', con_docx
    )), '[]'::jsonb)
  )
  from public.clasificacion_lote_mix_mv;
$$;
grant execute on function public.clasificacion_mix_lotes() to authenticated, service_role;

select public.refrescar_clasificacion_lote_mix();
