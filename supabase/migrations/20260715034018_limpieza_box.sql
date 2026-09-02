-- =============================================================================
-- MIGRACION: Limpieza de box — partes diarios del grupo de limpieza de boxes
--
-- Cada parte registra: fecha, turno (puede haber 2 turnos el mismo día),
-- box limpiados (el dato de campo llega en PIES o en BOX; 48 pies = 144 box,
-- es decir 1 pie = 3 box — espejo de PIES_A_BOX en src/lib/limpiezaBox.ts),
-- escaleras (solo los días que también se limpian), observaciones y la lista
-- de trabajadores con las horas de cada uno.
--
-- Se guarda SIEMPRE `box` (ya convertido si la unidad original fue pies) y
-- `pies` solo cuando esa fue la unidad de entrada (NULL si se metió en box),
-- para poder mostrar el dato original sin perder la unidad común de análisis.
--
-- RLS: dataset compartido del equipo (mismo patrón que
-- 20260508120000_shared_workspace_rls.sql): SELECT para cualquier autenticado,
-- INSERT con user_id propio, UPDATE/DELETE del dueño o admin. En la tabla hija
-- (trabajadores del parte) el own_or_admin se resuelve vía EXISTS sobre su
-- parte, porque la fila hija no tiene user_id propio.
--
-- Idempotente: se puede volver a aplicar sin error.
-- =============================================================================

-- ─── limpieza_partes (cabecera del parte: fecha + turno) ─────────────────────
CREATE TABLE IF NOT EXISTS public.limpieza_partes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  fecha DATE NOT NULL,
  turno SMALLINT NOT NULL DEFAULT 1 CHECK (turno IN (1, 2)),
  -- Unidad en la que se metió el dato en el formulario.
  unidad TEXT NOT NULL CHECK (unidad IN ('pies', 'box')),
  -- Pies originales; NULL si el dato se metió directamente en box.
  pies NUMERIC NULL,
  -- Box limpiados (convertidos desde pies si hizo falta): unidad común de análisis.
  box NUMERIC NOT NULL CHECK (box >= 0),
  -- Escaleras limpiadas; NULL los días que no se limpian.
  escaleras INTEGER NULL CHECK (escaleras >= 0),
  observaciones TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Como mucho un parte por fecha y turno.
  CONSTRAINT limpieza_partes_fecha_turno_unique UNIQUE (fecha, turno)
);

CREATE INDEX IF NOT EXISTS idx_limpieza_partes_fecha ON public.limpieza_partes (fecha DESC);

ALTER TABLE public.limpieza_partes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.limpieza_partes TO authenticated;

DROP POLICY IF EXISTS "limpieza_partes_select_all_authenticated" ON public.limpieza_partes;
DROP POLICY IF EXISTS "limpieza_partes_insert_own"               ON public.limpieza_partes;
DROP POLICY IF EXISTS "limpieza_partes_update_own_or_admin"      ON public.limpieza_partes;
DROP POLICY IF EXISTS "limpieza_partes_delete_own_or_admin"      ON public.limpieza_partes;

CREATE POLICY "limpieza_partes_select_all_authenticated"
  ON public.limpieza_partes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "limpieza_partes_insert_own"
  ON public.limpieza_partes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "limpieza_partes_update_own_or_admin"
  ON public.limpieza_partes FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "limpieza_partes_delete_own_or_admin"
  ON public.limpieza_partes FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ─── limpieza_parte_trabajadores (quién limpió y cuántas horas) ──────────────
CREATE TABLE IF NOT EXISTS public.limpieza_parte_trabajadores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parte_id UUID NOT NULL REFERENCES public.limpieza_partes(id) ON DELETE CASCADE,
  -- Vínculo con la plantilla (tabla trabajadores) si el trabajador está en
  -- ella; NULL para nombres libres o si el trabajador se borra de plantilla.
  trabajador_id UUID NULL REFERENCES public.trabajadores(id) ON DELETE SET NULL,
  -- Snapshot del nombre, SIEMPRE relleno: el parte sigue siendo legible aunque
  -- el trabajador desaparezca de la plantilla o cambie de nombre.
  nombre TEXT NOT NULL,
  horas NUMERIC NOT NULL CHECK (horas >= 0 AND horas <= 24),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_limpieza_parte_trabajadores_parte
  ON public.limpieza_parte_trabajadores (parte_id);

ALTER TABLE public.limpieza_parte_trabajadores ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.limpieza_parte_trabajadores TO authenticated;

DROP POLICY IF EXISTS "limpieza_parte_trab_select_all_authenticated" ON public.limpieza_parte_trabajadores;
DROP POLICY IF EXISTS "limpieza_parte_trab_insert_authenticated"     ON public.limpieza_parte_trabajadores;
DROP POLICY IF EXISTS "limpieza_parte_trab_update_own_or_admin"      ON public.limpieza_parte_trabajadores;
DROP POLICY IF EXISTS "limpieza_parte_trab_delete_own_or_admin"      ON public.limpieza_parte_trabajadores;

CREATE POLICY "limpieza_parte_trab_select_all_authenticated"
  ON public.limpieza_parte_trabajadores FOR SELECT
  USING (auth.role() = 'authenticated');

-- INSERT de cualquier autenticado: la fila hija no tiene user_id, va ligada al
-- parte (que sí exige user_id = auth.uid() en su INSERT).
CREATE POLICY "limpieza_parte_trab_insert_authenticated"
  ON public.limpieza_parte_trabajadores FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- own_or_admin resuelto vía EXISTS sobre el parte padre.
CREATE POLICY "limpieza_parte_trab_update_own_or_admin"
  ON public.limpieza_parte_trabajadores FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.limpieza_partes p
      WHERE p.id = parte_id
        AND (auth.uid() = p.user_id OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "limpieza_parte_trab_delete_own_or_admin"
  ON public.limpieza_parte_trabajadores FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.limpieza_partes p
      WHERE p.id = parte_id
        AND (auth.uid() = p.user_id OR public.has_role(auth.uid(), 'admin'))
    )
  );
