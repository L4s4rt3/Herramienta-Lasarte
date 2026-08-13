-- ─────────────────────────────────────────────────────────────────────────────
-- El calibrador pasa a ser la fuente ÚNICA de la clasificación de cada lote.
--
-- EL PORQUÉ. Hasta hoy la herramienta leía `lote_clasificacion`, que se rellena
-- con el Word que la máquina manda al cerrar un lote. Ese Word solo trae la
-- ÚLTIMA pasada. Medido el 13-08-2026 sobre la campaña entera:
--
--   · 618 lotes de una sola pasada  → 95 kg de desvío EN TOTAL (cuadran).
--   · 263 lotes multipasada         → 621.423 kg que la app no tenía.
--
-- O sea: el error no está repartido, está entero en los lotes que pasan por la
-- máquina más de una vez. El volcado SQL del Sizer (calibrador_batch +
-- calibrador_clasificacion) sí tiene todas las pasadas, y es lo que entra por el
-- receptor de la LAN (scripts/README-receptor-calibrador.md).
--
-- LA FORMA. `clasificacion_lote` devuelve las MISMAS columnas que
-- `lote_clasificacion` para que los consumidores cambien de tabla y ya. Añade
-- dos que no existían y que hacen falta para no mentir:
--
--   · `fuente`     — 'calibrador' si el número lo dio la máquina, 'parte' si
--                    salió del Word. Nunca hay que adivinar de dónde viene.
--   · `fraccion_productor` — < 1 cuando el lote es una re-entrada de
--                    precalibrado repartida entre varias fincas (12 lotes hoy).
--
-- EL RESPALDO. Un lote sin ninguna pasada en la máquina NO desaparece: sale de
-- `lote_clasificacion` marcado como 'parte'. No se pierde nada por el cambio.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. El dueño de cada lote, como VISTA ─────────────────────────────────────
-- La regla ya vivía dentro de productor_por_lote(text[]), pero encerrada en una
-- función que hay que llamar lote a lote. Sacarla a vista permite unirla a las
-- 266.511 líneas de clasificación de una vez, en vez de 266.511 llamadas.
-- La función se queda como envoltorio: sus llamadores actuales no se enteran, y
-- la regla existe una sola vez.
CREATE OR REPLACE VIEW public.productor_lote AS
WITH desde_prec AS (
  SELECT eo.lote_reentrada AS lote,
         eo.lote_origen,
         eo.kg_atribuidos
           / nullif(sum(eo.kg_atribuidos) OVER (PARTITION BY eo.lote_reentrada), 0) AS fraccion
    FROM public.erp_precalibrado_origen eo
)
SELECT d.lote,
       e.productor_id,
       coalesce(cp.nombre, e.agricultor) AS productor,
       d.fraccion
  FROM desde_prec d
  JOIN public.entradas_bascula e ON e.lote = d.lote_origen
  LEFT JOIN public.calidad_productores cp ON cp.id = e.productor_id
 WHERE d.fraccion > 0

UNION ALL

SELECT e.lote,
       e.productor_id,
       coalesce(cp.nombre, e.agricultor),
       1::numeric
  FROM public.entradas_bascula e
  LEFT JOIN public.calidad_productores cp ON cp.id = e.productor_id
 WHERE e.lote IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM desde_prec d WHERE d.lote = e.lote);

COMMENT ON VIEW public.productor_lote IS
  'De quién es cada lote, siguiendo el precalibrado hacia atrás. Un lote normal '
  'da una fila con fraccion = 1; una re-entrada repartida da una fila por finca '
  'de origen. Única copia de la regla: productor_por_lote() lee de aquí.';

-- La función deja de tener su propia copia de la regla y pasa a filtrar la vista.
CREATE OR REPLACE FUNCTION public.productor_por_lote(lotes text[])
RETURNS TABLE (lote text, productor_id uuid, productor text, fraccion numeric)
LANGUAGE sql
STABLE
AS $function$
  SELECT pl.lote, pl.productor_id, pl.productor, pl.fraccion
    FROM public.productor_lote pl
   WHERE pl.lote = ANY(lotes);
$function$;

-- ── 2. Un dueño por lote, para las vistas que necesitan una sola fila ────────
-- clasificacion_lote tiene que dar UNA fila por línea de clasificación (misma
-- forma que lote_clasificacion). Cuando un lote tiene varias fincas detrás se
-- toma la de mayor fracción y se deja la fracción a la vista: así se sabe que
-- ese kilo está compartido en vez de creerlo entero de uno.
CREATE OR REPLACE VIEW public.productor_lote_dominante AS
SELECT DISTINCT ON (lote)
       lote, productor_id, productor, fraccion
  FROM public.productor_lote
 ORDER BY lote, fraccion DESC, productor;

-- ── 3. La clasificación, con el calibrador al mando ─────────────────────────
CREATE OR REPLACE VIEW public.clasificacion_lote AS
WITH cal AS (
  SELECT c.batch_id,
         b.lote,
         (b.inicio AT TIME ZONE 'Europe/Madrid')::date AS fecha,
         b.inicio,
         b.fin,
         c.producto, c.calidad, c.clase, c.grupo_destino, c.tamano,
         c.piezas, c.peso_kg, c.cartons
    FROM public.calibrador_clasificacion c
    JOIN public.calibrador_batch b ON b.batch_id = c.batch_id
   -- batch_id = 0 son los restos del Word suelto: solo cubren la última pasada
   -- y mezclarlos dejaría los kilos cortos (mismo criterio que
   -- calibrador_aprovechamiento_productor).
   WHERE c.batch_id > 0
)
SELECT
  -- `id` estable y ordenable: fetchAllRows pagina con .order("id") y necesita
  -- un orden que no cambie entre páginas. La clave natural
  -- (batch_id, producto, calidad, clase, tamaño, destino) es única — comprobado
  -- sobre las 269.114 filas — así que su hash sirve de identidad.
  md5(cal.batch_id::text || '|' || coalesce(cal.producto,'') || '|' || coalesce(cal.calidad,'')
      || '|' || coalesce(cal.clase,'') || '|' || coalesce(cal.tamano,'')
      || '|' || coalesce(cal.grupo_destino,''))::uuid AS id,
  pa.id                                   AS part_id,
  NULL::uuid                              AS user_id,
  NULL::uuid                              AS archivo_id,
  NULL::uuid                              AS lote_dia_id,
  cal.lote                                AS lote_codigo,
  substring(cal.lote FROM '\d{8}')        AS lote_codigo_base,
  pd.productor,
  pd.productor_id,
  cal.fecha,
  inf.toneladas_hora,
  inf.peso_fruta_media_g                  AS peso_fruta_promedio_g,
  CASE WHEN cal.fin > cal.inicio
       THEN round(extract(epoch FROM (cal.fin - cal.inicio)) / 60.0, 2)
  END                                     AS duracion_min,
  cal.producto, cal.calidad, cal.clase, cal.grupo_destino, cal.tamano,
  cal.piezas,
  cal.piezas / nullif(sum(cal.piezas)  OVER (PARTITION BY cal.lote), 0) AS pct_piezas,
  cal.peso_kg,
  cal.peso_kg / nullif(sum(cal.peso_kg) OVER (PARTITION BY cal.lote), 0) AS pct_peso,
  cal.cartons,
  cal.cartons / nullif(sum(cal.cartons) OVER (PARTITION BY cal.lote), 0) AS pct_cartons,
  cal.inicio                              AS created_at,
  'calibrador'::text                      AS fuente,
  coalesce(pd.fraccion, 1)                AS fraccion_productor,
  cal.batch_id
FROM cal
LEFT JOIN public.productor_lote_dominante pd ON pd.lote = cal.lote
LEFT JOIN public.partes_diarios pa ON pa.date = cal.fecha
LEFT JOIN public.calibrador_informe inf ON inf.lote = cal.lote

UNION ALL

-- Respaldo: lotes que la máquina no tiene. Salen del Word, marcados como tal.
SELECT
  lc.id, lc.part_id, lc.user_id, lc.archivo_id, lc.lote_dia_id,
  lc.lote_codigo, lc.lote_codigo_base, lc.productor,
  ld.productor_id,
  lc.fecha, lc.toneladas_hora, lc.peso_fruta_promedio_g, lc.duracion_min,
  lc.producto, lc.calidad, lc.clase, lc.grupo_destino, lc.tamano,
  lc.piezas, lc.pct_piezas, lc.peso_kg, lc.pct_peso, lc.cartons, lc.pct_cartons,
  lc.created_at,
  'parte'::text AS fuente,
  1::numeric    AS fraccion_productor,
  NULL::integer AS batch_id
FROM public.lote_clasificacion lc
LEFT JOIN public.productor_lote_dominante ld ON ld.lote = lc.lote_codigo
WHERE NOT EXISTS (
  SELECT 1 FROM public.calibrador_batch b
   WHERE b.lote = lc.lote_codigo
     AND EXISTS (SELECT 1 FROM public.calibrador_clasificacion c
                  WHERE c.batch_id = b.batch_id AND c.batch_id > 0)
);

COMMENT ON VIEW public.clasificacion_lote IS
  'Clasificación de cada lote con el calibrador al mando. Misma forma que '
  'lote_clasificacion (para que los consumidores solo cambien de nombre) más '
  'fuente (calibrador|parte) y fraccion_productor. El Word solo se usa para '
  'lotes que la máquina no tiene: recupera 621.423 kg de lotes multipasada.';

GRANT SELECT ON public.productor_lote            TO anon, authenticated, service_role;
GRANT SELECT ON public.productor_lote_dominante  TO anon, authenticated, service_role;
GRANT SELECT ON public.clasificacion_lote        TO anon, authenticated, service_role;
