-- Informe semanal automático (10-08-2026): registro de envíos + programación.
--
-- La edge function informe-semanal genera cada martes el correo de la semana
-- ISO anterior con el MISMO cálculo que "Económico → Rentabilidad del día"
-- (supabase/functions/_shared/rentabilidadDia.ts, compartida frontend/Deno)
-- y lo envía por Resend. Esta migración crea su tabla de registro
-- (idempotencia + auditoría + anti-spam) y el job de pg_cron que la invoca.

create table if not exists public.informe_semanal_envios (
  id uuid primary key default gen_random_uuid(),
  anio integer not null,
  semana integer not null,
  enviado_at timestamptz not null default now(),
  destinatarios text[] not null,
  asunto text not null,
  beneficio_eur numeric,
  kg_total numeric,
  avisos jsonb not null default '[]'::jsonb,
  -- 'enviado' | 'error' (detalle guarda el id de Resend o el mensaje de error)
  estado text not null default 'enviado',
  detalle text
);

comment on table public.informe_semanal_envios is
  'Registro de envíos del informe semanal automático (edge function informe-semanal). Una fila por intento; la función no reenvía una semana ya enviada salvo force=true.';

create index if not exists informe_semanal_envios_semana_idx
  on public.informe_semanal_envios (anio, semana);

-- Solo la service role de la edge function lee/escribe: RLS sin políticas.
alter table public.informe_semanal_envios enable row level security;

-- Programación: martes 05:00 UTC (07:00 Madrid en verano, 06:00 en invierno).
-- Martes y no lunes A PROPÓSITO: la asistencia se vuelca los lunes por semanas
-- completas — el lunes por la mañana el personal de la semana anterior aún
-- saldría a 0 € y el informe llegaría con el beneficio inflado.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'informe-semanal-martes') then
    perform cron.unschedule('informe-semanal-martes');
  end if;
end
$do$;

-- La anon key solo pasa el verify_jwt de la función (es pública: viaja en el
-- bundle del frontend, misma exposición). Si algún día se rota, actualizar
-- este job. Los destinatarios NO viajan aquí: salen de los secretos de la
-- función (INFORME_SEMANAL_PARA), el body no puede desviar el informe.
select cron.schedule(
  'informe-semanal-martes',
  '0 5 * * 2',
  $job$
  select net.http_post(
    url := 'https://lhbmxmdjyrbhjcsazhqi.supabase.co/functions/v1/informe-semanal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoYm14bWRqeXJiaGpjc2F6aHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDUyMzksImV4cCI6MjA5MzA4MTIzOX0.5__CcpAeARN2A3lIkZqlS_J3FleK7mxMU4pIFqa_y6s'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);
