-- =============================================================================
-- MIGRACION: Código de proveedor del ERP como identidad principal del productor
--
-- Decisión del dueño (2026-07-21): el ORIGEN PRINCIPAL de identidad de
-- productores es el ERP (el "Listado de entradas por proveedor" trae un código
-- único de 9 dígitos por proveedor: 400000325, 400001223...). Los nombres
-- cambian, se abrevian o llegan con erratas desde báscula/calibrador/calidad;
-- el código no. Anclar el catálogo a ese código hace la identidad estable:
--
--   - La conciliación con el ERP (ConciliarProductoresDialog.tsx +
--     src/lib/conciliacionProductoresErp.ts) casa primero por codigo_erp, luego
--     por nombre exacto y por último por alias. Si el ERP renombra un
--     proveedor, la ficha se reconoce por código y solo se actualiza el nombre.
--   - Es imposible volver a crear un duplicado por esa vía: si llega un código
--     que ya existe, es el mismo productor.
--
-- Único parcial (no UNIQUE de columna): las fichas que no vienen del ERP
-- (productores manuales, pseudo-productores) siguen sin código (NULL) sin
-- limitarse entre sí.
--
-- Idempotente: se puede volver a aplicar sin efecto.
-- =============================================================================

ALTER TABLE public.calidad_productores
  ADD COLUMN IF NOT EXISTS codigo_erp text;

CREATE UNIQUE INDEX IF NOT EXISTS calidad_productores_codigo_erp_unique
  ON public.calidad_productores (codigo_erp)
  WHERE codigo_erp IS NOT NULL;

COMMENT ON COLUMN public.calidad_productores.codigo_erp IS
  'Código de proveedor del ERP (9 dígitos, p.ej. 400000325). Origen principal de identidad del productor: la conciliación con el informe del ERP casa por este código antes que por nombre. NULL para fichas que no existen en el ERP.';
