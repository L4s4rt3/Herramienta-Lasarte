-- Control de acceso por correo para la seccion Comercial > Categoria segunda.

CREATE TABLE IF NOT EXISTS public.ventas_categoria_autorizados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  nombre TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS ventas_categoria_autorizados_updated_at ON public.ventas_categoria_autorizados;
CREATE TRIGGER ventas_categoria_autorizados_updated_at
  BEFORE UPDATE ON public.ventas_categoria_autorizados
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ventas_categoria_autorizados ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_ventas_categoria()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.ventas_categoria_autorizados a
      WHERE a.activo = true
        AND lower(trim(a.email)) = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
    );
$$;

DROP POLICY IF EXISTS "ventas_categoria_autorizados_select_admin_or_self" ON public.ventas_categoria_autorizados;
DROP POLICY IF EXISTS "ventas_categoria_autorizados_insert_admin" ON public.ventas_categoria_autorizados;
DROP POLICY IF EXISTS "ventas_categoria_autorizados_update_admin" ON public.ventas_categoria_autorizados;
DROP POLICY IF EXISTS "ventas_categoria_autorizados_delete_admin" ON public.ventas_categoria_autorizados;

CREATE POLICY "ventas_categoria_autorizados_select_admin_or_self"
  ON public.ventas_categoria_autorizados FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR lower(trim(email)) = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
  );

CREATE POLICY "ventas_categoria_autorizados_insert_admin"
  ON public.ventas_categoria_autorizados FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ventas_categoria_autorizados_update_admin"
  ON public.ventas_categoria_autorizados FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ventas_categoria_autorizados_delete_admin"
  ON public.ventas_categoria_autorizados FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "ventas_categorias_select_authenticated" ON public.ventas_categorias;
DROP POLICY IF EXISTS "ventas_categorias_insert_own" ON public.ventas_categorias;
DROP POLICY IF EXISTS "ventas_categorias_update_own_or_admin" ON public.ventas_categorias;
DROP POLICY IF EXISTS "ventas_categorias_delete_admin" ON public.ventas_categorias;

CREATE POLICY "ventas_categorias_select_authorized"
  ON public.ventas_categorias FOR SELECT
  USING (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categorias_insert_authorized"
  ON public.ventas_categorias FOR INSERT
  WITH CHECK (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categorias_update_authorized"
  ON public.ventas_categorias FOR UPDATE
  USING (public.can_access_ventas_categoria())
  WITH CHECK (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categorias_delete_admin"
  ON public.ventas_categorias FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "ventas_categoria_productos_select_authenticated" ON public.ventas_categoria_productos;
DROP POLICY IF EXISTS "ventas_categoria_productos_insert_category_owner_or_admin" ON public.ventas_categoria_productos;
DROP POLICY IF EXISTS "ventas_categoria_productos_update_category_owner_or_admin" ON public.ventas_categoria_productos;
DROP POLICY IF EXISTS "ventas_categoria_productos_delete_category_owner_or_admin" ON public.ventas_categoria_productos;

CREATE POLICY "ventas_categoria_productos_select_authorized"
  ON public.ventas_categoria_productos FOR SELECT
  USING (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categoria_productos_insert_authorized"
  ON public.ventas_categoria_productos FOR INSERT
  WITH CHECK (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categoria_productos_update_authorized"
  ON public.ventas_categoria_productos FOR UPDATE
  USING (public.can_access_ventas_categoria())
  WITH CHECK (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categoria_productos_delete_authorized"
  ON public.ventas_categoria_productos FOR DELETE
  USING (public.can_access_ventas_categoria());

DROP POLICY IF EXISTS "ventas_categoria_lineas_select_authenticated" ON public.ventas_categoria_lineas;
DROP POLICY IF EXISTS "ventas_categoria_lineas_insert_category_owner_or_admin" ON public.ventas_categoria_lineas;
DROP POLICY IF EXISTS "ventas_categoria_lineas_update_category_owner_or_admin" ON public.ventas_categoria_lineas;
DROP POLICY IF EXISTS "ventas_categoria_lineas_delete_category_owner_or_admin" ON public.ventas_categoria_lineas;

CREATE POLICY "ventas_categoria_lineas_select_authorized"
  ON public.ventas_categoria_lineas FOR SELECT
  USING (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categoria_lineas_insert_authorized"
  ON public.ventas_categoria_lineas FOR INSERT
  WITH CHECK (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categoria_lineas_update_authorized"
  ON public.ventas_categoria_lineas FOR UPDATE
  USING (public.can_access_ventas_categoria())
  WITH CHECK (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categoria_lineas_delete_authorized"
  ON public.ventas_categoria_lineas FOR DELETE
  USING (public.can_access_ventas_categoria());

DROP POLICY IF EXISTS "ventas_categoria_ajustes_select_authenticated" ON public.ventas_categoria_clientes_ajustes;
DROP POLICY IF EXISTS "ventas_categoria_ajustes_insert_category_owner_or_admin" ON public.ventas_categoria_clientes_ajustes;
DROP POLICY IF EXISTS "ventas_categoria_ajustes_update_category_owner_or_admin" ON public.ventas_categoria_clientes_ajustes;
DROP POLICY IF EXISTS "ventas_categoria_ajustes_delete_category_owner_or_admin" ON public.ventas_categoria_clientes_ajustes;

CREATE POLICY "ventas_categoria_ajustes_select_authorized"
  ON public.ventas_categoria_clientes_ajustes FOR SELECT
  USING (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categoria_ajustes_insert_authorized"
  ON public.ventas_categoria_clientes_ajustes FOR INSERT
  WITH CHECK (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categoria_ajustes_update_authorized"
  ON public.ventas_categoria_clientes_ajustes FOR UPDATE
  USING (public.can_access_ventas_categoria())
  WITH CHECK (public.can_access_ventas_categoria());

CREATE POLICY "ventas_categoria_ajustes_delete_authorized"
  ON public.ventas_categoria_clientes_ajustes FOR DELETE
  USING (public.can_access_ventas_categoria());
