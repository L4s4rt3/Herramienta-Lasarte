-- Permite NULL en los dos contadores de podrido de partes_diarios para poder
-- distinguir "no hay dato" (p. ej. un día del histórico de campaña
-- importado desde el export del calibrador, que no trae podrido) de un 0
-- REAL registrado a mano. Antes de esta migración ambas columnas eran
-- NOT NULL DEFAULT 0, así que un día sin dato se guardaba indistinguible de
-- un día con 0 kg de podrido real (ver src/lib/mermaLote.ts, FuentePodrido
-- "desconocido").
--
-- Se mantiene el DEFAULT 0: los formularios existentes que insertan sin
-- especificar estas columnas siguen obteniendo 0 (comportamiento manual sin
-- cambios); solo un INSERT que pase explícitamente `null` (el importador del
-- histórico) queda ahora permitido.
ALTER TABLE public.partes_diarios
  ALTER COLUMN kg_podrido_calibrador_auto DROP NOT NULL,
  ALTER COLUMN kg_podrido_bolsa_basura DROP NOT NULL;
