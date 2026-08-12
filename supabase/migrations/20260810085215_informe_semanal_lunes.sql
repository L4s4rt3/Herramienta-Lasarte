-- Informe semanal: pasa del martes 05:00 UTC al LUNES a las 12:00 hora de
-- Madrid (petición del dueño, 10-08-2026). El cron de pg_cron corre en UTC:
-- 10:00 UTC = 12:00 en verano (CEST); en invierno (CET) saldrá a las 11:00.
-- Matiz asumido: la asistencia también se vuelca los lunes — si a esa hora
-- aún no está cargada, el informe llega con su aviso en "Datos que faltan"
-- y sin kg por persona (nunca se estima en silencio).

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'informe-semanal-martes') then
    perform cron.unschedule('informe-semanal-martes');
  end if;
  if exists (select 1 from cron.job where jobname = 'informe-semanal-lunes') then
    perform cron.unschedule('informe-semanal-lunes');
  end if;
end
$do$;

-- La anon key solo pasa el verify_jwt de la función (es pública: viaja en el
-- bundle del frontend). Si se rota, actualizar este job.
select cron.schedule(
  'informe-semanal-lunes',
  '0 10 * * 1',
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
