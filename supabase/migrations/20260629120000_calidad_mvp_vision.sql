-- Calidad MVP: informe visual asistido, borradores, validacion y reapertura.

ALTER TABLE public.calidad_lotes
  DROP CONSTRAINT IF EXISTS calidad_lotes_estado_check;

UPDATE public.calidad_lotes
SET calidad = 'Pésimo'
WHERE calidad = 'Rechazado';

ALTER TABLE public.calidad_lotes
  ADD COLUMN IF NOT EXISTS defecto_otro TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS informe_estado TEXT NOT NULL DEFAULT 'borrador',
  ADD COLUMN IF NOT EXISTS informe_generado TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ia_calidad TEXT,
  ADD COLUMN IF NOT EXISTS ia_defectos TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS ia_resumen TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ia_accion_recomendada TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS validado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validado_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reabierto_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reabierto_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_reapertura TEXT NOT NULL DEFAULT '';

ALTER TABLE public.calidad_lotes
  ADD CONSTRAINT calidad_lotes_estado_check
  CHECK (calidad IN ('Excelente', 'Bueno', 'Regular', 'Deficiente', 'Pésimo'));

ALTER TABLE public.calidad_lotes
  DROP CONSTRAINT IF EXISTS calidad_lotes_informe_estado_check;

ALTER TABLE public.calidad_lotes
  ADD CONSTRAINT calidad_lotes_informe_estado_check
  CHECK (informe_estado IN ('borrador', 'generado', 'validado', 'reabierto'));

CREATE INDEX IF NOT EXISTS calidad_lotes_informe_estado_idx
  ON public.calidad_lotes (informe_estado);

CREATE INDEX IF NOT EXISTS calidad_lotes_productor_fecha_idx
  ON public.calidad_lotes (productor_finca_nombre, fecha);
