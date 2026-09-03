-- Aprovechamiento REAL por parcela: detalle del calibrador por lote, y dos
-- arreglos que destapó (03-09-2026).
--
-- 1. clase_letra(clase): la letra canónica de una clase. El volcado SQL del
--    Sizer escribe la clase SIN letra ("Extra 1 ", "Cat1 A") y el Word/Excel
--    CON ella ("(A) Extra 1"). La vista materializada del mix solo miraba la
--    letra, así que el 87 % de sus filas (las del volcado) salían con 0 kg de
--    clase apta, podrido e industria. Ahora la letra se deduce del nombre
--    cuando no viene. Es la misma tabla que letraClase() en _shared/mdnaMix.ts:
--    si se toca una, se toca la otra.
--
-- 2. clase_destino(grupo_destino, clase): destino normalizado (sin acentos,
--    mayúsculas) con respaldo por la letra de la clase cuando el volcado no
--    trae grupo_destino (2.635 filas, ~290 t, que antes no sumaban en ningún
--    destino).
--
-- 3. La rama "parte" de clasificacion_lote (el Excel manual del Informe LOTE)
--    solo se apartaba cuando el código CRUDO coincidía con el de una pasada
--    del volcado. Con códigos como "26041406+3 BOX DE RECICLAJE" no coincidía
--    y la misma pasada entraba DOS veces (volcado + Excel): las 33.806 filas
--    que la rama aportaba hoy, 2.758.515 kg de 152 lotes, eran todas
--    duplicados del mismo lote y día. La regla pasa a ser la misma que ya
--    aplicaba la rama del Word: por LOTE (8 dígitos) Y DÍA. El Excel manual
--    sigue siendo el respaldo para lo que ni el volcado ni el Word traigan.
--
-- 4. clasificacion_lote_detalle_mv: la vista canónica al grano de pasada ×
--    producto × clase × calibre, con índice por lote. Filtrar la vista por lote
--    tardaba 3 s (no empuja el filtro por debajo de las ventanas); con la
--    materializada, milisegundos. Se refresca con el mix (misma función, mismo
--    cron horario). RPC clasificacion_detalle_lotes(lotes) para la página.

-- ─── 1. Letra canónica de la clase ──────────────────────────────────────────
create or replace function public.clase_letra(clase text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(
    upper(substring(clase from '^\s*\(([A-Za-z])\)')),
    case upper(btrim(regexp_replace(regexp_replace(coalesce(clase, ''), '^\s*\([A-Za-z]\)\s*', ''), '\s+', ' ', 'g')))
      when 'EXTRA 1'      then 'A'
      when 'EXTRA 2'      then 'B'
      when 'CAT1 A'       then 'C'
      when 'CAT 1 A'      then 'C'
      when 'CAT1 B'       then 'D'
      when 'CAT 1 B'      then 'D'
      when 'VERDE CLARO'  then 'E'
      when 'CAT 2'        then 'F'
      when 'CAT2'         then 'F'
      when 'CAT 3'        then 'G'
      when 'CAT3'         then 'G'
      when 'VERDE OSCURO' then 'H'
      when 'INDUSTRIA'    then 'I'
      when 'PODRIDO'      then 'J'
      when 'RECIRCULO'    then 'K'
      when 'MUJERES'      then 'L'
      when 'DENSIDAD'     then 'M'
      when 'ESPONJA'      then 'N'
    end)
$$;
comment on function public.clase_letra(text) is
  'Letra A–N de una clase del calibrador: la del prefijo "(C) …" o, si no la trae (volcado SQL), la que le corresponde por nombre. Espejo de letraClase() en _shared/mdnaMix.ts.';

-- ─── 2. Destino normalizado con respaldo por letra ──────────────────────────
create or replace function public.clase_destino(grupo_destino text, clase text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(
    nullif(btrim(upper(translate(coalesce(grupo_destino, ''), 'ÁÉÍÓÚÜáéíóúüÑñ', 'AEIOUUaeiouuNn'))), ''),
    case public.clase_letra(clase)
      when 'A' then 'EXPORTACION' when 'B' then 'EXPORTACION' when 'C' then 'EXPORTACION'
      when 'D' then 'EXPORTACION' when 'E' then 'EXPORTACION'
      when 'F' then 'NO EXPORTACION' when 'G' then 'NO EXPORTACION' when 'H' then 'NO EXPORTACION'
      when 'L' then 'MUJERES'
      when 'I' then 'NO COMERCIAL' when 'J' then 'NO COMERCIAL' when 'K' then 'NO COMERCIAL'
      when 'M' then 'NO COMERCIAL' when 'N' then 'NO COMERCIAL'
    end,
    '(SIN DESTINO)')
$$;
comment on function public.clase_destino(text, text) is
  'grupo_destino sin acentos y en mayúsculas; si el volcado no lo trae, el destino que corresponde a la letra de la clase. Espejo de destinoNormalizado() en _shared/mdnaMix.ts.';

-- ─── 3. La rama "parte" de la vista canónica, por lote Y día ────────────────
create or replace view public.clasificacion_lote
with (security_invoker = on)
as
 WITH cal AS (
         SELECT c.batch_id,
            b.lote,
            (b.inicio AT TIME ZONE 'Europe/Madrid'::text)::date AS fecha,
            b.inicio,
            b.fin,
            c.producto,
            c.calidad,
            c.clase,
            c.grupo_destino,
            c.tamano,
            c.piezas,
            c.peso_kg,
            c.cartons
           FROM calibrador_clasificacion c
             JOIN calibrador_batch b ON b.batch_id = c.batch_id
          WHERE c.batch_id > 0
        ), informe AS (
         SELECT DISTINCT ON (calibrador_informe.lote) calibrador_informe.lote,
            calibrador_informe.toneladas_hora,
            calibrador_informe.peso_fruta_media_g
           FROM calibrador_informe
          ORDER BY calibrador_informe.lote, calibrador_informe.recibido_at DESC NULLS LAST
        ), docx_inf AS (
         SELECT DISTINCT ON ((COALESCE("substring"(i.lote, '\d{8}'::text), upper(btrim(i.lote)))), i.fecha, i.comienzo) i.batch_id,
            i.lote,
            i.fecha,
            i.productor,
            i.toneladas_hora,
            i.peso_fruta_media_g,
            i.tiempo_lote,
            i.recibido_at,
            "substring"(i.lote, '\d{8}'::text) AS base8
           FROM calibrador_informe i
          WHERE i.batch_id < 0 AND i.fecha IS NOT NULL AND NOT (EXISTS ( SELECT 1
                   FROM calibrador_batch b
                  WHERE (b.inicio AT TIME ZONE 'Europe/Madrid'::text)::date = i.fecha AND (b.lote = i.lote OR "substring"(b.lote, '\d{8}'::text) = "substring"(i.lote, '\d{8}'::text)) AND (EXISTS ( SELECT 1
                           FROM calibrador_clasificacion c
                          WHERE c.batch_id = b.batch_id AND c.batch_id > 0)))) AND NOT (EXISTS ( SELECT 1
                   FROM lote_clasificacion lc
                  WHERE lc.fecha = i.fecha AND (lc.lote_codigo = i.lote OR "substring"(lc.lote_codigo, '\d{8}'::text) = "substring"(i.lote, '\d{8}'::text))))
          ORDER BY (COALESCE("substring"(i.lote, '\d{8}'::text), upper(btrim(i.lote)))), i.fecha, i.comienzo, i.recibido_at DESC NULLS LAST
        ), sql_lote_dia AS (
         -- Los lote-días que el volcado SQL ya cubre (con clasificación): la
         -- rama "parte" se aparta de ellos por código base y día, no solo por
         -- código crudo (arreglo 03-09-2026, ver cabecera).
         SELECT DISTINCT (b.inicio AT TIME ZONE 'Europe/Madrid'::text)::date AS fecha,
            "substring"(b.lote, '\d{8}'::text) AS base8
           FROM calibrador_batch b
          WHERE EXISTS ( SELECT 1
                   FROM calibrador_clasificacion c
                  WHERE c.batch_id = b.batch_id AND c.batch_id > 0)
        )
 SELECT md5((((((((((cal.batch_id::text || '|'::text) || COALESCE(cal.producto, ''::text)) || '|'::text) || COALESCE(cal.calidad, ''::text)) || '|'::text) || COALESCE(cal.clase, ''::text)) || '|'::text) || COALESCE(cal.tamano, ''::text)) || '|'::text) || COALESCE(cal.grupo_destino, ''::text))::uuid AS id,
    pa.id AS part_id,
    NULL::uuid AS user_id,
    NULL::uuid AS archivo_id,
    NULL::uuid AS lote_dia_id,
    cal.lote AS lote_codigo,
    "substring"(cal.lote, '\d{8}'::text) AS lote_codigo_base,
    pd.productor,
    pd.productor_id,
    cal.fecha,
    inf.toneladas_hora,
    inf.peso_fruta_media_g AS peso_fruta_promedio_g,
        CASE
            WHEN cal.fin > cal.inicio THEN round(EXTRACT(epoch FROM cal.fin - cal.inicio) / 60.0, 2)
            ELSE NULL::numeric
        END AS duracion_min,
    cal.producto,
    cal.calidad,
    cal.clase,
    cal.grupo_destino,
    cal.tamano,
    cal.piezas,
    cal.piezas / NULLIF(sum(cal.piezas) OVER (PARTITION BY cal.lote), 0::numeric) AS pct_piezas,
    cal.peso_kg,
    cal.peso_kg / NULLIF(sum(cal.peso_kg) OVER (PARTITION BY cal.lote), 0::numeric) AS pct_peso,
    cal.cartons,
    cal.cartons / NULLIF(sum(cal.cartons) OVER (PARTITION BY cal.lote), 0::numeric) AS pct_cartons,
    cal.inicio AS created_at,
    'calibrador'::text AS fuente,
    COALESCE(pd.fraccion, 1::numeric) AS fraccion_productor,
    cal.batch_id
   FROM cal
     LEFT JOIN productor_lote_dominante pd ON pd.lote = cal.lote
     LEFT JOIN partes_diarios pa ON pa.date = cal.fecha
     LEFT JOIN informe inf ON inf.lote = cal.lote
UNION ALL
 SELECT lc.id,
    lc.part_id,
    lc.user_id,
    lc.archivo_id,
    lc.lote_dia_id,
    lc.lote_codigo,
    lc.lote_codigo_base,
    lc.productor,
    ld.productor_id,
    lc.fecha,
    lc.toneladas_hora,
    lc.peso_fruta_promedio_g,
    lc.duracion_min,
    lc.producto,
    lc.calidad,
    lc.clase,
    lc.grupo_destino,
    lc.tamano,
    lc.piezas,
    lc.pct_piezas,
    lc.peso_kg,
    lc.pct_peso,
    lc.cartons,
    lc.pct_cartons,
    lc.created_at,
    'parte'::text AS fuente,
    1::numeric AS fraccion_productor,
    NULL::integer AS batch_id
   FROM lote_clasificacion lc
     LEFT JOIN LATERAL ( SELECT pl.productor_id
           FROM productor_lote pl
          WHERE pl.lote = lc.lote_codigo
          ORDER BY pl.fraccion DESC, pl.productor
         LIMIT 1) ld ON true
  WHERE NOT (EXISTS ( SELECT 1
           FROM calibrador_batch b
          WHERE b.lote = lc.lote_codigo AND (EXISTS ( SELECT 1
                   FROM calibrador_clasificacion c
                  WHERE c.batch_id = b.batch_id AND c.batch_id > 0))))
    AND NOT (EXISTS ( SELECT 1
           FROM sql_lote_dia s
          WHERE s.fecha = lc.fecha AND s.base8 = "substring"(lc.lote_codigo, '\d{8}'::text)))
UNION ALL
 SELECT md5((((((((((c.batch_id::text || '|'::text) || COALESCE(c.producto, ''::text)) || '|'::text) || COALESCE(c.calidad, ''::text)) || '|'::text) || COALESCE(c.clase, ''::text)) || '|'::text) || COALESCE(c.tamano, ''::text)) || '|'::text) || COALESCE(c.grupo_destino, ''::text))::uuid AS id,
    pa.id AS part_id,
    NULL::uuid AS user_id,
    NULL::uuid AS archivo_id,
    NULL::uuid AS lote_dia_id,
    d.lote AS lote_codigo,
    d.base8 AS lote_codigo_base,
    COALESCE(pd.productor, d.productor) AS productor,
    pd.productor_id,
    d.fecha,
    d.toneladas_hora,
    d.peso_fruta_media_g AS peso_fruta_promedio_g,
        CASE
            WHEN d.tiempo_lote ~ '^\d{1,3}:\d{2}(:\d{2})?$'::text THEN round(EXTRACT(epoch FROM d.tiempo_lote::interval) / 60.0, 2)
            ELSE NULL::numeric
        END AS duracion_min,
    c.producto,
    c.calidad,
    c.clase,
    c.grupo_destino,
    c.tamano,
    c.piezas,
    c.pct_piezas,
    c.peso_kg,
    c.pct_peso,
    c.cartons,
    c.pct_cartons,
    d.recibido_at AS created_at,
    'docx'::text AS fuente,
    COALESCE(pd.fraccion, 1::numeric) AS fraccion_productor,
    c.batch_id
   FROM docx_inf d
     JOIN calibrador_clasificacion c ON c.batch_id = d.batch_id
     LEFT JOIN productor_lote_dominante pd ON pd.lote = COALESCE(d.base8, d.lote)
     LEFT JOIN partes_diarios pa ON pa.date = d.fecha;

-- ─── 4a. El mix por lote, con la letra deducida y el destino con respaldo ───
drop function if exists public.clasificacion_mix_lotes();
drop materialized view if exists public.clasificacion_lote_mix_mv;

create materialized view public.clasificacion_lote_mix_mv as
with f as (
  select
    lote_codigo_base as lote8,
    producto,
    peso_kg,
    fuente,
    public.clase_destino(grupo_destino, clase) as destino,
    public.clase_letra(clase) as letra
  from public.clasificacion_lote
  where lote_codigo_base is not null
)
select
  lote8,
  producto,
  sum(peso_kg)::numeric                                                                as kg_clasificado,
  coalesce(sum(peso_kg) filter (where destino = 'EXPORTACION'), 0)::numeric            as kg_exportacion,
  coalesce(sum(peso_kg) filter (where destino = 'NO EXPORTACION'), 0)::numeric         as kg_no_exportacion,
  coalesce(sum(peso_kg) filter (where destino = 'MUJERES'), 0)::numeric                as kg_mujeres,
  coalesce(sum(peso_kg) filter (where destino = 'NO COMERCIAL'), 0)::numeric           as kg_no_comercial,
  coalesce(sum(peso_kg) filter (where letra in ('A','B','C','D','E','F')), 0)::numeric as kg_clase_apta,
  coalesce(sum(peso_kg) filter (where letra = 'J'), 0)::numeric                        as kg_clase_podrido,
  coalesce(sum(peso_kg) filter (where letra = 'I'), 0)::numeric                        as kg_clase_industria,
  count(*)::integer                                                                    as n_filas,
  bool_or(fuente = 'docx')                                                             as con_docx
from f
group by 1, 2
with no data;

create index if not exists clasificacion_lote_mix_mv_lote8_idx on public.clasificacion_lote_mix_mv (lote8);
grant select on public.clasificacion_lote_mix_mv to authenticated, service_role;
revoke all on public.clasificacion_lote_mix_mv from anon;

create or replace function public.clasificacion_mix_lotes()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'refrescado_en', (select refrescado_en from public.clasificacion_lote_mix_meta where id),
    'filas', coalesce(jsonb_agg(jsonb_build_array(
      lote8, producto, kg_clasificado, kg_exportacion, kg_no_exportacion, kg_mujeres,
      kg_no_comercial, kg_clase_apta, kg_clase_podrido, kg_clase_industria, n_filas, con_docx
    ) order by lote8, producto), '[]'::jsonb)
  )
  from public.clasificacion_lote_mix_mv;
$$;
grant execute on function public.clasificacion_mix_lotes() to authenticated, service_role;

-- ─── 4b. El detalle por lote: pasada × producto × clase × calibre ───────────
drop materialized view if exists public.clasificacion_lote_detalle_mv;

create materialized view public.clasificacion_lote_detalle_mv as
select
  lote_codigo_base                                  as lote8,
  fecha,
  batch_id,
  fuente,
  lote_codigo,
  producto,
  clase,
  public.clase_letra(clase)                         as letra,
  public.clase_destino(grupo_destino, clase)        as destino,
  coalesce(nullif(btrim(tamano), ''), '—')          as tamano,
  sum(peso_kg)::numeric                             as kg,
  sum(piezas)::numeric                              as piezas,
  count(*)::integer                                 as n_filas
from public.clasificacion_lote
where lote_codigo_base is not null
group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
with no data;

create index if not exists clasificacion_lote_detalle_mv_lote8_idx on public.clasificacion_lote_detalle_mv (lote8);
grant select on public.clasificacion_lote_detalle_mv to authenticated, service_role;
revoke all on public.clasificacion_lote_detalle_mv from anon;

-- El detalle de una lista de lotes, posicional (contrato con
-- src/hooks/useAprovechamientoReal.ts): 0 lote8, 1 fecha, 2 batch_id,
-- 3 fuente, 4 lote_codigo, 5 producto, 6 clase, 7 letra, 8 destino, 9 tamano,
-- 10 kg, 11 piezas. Y la frescura de cada fuente, para decir hasta qué día
-- llega el dato (aprendido el 18-08-2026: sin esto, un volcado parado se lee
-- como si estuviera al día).
create or replace function public.clasificacion_detalle_lotes(lotes text[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'refrescado_en', (select refrescado_en from public.clasificacion_lote_mix_meta where id),
    'ultima_pasada_sql', (select max(inicio) from public.calibrador_batch),
    'ultima_sincronizacion', (select max(sincronizado_at) from public.calibrador_batch),
    'ultimo_docx', (select max(fecha) from public.calibrador_informe where batch_id < 0),
    'ultimo_parte', (select max(date) from public.partes_diarios),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_array(
        lote8, fecha, batch_id, fuente, lote_codigo, producto, clase, letra, destino, tamano, kg, piezas
      ) order by lote8, fecha, batch_id)
      from public.clasificacion_lote_detalle_mv
      where lote8 = any(lotes)
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.clasificacion_detalle_lotes(text[]) to authenticated, service_role;

-- ─── Refresco: las dos materializadas de una vez ────────────────────────────
create or replace function public.refrescar_clasificacion_lote_mix()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view public.clasificacion_lote_mix_mv;
  refresh materialized view public.clasificacion_lote_detalle_mv;
  update public.clasificacion_lote_mix_meta
     set refrescado_en = now()
   where id;
end;
$$;
revoke all on function public.refrescar_clasificacion_lote_mix() from public, anon, authenticated;
grant execute on function public.refrescar_clasificacion_lote_mix() to service_role;

select public.refrescar_clasificacion_lote_mix();
