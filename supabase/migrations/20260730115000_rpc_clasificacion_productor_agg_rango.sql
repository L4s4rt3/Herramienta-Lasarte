-- RPC de clasificación agregada por productor para un rango de fechas.
--
-- CONTEXTO (recuperada al repo el 07-ago-2026): se aplicó a la base el
-- 30-jul-2026 desde el MCP y su SQL nunca llegó al repositorio. Se vuelca aquí
-- tal cual está en producción (verificado con pg_get_functiondef).
--
-- PARA QUÉ: /productores tardaba >70 s porque leía la vista
-- `lote_clasificacion_productor_agg` con SELECT paginado — 87.000 filas = 88
-- peticiones, y cada página con OFFSET re-ejecutaba el GROUP BY entero. Esta
-- función agrupa en servidor a la granularidad mínima real y devuelve un
-- ESCALAR jsonb: el max-rows de PostgREST recorta filas, no un escalar, así
-- que entra todo en UNA petición.
--
-- El consumidor (src/hooks/useProductores.ts) baja en cascada RPC → vista →
-- tabla cruda usando `esErrorTablaOColumnaInexistente`, que ya reconoce
-- "función inexistente" (PGRST202 / 42883): en un entorno sin esta migración
-- sigue funcionando, solo que lento.
--
-- SEGURIDAD: `security invoker` (por defecto) — respeta las RLS de
-- lote_clasificacion. Sin permiso para anon/public.

create or replace function public.lote_clasificacion_productor_agg_rango(p_desde date, p_hasta date)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from (
    select
      productor,
      grupo_destino,
      clase,
      tamano,
      sum(peso_kg) as peso_kg,
      sum(piezas) as piezas,
      sum(cartons) as cartons
    from public.lote_clasificacion
    where fecha >= p_desde and fecha <= p_hasta
    group by productor, grupo_destino, clase, tamano
  ) t;
$$;

revoke all on function public.lote_clasificacion_productor_agg_rango(date, date) from public, anon;
grant execute on function public.lote_clasificacion_productor_agg_rango(date, date) to authenticated, service_role;
