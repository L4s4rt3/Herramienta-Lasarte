-- Kilos por LOTE Y DÍA DE PASADA (no por lote a secas).
--
-- POR QUÉ ASÍ. Comparando la campaña entera pasada a pasada (13-08-2026):
--
--   1.253 pasadas   →   1.085 cuadran AL KILO con lotes_dia
--                           3 descuadran (13.868 kg)
--                         165 faltan ENTERAS (2.865.743 kg)
--
-- O sea: a la app no le sobran ni le faltan kilos dentro de una pasada — le
-- faltan pasadas completas. Ejemplo real, lote 26041602: la app tiene sus
-- pasadas del 17-04 (3.161 kg) y del 20-04 (14.667 kg) EXACTAS, y no tiene
-- la del 21-04 (33.982 kg).
--
-- La consecuencia práctica: los kilos que faltan hay que darlos de alta EN SU
-- DÍA, no sumárselos a otra fila. Sumarlos al día que la app sí tiene
-- estropearía el DSJ de ese día para arreglar el de otro. La versión anterior
-- (calibrador_kg_por_lote) lo habría hecho mal por eso, y se borra aquí.
CREATE OR REPLACE FUNCTION public.calibrador_kg_por_pasada()
RETURNS TABLE (lote text, dia date, kg numeric, pasadas bigint, productor_id uuid, productor text)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT b.lote,
         (b.inicio AT TIME ZONE 'Europe/Madrid')::date AS dia,
         sum(c.peso_kg)                                AS kg,
         count(DISTINCT b.batch_id)                    AS pasadas,
         pd.productor_id,
         pd.productor
    FROM public.calibrador_batch b
    JOIN public.calibrador_clasificacion c ON c.batch_id = b.batch_id
    LEFT JOIN public.productor_lote_dominante pd ON pd.lote = b.lote
   WHERE c.batch_id > 0
   GROUP BY b.lote, (b.inicio AT TIME ZONE 'Europe/Madrid')::date, pd.productor_id, pd.productor;
$function$;

GRANT EXECUTE ON FUNCTION public.calibrador_kg_por_pasada() TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.calibrador_kg_por_lote();
