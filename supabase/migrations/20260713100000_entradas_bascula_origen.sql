-- Origen de cada entrada: export normal de la báscula, o ajuste inicial
-- reconstruido desde el informe de stock (los lotes se empezaron a contar
-- a medias el 21-abr-2026 y el arranque necesita sembrar el stock real).
alter table public.entradas_bascula
  add column origen text not null default 'bascula';
