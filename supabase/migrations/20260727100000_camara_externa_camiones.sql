-- =============================================================================
-- MIGRACION: Camiones en cámaras externas (Guadex / Zamexfruit / ...)
--
-- La báscula registra la ENTRADA de cada camión en la fecha de origen (con
-- los papeles de la cámara), así que la fruta que aún está físicamente en una
-- cámara externa ya existe en entradas_bascula y ya cuenta como stock — lo
-- que la app no sabía es DÓNDE está. Esta tabla guarda el registro que lleva
-- la propia cámara ("Registro_Control_Guadex" / "Control entradas", una fila
-- por camión), cuyo Nt/Ref es directamente el lote de báscula.
--
-- El ESTADO no se guarda nunca: se DERIVA en cada lectura (src/lib/
-- camarasExternas.ts) a partir de datos que ya fluyen a diario:
--   - lote con pasadas de calibrador (partes diarios)      → recibido
--   - lote con fecha_salida_camara (Excel de mermas)       → recibido
--   - Entrada1/Entrada2 con fecha en el propio registro    → recibido
--   - Entrada1 con texto "Venta directa ..."               → venta directa
--   - nada de lo anterior                                  → EN CÁMARA (días
--     acumulados y merma esperada por TASA_MERMA_NATURAL_DIA)
-- Reimportar el registro hace upsert por (procedencia, s_ref): idempotente.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.camara_externa_camiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  -- 'GUADEX' | 'ZAMEXFRUIT' | ... — detectada de la cabecera del registro
  -- ("Tte. A Guadex" / "Tte. a Zamexfruit").
  procedencia TEXT NOT NULL,
  -- Referencia del registro de la cámara: 'S26/100224', 'Z-CAMION 3'...
  s_ref TEXT NOT NULL,
  -- Nt/Ref del registro = lote de entradas_bascula (clave del cruce).
  lote TEXT,
  fecha_almacenamiento DATE NOT NULL,
  proveedor TEXT,
  finca TEXT,
  variedad TEXT,
  envases INTEGER,
  kg NUMERIC NOT NULL DEFAULT 0,
  -- Fechas de entrada a LST según el registro de la cámara (puede llegar en
  -- dos viajes: Entrada1/Envases1 y Entrada2/Envases2).
  entrada_lst_1 DATE,
  entrada_lst_2 DATE,
  envases_1 INTEGER,
  envases_2 INTEGER,
  -- Texto original de Entrada1 cuando no es fecha y habla de venta directa
  -- ('Venta directa 15/05'): esa fruta jamás llegará a la central.
  venta_directa TEXT,
  -- Texto original de Entrada1/2 no interpretable (p.ej. la errata '06/04/206').
  nota_entrada TEXT,
  transporte_lst TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procedencia, s_ref)
);

CREATE INDEX IF NOT EXISTS camara_externa_camiones_lote_idx
  ON public.camara_externa_camiones (lote);

ALTER TABLE public.camara_externa_camiones ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.camara_externa_camiones TO authenticated;

-- Mismo modelo que entradas_bascula: datos operativos compartidos, cualquier
-- usuario autenticado lee y escribe.
DROP POLICY IF EXISTS "camara_externa_select_authenticated" ON public.camara_externa_camiones;
DROP POLICY IF EXISTS "camara_externa_insert_authenticated" ON public.camara_externa_camiones;
DROP POLICY IF EXISTS "camara_externa_update_authenticated" ON public.camara_externa_camiones;
DROP POLICY IF EXISTS "camara_externa_delete_authenticated" ON public.camara_externa_camiones;

CREATE POLICY "camara_externa_select_authenticated"
  ON public.camara_externa_camiones FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "camara_externa_insert_authenticated"
  ON public.camara_externa_camiones FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "camara_externa_update_authenticated"
  ON public.camara_externa_camiones FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "camara_externa_delete_authenticated"
  ON public.camara_externa_camiones FOR DELETE
  USING (auth.role() = 'authenticated');
