-- Reintento del informe semanal (31-08-2026).
--
-- El 17 y el 24-08 el informe semanal murió en silencio: pg_net encola el
-- http_post y marca "succeeded" pase lo que pase, la función cascó a medias
-- (fallo intermitente de recursos: al reintentar a mano funcionó) y no quedó
-- ni fila de envío ni latido. Dos capas de arreglo:
--   1. La función ahora LATE (sistema_latidos) al terminar y en su catch, y
--      está en el catálogo de saludTrabajos: el vigilante caza el silencio.
--   2. Este segundo disparo 25 minutos después. Es inocuo cuando el primero
--      funcionó (la función responde "ya_enviado" y no duplica) y salva el
--      lunes cuando el primero murió.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'informe-semanal-lunes-reintento') then
    perform cron.unschedule('informe-semanal-lunes-reintento');
  end if;
end
$do$;

select cron.schedule(
  'informe-semanal-lunes-reintento',
  '25 10 * * 1',
  $job$
  select net.http_post(
    url := 'https://lhbmxmdjyrbhjcsazhqi.supabase.co/functions/v1/informe-semanal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoYm14bWRqeXJiaGpjc2F6aHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDUyMzksImV4cCI6MjA5MzA4MTIzOX0.5__CcpAeARN2A3lIkZqlS_J3FleK7mxMU4pIFqa_y6s'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
