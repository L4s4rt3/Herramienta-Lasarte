-- Segundo componente de precio desde el ERP (11-09-2026): hay consumibles cuyo
-- coste es la SUMA de dos artículos del ERP — caja de alquiler + fianza/depósito
-- (EPS Europool 3,86 €, IFCO 3,50 €) o caja + tapa (Otello). Con un solo
-- erp_codigo se quedaban manuales; con el componente extra el sync semanal
-- calcula precio = principal × factor + extra × factor_extra.
ALTER TABLE public.stock_consumibles
  ADD COLUMN erp_codigo_extra BIGINT,
  ADD COLUMN erp_factor_extra NUMERIC NOT NULL DEFAULT 1;

-- EPS (Europool): caja de alquiler + fianza del mismo modelo.
UPDATE public.stock_consumibles SET erp_codigo = 10003590,  erp_factor = 1, erp_codigo_extra = 10003591 WHERE nombre = 'Caja plástico EPS MOD. 136' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003465,  erp_factor = 1, erp_codigo_extra = 10000674 WHERE nombre = 'Caja plástico EPS MOD. 156' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002712,  erp_factor = 1, erp_codigo_extra = 10002731 WHERE nombre = 'Caja plástico EPS MOD. 186' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000248, erp_factor = 1, erp_codigo_extra = 10001912 WHERE nombre = 'Caja plástico EPS MOD. 24603' AND almacen = 'central';

-- IFCO: caja + depósito (BLL64XX BLACK para las negras, LL64xx VERDE para las verdes).
UPDATE public.stock_consumibles SET erp_codigo = 100000433, erp_factor = 1, erp_codigo_extra = 100000495 WHERE nombre = 'Caja plástico IFCO MOD. 6413 BLL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10001118,  erp_factor = 1, erp_codigo_extra = 10001298  WHERE nombre = 'Caja plástico IFCO MOD. 6413 GLL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10001273,  erp_factor = 1, erp_codigo_extra = 100000495 WHERE nombre = 'Caja plástico IFCO MOD. 6416 BLL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 100000410, erp_factor = 1, erp_codigo_extra = 10001298  WHERE nombre = 'Caja plástico IFCO MOD. 6416 GLL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10002566,  erp_factor = 1, erp_codigo_extra = 100000495 WHERE nombre = 'Caja plástico IFCO MOD. 6424 BLL' AND almacen = 'central';
UPDATE public.stock_consumibles SET erp_codigo = 10003858,  erp_factor = 1, erp_codigo_extra = 10001298  WHERE nombre = 'Caja plástico IFCO MOD. 6424 GLL' AND almacen = 'central';
-- El 6410 estaba enlazado solo a la caja (0,845): con el depósito queda como los demás.
UPDATE public.stock_consumibles SET erp_codigo_extra = 100000495 WHERE nombre = 'Caja IFCO G410 BLACK' AND almacen = 'central';

-- Otello: caja de pino + tapa.
UPDATE public.stock_consumibles SET erp_codigo = 10003567, erp_factor = 1, erp_codigo_extra = 10003574 WHERE nombre = 'Caja madera 15 Kg. OTELLO (Caja + Tapa)' AND almacen = 'central';
