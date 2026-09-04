-- El estándar de kg/persona por RÉGIMEN de plantilla, editable desde la app
-- (04-09-2026).
--
-- POR QUÉ. El listón lo decide el dueño (27-08-2026: media plantilla ≤35
-- presentes con suelo 2.200 / objetivo 2.600; plantilla completa, aunque haya
-- faltas, 1.700 / 2.100) y él mismo dijo que hay que revisarlo cada 4-6
-- semanas. Hasta hoy vivía en DOS sitios de código —las constantes de
-- _shared/estandarRendimiento.ts y el JSON scripts/informe-produccion/estandar.json
-- que leen los informes en Python de la encargada y el correo diario—, así que
-- subirlo era tocar código y desplegar. Desde esta migración la FUENTE es esta
-- tabla: la edita el admin en Económico → Rentabilidad → «Por tipo de día», la
-- leen al momento esa vista y el vigía de negocio, y el JSON pasa a ser un
-- espejo que regenera scripts/sincronizar-estandar.mjs.
--
-- UNA SOLA FILA (id = true, como clasificacion_lote_mix_meta): no hay varios
-- estándares conviviendo, hay uno vigente. Lo anterior no se pierde: el trigger
-- guarda cada versión en el historial con su tramo de vigencia, para poder
-- decir con qué listón se midió una semana concreta.
--
-- Los CHECK son los mismos que valida la app antes de guardar
-- (validarEstandarRendimiento): kg enteros positivos, suelo por debajo del
-- objetivo en cada régimen y un corte de plantilla entre 1 y 200 personas. Se
-- duplican a propósito: la app da el mensaje en castellano, la base impide el
-- disparate venga de donde venga.

create table if not exists public.estandar_rendimiento (
  id                        boolean primary key default true check (id),
  corte_plantilla_reducida  integer not null check (corte_plantilla_reducida >= 1 and corte_plantilla_reducida <= 200),
  completa_suelo            integer not null check (completa_suelo > 0),
  completa_objetivo         integer not null check (completa_objetivo > 0),
  reducida_suelo            integer not null check (reducida_suelo > 0),
  reducida_objetivo         integer not null check (reducida_objetivo > 0),
  decidido_por              text not null default 'el dueño',
  fecha                     date not null default current_date,
  nota                      text,
  updated_at                timestamptz not null default now(),
  updated_by                uuid references auth.users(id) on delete set null,
  constraint estandar_rendimiento_completa_orden check (completa_suelo < completa_objetivo),
  constraint estandar_rendimiento_reducida_orden check (reducida_suelo < reducida_objetivo)
);

-- Cada versión anterior con su tramo de vigencia: con qué listón se midió cada
-- semana. No se borra ni se edita.
create table if not exists public.estandar_rendimiento_historial (
  id                        uuid primary key default gen_random_uuid(),
  corte_plantilla_reducida  integer not null,
  completa_suelo            integer not null,
  completa_objetivo         integer not null,
  reducida_suelo            integer not null,
  reducida_objetivo         integer not null,
  decidido_por              text,
  fecha                     date,
  nota                      text,
  vigente_desde             timestamptz not null,
  vigente_hasta             timestamptz not null default now(),
  cambiado_por              uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now()
);
create index if not exists idx_estandar_rendimiento_hist_vigencia
  on public.estandar_rendimiento_historial (vigente_desde, vigente_hasta);

-- El sello lo pone la base, no el cliente: quién y cuándo no se teclean.
create or replace function public.estandar_rendimiento_sellar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- Solo se archiva cuando cambia algo del listón: guardar la misma fila otra vez
-- no ensucia el historial.
create or replace function public.estandar_rendimiento_guardar_historial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if row(old.corte_plantilla_reducida, old.completa_suelo, old.completa_objetivo,
         old.reducida_suelo, old.reducida_objetivo, old.decidido_por, old.fecha, old.nota)
     is distinct from
     row(new.corte_plantilla_reducida, new.completa_suelo, new.completa_objetivo,
         new.reducida_suelo, new.reducida_objetivo, new.decidido_por, new.fecha, new.nota) then
    insert into public.estandar_rendimiento_historial (
      corte_plantilla_reducida, completa_suelo, completa_objetivo, reducida_suelo, reducida_objetivo,
      decidido_por, fecha, nota, vigente_desde, vigente_hasta, cambiado_por
    ) values (
      old.corte_plantilla_reducida, old.completa_suelo, old.completa_objetivo, old.reducida_suelo, old.reducida_objetivo,
      old.decidido_por, old.fecha, old.nota, old.updated_at, new.updated_at, new.updated_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists estandar_rendimiento_sellar_trg on public.estandar_rendimiento;
create trigger estandar_rendimiento_sellar_trg
  before update on public.estandar_rendimiento
  for each row execute function public.estandar_rendimiento_sellar();

drop trigger if exists estandar_rendimiento_historial_trg on public.estandar_rendimiento;
create trigger estandar_rendimiento_historial_trg
  after update on public.estandar_rendimiento
  for each row execute function public.estandar_rendimiento_guardar_historial();

-- El listón vigente lo ve cualquiera que entre (la vista y el semáforo lo
-- enseñan); cambiarlo, solo admin. Nada para anon.
alter table public.estandar_rendimiento enable row level security;
alter table public.estandar_rendimiento_historial enable row level security;

drop policy if exists "estandar_rendimiento_select_authenticated" on public.estandar_rendimiento;
create policy "estandar_rendimiento_select_authenticated" on public.estandar_rendimiento
  for select to authenticated using (true);

drop policy if exists "estandar_rendimiento_update_admin" on public.estandar_rendimiento;
create policy "estandar_rendimiento_update_admin" on public.estandar_rendimiento
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "estandar_rendimiento_historial_select_authenticated" on public.estandar_rendimiento_historial;
create policy "estandar_rendimiento_historial_select_authenticated" on public.estandar_rendimiento_historial
  for select to authenticated using (true);

-- Sin insert ni delete para nadie salvo service_role: la fila es una y no se
-- crea ni se borra desde la app (el historial lo escribe el trigger, que es
-- security definer).
revoke all on public.estandar_rendimiento from anon;
revoke all on public.estandar_rendimiento_historial from anon;
grant select, update on public.estandar_rendimiento to authenticated;
grant select on public.estandar_rendimiento_historial to authenticated;

-- Semilla: el estándar del 27-08-2026 con la nota del dueño, tal cual estaba en
-- el JSON.
insert into public.estandar_rendimiento (
  id, corte_plantilla_reducida, completa_suelo, completa_objetivo, reducida_suelo, reducida_objetivo,
  decidido_por, fecha, nota
) values (
  true, 35, 1700, 2100, 2200, 2600,
  'el dueño', '2026-08-27',
  'El estándar depende del RÉGIMEN de plantilla (análisis por tipo de día, 27-08): reducida = media plantilla (≤35 presentes, el régimen de agosto), donde el kg/persona rinde más y el listón es más alto; completa = plantilla entera aunque haya faltas (un día de 45 es completa con faltas). Revisar cada 4-6 semanas: si se clava el objetivo un mes, subir suelo y objetivo.'
) on conflict (id) do nothing;
