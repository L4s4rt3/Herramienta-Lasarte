-- Vigía de NEGOCIO + cierre MENSUAL (31-08-2026, encargo del usuario: "que
-- funcione solo y nos dé información valiosa").
--
-- El vigilante (13:45) avisa cuando un TRABAJO deja de dar señales; el vigía
-- de negocio (14:15) avisa cuando los DATOS, estando vivos, cuentan algo que
-- cuesta dinero o se está quedando sin hacer: sobrellenado de malla, camiones
-- SAF sin cuadrar con su Laadbon, albaranes viejos sin factura, fruta parada
-- en cámara, mermas fuera de banda, partes con descuadre o papel sin meter, y
-- días rojos de rendimiento. La lógica vive en _shared/vigiaNegocio.ts (pura,
-- testeada con vitest); la edge function vigia-negocio la ejecuta a diario.
-- El cierre mensual (edge cierre-mensual) manda el día 1 el resumen del mes.

-- ── Hallazgos del vigía ──────────────────────────────────────────────────────
-- Dos clases: "evento" (pasó un día concreto; se avisa una vez y queda en el
-- histórico, nace ya resuelto) y "estado" (sigue mal hasta que alguien lo
-- arregla; se resuelve cuando deja de detectarse). La clave es la identidad
-- estable del hallazgo: la misma situación produce la misma clave.
create table if not exists public.vigia_hallazgos (
  id uuid primary key default gen_random_uuid(),
  regla text not null,
  clave text not null,
  tipo text not null check (tipo in ('evento', 'estado')),
  severidad text not null check (severidad in ('aviso', 'atencion')),
  titulo text not null,
  detalle text,
  eur numeric,
  kg numeric,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  resuelto_at timestamptz
);

comment on table public.vigia_hallazgos is
  'Hallazgos del vigía de negocio (edge function vigia-negocio, diaria). tipo evento = pasó un día concreto (nace resuelto, no se repite); tipo estado = abierto hasta que deja de detectarse. La lógica de detección vive en supabase/functions/_shared/vigiaNegocio.ts.';

-- Un estado solo puede estar abierto una vez por clave.
create unique index if not exists vigia_hallazgos_clave_abierta_idx
  on public.vigia_hallazgos (clave) where (resuelto_at is null);
create index if not exists vigia_hallazgos_clave_idx on public.vigia_hallazgos (clave);
create index if not exists vigia_hallazgos_creado_idx on public.vigia_hallazgos (creado_at);

alter table public.vigia_hallazgos enable row level security;
-- La app puede enseñarlos (solo lectura); escribe únicamente la service role.
drop policy if exists "vigia_hallazgos_select" on public.vigia_hallazgos;
create policy "vigia_hallazgos_select" on public.vigia_hallazgos
  for select to authenticated using (true);

-- ── Camiones SAF: lo que dice el Laadbon ─────────────────────────────────────
-- El precio REAL del camión es el del Laadbon de HG (€/caja); el alta del ERP
-- va a €/kg y puede valorar de más o de menos (camión 1: +1.790 €). Aquí se
-- teclea el Laadbon de cada camión y el vigía lo contrasta con la entrada
-- (entradas_bascula, mismo lote). Mientras un camión no esté aquí, el vigía
-- lo reclama.
create table if not exists public.saf_camiones (
  lote text primary key,
  fecha date,
  proveedor text not null default 'SAF · Uria Export (HG)',
  cajas integer not null,
  eur_caja numeric not null,
  porte_eur numeric,
  kg_neto_laadbon numeric,
  laadbon_ref text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.saf_camiones is
  'Datos del Laadbon (HG) por camión SAF: cajas, €/caja, porte y neto. El vigía de negocio contrasta cajas × €/caja con el importe del alta del ERP (entradas_bascula.importe_compra, mismo lote) y avisa si no cuadra. lote = clave de 8 dígitos de la entrada.';

alter table public.saf_camiones enable row level security;
drop policy if exists "saf_camiones_select" on public.saf_camiones;
create policy "saf_camiones_select" on public.saf_camiones
  for select to authenticated using (true);
drop policy if exists "saf_camiones_write" on public.saf_camiones;
create policy "saf_camiones_write" on public.saf_camiones
  for all to authenticated using (true) with check (true);

-- Camión 1, VERIFICADO el 28-08 (Laadbon 1184057): 1.440 cajas × 13,50 € +
-- 3.200 € de porte sobre 23.589 kg netos. El alta del ERP (21.230,10 €) valora
-- 1.790,10 € de más: ese es justo el primer hallazgo esperado del vigía.
insert into public.saf_camiones (lote, fecha, cajas, eur_caja, porte_eur, kg_neto_laadbon, laadbon_ref, notas)
values ('26082701', '2026-08-27', 1440, 13.50, 3200, 23589, '1184057',
        '1.280 cajas CAT 1 (16,45 kg) + 160 CAT 2 (15,40 kg). Contrastado a mano el 28-08.')
on conflict (lote) do nothing;

-- ── Registro de envíos del cierre mensual ────────────────────────────────────
create table if not exists public.cierre_mensual_envios (
  id uuid primary key default gen_random_uuid(),
  anio integer not null,
  mes integer not null,
  enviado_at timestamptz not null default now(),
  destinatarios text[] not null,
  asunto text not null,
  kg_entrada numeric,
  kg_calibrado numeric,
  -- 'enviado' | 'error' (detalle guarda el id de Resend o el mensaje de error)
  estado text not null default 'enviado',
  detalle text
);

comment on table public.cierre_mensual_envios is
  'Registro de envíos del cierre mensual automático (edge function cierre-mensual). Una fila por intento; no reenvía un mes ya enviado salvo force=true.';

create index if not exists cierre_mensual_envios_mes_idx
  on public.cierre_mensual_envios (anio, mes);

-- Solo la service role de la edge function lee/escribe: RLS sin políticas.
alter table public.cierre_mensual_envios enable row level security;

-- ── Programación ─────────────────────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Vigía de negocio: diario a las 12:15 UTC (14:15 Madrid en verano, 13:15 en
-- invierno) — después del vigilante (11:45 UTC) y con la tarea de las 07:10 y
-- la sincronización del ERP ya pasadas.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'vigia-negocio-diario') then
    perform cron.unschedule('vigia-negocio-diario');
  end if;
end
$do$;

-- Misma anon key que los otros jobs: solo pasa el verify_jwt de la función (es
-- pública, viaja en el bundle del frontend). Los destinatarios NO viajan aquí:
-- salen del secreto VIGIA_PARA de la función.
select cron.schedule(
  'vigia-negocio-diario',
  '15 12 * * *',
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

-- Cierre mensual: el día 1 a las 05:45 UTC (07:45 Madrid en verano), antes del
-- arranque del día y cuando el ERP del mes cerrado ya no se mueve.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'cierre-mensual-dia1') then
    perform cron.unschedule('cierre-mensual-dia1');
  end if;
end
$do$;

select cron.schedule(
  'cierre-mensual-dia1',
  '45 5 1 * *',
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
