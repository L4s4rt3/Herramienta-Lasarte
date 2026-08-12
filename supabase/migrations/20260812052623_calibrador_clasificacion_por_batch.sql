-- El grano real de la clasificacion es la PASADA (batch_id), no el lote.
--
-- Por que: Batch.BatchName es TEXTO LIBRE que teclea el operario, y escribe
-- cosas como "26051102+ 6 BOX DE RECICLAJE", "PREC --26073101" o incluso
-- "22/07 22 BOX - 23/07 43 BOX" sin ningun codigo. Exigir 8 digitos exactos
-- descartaba entre el 25% y el 100% de las pasadas de cada dia (el 4 y el 6 de
-- agosto: todas), y por eso los totales salian al 55-65% del real.
--
-- Ahora: batch_id manda (siempre existe), y `lote` es un atributo que puede ser
-- NULL. Los kilos de una pasada sin lote legible cuentan igual para el total del
-- dia; simplemente no se pueden atribuir a un productor.

alter table public.calibrador_clasificacion drop constraint if exists calibrador_clasificacion_lote_fkey;
alter table public.calibrador_clasificacion drop constraint if exists calibrador_clasificacion_pkey;
alter table public.calibrador_clasificacion alter column lote drop not null;
alter table public.calibrador_clasificacion alter column batch_id drop default;
alter table public.calibrador_clasificacion
  add primary key (batch_id, producto, calidad, clase, tamano);

create index if not exists calibrador_clasificacion_lote_idx on public.calibrador_clasificacion (lote);

comment on column public.calibrador_clasificacion.lote is
  'Codigo de lote de entrada (AAMMDDNN) extraido del BatchName, que es texto libre. NULL cuando el operario no escribio ninguno: esos kilos cuentan para el total del dia pero no se pueden atribuir a un productor.';

-- La fecha de produccion vive en calibrador_batch.inicio; calibrador_informe
-- solo cubre los lotes con informe DOCX. Para agregar por dia hay que usar
-- calibrador_batch, no calibrador_informe.
comment on table public.calibrador_clasificacion is
  'Detalle del calibrador por PASADA. Para totales del dia: unir con calibrador_batch por batch_id y agrupar por date(inicio). Para atribuir a productor: unir lote con entradas_bascula (solo las filas con lote no nulo).';
