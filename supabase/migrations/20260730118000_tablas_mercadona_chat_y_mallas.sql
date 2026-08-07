-- Tablas de Mercadona, memoria del chat y configuración de mallas.
--
-- CONTEXTO (recuperadas al repo el 07-ago-2026): estas cinco tablas existían
-- en producción sin ninguna migración que las creara — se aplicaron desde el
-- panel/MCP y su SQL nunca se commiteó, así que el esquema no era
-- reproducible desde cero. Se vuelcan tal cual están en la base, leídas del
-- catálogo (pg_attribute / pg_constraint / pg_indexes / pg_policy /
-- pg_get_triggerdef).
--
-- IDEMPOTENTE A PROPÓSITO: a diferencia del resto de migraciones del repo,
-- ésta describe algo que YA está aplicado, así que se escribe para poder
-- ejecutarse contra una base que ya lo tiene sin reventar. Por eso las
-- restricciones van EN LÍNEA dentro del `create table if not exists` (un
-- `alter table add constraint` suelto fallaría al repetirse) y las políticas y
-- los triggers llevan su `drop ... if exists` delante.
--
-- ORDEN IMPORTANTE: `mercadona_semanas` va ANTES que
-- `mercadona_semana_metodos`, que la referencia por clave ajena.

-- ─── Memoria del asistente (Vadim) ──────────────────────────────────────────
create table if not exists public.chat_memoria (
  id uuid default gen_random_uuid() not null,
  clave text not null,
  contenido text not null,
  origen text,
  user_id uuid not null,
  activa boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint chat_memoria_pkey primary key (id),
  constraint chat_memoria_clave_unique unique (clave),
  constraint chat_memoria_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.chat_memoria enable row level security;

create index if not exists idx_chat_memoria_activa_updated on public.chat_memoria using btree (activa, updated_at desc);
create index if not exists idx_chat_memoria_user on public.chat_memoria using btree (user_id);

drop policy if exists "chat_memoria_select_all_authenticated" on public.chat_memoria;
create policy "chat_memoria_select_all_authenticated" on public.chat_memoria for select using ((auth.role() = 'authenticated'::text));
drop policy if exists "chat_memoria_insert_own" on public.chat_memoria;
create policy "chat_memoria_insert_own" on public.chat_memoria for insert with check ((auth.uid() = user_id));
drop policy if exists "chat_memoria_update_own_or_admin" on public.chat_memoria;
create policy "chat_memoria_update_own_or_admin" on public.chat_memoria for update using (((auth.uid() = user_id) or has_role(auth.uid(), 'admin'::text)));
drop policy if exists "chat_memoria_delete_own_or_admin" on public.chat_memoria;
create policy "chat_memoria_delete_own_or_admin" on public.chat_memoria for delete using (((auth.uid() = user_id) or has_role(auth.uid(), 'admin'::text)));

drop trigger if exists update_chat_memoria_updated_at on public.chat_memoria;
create trigger update_chat_memoria_updated_at before update on public.chat_memoria
  for each row execute function public.update_updated_at_column();

-- ─── Configuración de mallas por zona (solo admin) ──────────────────────────
create table if not exists public.economico_mallas_config (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  zona text not null,
  tipo_malla text,
  kg_por_malla numeric,
  precio_malla numeric,
  vigente_desde date default CURRENT_DATE not null,
  notas text,
  created_at timestamp with time zone default now() not null,
  constraint economico_mallas_config_pkey primary key (id),
  constraint economico_mallas_config_zona_vigente_desde_key unique (zona, vigente_desde),
  constraint economico_mallas_config_zona_check check ((zona = any (array['z1'::text, 'z2'::text]))),
  constraint economico_mallas_config_kg_por_malla_check check (((kg_por_malla is null) or (kg_por_malla > (0)::numeric))),
  constraint economico_mallas_config_precio_malla_check check (((precio_malla is null) or (precio_malla >= (0)::numeric)))
);
alter table public.economico_mallas_config enable row level security;

drop policy if exists "economico_mallas_config_solo_admin" on public.economico_mallas_config;
create policy "economico_mallas_config_solo_admin" on public.economico_mallas_config for all
  using (has_role(auth.uid(), 'admin'::text)) with check (has_role(auth.uid(), 'admin'::text));

-- ─── Semanas de Mercadona (cabecera) ────────────────────────────────────────
create table if not exists public.mercadona_semanas (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  anio integer not null,
  semana integer not null,
  rango_planificacion text,
  planificado_quincena_kg numeric,
  planificado_semana_kg numeric,
  vendido_kg numeric,
  diferencia_pct numeric,
  notas text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  ajustes_base_iva numeric,
  ajustes_lineas numeric,
  antequera_ii_kg numeric,
  antequera_verdura_kg numeric,
  constraint mercadona_semanas_pkey primary key (id),
  constraint mercadona_semanas_anio_semana_key unique (anio, semana),
  constraint mercadona_semanas_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint mercadona_semanas_anio_check check (((anio >= 2000) and (anio <= 2100))),
  constraint mercadona_semanas_semana_check check (((semana >= 1) and (semana <= 53)))
);
alter table public.mercadona_semanas enable row level security;

create index if not exists idx_mercadona_semanas_anio_semana on public.mercadona_semanas using btree (anio desc, semana desc);
create index if not exists idx_mercadona_semanas_user on public.mercadona_semanas using btree (user_id);

drop policy if exists "mercadona_semanas_select_all_authenticated" on public.mercadona_semanas;
create policy "mercadona_semanas_select_all_authenticated" on public.mercadona_semanas for select using ((auth.role() = 'authenticated'::text));
drop policy if exists "mercadona_semanas_insert_own" on public.mercadona_semanas;
create policy "mercadona_semanas_insert_own" on public.mercadona_semanas for insert with check ((auth.uid() = user_id));
drop policy if exists "mercadona_semanas_update_own_or_admin" on public.mercadona_semanas;
create policy "mercadona_semanas_update_own_or_admin" on public.mercadona_semanas for update
  using (((auth.uid() = user_id) or has_role(auth.uid(), 'admin'::text)))
  with check (((auth.uid() = user_id) or has_role(auth.uid(), 'admin'::text)));
drop policy if exists "mercadona_semanas_delete_own_or_admin" on public.mercadona_semanas;
create policy "mercadona_semanas_delete_own_or_admin" on public.mercadona_semanas for delete
  using (((auth.uid() = user_id) or has_role(auth.uid(), 'admin'::text)));

create or replace function public.mercadona_semanas_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mercadona_semanas_updated_at on public.mercadona_semanas;
create trigger trg_mercadona_semanas_updated_at before update on public.mercadona_semanas
  for each row execute function public.mercadona_semanas_set_updated_at();

-- ─── Métodos por semana de Mercadona (detalle, cuelga de la cabecera) ───────
create table if not exists public.mercadona_semana_metodos (
  id uuid default gen_random_uuid() not null,
  semana_id uuid not null,
  metodo text not null,
  descripcion text,
  pct numeric,
  kilos numeric,
  palets numeric,
  cajas numeric,
  comparativa_anterior_pct numeric,
  created_at timestamp with time zone default now() not null,
  lineas numeric,
  base_iva numeric,
  constraint mercadona_semana_metodos_pkey primary key (id),
  constraint mercadona_semana_metodos_semana_id_fkey foreign key (semana_id) references public.mercadona_semanas(id) on delete cascade
);
alter table public.mercadona_semana_metodos enable row level security;

create index if not exists idx_mercadona_semana_metodos_semana on public.mercadona_semana_metodos using btree (semana_id);

-- El permiso de escritura se HEREDA de la semana a la que pertenece la fila.
drop policy if exists "mercadona_semana_metodos_select_all_authenticated" on public.mercadona_semana_metodos;
create policy "mercadona_semana_metodos_select_all_authenticated" on public.mercadona_semana_metodos for select using ((auth.role() = 'authenticated'::text));
drop policy if exists "mercadona_semana_metodos_insert_own" on public.mercadona_semana_metodos;
create policy "mercadona_semana_metodos_insert_own" on public.mercadona_semana_metodos for insert
  with check ((exists ( select 1 from public.mercadona_semanas s where ((s.id = mercadona_semana_metodos.semana_id) and (s.user_id = auth.uid())))));
drop policy if exists "mercadona_semana_metodos_update_own_or_admin" on public.mercadona_semana_metodos;
create policy "mercadona_semana_metodos_update_own_or_admin" on public.mercadona_semana_metodos for update
  using ((has_role(auth.uid(), 'admin'::text) or (exists ( select 1 from public.mercadona_semanas s where ((s.id = mercadona_semana_metodos.semana_id) and (s.user_id = auth.uid()))))))
  with check ((has_role(auth.uid(), 'admin'::text) or (exists ( select 1 from public.mercadona_semanas s where ((s.id = mercadona_semana_metodos.semana_id) and (s.user_id = auth.uid()))))));
drop policy if exists "mercadona_semana_metodos_delete_own_or_admin" on public.mercadona_semana_metodos;
create policy "mercadona_semana_metodos_delete_own_or_admin" on public.mercadona_semana_metodos for delete
  using ((has_role(auth.uid(), 'admin'::text) or (exists ( select 1 from public.mercadona_semanas s where ((s.id = mercadona_semana_metodos.semana_id) and (s.user_id = auth.uid()))))));

-- ─── Previsiones de Mercadona ───────────────────────────────────────────────
create table if not exists public.mercadona_previsiones (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  anio integer not null,
  semana integer not null,
  kg_previstos numeric,
  kg_previstos_quincena numeric,
  notas text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint mercadona_previsiones_pkey primary key (id),
  constraint mercadona_previsiones_anio_semana_key unique (anio, semana)
);
alter table public.mercadona_previsiones enable row level security;

drop policy if exists "mercadona_previsiones_select_all_authenticated" on public.mercadona_previsiones;
create policy "mercadona_previsiones_select_all_authenticated" on public.mercadona_previsiones for select using ((auth.role() = 'authenticated'::text));
drop policy if exists "mercadona_previsiones_insert_own" on public.mercadona_previsiones;
create policy "mercadona_previsiones_insert_own" on public.mercadona_previsiones for insert with check ((auth.uid() = user_id));
drop policy if exists "mercadona_previsiones_update_own_or_admin" on public.mercadona_previsiones;
create policy "mercadona_previsiones_update_own_or_admin" on public.mercadona_previsiones for update
  using (((auth.uid() = user_id) or has_role(auth.uid(), 'admin'::text)))
  with check (((auth.uid() = user_id) or has_role(auth.uid(), 'admin'::text)));
drop policy if exists "mercadona_previsiones_delete_own_or_admin" on public.mercadona_previsiones;
create policy "mercadona_previsiones_delete_own_or_admin" on public.mercadona_previsiones for delete
  using (((auth.uid() = user_id) or has_role(auth.uid(), 'admin'::text)));
