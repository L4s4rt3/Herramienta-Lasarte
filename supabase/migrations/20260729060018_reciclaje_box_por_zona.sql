-- =============================================================================
-- MIGRACION: reciclaje de mallas POR ZONA (bruto del papel + nº de box)
--
-- Regla del dueño (2026-07-29): "los box de reciclaje están para que se quite
-- su tara en cada zona — si hay 3 box en Z1, se quitan 90 kg del peso que se
-- muestra en la celda". La vía OCR ya lo hacía (partManualVision.ts: neto =
-- bruto − ⌈box⌉ × 30) pero el desglose por zona se perdía al guardar y la
-- captura MANUAL no restaba nada.
--
-- Modelo: el operario apunta el BRUTO del papel y los box de cada zona; la
-- app calcula el NETO (bruto − box × 30) y lo guarda en las columnas de
-- SIEMPRE (kg_reciclado_malla_z1/z2), que siguen siendo la única fuente para
-- todo lo demás (cascada, conciliación de kg, coste de mallas). box_reciclaje
-- (total) pasa a derivarse de z1+z2 cuando hay dato por zona; en partes
-- antiguos sin desglose se conserva tal cual.
-- =============================================================================

ALTER TABLE public.partes_diarios
  ADD COLUMN IF NOT EXISTS kg_reciclado_malla_z1_bruto NUMERIC,
  ADD COLUMN IF NOT EXISTS kg_reciclado_malla_z2_bruto NUMERIC,
  ADD COLUMN IF NOT EXISTS box_reciclaje_z1 INTEGER,
  ADD COLUMN IF NOT EXISTS box_reciclaje_z2 INTEGER;

COMMENT ON COLUMN public.partes_diarios.kg_reciclado_malla_z1_bruto IS
  'Reciclado de malla Z1 tal cual lo apunta el papel (fruta + envases). El neto que consume el resto de la app sigue en kg_reciclado_malla_z1 = bruto − box_reciclaje_z1 × 30, calculado por la app al guardar. NULL = parte anterior a esta migración (solo neto).';
COMMENT ON COLUMN public.partes_diarios.kg_reciclado_malla_z2_bruto IS
  'Reciclado de malla Z2 tal cual lo apunta el papel. Ver kg_reciclado_malla_z1_bruto.';
COMMENT ON COLUMN public.partes_diarios.box_reciclaje_z1 IS
  'Nº de box de reciclaje de la zona Z1 (tara 30 kg/box, se resta del bruto de SU zona). NULL = sin desglose por zona (parte antiguo). box_reciclaje (total) = z1 + z2 cuando hay dato.';
COMMENT ON COLUMN public.partes_diarios.box_reciclaje_z2 IS
  'Nº de box de reciclaje de la zona Z2. Ver box_reciclaje_z1.';
