-- =============================================================================
-- MIGRACIÓN: Añadir soporte para palets de Egipto
--
-- Los palets con producto que contenga "EGIPTO" deben excluirse de la
-- cascada DSJ pero incluirse en el análisis diario.
-- =============================================================================

-- Columna para marcar palets egipcios en palets_dia
ALTER TABLE public.palets_dia
  ADD COLUMN IF NOT EXISTS egipto boolean NOT NULL DEFAULT false;

-- Columna para almacenar el total de kg de palets egipcios en partes_diarios
ALTER TABLE public.partes_diarios
  ADD COLUMN IF NOT EXISTS kg_palets_egipto numeric NOT NULL DEFAULT 0;
