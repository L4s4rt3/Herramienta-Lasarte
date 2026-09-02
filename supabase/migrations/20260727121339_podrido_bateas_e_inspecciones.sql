-- =============================================================================
-- MIGRACION: podrido de BATEAS (medición diaria pre-calibrador) e
-- INSPECCIONES de podrido por muestreo (por lote)
--
-- 1) partes_diarios.kg_podrido_bateas — desde el 22-jul-2026 el almacén PESA
--    las bateas donde se aparta el podrido en la tría, ANTES del calibrador
--    (confirmado por el dueño 27-jul-2026). Ese podrido ya vive DENTRO de la
--    merma medida (entrada − calibrador), así que este dato NO es un sumando
--    nuevo de pérdida: convierte el "podrido pre-calibrador (asumido)" del
--    modelo en MEDIDO para los días con dato (prorrateo por kg del día, ver
--    src/lib/mermaLote.ts). NULL = sin medición ese día (no un 0 real) —
--    misma semántica que kg_podrido_bolsa_basura.
--
-- 2) podrido_inspecciones — muestreos manuales de podrido por lote (contar
--    naranjas podridas por box en la línea). Primer caso real: lote 26050508,
--    7 box, 12,66% podrido tras 78 días en cámara de Guadex.
-- =============================================================================

ALTER TABLE public.partes_diarios
  ADD COLUMN IF NOT EXISTS kg_podrido_bateas NUMERIC;

COMMENT ON COLUMN public.partes_diarios.kg_podrido_bateas IS
  'Kg de podrido pesado en las bateas de la tría PRE-calibrador (medición diaria desde 22-jul-2026). NULL = sin medición (no un 0). Ya está dentro de la merma medida entrada−calibrador: es desglose, no pérdida nueva.';

CREATE TABLE IF NOT EXISTS public.podrido_inspecciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  -- Código de lote de báscula/calibrador (8 dígitos), sin FK para poder
  -- registrar inspecciones de lotes aún no importados.
  lote TEXT NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  peso_naranja_g NUMERIC,
  kg_por_box NUMERIC,
  naranjas_por_box INTEGER,
  -- Podridas contadas en cada box inspeccionado: jsonb [119, 136, ...].
  podridas_por_box JSONB NOT NULL DEFAULT '[]'::jsonb,
  naranjas_inspeccionadas INTEGER NOT NULL,
  naranjas_podridas INTEGER NOT NULL,
  -- Fracción 0-1 (no %): naranjas_podridas / naranjas_inspeccionadas.
  pct_podrido NUMERIC NOT NULL,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS podrido_inspecciones_lote_idx
  ON public.podrido_inspecciones (lote);

ALTER TABLE public.podrido_inspecciones ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.podrido_inspecciones TO authenticated;

DROP POLICY IF EXISTS "podrido_inspecciones_select_authenticated" ON public.podrido_inspecciones;
DROP POLICY IF EXISTS "podrido_inspecciones_insert_authenticated" ON public.podrido_inspecciones;
DROP POLICY IF EXISTS "podrido_inspecciones_update_authenticated" ON public.podrido_inspecciones;
DROP POLICY IF EXISTS "podrido_inspecciones_delete_authenticated" ON public.podrido_inspecciones;

CREATE POLICY "podrido_inspecciones_select_authenticated"
  ON public.podrido_inspecciones FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "podrido_inspecciones_insert_authenticated"
  ON public.podrido_inspecciones FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "podrido_inspecciones_update_authenticated"
  ON public.podrido_inspecciones FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "podrido_inspecciones_delete_authenticated"
  ON public.podrido_inspecciones FOR DELETE
  USING (auth.role() = 'authenticated');
