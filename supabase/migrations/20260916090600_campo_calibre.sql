-- =============================================================================
-- El calibre de la fruta EN EL CAMPO, antes de entrar (16-09-2026).
--
-- POR QUÉ. Hasta ahora el calibre solo se sabía al final: cuando la fruta ya
-- estaba en la línea y el calibrador la clasificaba. Aerobotics lo mide en el
-- árbol cada pocas semanas y proyecta cómo va a crecer, así que se puede saber
-- ANTES de recolectar qué calibre va a salir de cada parcela.
--
-- DE DÓNDE SALE. De dos ficheros que Aeroview deja descargar (su API es de pago
-- y está descartada):
--   · yield_measurement_report.xlsx → milímetros por bloque y semana.
--   · growthcurves.xlsx → floración, ventana de recolección y ritmo de
--     crecimiento por finca y variedad.
-- Los carga scripts/aerobotics-cargar-calibre.mjs.
--
-- MEDIDA O PREVISIÓN. El fichero no lo dice: lo dice el calendario. Una semana
-- que ya pasó es una medida; una que no ha llegado es una previsión. Se guarda
-- cuál es cada una, y —esto es lo importante— cuando una semana prevista llega
-- y se mide de verdad, la previsión NO se borra: se queda en mm_previsto. Así,
-- en octubre, se puede poner al lado lo que se dijo que iba a pasar y lo que
-- pasó, que es la única forma de saber si la previsión vale para algo.
--
-- LA FUENTE DE CADA CURVA SE GUARDA TAL CUAL. Aerobotics dice de dónde sale:
-- previous_season_sizes (tamaños de la campaña anterior), customer_input (lo
-- tecleó alguien), region_cultivar_default (la media de la comarca, NO fruta
-- de la casa). En la primera carga, 27 de 99 eran la media de la comarca: una
-- curva así no es una previsión de esa finca y la pantalla tiene que decirlo.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
-- =============================================================================

-- ─── Medidas de calibre por bloque y semana ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.campo_calibre_medidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origen TEXT NOT NULL DEFAULT 'aerobotics',
  /** Nombre de la finca y del bloque tal y como los escribe Aerobotics. */
  finca_nombre TEXT NOT NULL,
  bloque TEXT NOT NULL,
  cultivo TEXT,
  variedad TEXT,
  /** Semana ISO tal cual viene: "2026W37". Se ordena sola alfabéticamente. */
  semana TEXT NOT NULL,
  /** Diámetro medio de la fruta en milímetros. */
  mm NUMERIC NOT NULL,
  tipo TEXT NOT NULL,
  /** Lo que se PREVIÓ para esta semana, y cuándo se previó. No se pisa cuando llega la medida. */
  mm_previsto NUMERIC,
  previsto_en DATE,
  /** La parcela dibujada a la que pertenece este bloque, si se ha podido casar. */
  parcela_id UUID REFERENCES public.campo_parcelas(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campo_calibre_medidas_tipo_check CHECK (tipo IN ('medida', 'prevision')),
  CONSTRAINT campo_calibre_medidas_unica UNIQUE (origen, finca_nombre, bloque, semana)
);

CREATE INDEX IF NOT EXISTS campo_calibre_medidas_parcela_idx
  ON public.campo_calibre_medidas (parcela_id);
CREATE INDEX IF NOT EXISTS campo_calibre_medidas_semana_idx
  ON public.campo_calibre_medidas (semana);

COMMENT ON TABLE public.campo_calibre_medidas IS
  'Diametro medio de la fruta en el arbol, por bloque de Aerobotics y semana. tipo=medida son milimetros medidos; tipo=prevision es lo que Aerobotics proyecta. mm_previsto guarda la prevision aunque despues llegue la medida, para poder comparar.';

ALTER TABLE public.campo_calibre_medidas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campo_calibre_medidas TO authenticated;

DROP POLICY IF EXISTS "campo_calibre_medidas_select_authenticated" ON public.campo_calibre_medidas;
CREATE POLICY "campo_calibre_medidas_select_authenticated"
  ON public.campo_calibre_medidas FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "campo_calibre_medidas_escritura_admin" ON public.campo_calibre_medidas;
CREATE POLICY "campo_calibre_medidas_escritura_admin"
  ON public.campo_calibre_medidas FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::text))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP TRIGGER IF EXISTS update_campo_calibre_medidas_updated_at ON public.campo_calibre_medidas;
CREATE TRIGGER update_campo_calibre_medidas_updated_at
  BEFORE UPDATE ON public.campo_calibre_medidas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Curvas de crecimiento por finca y variedad ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.campo_curvas_crecimiento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origen TEXT NOT NULL DEFAULT 'aerobotics',
  finca_nombre TEXT NOT NULL,
  cultivo TEXT,
  variedad TEXT NOT NULL,
  /** Semana ISO de plena floración ("2026W21"): de ahí cuenta el crecimiento. */
  floracion_semana TEXT,
  /** Ventana de recolección recomendada, tal cual ("2027W12 - 2027W16") y partida. */
  ventana TEXT,
  ventana_desde TEXT,
  ventana_hasta TEXT,
  /** Ritmo de crecimiento por mes: {"2026-07": 6.9, "2026-08": 6.2, …}. */
  crecimiento JSONB NOT NULL DEFAULT '{}'::JSONB,
  /**
   * De dónde sale la curva, tal y como lo dice Aerobotics:
   * previous_season_sizes | customer_input | region_cultivar_default | (vacío).
   * region_cultivar_default es la media de la comarca, NO fruta de esta finca.
   */
  fuente TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campo_curvas_unica UNIQUE (origen, finca_nombre, variedad)
);

COMMENT ON TABLE public.campo_curvas_crecimiento IS
  'Floracion, ventana de recoleccion y ritmo de crecimiento por finca y variedad, de Aerobotics. La columna fuente dice si la curva sale de fruta de la finca o de la media de la comarca.';

ALTER TABLE public.campo_curvas_crecimiento ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campo_curvas_crecimiento TO authenticated;

DROP POLICY IF EXISTS "campo_curvas_select_authenticated" ON public.campo_curvas_crecimiento;
CREATE POLICY "campo_curvas_select_authenticated"
  ON public.campo_curvas_crecimiento FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "campo_curvas_escritura_admin" ON public.campo_curvas_crecimiento;
CREATE POLICY "campo_curvas_escritura_admin"
  ON public.campo_curvas_crecimiento FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::text))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP TRIGGER IF EXISTS update_campo_curvas_updated_at ON public.campo_curvas_crecimiento;
CREATE TRIGGER update_campo_curvas_updated_at
  BEFORE UPDATE ON public.campo_curvas_crecimiento
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- El nombre de la finca en Aerobotics, para poder colgar las curvas de las
-- parcelas dibujadas (los planos solo traen el número de finca).
ALTER TABLE public.campo_parcelas ADD COLUMN IF NOT EXISTS origen_finca_nombre TEXT;
