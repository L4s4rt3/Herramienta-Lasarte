-- Entradas de fruta por báscula (export diario del programa de báscula).
-- El campo lote es la clave de trazabilidad: es el mismo código (AAMMDD + nº
-- de entrada del día) que usa el calibrador en lotes_dia.lote_codigo.
create table public.entradas_bascula (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  fecha date not null,
  num_entrada text,
  finca text,
  parcela text,
  lote text not null unique,
  agricultor text,
  articulo text,
  tipo_envase text,
  envases integer,
  kg_entrada numeric not null default 0,
  recol_kg numeric,
  coste_recoleccion numeric,
  importe_transporte numeric,
  precio_compra_kg numeric,
  importe_compra numeric,
  comision_kg numeric,
  importe_comision numeric,
  importe_total numeric,
  certificada boolean not null default false,
  certificado_ggn text,
  created_at timestamptz not null default now()
);

alter table public.entradas_bascula enable row level security;

create policy entradas_bascula_select_all_authenticated
  on public.entradas_bascula for select
  using (auth.role() = 'authenticated');

create policy entradas_bascula_insert_authenticated
  on public.entradas_bascula for insert
  with check (auth.role() = 'authenticated');

create policy entradas_bascula_update_authenticated
  on public.entradas_bascula for update
  using (auth.role() = 'authenticated');

create policy entradas_bascula_delete_authenticated
  on public.entradas_bascula for delete
  using (auth.role() = 'authenticated');

create index entradas_bascula_fecha_idx on public.entradas_bascula (fecha);
