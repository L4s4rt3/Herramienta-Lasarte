-- Feedback de Raquel tras la primera prueba real (31-08):
--   - fecha_descarga: cuándo se descargó el camión (distinta de la fecha del
--     control; se imprime en "1. Información del producto" si existe).
--   - realtime: los controles y sus fotos entran en la publicación de
--     Supabase Realtime para que cada cambio aparezca EN VIVO a todos los
--     usuarios que ven la sección (la lista se refresca sola).
ALTER TABLE public.calidad_import_controles
  ADD COLUMN IF NOT EXISTS fecha_descarga DATE;

ALTER PUBLICATION supabase_realtime ADD TABLE public.calidad_import_controles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calidad_import_fotos;
