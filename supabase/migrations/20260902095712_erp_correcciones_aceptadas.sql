-- Correcciones ERP ↔ app: poder ACEPTAR una diferencia conocida (02-09-2026).
--
-- La primera pasada real trajo, entre otras, kg_entrada de los camiones SAF:
-- la app lleva el NETO del albarán (regla del 28-08) y el ERP el bruto de
-- báscula. Es una diferencia deliberada que no se va a "resolver" nunca; sin
-- esto el vigía la recordaría cada lunes para siempre. Aceptarla la saca del
-- correo pero la deja en la tabla (con quién y por qué), y si el valor cambia
-- el sincronizador la sigue refrescando.
--
-- Solo admin puede aceptar, y solo esas tres columnas (privilegio por columna):
-- el resto de la fila la escribe únicamente el sincronizador (service_role).

alter table public.erp_correcciones
  add column if not exists aceptada_en  timestamptz,
  add column if not exists aceptada_por text,
  add column if not exists nota         text;

comment on column public.erp_correcciones.aceptada_en is 'Cuando alguien (admin) dio la diferencia por conocida: el vigía deja de avisar de ella.';

revoke update on public.erp_correcciones from authenticated;
grant update (aceptada_en, aceptada_por, nota) on public.erp_correcciones to authenticated;

drop policy if exists "erp_correcciones_aceptar_admin" on public.erp_correcciones;
create policy "erp_correcciones_aceptar_admin" on public.erp_correcciones
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
