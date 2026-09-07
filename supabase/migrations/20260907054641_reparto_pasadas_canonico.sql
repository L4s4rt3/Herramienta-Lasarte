-- El reparto de las pasadas compuestas del calibrador pasa a ser CANÓNICO
-- (07-09-2026).
--
-- EL PROBLEMA. El Sizer atribuye TODA una pasada al primer código de su nombre,
-- pero el operario escribe lo que echó de verdad ("26013107+26012608",
-- "26050707+4 BOX 26043009"): 73 pasadas y 1,22 M kg —el 5,6 % de la campaña—
-- cargados enteros a un lote cuando eran de varios. El reparto ya existía como
-- funciones puras con tests (calibradorReparto.ts: por box escritos, o por
-- capacidad pendiente en el orden del nombre, la fase 1 de la regla del dueño
-- del 21-07-2026 en conciliacionKg.ts), pero SOLO se aplicaba en el navegador,
-- en una pantalla. La vista canónica, sus materializadas, el dossier de
-- productores, la campaña y la merma seguían dando el 100 % al primer código.
--
-- LA SOLUCIÓN. Una edge function (reparto-pasadas) calcula el reparto UNA vez
-- con esas mismas funciones y lo deja en calibrador_pasada_reparto; la vista
-- clasificacion_lote multiplica cada fila por su fracción y pone en
-- lote_codigo_base el lote que RECIBE los kg. Todo lo que cuelga de la vista
-- (mix, detalle, podrido, dossier, aprovechamiento por productor) hereda el
-- reparto sin tocar nada más: un solo número en toda la app.
--
-- SEMÁNTICA de calibrador_pasada_reparto: una pasada SIN filas = 100 % al
-- primer código (como hasta hoy). Con filas: cada código nombrado que recibe kg
-- tiene la suya, incluido el primero con lo que le queda; las fracciones de una
-- pasada suman 1. Lo que no cabe en ningún lote nombrado, y el reciclaje que en
-- pantalla se "liberaba", se quedan en el primer código: la vista tiene que
-- conservar los kg totales del día. Precedencia: desglose manual de una persona
-- (pasada_box_lineas) > box escritos en el nombre > capacidad pendiente > cola.
--
-- DOS CAMBIOS MÁS EN LA VISTA, de paso:
-- - lote_codigo de la rama del calibrador pasa a ser el NOMBRE CRUDO de la
--   pasada (batch_name), como ya lo era en las otras dos ramas. Hasta hoy era el
--   código limpio, y por eso ninguna pantalla que lea la vista podía saber que
--   una pasada era compuesta (la de aprovechamiento real decía "0 compuestas").
--   Quien use lote_codigo como CLAVE de lote tiene que pasar a lote_codigo_base.
-- - Dos columnas al final: fraccion_reparto (1 si no hay reparto) y
--   reparto_metodo ('manual' | 'box' | 'capacidad' | null).

-- ─── 1. Las dos tablas que escribe la edge ──────────────────────────────────
create table if not exists public.calibrador_pasada_reparto (
  batch_id      integer     not null,
  lote8         text        not null,
  fraccion      numeric     not null check (fraccion > 0 and fraccion <= 1),
  kg            numeric     not null,
  metodo        text        not null check (metodo in ('manual', 'box', 'capacidad')),
  orden         integer     not null,
  calculado_en  timestamptz not null default now(),
  primary key (batch_id, lote8)
);
comment on table public.calibrador_pasada_reparto is
  'Reparto canónico de las pasadas compuestas del calibrador entre los lotes que nombran (lo calcula la edge reparto-pasadas). Sin filas = 100 % al primer código.';

create table if not exists public.calibrador_pasada_sin_repartir (
  batch_id      integer     primary key,
  batch_name    text,
  fecha         date,
  kg_total      numeric,
  motivo        text,
  calculado_en  timestamptz not null default now()
);
comment on table public.calibrador_pasada_sin_repartir is
  'Pasadas compuestas que no se pueden repartir solas (precalibrado por fecha sin resolver, nombre que no se puede trocear…) y por qué. Las decide una persona.';

alter table public.calibrador_pasada_reparto enable row level security;
alter table public.calibrador_pasada_sin_repartir enable row level security;
drop policy if exists "calibrador_pasada_reparto_select" on public.calibrador_pasada_reparto;
create policy "calibrador_pasada_reparto_select" on public.calibrador_pasada_reparto for select to authenticated using (true);
drop policy if exists "calibrador_pasada_sin_repartir_select" on public.calibrador_pasada_sin_repartir;
create policy "calibrador_pasada_sin_repartir_select" on public.calibrador_pasada_sin_repartir for select to authenticated using (true);
revoke all on public.calibrador_pasada_reparto from anon;
revoke all on public.calibrador_pasada_sin_repartir from anon;
grant select on public.calibrador_pasada_reparto to authenticated;
grant select on public.calibrador_pasada_sin_repartir to authenticated;
grant all on public.calibrador_pasada_reparto to service_role;
grant all on public.calibrador_pasada_sin_repartir to service_role;

-- ─── 2. La vista canónica con el reparto ────────────────────────────────────
create or replace view public.clasificacion_lote
with (security_invoker = on)
as
 WITH cal AS (
         SELECT c.batch_id,
            b.lote,
            COALESCE(b.batch_name, b.lote) AS nombre,
            COALESCE(r.lote8, "substring"(b.lote, '\d{8}'::text)) AS lote8,
            COALESCE(r.fraccion, 1::numeric) AS fraccion_reparto,
            r.metodo AS reparto_metodo,
            (b.inicio AT TIME ZONE 'Europe/Madrid'::text)::date AS fecha,
            b.inicio,
            b.fin,
            c.producto,
            c.calidad,
            c.clase,
            c.grupo_destino,
            c.tamano,
            c.piezas * COALESCE(r.fraccion, 1::numeric) AS piezas,
            c.peso_kg * COALESCE(r.fraccion, 1::numeric) AS peso_kg,
            c.cartons * COALESCE(r.fraccion, 1::numeric) AS cartons
           FROM calibrador_clasificacion c
             JOIN calibrador_batch b ON b.batch_id = c.batch_id
             LEFT JOIN calibrador_pasada_reparto r ON r.batch_id = c.batch_id
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
         SELECT DISTINCT (b.inicio AT TIME ZONE 'Europe/Madrid'::text)::date AS fecha,
            "substring"(b.lote, '\d{8}'::text) AS base8
           FROM calibrador_batch b
          WHERE EXISTS ( SELECT 1
                   FROM calibrador_clasificacion c
                  WHERE c.batch_id = b.batch_id AND c.batch_id > 0)
        )
 SELECT md5((((((((((((cal.batch_id::text || '|'::text) || COALESCE(cal.producto, ''::text)) || '|'::text) || COALESCE(cal.calidad, ''::text)) || '|'::text) || COALESCE(cal.clase, ''::text)) || '|'::text) || COALESCE(cal.tamano, ''::text)) || '|'::text) || COALESCE(cal.grupo_destino, ''::text)) || '|'::text) || COALESCE(cal.lote8, ''::text))::uuid AS id,
    pa.id AS part_id,
    NULL::uuid AS user_id,
    NULL::uuid AS archivo_id,
    NULL::uuid AS lote_dia_id,
    cal.nombre AS lote_codigo,
    cal.lote8 AS lote_codigo_base,
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
    cal.piezas / NULLIF(sum(cal.piezas) OVER (PARTITION BY cal.lote8), 0::numeric) AS pct_piezas,
    cal.peso_kg,
    cal.peso_kg / NULLIF(sum(cal.peso_kg) OVER (PARTITION BY cal.lote8), 0::numeric) AS pct_peso,
    cal.cartons,
    cal.cartons / NULLIF(sum(cal.cartons) OVER (PARTITION BY cal.lote8), 0::numeric) AS pct_cartons,
    cal.inicio AS created_at,
    'calibrador'::text AS fuente,
    COALESCE(pd.fraccion, 1::numeric) AS fraccion_productor,
    cal.batch_id,
    cal.fraccion_reparto,
    cal.reparto_metodo
   FROM cal
     LEFT JOIN productor_lote_dominante pd ON pd.lote = cal.lote8
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
    NULL::integer AS batch_id,
    1::numeric AS fraccion_reparto,
    NULL::text AS reparto_metodo
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
 SELECT md5((((((((((((c.batch_id::text || '|'::text) || COALESCE(c.producto, ''::text)) || '|'::text) || COALESCE(c.calidad, ''::text)) || '|'::text) || COALESCE(c.clase, ''::text)) || '|'::text) || COALESCE(c.tamano, ''::text)) || '|'::text) || COALESCE(c.grupo_destino, ''::text)) || '|'::text) || COALESCE(r.lote8, ''::text))::uuid AS id,
    pa.id AS part_id,
    NULL::uuid AS user_id,
    NULL::uuid AS archivo_id,
    NULL::uuid AS lote_dia_id,
    d.lote AS lote_codigo,
    COALESCE(r.lote8, d.base8) AS lote_codigo_base,
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
    c.piezas * COALESCE(r.fraccion, 1::numeric) AS piezas,
    c.pct_piezas,
    c.peso_kg * COALESCE(r.fraccion, 1::numeric) AS peso_kg,
    c.pct_peso,
    c.cartons * COALESCE(r.fraccion, 1::numeric) AS cartons,
    c.pct_cartons,
    d.recibido_at AS created_at,
    'docx'::text AS fuente,
    COALESCE(pd.fraccion, 1::numeric) AS fraccion_productor,
    c.batch_id,
    COALESCE(r.fraccion, 1::numeric) AS fraccion_reparto,
    r.metodo AS reparto_metodo
   FROM docx_inf d
     JOIN calibrador_clasificacion c ON c.batch_id = d.batch_id
     LEFT JOIN calibrador_pasada_reparto r ON r.batch_id = c.batch_id
     LEFT JOIN productor_lote_dominante pd ON pd.lote = COALESCE(r.lote8, d.base8, d.lote)
     LEFT JOIN partes_diarios pa ON pa.date = d.fecha;

-- ─── 3. El podrido por lote agrupa por el lote que RECIBE ───────────────────
-- Antes agrupaba por los 8 primeros dígitos de lote_codigo: con el nombre crudo
-- eso volvería a ser el primer código y el reparto se perdería justo aquí (es
-- lo que alimenta la merma: kg de calibrador y podrido por lote).
create or replace view public.lote_clasificacion_podrido_agg
with (security_invoker = on)
as
 SELECT lote_codigo_base AS lote8,
    sum(peso_kg) AS kg_total,
    sum(peso_kg) FILTER (WHERE clase ~~* '%podrido%'::text) AS kg_podrido,
    count(*) AS n_filas
   FROM clasificacion_lote
  WHERE lote_codigo_base IS NOT NULL
  GROUP BY lote_codigo_base;

-- ─── 4. El detalle materializado lleva la fracción y el método ──────────────
drop function if exists public.clasificacion_detalle_lotes(text[]);
drop function if exists public.rentabilidad_filas_dias(date, date);
drop materialized view if exists public.clasificacion_lote_detalle_mv;

create materialized view public.clasificacion_lote_detalle_mv as
select
  lote_codigo_base                                  as lote8,
  fecha,
  batch_id,
  fuente,
  lote_codigo,
  productor,
  producto,
  clase,
  public.clase_letra(clase)                         as letra,
  public.clase_destino(grupo_destino, clase)        as destino,
  coalesce(nullif(btrim(tamano), ''), '—')          as tamano,
  fraccion_reparto,
  reparto_metodo,
  max(duracion_min)::numeric                        as duracion_min,
  max(toneladas_hora)::numeric                      as toneladas_hora,
  sum(peso_kg)::numeric                             as kg,
  sum(piezas)::numeric                              as piezas,
  count(*)::integer                                 as n_filas
from public.clasificacion_lote
where lote_codigo_base is not null
group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
with no data;

create index if not exists clasificacion_lote_detalle_mv_lote8_idx on public.clasificacion_lote_detalle_mv (lote8);
create index if not exists clasificacion_lote_detalle_mv_fecha_idx on public.clasificacion_lote_detalle_mv (fecha);
grant select on public.clasificacion_lote_detalle_mv to authenticated, service_role;
revoke all on public.clasificacion_lote_detalle_mv from anon;

-- Posicional (contrato con src/hooks/useAprovechamientoReal.ts): 0 lote8,
-- 1 fecha, 2 batch_id, 3 fuente, 4 lote_codigo, 5 producto, 6 clase, 7 letra,
-- 8 destino, 9 tamano, 10 kg, 11 piezas, 12 fraccion_reparto, 13 reparto_metodo.
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
        lote8, fecha, batch_id, fuente, lote_codigo, producto, clase, letra, destino, tamano, kg, piezas,
        fraccion_reparto, reparto_metodo
      ) order by lote8, fecha, batch_id)
      from public.clasificacion_lote_detalle_mv
      where lote8 = any(lotes)
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.clasificacion_detalle_lotes(text[]) to authenticated, service_role;

-- Sin cambios de contrato: 0 fecha, 1 lote_codigo, 2 productor, 3 producto,
-- 4 clase, 5 kg, 6 duracion_min, 7 toneladas_hora. Con el reparto, una pasada
-- compuesta sale en dos filas (una por productor receptor) con el MISMO
-- lote_codigo crudo; computeRentabilidadDia agrupa por ese texto y suma, así
-- que el día no cambia.
create or replace function public.rentabilidad_filas_dias(desde date, hasta date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'refrescado_en', (select refrescado_en from public.clasificacion_lote_mix_meta where id),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_array(
        x.fecha, x.lote_codigo, x.productor, x.producto, x.clase, x.kg, x.duracion_min, x.toneladas_hora
      ) order by x.fecha, x.lote_codigo, x.producto, x.clase)
      from (
        select fecha, lote_codigo, productor, producto, clase,
               sum(kg) as kg, max(duracion_min) as duracion_min, max(toneladas_hora) as toneladas_hora
        from public.clasificacion_lote_detalle_mv
        where fecha between desde and hasta
        group by 1, 2, 3, 4, 5
      ) x
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.rentabilidad_filas_dias(date, date) to authenticated, service_role;

-- ─── 5. Las pasadas candidatas al reparto: también las separadas por guion ──
-- El filtro solo cazaba nombres con "+", "box", "prec" o una fecha; los
-- "26030208-26030308" (dos códigos con guion) se quedaban fuera. Ahora entra
-- cualquier nombre con dos grupos de 8 dígitos.
CREATE OR REPLACE FUNCTION public.calibrador_pasadas_con_desglose(
  desde date DEFAULT NULL,
  hasta date DEFAULT NULL
)
RETURNS TABLE (
  batch_id integer,
  batch_name text,
  lote text,
  fecha date,
  kg_total numeric,
  kg_exportacion numeric,
  kg_no_exportacion numeric,
  kg_industria numeric,
  kg_mujeres numeric,
  kg_otros numeric
)
LANGUAGE sql
STABLE
AS $function$
  with g as (
    select cb.batch_id, cb.batch_name, cb.lote, (cb.inicio at time zone 'Europe/Madrid')::date as fecha,
           cc.peso_kg,
           translate(upper(coalesce(cc.grupo_destino, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') as grupo
    from public.calibrador_batch cb
    join public.calibrador_clasificacion cc on cc.batch_id = cb.batch_id
    where cc.batch_id > 0
      and cb.lote ~ '^\d{8}$'
      and (cb.batch_name ~* 'box|prec|recicl|\+|[0-9]{1,2}/[0-9]{1,2}' or cb.batch_name ~ '\d{8}.*\d{8}')
      and (desde is null or (cb.inicio at time zone 'Europe/Madrid')::date >= desde)
      and (hasta is null or (cb.inicio at time zone 'Europe/Madrid')::date <= hasta)
  )
  select batch_id, batch_name, lote, fecha,
         round(sum(peso_kg), 4),
         round(sum(peso_kg) filter (where grupo = 'EXPORTACION'), 4),
         round(sum(peso_kg) filter (where grupo = 'NO EXPORTACION'), 4),
         round(sum(peso_kg) filter (where grupo like '%INDUSTRIA%' or grupo = 'NO COMERCIAL'), 4),
         round(sum(peso_kg) filter (where grupo = 'MUJERES'), 4),
         round(sum(peso_kg) filter (where grupo not in ('EXPORTACION','NO EXPORTACION','MUJERES','NO COMERCIAL')
                                          and grupo not like '%INDUSTRIA%'), 4)
  from g
  group by batch_id, batch_name, lote, fecha;
$function$;

-- ─── 6. El aprovechamiento por productor lee la vista canónica ──────────────
-- Misma firma y columnas que antes. Antes agregaba las tablas crudas y el
-- reparto lo hacía cada navegador a su manera; ahora sale de la vista, con el
-- reparto ya aplicado y el productor resuelto por el lote que RECIBE los kg
-- (productor_lote: una re-entrada de precalibrado se reparte entre sus fincas
-- de origen por su fracción, como hacía la versión anterior).
CREATE OR REPLACE FUNCTION public.calibrador_aprovechamiento_productor(desde date DEFAULT NULL::date, hasta date DEFAULT NULL::date)
 RETURNS TABLE(productor_id uuid, productor text, lotes bigint, kg_total numeric, kg_exportacion numeric, kg_no_exportacion numeric, kg_industria numeric, kg_mujeres numeric, kg_otros numeric, pct_exportacion numeric, kg_provisional numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with filas as (
    select cl.lote_codigo_base as lote_base,
           cl.peso_kg,
           cl.fuente = 'docx' as provisional,
           translate(upper(coalesce(cl.grupo_destino, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') as grupo
      from public.clasificacion_lote cl
     where cl.fuente in ('calibrador', 'docx')
       and (desde is null or cl.fecha >= desde)
       and (hasta is null or cl.fecha <= hasta)
  ),
  atribuido as (
    select f.lote_base, f.grupo, f.provisional,
           f.peso_kg * coalesce(pl.fraccion, 1) as kg,
           pl.productor_id,
           case when f.lote_base is null then '(sin lote legible en el calibrador)'
                else coalesce(pl.productor, '(lote sin entrada de bascula)') end as productor_nombre
      from filas f
      left join public.productor_lote pl on pl.lote = f.lote_base
  )
  select productor_id, productor_nombre as productor,
         count(distinct lote_base) as lotes,
         round(sum(kg)) as kg_total,
         round(sum(kg) filter (where grupo = 'EXPORTACION')) as kg_exportacion,
         round(sum(kg) filter (where grupo = 'NO EXPORTACION')) as kg_no_exportacion,
         round(sum(kg) filter (where grupo like '%INDUSTRIA%' or grupo = 'NO COMERCIAL')) as kg_industria,
         round(sum(kg) filter (where grupo = 'MUJERES')) as kg_mujeres,
         round(sum(kg) filter (where grupo not in ('EXPORTACION','NO EXPORTACION','MUJERES','NO COMERCIAL')
                                 and grupo not like '%INDUSTRIA%')) as kg_otros,
         round(100.0 * sum(kg) filter (where grupo = 'EXPORTACION') / nullif(sum(kg), 0), 1) as pct_exportacion,
         round(sum(kg) filter (where provisional)) as kg_provisional
    from atribuido
   group by productor_id, productor_nombre
   order by kg_total desc;
$function$;

select public.refrescar_clasificacion_lote_mix();
