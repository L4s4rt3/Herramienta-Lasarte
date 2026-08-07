-- Tablas del módulo de RRHH: nóminas, vacaciones, horas, justificantes,
-- amonestaciones y comunicaciones.
--
-- CONTEXTO (recuperadas al repo el 07-ago-2026): las seis existían en
-- producción sin ninguna migración que las creara — se aplicaron desde el
-- panel/MCP y su SQL nunca se commiteó, así que el esquema no era
-- reproducible desde cero. Se vuelcan tal cual están en la base, leídas del
-- catálogo.
--
-- IDEMPOTENTE A PROPÓSITO: describe algo YA aplicado, así que debe poder
-- ejecutarse contra una base que ya lo tiene. Restricciones en línea dentro
-- del `create table if not exists` y `drop policy if exists` delante de cada
-- política.
--
-- ACCESO: las seis son DATOS DE PERSONAL, así que ninguna se comparte con el
-- resto de la plantilla. Todas llevan la misma política: solo `admin` o
-- `rrhh`, para leer y para escribir. Es la diferencia con el resto del
-- esquema, donde lo normal es "cualquiera autenticado lee". Al añadir una
-- tabla nueva a este módulo, copiar esta política, no la genérica.
--
-- Todas cuelgan de `trabajadores` con borrado en cascada (migración
-- 20260519000001_asistencia_trabajadores.sql), salvo rrhh_comunicaciones, que
-- guarda los destinatarios en un jsonb porque un envío puede incluir a gente
-- que ya no está en plantilla.

create table if not exists public.rrhh_nominas (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  trabajador_id uuid not null,
  anio integer not null,
  mes integer not null,
  archivo_path text,
  archivo_nombre text,
  notas text,
  created_at timestamp with time zone default now() not null,
  constraint rrhh_nominas_pkey primary key (id),
  constraint rrhh_nominas_trabajador_id_anio_mes_key unique (trabajador_id, anio, mes),
  constraint rrhh_nominas_trabajador_id_fkey foreign key (trabajador_id) references public.trabajadores(id) on delete cascade,
  constraint rrhh_nominas_mes_check check (((mes >= 1) and (mes <= 12)))
);
alter table public.rrhh_nominas enable row level security;

create table if not exists public.rrhh_vacaciones_periodos (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  trabajador_id uuid not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  dias_naturales numeric not null,
  notas text,
  created_at timestamp with time zone default now() not null,
  constraint rrhh_vacaciones_periodos_pkey primary key (id),
  constraint rrhh_vacaciones_periodos_trabajador_id_fkey foreign key (trabajador_id) references public.trabajadores(id) on delete cascade,
  constraint rrhh_vacaciones_periodos_check check ((fecha_fin >= fecha_inicio))
);
alter table public.rrhh_vacaciones_periodos enable row level security;

create table if not exists public.rrhh_horas (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  trabajador_id uuid not null,
  fecha date not null,
  horas numeric not null,
  motivo text,
  created_at timestamp with time zone default now() not null,
  constraint rrhh_horas_pkey primary key (id),
  constraint rrhh_horas_trabajador_id_fkey foreign key (trabajador_id) references public.trabajadores(id) on delete cascade
);
alter table public.rrhh_horas enable row level security;

create table if not exists public.rrhh_justificantes (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  trabajador_id uuid not null,
  fecha date not null,
  notas text,
  archivo_path text,
  archivo_nombre text,
  created_at timestamp with time zone default now() not null,
  constraint rrhh_justificantes_pkey primary key (id),
  constraint rrhh_justificantes_trabajador_id_fkey foreign key (trabajador_id) references public.trabajadores(id) on delete cascade
);
alter table public.rrhh_justificantes enable row level security;

create table if not exists public.rrhh_amonestaciones (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  trabajador_id uuid not null,
  fecha date not null,
  motivo text not null,
  gravedad text default 'leve'::text not null,
  archivo_path text,
  archivo_nombre text,
  notas text,
  created_at timestamp with time zone default now() not null,
  constraint rrhh_amonestaciones_pkey primary key (id),
  constraint rrhh_amonestaciones_trabajador_id_fkey foreign key (trabajador_id) references public.trabajadores(id) on delete cascade,
  constraint rrhh_amonestaciones_gravedad_check check ((gravedad = any (array['leve'::text, 'grave'::text, 'muy_grave'::text])))
);
alter table public.rrhh_amonestaciones enable row level security;

create table if not exists public.rrhh_comunicaciones (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  tipo text default 'personalizado'::text not null,
  asunto text not null,
  cuerpo text not null,
  destinatarios jsonb default '[]'::jsonb not null,
  estado text default 'enviado'::text not null,
  detalle_envio jsonb,
  enviado_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint rrhh_comunicaciones_pkey primary key (id),
  constraint rrhh_comunicaciones_tipo_check check ((tipo = any (array['personalizado'::text, 'aviso_horas'::text, 'aviso_vacaciones'::text, 'aviso_generico'::text]))),
  constraint rrhh_comunicaciones_estado_check check ((estado = any (array['borrador'::text, 'enviado'::text, 'error'::text, 'parcial'::text])))
);
alter table public.rrhh_comunicaciones enable row level security;

-- Misma política para las seis: datos de personal, solo admin o rrhh.
do $$
declare tabla text;
begin
  foreach tabla in array array[
    'rrhh_nominas', 'rrhh_vacaciones_periodos', 'rrhh_horas',
    'rrhh_justificantes', 'rrhh_amonestaciones', 'rrhh_comunicaciones'
  ] loop
    execute format('drop policy if exists %I on public.%I', tabla || '_solo_rrhh_admin', tabla);
    execute format(
      'create policy %I on public.%I for all using ((has_role(auth.uid(), ''admin''::text) or has_role(auth.uid(), ''rrhh''::text))) with check ((has_role(auth.uid(), ''admin''::text) or has_role(auth.uid(), ''rrhh''::text)))',
      tabla || '_solo_rrhh_admin', tabla
    );
  end loop;
end $$;
