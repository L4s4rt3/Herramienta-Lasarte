-- Cierre manual de un lote (decisión del dueño, 2026-07-15): antes del
-- calibrador también se quita podrido en un contenedor que NO se pesa a
-- diario, así que hay lotes que se quedan a ~94% para siempre (el hueco es
-- ese podrido no pesado + la merma natural) y hoy quedan "parcial" eternamente
-- sin que nadie los pueda cerrar. `cerrado_at` deja constancia de que el dueño
-- ha dado el lote por terminado: ya no se va a procesar más, y el resto que
-- quedaba en cámara se reclasifica en el módulo de mermas como merma natural +
-- podrido pre-calibrador (ver src/lib/mermaLote.ts) en vez de seguir contando
-- como stock (ver buildStockEntradas / estadoLotePorProcesado en
-- src/lib/entradasBascula.ts). NULL = lote abierto (comportamiento normal,
-- sin cambios); se puede reabrir en cualquier momento volviendo a poner NULL.
--
-- RLS: no hace falta tocar nada. La política de UPDATE de entradas_bascula
-- (entradas_bascula_update_authenticated, ver
-- 20260713090000_create_entradas_bascula.sql) ya permite a cualquier
-- autenticado actualizar cualquier fila, así que cubre también esta columna.
--
-- Idempotente: se puede volver a aplicar sin error.
alter table public.entradas_bascula
  add column if not exists cerrado_at timestamptz null;

comment on column public.entradas_bascula.cerrado_at is
  'Cierre manual del lote (decision del dueño, 2026-07-15): NULL = lote abierto (normal, sigue en curso). Cuando se rellena, el lote se da por terminado aunque no haya llegado al umbral normal de procesado: el resto que quedaba en cámara se reclasifica como merma natural + podrido pre-calibrador (ver src/lib/mermaLote.ts) y deja de contar como stock en cámara (ver src/lib/entradasBascula.ts). Se puede reabrir en cualquier momento volviendo a poner esta columna a NULL.';
