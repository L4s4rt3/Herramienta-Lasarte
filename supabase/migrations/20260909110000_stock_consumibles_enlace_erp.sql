-- Enlace consumible ↔ artículo de compra del ERP (petición del 09-09: que los
-- precios se actualicen solos cada lunes desde las facturas de GSTOCK).
--
-- erp_codigo   → gdata001.articulo_general.codigo del ERP de LR Informática.
-- erp_factor   → €/unidad nuestra = precio_ult_compra del ERP × factor.
--                Casi siempre 1; 0.001 cuando el ERP tiene el precio POR MILLAR
--                metido como unitario (pasa de verdad: banda EDEKA a 28,66 "€/ud").
-- precio_fuente/precio_actualizado_at → de dónde salió el precio vigente
--                ("manual" o "ERP «artículo» · proveedor · fra. · fecha"), para
--                que cada cifra lleve su método y su fuente.
ALTER TABLE public.stock_consumibles
  ADD COLUMN erp_codigo BIGINT,
  ADD COLUMN erp_factor NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN precio_fuente TEXT,
  ADD COLUMN precio_actualizado_at TIMESTAMPTZ;
