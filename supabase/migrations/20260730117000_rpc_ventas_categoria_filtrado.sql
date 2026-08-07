-- RPCs con filtros del panel de Ventas por categoría (Cat. primera/segunda).
--
-- CONTEXTO (recuperadas al repo el 07-ago-2026): las seis existían en la base
-- sin ninguna migración que las creara. Se vuelcan tal cual están en
-- producción (verificado con pg_get_functiondef).
--
-- QUÉ HACEN: agregan `ventas_categoria_lineas_con_ajustes` (la vista que ya
-- vive en 20260717120000_vistas_agregadas_clasificacion.sql) aplicando los
-- cuatro filtros del panel — campaña, mes, cliente y método de producto — en
-- el SERVIDOR. La alternativa era bajarse las líneas y agregar en el cliente,
-- que es justo lo que revienta con el volumen de la campaña.
--
-- El patrón de los cuatro filtros es siempre `p_x IS NULL OR col = p_x`: un
-- NULL significa "sin filtrar", no "columna nula". Consumidas desde
-- src/hooks/useVentasCategoria.ts.
--
-- SEGURIDAD: todas `security invoker` (por defecto) — respetan las RLS de las
-- tablas de ventas. Sin permiso para anon/public.

create or replace function public.ventas_categoria_resumen_filtrado(p_categoria_id uuid, p_campana text default null, p_mes text default null, p_cliente_codigo text default null, p_metodo text default null)
returns table(kilos numeric, base_iva numeric, pm_bruto numeric, pm_real numeric, clientes integer, productos integer, articulos integer)
language sql
stable
set search_path to ''
as $$
  SELECT
    COALESCE(SUM(l.kilos), 0),
    COALESCE(SUM(l.base_iva), 0),
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.base_iva) / SUM(l.kilos) ELSE 0 END,
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.kilos * l.pm_venta_real) / SUM(l.kilos) ELSE 0 END,
    COUNT(DISTINCT l.cliente_codigo)::INTEGER,
    COUNT(DISTINCT COALESCE(l.metodo_producto, 'Sin clasificar'))::INTEGER,
    COUNT(DISTINCT COALESCE(l.referencia, '') || '|' || l.articulo)::INTEGER
  FROM public.ventas_categoria_lineas_con_ajustes l
  WHERE l.categoria_id = p_categoria_id
    AND (p_campana IS NULL OR l.campana = p_campana)
    AND (p_mes IS NULL OR l.mes = p_mes)
    AND (p_cliente_codigo IS NULL OR l.cliente_codigo = p_cliente_codigo)
    AND (p_metodo IS NULL OR l.metodo_producto = p_metodo);
$$;

create or replace function public.ventas_categoria_ranking_clientes_filtrado(p_categoria_id uuid, p_campana text default null, p_mes text default null, p_cliente_codigo text default null, p_metodo text default null)
returns table(cliente_codigo text, cliente_nombre text, lineas integer, kilos numeric, base_iva numeric, pm_bruto numeric, pm_real numeric, precio_real_max numeric, precio_bruto_max numeric)
language sql
stable
set search_path to ''
as $$
  SELECT
    l.cliente_codigo,
    MAX(l.cliente_nombre),
    COUNT(*)::INTEGER,
    SUM(l.kilos),
    SUM(l.base_iva),
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.base_iva) / SUM(l.kilos) ELSE 0 END,
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.kilos * l.pm_venta_real) / SUM(l.kilos) ELSE 0 END,
    MAX(l.pm_venta_real),
    MAX(l.pm_venta)
  FROM public.ventas_categoria_lineas_con_ajustes l
  WHERE l.categoria_id = p_categoria_id
    AND (p_campana IS NULL OR l.campana = p_campana)
    AND (p_mes IS NULL OR l.mes = p_mes)
    AND (p_cliente_codigo IS NULL OR l.cliente_codigo = p_cliente_codigo)
    AND (p_metodo IS NULL OR l.metodo_producto = p_metodo)
  GROUP BY l.cliente_codigo
  ORDER BY SUM(l.kilos) DESC;
$$;

create or replace function public.ventas_categoria_articulos_filtrado(p_categoria_id uuid, p_campana text default null, p_mes text default null, p_cliente_codigo text default null, p_metodo text default null)
returns table(referencia text, articulo text, lineas integer, kilos numeric, base_iva numeric, pm_bruto numeric, pm_real numeric)
language sql
stable
set search_path to ''
as $$
  SELECT
    COALESCE(l.referencia, ''),
    l.articulo,
    COUNT(*)::INTEGER,
    SUM(l.kilos),
    SUM(l.base_iva),
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.base_iva) / SUM(l.kilos) ELSE 0 END,
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.kilos * l.pm_venta_real) / SUM(l.kilos) ELSE 0 END
  FROM public.ventas_categoria_lineas_con_ajustes l
  WHERE l.categoria_id = p_categoria_id
    AND (p_campana IS NULL OR l.campana = p_campana)
    AND (p_mes IS NULL OR l.mes = p_mes)
    AND (p_cliente_codigo IS NULL OR l.cliente_codigo = p_cliente_codigo)
    AND (p_metodo IS NULL OR l.metodo_producto = p_metodo)
  GROUP BY COALESCE(l.referencia, ''), l.articulo
  ORDER BY SUM(l.kilos) DESC;
$$;

create or replace function public.ventas_categoria_mensual_cliente_filtrado(p_categoria_id uuid, p_campana text default null, p_mes text default null, p_cliente_codigo text default null, p_metodo text default null)
returns table(mes text, cliente_codigo text, cliente_nombre text, lineas integer, kilos numeric, base_iva numeric, pm_bruto numeric, pm_real numeric)
language sql
stable
set search_path to ''
as $$
  SELECT
    l.mes,
    l.cliente_codigo,
    MAX(l.cliente_nombre),
    COUNT(*)::INTEGER,
    SUM(l.kilos),
    SUM(l.base_iva),
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.base_iva) / SUM(l.kilos) ELSE 0 END,
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.kilos * l.pm_venta_real) / SUM(l.kilos) ELSE 0 END
  FROM public.ventas_categoria_lineas_con_ajustes l
  WHERE l.categoria_id = p_categoria_id
    AND (p_campana IS NULL OR l.campana = p_campana)
    AND (p_mes IS NULL OR l.mes = p_mes)
    AND (p_cliente_codigo IS NULL OR l.cliente_codigo = p_cliente_codigo)
    AND (p_metodo IS NULL OR l.metodo_producto = p_metodo)
  GROUP BY l.mes, l.cliente_codigo
  ORDER BY l.mes ASC;
$$;

create or replace function public.ventas_categoria_mensual_producto_filtrado(p_categoria_id uuid, p_campana text default null, p_mes text default null, p_cliente_codigo text default null, p_metodo text default null)
returns table(mes text, metodo_producto text, lineas integer, kilos numeric, base_iva numeric, pm_bruto numeric, pm_real numeric)
language sql
stable
set search_path to ''
as $$
  SELECT
    l.mes,
    COALESCE(l.metodo_producto, 'Sin clasificar'),
    COUNT(*)::INTEGER,
    SUM(l.kilos),
    SUM(l.base_iva),
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.base_iva) / SUM(l.kilos) ELSE 0 END,
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.kilos * l.pm_venta_real) / SUM(l.kilos) ELSE 0 END
  FROM public.ventas_categoria_lineas_con_ajustes l
  WHERE l.categoria_id = p_categoria_id
    AND (p_campana IS NULL OR l.campana = p_campana)
    AND (p_mes IS NULL OR l.mes = p_mes)
    AND (p_cliente_codigo IS NULL OR l.cliente_codigo = p_cliente_codigo)
    AND (p_metodo IS NULL OR l.metodo_producto = p_metodo)
  GROUP BY l.mes, COALESCE(l.metodo_producto, 'Sin clasificar')
  ORDER BY l.mes ASC;
$$;

create or replace function public.ventas_categoria_mensual_articulo_filtrado(p_categoria_id uuid, p_campana text default null, p_mes text default null, p_cliente_codigo text default null, p_metodo text default null)
returns table(mes text, referencia text, articulo text, lineas integer, kilos numeric, base_iva numeric, pm_bruto numeric)
language sql
stable
set search_path to ''
as $$
  SELECT
    l.mes,
    COALESCE(l.referencia, ''),
    l.articulo,
    COUNT(*)::INTEGER,
    SUM(l.kilos),
    SUM(l.base_iva),
    CASE WHEN SUM(l.kilos) > 0 THEN SUM(l.base_iva) / SUM(l.kilos) ELSE 0 END
  FROM public.ventas_categoria_lineas_con_ajustes l
  WHERE l.categoria_id = p_categoria_id
    AND (p_campana IS NULL OR l.campana = p_campana)
    AND (p_mes IS NULL OR l.mes = p_mes)
    AND (p_cliente_codigo IS NULL OR l.cliente_codigo = p_cliente_codigo)
    AND (p_metodo IS NULL OR l.metodo_producto = p_metodo)
  GROUP BY l.mes, COALESCE(l.referencia, ''), l.articulo
  ORDER BY l.mes ASC;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ventas_categoria_resumen_filtrado',
    'ventas_categoria_ranking_clientes_filtrado',
    'ventas_categoria_articulos_filtrado',
    'ventas_categoria_mensual_cliente_filtrado',
    'ventas_categoria_mensual_producto_filtrado',
    'ventas_categoria_mensual_articulo_filtrado'
  ] loop
    execute format('revoke all on function public.%I(uuid, text, text, text, text) from public, anon', f);
    execute format('grant execute on function public.%I(uuid, text, text, text, text) to authenticated, service_role', f);
  end loop;
end $$;
