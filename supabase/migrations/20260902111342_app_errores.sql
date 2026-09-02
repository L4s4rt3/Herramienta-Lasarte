-- Errores de render de la app (02-09-2026).
--
-- El ErrorBoundary enseñaba "Algo salió mal" y hacía console.error: los
-- crashes de producción eran invisibles para quien mantiene la Herramienta,
-- salvo que alguien los contara. Aquí quedan: qué ruta, qué mensaje, qué pila,
-- quién y con qué navegador. Escribe cualquier usuario logueado (solo su
-- propia fila); lee admin.

create table if not exists public.app_errores (
  id          bigint generated always as identity primary key,
  creado_at   timestamptz not null default now(),
  user_id     uuid,
  ruta        text,
  mensaje     text not null,
  pila        text,
  componente  text,
  agente      text,
  version_app text
);

comment on table public.app_errores is 'Errores de render capturados por el ErrorBoundary de la app (src/components/ErrorBoundary.tsx). Best-effort: registrar nunca rompe nada.';

create index if not exists app_errores_creado_idx on public.app_errores (creado_at desc);

alter table public.app_errores enable row level security;

drop policy if exists "app_errores_insert_propio" on public.app_errores;
create policy "app_errores_insert_propio" on public.app_errores
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "app_errores_select_admin" on public.app_errores;
create policy "app_errores_select_admin" on public.app_errores
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
