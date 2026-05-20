-- =============================================================================
-- MIGRACIÓN: Rediseño del módulo de asistencia
--
-- CAMBIOS:
--   1. Nueva tabla `trabajadores` — lista maestra de trabajadores
--   2. Nueva tabla `asistencia_detalle` — asistencias individuales por día
--   3. Las tablas anteriores (`asistencia_diaria`) quedan sin uso; se
--      mantienen para no romber dashboards existentes hasta migrar consultas.
-- =============================================================================

-- ─── Trabajadores (lista maestra) ──────────────────────────────────────────────
CREATE TABLE public.trabajadores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  zona TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, nombre)
);

CREATE INDEX idx_trabajadores_user ON public.trabajadores(user_id);
ALTER TABLE public.trabajadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trabajadores_select_all_authenticated"
  ON public.trabajadores FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "trabajadores_insert_own"
  ON public.trabajadores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "trabajadores_update_own_or_admin"
  ON public.trabajadores FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "trabajadores_delete_own_or_admin"
  ON public.trabajadores FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ─── Asistencia detalle (asistencia individual por día) ────────────────────────
CREATE TABLE public.asistencia_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  trabajador_id UUID NOT NULL REFERENCES public.trabajadores(id) ON DELETE CASCADE,
  presente BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, trabajador_id)
);

CREATE INDEX idx_asistencia_detalle_date ON public.asistencia_detalle(date DESC);
CREATE INDEX idx_asistencia_detalle_trabajador ON public.asistencia_detalle(trabajador_id);
ALTER TABLE public.asistencia_detalle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asistencia_detalle_select_all_authenticated"
  ON public.asistencia_detalle FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "asistencia_detalle_insert_own"
  ON public.asistencia_detalle FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "asistencia_detalle_update_own_or_admin"
  ON public.asistencia_detalle FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "asistencia_detalle_delete_own_or_admin"
  ON public.asistencia_detalle FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
