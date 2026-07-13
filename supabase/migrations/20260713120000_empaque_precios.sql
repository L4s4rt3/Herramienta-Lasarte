-- =============================================================================
-- MIGRACION: Precios de materiales de envasado (packaging)
-- Idempotente: se puede re-ejecutar sin error.
-- =============================================================================

DROP TABLE IF EXISTS public.empaque_precios;

CREATE TABLE public.empaque_precios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo_malla TEXT NOT NULL CHECK (tipo_malla IN ('3kg', '5kg')),
  componente TEXT NOT NULL CHECK (componente IN (
    'etiqueta', 'caja_logifruit', 'palet_doble', 'malla_roja', 'banda', 'fleje', 'asa'
  )),
  precio_malla NUMERIC NOT NULL DEFAULT 0 CHECK (precio_malla >= 0),
  vigente_desde DATE NOT NULL,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_empaque_precios_tipo_malla ON public.empaque_precios(tipo_malla, vigente_desde DESC);

ALTER TABLE public.empaque_precios ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.empaque_precios TO authenticated;

CREATE POLICY "empaque_precios_select_admin"
  ON public.empaque_precios FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "empaque_precios_insert_admin"
  ON public.empaque_precios FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "empaque_precios_update_admin"
  ON public.empaque_precios FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "empaque_precios_delete_admin"
  ON public.empaque_precios FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed: campaña 2025/2026 (vigente desde inicio de campaña).
-- user_id en NULL: la tabla es solo-admin vía RLS, el user_id es campo de auditoría.
INSERT INTO public.empaque_precios (user_id, tipo_malla, componente, precio_malla, vigente_desde, notas) VALUES
  -- Malla 3kg
  (NULL, '3kg', 'etiqueta',      0.0021,  '2025-09-01', 'Precio unitario etiqueta'),
  (NULL, '3kg', 'caja_logifruit', 0.0013,  '2025-09-01', 'Caja Logifruit 0,25€/ud ÷ 4 mallas por caja'),
  (NULL, '3kg', 'palet_doble',    0.0151,  '2025-09-01', 'Palet doble 2,90€ ÷ 192 mallas por palet'),
  (NULL, '3kg', 'malla_roja',     0.0170,  '2025-09-01', 'Malla roja 0,02985€/metro'),
  (NULL, '3kg', 'banda',          0.00342, '2025-09-01', 'Banda 3kg 0,003€/metro'),
  (NULL, '3kg', 'fleje',          0.0033,  '2025-09-01', 'Fleje 0,0079€/metro'),
  (NULL, '3kg', 'asa',            0.01,    '2025-09-01', 'Asa 0,01€/malla'),
  -- Malla 5kg
  (NULL, '5kg', 'etiqueta',      0.0021,  '2025-09-01', 'Precio unitario etiqueta'),
  (NULL, '5kg', 'caja_logifruit', 0.125,   '2025-09-01', 'Caja Logifruit 0,25€/ud ÷ 2 mallas por caja'),
  (NULL, '5kg', 'palet_doble',    0.0302,  '2025-09-01', 'Palet doble 2,90€ ÷ 96 mallas por palet'),
  (NULL, '5kg', 'malla_roja',     0.0194,  '2025-09-01', 'Malla roja 0,02985€/metro'),
  (NULL, '5kg', 'banda',          0.0524,  '2025-09-01', 'Banda 5kg 0,04€/metro'),
  (NULL, '5kg', 'fleje',          0.0033,  '2025-09-01', 'Fleje 0,0079€/metro'),
  (NULL, '5kg', 'asa',            0.01,    '2025-09-01', 'Asa 0,01€/malla');
