-- Vistas agregadas sobre lote_clasificacion (acantilado de rendimiento, 2026-07-17)
--
-- CONTEXTO: hoy el dueño importa ~1.000 informes de lote (≈300 filas de
-- clasificación por informe cada uno): lote_clasificacion pasa de ~9.000 a
-- ~300.000 filas. Dos consumidores se bajaban HOY la tabla completa (o un
-- rango de fechas amplio) al navegador con fetchAllRows, lo que con 300k
-- filas supone ~300 peticiones paginadas por carga:
--   - src/hooks/useMermaLote.ts: solo necesita, por lote, si existe algún
--     "Informe LOTE" (presencia de cualquier fila) y la suma de kg de la(s)
--     clase(s) "Podrido" — nunca usa fecha ni el resto de columnas.
--   - src/hooks/useProductores.ts: reconstruye el dossier de cada productor
--     (kg por grupo de destino/clase/tamaño, matriz calibre×clase) para un
--     rango de fechas — necesita (productor, grupo_destino, clase, tamano,
--     fecha) con sum(peso_kg)/sum(piezas)/sum(cartons); no usa el resto de
--     columnas (producto, calidad, pct_*, lote_codigo...) para esos cálculos.
--
-- Ambas vistas usan security_invoker = true (Postgres 15+, confirmado
-- PG17 en este proyecto) para que la RLS de lote_clasificacion se aplique
-- con los permisos del usuario que consulta la VISTA, no con los del dueño
-- de la vista — sin esto una vista normal se ejecutaría con los privilegios
-- de quien la creó (postgres), saltándose la RLS de la tabla base. La
-- policy de SELECT de lote_clasificacion ya es "auth.role() = 'authenticated'"
-- (sin filtro por user_id), así que basta con heredarla + GRANT SELECT a
-- authenticated sobre la vista.
--
-- Fallback: los hooks consumidores intentan primero la vista y, si todavía
-- no existe (esta migración no aplicada), caen al fetch completo de
-- lote_clasificacion de siempre (mismo resultado, sin romper la app a mitad
-- del import de hoy) — ver esErrorTablaOColumnaInexistente en
-- src/lib/productoresCanonicos.ts.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. lote_clasificacion_podrido_agg — para useMermaLote.ts
--
-- Agrupa SOLO por lote8 (primer grupo de 8 dígitos de lote_codigo, MISMA
-- expresión que normalizarLoteCodigo en src/lib/loteCodigo.ts: no se usa
-- lote_codigo_base porque computeMermaLotes/mermaLote.ts nunca la consulta,
-- solo normaliza lote_codigo — usar otra columna aquí daría un resultado
-- distinto al actual). NO se agrupa por fecha: el consumidor no la necesita
-- para este cálculo (evita explotar el número de filas por nada), así que
-- esta vista se queda del orden de "un lote" en vez de "un lote × un día".
-- Filas sin 8 dígitos reconocibles en lote_codigo se excluyen (igual que
-- computeMermaLotes las descarta con `if (!lote) continue`).
create view lote_clasificacion_podrido_agg
with (security_invoker = true)
as
select
  substring(lote_codigo from '\d{8}') as lote8,
  sum(peso_kg) as kg_total,
  sum(peso_kg) filter (where clase ilike '%podrido%') as kg_podrido,
  count(*) as n_filas
from lote_clasificacion
where substring(lote_codigo from '\d{8}') is not null
group by substring(lote_codigo from '\d{8}');

grant select on lote_clasificacion_podrido_agg to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. lote_clasificacion_productor_agg — para useProductores.ts
--
-- Granularidad mínima que useProductores necesita para reconstruir sus
-- dossiers por productor en un rango de fechas: (productor, grupo_destino,
-- clase, tamano, fecha) con las tres sumas que usa (peso_kg, piezas,
-- cartons). El resto de columnas de lote_clasificacion (producto, calidad,
-- lote_codigo, pct_*...) no entran en ningún cálculo de useProductores, así
-- que no hace falta traerlas ni agruparlas.
create view lote_clasificacion_productor_agg
with (security_invoker = true)
as
select
  productor,
  grupo_destino,
  clase,
  tamano,
  fecha,
  sum(peso_kg) as peso_kg,
  sum(piezas) as piezas,
  sum(cartons) as cartons,
  count(*) as n_filas
from lote_clasificacion
group by productor, grupo_destino, clase, tamano, fecha;

grant select on lote_clasificacion_productor_agg to authenticated;
