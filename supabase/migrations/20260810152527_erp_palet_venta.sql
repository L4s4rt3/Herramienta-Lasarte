-- El palet, hasta el euro facturado.
--
-- palets_cab apunta a la LÍNEA exacta de venta
-- (tipo_documento_vta, serie_dcmto_vta, num_dcmto_vta, num_linea_vta), y esa
-- línea de fact_lin_alb lleva importe, factura y cliente. Con esto la cadena
-- queda completa: productor → entrada → confección → palet → € facturados.
--
-- CUIDADO CON EL IMPORTE. Una línea de venta cubre VARIOS palets (p. ej. 480 kg
-- repartidos en varios). El importe de la línea NO se copia en cada palet: se
-- reparte por kilos. `importe_venta` es por tanto la parte que le toca a ese
-- palet, y la suma por línea reconstruye el importe de la línea sin inflarlo.
--
-- Un palet sin `importe_venta` puede estar sin vender o vendido pero aún sin
-- facturar: eso es lo normal en el mes en curso (los albaranes de Mercadona se
-- valoran al facturar). NULL es "todavía no", nunca cero.

alter table public.erp_palet
  add column if not exists serie_albaran_venta text,
  add column if not exists linea_venta         integer,
  add column if not exists importe_venta       numeric,
  add column if not exists num_factura         text,
  add column if not exists fecha_factura       date;

comment on column public.erp_palet.importe_venta is
  'Parte del importe de la línea de venta que corresponde a este palet, repartida por kilos. NULL = sin vender o vendido pero sin facturar todavía (nunca 0).';
comment on column public.erp_palet.linea_venta is
  'num_linea_vta de palets_cab: la línea concreta de fact_lin_alb, no solo el albarán.';

create index if not exists erp_palet_factura_idx on public.erp_palet (num_factura);
