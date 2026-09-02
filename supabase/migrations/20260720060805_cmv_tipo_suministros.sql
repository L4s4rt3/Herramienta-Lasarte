-- =============================================================================
-- MIGRACION: tipo "suministros" en los costes mensuales manuales del CMV
--
-- Decision del dueño (2026-07-20): los suministros de la campaña entran al
-- CMV como FACTURAS REALES (base sin IVA, una fila por factura, imputadas al
-- mes del CONSUMO — el periodo de la factura, no su fecha de emision), porque
-- no hay lecturas fisicas historicas y una tarifa media mentiria (parte fija
-- de potencia de Endesa, precios por franjas, gasoil de 0,715 a 1,25 EUR/L).
--
-- Regla anti-doble-conteo (en src/lib/cmv.ts): si un mes tiene apuntes
-- "suministros", estos SUSTITUYEN a la pata "consumos = lecturas x tarifa"
-- del modulo de Consumos — igual que personal_real sustituye a la estimacion
-- por asistencia.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD (el nombre es el que genera
-- Postgres para el CHECK inline de la migracion 20260717130000).
-- =============================================================================

ALTER TABLE public.cmv_costes_mensuales
  DROP CONSTRAINT IF EXISTS cmv_costes_mensuales_tipo_check;

ALTER TABLE public.cmv_costes_mensuales
  ADD CONSTRAINT cmv_costes_mensuales_tipo_check
  CHECK (tipo IN ('personal_real', 'suministros', 'transporte_salida', 'estructura', 'otros'));
