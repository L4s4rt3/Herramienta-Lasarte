-- Merma REAL de cámara por lote, del registro manual "Merma fruta camaras"
-- (peso inicial al almacenar − peso final al entrar en la central). Es el
-- dato medido que sustituye a la estimación por tasa diaria:
--   - la conciliación de kg (src/lib/conciliacionKg.ts) usa entrada − merma
--     como CAPACIDAD del lote (lo que de verdad pudo llegar al calibrador);
--   - mermaLote.ts desglosa la merma natural con el dato real en vez del
--     estimado (fuente "real" en la ficha).
-- NULL = sin registro para ese lote (se sigue estimando).
alter table public.entradas_bascula
  add column if not exists merma_camara_kg numeric,
  add column if not exists fecha_salida_camara date;

comment on column public.entradas_bascula.merma_camara_kg is
  'Merma real de cámara (kg): peso inicial − peso final del registro manual de mermas. NULL = sin registro (se estima por tasa diaria).';
comment on column public.entradas_bascula.fecha_salida_camara is
  'Fecha en que el camión salió de cámara hacia la central (columna "Fecha entrada LST" del registro de mermas).';
