-- De donde salieron los kilos del calibrador que lleva el parte.
--
-- POR QUE HACE FALTA. Los kilos del calibrador llegan por dos vias con distinta
-- calidad, y hasta ahora no habia forma de saber cual de las dos escribio el
-- numero que hay en el parte:
--
--   'sql'   volcado del Sizer (zip con lotes.csv + clasificacion.csv). Trae
--           TODAS las pasadas de cada lote: es la verdad completa.
--   'docx'  informes de lote que el Sizer manda solos al receptor segun cierra
--           lotes. De un lote con varias pasadas el DOCX solo ve la ULTIMA, asi
--           que puede quedarse corto. Medido sobre la campaña: 37 de 1.271
--           pares (lote, dia) tienen mas de una pasada — un 2,9%.
--
-- El volcado no llega todos los dias (hay que exportarlo a mano desde el visor)
-- y el DOCX si. Sin esta columna, el parte del dia que solo tiene DOCX o no se
-- creaba, o se creaba con un numero provisional que ya nadie podia corregir:
-- crear-parte-diario.mjs respeta cualquier valor distinto de cero porque no
-- puede distinguir un dato suyo de uno tecleado por el operario.
--
-- Con la marca puesta, la regla es clara: un valor 'docx' lo puede pisar el
-- volcado SQL cuando llegue; uno escrito a mano (columna a NULL) no se toca
-- jamas.
alter table public.partes_diarios
  add column if not exists origen_calibrador text
    check (origen_calibrador in ('sql', 'docx'));

comment on column public.partes_diarios.origen_calibrador is
  'De donde salen kg_produccion_calibrador y kg_mujeres_calibrador: sql = volcado completo del Sizer; docx = informes de lote (provisional, solo la ultima pasada de cada lote); NULL = escrito a mano o anterior a esta columna.';

-- Los partes de antes se quedan a NULL A PROPOSITO. No todos vienen del volcado:
-- los anteriores al 12-08-2026 los rellenó el análisis de los informes que el
-- operario subía al parte. Marcarlos 'sql' seria afirmar algo que no consta, y
-- NULL ya significa lo unico que importa aqui: nadie los pisa.
