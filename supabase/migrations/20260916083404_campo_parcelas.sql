-- =============================================================================
-- El catálogo de parcelas DE CAMPO (16-09-2026).
--
-- POR QUÉ. La herramienta solo conocía la parcela como un texto escrito en la
-- entrada de báscula ("Parcela Nº3 Delta Seedless"). No sabía cuántas hectáreas
-- tiene, ni dónde está, ni qué variedad hay plantada. Sin hectáreas no se puede
-- calcular lo más elemental del campo: los kilos por hectárea.
--
-- DE DÓNDE SALE. De los ficheros que Aerobotics deja descargar por finca
-- (farm_<id>_polygons.zip). Cada uno trae un shapefile con una fila por parcela:
-- nombre, hectáreas, cultivo, variedad, fecha de plantación, patrón y el
-- CONTORNO en latitud/longitud. La API de Aerobotics es de pago y está
-- descartada (decisión de Vadim, 16-09-2026): esta es la vía sin coste.
-- Lo carga scripts/aerobotics-cargar-parcelas.mjs.
--
-- EL EMPAREJAMIENTO NO ES AUTOMÁTICO. El nombre que usa Aerobotics y el que usa
-- la báscula son el mismo trozo de campo escrito de dos maneras ("TORRECILLA
-- POWELL" / "La Torrecilla Navel Powell"), y hay erratas de una letra
-- ("Borego"/Borrego). El cargador propone y guarda con qué confianza:
--   clara      → una sola candidata y sin empate. Se usa para calcular.
--   probable   → hay candidata pero no está clara. NO se usa para calcular.
--   pendiente  → no hay con qué casarla.
--   confirmada → lo ha dicho una persona. Manda sobre cualquier propuesta.
--   descartada → una persona dice que esta parcela no es de ninguna nuestra.
-- El cargador NUNCA pisa una fila confirmada o descartada.
--
-- HECTÁREAS: las que declara Aerobotics. El cargador recalcula el área a partir
-- del contorno y avisa si no cuadran (en la primera carga cuadraron las 70).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.campo_parcelas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- De dónde viene la ficha. Hoy solo 'aerobotics'; mañana puede ser 'sigpac'
  -- o 'manual' sin tocar nada.
  origen TEXT NOT NULL DEFAULT 'aerobotics',
  /** Identificador de la finca en el origen (el <id> de farm_<id>_polygons). */
  origen_finca_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  hectareas NUMERIC,
  cultivo TEXT,
  variedad TEXT,
  plantacion DATE,
  patron TEXT,
  /** Anillos del polígono: [[[lon, lat], ...], ...]. El primero es el exterior. */
  contorno JSONB NOT NULL DEFAULT '[]'::JSONB,
  centro_lon NUMERIC,
  centro_lat NUMERIC,

  -- ─── Emparejamiento con la báscula ───
  /** finca + parcela tal y como los escribe entradas_bascula. NULL = sin casar. */
  finca TEXT,
  parcela TEXT,
  emparejado_estado TEXT NOT NULL DEFAULT 'pendiente',
  emparejado_puntuacion NUMERIC,
  emparejado_nota TEXT,
  confirmado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmado_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT campo_parcelas_estado_check
    CHECK (emparejado_estado IN ('clara', 'probable', 'pendiente', 'confirmada', 'descartada')),
  -- El nombre solo no basta: la finca 27696 tiene DOS parcelas llamadas "LAS
  -- TERESAS" (0,64 y 1,50 ha). Con las hectáreas dentro, la clave es estable
  -- entre descargas y el cargador puede repetirse sin duplicar.
  CONSTRAINT campo_parcelas_unica UNIQUE (origen, origen_finca_id, nombre, hectareas)
);

CREATE INDEX IF NOT EXISTS campo_parcelas_finca_parcela_idx
  ON public.campo_parcelas (finca, parcela);
CREATE INDEX IF NOT EXISTS campo_parcelas_estado_idx
  ON public.campo_parcelas (emparejado_estado);

COMMENT ON TABLE public.campo_parcelas IS
  'Ficha de campo de cada parcela (hectáreas, variedad y contorno), descargada de Aerobotics. El enlace con entradas_bascula es por (finca, parcela) y solo vale cuando emparejado_estado es clara o confirmada.';

ALTER TABLE public.campo_parcelas ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campo_parcelas TO authenticated;

-- Lectura para cualquiera que haya entrado: son hectáreas y contornos, no hay
-- nada sensible (los euros de la compra viven en entradas_bascula, no aquí).
DROP POLICY IF EXISTS "campo_parcelas_select_authenticated" ON public.campo_parcelas;
CREATE POLICY "campo_parcelas_select_authenticated"
  ON public.campo_parcelas FOR SELECT
  USING (auth.role() = 'authenticated');

-- Escritura solo admin: la carga la hace el script con la clave de servicio, y
-- confirmar un emparejamiento es una decisión, no una edición cualquiera.
DROP POLICY IF EXISTS "campo_parcelas_insert_admin" ON public.campo_parcelas;
CREATE POLICY "campo_parcelas_insert_admin"
  ON public.campo_parcelas FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "campo_parcelas_update_admin" ON public.campo_parcelas;
CREATE POLICY "campo_parcelas_update_admin"
  ON public.campo_parcelas FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "campo_parcelas_delete_admin" ON public.campo_parcelas;
CREATE POLICY "campo_parcelas_delete_admin"
  ON public.campo_parcelas FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::text));

DROP TRIGGER IF EXISTS update_campo_parcelas_updated_at ON public.campo_parcelas;
CREATE TRIGGER update_campo_parcelas_updated_at
  BEFORE UPDATE ON public.campo_parcelas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
