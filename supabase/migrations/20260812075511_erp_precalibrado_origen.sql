-- De qué productor era la fruta que vuelve del almacén de precalibrado.
--
-- EL PROBLEMA. El precalibrado es fruta que se aparta y se vuelve a pasar por
-- la línea. Al re-entrar por báscula lo hace como movimiento interno (agricultor
-- "LASARTE ALMACEN PRECALIBRADO"), y ahí se pierde de quién era: 274.924 kg del
-- aprovechamiento por productor colgaban de un almacén en vez de una finca.
--
-- LA CADENA, y dónde se apoya cada eslabón:
--   1. re-entrada de báscula (día D, X kg)
--        ↕ cuadra AL KILO con los palets PREC que el ERP creó ese día
--          (verificado agosto 2026: 5.692/5.692, 4.548/4.548, 14.740/14.740)
--   2. palet PREC, con su lote de confección
--        ↕ agri_produc_mp_pt (lote_pt → lote_mp), la misma tabla de la que sale
--          erp_confeccion_origen
--   3. lote de entrada original → productor (97,8% de ellos tiene uno)
--
-- LO QUE ESTA TABLA NO ES. No es un reparto exacto: la trazabilidad del ERP va
-- por lote de confección, no por palet, así que `kg_atribuidos` son PROPORCIONES
-- del origen dentro de su lote de confección, no kilos medidos de ese palet. Se
-- guarda `kg_traza` sin tocar para poder auditarlo, y `casado` dice con cuánta
-- confianza se unió el eslabón 1 — nunca se presenta como si fuera exacto.
CREATE TABLE IF NOT EXISTS public.erp_precalibrado_origen (
  -- Re-entrada de báscula: el lote con el que la fruta vuelve a la nave.
  lote_reentrada text NOT NULL,
  -- Lote de entrada original, del que salió esa fruta.
  lote_origen text NOT NULL,
  -- El palet de precalibrado que hace de puente (lote de confección del ERP).
  lote_confeccion text,
  -- Kg de la re-entrada que le tocan a este origen, en proporción a la traza.
  kg_atribuidos numeric NOT NULL,
  -- Los kg tal cual los da el ERP, sin prorratear. Para poder auditar.
  kg_traza numeric NOT NULL,
  articulo text,
  -- "exacto" = los kg del día cuadran al kilo; "aproximado" = dentro del 5%.
  casado text NOT NULL DEFAULT 'aproximado',
  sincronizado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lote_reentrada, lote_origen)
);

COMMENT ON TABLE public.erp_precalibrado_origen IS
  'Origen (productor) de la fruta que vuelve del almacen de precalibrado. Proporciones, no kilos medidos: ver la cabecera de la migracion y scripts/sincronizar-precalibrado-origen-erp.mjs.';

CREATE INDEX IF NOT EXISTS erp_precalibrado_origen_reentrada_idx
  ON public.erp_precalibrado_origen (lote_reentrada);
CREATE INDEX IF NOT EXISTS erp_precalibrado_origen_origen_idx
  ON public.erp_precalibrado_origen (lote_origen);

ALTER TABLE public.erp_precalibrado_origen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leer origen del precalibrado" ON public.erp_precalibrado_origen;
CREATE POLICY "leer origen del precalibrado" ON public.erp_precalibrado_origen
  FOR SELECT TO authenticated USING (true);
