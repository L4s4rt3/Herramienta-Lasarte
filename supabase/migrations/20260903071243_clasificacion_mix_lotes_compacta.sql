-- La RPC del mix devuelve filas POSICIONALES (03-09-2026).
--
-- Con objetos con nombre de campo, las 20.940 filas del pivot pesaban 5,9 MB
-- de jsonb; como array posicional bajan a 1,9 MB. El orden de las posiciones
-- es el contrato con src/hooks/useCampanaMermaMdna.ts (aFilaPivot):
--   0 lote8, 1 producto, 2 kg_clasificado, 3 kg_exportacion, 4 kg_no_exportacion,
--   5 kg_mujeres, 6 kg_no_comercial, 7 kg_clase_apta, 8 kg_clase_podrido,
--   9 kg_clase_industria, 10 n_filas, 11 con_docx
-- (mismo patrón que lote_clasificacion_detalle_por_partes, 30-07-2026).

create or replace function public.clasificacion_mix_lotes()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'refrescado_en', (select refrescado_en from public.clasificacion_lote_mix_meta where id),
    'filas', coalesce(jsonb_agg(jsonb_build_array(
      lote8, producto, kg_clasificado, kg_exportacion, kg_no_exportacion, kg_mujeres,
      kg_no_comercial, kg_clase_apta, kg_clase_podrido, kg_clase_industria, n_filas, con_docx
    ) order by lote8, producto), '[]'::jsonb)
  )
  from public.clasificacion_lote_mix_mv;
$$;
grant execute on function public.clasificacion_mix_lotes() to authenticated, service_role;
