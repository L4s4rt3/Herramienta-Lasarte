-- Kg apartados a los almacenes de PRECALIBRADO 1 y 2 POR LOTE Y DÍA (dato
-- manual del parte, decisión del dueño 22-jul-2026: "lo único que puedo hacer
-- es introducir manualmente los kg de precalibrado 1 y 2 de cada lote cada
-- día"). Es el flujo de ENTRADA al almacén PREC que faltaba: la báscula pesa
-- lo que VUELVE (re-entradas PREC) pero lo que se aparta no siempre quedaba
-- registrado (verificado 22-jul-2026: apartado 506 t < reintroducido 792 t).
-- Con este dato por lote: (1) cada lote sabe cuánta fruta suya está diferida
-- en PREC, y (2) el saldo del almacén (apartado − reintroducido) cierra de
-- aquí en adelante. NULL = sin dato; 0 = "ese día ese lote no apartó".
alter table public.lotes_dia
  add column if not exists kg_precalibrado_z1 numeric,
  add column if not exists kg_precalibrado_z2 numeric;

comment on column public.lotes_dia.kg_precalibrado_z1 is
  'Kg apartados al almacén PRECALIBRADO 1 desde este lote en este parte (manual). NULL = sin dato.';
comment on column public.lotes_dia.kg_precalibrado_z2 is
  'Kg apartados al almacén PRECALIBRADO 2 desde este lote en este parte (manual). NULL = sin dato.';
