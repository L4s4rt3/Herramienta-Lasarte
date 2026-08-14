-- Fase 1 de observabilidad (docs/SISTEMA_LASARTE.md): el rastro de los trabajos
-- automáticos, EN LA BASE y no en ficheros del portátil.
--
-- POR QUÉ. Todo el flujo diario de datos corre como tareas programadas de un
-- portátil de la oficina, y su rastro (log-tarea-diaria.txt, registro.jsonl)
-- vive en ese mismo portátil: si el equipo no arranca, no hay ni datos NI señal
-- de que faltan — la "alarma" era que no llegara el correo de las 07:10, y una
-- ausencia no la nota nadie. Con el rastro en la base, la página "Estado de las
-- fuentes" lo enseña a cualquiera, y el vigilante (edge function, FUERA del
-- portátil) puede avisar por correo cuando el portátil no da señales.

-- El último estado conocido de cada trabajo: una fila por trabajo (upsert).
-- Es lo que miran la página y el vigilante. Para procesos largos (el receptor)
-- es literalmente su latido, cada 5 minutos.
create table if not exists public.sistema_latidos (
  trabajo text primary key,
  visto_a timestamptz not null default now(),
  -- 'corriendo' | 'ok' | 'aviso' | 'error'
  estado text not null default 'ok',
  detalle text,
  equipo text
);

comment on table public.sistema_latidos is
  'Último estado conocido de cada trabajo automático (tareas del portátil, receptor, funciones edge). Una fila por trabajo, por upsert; el histórico vive en sistema_ejecuciones. La lógica que lo interpreta está en supabase/functions/_shared/saludTrabajos.ts.';

-- El histórico: una fila por ejecución TERMINADA. Los latidos periódicos del
-- receptor no van aquí a propósito: serían 200 filas al día sin decir nada.
create table if not exists public.sistema_ejecuciones (
  id bigint generated always as identity primary key,
  trabajo text not null,
  inicio timestamptz,
  fin timestamptz not null default now(),
  -- 'ok' | 'aviso' | 'error'
  estado text not null,
  detalle text,
  equipo text,
  datos jsonb not null default '{}'::jsonb
);

comment on table public.sistema_ejecuciones is
  'Una fila por ejecución de cada trabajo automático (tarea diaria, foto de palets, buzón, vigilante…). Escriben los scripts con la service role vía scripts/lib-registro-ejecuciones.mjs; el vigilante borra lo de más de 90 días.';

create index if not exists sistema_ejecuciones_trabajo_idx
  on public.sistema_ejecuciones (trabajo, fin desc);

-- Cualquier usuario autenticado LEE (la página /datos/fuentes); escriben solo
-- los scripts y las funciones edge con la service role: sin política de escritura.
alter table public.sistema_latidos enable row level security;
alter table public.sistema_ejecuciones enable row level security;

drop policy if exists "leer latidos" on public.sistema_latidos;
create policy "leer latidos" on public.sistema_latidos
  for select to authenticated using (true);

drop policy if exists "leer ejecuciones" on public.sistema_ejecuciones;
create policy "leer ejecuciones" on public.sistema_ejecuciones
  for select to authenticated using (true);

-- ── Programación del vigilante ───────────────────────────────────────────────
-- Cada día a las 11:45 UTC (13:45 Madrid en verano, 12:45 en invierno): siempre
-- DESPUÉS de las 12:10, el último reintento de la tarea diaria, para no dar una
-- falsa alarma mientras el día todavía puede salvarse solo. En ambas estaciones.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'vigilante-diario') then
    perform cron.unschedule('vigilante-diario');
  end if;
end
$do$;

-- Misma anon key que informe-semanal-martes: solo pasa el verify_jwt de la
-- función (es pública, viaja en el bundle del frontend). Los destinatarios NO
-- viajan aquí: salen de los secretos de la función (VIGILANTE_PARA).
select cron.schedule(
  'vigilante-diario',
  '45 11 * * *',
  $job$
  select net.http_post(
    url := 'https://lhbmxmdjyrbhjcsazhqi.supabase.co/functions/v1/vigilante',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoYm14bWRqeXJiaGpjc2F6aHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDUyMzksImV4cCI6MjA5MzA4MTIzOX0.5__CcpAeARN2A3lIkZqlS_J3FleK7mxMU4pIFqa_y6s'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);
