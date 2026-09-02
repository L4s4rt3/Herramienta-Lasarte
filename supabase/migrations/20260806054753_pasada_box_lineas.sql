-- =============================================================================
-- MIGRACION: desglose por BOX de una pasada del calibrador
--
-- Encargo del dueño (06-08-2026, textual): "necesito algo para introducir los
-- lotes manualmente en el día... el martes echaron varios lotes en 1 y
-- necesito contabilizarlos todos junto con los box que se echaron de cada uno,
-- así sabemos cuántos kg se han echado de cada lote".
--
-- El calibrador registra UNA pasada por varios lotes y atribuye todo su kg al
-- primer código del nombre. El operario sí escribe el desglose ahí, en texto
-- libre ("30/07 - 46 B27/07,-7B -29/07-2 B -21/07-7 B", "22/07 22 BOX - 23/07
-- 43 BOX"), pero sin repartir nada. Cada fila de esta tabla es UNA de esas
-- partes: qué se echó y cuántos box.
--
-- GRANO: (pasada, posición). El orden lo fija `posicion` — a diferencia de
-- pasada_anotaciones (que usa created_at porque su reparto depende del orden
-- de tecleo), aquí el orden es solo de presentación: el reparto lo decide el
-- BOX, no la posición.
--
-- QUÉ NO GUARDA: los kg. Son DERIVADOS (regla del dueño: el peso del box solo
-- pondera y el total repartido es siempre el kg REAL de la pasada), y se
-- calculan en repartirPasadaPorBox (src/lib/desgloseBox.ts). Guardar kg aquí
-- los congelaría y se desincronizarían del calibrador al re-analizar el parte
-- — mismo criterio que el resto de estados derivados del proyecto.
--
-- EL MOTOR NO SABE NADA DE ESTA TABLA: conciliarKgProcesados
-- (src/lib/conciliacionKg.ts) no se toca. El desglose se inyecta ANTES de
-- llamarlo (useEntradasBascula.ts): la pasada desglosada se sustituye por
-- tantas pasadas sintéticas como líneas atribuibles, cada una con su código y
-- sus kg ya repartidos — igual de indistinguible para el motor que las
-- anotaciones de pasada_anotaciones.
--
-- RLS: mismo patrón "workspace compartido" del resto de tablas del proyecto
-- (ver 20260804150000_pasada_anotaciones.sql): SELECT para cualquier
-- autenticado, INSERT con user_id propio, UPDATE/DELETE del dueño o admin.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS antes de
-- recrear. NO SE APLICA AQUÍ: solo el archivo, pendiente de revisión y
-- aplicación manual. La app debe seguir funcionando sin ella (ver
-- esErrorTablaOColumnaInexistente: el fetch degrada a lista vacía y todo se
-- comporta EXACTAMENTE igual que hoy).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pasada_box_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  lote_dia_id UUID NOT NULL REFERENCES public.lotes_dia(id) ON DELETE CASCADE,
  -- Orden de presentación dentro de la pasada (1..n). El reparto NO depende de él.
  posicion INTEGER NOT NULL,
  -- 'lote'         → fruta de un lote real, por su código de 8 dígitos.
  -- 'precalibrado' → fruta del almacén PREC; el operario la nombra por la FECHA
  --                  en que se apartó. Si esa fecha casa con una re-entrada de
  --                  báscula se guarda además su código en lote_codigo.
  -- 'reciclaje'    → box de fruta ya contada que vuelve a línea: consume kg de
  --                  la pasada pero NO se atribuye a ningún lote (doble cuenta).
  tipo TEXT NOT NULL CHECK (tipo IN ('lote', 'precalibrado', 'reciclaje')),
  -- Código de 8 dígitos normalizado (Convención A, src/lib/loteCodigo.ts).
  lote_codigo TEXT NULL CHECK (lote_codigo IS NULL OR lote_codigo ~ '^\d{8}$'),
  -- Fecha en que se apartó el precalibrado, tal como la escribió el operario.
  prec_fecha DATE NULL,
  -- Box echados. NULL = el operario no lo escribió todavía: esa línea no
  -- recibe kg (nunca se le inventa un reparto), la UI lo reclama.
  box NUMERIC NULL CHECK (box IS NULL OR box >= 0),
  -- Regla del dueño: "siempre van a ser box grandes a no ser que se
  -- especifique lo contrario". grande = 350 kg brutos / 35 de tara (315 de
  -- fruta); pequeno = 230 / 30 (200 de fruta). Ver src/lib/desgloseBox.ts.
  box_tamano TEXT NOT NULL DEFAULT 'grande' CHECK (box_tamano IN ('grande', 'pequeno')),
  nota TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pasada_box_lineas_posicion_unique UNIQUE (lote_dia_id, posicion),
  -- Un lote se identifica por su código; el reciclaje no lleva ni código ni
  -- fecha; un precalibrado necesita al menos una de las dos cosas.
  CONSTRAINT pasada_box_lineas_identidad CHECK (
    (tipo = 'lote'         AND lote_codigo IS NOT NULL AND prec_fecha IS NULL)
    OR (tipo = 'precalibrado' AND (lote_codigo IS NOT NULL OR prec_fecha IS NOT NULL))
    OR (tipo = 'reciclaje'    AND lote_codigo IS NULL AND prec_fecha IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pasada_box_lineas_lote_dia ON public.pasada_box_lineas (lote_dia_id);
CREATE INDEX IF NOT EXISTS idx_pasada_box_lineas_codigo   ON public.pasada_box_lineas (lote_codigo) WHERE lote_codigo IS NOT NULL;

ALTER TABLE public.pasada_box_lineas ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pasada_box_lineas TO authenticated;

DROP POLICY IF EXISTS "pasada_box_lineas_select_all_authenticated" ON public.pasada_box_lineas;
DROP POLICY IF EXISTS "pasada_box_lineas_insert_own"               ON public.pasada_box_lineas;
DROP POLICY IF EXISTS "pasada_box_lineas_update_own_or_admin"      ON public.pasada_box_lineas;
DROP POLICY IF EXISTS "pasada_box_lineas_delete_own_or_admin"      ON public.pasada_box_lineas;

CREATE POLICY "pasada_box_lineas_select_all_authenticated"
  ON public.pasada_box_lineas FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "pasada_box_lineas_insert_own"
  ON public.pasada_box_lineas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pasada_box_lineas_update_own_or_admin"
  ON public.pasada_box_lineas FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "pasada_box_lineas_delete_own_or_admin"
  ON public.pasada_box_lineas FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.pasada_box_lineas IS
  'Desglose manual de una pasada del calibrador en los varios lotes que se echaron en ella, con los BOX de cada uno (encargo del dueño 06-08-2026). Los kg NO se guardan: se derivan repartiendo el kg REAL de la pasada en proporción a box × peso del box (repartirPasadaPorBox, src/lib/desgloseBox.ts) y se inyectan en el motor de conciliación como pasadas sintéticas desde useEntradasBascula.ts.';
COMMENT ON COLUMN public.pasada_box_lineas.box IS
  'Box echados de esta línea. NULL = todavía sin indicar: la línea no recibe kg (jamás se le inventa un reparto).';
COMMENT ON COLUMN public.pasada_box_lineas.box_tamano IS
  'grande (por defecto: 350 kg brutos, 35 de tara, 315 de fruta) o pequeno (230 / 30 / 200). Solo PONDERA el reparto: el total repartido siempre es el kg real de la pasada.';
COMMENT ON COLUMN public.pasada_box_lineas.prec_fecha IS
  'Fecha en que se apartó el precalibrado ("22/07" del nombre de la pasada). Si casa con una re-entrada de báscula de ese día, lote_codigo lleva su código y la línea atribuye kg; si no casa, la línea se lleva sus kg sin atribuirlos a nadie (no se inventa el cruce).';
