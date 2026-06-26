CREATE TABLE IF NOT EXISTS public.asistencia_bajas_laborales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trabajador_id UUID NOT NULL REFERENCES public.trabajadores(id) ON DELETE CASCADE,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  motivo TEXT NOT NULL DEFAULT 'baja_laboral',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT asistencia_bajas_laborales_fecha_check
    CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);

CREATE INDEX IF NOT EXISTS idx_asistencia_bajas_laborales_user_trabajador
  ON public.asistencia_bajas_laborales(user_id, trabajador_id);

CREATE INDEX IF NOT EXISTS idx_asistencia_bajas_laborales_periodo
  ON public.asistencia_bajas_laborales(fecha_inicio, fecha_fin);

ALTER TABLE public.asistencia_bajas_laborales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "asistencia_bajas_laborales_select_all_authenticated"
  ON public.asistencia_bajas_laborales;
CREATE POLICY "asistencia_bajas_laborales_select_all_authenticated"
  ON public.asistencia_bajas_laborales FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "asistencia_bajas_laborales_insert_own"
  ON public.asistencia_bajas_laborales;
CREATE POLICY "asistencia_bajas_laborales_insert_own"
  ON public.asistencia_bajas_laborales FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "asistencia_bajas_laborales_update_own_or_admin"
  ON public.asistencia_bajas_laborales;
CREATE POLICY "asistencia_bajas_laborales_update_own_or_admin"
  ON public.asistencia_bajas_laborales FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "asistencia_bajas_laborales_delete_own_or_admin"
  ON public.asistencia_bajas_laborales;
CREATE POLICY "asistencia_bajas_laborales_delete_own_or_admin"
  ON public.asistencia_bajas_laborales FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
