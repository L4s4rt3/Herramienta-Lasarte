-- Conciliación con el informe de stock de la báscula: kg a descontar del
-- stock calculado (entrada - procesado). Cubre el procesado que ocurrió antes
-- de que la herramienta tuviera partes/lotes registrados. Negativo = añade.
alter table public.entradas_bascula
  add column kg_ajuste_stock numeric not null default 0;
