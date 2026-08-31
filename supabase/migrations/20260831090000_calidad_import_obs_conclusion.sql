-- Refuerzo del control de importación con lo que Raquel ya usa en sus Word
-- (controles 26082901 y 26083101 del 31-08):
--   - obs_calidad_interna: fila de observaciones dentro de "5. Calidad
--     interna" (p.ej. "%ZUMO NO ACEPTABLE, ASPECTO INTERIOR GRANULADO").
--   - conclusion: dictamen libre al pie del informe, después de la firma
--     (p.ej. "estos 3 palets los consideramos no aptos según nuestras
--     especificaciones organolépticas"). El informe solo lo imprime si existe.
ALTER TABLE public.calidad_import_controles
  ADD COLUMN IF NOT EXISTS obs_calidad_interna TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS conclusion TEXT NOT NULL DEFAULT '';
