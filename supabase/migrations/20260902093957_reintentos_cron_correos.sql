-- Reintento para los tres cron de correo que no lo tenían (02-09-2026).
--
-- El informe semanal ya tenía segundo disparo desde el 31-08 (los lunes 17 y
-- 24-08 murió en silencio: pg_net encola y dice "succeeded" pase lo que pase).
-- Ventas Mercadona, el vigía de negocio y el cierre mensual corrían UNA vez, y
-- el cierre mensual es el más caro de perder: el siguiente intento natural es
-- dentro de un mes. Los tres son idempotentes: ventas y cierre consultan su
-- tabla *_envios y responden "ya_enviado"; el vigía solo avisa de hallazgos
-- NUEVOS (vigia_hallazgos) y no repite el correo del día (sistema_ejecuciones).
-- Así que el segundo disparo es inocuo cuando el primero fue bien y salva el
-- día cuando murió.
--
-- La anon key va literal, como en los demás jobs: es pública (viaja en el
-- bundle de la app) y verify_jwt solo exige un JWT válido del proyecto.
-- Si algún día se rota, hay que reprogramar los 9 jobs (grep 'Bearer eyJ').

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
declare j text;
begin
  foreach j in array array['ventas-mercadona-lunes-reintento', 'vigia-negocio-diario-reintento', 'cierre-mensual-dia1-reintento'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end
$do$;

-- Ventas Mercadona: 08:00 UTC los lunes → reintento 08:25.
select cron.schedule(
  'ventas-mercadona-lunes-reintento',
  '25 8 * * 1',
  $job$
  select net.http_post(
    url := 'https://lhbmxmdjyrbhjcsazhqi.supabase.co/functions/v1/ventas-mercadona-semanal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoYm14bWRqeXJiaGpjc2F6aHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDUyMzksImV4cCI6MjA5MzA4MTIzOX0.5__CcpAeARN2A3lIkZqlS_J3FleK7mxMU4pIFqa_y6s'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- Vigía de negocio: 12:15 UTC diario → reintento 12:40 (sigue siendo después
-- del vigilante de las 11:45, al que también vigila).
select cron.schedule(
  'vigia-negocio-diario-reintento',
  '40 12 * * *',
  $job$
  select net.http_post(
    url := 'https://lhbmxmdjyrbhjcsazhqi.supabase.co/functions/v1/vigia-negocio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoYm14bWRqeXJiaGpjc2F6aHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDUyMzksImV4cCI6MjA5MzA4MTIzOX0.5__CcpAeARN2A3lIkZqlS_J3FleK7mxMU4pIFqa_y6s'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- Cierre mensual: 05:45 UTC del día 1 → reintento 06:15.
select cron.schedule(
  'cierre-mensual-dia1-reintento',
  '15 6 1 * *',
  $job$
  select net.http_post(
    url := 'https://lhbmxmdjyrbhjcsazhqi.supabase.co/functions/v1/cierre-mensual',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoYm14bWRqeXJiaGpjc2F6aHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDUyMzksImV4cCI6MjA5MzA4MTIzOX0.5__CcpAeARN2A3lIkZqlS_J3FleK7mxMU4pIFqa_y6s'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
