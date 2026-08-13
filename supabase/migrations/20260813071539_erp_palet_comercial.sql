-- `comercial`: distinguir el palet terminado del movimiento a granel.
--
-- EL ERROR QUE ESTO CORRIGE. `erp_palet` se llenaba filtrando
-- `num_cajas > 0 AND lote <> ''`, que es lo correcto para la trazabilidad de
-- venta (a quién se le vendió, con qué albarán y factura), pero deja fuera
-- 1.570 palets con 1.656.698 kg. Consultado el ERP el 13-08-2026:
--
--   palets_cab sin filtrar : 42.535 palets, 20.699.443 kg
--   con el filtro          : 40.965 palets, 19.042.745 kg
--   fuera                  :  1.570 palets,  1.656.698 kg  (1.569 sin cajas)
--
-- Esos 1.570 son fruta a granel y a precalibrado: sin cliente, con productos
-- PRE1/PRE2/ALM-LAS/CAMPO y una media de 900-4.100 kg por "palet" frente a los
-- 433 kg de uno real. NO son basura: salieron de la línea ese día y por tanto
-- explican masa.
--
-- (El Excel que sacaba el dueño era justo la lectura SIN filtrar: sus 42.963
-- filas y 20.775.719 kg cuadran con el ERP al 0,37%. Los palets de la app
-- estaban bien; el error fue apuntar la herramienta a la lectura filtrada.)
--
-- Así que no se elige entre una lectura y otra: se traen todos y se marca cuál
-- es cuál. El balance de masa los usa todos; las pantallas de venta filtran
-- por `comercial`.
ALTER TABLE public.erp_palet
  ADD COLUMN IF NOT EXISTS comercial boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.erp_palet.comercial IS
  'true = palet terminado (con cajas y lote de confección), el que se vende. '
  'false = movimiento a granel o a precalibrado: sin cliente, sin cajas, kilos '
  'reales que salieron de la línea. Cuenta para el balance de masa (DSJ), no '
  'para las pantallas de venta.';
