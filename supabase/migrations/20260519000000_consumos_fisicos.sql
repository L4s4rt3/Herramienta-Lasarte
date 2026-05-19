-- =============================================================================
-- MIGRACIÓN: Tablas de consumos físicos (agua, electricidad, gasoil, químicos)
--
-- Nuevo modelo simplificado: solo medición física (L, kWh, mL) por kg de
-- naranja procesada. Sin costes/euros.
-- =============================================================================

-- ─── has_role helper (ya existe, asegurar) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role::public.app_role
  );
$$;

-- =========================================================================
-- MAQUINAS
-- =========================================================================
CREATE TABLE public.maquinas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  zona TEXT NOT NULL CHECK (zona IN ('drencher', 'linea_tratamiento', 'planta_general', 'compresor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_maquinas_user ON public.maquinas(user_id);
ALTER TABLE public.maquinas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "maquinas_select_all_authenticated"
  ON public.maquinas FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "maquinas_insert_own"
  ON public.maquinas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "maquinas_update_own_or_admin"
  ON public.maquinas FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "maquinas_delete_own_or_admin"
  ON public.maquinas FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- SESIONES DE CONSUMO
-- =========================================================================
CREATE TABLE public.sesiones_consumo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  kg_procesados NUMERIC NOT NULL DEFAULT 0,
  agua_linea_l NUMERIC NOT NULL DEFAULT 0,
  agua_drencher_l NUMERIC NOT NULL DEFAULT 0,
  quimicos_drencher_l NUMERIC NOT NULL DEFAULT 0,
  gasoil_l NUMERIC NOT NULL DEFAULT 0,
  electricidad_total_kwh NUMERIC NOT NULL DEFAULT 0,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sesiones_fechas_check CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX idx_sesiones_consumo_user_fecha ON public.sesiones_consumo(user_id, fecha_inicio DESC);
ALTER TABLE public.sesiones_consumo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sesiones_select_all_authenticated"
  ON public.sesiones_consumo FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "sesiones_insert_own"
  ON public.sesiones_consumo FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sesiones_update_own_or_admin"
  ON public.sesiones_consumo FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sesiones_delete_own_or_admin"
  ON public.sesiones_consumo FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- CONSUMO POR MAQUINA (por sesión)
-- =========================================================================
CREATE TABLE public.consumo_maquinas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id UUID NOT NULL REFERENCES public.sesiones_consumo(id) ON DELETE CASCADE,
  maquina_id UUID NOT NULL REFERENCES public.maquinas(id) ON DELETE CASCADE,
  kwh NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consumo_maquinas_sesion ON public.consumo_maquinas(sesion_id);
CREATE INDEX idx_consumo_maquinas_maquina ON public.consumo_maquinas(maquina_id);
ALTER TABLE public.consumo_maquinas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consumo_maquinas_select_all_authenticated"
  ON public.consumo_maquinas FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "consumo_maquinas_insert_own"
  ON public.consumo_maquinas FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sesiones_consumo
      WHERE id = sesion_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "consumo_maquinas_update_own_or_admin"
  ON public.consumo_maquinas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sesiones_consumo
      WHERE id = sesion_id AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "consumo_maquinas_delete_own_or_admin"
  ON public.consumo_maquinas FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.sesiones_consumo
      WHERE id = sesion_id AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );
