-- Stock de consumibles (01-09-2026): el inventario deja de vivir en un Excel
-- que se actualiza dos veces al año y pasa a la herramienta, editable desde el
-- móvil. Catálogo + stock actual en stock_consumibles; cada cambio de stock
-- queda registrado en stock_consumibles_historial por trigger (quién, cuándo,
-- de cuánto a cuánto), así el "recuento" es continuo y auditable.

CREATE TABLE public.stock_consumibles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  familia TEXT NOT NULL DEFAULT 'Otros',
  -- Unidad en la que se cuenta ESTE artículo (uds, kg, L, m, bobinas, bolsas...):
  -- el precio_unitario va en €/unidad de esta misma unidad.
  unidad TEXT NOT NULL DEFAULT 'uds',
  stock NUMERIC NOT NULL DEFAULT 0,
  precio_unitario NUMERIC,
  almacen TEXT NOT NULL DEFAULT 'central' CHECK (almacen IN ('central', 'exterior')),
  -- Avisos del conteo ("CONFIRMAR: se lee 9 o 99") o del artículo ("falta precio").
  nota TEXT,
  -- Baja lógica: los artículos que dejan de usarse se desactivan, no se borran
  -- (el historial de sus movimientos sigue teniendo valor).
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nombre, almacen)
);

CREATE TABLE public.stock_consumibles_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumible_id UUID NOT NULL REFERENCES public.stock_consumibles(id) ON DELETE CASCADE,
  stock_anterior NUMERIC,
  stock_nuevo NUMERIC NOT NULL,
  cambiado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_consumibles_familia ON public.stock_consumibles (familia, nombre);
CREATE INDEX idx_stock_consumibles_hist_item ON public.stock_consumibles_historial (consumible_id, created_at DESC);

-- updated_at automático (misma función compartida que el resto de tablas).
CREATE TRIGGER update_stock_consumibles_updated_at
  BEFORE UPDATE ON public.stock_consumibles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Historial por trigger y no desde el cliente: así NINGÚN cambio de stock se
-- escapa del registro, venga de la app, del SQL editor o de un import.
CREATE OR REPLACE FUNCTION public.stock_consumibles_log_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock IS DISTINCT FROM OLD.stock THEN
    INSERT INTO public.stock_consumibles_historial (consumible_id, stock_anterior, stock_nuevo, cambiado_por)
    VALUES (NEW.id, OLD.stock, NEW.stock, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stock_consumibles_historial_trg
  AFTER UPDATE ON public.stock_consumibles
  FOR EACH ROW EXECUTE FUNCTION public.stock_consumibles_log_stock();

ALTER TABLE public.stock_consumibles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_consumibles_historial ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_consumibles TO authenticated;
GRANT SELECT ON public.stock_consumibles_historial TO authenticated;

-- El stock lo toca cualquier usuario autenticado (los operarios cuentan y
-- corrigen); borrar de verdad, solo admin (lo normal es desactivar).
CREATE POLICY stock_consumibles_select_all_authenticated
  ON public.stock_consumibles FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_consumibles_insert_authenticated
  ON public.stock_consumibles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY stock_consumibles_update_authenticated
  ON public.stock_consumibles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY stock_consumibles_delete_admin
  ON public.stock_consumibles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY stock_consumibles_historial_select_all_authenticated
  ON public.stock_consumibles_historial FOR SELECT TO authenticated USING (true);

-- Refresco en vivo: si dos móviles cuentan a la vez, ambos ven los cambios.
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_consumibles;
