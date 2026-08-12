-- Informes del calibrador (Compac Sizer), tal y como llegan por correo.
--
-- POR QUÉ TABLAS PROPIAS Y NO `lote_clasificacion`. Son los mismos datos, pero
-- escribir directamente allí es peligroso hoy:
--   1. `lote_clasificacion.part_id` es obligatorio y cuelga de un parte diario
--      que puede no existir todavía cuando el calibrador manda el informe.
--   2. Ese importador (useHistoricoImport) inserta sin clave única: comprueba si
--      la fecha ya tiene filas y si no, mete. Si el mismo lote entrara por las
--      dos vías —el DOCX del calibrador y el Excel que se importa a mano— la
--      clasificación quedaría duplicada y los kilos doblados.
--
-- Así que esto es un ESPEJO de lo que manda el calibrador, con clave natural
-- para que reenviar un informe no duplique nada. Cuando esté rodado se decide
-- cómo se junta con lo que ya hay; hasta entonces, ninguna vista existente
-- cambia de número.
--
-- Clave comprobada contra 3 informes reales (643 líneas, 0 claves repetidas).

create table if not exists public.calibrador_informe (
  lote                text primary key,
  commodity           text,
  productor           text,
  productor_codigo    text,
  fecha               date,
  comienzo            text,
  tiempo_maquina      text,
  tiempo_lote         text,
  utilizacion_pct     numeric,
  peso_fruta_media_g  numeric,
  conteo_fruta_medio  numeric,
  bins_hora           numeric,
  bins_ejecutados     numeric,
  toneladas_hora      numeric,
  cartons             numeric,
  cartons_hora        numeric,
  rechazo_pct         numeric,
  fichero             text,
  recibido_at         timestamptz not null default now()
);

comment on table public.calibrador_informe is
  'Cabecera del informe "Totales de Calidad Clase Tamaño Por Producto" del Compac Sizer. `lote` viene en formato de entrada (AAMMDDNN) y casa con entradas_bascula.lote.';
comment on column public.calibrador_informe.bins_ejecutados is
  'OJO: llega a 0 en algunos lotes y a 36 en otros del mismo dia. Sin confirmar que significa; no fiarse hasta preguntarlo en planta.';

create index if not exists calibrador_informe_fecha_idx on public.calibrador_informe (fecha);

create table if not exists public.calibrador_clasificacion (
  lote           text not null references public.calibrador_informe(lote) on delete cascade,
  producto       text not null,
  calidad        text not null default '',
  clase          text not null,
  tamano         text not null,
  grupo_destino  text,
  piezas         numeric,
  pct_piezas     numeric,
  peso_kg        numeric,
  pct_peso       numeric,
  cartons        numeric,
  pct_cartons    numeric,
  primary key (lote, producto, calidad, clase, tamano)
);

comment on table public.calibrador_clasificacion is
  'Detalle del informe: producto → calidad → clase (A-F) → tamaño. `grupo_destino` trae EXPORTACION / NO EXPORTACION / NO COMERCIAL / MUJERES, los mismos valores que ya usa la app.';

create index if not exists calibrador_clasificacion_grupo_idx
  on public.calibrador_clasificacion (grupo_destino);

alter table public.calibrador_informe enable row level security;
alter table public.calibrador_clasificacion enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                  where c.relname = 'calibrador_informe' and p.polname = 'calibrador_informe_select') then
    create policy calibrador_informe_select on public.calibrador_informe
      for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                  where c.relname = 'calibrador_clasificacion' and p.polname = 'calibrador_clasificacion_select') then
    create policy calibrador_clasificacion_select on public.calibrador_clasificacion
      for select using (auth.role() = 'authenticated');
  end if;
end $$;
