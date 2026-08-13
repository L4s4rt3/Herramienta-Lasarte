-- Sustituida en la migración siguiente por calibrador_kg_por_pasada(): agrupar
-- por lote a secas escondía que lo que falta no son kilos sueltos, sino pasadas
-- enteras, y llevaba a sumarlos al día equivocado. Se deja el rastro de que
-- existió y se borra allí.
CREATE OR REPLACE FUNCTION public.calibrador_kg_por_lote()
RETURNS TABLE (lote text, kg numeric, fecha date, productor_id uuid, productor text)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT b.lote,
         sum(c.peso_kg)                                     AS kg,
         (min(b.inicio) AT TIME ZONE 'Europe/Madrid')::date AS fecha,
         pd.productor_id,
         pd.productor
    FROM public.calibrador_batch b
    JOIN public.calibrador_clasificacion c ON c.batch_id = b.batch_id
    LEFT JOIN public.productor_lote_dominante pd ON pd.lote = b.lote
   WHERE c.batch_id > 0
   GROUP BY b.lote, pd.productor_id, pd.productor;
$function$;

GRANT EXECUTE ON FUNCTION public.calibrador_kg_por_lote() TO anon, authenticated, service_role;
