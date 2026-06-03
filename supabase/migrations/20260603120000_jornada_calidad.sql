-- =============================================================================
-- MIGRACION: Jornada de Calidad
--
-- Notas diarias de lotes para el departamento de Calidad.
-- Se conectan con partes_diarios por fecha y permiten exportar informes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.calidad_productores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calidad_productores_nombre_not_empty CHECK (length(trim(nombre)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS calidad_productores_user_nombre_idx
  ON public.calidad_productores (user_id, lower(trim(nombre)));

CREATE TABLE IF NOT EXISTS public.calidad_jornadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  responsable TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'borrador',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calidad_jornadas_estado_check CHECK (estado IN ('borrador', 'guardada', 'revisada')),
  CONSTRAINT calidad_jornadas_user_fecha_unique UNIQUE (user_id, fecha)
);

CREATE TABLE IF NOT EXISTS public.calidad_lotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jornada_id UUID NOT NULL REFERENCES public.calidad_jornadas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  numero_lote TEXT NOT NULL DEFAULT '',
  productor_finca_id UUID REFERENCES public.calidad_productores(id) ON DELETE SET NULL,
  productor_finca_nombre TEXT NOT NULL DEFAULT '',
  producto TEXT NOT NULL DEFAULT '',
  variedad TEXT NOT NULL DEFAULT '',
  cantidad TEXT NOT NULL DEFAULT '',
  hora TIME,
  aerobotics_realizado BOOLEAN NOT NULL DEFAULT false,
  calidad TEXT NOT NULL DEFAULT 'Regular',
  defectos TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  observacion TEXT NOT NULL DEFAULT '',
  accion_recomendada TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calidad_lotes_estado_check CHECK (calidad IN ('Bueno', 'Regular', 'Deficiente', 'Rechazado'))
);

CREATE INDEX IF NOT EXISTS calidad_lotes_jornada_idx ON public.calidad_lotes (jornada_id);
CREATE INDEX IF NOT EXISTS calidad_lotes_fecha_idx ON public.calidad_lotes (fecha);
CREATE INDEX IF NOT EXISTS calidad_lotes_user_fecha_idx ON public.calidad_lotes (user_id, fecha);
CREATE INDEX IF NOT EXISTS calidad_lotes_numero_idx ON public.calidad_lotes (numero_lote);

CREATE TABLE IF NOT EXISTS public.calidad_adjuntos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES public.calidad_lotes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calidad_adjuntos_path_unique UNIQUE (file_path)
);

CREATE INDEX IF NOT EXISTS calidad_adjuntos_lote_idx ON public.calidad_adjuntos (lote_id);
CREATE INDEX IF NOT EXISTS calidad_adjuntos_user_idx ON public.calidad_adjuntos (user_id);

ALTER TABLE public.calidad_productores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calidad_jornadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calidad_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calidad_adjuntos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calidad_productores TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calidad_jornadas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calidad_lotes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calidad_adjuntos TO authenticated;

DROP POLICY IF EXISTS "calidad_productores_select_all_authenticated" ON public.calidad_productores;
DROP POLICY IF EXISTS "calidad_productores_insert_own" ON public.calidad_productores;
DROP POLICY IF EXISTS "calidad_productores_update_own_or_admin" ON public.calidad_productores;
DROP POLICY IF EXISTS "calidad_productores_delete_own_or_admin" ON public.calidad_productores;

CREATE POLICY "calidad_productores_select_all_authenticated"
  ON public.calidad_productores FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "calidad_productores_insert_own"
  ON public.calidad_productores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "calidad_productores_update_own_or_admin"
  ON public.calidad_productores FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "calidad_productores_delete_own_or_admin"
  ON public.calidad_productores FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "calidad_jornadas_select_all_authenticated" ON public.calidad_jornadas;
DROP POLICY IF EXISTS "calidad_jornadas_insert_own" ON public.calidad_jornadas;
DROP POLICY IF EXISTS "calidad_jornadas_update_own_or_admin" ON public.calidad_jornadas;
DROP POLICY IF EXISTS "calidad_jornadas_delete_own_or_admin" ON public.calidad_jornadas;

CREATE POLICY "calidad_jornadas_select_all_authenticated"
  ON public.calidad_jornadas FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "calidad_jornadas_insert_own"
  ON public.calidad_jornadas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "calidad_jornadas_update_own_or_admin"
  ON public.calidad_jornadas FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "calidad_jornadas_delete_own_or_admin"
  ON public.calidad_jornadas FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "calidad_lotes_select_all_authenticated" ON public.calidad_lotes;
DROP POLICY IF EXISTS "calidad_lotes_insert_own" ON public.calidad_lotes;
DROP POLICY IF EXISTS "calidad_lotes_update_own_or_admin" ON public.calidad_lotes;
DROP POLICY IF EXISTS "calidad_lotes_delete_own_or_admin" ON public.calidad_lotes;

CREATE POLICY "calidad_lotes_select_all_authenticated"
  ON public.calidad_lotes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "calidad_lotes_insert_own"
  ON public.calidad_lotes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "calidad_lotes_update_own_or_admin"
  ON public.calidad_lotes FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "calidad_lotes_delete_own_or_admin"
  ON public.calidad_lotes FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "calidad_adjuntos_select_all_authenticated" ON public.calidad_adjuntos;
DROP POLICY IF EXISTS "calidad_adjuntos_insert_own" ON public.calidad_adjuntos;
DROP POLICY IF EXISTS "calidad_adjuntos_update_own_or_admin" ON public.calidad_adjuntos;
DROP POLICY IF EXISTS "calidad_adjuntos_delete_own_or_admin" ON public.calidad_adjuntos;

CREATE POLICY "calidad_adjuntos_select_all_authenticated"
  ON public.calidad_adjuntos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "calidad_adjuntos_insert_own"
  ON public.calidad_adjuntos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "calidad_adjuntos_update_own_or_admin"
  ON public.calidad_adjuntos FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "calidad_adjuntos_delete_own_or_admin"
  ON public.calidad_adjuntos FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS calidad_productores_updated_at ON public.calidad_productores;
CREATE TRIGGER calidad_productores_updated_at
  BEFORE UPDATE ON public.calidad_productores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS calidad_jornadas_updated_at ON public.calidad_jornadas;
CREATE TRIGGER calidad_jornadas_updated_at
  BEFORE UPDATE ON public.calidad_jornadas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS calidad_lotes_updated_at ON public.calidad_lotes;
CREATE TRIGGER calidad_lotes_updated_at
  BEFORE UPDATE ON public.calidad_lotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
