-- Reconstruida el 02-09-2026 desde la base (pg_get_functiondef): esta versión
-- se aplicó por el MCP el 30-07 y nunca llegó al repo. Es la definición VIVA
-- en producción de `lote_clasificacion_detalle_por_partes`.
--
-- Sustituye a la de 20260730063853 (misma firma) devolviendo cada fila como
-- ARRAY posicional en vez de objeto con claves: el dossier por productor
-- pedía 132 partes de golpe y el JSON con nombres de campo repetidos por fila
-- pesaba demasiado. El orden de las posiciones es el contrato con
-- src/hooks (ver usos de `lote_clasificacion_detalle_por_partes`):
--   0 lote_codigo, 1 lote_codigo_base, 2 productor, 3 producto, 4 calidad,
--   5 clase, 6 grupo_destino, 7 tamano, 8 piezas, 9 pct_piezas, 10 peso_kg,
--   11 pct_peso, 12 cartons, 13 pct_cartons, 14 part_id

create or replace function public.lote_clasificacion_detalle_por_partes(p_part_ids uuid[])
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_array(
        lote_codigo, lote_codigo_base, productor, producto, calidad, clase,
        grupo_destino, tamano, piezas, pct_piezas, peso_kg, pct_peso,
        cartons, pct_cartons, part_id
      )
      order by id
    ),
    '[]'::jsonb
  )
  from public.clasificacion_lote
  where part_id = any(p_part_ids);
$function$;
