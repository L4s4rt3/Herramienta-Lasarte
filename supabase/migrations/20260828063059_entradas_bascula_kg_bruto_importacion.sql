-- Reconstruida el 02-09-2026 desde la base (information_schema + comentario de
-- columna): se aplicó por el MCP el 28-08 (commit "fix(entradas): la
-- importacion entra por su NETO, no por la bascula") y nunca llegó al repo.
--
-- La importación (ERP tipo_entrada 21) pesa en báscula CON cartones y palets;
-- la fruta de verdad es el neto del albarán. kg_entrada pasa a llevar el neto
-- y aquí se guarda el bruto de báscula para poder enseñar ambos.

alter table public.entradas_bascula
  add column if not exists kg_bruto_bascula numeric;

comment on column public.entradas_bascula.kg_bruto_bascula is
  'Solo importaciones (ERP tipo_entrada 21): el kilo de báscula CON cartones y palets. kg_entrada lleva la fruta neta del albarán. NULL en entradas nacionales (allí báscula = neto). Si kg_entrada = kg_bruto_bascula, la importación llegó sin neto en el albarán (sin valorar).';
