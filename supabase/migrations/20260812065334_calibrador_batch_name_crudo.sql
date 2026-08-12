-- El importador guardaba en `lote` el codigo de 8 digitos extraido del BatchName
-- y TIRABA el texto original. Con eso se perdia el desglose que el operario
-- escribe a mano ("26051904-15 BOX +7 BOX DE RECICLAJE"): sin el texto no hay
-- forma ni de detectar que esa pasada llevaba varios lotes, ni de repartirla con
-- desgloseBox.ts. Se guarda el crudo aparte; `lote` sigue siendo el normalizado
-- (Convencion A) que consume todo lo demas.
ALTER TABLE public.calibrador_batch
  ADD COLUMN IF NOT EXISTS batch_name text;

COMMENT ON COLUMN public.calibrador_batch.batch_name IS
  'BatchName tal cual lo escribio el operario en el Sizer. Texto libre: puede llevar el desglose por box de varios lotes. Nunca se parsea aqui, ver src/lib/desgloseBox.ts.';
