-- Correo semanal de ventas Mercadona (19-08-2026, encargo del dueño): "envíame
-- cada lunes las ventas de la semana de Mercadona" — kg, cajas y palets.
--
-- La edge function ventas-mercadona-semanal lee erp_palet (cliente MERCADONA
-- S.A.) de la semana ISO cerrada y lo envía por Resend. Corre en Supabase, no
-- en el portátil. Esta migración crea su registro (idempotencia + auditoría) y
-- el job de pg_cron.

create table if not exists public.ventas_mercadona_envios (
  id uuid primary key default gen_random_uuid(),
  anio integer not null,
  semana integer not null,
  enviado_at timestamptz not null default now(),
  destinatarios text[] not null,
  asunto text not null,
  palets integer,
  cajas integer,
  kg numeric,
  -- 'enviado' | 'error' (detalle guarda el id de Resend o el mensaje de error)
  estado text not null default 'enviado',
  detalle text
);

comment on table public.ventas_mercadona_envios is
  'Registro de envíos del correo semanal de ventas Mercadona (edge function ventas-mercadona-semanal). Una fila por intento; no reenvía una semana ya enviada salvo force=true.';

create index if not exists ventas_mercadona_envios_semana_idx
  on public.ventas_mercadona_envios (anio, semana);

-- Solo la service role de la edge function lee/escribe: RLS sin políticas.
alter table public.ventas_mercadona_envios enable row level security;

-- Programación: lunes 08:00 UTC (10:00 Madrid en verano, 09:00 en invierno).
-- El lunes la semana ISO anterior (lunes-domingo) está cerrada, y a esa hora la
-- sincronización del ERP ya ha dejado en erp_palet los palets de la semana.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'ventas-mercadona-lunes') then
    perform cron.unschedule('ventas-mercadona-lunes');
  end if;
end
$do$;

-- Misma anon key que los otros jobs: solo pasa el verify_jwt de la función (es
-- pública, viaja en el bundle del frontend). Los destinatarios NO viajan aquí:
-- salen del secreto VENTAS_MERCADONA_PARA de la función.
select cron.schedule(
  'ventas-mercadona-lunes',
  '0 8 * * 1',
  $job$
  select net.http_post(
    url := 'https://lhbmxmdjyrbhjcsazhqi.supabase.co/functions/v1/ventas-mercadona-semanal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoYm14bWRqeXJiaGpjc2F6aHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDUyMzksImV4cCI6MjA5MzA4MTIzOX0.5__CcpAeARN2A3lIkZqlS_J3FleK7mxMU4pIFqa_y6s'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);
