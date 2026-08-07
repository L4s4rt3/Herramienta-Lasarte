-- Vistas mensuales del dashboard.
--
-- CONTEXTO (recuperadas al repo el 07-ago-2026): existían en la base sin
-- ninguna migración que las creara. Se vuelcan tal cual están en producción
-- (verificado con pg_get_viewdef). Hoy NINGÚN código de la app las consulta:
-- solo aparecen en src/integrations/supabase/types.ts, que se genera desde el
-- esquema. Se documentan igualmente para que la base sea reproducible; si se
-- confirma que sobran, bórrense con su propia migración, no en silencio.
--
-- OJO, PERMISOS: en producción ambas están concedidas también a `anon`, es
-- decir, legibles con la clave pública sin iniciar sesión. Se reproduce el
-- estado real para que esto no sea una migración que miente, pero conviene
-- revisarlo: `dashboard_produccion_mensual` expone kilos, cajas, palets,
-- clientes y productores por mes.

create or replace view public.dashboard_produccion_mensual as
 WITH months AS (
         SELECT DISTINCT date_trunc('month'::text, partes_diarios.date::timestamp with time zone)::date AS month_start
           FROM partes_diarios
          WHERE partes_diarios.date IS NOT NULL
          ORDER BY (date_trunc('month'::text, partes_diarios.date::timestamp with time zone)::date) DESC
         LIMIT 6
        ), parts_month AS (
         SELECT date_trunc('month'::text, partes_diarios.date::timestamp with time zone)::date AS month_start,
            count(*)::integer AS dias,
            max(partes_diarios.updated_at) AS refreshed_at
           FROM partes_diarios
          WHERE partes_diarios.date IS NOT NULL
          GROUP BY (date_trunc('month'::text, partes_diarios.date::timestamp with time zone)::date)
        ), product_month AS (
         SELECT date_trunc('month'::text, part.date::timestamp with time zone)::date AS month_start,
            count(product.*)::integer AS lineas_producto,
            count(DISTINCT NULLIF(product.producto, ''::text))::integer AS productos,
            count(DISTINCT NULLIF(product.grupo_destino, ''::text))::integer AS destinos_producto,
            COALESCE(sum(product.kg), 0::numeric)::numeric(14,2) AS kilos_producto,
            COALESCE(sum(product.n_cajas), 0::numeric)::numeric(14,2) AS cajas
           FROM partes_diarios part
             JOIN producto_dia product ON product.part_id = part.id
          WHERE part.date IS NOT NULL
          GROUP BY (date_trunc('month'::text, part.date::timestamp with time zone)::date)
        ), palets_month AS (
         SELECT date_trunc('month'::text, part.date::timestamp with time zone)::date AS month_start,
            COALESCE(NULLIF(count(DISTINCT NULLIF(palet.palet_id, ''::text)), 0), count(palet.*))::integer AS palets,
            count(DISTINCT NULLIF(palet.cliente, ''::text))::integer AS clientes,
            count(DISTINCT NULLIF(palet.destino, ''::text))::integer AS destinos_palets,
            COALESCE(sum(palet.kg_neto), 0::numeric)::numeric(14,2) AS kilos_palets
           FROM partes_diarios part
             JOIN palets_dia palet ON palet.part_id = part.id
          WHERE part.date IS NOT NULL
          GROUP BY (date_trunc('month'::text, part.date::timestamp with time zone)::date)
        ), lotes_month AS (
         SELECT date_trunc('month'::text, part.date::timestamp with time zone)::date AS month_start,
            count(DISTINCT NULLIF(lote.lote_codigo, ''::text))::integer AS lotes,
            count(DISTINCT NULLIF(lote.productor, ''::text))::integer AS productores,
            COALESCE(sum(lote.kg_peso_total), 0::numeric)::numeric(14,2) AS kilos_lotes
           FROM partes_diarios part
             JOIN lotes_dia lote ON lote.part_id = part.id
          WHERE part.date IS NOT NULL
          GROUP BY (date_trunc('month'::text, part.date::timestamp with time zone)::date)
        )
 SELECT months.month_start,
    EXTRACT(year FROM months.month_start)::integer AS ano,
    EXTRACT(month FROM months.month_start)::integer AS mes,
    COALESCE(product_month.lineas_producto, 0) AS lineas,
    COALESCE(palets_month.clientes, 0) AS clientes,
    COALESCE(product_month.productos, 0) AS productos,
    COALESCE(product_month.kilos_producto, palets_month.kilos_palets, 0::numeric)::numeric(14,2) AS kilos,
    0::numeric(14,2) AS facturacion,
    0::numeric(12,4) AS precio_medio,
    COALESCE(parts_month.refreshed_at, now()) AS refreshed_at,
    COALESCE(parts_month.dias, 0) AS dias,
    COALESCE(product_month.cajas, 0::numeric)::numeric(14,2) AS cajas,
    COALESCE(palets_month.palets, 0) AS palets,
    COALESCE(lotes_month.lotes, 0) AS lotes,
    COALESCE(lotes_month.productores, 0) AS productores,
    GREATEST(COALESCE(product_month.destinos_producto, 0), COALESCE(palets_month.destinos_palets, 0)) AS destinos
   FROM months
     LEFT JOIN parts_month USING (month_start)
     LEFT JOIN product_month USING (month_start)
     LEFT JOIN palets_month USING (month_start)
     LEFT JOIN lotes_month USING (month_start)
  ORDER BY months.month_start DESC;

-- Vista PLACEHOLDER: devuelve siempre 0 filas (WHERE false). Existe solo para
-- fijar la forma de la respuesta que espera el panel de precios mientras no
-- haya datos de facturación. No es un error de volcado: así está en la base.
create or replace view public.precios_dashboard_mensual as
 SELECT NULL::date AS month_start,
    NULL::integer AS ano,
    NULL::integer AS mes,
    0 AS lineas,
    0 AS clientes,
    0 AS productos,
    0::numeric(14,2) AS kilos,
    0::numeric(14,2) AS facturacion,
    0::numeric(12,4) AS precio_medio,
    NULL::timestamp with time zone AS refreshed_at
  WHERE false;

grant select on public.dashboard_produccion_mensual to anon, authenticated, service_role;
grant select on public.precios_dashboard_mensual to anon, authenticated, service_role;
