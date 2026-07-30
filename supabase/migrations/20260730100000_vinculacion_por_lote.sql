-- =============================================================================
-- MIGRACION: vinculación de productor por EVIDENCIA DEL LOTE (endurecimiento)
--
-- Petición del dueño (2026-07-30): "que los nombres sin vincular se vinculen
-- solos". El nombre de productor del calibrador es texto libre y a menudo es
-- la FINCA, que puede pertenecer a VARIOS productores (caso real que motivó
-- esto: "LA TORRECILLA" en 9 pasadas del histórico de informes era Camba S.C.
-- en unas y Balca Naranjos en otras — un alias por nombre habría mezclado sus
-- cifras; "DEHESILLA" ha sido de Frubezar y de Ex. Virgen Valle según la
-- época). Por eso los alias por nombre NUNCA se crean solos.
--
-- La evidencia que SÍ es inequívoca es el CÓDIGO DE LOTE: identifica la
-- entrada de báscula (lote es UNIQUE en entradas_bascula) y su productor.
--
-- 1) El trigger de lotes_dia gana un respaldo: si el alias por nombre no
--    resuelve, busca el productor por el primer código de 8 dígitos del
--    lote_codigo en entradas_bascula. Las filas futuras (imports de
--    producción, informes LOTE, partes) se vinculan solas aunque el nombre
--    sea basura ("NADA") o una finca compartida.
-- 2) Backfill retroactivo con el mismo criterio para lotes_dia y
--    calidad_lotes (por numero_lote).
--
-- La cola "nombres sin vincular" de /productores queda solo para lo
-- genuinamente irresoluble (nombre sin alias Y lote sin entrada de báscula).
-- =============================================================================

-- Mismos atributos que la definición original (20260714090000): invoker, sin
-- SECURITY DEFINER — las RLS de las tablas implicadas permiten SELECT a
-- authenticated y el trigger corre en los mismos imports que antes.
CREATE OR REPLACE FUNCTION public.asignar_productor_id_lotes_dia()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_lote text;
BEGIN
  -- 1º: alias por nombre normalizado (comportamiento original, 20260714090000).
  IF NEW.productor_id IS NULL AND NEW.productor IS NOT NULL THEN
    SELECT pa.productor_id INTO NEW.productor_id
    FROM public.productores_alias pa
    WHERE pa.alias_normalizado = public.normalizar_nombre_productor(NEW.productor)
    LIMIT 1;
  END IF;
  -- 2º: EVIDENCIA DEL LOTE (2026-07-30) — solo si el alias no resolvió.
  IF NEW.productor_id IS NULL THEN
    v_lote := substring(NEW.lote_codigo from '\d{8}');
    IF v_lote IS NOT NULL THEN
      SELECT e.productor_id INTO NEW.productor_id
      FROM public.entradas_bascula e
      WHERE e.lote = v_lote AND e.productor_id IS NOT NULL
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Backfill retroactivo (idempotente: solo filas aún sin vincular) ─────────

UPDATE public.lotes_dia ld
SET productor_id = e.productor_id
FROM public.entradas_bascula e
WHERE ld.productor_id IS NULL
  AND e.lote = substring(ld.lote_codigo from '\d{8}')
  AND e.productor_id IS NOT NULL;

UPDATE public.calidad_lotes cl
SET productor_finca_id = e.productor_id
FROM public.entradas_bascula e
WHERE cl.productor_finca_id IS NULL
  AND e.lote = substring(cl.numero_lote from '\d{8}')
  AND e.productor_id IS NOT NULL;
