-- Código de lote canónico (AAMMDDNN) en palets_dia: desbloquea la
-- trazabilidad lote -> palet -> cliente.
--
-- Los partes diarios normales (captura manual día a día del calibrador/
-- envasado, ver src/pages/PartesList.tsx y el resto del flujo de
-- partes_diarios) NUNCA traen este dato: esa fuente registra el palet
-- (cliente, kg, cajas...) pero no el lote del que salió. Por eso esta
-- columna es y seguirá siendo NULL para todos los palets capturados a mano.
--
-- Solo el export del programa de gestión de palets (histórico de campaña,
-- archivo real "palets 1sep 14 jul.xlsx", ver src/lib/historicoPalets.ts /
-- src/hooks/useHistoricoImport.ts) trae el lote de cada palet: columna
-- "Lote" en formato NN+AAMMDD (p.ej. "01251024" = lote 01 del 24/10/2025),
-- que se reordena al código canónico AAMMDD+NN ("25102401", mismo formato
-- que entradas_bascula.lote / lotes_dia.lote_codigo, ver
-- src/lib/loteCodigo.ts) antes de guardarlo aquí vía
-- convertirLotePaletACanonico().
--
-- Con esta columna, src/hooks/useTrazabilidadLote.ts puede cruzar
-- palets_dia.lote_codigo = <código canónico del lote> y mostrar, para un
-- lote dado, en cuántos palets acabó y a qué cliente(s) fueron (paso
-- "Expedición" de la ficha en src/pages/TrazabilidadLote.tsx).
--
-- Idempotente: se puede volver a aplicar sin error (IF NOT EXISTS / COMMENT
-- ON es siempre reemplazable).
alter table public.palets_dia
  add column if not exists lote_codigo text null;

create index if not exists palets_dia_lote_codigo_idx on public.palets_dia (lote_codigo);

comment on column public.palets_dia.lote_codigo is
  'Código de lote canónico (AAMMDDNN) del palet. SOLO se rellena en palets importados desde el histórico de campaña (export del programa de palets, ver src/lib/historicoPalets.ts); los partes diarios capturados a mano no registran el lote de cada palet, así que para esas filas queda NULL. Permite trazabilidad lote -> palet -> cliente (ver src/hooks/useTrazabilidadLote.ts y el paso "Expedición" en src/pages/TrazabilidadLote.tsx).';
