-- =============================================================================
-- Informe técnico de campo por finca (16-09-2026).
--
-- POR QUÉ. El informe de la finca Ganchal (visita del 04-09-2026) se hizo a
-- mano: alguien juntó las medidas de Aerobotics, las capturas de Aeroview, las
-- coordenadas de los cinco puntos y escribió el texto. Vadim quiere el mismo
-- documento para TODAS las fincas, eligiendo la finca y dándole a un botón, sin
-- tener que llamar a Luis ni a José María para cada uno.
--
-- QUÉ SE GUARDA AQUÍ Y QUÉ NO. Aquí vive SOLO lo que no está ya en la base:
--   · la visita (cuándo, quién fue, qué semana se muestreó, qué calibre se
--     persigue),
--   · los puntos de muestreo con sus milímetros y sus coordenadas,
--   · las capturas de Aeroview que se arrastran a la ficha,
--   · y los textos que escribe una persona (antecedentes y contexto).
-- Todo lo demás —calibre por semana, previsión, curva y su fuente, hectáreas,
-- contorno de la parcela, y lo que la finca entregó en almacén— ya está en
-- campo_calibre_medidas, campo_curvas_crecimiento, campo_parcelas y
-- entradas_bascula: el informe lo lee de ahí. Nada se teclea dos veces.
--
-- TEXTOS VACÍOS. `antecedentes` y `contexto` pueden quedarse en NULL: el
-- generador los escribe solo con los datos (misma regla que el informe de
-- calidad: null ≠ 0, y lo que no se rellenó no se inventa, se calcula o no
-- sale). Por eso NO llevan DEFAULT ''.
--
-- LAS IMÁGENES van al bucket "partes-archivos" bajo
-- <uid>/campo-informes/<informe_id>/, con el uid como PRIMERA carpeta porque es
-- lo que exige la política de insert del bucket (igual que calidad-import).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
-- =============================================================================

-- ─── El informe ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.campo_informes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  /** La finca tal y como se escribe en la báscula y en campo_parcelas ("Ganchal"). */
  finca TEXT NOT NULL,
  /** Día de la visita. NULL = seguimiento de gabinete, sin visita: el informe lo dice. */
  fecha_visita DATE,
  /** Quién fue al campo ("José María y Luis Navas"). */
  personal TEXT,
  apoyo_tecnico TEXT NOT NULL DEFAULT 'Aerobotics',
  /** Semana ISO del muestreo, "2026W36". Ordena sola alfabéticamente. */
  semana_muestreo TEXT,
  /** Calibre que se persigue, en milímetros (64 en Ganchal) y para qué es. */
  objetivo_mm NUMERIC NOT NULL DEFAULT 64,
  objetivo_nota TEXT,
  /** Semana ISO desde la que se espera superar el objetivo. Si se deja vacía, la calcula el informe. */
  horizonte_semana TEXT,
  antecedentes TEXT,
  contexto TEXT,
  /** Conclusión: si se deja vacía, el generador la escribe con los datos. */
  conclusion TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador',
  validado_at TIMESTAMPTZ,
  validado_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campo_informes_estado_check CHECK (estado IN ('borrador', 'validado')),
  CONSTRAINT campo_informes_objetivo_check CHECK (objetivo_mm > 0 AND objetivo_mm < 200)
);

CREATE INDEX IF NOT EXISTS campo_informes_finca_idx ON public.campo_informes (finca);
CREATE INDEX IF NOT EXISTS campo_informes_fecha_idx ON public.campo_informes (fecha_visita DESC);

-- ─── Los puntos de muestreo ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.campo_informe_puntos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  informe_id UUID NOT NULL REFERENCES public.campo_informes(id) ON DELETE CASCADE,
  /** "P1", "P2"… tal y como se numeran en el informe. */
  codigo TEXT NOT NULL,
  /** Calibre medio del punto, en milímetros. */
  mm NUMERIC NOT NULL,
  /** Coordenadas en grados decimales, como las da Aeroview (37.66587, -5.55323). */
  lat NUMERIC,
  lon NUMERIC,
  /** Semana del punto: normalmente la del muestreo, pero puede diferir. */
  semana TEXT,
  nota TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campo_informe_puntos_unico UNIQUE (informe_id, codigo),
  CONSTRAINT campo_informe_puntos_mm_check CHECK (mm > 0 AND mm < 200),
  CONSTRAINT campo_informe_puntos_lat_check CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90)),
  CONSTRAINT campo_informe_puntos_lon_check CHECK (lon IS NULL OR (lon BETWEEN -180 AND 180))
);

CREATE INDEX IF NOT EXISTS campo_informe_puntos_informe_idx ON public.campo_informe_puntos (informe_id, orden);

-- ─── Las capturas de Aeroview ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.campo_informe_imagenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  informe_id UUID NOT NULL REFERENCES public.campo_informes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  /**
   * Qué es la imagen, que es lo que decide DÓNDE se coloca en el documento:
   *   estructura   → Figura 1, el panel de estructura de tamaño
   *   mapa         → Figura 2, el mapa con los puntos
   *   modelizacion → Figura 3, la salida de evolución de Aerobotics
   *   punto        → ficha fotográfica de un punto (lleva punto_id)
   *   otra         → va al final, con su pie
   */
  tipo TEXT NOT NULL,
  punto_id UUID REFERENCES public.campo_informe_puntos(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  /** Pie de figura. Si se deja vacío, el generador escribe el suyo. */
  pie TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campo_informe_imagenes_tipo_check CHECK (tipo IN ('estructura', 'mapa', 'modelizacion', 'punto', 'otra'))
);

CREATE INDEX IF NOT EXISTS campo_informe_imagenes_informe_idx ON public.campo_informe_imagenes (informe_id, tipo, orden);

-- ─── updated_at ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.campo_informes_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campo_informes_touch_trg ON public.campo_informes;
CREATE TRIGGER campo_informes_touch_trg
  BEFORE UPDATE ON public.campo_informes
  FOR EACH ROW EXECUTE FUNCTION public.campo_informes_touch();

-- ─── Permisos ───────────────────────────────────────────────────────────────
-- Leer, todo el que haya entrado. Escribir, admin y el responsable de campo:
-- el informe es suyo y tiene que poder hacerlo sin pedir permiso a nadie.

ALTER TABLE public.campo_informes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campo_informe_puntos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campo_informe_imagenes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campo_informes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campo_informe_puntos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campo_informe_imagenes TO authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['campo_informes', 'campo_informe_puntos', 'campo_informe_imagenes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.role() = ''authenticated'')',
      t || '_select_authenticated', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_campo', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), ''admin''::text) OR public.has_role(auth.uid(), ''campo''::text))',
      t || '_insert_campo', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_campo', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), ''admin''::text) OR public.has_role(auth.uid(), ''campo''::text))',
      t || '_update_campo', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_campo', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''admin''::text) OR public.has_role(auth.uid(), ''campo''::text))',
      t || '_delete_campo', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.campo_informes IS
  'Informe técnico de campo por finca. Solo guarda la visita, los textos de persona y lo que no está en otra tabla; el calibre, la previsión y lo que dio la finca se leen de campo_calibre_medidas, campo_curvas_crecimiento y entradas_bascula.';
