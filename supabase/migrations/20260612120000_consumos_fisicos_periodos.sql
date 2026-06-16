-- =============================================================================
-- MIGRACION: Consumos fisicos por periodo y bases kg proxy
-- =============================================================================

CREATE TABLE public.consumos_fisicos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recurso TEXT NOT NULL CHECK (recurso IN ('agua', 'electricidad', 'gasoil', 'quimicos')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  cantidad NUMERIC NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  unidad TEXT NOT NULL CHECK (unidad IN ('l', 'm3', 'kwh')),
  fuente TEXT NOT NULL CHECK (fuente IN ('contador', 'factura_detallada', 'albaran', 'estimacion_manual')),
  referencia TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consumos_fisicos_fechas_check CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX idx_consumos_fisicos_user_fecha ON public.consumos_fisicos(user_id, fecha_inicio DESC);
CREATE INDEX idx_consumos_fisicos_recurso_fecha ON public.consumos_fisicos(recurso, fecha_inicio DESC);

ALTER TABLE public.consumos_fisicos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumos_fisicos TO authenticated;

CREATE POLICY "consumos_fisicos_select_all_authenticated"
  ON public.consumos_fisicos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "consumos_fisicos_insert_own"
  ON public.consumos_fisicos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "consumos_fisicos_update_own_or_admin"
  ON public.consumos_fisicos FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "consumos_fisicos_delete_own_or_admin"
  ON public.consumos_fisicos FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.consumos_bases_kg (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo_base TEXT NOT NULL CHECK (tipo_base IN ('ventas', 'manual')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  kg NUMERIC NOT NULL DEFAULT 0 CHECK (kg >= 0),
  referencia TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consumos_bases_kg_fechas_check CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX idx_consumos_bases_kg_user_fecha ON public.consumos_bases_kg(user_id, fecha_inicio DESC);
CREATE INDEX idx_consumos_bases_kg_tipo_fecha ON public.consumos_bases_kg(tipo_base, fecha_inicio DESC);

ALTER TABLE public.consumos_bases_kg ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumos_bases_kg TO authenticated;

CREATE POLICY "consumos_bases_kg_select_all_authenticated"
  ON public.consumos_bases_kg FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "consumos_bases_kg_insert_own"
  ON public.consumos_bases_kg FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "consumos_bases_kg_update_own_or_admin"
  ON public.consumos_bases_kg FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "consumos_bases_kg_delete_own_or_admin"
  ON public.consumos_bases_kg FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
