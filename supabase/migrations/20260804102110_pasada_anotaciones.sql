-- =============================================================================
-- MIGRACION: anotaciones a posteriori de una pasada del calibrador
--
-- Encargo del dueño (04-08-2026, diseño ya acordado): mecanismo para anotar a
-- posteriori qué MÁS se echó en una pasada del calibrador — lotes o
-- precalibrados que planta metió a la línea sin escribirlos en el código de
-- la pasada (lotes_dia.lote_codigo). La cola de "excesos sin colocar" de la
-- conciliación (ver src/lib/conciliacionKg.ts) es la lista de trabajo: cada
-- kg de exceso que no encuentra receptor es candidato a que dirección
-- recuerde/averigüe qué se echó de más y lo anote aquí.
--
-- GRANO: fila de lotes_dia (una pasada física del calibrador). Cada pasada
-- puede tener varios códigos extra anotados — una fila por código, única por
-- (pasada, código) para no duplicar la misma anotación dos veces.
--
-- EL MOTOR NO SABE NADA DE ESTA TABLA: conciliarKgProcesados
-- (src/lib/conciliacionKg.ts) no se toca. La anotación se inyecta ANTES de
-- llamar al motor, en useEntradasBascula.ts al construir las `pasadas`: se
-- añade al lote_codigo EFECTIVO de la fila el código extra (separador " - "),
-- exactamente como si el calibrador lo hubiera escrito él mismo — así el
-- reparto nombrado de la fase 1 (el principal se llena primero, el resto
-- según el orden en que se anotó, JAMÁS FIFO — regla del dueño) sale gratis
-- sin duplicar ninguna fórmula. Ver src/lib/pasadaAnotaciones.ts
-- (construirLoteCodigoEfectivo).
--
-- ORDEN: esta tabla NO tiene columna de posición explícita a propósito (el
-- encargo pidió exactamente id/user_id/lote_dia_id/codigo_extra/nota/
-- created_at) — el orden de prioridad se conserva con `created_at`
-- ascendente; el caller inserta los códigos de una misma pasada UNO A UNO
-- (nunca en un solo INSERT de varias filas) para garantizar timestamps
-- crecientes de verdad.
--
-- RLS: mismo patrón "workspace compartido" que el resto de tablas del
-- proyecto (ver 20260508120000_shared_workspace_rls.sql y
-- 20260714120000_limpieza_box.sql, la migración de tabla nueva más reciente
-- con este patrón): SELECT para cualquier autenticado, INSERT con user_id
-- propio, UPDATE/DELETE del dueño o admin. En la práctica solo admin ve el
-- botón en la UI (mismo gating que ConfirmarLotesEnCamaraDialog.tsx), pero la
-- RLS en sí no distingue roles más allá de "authenticated" — igual que el
-- resto de tablas de este dataset compartido.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS antes de
-- recrear. NO SE APLICA AQUÍ: solo el archivo, pendiente de revisión y
-- aplicación manual (igual que las migraciones recientes de
-- camara_confirmada/productores_autocreacion) — la app debe seguir
-- funcionando sin romperse mientras esto no esté aplicado (ver
-- esErrorTablaOColumnaInexistente en useEntradasBascula.ts: el fetch degrada
-- a lista vacía, el motor se comporta EXACTAMENTE igual que hoy).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pasada_anotaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  lote_dia_id UUID NOT NULL REFERENCES public.lotes_dia(id) ON DELETE CASCADE,
  -- Código de 8 dígitos normalizado (Convención A, ver normalizarLoteCodigo
  -- en src/lib/loteCodigo.ts): el lote o precalibrado que planta metió de más
  -- en esta pasada sin escribirlo en el código del calibrador.
  codigo_extra TEXT NOT NULL CHECK (codigo_extra ~ '^\d{8}$'),
  nota TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un mismo código no se anota dos veces para la misma pasada.
  CONSTRAINT pasada_anotaciones_lote_dia_codigo_unique UNIQUE (lote_dia_id, codigo_extra)
);

CREATE INDEX IF NOT EXISTS idx_pasada_anotaciones_lote_dia ON public.pasada_anotaciones (lote_dia_id);

ALTER TABLE public.pasada_anotaciones ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pasada_anotaciones TO authenticated;

DROP POLICY IF EXISTS "pasada_anotaciones_select_all_authenticated" ON public.pasada_anotaciones;
DROP POLICY IF EXISTS "pasada_anotaciones_insert_own"               ON public.pasada_anotaciones;
DROP POLICY IF EXISTS "pasada_anotaciones_update_own_or_admin"      ON public.pasada_anotaciones;
DROP POLICY IF EXISTS "pasada_anotaciones_delete_own_or_admin"      ON public.pasada_anotaciones;

CREATE POLICY "pasada_anotaciones_select_all_authenticated"
  ON public.pasada_anotaciones FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "pasada_anotaciones_insert_own"
  ON public.pasada_anotaciones FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pasada_anotaciones_update_own_or_admin"
  ON public.pasada_anotaciones FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "pasada_anotaciones_delete_own_or_admin"
  ON public.pasada_anotaciones FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.pasada_anotaciones IS
  'Anotación a posteriori de qué más se echó en una pasada del calibrador (lotes/precalibrados no escritos en el código de lotes_dia.lote_codigo). Se inyecta en el lote_codigo EFECTIVO antes del motor de conciliación (construirLoteCodigoEfectivo en src/lib/pasadaAnotaciones.ts, llamado desde useEntradasBascula.ts) — conciliarKgProcesados los trata exactamente igual que si vinieran ya escritos.';
COMMENT ON COLUMN public.pasada_anotaciones.codigo_extra IS
  'Código de 8 dígitos (Convención A, normalizarLoteCodigo) del lote/precalibrado añadido a la pasada.';
COMMENT ON COLUMN public.pasada_anotaciones.created_at IS
  'Determina el ORDEN de prioridad del reparto nombrado ("el resto según indicación, jamás FIFO"): se inserta una fila a la vez para que el orden de created_at refleje fielmente el orden en que dirección tecleó los códigos.';
