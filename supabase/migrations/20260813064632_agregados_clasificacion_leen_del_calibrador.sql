-- Los cuatro agregados de clasificación pasan a leer `clasificacion_lote`.
--
-- POR QUÉ IMPORTA. Estos son los caminos RÁPIDOS: los hooks los prueban primero
-- y solo bajan al SELECT paginado si fallan. Si se quedaban leyendo
-- `lote_clasificacion`, cambiar los hooks no habría servido de nada — la app
-- habría seguido enseñando los kilos del Word por la puerta de atrás.
--
-- Lo único que cambia es de dónde leen. Firma, columnas y forma del resultado
-- se mantienen intactas para no tocar a ningún llamador.

-- Reparto por productor: ahora con el nombre canónico y todas las pasadas.
CREATE OR REPLACE VIEW public.lote_clasificacion_productor_agg AS
 SELECT productor,
    grupo_destino,
    clase,
    tamano,
    fecha,
    sum(peso_kg) AS peso_kg,
    sum(piezas) AS piezas,
    sum(cartons) AS cartons,
    count(*) AS n_filas
   FROM public.clasificacion_lote
  GROUP BY productor, grupo_destino, clase, tamano, fecha;

-- Podrido por lote: la merma se calcula sobre los kilos reales de la máquina.
CREATE OR REPLACE VIEW public.lote_clasificacion_podrido_agg AS
 SELECT substring(lote_codigo, '\d{8}'::text) AS lote8,
    sum(peso_kg) AS kg_total,
    sum(peso_kg) FILTER (WHERE clase ILIKE '%podrido%') AS kg_podrido,
    count(*) AS n_filas
   FROM public.clasificacion_lote
  WHERE substring(lote_codigo, '\d{8}'::text) IS NOT NULL
  GROUP BY substring(lote_codigo, '\d{8}'::text);

-- Detalle por partes (Análisis diario).
CREATE OR REPLACE FUNCTION public.lote_clasificacion_detalle_por_partes(p_part_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
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

-- Agregado por productor en un rango (Productores).
CREATE OR REPLACE FUNCTION public.lote_clasificacion_productor_agg_rango(p_desde date, p_hasta date)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
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
    from public.clasificacion_lote
    where fecha >= p_desde and fecha <= p_hasta
    group by productor, grupo_destino, clase, tamano
  ) t;
$function$;
