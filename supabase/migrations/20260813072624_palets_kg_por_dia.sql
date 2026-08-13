-- Los kilos de palets de cada día, ya separados por lo que hace falta decidir.
--
-- Agregado en servidor: son 42.534 palets y bajarlos al cliente solo para
-- sumarlos allí no tiene sentido.
--
-- `kg_sin_precalibrado` es el número que entra en el DSJ (decisión del dueño,
-- 13-08-2026): cuentan los palets terminados y el granel, no el precalibrado —
-- esa fruta se aparta y vuelve a entrar por báscula como lote nuevo, así que
-- contarla al salir y otra vez al entrar la duplicaría. Incluye Egipto porque
-- quien consume `kg_palets_brutos` ya le resta `kg_palets_egipto` aparte.
--
-- Lo que se midió antes de elegir, sobre los 83 días que tenían los dos datos:
--
--   solo palets terminados      →  DSJ +8,60%   (617 t sin explicar)
--   todos sin excepción         →  DSJ −3,39%   (imposible: sale más que entra)
--   granel sí, precalibrado no  →  DSJ  351 kg sobre 7.172.008   ← esta
CREATE OR REPLACE FUNCTION public.palets_kg_por_dia()
RETURNS TABLE (
  dia date, palets bigint, kg_total numeric,
  kg_sin_precalibrado numeric, kg_comercial numeric,
  kg_egipto numeric, kg_campo numeric, kg_precalibrado numeric,
  cerrado boolean
)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT p.fecha AS dia,
         count(*)                                                      AS palets,
         sum(p.kg_neto)                                                AS kg_total,
         sum(p.kg_neto) FILTER (WHERE NOT p.precalibrado)              AS kg_sin_precalibrado,
         sum(p.kg_neto) FILTER (WHERE p.comercial)                     AS kg_comercial,
         sum(p.kg_neto) FILTER (WHERE p.egipto AND NOT p.precalibrado) AS kg_egipto,
         sum(p.kg_neto) FILTER (WHERE p.campo  AND NOT p.precalibrado) AS kg_campo,
         sum(p.kg_neto) FILTER (WHERE p.precalibrado)                  AS kg_precalibrado,
         bool_and(p.dia_cerrado)                                       AS cerrado
    FROM public.palets p
   GROUP BY p.fecha;
$function$;

GRANT EXECUTE ON FUNCTION public.palets_kg_por_dia() TO anon, authenticated, service_role;
