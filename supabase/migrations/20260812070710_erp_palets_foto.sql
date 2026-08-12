-- Fotos del ERP a lo largo del dia, para averiguar A QUE HORA hay que mirar.
--
-- POR QUE. `kg_palets_brutos` sale hoy de un Excel del GSTOCK que alguien saca a
-- media tarde. Leer el ERP a la mañana siguiente NO sirve (probado 12-08-2026:
-- el |DSJ| medio empeora de 4,66% a 13,39%) porque despues del cierre siguen
-- apareciendo palets de regularizacion con esa misma fecha de lote. La foto a la
-- hora buena deberia reproducir el Excel.
--
-- Y DE PROPINA: la diferencia entre el total final del dia y la foto del cierre
-- es justo lo que quedo SIN DAR DE ALTA — el numero que hoy se cuenta a mano.
--
-- Se guarda una fila por (dia, hora de la toma). Nada de esto entra todavia en
-- ningun parte: primero se compara con los Excel reales y luego se decide.
CREATE TABLE IF NOT EXISTS public.erp_palets_foto (
  dia date NOT NULL,
  tomada_a timestamptz NOT NULL DEFAULT now(),
  kg_netos numeric NOT NULL,
  kg_egipto numeric NOT NULL DEFAULT 0,
  kg_campo numeric NOT NULL DEFAULT 0,
  palets integer NOT NULL,
  sin_valorar integer NOT NULL DEFAULT 0,
  kg_mayor_palet numeric,
  PRIMARY KEY (dia, tomada_a)
);

COMMENT ON TABLE public.erp_palets_foto IS
  'Fotos del total de palets del ERP tomadas varias veces al dia, para calibrar a que hora coincide con el Excel del GSTOCK y derivar el inventario sin dar de alta.';

CREATE INDEX IF NOT EXISTS erp_palets_foto_dia_idx ON public.erp_palets_foto (dia DESC, tomada_a DESC);

ALTER TABLE public.erp_palets_foto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leer fotos de palets" ON public.erp_palets_foto;
CREATE POLICY "leer fotos de palets" ON public.erp_palets_foto
  FOR SELECT TO authenticated USING (true);
