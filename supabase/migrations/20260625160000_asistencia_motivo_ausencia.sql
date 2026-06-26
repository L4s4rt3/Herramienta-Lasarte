ALTER TABLE public.asistencia_detalle
  ADD COLUMN IF NOT EXISTS motivo_ausencia TEXT;

COMMENT ON COLUMN public.asistencia_detalle.motivo_ausencia
  IS 'Motivo opcional cuando presente=false, por ejemplo baja_laboral.';
