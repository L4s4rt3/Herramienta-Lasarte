-- =============================================================================
-- MIGRACION: Control de calidad de fruta de IMPORTACION
--
-- El departamento de calidad revisa cada contenedor/camion que entra de fuera
-- (p.ej. la naranja de Sudafrica via Uria Export) y rellena un control por
-- categoria (CAT 1, CAT 2...). El control replica el formato del informe
-- "REPORTE DE CALIDAD FRUTA IMPORTACION" que ya se hacia a mano en Word:
-- 7 secciones (producto, general, defectos no evolutivos, evolutivos,
-- calidad interna, fotos y evaluador).
--
-- Los campos de valor son TEXT a proposito: la evaluadora escribe cosas como
-- "80 CAJAS", "4/56-5/64-6/72" o "(11-200)" y encorsetarlos a numeric solo
-- obligaria a inventar formatos. Lo que es lista (defectos, muestras de
-- calidad interna) va en JSONB. Lo DERIVABLE no se guarda: % de zumo e
-- indice de madurez se calculan de peso_fruta/peso_zumo y brix/acidez.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.calidad_import_controles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  estado TEXT NOT NULL DEFAULT 'borrador',

  -- 1. Informacion del producto
  referencia TEXT NOT NULL DEFAULT '',        -- ref. del proveedor (p.ej. 1184057)
  nuestra_ref TEXT NOT NULL DEFAULT '',       -- nuestro lote (p.ej. 26082701)
  proveedor TEXT NOT NULL DEFAULT '',
  barco TEXT NOT NULL DEFAULT '',
  marca TEXT NOT NULL DEFAULT '',
  num_contenedor TEXT NOT NULL DEFAULT '',
  kg_total TEXT NOT NULL DEFAULT '',
  puc_orchard TEXT NOT NULL DEFAULT '',
  ggn TEXT NOT NULL DEFAULT '',
  tipo_producto TEXT NOT NULL DEFAULT '',
  tipo_confeccion TEXT NOT NULL DEFAULT '',
  origen TEXT NOT NULL DEFAULT '',
  calibre TEXT NOT NULL DEFAULT '',

  -- 2. Informacion general
  etiquetado TEXT NOT NULL DEFAULT '',        -- OK / NO OK
  tratamientos TEXT NOT NULL DEFAULT '',
  clasificacion TEXT NOT NULL DEFAULT '',     -- CAT 1 / CAT 2 / ...
  temperatura TEXT NOT NULL DEFAULT '',
  paletizacion TEXT NOT NULL DEFAULT '',
  peso_medio_cajas TEXT NOT NULL DEFAULT '',
  sticker TEXT NOT NULL DEFAULT '',           -- SI / NO
  papel TEXT NOT NULL DEFAULT '',             -- SI / NO

  -- 3. Defectos no evolutivos  [{"tipo":"RAMEADO","pct":"4"}, ...]
  muestreo_no_evolutivos TEXT NOT NULL DEFAULT '',
  defectos_leves JSONB NOT NULL DEFAULT '[]'::jsonb,
  defectos_graves JSONB NOT NULL DEFAULT '[]'::jsonb,
  obs_no_evolutivos TEXT NOT NULL DEFAULT '',

  -- 4. Defectos evolutivos
  muestreo_evolutivos TEXT NOT NULL DEFAULT '',
  defectos_evolutivos JSONB NOT NULL DEFAULT '[]'::jsonb,
  obs_evolutivos TEXT NOT NULL DEFAULT '',

  -- 5. Calidad interna  [{"peso_fruta":"948","peso_zumo":"402","brix":"12.2","acidez":"0.97"}, ...]
  muestras_internas JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- 7. Realiza
  evaluador TEXT NOT NULL DEFAULT '',
  firma_path TEXT,                            -- PNG de la firma dibujada, en storage

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calidad_import_controles_estado_check CHECK (estado IN ('borrador', 'completado'))
);

CREATE INDEX IF NOT EXISTS calidad_import_controles_fecha_idx
  ON public.calidad_import_controles (fecha DESC);
CREATE INDEX IF NOT EXISTS calidad_import_controles_nuestra_ref_idx
  ON public.calidad_import_controles (nuestra_ref);

CREATE TABLE IF NOT EXISTS public.calidad_import_fotos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id UUID NOT NULL REFERENCES public.calidad_import_controles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calidad_import_fotos_path_unique UNIQUE (file_path)
);

CREATE INDEX IF NOT EXISTS calidad_import_fotos_control_idx
  ON public.calidad_import_fotos (control_id, orden);

ALTER TABLE public.calidad_import_controles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calidad_import_fotos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calidad_import_controles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calidad_import_fotos TO authenticated;

-- Mismo criterio que el resto de calidad_*: cualquiera autenticado lee,
-- cada cual inserta lo suyo y edita/borra lo suyo (o admin).
DROP POLICY IF EXISTS "calidad_import_controles_select_all_authenticated" ON public.calidad_import_controles;
DROP POLICY IF EXISTS "calidad_import_controles_insert_own" ON public.calidad_import_controles;
DROP POLICY IF EXISTS "calidad_import_controles_update_own_or_admin" ON public.calidad_import_controles;
DROP POLICY IF EXISTS "calidad_import_controles_delete_own_or_admin" ON public.calidad_import_controles;

CREATE POLICY "calidad_import_controles_select_all_authenticated"
  ON public.calidad_import_controles FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "calidad_import_controles_insert_own"
  ON public.calidad_import_controles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "calidad_import_controles_update_own_or_admin"
  ON public.calidad_import_controles FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "calidad_import_controles_delete_own_or_admin"
  ON public.calidad_import_controles FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "calidad_import_fotos_select_all_authenticated" ON public.calidad_import_fotos;
DROP POLICY IF EXISTS "calidad_import_fotos_insert_own" ON public.calidad_import_fotos;
DROP POLICY IF EXISTS "calidad_import_fotos_update_own_or_admin" ON public.calidad_import_fotos;
DROP POLICY IF EXISTS "calidad_import_fotos_delete_own_or_admin" ON public.calidad_import_fotos;

CREATE POLICY "calidad_import_fotos_select_all_authenticated"
  ON public.calidad_import_fotos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "calidad_import_fotos_insert_own"
  ON public.calidad_import_fotos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "calidad_import_fotos_update_own_or_admin"
  ON public.calidad_import_fotos FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "calidad_import_fotos_delete_own_or_admin"
  ON public.calidad_import_fotos FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS calidad_import_controles_updated_at ON public.calidad_import_controles;
CREATE TRIGGER calidad_import_controles_updated_at
  BEFORE UPDATE ON public.calidad_import_controles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
