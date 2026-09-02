-- Correcciones ERP ↔ app pendientes de revisar (02-09-2026).
--
-- sincronizar-entradas-erp.mjs (portátil, 07:10) compara cada entrada del ERP
-- con la de la app y, cuando LOS DOS tienen dato y no coinciden, no pisa nada:
-- lo apuntaba en outputs/correcciones-entradas-erp-<fecha>.csv "para revisar
-- a mano". Un CSV nuevo cada día, que nadie abría: el lote 26081203 llevaba
-- 9 días idéntico sin que nada distinguiera "pendiente" de "visto y decidido".
--
-- Aquí vive la foto actual de esas discrepancias: el script hace upsert de
-- las que detecta hoy (vista_en = ahora) y borra las que ya no detecta (se
-- resolvieron solas: alguien corrigió el ERP o la app). detectada_en no se
-- toca en el upsert, así que dice desde cuándo dura. El vigía de negocio la
-- lee (reglaCorreccionesErp) y las cuenta como estados pendientes: aparecen
-- una vez, se recuerdan los lunes y se cierran al desaparecer.

create table if not exists public.erp_correcciones (
  lote          text        not null,
  fecha         date,
  campo         text        not null,
  en_la_app     text,
  en_el_erp     text,
  detectada_en  timestamptz not null default now(),
  vista_en      timestamptz not null default now(),
  primary key (lote, campo)
);

comment on table public.erp_correcciones is
  'Discrepancias entrada a entrada entre el ERP y la app (los dos con dato y distinto). La escribe sincronizar-entradas-erp.mjs cada mañana (foto completa: upsert + borrado de las que ya no salen); la lee el vigía de negocio.';
comment on column public.erp_correcciones.detectada_en is 'Primera vez que se vio esta discrepancia (no se pisa en el upsert).';
comment on column public.erp_correcciones.vista_en is 'Última pasada del sincronizador que la siguió viendo.';

alter table public.erp_correcciones enable row level security;

drop policy if exists "erp_correcciones_select" on public.erp_correcciones;
create policy "erp_correcciones_select" on public.erp_correcciones
  for select to authenticated using (true);
-- Escritura: solo service_role (el script y las edge functions). Sin política = nadie más.
