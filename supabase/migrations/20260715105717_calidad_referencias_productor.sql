-- =============================================================================
-- MIGRACION: Referencias de podrido REAL por productor (informe del calibrador
-- "Totales de Tamaños, Clase y Calidad por Variedad", filtrado por productor)
--
-- El calibrador puede exportar, para un productor y rango de fechas
-- concretos, el desglose de kg por Clase (incluida la clase "Podrido") por
-- Variedad. src/lib/calidadReferencias.ts parsea ese Excel
-- (parseInformeTamanosClases) y src/pages/EconomicoFruta.tsx lo importa aquí
-- para que el simulador de forfait tenga, además del % de pérdida medido de
-- los lotes YA procesados (src/lib/forfait.ts) y del podrido no pesado
-- ASUMIDO (PCT_PODRIDO_NO_PESADO_DEFECTO), un tercer dato: el % de podrido
-- REAL que el propio calibrador midió para ese productor/variedad, aunque el
-- dueño todavía no tenga lotes de ese productor procesados en la campaña
-- actual.
--
-- Cada fila es una referencia (productor, variedad) -> kg_total/kg_podrido
-- de UN informe importado; se sustituye (upsert por productor_nombre +
-- variedad) si se vuelve a importar un informe más reciente del mismo
-- productor/variedad.
--
-- productor_id es NULLABLE y aparte de productor_nombre (que es SIEMPRE el
-- texto tal cual trae el informe, "Nombre del Productor es 'X'"): el
-- productor del informe puede no casar todavía con el catálogo canónico
-- (calidad_productores, ver 20260714090000_productores_canonicos.sql) — la
-- UI de importación intenta resolverlo por normalizarTexto contra el
-- catálogo/alias y, si casa, guarda el id; si no, se importa igual con
-- productor_id NULL y se puede vincular más tarde (mismo patrón que
-- entradas_bascula.productor_id / lotes_dia.productor_id: no bloquea el
-- import, degrada).
--
-- RLS: dataset compartido del equipo (mismo patrón que
-- 20260714120000_limpieza_box.sql / 20260714090000_productores_canonicos.sql):
-- SELECT para cualquier autenticado, INSERT con user_id propio, UPDATE/DELETE
-- del dueño o admin.
--
-- Idempotente: se puede volver a aplicar sin error.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.calidad_referencias_productor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Vínculo con el catálogo canónico si se resolvió (por nombre exacto
  -- normalizado o alias aprendido); NULL si el productor del informe no casa
  -- todavía con ningún productor del catálogo. ON DELETE SET NULL: si se
  -- borra el productor del catálogo, la referencia no se pierde, solo queda
  -- desvinculada (mismo criterio que entradas_bascula.productor_id).
  productor_id UUID NULL REFERENCES public.calidad_productores(id) ON DELETE SET NULL,
  -- Nombre tal cual aparece en el filtro del informe ("Nombre del Productor
  -- es 'X'"): SIEMPRE relleno, es la fuente de verdad legible aunque
  -- productor_id sea NULL o el catálogo cambie de nombre.
  productor_nombre TEXT NOT NULL,
  -- Variedad de la sección del informe ("Variedad: X"); NULL si el informe no
  -- desglosa por variedad (caso no visto en los 2 archivos reales verificados,
  -- pero se deja nullable por si el calibrador exporta alguna vez sin ese
  -- filtro).
  variedad TEXT NULL,
  kg_total NUMERIC NOT NULL CHECK (kg_total > 0),
  kg_podrido NUMERIC NOT NULL CHECK (kg_podrido >= 0),
  -- Origen del dato: por ahora siempre el informe de tamaños/clase/calidad
  -- del calibrador; el default deja la puerta abierta a otras fuentes futuras
  -- de referencia de podrido real sin tener que migrar de nuevo.
  fuente TEXT NOT NULL DEFAULT 'informe_calibrador',
  -- Rango de fechas que cubría el informe importado (el filtro "Fecha de
  -- Lote es entre X y Y" de la cabecera): informativo, para saber de qué
  -- periodo es la referencia. NULL si no se pudo extraer del Excel.
  rango_desde DATE NULL,
  rango_hasta DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  -- Como mucho una referencia vigente por productor (texto crudo) + variedad:
  -- volver a importar el mismo productor/variedad SUSTITUYE la referencia
  -- anterior (upsert onConflict), no acumula histórico de imports.
  CONSTRAINT calidad_referencias_productor_nombre_variedad_unique UNIQUE (productor_nombre, variedad)
);

CREATE INDEX IF NOT EXISTS idx_calidad_referencias_productor_productor_id
  ON public.calidad_referencias_productor (productor_id);

ALTER TABLE public.calidad_referencias_productor ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calidad_referencias_productor TO authenticated;

DROP POLICY IF EXISTS "calidad_referencias_productor_select_all_authenticated" ON public.calidad_referencias_productor;
DROP POLICY IF EXISTS "calidad_referencias_productor_insert_own"               ON public.calidad_referencias_productor;
DROP POLICY IF EXISTS "calidad_referencias_productor_update_own_or_admin"      ON public.calidad_referencias_productor;
DROP POLICY IF EXISTS "calidad_referencias_productor_delete_own_or_admin"      ON public.calidad_referencias_productor;

CREATE POLICY "calidad_referencias_productor_select_all_authenticated"
  ON public.calidad_referencias_productor FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "calidad_referencias_productor_insert_own"
  ON public.calidad_referencias_productor FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "calidad_referencias_productor_update_own_or_admin"
  ON public.calidad_referencias_productor FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "calidad_referencias_productor_delete_own_or_admin"
  ON public.calidad_referencias_productor FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
