-- Pasadas del calibrador: un lote puede pasar por la maquina VARIAS veces
-- (225 de 864 lotes de la campana 25/26). El informe DOCX solo cubre la ultima
-- pasada; el SQL del Sizer las cubre todas. Se guarda la pasada (batch) y la
-- clasificacion pasa a estar keyada tambien por batch_id (0 = "vino de un DOCX,
-- pasada desconocida" — provisional hasta el siguiente volcado SQL).

create table if not exists public.calibrador_batch (
  batch_id    integer primary key,
  lote        text not null,
  grower_code text,
  productor   text,
  variedad    text,
  inicio      timestamptz,
  fin         timestamptz,
  bins        numeric,
  presort_reject_kg numeric,
  outlet_reject_kg  numeric,
  total_reject_kg   numeric,
  finalizado  boolean,
  sincronizado_at timestamptz not null default now()
);
comment on table public.calibrador_batch is
  'Espejo de Batch de SizerResults (una fila por pasada de maquina). lote = BatchName, formato de entrada AAMMDDNN; hay filas basura con lote no numerico (arranques, pruebas) que se conservan como espejo fiel.';
create index if not exists calibrador_batch_lote_idx on public.calibrador_batch (lote);

alter table public.calibrador_clasificacion add column if not exists batch_id integer not null default 0;
comment on column public.calibrador_clasificacion.batch_id is
  'Pasada del Sizer (Batch.BatchID). 0 = fila provisional venida de un informe DOCX (solo ultima pasada); >0 = volcado SQL completo. Al agregar por lote usar las filas >0 si existen.';

alter table public.calibrador_clasificacion drop constraint if exists calibrador_clasificacion_pkey;
alter table public.calibrador_clasificacion add primary key (lote, batch_id, producto, calidad, clase, tamano);

alter table public.calibrador_batch enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                  where c.relname = 'calibrador_batch' and p.polname = 'calibrador_batch_select') then
    create policy calibrador_batch_select on public.calibrador_batch
      for select using (auth.role() = 'authenticated');
  end if;
end $$;
