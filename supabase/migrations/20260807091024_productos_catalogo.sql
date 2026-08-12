-- =============================================================================
-- MIGRACION: Catálogo de PRODUCTOS de confección (ficha de coste por producto)
--
-- Encargo del dueño (07-ago-2026): "vamos a definir costes de cada producto…
-- debemos sacar el CMV por producto y ver cada día si perdemos o ganamos".
-- Elección explícita frente a la alternativa de heredar costes por empaque:
-- CADA PRODUCTO TIENE FICHA PROPIA, editable producto a producto.
--
-- ─── Qué se guarda aquí y qué NO ─────────────────────────────────────────────
-- SOLO lo que decide una persona. Todo lo que se puede DEDUCIR del texto del
-- calibrador (zona de confección, marca, calibre, empaque, kg por bulto) es un
-- estado DERIVADO y se calcula en src/lib/productosCanonicos.ts cada vez que
-- se necesita — no se guarda, siguiendo el principio del repo de no persistir
-- lo derivable (si mañana mejora la deducción, mejora sola en toda la app sin
-- re-backfillear nada).
--
-- La excepción son los OVERRIDES: si el dueño discrepa de una deducción
-- (kg_por_bulto, zona), su valor se guarda aquí y MANDA sobre lo deducido. Un
-- override a NULL significa "no he tocado esto", nunca "vale cero".
--
-- ─── null ≠ 0 ────────────────────────────────────────────────────────────────
-- Todos los importes nacen NULL. Un producto sin coste de material cargado NO
-- cuesta 0 de material: es un dato que falta, y la página lo marca como
-- incompleto en vez de calcular un CMV falsamente bajo. Por eso ninguna
-- columna de coste/precio tiene DEFAULT 0.
--
-- Idempotente: CREATE ... IF NOT EXISTS y el backfill va con ON CONFLICT DO
-- NOTHING, así que re-aplicarla no duplica fichas ni pisa lo ya editado.
-- =============================================================================

-- ─── 1. Clave canónica del producto ──────────────────────────────────────────
-- ESPEJO EXACTO de claveProducto() en src/lib/productosCanonicos.ts. Si cambia
-- una, hay que cambiar la otra: el catálogo se indexa por esta clave y una
-- divergencia partiría un producto en dos fichas.
--
-- Colapsa SOLO ruido de tecleo (mayúsculas, tildes, puntuación, KG/K, las "M"
-- finales de los milímetros) y deja los dígitos intactos, que es donde vive la
-- identidad del producto: "CAL 5/6" y "CAL 3/4" siguen siendo productos
-- distintos. Medido contra la BD real (ago-2026): 1.155 textos → 977 claves.
--
-- Los diacríticos se cubren con translate() sobre el set español (SQL no tiene
-- NFD sin la extensión unaccent). Verificado: los únicos caracteres no ASCII
-- que aparecen hoy en los nombres de producto son Á, Ñ y Ü, los tres en el set.
CREATE OR REPLACE FUNCTION public.normalizar_clave_producto(nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(
          upper(coalesce(nombre, '')),
          'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
          'AAAAAEEEEIIIIOOOOOUUUUNC'
        ),
        'KGS?\M', 'K', 'g'      -- "5 KG" y "5K" son el mismo formato
      ),
      '[^A-Z0-9]+', '', 'g'     -- espacios, puntos, guiones, paréntesis, barras
    ),
    'M+$', ''                   -- "(70/84M)" == "(70/84MM)"
  )
$$;

COMMENT ON FUNCTION public.normalizar_clave_producto(text) IS
  'Espejo de claveProducto() en src/lib/productosCanonicos.ts. Colapsa erratas de tecleo del producto del calibrador dejando los dígitos (calibre y formato) intactos. Mantener sincronizados ante cualquier cambio.';

-- ─── 2. productos_catalogo ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.productos_catalogo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identidad. `clave` la genera la BD: así es imposible insertar una ficha
  -- con una clave que no case con la normalización.
  nombre TEXT NOT NULL,
  clave TEXT NOT NULL GENERATED ALWAYS AS (public.normalizar_clave_producto(nombre)) STORED,

  -- ─── Ficha editable: coste ───
  -- Kg de fruta por bulto. Override de lo deducido del empaque.
  kg_por_bulto NUMERIC CHECK (kg_por_bulto IS NULL OR kg_por_bulto > 0),
  -- € de material por BULTO (caja, box, palet…).
  coste_material_bulto NUMERIC CHECK (coste_material_bulto IS NULL OR coste_material_bulto >= 0),
  -- € de material por PIEZA (malla) en los girsacs, donde el material se
  -- consume por malla y no por bulto: un bulto de 9 mallas gasta 9 mallas.
  coste_material_pieza NUMERIC CHECK (coste_material_pieza IS NULL OR coste_material_pieza >= 0),
  -- Peso relativo con el que este producto absorbe el coste de tratamiento del
  -- día (personal + suministros + consumibles), repartido POR KG PONDERADO
  -- (decisión del dueño, 07-ago-2026). Es relativo, no €/kg: granel = 1,0 es
  -- el ancla. Nace con la semilla de su zona (INDICE_CONFECCION_SEMILLA).
  indice_confeccion NUMERIC CHECK (indice_confeccion IS NULL OR indice_confeccion >= 0),

  -- ─── Ficha editable: venta ───
  -- Precio manual €/kg. Solo se usa si el producto no tiene método de venta
  -- con facturación real (ver metodo_venta).
  precio_venta_eur_kg NUMERIC CHECK (precio_venta_eur_kg IS NULL OR precio_venta_eur_kg >= 0),
  -- Método de venta del ERP (LN211, LN314…) o de Mercadona (MA3KGC…) al que
  -- corresponde este producto. Si está puesto, el precio sale de la
  -- facturación REAL de ese método y manda sobre precio_venta_eur_kg.
  metodo_venta TEXT,

  -- ─── Overrides de lo deducido ───
  -- Zona de confección, si el dueño discrepa de clasificarProductoInforme.
  zona_override TEXT CHECK (zona_override IS NULL OR zona_override IN
    ('Mallas', 'Mesas', 'Graneleras', 'Industria', 'Excluir')),

  -- ─── Estado ───
  -- Un producto inactivo no aparece en la vista diaria (dejó de fabricarse).
  activo BOOLEAN NOT NULL DEFAULT true,
  notas TEXT,

  -- Quién tocó la ficha por última vez: distingue "deducido" de "revisado por
  -- una persona" en la UI. NULL = nadie la ha tocado todavía.
  editado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  editado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_catalogo_clave
  ON public.productos_catalogo(clave);

CREATE INDEX IF NOT EXISTS idx_productos_catalogo_metodo
  ON public.productos_catalogo(metodo_venta) WHERE metodo_venta IS NOT NULL;

COMMENT ON TABLE public.productos_catalogo IS
  'Ficha de coste y precio por PRODUCTO de confección (uno por clave canónica). Solo guarda lo que decide una persona: zona/marca/calibre/empaque se deducen en src/lib/productosCanonicos.ts y no se persisten. Importes NULL = sin dato (nunca 0).';

-- ─── 3. productos_alias ──────────────────────────────────────────────────────
-- Capa de indirección clave → ficha, para poder FUSIONAR productos a mano.
--
-- Por defecto cada clave apunta a su propia ficha, así que resolver un texto
-- crudo es: texto → normalizar_clave_producto → alias → producto. La tabla se
-- gana el sitio cuando el dueño decide que dos claves distintas son el mismo
-- producto (p. ej. "… (70/84M)" y "… (70/84M) CHICO", que la normalización NO
-- une porque el sufijo podría ser un producto de verdad): se repunta el alias
-- a la otra ficha y los kg se juntan SIN tocar los datos crudos del
-- calibrador, que quedan intactos y auditables.
--
-- Es una fila por CLAVE, no por texto crudo: la lista de textos exactos que
-- han caído en una ficha es un estado derivado (se saca agrupando
-- lote_clasificacion por producto) y, como el resto de derivados de este
-- módulo, no se persiste.
CREATE TABLE IF NOT EXISTS public.productos_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id UUID NOT NULL REFERENCES public.productos_catalogo(id) ON DELETE CASCADE,
  -- La clave canónica que se resuelve. Se guarda ya normalizada (no es
  -- GENERATED sobre un texto crudo: aquí el dato ES la clave).
  alias_clave TEXT NOT NULL CHECK (alias_clave <> ''),
  -- Texto representativo de esa clave, solo para que la UI lo enseñe legible.
  alias TEXT NOT NULL,
  -- 'backfill' (esta migración), 'auto' (clave nueva vista por la app),
  -- 'manual' (fusión hecha por el dueño).
  origen TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una clave solo puede apuntar a UNA ficha: es lo que hace la resolución
-- determinista (texto crudo → clave → alias → producto).
CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_alias_clave
  ON public.productos_alias(alias_clave);

CREATE INDEX IF NOT EXISTS idx_productos_alias_producto
  ON public.productos_alias(producto_id);

-- ─── 4. RLS: admin, igual que empaque_precios / economico_precios ────────────
-- Los costes y precios de venta son información económica sensible: mismo
-- criterio que el resto del módulo Económico (solo admin), no el de las tablas
-- operativas.
ALTER TABLE public.productos_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos_alias ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.productos_catalogo TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.productos_alias TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='productos_catalogo' AND policyname='productos_catalogo_select_admin') THEN
    CREATE POLICY "productos_catalogo_select_admin" ON public.productos_catalogo
      FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='productos_catalogo' AND policyname='productos_catalogo_insert_admin') THEN
    CREATE POLICY "productos_catalogo_insert_admin" ON public.productos_catalogo
      FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='productos_catalogo' AND policyname='productos_catalogo_update_admin') THEN
    CREATE POLICY "productos_catalogo_update_admin" ON public.productos_catalogo
      FOR UPDATE USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='productos_catalogo' AND policyname='productos_catalogo_delete_admin') THEN
    CREATE POLICY "productos_catalogo_delete_admin" ON public.productos_catalogo
      FOR DELETE USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='productos_alias' AND policyname='productos_alias_select_admin') THEN
    CREATE POLICY "productos_alias_select_admin" ON public.productos_alias
      FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='productos_alias' AND policyname='productos_alias_insert_admin') THEN
    CREATE POLICY "productos_alias_insert_admin" ON public.productos_alias
      FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='productos_alias' AND policyname='productos_alias_update_admin') THEN
    CREATE POLICY "productos_alias_update_admin" ON public.productos_alias
      FOR UPDATE USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='productos_alias' AND policyname='productos_alias_delete_admin') THEN
    CREATE POLICY "productos_alias_delete_admin" ON public.productos_alias
      FOR DELETE USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- ─── 5. Backfill: una ficha por producto observado ───────────────────────────
-- Fuentes: lote_clasificacion (Informe LOTE, toda la campaña) + producto_dia
-- (Informe PRODUCTO, con empaque, desde may-2026). El nombre que se guarda es
-- la variante con MÁS KG de cada clave — la que el operario escribe
-- habitualmente y la que el dueño reconocerá en pantalla (mismo criterio que
-- nombreDisplayProducto() en TS: kg desc, luego longitud, luego alfabético,
-- para que la elección sea determinista y re-ejecutable).
--
-- Las fichas nacen SIN costes ni precios (todo NULL): esta migración crea el
-- inventario de productos a rellenar, no inventa importes.
WITH textos AS (
  SELECT upper(trim(producto)) AS texto, coalesce(sum(peso_kg), 0) AS kg
  FROM public.lote_clasificacion
  WHERE producto IS NOT NULL AND trim(producto) <> ''
  GROUP BY 1
  UNION ALL
  SELECT upper(trim(producto)) AS texto, coalesce(sum(kg), 0) AS kg
  FROM public.producto_dia
  WHERE producto IS NOT NULL AND trim(producto) <> ''
  GROUP BY 1
),
por_texto AS (
  SELECT texto, sum(kg) AS kg, public.normalizar_clave_producto(texto) AS clave
  FROM textos
  WHERE public.normalizar_clave_producto(texto) <> ''
  GROUP BY 1, 3
),
ganador AS (
  SELECT DISTINCT ON (clave) clave, texto, kg
  FROM por_texto
  ORDER BY clave, kg DESC, length(texto) ASC, texto ASC
)
INSERT INTO public.productos_catalogo (nombre)
SELECT texto FROM ganador
ON CONFLICT (clave) DO NOTHING;

-- Una fila de alias por CLAVE, apuntando de inicio a su propia ficha. A partir
-- de aquí, fusionar dos productos es un UPDATE de producto_id sobre esta
-- tabla, sin tocar ni el catálogo ni los datos crudos del calibrador.
INSERT INTO public.productos_alias (producto_id, alias_clave, alias, origen)
SELECT pc.id, pc.clave, pc.nombre, 'backfill'
FROM public.productos_catalogo pc
ON CONFLICT (alias_clave) DO NOTHING;
