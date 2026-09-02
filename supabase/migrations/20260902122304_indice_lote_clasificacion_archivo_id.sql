-- Índice que faltaba en lote_clasificacion.archivo_id (02-09-2026).
--
-- lote_clasificacion.archivo_id referencia partes_archivos(id) con
-- ON DELETE SET NULL: cada DELETE en partes_archivos tiene que buscar en
-- lote_clasificacion las filas que apuntan al archivo, y sin índice eso es un
-- recorrido completo de 259.000 filas por cada fila borrada. Se descubrió
-- investigando un "canceling statement due to statement timeout" al rehacer los
-- informes del parte (02-09 a las 07:10, coincidiendo con el análisis del
-- parte que escribe lote_clasificacion): el índice acorta la comprobación de la
-- FK; el reintento y el orden fila→fichero de generar-informes-parte.mjs y
-- generar-gstock-erp.mjs cubren el bloqueo.

create index if not exists lote_clasificacion_archivo_id_idx
  on public.lote_clasificacion (archivo_id)
  where archivo_id is not null;
