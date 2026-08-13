-- Nombres de productor que la app usa y el catálogo canónico no reconoce.
--
-- POR QUÉ EXISTE. Antes del 13-08-2026, /productores y /calibrador contestaban
-- a la misma pregunta con nombres distintos: la primera decía "LA TORRECILLA,
-- INVERMARMELO" (fincas, texto libre del Word) y la segunda "LASARTE EXPORT SL
-- Gesfrumed SL" (razón social, resuelta contra el catálogo). De los 94 nombres
-- distintos de la vía vieja, 91 sí casaban — o sea que el catálogo estaba bien
-- y quien no lo usaba era la app.
--
-- Esta función es el vigilante: si mañana entra un nombre que no casa, sale
-- aquí en vez de aparecer como un productor fantasma en un ranking. La usa
-- scripts/auditar-fuentes.mjs.
--
-- POR QUÉ CONTRA LA TABLA BASE Y NO CONTRA LA VISTA. `clasificacion_lote` lleva
-- ventanas de porcentaje (sum() OVER PARTITION BY lote) sobre 300.317 filas:
-- agrupar por ella se pasa del statement timeout. Y no hace falta — por el lado
-- del calibrador el productor sale de `productor_lote_dominante`, que es
-- canónico POR CONSTRUCCIÓN. El riesgo está en el texto libre, y ese vive en
-- `lote_clasificacion`.
CREATE OR REPLACE FUNCTION public.productores_sin_casar()
RETURNS TABLE (productor text, filas bigint, kg numeric)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  WITH nombres AS (
    SELECT lc.productor, count(*) AS filas, sum(lc.peso_kg) AS kg
      FROM public.lote_clasificacion lc
     WHERE lc.productor IS NOT NULL AND lc.productor <> ''
     GROUP BY lc.productor
  ),
  conocidos AS (
    SELECT public.normalizar_nombre_productor(p.nombre) AS n FROM public.calidad_productores p
    UNION
    SELECT a.alias_normalizado FROM public.productores_alias a
  )
  SELECT n.productor, n.filas, n.kg
    FROM nombres n
   WHERE public.normalizar_nombre_productor(n.productor)
         NOT IN (SELECT c.n FROM conocidos c WHERE c.n IS NOT NULL)
   ORDER BY n.filas DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.productores_sin_casar() TO anon, authenticated, service_role;
