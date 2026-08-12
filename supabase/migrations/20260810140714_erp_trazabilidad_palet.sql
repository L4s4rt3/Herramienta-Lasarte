-- Espejo de la trazabilidad de palets del ERP de LR Informática.
--
-- Cierra una cadena que hasta ahora no existía: productor → entrada de fruta →
-- lote de confección → palet → cliente. Ver docs/ERP_LR_INFORMATICA.md.
--
-- Son tablas ESPEJO, de solo lectura para la app: las llena
-- scripts/sincronizar-trazabilidad-palet-erp.mjs leyendo el MySQL del ERP, que
-- es la única fuente de verdad. Nada de escribir aquí a mano.
--
-- COBERTURA: solo el 56,9% de los kilos paletizados de la campaña 2025/26 tiene
-- origen atribuido (10.766.041 de 18.936.016). 521 de 1.160 lotes de confección
-- no tienen ni una fila de origen en el ERP. Por eso los kilos trazados NO se
-- guardan como columna: se calculan sumando erp_confeccion_origen y se
-- presentan SIEMPRE junto a los kilos totales, dos cifras comparables. Jamás
-- repartir los kilos sin origen entre los productores conocidos.

create table if not exists public.erp_palet (
  numero            text primary key,
  lote_confeccion   text not null,
  fecha             date not null,
  referencia        text,
  articulo          text,
  num_cajas         integer,
  kg_netos          numeric,
  kg_brutos         numeric,
  codigo_sscc       text,
  num_albaran_venta text,
  cliente_codigo    text,
  cliente           text,
  fecha_venta       date,
  sincronizado_at   timestamptz not null default now()
);

comment on table public.erp_palet is
  'Espejo de palets_cab del ERP (solo los que son palets de verdad: num_cajas > 0). Un palet sin num_albaran_venta es que todavía no se ha vendido.';
comment on column public.erp_palet.lote_confeccion is
  'Lote de CONFECCIÓN (formato NN+AAMMDD, p. ej. 01260807). NO es el lote de entrada de fruta (AAMMDDNN): los dos tienen 8 dígitos y el contador está en extremos opuestos.';

create index if not exists erp_palet_lote_confeccion_idx on public.erp_palet (lote_confeccion);
create index if not exists erp_palet_fecha_idx on public.erp_palet (fecha);
create index if not exists erp_palet_cliente_idx on public.erp_palet (cliente_codigo);

create table if not exists public.erp_confeccion_origen (
  lote_confeccion text not null,
  lote_entrada    text not null,
  articulo        text,
  kg_atribuidos   numeric not null,
  sincronizado_at timestamptz not null default now(),
  primary key (lote_confeccion, lote_entrada)
);

comment on table public.erp_confeccion_origen is
  'De qué lotes de ENTRADA sale cada lote de confección, con los kilos atribuidos. Sale de agri_produc_mp_pt del ERP filtrando tipo_registro = 0 y lote_mp de 8 dígitos, y sumando kilos_mp_en_pt (NO kilos_netos_mp_en_pt). El lote_entrada casa con entradas_bascula.lote.';

create index if not exists erp_confeccion_origen_lote_entrada_idx
  on public.erp_confeccion_origen (lote_entrada);

alter table public.erp_palet enable row level security;
alter table public.erp_confeccion_origen enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'erp_palet' and p.polname = 'erp_palet_select_authenticated'
  ) then
    create policy erp_palet_select_authenticated on public.erp_palet
      for select using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'erp_confeccion_origen'
       and p.polname = 'erp_confeccion_origen_select_authenticated'
  ) then
    create policy erp_confeccion_origen_select_authenticated on public.erp_confeccion_origen
      for select using (auth.role() = 'authenticated');
  end if;
end $$;
