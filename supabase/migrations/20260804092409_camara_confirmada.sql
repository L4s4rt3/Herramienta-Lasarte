-- Confirmación FÍSICA de que un lote sigue en cámara (interna o externa),
-- anotada por dirección tras inventariar la cámara a pie. Es una SEÑAL, no un
-- movimiento: mientras esté vigente (sin pasadas propias posteriores a la
-- fecha), el lote no recibe derrames de la conciliación ni sale candidato a
-- cierre automático — mismo trato que la señal de cámara externa.
-- Origen: 04-08-2026, el dueño inventarió la cámara 5 (26 lotes intactos a los
-- que el derrame había atribuido 310 t fantasma; 9 llegaron a cerrarse solos).
alter table public.entradas_bascula
  add column if not exists camara_confirmada_nombre text,
  add column if not exists camara_confirmada_fecha date;

comment on column public.entradas_bascula.camara_confirmada_nombre is
  'Cámara donde dirección confirmó FÍSICAMENTE el lote (p.ej. "Cámara 5"). Señal, no movimiento.';
comment on column public.entradas_bascula.camara_confirmada_fecha is
  'Fecha del inventario físico. La señal caduca sola cuando aparecen pasadas propias posteriores.';
