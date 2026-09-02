-- Modo del cierre manual de un lote (entradas_bascula.cerrado_at, migración
-- 20260715090000_entradas_bascula_cierre_manual.sql): el cierre por sí solo no
-- dice SI el hueco báscula−calibrador es pérdida real o simplemente que el
-- procesado del lote no consta bajo su código.
--
-- Evidencia verificada en BD (jul-2026): de 174 lotes activos antiguos, 53
-- tienen procesado PARCIAL bajo su código (cerrarlos como pérdida real es
-- correcto), pero 121 lotes (2,48 M kg) no tienen NINGÚN registro de
-- procesado bajo su código — pasaron bajo códigos compuestos que acreditan a
-- OTRO lote, o se vendieron sin procesar en la central. Cerrar esos 121 con
-- el modo "pérdida real" (comportamiento original de cerrado_at, ver
-- 20260715090000) meteria 2,5 M kg de merma/podrido FICTICIA en el módulo de
-- mermas y en Económico.
--
-- 'con_analisis' = comportamiento original: el hueco se clasifica como merma
--   natural + podrido pre-calibrador (pérdida real). El lote SÍ se procesó,
--   solo que no llegó al umbral normal.
-- 'sin_registro' = el procesado del lote no consta bajo su código (códigos
--   compuestos que acreditan a otro lote, venta sin procesar…): el lote sale
--   del stock igual (ya no se va a procesar más bajo este código) pero se
--   EXCLUYE por completo del análisis de mermas/podrido/forfait — no se
--   inventa una pérdida que no se puede sostener con datos.
--
-- NULL en esta columna con cerrado_at relleno (cierres anteriores a esta
-- migración) se trata como 'con_analisis' en la lógica de la app (ver
-- src/lib/mermaLote.ts): mismo comportamiento que tenían antes de que
-- existiera esta distinción, no se retro-reclasifican solos.
--
-- La columna en sí solo tiene sentido junto a cerrado_at relleno (lote
-- abierto = cierre_modo también NULL); no se fuerza con un CHECK cruzado por
-- simplicidad, la app siempre escribe/lee ambos juntos.
--
-- Idempotente: se puede volver a aplicar sin error.
alter table public.entradas_bascula
  add column if not exists cierre_modo text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entradas_bascula_cierre_modo_check'
      and conrelid = 'public.entradas_bascula'::regclass
  ) then
    alter table public.entradas_bascula
      add constraint entradas_bascula_cierre_modo_check
      check (cierre_modo in ('con_analisis', 'sin_registro'));
  end if;
end $$;

comment on column public.entradas_bascula.cierre_modo is
  'Modo del cierre manual (solo tiene sentido con cerrado_at relleno; NULL = lote abierto o cierre anterior a esta migración, tratado como con_analisis por compat). con_analisis = el hueco báscula-calibrador se clasifica como merma natural + podrido pre-calibrador (pérdida real, comportamiento original de cerrado_at). sin_registro = el procesado del lote no consta bajo su código (códigos compuestos que acreditan a otro lote, venta sin procesar): el lote sale del stock igual pero se EXCLUYE por completo de mermas/podrido/forfait (ver src/lib/mermaLote.ts), sin inventar una pérdida ficticia.';
