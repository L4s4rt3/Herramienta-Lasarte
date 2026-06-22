-- Ventas por categoria comercial: primera categoria cargada = Categoria segunda.

CREATE TABLE IF NOT EXISTS public.ventas_categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ventas_categoria_productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES public.ventas_categorias(id) ON DELETE CASCADE,
  metodo TEXT NOT NULL,
  descripcion TEXT,
  lineas INTEGER NOT NULL DEFAULT 0,
  kilos NUMERIC NOT NULL DEFAULT 0,
  base_iva NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (categoria_id, metodo)
);

CREATE TABLE IF NOT EXISTS public.ventas_categoria_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES public.ventas_categorias(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  campana TEXT NOT NULL,
  mes TEXT NOT NULL,
  cliente_codigo TEXT NOT NULL,
  cliente_nombre TEXT NOT NULL,
  referencia TEXT,
  articulo TEXT NOT NULL,
  metodo_producto TEXT,
  kilos NUMERIC NOT NULL DEFAULT 0,
  pvp NUMERIC NOT NULL DEFAULT 0,
  base_iva NUMERIC NOT NULL DEFAULT 0,
  pm_venta NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ventas_categoria_clientes_ajustes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES public.ventas_categorias(id) ON DELETE CASCADE,
  cliente_codigo TEXT NOT NULL,
  cliente_nombre TEXT NOT NULL,
  comision_pct NUMERIC NOT NULL DEFAULT 0,
  comision_cent_kg NUMERIC NOT NULL DEFAULT 0,
  transporte_pct NUMERIC NOT NULL DEFAULT 0,
  transporte_cent_kg NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (categoria_id, cliente_codigo)
);

CREATE INDEX IF NOT EXISTS ventas_categoria_lineas_categoria_fecha_idx
  ON public.ventas_categoria_lineas (categoria_id, fecha);
CREATE INDEX IF NOT EXISTS ventas_categoria_lineas_categoria_mes_idx
  ON public.ventas_categoria_lineas (categoria_id, mes);
CREATE INDEX IF NOT EXISTS ventas_categoria_lineas_categoria_cliente_idx
  ON public.ventas_categoria_lineas (categoria_id, cliente_codigo);
CREATE INDEX IF NOT EXISTS ventas_categoria_lineas_categoria_metodo_idx
  ON public.ventas_categoria_lineas (categoria_id, metodo_producto);
CREATE INDEX IF NOT EXISTS ventas_categoria_lineas_categoria_articulo_idx
  ON public.ventas_categoria_lineas (categoria_id, articulo);

DROP TRIGGER IF EXISTS ventas_categorias_updated_at ON public.ventas_categorias;
CREATE TRIGGER ventas_categorias_updated_at
  BEFORE UPDATE ON public.ventas_categorias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS ventas_categoria_productos_updated_at ON public.ventas_categoria_productos;
CREATE TRIGGER ventas_categoria_productos_updated_at
  BEFORE UPDATE ON public.ventas_categoria_productos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS ventas_categoria_clientes_ajustes_updated_at ON public.ventas_categoria_clientes_ajustes;
CREATE TRIGGER ventas_categoria_clientes_ajustes_updated_at
  BEFORE UPDATE ON public.ventas_categoria_clientes_ajustes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ventas_categorias (nombre, descripcion, user_id)
VALUES (
  'Categoria segunda',
  'Analisis de ventas de categoria segunda importado desde cliente y producto 2021-2026.xlsx y productos.xlsx.',
  NULL
)
ON CONFLICT (nombre) DO NOTHING;

ALTER TABLE public.ventas_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_categoria_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_categoria_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_categoria_clientes_ajustes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ventas_categorias_select_authenticated"
  ON public.ventas_categorias FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "ventas_categorias_insert_own"
  ON public.ventas_categorias FOR INSERT
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ventas_categorias_update_own_or_admin"
  ON public.ventas_categorias FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ventas_categorias_delete_admin"
  ON public.ventas_categorias FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ventas_categoria_productos_select_authenticated"
  ON public.ventas_categoria_productos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "ventas_categoria_productos_insert_category_owner_or_admin"
  ON public.ventas_categoria_productos FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ventas_categorias c
      WHERE c.id = categoria_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "ventas_categoria_productos_update_category_owner_or_admin"
  ON public.ventas_categoria_productos FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.ventas_categorias c
      WHERE c.id = categoria_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "ventas_categoria_productos_delete_category_owner_or_admin"
  ON public.ventas_categoria_productos FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.ventas_categorias c
      WHERE c.id = categoria_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "ventas_categoria_lineas_select_authenticated"
  ON public.ventas_categoria_lineas FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "ventas_categoria_lineas_insert_category_owner_or_admin"
  ON public.ventas_categoria_lineas FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ventas_categorias c
      WHERE c.id = categoria_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "ventas_categoria_lineas_update_category_owner_or_admin"
  ON public.ventas_categoria_lineas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.ventas_categorias c
      WHERE c.id = categoria_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "ventas_categoria_lineas_delete_category_owner_or_admin"
  ON public.ventas_categoria_lineas FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.ventas_categorias c
      WHERE c.id = categoria_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "ventas_categoria_ajustes_select_authenticated"
  ON public.ventas_categoria_clientes_ajustes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "ventas_categoria_ajustes_insert_category_owner_or_admin"
  ON public.ventas_categoria_clientes_ajustes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ventas_categorias c
      WHERE c.id = categoria_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "ventas_categoria_ajustes_update_category_owner_or_admin"
  ON public.ventas_categoria_clientes_ajustes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.ventas_categorias c
      WHERE c.id = categoria_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "ventas_categoria_ajustes_delete_category_owner_or_admin"
  ON public.ventas_categoria_clientes_ajustes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.ventas_categorias c
      WHERE c.id = categoria_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE OR REPLACE VIEW public.ventas_categoria_lineas_con_ajustes
WITH (security_invoker = true) AS
SELECT
  l.*,
  COALESCE(a.comision_pct, 0) AS comision_pct,
  COALESCE(a.comision_cent_kg, 0) AS comision_cent_kg,
  COALESCE(a.transporte_pct, 0) AS transporte_pct,
  COALESCE(a.transporte_cent_kg, 0) AS transporte_cent_kg,
  GREATEST(
    0,
    l.pm_venta
      - (l.pm_venta * COALESCE(a.comision_pct, 0) / 100)
      - (COALESCE(a.comision_cent_kg, 0) / 100)
      - (l.pm_venta * COALESCE(a.transporte_pct, 0) / 100)
      - (COALESCE(a.transporte_cent_kg, 0) / 100)
  ) AS pm_venta_real
FROM public.ventas_categoria_lineas l
LEFT JOIN public.ventas_categoria_clientes_ajustes a
  ON a.categoria_id = l.categoria_id
 AND a.cliente_codigo = l.cliente_codigo;

CREATE OR REPLACE VIEW public.ventas_categoria_resumen
WITH (security_invoker = true) AS
SELECT
  categoria_id,
  COUNT(*)::INTEGER AS lineas,
  COALESCE(SUM(kilos), 0) AS kilos,
  COALESCE(SUM(base_iva), 0) AS base_iva,
  CASE WHEN SUM(kilos) > 0 THEN SUM(base_iva) / SUM(kilos) ELSE 0 END AS pm_bruto,
  CASE WHEN SUM(kilos) > 0 THEN SUM(kilos * pm_venta_real) / SUM(kilos) ELSE 0 END AS pm_real,
  COUNT(DISTINCT cliente_codigo)::INTEGER AS clientes,
  COUNT(DISTINCT COALESCE(metodo_producto, 'Sin clasificar'))::INTEGER AS productos,
  COUNT(DISTINCT COALESCE(referencia, '') || '|' || articulo)::INTEGER AS articulos,
  MIN(fecha) AS fecha_min,
  MAX(fecha) AS fecha_max
FROM public.ventas_categoria_lineas_con_ajustes
GROUP BY categoria_id;

CREATE OR REPLACE VIEW public.ventas_categoria_mensual_cliente
WITH (security_invoker = true) AS
SELECT
  categoria_id,
  mes,
  cliente_codigo,
  MAX(cliente_nombre) AS cliente_nombre,
  COUNT(*)::INTEGER AS lineas,
  SUM(kilos) AS kilos,
  SUM(base_iva) AS base_iva,
  CASE WHEN SUM(kilos) > 0 THEN SUM(base_iva) / SUM(kilos) ELSE 0 END AS pm_bruto,
  CASE WHEN SUM(kilos) > 0 THEN SUM(kilos * pm_venta_real) / SUM(kilos) ELSE 0 END AS pm_real
FROM public.ventas_categoria_lineas_con_ajustes
GROUP BY categoria_id, mes, cliente_codigo;

CREATE OR REPLACE VIEW public.ventas_categoria_mensual_producto
WITH (security_invoker = true) AS
SELECT
  categoria_id,
  mes,
  COALESCE(metodo_producto, 'Sin clasificar') AS metodo_producto,
  COUNT(*)::INTEGER AS lineas,
  SUM(kilos) AS kilos,
  SUM(base_iva) AS base_iva,
  CASE WHEN SUM(kilos) > 0 THEN SUM(base_iva) / SUM(kilos) ELSE 0 END AS pm_bruto,
  CASE WHEN SUM(kilos) > 0 THEN SUM(kilos * pm_venta_real) / SUM(kilos) ELSE 0 END AS pm_real
FROM public.ventas_categoria_lineas_con_ajustes
GROUP BY categoria_id, mes, COALESCE(metodo_producto, 'Sin clasificar');

CREATE OR REPLACE VIEW public.ventas_categoria_ranking_clientes
WITH (security_invoker = true) AS
SELECT
  categoria_id,
  cliente_codigo,
  MAX(cliente_nombre) AS cliente_nombre,
  COUNT(*)::INTEGER AS lineas,
  SUM(kilos) AS kilos,
  SUM(base_iva) AS base_iva,
  CASE WHEN SUM(kilos) > 0 THEN SUM(base_iva) / SUM(kilos) ELSE 0 END AS pm_bruto,
  CASE WHEN SUM(kilos) > 0 THEN SUM(kilos * pm_venta_real) / SUM(kilos) ELSE 0 END AS pm_real,
  MAX(pm_venta_real) AS precio_real_max,
  MAX(pm_venta) AS precio_bruto_max
FROM public.ventas_categoria_lineas_con_ajustes
GROUP BY categoria_id, cliente_codigo;

CREATE OR REPLACE VIEW public.ventas_categoria_resumen_articulo
WITH (security_invoker = true) AS
SELECT
  categoria_id,
  COALESCE(referencia, '') AS referencia,
  articulo,
  COUNT(*)::INTEGER AS lineas,
  SUM(kilos) AS kilos,
  SUM(base_iva) AS base_iva,
  CASE WHEN SUM(kilos) > 0 THEN SUM(base_iva) / SUM(kilos) ELSE 0 END AS pm_bruto,
  CASE WHEN SUM(kilos) > 0 THEN SUM(kilos * pm_venta_real) / SUM(kilos) ELSE 0 END AS pm_real
FROM public.ventas_categoria_lineas_con_ajustes
GROUP BY categoria_id, COALESCE(referencia, ''), articulo;

CREATE OR REPLACE VIEW public.ventas_categoria_validacion_catalogo
WITH (security_invoker = true) AS
WITH lineas_por_producto AS (
  SELECT
    categoria_id,
    COALESCE(metodo_producto, 'Sin clasificar') AS metodo,
    COUNT(*)::INTEGER AS lineas_lineas,
    SUM(kilos) AS kilos_lineas,
    SUM(base_iva) AS base_iva_lineas
  FROM public.ventas_categoria_lineas
  GROUP BY categoria_id, COALESCE(metodo_producto, 'Sin clasificar')
)
SELECT
  COALESCE(p.categoria_id, l.categoria_id) AS categoria_id,
  COALESCE(p.metodo, l.metodo) AS metodo,
  p.descripcion,
  COALESCE(p.lineas, 0) AS lineas_catalogo,
  COALESCE(l.lineas_lineas, 0) AS lineas_detectadas,
  COALESCE(p.kilos, 0) AS kilos_catalogo,
  COALESCE(l.kilos_lineas, 0) AS kilos_lineas,
  COALESCE(l.kilos_lineas, 0) - COALESCE(p.kilos, 0) AS diferencia_kilos,
  COALESCE(p.base_iva, 0) AS base_iva_catalogo,
  COALESCE(l.base_iva_lineas, 0) AS base_iva_lineas,
  COALESCE(l.base_iva_lineas, 0) - COALESCE(p.base_iva, 0) AS diferencia_base_iva
FROM public.ventas_categoria_productos p
FULL JOIN lineas_por_producto l
  ON l.categoria_id = p.categoria_id
 AND l.metodo = p.metodo;
