-- =============================================================================
-- MIGRACION: Identidad canónica de productores
--
-- Promociona calidad_productores (hasta ahora solo usada para
-- calidad_lotes.productor_finca_id) a catálogo GLOBAL de productores, y añade
-- una capa de alias (productores_alias, mismo patrón que trabajadores_alias /
-- src/hooks/useTrabajadoresAlias.ts) para resolver el productor, que hoy es
-- texto libre en 3 sitios sin FK común:
--   - entradas_bascula.agricultor
--   - lotes_dia.productor
--   - calidad_lotes.productor_finca_nombre (ya tenía productor_finca_id)
--
-- Decisiones del dueño:
--   1. calidad_productores pasa a ser el catálogo global (no se crea tabla nueva).
--   2. El backfill automático de esta migración SOLO liga coincidencias EXACTAS
--      tras normalizar (mayúsculas/tildes/espacios). Todo lo demás (nombres
--      parecidos pero no idénticos) queda para revisión manual desde la cola
--      de "nombres sin vincular" (src/hooks/useProductoresCatalogo.ts,
--      sección en src/pages/Productores.tsx visible solo para admin).
--
-- Idempotente: se puede volver a aplicar sin duplicar catálogo/alias ni pisar
-- vínculos ya resueltos (ON CONFLICT DO NOTHING / solo se tocan filas con
-- productor_id o productor_finca_id todavía NULL).
-- =============================================================================

-- ─── 1. Función de normalización ────────────────────────────────────────────
-- ESPEJO de normalizarTexto(valor, {trim:true}) en src/lib/format.ts:
-- minúsculas + NFD sin marcas diacríticas + trim + espacios colapsados. SQL no
-- tiene NFD/strip-diacritics nativo sin la extensión unaccent, así que aquí se
-- aproxima con translate() sobre el set de diacríticos español habitual
-- (vocales con tilde/diéresis, ñ, ç). Si cambia normalizarTexto en
-- src/lib/format.ts (p. ej. para cubrir más diacríticos), replicar el cambio
-- aquí también — ver el comentario espejo en ese archivo.
CREATE OR REPLACE FUNCTION public.normalizar_nombre_productor(nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(
    regexp_replace(
      translate(
        lower(coalesce(nombre, '')),
        'áàäâãéèëêíìïîóòöôõúùüûñç',
        'aaaaaeeeeiiiiooooouuuunc'
      ),
      '\s+', ' ', 'g'
    )
  )
$$;

COMMENT ON FUNCTION public.normalizar_nombre_productor(text) IS
  'Espejo de normalizarTexto(valor, {trim:true}) en src/lib/format.ts: minúsculas + sin diacríticos españoles + trim + espacios colapsados. Mantener sincronizados ante cualquier cambio.';

-- ─── 2. productores_alias ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.productores_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  productor_id UUID NOT NULL REFERENCES public.calidad_productores(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_normalizado TEXT NOT NULL,
  origen TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT productores_alias_origen_check CHECK (origen IN ('bascula', 'calibrador', 'calidad', 'manual')),
  CONSTRAINT productores_alias_normalizado_unique UNIQUE (alias_normalizado)
);

CREATE INDEX IF NOT EXISTS productores_alias_productor_idx ON public.productores_alias (productor_id);

ALTER TABLE public.productores_alias ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.productores_alias TO authenticated;

DROP POLICY IF EXISTS "productores_alias_select_all_authenticated" ON public.productores_alias;
DROP POLICY IF EXISTS "productores_alias_insert_authenticated"     ON public.productores_alias;
DROP POLICY IF EXISTS "productores_alias_update_authenticated"     ON public.productores_alias;
DROP POLICY IF EXISTS "productores_alias_delete_authenticated"     ON public.productores_alias;

-- Dataset compartido de todo el equipo, igual criterio que calidad_productores
-- / entradas_bascula (ver 20260508120000_shared_workspace_rls.sql): no hay un
-- "dueño" individual del alias, cualquier autenticado ve y gestiona la cola de
-- revisión de productores.
CREATE POLICY "productores_alias_select_all_authenticated"
  ON public.productores_alias FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "productores_alias_insert_authenticated"
  ON public.productores_alias FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "productores_alias_update_authenticated"
  ON public.productores_alias FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "productores_alias_delete_authenticated"
  ON public.productores_alias FOR DELETE
  USING (auth.role() = 'authenticated');

-- ─── 3. Columnas productor_id nullable en entradas_bascula y lotes_dia ──────
ALTER TABLE public.entradas_bascula
  ADD COLUMN IF NOT EXISTS productor_id UUID REFERENCES public.calidad_productores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS entradas_bascula_productor_id_idx ON public.entradas_bascula (productor_id);

ALTER TABLE public.lotes_dia
  ADD COLUMN IF NOT EXISTS productor_id UUID REFERENCES public.calidad_productores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lotes_dia_productor_id_idx ON public.lotes_dia (productor_id);

-- ─── 4. Triggers: auto-asignar productor_id por alias EXACTO en cada
--        insert/update. Cubre TODOS los caminos de import (edge functions,
--        cliente, sembrado de stock) sin tener que tocar cada importador. ────
CREATE OR REPLACE FUNCTION public.asignar_productor_id_entradas_bascula()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.productor_id IS NULL AND NEW.agricultor IS NOT NULL THEN
    SELECT pa.productor_id INTO NEW.productor_id
    FROM public.productores_alias pa
    WHERE pa.alias_normalizado = public.normalizar_nombre_productor(NEW.agricultor)
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entradas_bascula_asignar_productor_id ON public.entradas_bascula;
CREATE TRIGGER entradas_bascula_asignar_productor_id
  BEFORE INSERT OR UPDATE ON public.entradas_bascula
  FOR EACH ROW EXECUTE FUNCTION public.asignar_productor_id_entradas_bascula();

CREATE OR REPLACE FUNCTION public.asignar_productor_id_lotes_dia()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.productor_id IS NULL AND NEW.productor IS NOT NULL THEN
    SELECT pa.productor_id INTO NEW.productor_id
    FROM public.productores_alias pa
    WHERE pa.alias_normalizado = public.normalizar_nombre_productor(NEW.productor)
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lotes_dia_asignar_productor_id ON public.lotes_dia;
CREATE TRIGGER lotes_dia_asignar_productor_id
  BEFORE INSERT OR UPDATE ON public.lotes_dia
  FOR EACH ROW EXECUTE FUNCTION public.asignar_productor_id_lotes_dia();

-- ─── 5. Backfill (idempotente, SOLO coincidencias EXACTAS tras normalizar) ──

-- 5.a Sembrar productores nuevos: nombres distintos normalizados de las 3
--     fuentes que no existan ya en calidad_productores (por nombre
--     normalizado). El nombre canónico elegido es el más frecuente (y, en
--     empate, el más largo) de las variantes de texto crudo que comparten ese
--     normalizado.
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Dueño técnico de los productores auto-sembrados: el admin más antiguo, o
  -- en su defecto cualquier usuario existente (dataset compartido: el
  -- user_id de calidad_productores no implica propiedad exclusiva, ver
  -- políticas de SELECT "all authenticated" más abajo/arriba).
  SELECT ur.user_id INTO v_user_id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ORDER BY ur.created_at ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'productores_canonicos: no hay ningún usuario en auth.users; se omite el backfill de catálogo/alias (tabla, columnas, función y triggers sí quedan creados).';
    RETURN;
  END IF;

  WITH nombres_crudos AS (
    SELECT agricultor AS nombre, public.normalizar_nombre_productor(agricultor) AS normalizado
    FROM public.entradas_bascula
    WHERE agricultor IS NOT NULL AND trim(agricultor) <> ''
    UNION ALL
    SELECT productor, public.normalizar_nombre_productor(productor)
    FROM public.lotes_dia
    WHERE productor IS NOT NULL AND trim(productor) <> ''
    UNION ALL
    SELECT productor_finca_nombre, public.normalizar_nombre_productor(productor_finca_nombre)
    FROM public.calidad_lotes
    WHERE productor_finca_nombre IS NOT NULL AND trim(productor_finca_nombre) <> ''
  ),
  conteo AS (
    SELECT normalizado, nombre, count(*) AS apariciones, length(nombre) AS longitud
    FROM nombres_crudos
    WHERE normalizado <> ''
    GROUP BY normalizado, nombre
  ),
  canonico AS (
    -- Nombre canónico por normalizado: el de más apariciones; en empate, el
    -- más largo; en empate de longitud, orden alfabético (determinismo).
    SELECT DISTINCT ON (normalizado) normalizado, nombre AS nombre_canonico
    FROM conteo
    ORDER BY normalizado, apariciones DESC, longitud DESC, nombre ASC
  ),
  pendientes AS (
    SELECT c.normalizado, c.nombre_canonico
    FROM canonico c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.calidad_productores cp
      WHERE public.normalizar_nombre_productor(cp.nombre) = c.normalizado
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.productores_alias pa
      WHERE pa.alias_normalizado = c.normalizado
    )
  )
  INSERT INTO public.calidad_productores (user_id, nombre)
  SELECT v_user_id, nombre_canonico
  FROM pendientes
  ON CONFLICT DO NOTHING;
END $$;

-- 5.b Sembrar alias: cada nombre crudo distinto (SIN normalizar) de las 3
--     fuentes cuyo normalizado case EXACTO con un productor ya existente
--     (nombre canónico de calidad_productores, incluidos los recién
--     sembrados en 5.a).
INSERT INTO public.productores_alias (productor_id, alias, alias_normalizado, origen)
SELECT DISTINCT ON (n.normalizado)
  cp.id, n.nombre, n.normalizado, n.origen
FROM (
  SELECT agricultor AS nombre, public.normalizar_nombre_productor(agricultor) AS normalizado, 'bascula' AS origen
  FROM public.entradas_bascula
  WHERE agricultor IS NOT NULL AND trim(agricultor) <> ''
  UNION ALL
  SELECT productor, public.normalizar_nombre_productor(productor), 'calibrador'
  FROM public.lotes_dia
  WHERE productor IS NOT NULL AND trim(productor) <> ''
  UNION ALL
  SELECT productor_finca_nombre, public.normalizar_nombre_productor(productor_finca_nombre), 'calidad'
  FROM public.calidad_lotes
  WHERE productor_finca_nombre IS NOT NULL AND trim(productor_finca_nombre) <> ''
) n
JOIN public.calidad_productores cp
  ON public.normalizar_nombre_productor(cp.nombre) = n.normalizado
WHERE n.normalizado <> ''
ORDER BY n.normalizado, cp.id
ON CONFLICT (alias_normalizado) DO NOTHING;

-- 5.c Backfill de las columnas productor_id / productor_finca_id donde el
--     alias resuelve EXACTO. Idempotente: solo toca filas con el id a NULL.
UPDATE public.entradas_bascula eb
SET productor_id = pa.productor_id
FROM public.productores_alias pa
WHERE eb.productor_id IS NULL
  AND eb.agricultor IS NOT NULL
  AND pa.alias_normalizado = public.normalizar_nombre_productor(eb.agricultor);

UPDATE public.lotes_dia ld
SET productor_id = pa.productor_id
FROM public.productores_alias pa
WHERE ld.productor_id IS NULL
  AND ld.productor IS NOT NULL
  AND pa.alias_normalizado = public.normalizar_nombre_productor(ld.productor);

UPDATE public.calidad_lotes cl
SET productor_finca_id = pa.productor_id
FROM public.productores_alias pa
WHERE cl.productor_finca_id IS NULL
  AND cl.productor_finca_nombre IS NOT NULL
  AND pa.alias_normalizado = public.normalizar_nombre_productor(cl.productor_finca_nombre);

-- ─── 6. lotes_dia: permitir a un admin actualizar productor_id de filas de
--        OTROS usuarios ────────────────────────────────────────────────────
-- La política de UPDATE de lotes_dia (20260508120000_shared_workspace_rls.sql)
-- se quedó en "auth.uid() = user_id" sin el "OR admin" que sí tienen
-- costes_diarios/asistencia_diaria/calidad_lotes. Sin este cambio, la cola de
-- revisión de productores (solo admin, src/pages/Productores.tsx) no podría
-- vincular retroactivamente lotes de días importados por otro usuario. Mismo
-- patrón "own_or_admin" que el resto de tablas del workspace compartido.
DROP POLICY IF EXISTS "lotes_update_own" ON public.lotes_dia;
DROP POLICY IF EXISTS "lotes_update_own_or_admin" ON public.lotes_dia;

CREATE POLICY "lotes_update_own_or_admin"
  ON public.lotes_dia FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
