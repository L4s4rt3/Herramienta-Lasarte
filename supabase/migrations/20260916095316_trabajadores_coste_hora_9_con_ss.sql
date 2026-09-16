-- Coste hora de personal = 9,00 €/h CON Seguridad Social incluida.
--
-- POR QUÉ. Beatriz (administración) acordó con Vadim el 16-09-2026 usar un coste
-- medio de personal de 9 €/h con la Seguridad Social ya dentro, para que las
-- fichas de coste de confección y el coste por producto de la app digan lo mismo.
-- Hasta hoy trabajadores.coste_hora era el salario BRUTO (8,00-10,80 en 31 de 62
-- fichas, vacío en las otras 31) y el CMV por producto le sumaba un 35 % de SS
-- (PCT_SEGURIDAD_SOCIAL_DEFECTO) que ahora pasa a 0 en el código.
--
-- QUÉ HACE. Guarda los valores anteriores en una tabla de respaldo y pone 9,00
-- a TODAS las fichas (también a las que estaban vacías: así nadie queda "sin
-- coste" y el coste medio de los presentes sin ficha deja de hacer falta).
-- Reversible: UPDATE trabajadores t SET coste_hora = b.coste_hora_anterior
--             FROM trabajadores_coste_hora_20260916 b WHERE b.id = t.id;
--
-- Aplicada con el MCP de Supabase el 16-09-2026 (versión 20260916095316).

create table if not exists public.trabajadores_coste_hora_20260916 (
  id uuid primary key,
  nombre text,
  coste_hora_anterior numeric,
  guardado_en timestamptz not null default now()
);
comment on table public.trabajadores_coste_hora_20260916 is
  'Respaldo de trabajadores.coste_hora (salario bruto/h) antes de fijar 9,00 €/h con SS incluida el 16-09-2026 (Beatriz). Solo lectura; sirve para revertir.';

insert into public.trabajadores_coste_hora_20260916 (id, nombre, coste_hora_anterior)
select id, nombre, coste_hora from public.trabajadores
on conflict (id) do nothing;

alter table public.trabajadores_coste_hora_20260916 enable row level security;

update public.trabajadores set coste_hora = 9.00;

comment on column public.trabajadores.coste_hora is
  'Coste hora de la persona para la empresa, €/h CON Seguridad Social incluida (9,00 medio acordado con Beatriz el 16-09-2026). Antes del 16-09 era salario bruto y el CMV le sumaba un 35 %.';
