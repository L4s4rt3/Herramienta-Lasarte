-- =============================================================================
-- MIGRACION: enlace garantizado — auto-creación de productor canónico +
-- movimientos internos de confección/sobrante fuera del catálogo
--
-- Encargo del dueño (2026-08-03, textual): "la sección de productores no está
-- enlazada correctamente, cada vez hay más productores que no se enlazan y
-- perdemos información valiosa; haz que se enlacen siempre correctamente".
--
-- Diagnóstico: el trigger de entradas_bascula (20260714090000) SOLO intenta
-- alias por nombre; si un agricultor REAL nuevo no tiene alias, productor_id
-- se queda NULL para siempre — hasta que un admin lo asigna a mano desde la
-- cola de "nombres sin vincular" de /productores. Con cosecha nueva entran
-- productores nuevos cada semana: la cola crece sin parar y el ranking/coste
-- de fruta pierde esas filas hasta que alguien las revisa (13 entradas de
-- julio-2026 detectadas así: "Confección.. 7/3/4/1/2/6" y "Sobrante.... 12/5"
-- — que en realidad NO son productores, son movimientos internos de almacén,
-- ver más abajo).
--
-- Esta migración cierra el enlace en el ORIGEN (entradas_bascula, la fuente
-- de identidad principal — ver 20260721120000_productores_codigo_erp.sql):
-- si el alias no resuelve, se CREA el productor canónico + su alias de
-- origen automáticamente, y se marca `creado_automaticamente` para que la
-- cola de revisión (ahora también "para fusionar", no solo "para vincular")
-- lo destaque. lotes_dia SIGUE sin crear alias por nombre propio (decisión
-- ya tomada en 20260730100000_vinculacion_por_lote.sql): la finca del
-- calibrador puede pertenecer a varios productores (caso real "LA
-- TORRECILLA"), así que crear un canónico a partir de ese texto seguiría
-- siendo arriesgado; su respaldo por evidencia del lote ya hereda el
-- productor_id resuelto aquí en cuanto entradas_bascula lo tiene.
--
-- Excluidos de la auto-creación (no son productores reales, mismo criterio
-- que esEntradaPrecalibrado / esAgricultorMovimientoInterno en
-- src/lib/productoresCanonicos.ts — mantener sincronizados):
--   - el circuito de precalibrado (agricultor "... ALMACEN PRECAL...").
--   - los movimientos internos de confección/sobrante ("Confección.. N",
--     "Sobrante.... N"): fruta ya contada que se re-registra en báscula, no
--     una entrada de campo.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION; el
-- trigger ya existe (20260714090000), no hace falta recrearlo, solo se
-- reemplaza la función que ejecuta. NO se ha aplicado todavía (pendiente del
-- orquestador).
-- =============================================================================

-- ─── 1. Columna de trazabilidad del auto-alta ───────────────────────────────
ALTER TABLE public.calidad_productores
  ADD COLUMN IF NOT EXISTS creado_automaticamente BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.calidad_productores.creado_automaticamente IS
  'true si esta ficha la creó solo el trigger de entradas_bascula (asignar_productor_id_entradas_bascula) al no encontrar alias para un agricultor nuevo, sin intervención manual. La cola de revisión de /productores lo destaca para poder fusionarlo si resulta ser variante de un productor ya existente.';

-- ─── 2. Espejo SQL de esAgricultorMovimientoInterno (productoresCanonicos.ts) ─
-- Detecta los movimientos internos de confección/sobrante (fruta ya contada
-- que se re-registra en báscula), para EXCLUIRLOS de la auto-creación —
-- mismo criterio, mismos textos reales verificados en BD (jul-2026):
-- "Confección.. 7/3/4/1/2/6", "Sobrante.... 12/5".
CREATE OR REPLACE FUNCTION public.es_movimiento_interno_productor(nombre text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalizar_nombre_productor(nombre) ~ '^(confeccion|sobrante)\.+\s*\d+$'
$$;

COMMENT ON FUNCTION public.es_movimiento_interno_productor(text) IS
  'Espejo de esAgricultorMovimientoInterno en src/lib/productoresCanonicos.ts. Mantener sincronizados ante cualquier cambio.';

-- ─── 3. Trigger de entradas_bascula: auto-creación del productor nuevo ──────
-- Mismos atributos que la definición original (20260714090000): invoker, sin
-- SECURITY DEFINER — el INSERT en calidad_productores/productores_alias que
-- añade este paso corre con los permisos de quien hace el import (RLS
-- "auth.uid() = user_id" en calidad_productores, "authenticated" en
-- productores_alias), igual que si el propio usuario hubiera creado la ficha
-- a mano desde crearProductor en useProductoresCatalogo.ts.
CREATE OR REPLACE FUNCTION public.asignar_productor_id_entradas_bascula()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_normalizado text;
  v_nuevo_id uuid;
  v_user_id uuid;
BEGIN
  IF NEW.productor_id IS NULL AND NEW.agricultor IS NOT NULL THEN
    v_normalizado := public.normalizar_nombre_productor(NEW.agricultor);

    -- 1º: alias por nombre normalizado (comportamiento original, 20260714090000).
    SELECT pa.productor_id INTO NEW.productor_id
    FROM public.productores_alias pa
    WHERE pa.alias_normalizado = v_normalizado
    LIMIT 1;

    -- 2º: auto-creación (2026-08-03) — solo si sigue sin resolver, el nombre
    -- normalizado no está vacío, no es el circuito de precalibrado y no es un
    -- movimiento interno de confección/sobrante.
    IF NEW.productor_id IS NULL
       AND v_normalizado <> ''
       AND v_normalizado !~ 'almacen\s*precal'
       AND NOT public.es_movimiento_interno_productor(NEW.agricultor)
    THEN
      -- Dueño técnico de la ficha auto-creada: el usuario de la sesión que
      -- hace el import (mismo criterio que crearProductor en
      -- useProductoresCatalogo.ts); si no hay sesión (import por
      -- service_role, que además salta RLS), se recurre al admin más
      -- antiguo, mismo fallback que el backfill de 20260714090000.
      v_user_id := auth.uid();
      IF v_user_id IS NULL THEN
        SELECT ur.user_id INTO v_user_id
        FROM public.user_roles ur
        WHERE ur.role = 'admin'
        ORDER BY ur.created_at ASC
        LIMIT 1;
      END IF;
      IF v_user_id IS NULL THEN
        SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC LIMIT 1;
      END IF;

      IF v_user_id IS NOT NULL THEN
        INSERT INTO public.calidad_productores (user_id, nombre, creado_automaticamente)
        VALUES (v_user_id, trim(NEW.agricultor), true)
        ON CONFLICT (user_id, lower(trim(nombre))) DO NOTHING
        RETURNING id INTO v_nuevo_id;

        IF v_nuevo_id IS NULL THEN
          -- Ya existía (carrera con otro import concurrente, o el mismo
          -- usuario ya tenía una ficha manual con ese nombre exacto): se
          -- recupera el id existente en vez de dejar la fila sin vincular.
          SELECT id INTO v_nuevo_id
          FROM public.calidad_productores
          WHERE user_id = v_user_id AND lower(trim(nombre)) = lower(trim(NEW.agricultor))
          LIMIT 1;
        END IF;

        IF v_nuevo_id IS NOT NULL THEN
          INSERT INTO public.productores_alias (productor_id, alias, alias_normalizado, origen)
          VALUES (v_nuevo_id, NEW.agricultor, v_normalizado, 'bascula')
          ON CONFLICT (alias_normalizado) DO NOTHING;
          NEW.productor_id := v_nuevo_id;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. Sin backfill retroactivo a propósito ────────────────────────────────
-- Esta migración cambia el comportamiento HACIA ADELANTE (imports nuevos),
-- que es donde crecía el problema (cola sin fin). Los nombres históricos que
-- ya estén sin vincular siguen disponibles en la cola de revisión manual de
-- /productores tal cual — forzar aquí un UPDATE masivo crearía de golpe
-- fichas nuevas para nombres que el admin quizá prefiera fusionar a mano con
-- uno ya existente primero (mismo motivo por el que el respaldo por
-- evidencia del lote, 20260730100000, tampoco auto-crea nada).
