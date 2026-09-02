-- =============================================================================
-- MIGRACION: Costes mensuales manuales para el CMV (coste medio por kg vendido)
--
-- Tabla de apuntes mensuales que NO existen en ningun otro modulo de la app y
-- que hacen falta para cerrar el escandallo del mes (Economico -> CMV):
--   - personal_real:      coste empresa real del mes (nomina + SS, lo da la
--                         gestoria). Si existe, sustituye a la ESTIMACION de
--                         useCostePersonal (dias presente x 8h x coste_hora).
--   - transporte_salida:  facturas de transporte de salida a cliente (los CMR
--                         de cmr_documentos son documentales, sin importe).
--   - estructura:         alquiler, seguros, amortizacion, financieros,
--                         gestoria... (un apunte mensual, se revisa por campana).
--   - otros:              cualquier otro coste del mes no capturado.
--
-- Se permiten VARIAS filas por (mes, tipo) a proposito: p. ej. una fila por
-- factura de transporte de salida. El CMV suma todas las del mes.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS (sin DROP: la tabla guarda datos
-- introducidos a mano por administracion y no debe vaciarse al re-ejecutar).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cmv_costes_mensuales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Mes natural al que se imputa el coste, formato "YYYY-MM".
  mes TEXT NOT NULL CHECK (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  tipo TEXT NOT NULL CHECK (tipo IN ('personal_real', 'transporte_salida', 'estructura', 'otros')),
  -- Etiqueta libre del apunte (p. ej. "Factura Transportes Perez 2ª quincena").
  concepto TEXT,
  importe NUMERIC NOT NULL CHECK (importe >= 0),
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmv_costes_mensuales_mes
  ON public.cmv_costes_mensuales(mes, tipo);

ALTER TABLE public.cmv_costes_mensuales ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cmv_costes_mensuales TO authenticated;

-- Dato economico sensible: solo administracion, mismo criterio que
-- economico_precios / empaque_precios (incluido el SELECT).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cmv_costes_mensuales' AND policyname = 'cmv_costes_mensuales_select_admin'
  ) THEN
    CREATE POLICY "cmv_costes_mensuales_select_admin"
      ON public.cmv_costes_mensuales FOR SELECT
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cmv_costes_mensuales' AND policyname = 'cmv_costes_mensuales_insert_admin'
  ) THEN
    CREATE POLICY "cmv_costes_mensuales_insert_admin"
      ON public.cmv_costes_mensuales FOR INSERT
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cmv_costes_mensuales' AND policyname = 'cmv_costes_mensuales_update_admin'
  ) THEN
    CREATE POLICY "cmv_costes_mensuales_update_admin"
      ON public.cmv_costes_mensuales FOR UPDATE
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cmv_costes_mensuales' AND policyname = 'cmv_costes_mensuales_delete_admin'
  ) THEN
    CREATE POLICY "cmv_costes_mensuales_delete_admin"
      ON public.cmv_costes_mensuales FOR DELETE
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;
