-- RPC del detalle de lote_clasificacion por conjunto de partes.
--
-- CONTEXTO (recuperada al repo el 06-ago-2026): esta función se aplicó a la
-- base el 30-jul-2026 desde el MCP y su SQL nunca llegó al repositorio, así
-- que el esquema no era reproducible desde cero. Se vuelca aquí tal cual está
-- en producción (verificado con pg_get_functiondef). Es idempotente.
--
-- PARA QUÉ: `lote_clasificacion` va por 256.000 filas y PostgREST recorta cada
-- respuesta a 1.000, así que traer el detalle de un rango largo con SELECT
-- paginado son cientos de peticiones ENCADENADAS (Análisis diario se quedaba
-- cargando minutos con "Todo el histórico"). El max-rows recorta FILAS, no un
-- escalar: devolviendo un único `jsonb` cabe todo en una llamada por chunk
-- (medido 06-ago-2026: 60 partes ≈ 66.000 filas en 945 ms).
--
-- FORMATO COMPACTO: cada fila es un ARRAY POSICIONAL, no un objeto — las
-- claves repetidas eran ~la mitad de los bytes. El orden de los campos es
-- contrato con src/lib/clasificacionDetalleCompacta.ts
-- (CLASIF_DETALLE_COLUMNAS), que tiene un test para que no se desalineen: si
-- alguien reordena aquí y no allí, los datos se mezclan EN SILENCIO.
--
-- SEGURIDAD: `security invoker` (por defecto) — respeta las RLS de
-- lote_clasificacion, igual que el SELECT al que sustituye. Sin permiso para
-- anon/public.

create or replace function public.lote_clasificacion_detalle_por_partes(p_part_ids uuid[])
returns jsonb
language sql
stable
set search_path to ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_array(
        lote_codigo,
        lote_codigo_base,
        productor,
        producto,
        calidad,
        clase,
        grupo_destino,
        tamano,
        piezas,
        pct_piezas,
        peso_kg,
        pct_peso,
        cartons,
        pct_cartons,
        part_id
      )
      order by id
    ),
    '[]'::jsonb
  )
  from public.lote_clasificacion
  where part_id = any(p_part_ids);
$$;

revoke all on function public.lote_clasificacion_detalle_por_partes(uuid[]) from public, anon;
grant execute on function public.lote_clasificacion_detalle_por_partes(uuid[]) to authenticated, service_role;
