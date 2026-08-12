-- Coste de recolección estimado, en columnas propias.
--
-- El coste REAL de recolección no se puede leer del ERP: no está almacenado en
-- ninguna tabla (se barrieron las 54 tablas con num_entrada, las 24 con
-- num_proveedor, las 21 con lote y los 1.208 informes .rpt). Lo calcula el
-- módulo Delphi de reparto de gastos en el momento de imprimir el listado.
--
-- Mientras no se pueda leer, `coste_recoleccion` se queda a NULL en las
-- entradas que llegan por sincronización, y la estimación vive APARTE para que
-- nunca se confunda un importe estimado con uno real.
--
-- La tarifa estimada es la última observada para la misma finca y variedad.
-- Backtest sobre la campaña 2025/26 (718 entradas con coste conocido, 655 con
-- historial previo): acierta la tarifa exacta en el 93,7% de los casos y el
-- error acumulado es de 6.167 € sobre 1.310.137 €, un 0,47%.

alter table public.entradas_bascula
  add column if not exists coste_recoleccion_estimado numeric,
  add column if not exists recol_kg_estimado numeric,
  add column if not exists recol_estimacion_origen text;

comment on column public.entradas_bascula.coste_recoleccion_estimado is
  'ESTIMACIÓN del coste de recolección (kg_entrada x recol_kg_estimado). Nunca es el coste real: ese va en coste_recoleccion. No sumar ambos.';

comment on column public.entradas_bascula.recol_kg_estimado is
  'Tarifa €/kg usada para estimar, en la unidad de recol_kg.';

comment on column public.entradas_bascula.recol_estimacion_origen is
  'De dónde sale la tarifa estimada: finca_articulo (la mejor) | finca | agricultor | contrato_erp (contrato de recolección, tipo_contrato = 8).';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.entradas_bascula'::regclass
       and conname = 'entradas_bascula_recol_estimacion_origen_check'
  ) then
    alter table public.entradas_bascula
      add constraint entradas_bascula_recol_estimacion_origen_check
      check (
        recol_estimacion_origen is null
        or recol_estimacion_origen in ('finca_articulo', 'finca', 'agricultor', 'contrato_erp')
      );
  end if;
end $$;
