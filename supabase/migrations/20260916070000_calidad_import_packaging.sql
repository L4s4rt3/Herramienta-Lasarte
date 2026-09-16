-- =============================================================================
-- MIGRACION: estado del EMBALAJE en el control de calidad de importacion
--
-- Hasta ahora el informe decia si el etiquetado estaba OK, pero no si las
-- cajas o los palets venian danados. Y eso pasa: el 11-09-2026, en el control
-- 1189269-26091102, la evaluadora tuvo que escribirlo dentro de la conclusion
-- porque no tenia donde ponerlo — "Los palets descargados llevan las cajas
-- inferiores aplastadas, perdiendo la estructura y presionando y danando a la
-- fruta. Se adjuntan fotos. Por este motivo tendran que desecharse frutas
-- rajadas y aplastadas."
--
-- Tres campos: como vienen las cajas, como vienen los palets y el DETALLE de
-- que tienen. Texto libre como el resto del modulo (la evaluadora escribe
-- "CORRECTO", "DANADO" o lo que haga falta) y opcionales: el informe solo
-- imprime lo que se rellena.
-- =============================================================================

ALTER TABLE public.calidad_import_controles
  ADD COLUMN IF NOT EXISTS packaging_cajas TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS packaging_palets TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS packaging_detalle TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.calidad_import_controles.packaging_cajas IS
  'Como llegan las cajas: CORRECTO / DANADO / texto libre. Vacio = no se anoto.';
COMMENT ON COLUMN public.calidad_import_controles.packaging_palets IS
  'Como llegan los palets: CORRECTO / DANADO / texto libre. Vacio = no se anoto.';
COMMENT ON COLUMN public.calidad_import_controles.packaging_detalle IS
  'Que tienen y por que: "cajas inferiores aplastadas, pierden estructura".';
