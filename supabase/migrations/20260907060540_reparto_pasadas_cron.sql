-- Cron del reparto canónico de pasadas compuestas (07-09-2026).
--
-- La edge function reparto-pasadas calcula, con las funciones puras de
-- _shared/calibradorReparto.ts, qué parte de cada pasada compuesta del
-- calibrador ("26013107+26012608") va a cada lote, y lo deja en
-- calibrador_pasada_reparto / calibrador_pasada_sin_repartir (migración
-- 20260907054641_reparto_pasadas_canonico). Aquí solo se programa.
--
-- Cada hora en horario de trabajo, a los :10 (05-20 UTC = 07:10-22:10 Madrid en
-- verano): los informes del Sizer y los desgloses manuales entran de día, y así
-- el reparto está recién hecho cuando el refresco de las materializadas
-- (`clasificacion-mix-refresco`, a los :20) las vuelve a construir. La edge NO
-- refresca las materializadas ella misma: refrescar_clasificacion_lote_mix()
-- tarda ~32 s y la API tiene statement_timeout de 8 s (rol authenticator).
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'reparto-pasadas-horario') then
    perform cron.unschedule('reparto-pasadas-horario');
  end if;
end
$do$;

-- Misma anon key que los otros jobs: solo pasa el verify_jwt de la función (es
-- pública, viaja en el bundle del frontend). La función escribe con la service
-- role desde sus propios secretos; el body no cambia qué se reparte.
select cron.schedule(
  'reparto-pasadas-horario',
  '10 5-20 * * *',
  $job$
  select net.http_post(
    url := 'https://lhbmxmdjyrbhjcsazhqi.supabase.co/functions/v1/reparto-pasadas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoYm14bWRqeXJiaGpjc2F6aHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDUyMzksImV4cCI6MjA5MzA4MTIzOX0.5__CcpAeARN2A3lIkZqlS_J3FleK7mxMU4pIFqa_y6s'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
