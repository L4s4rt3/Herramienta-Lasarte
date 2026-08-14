-- El batch_id de cada informe DOCX, para poder atarlo a sus lineas desde SQL.
--
-- POR QUE. `calibrador_clasificacion` guarda (batch_id, lote) pero NO la fecha:
-- la del volcado sale de `calibrador_batch.inicio`, y la de un DOCX solo estaba
-- en `calibrador_informe.fecha`, atada a la pasada por (lote, comienzo). El
-- puente entre las dos —batchIdDeDocx— es una funcion hash de JavaScript, asi
-- que desde SQL no habia forma de saber de que dia son las lineas de un DOCX.
--
-- Sin esto, la RPC del aprovechamiento no puede filtrar por fecha lo que venga
-- de informes, y un lote que entra en linea dos dias distintos tiene dos
-- informes que no se pueden separar solo por el lote.
--
-- Lo escribe subirInforme() en cada subida. Se rellena para lo que ya hay con
-- scripts/backfill-batch-id-informes.mjs, que calcula el mismo hash.
alter table public.calibrador_informe
  add column if not exists batch_id integer;

comment on column public.calibrador_informe.batch_id is
  'batch_id NEGATIVO de las filas de calibrador_clasificacion de esta pasada (batchIdDeDocx del lote y su comienzo). Es el unico puente entre un informe DOCX y sus lineas.';

create index if not exists calibrador_informe_batch_id_idx
  on public.calibrador_informe (batch_id);
