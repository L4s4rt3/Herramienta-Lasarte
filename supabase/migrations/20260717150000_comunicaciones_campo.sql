-- =============================================================================
-- MIGRACION: Comunicaciones de campaña (a agricultores y proveedores)
--
-- Seccion exclusiva de la cuenta jesus@lasartesat.es (y de administracion):
-- Jesus envia comunicados de campaña ("que hay que hacer para la campaña que
-- entra") a agricultores y proveedores, con los correos introducidos a mano o
-- guardados en una agenda importable desde Excel.
--
--   - can_access_comunicaciones_campo(): gate de acceso por email del JWT
--     (mismo patron que can_access_ventas_categoria, el precedente de acceso
--     por email de Categoria segunda, pero con el email fijado aqui en vez de
--     una tabla de autorizados: el encargo es "exclusivo para Jesus").
--   - contactos_campo: la agenda (nombre, email, tipo agricultor/proveedor),
--     con enlace OPCIONAL al catalogo canonico de productores
--     (calidad_productores) para cruzar datos en el futuro.
--   - comunicaciones_campo: historial de comunicados enviados (destinatarios
--     como jsonb [{nombre,email}], resultado del envio y provider_ids de
--     Brevo/Resend para auditoria).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS (las tablas guardan datos manuales
-- y no deben vaciarse al re-ejecutar) + DROP POLICY IF EXISTS antes de cada
-- CREATE POLICY.
-- =============================================================================

-- ─── Gate de acceso ──────────────────────────────────────────────────────────
-- true si eres admin O el email de tu sesion es jesus@lasartesat.es.
-- SECURITY DEFINER + search_path fijado, como can_access_ventas_categoria.

CREATE OR REPLACE FUNCTION public.can_access_comunicaciones_campo()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'admin')
    OR lower(trim(COALESCE(auth.jwt() ->> 'email', ''))) = 'jesus@lasartesat.es';
$$;

-- ─── Agenda de contactos de campo ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contactos_campo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  email TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('agricultor', 'proveedor')),
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  -- Enlace opcional al catalogo canonico de productores (si el contacto es un
  -- agricultor ya registrado en calidad_productores).
  productor_id UUID REFERENCES public.calidad_productores(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contactos_campo_tipo_activo
  ON public.contactos_campo(tipo, activo);

ALTER TABLE public.contactos_campo ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contactos_campo TO authenticated;

DROP POLICY IF EXISTS "contactos_campo_select_authorized" ON public.contactos_campo;
DROP POLICY IF EXISTS "contactos_campo_insert_authorized" ON public.contactos_campo;
DROP POLICY IF EXISTS "contactos_campo_update_authorized" ON public.contactos_campo;
DROP POLICY IF EXISTS "contactos_campo_delete_authorized" ON public.contactos_campo;

CREATE POLICY "contactos_campo_select_authorized"
  ON public.contactos_campo FOR SELECT
  USING (public.can_access_comunicaciones_campo());

CREATE POLICY "contactos_campo_insert_authorized"
  ON public.contactos_campo FOR INSERT
  WITH CHECK (public.can_access_comunicaciones_campo());

CREATE POLICY "contactos_campo_update_authorized"
  ON public.contactos_campo FOR UPDATE
  USING (public.can_access_comunicaciones_campo())
  WITH CHECK (public.can_access_comunicaciones_campo());

CREATE POLICY "contactos_campo_delete_authorized"
  ON public.contactos_campo FOR DELETE
  USING (public.can_access_comunicaciones_campo());

-- ─── Historial de comunicados de campaña ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comunicaciones_campo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  asunto TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  -- Array jsonb de {nombre, email}: la foto de a quien se envio, aunque el
  -- contacto se borre o cambie despues en la agenda.
  destinatarios JSONB NOT NULL DEFAULT '[]'::jsonb,
  enviados INTEGER NOT NULL DEFAULT 0,
  -- Array jsonb de {email, error} con los envios fallidos.
  fallidos JSONB,
  estado TEXT NOT NULL CHECK (estado IN ('enviada', 'borrador', 'error')),
  -- Array jsonb de {email, providerId} (ids de Brevo/Resend) para auditoria.
  provider_ids JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comunicaciones_campo_created_at
  ON public.comunicaciones_campo(created_at DESC);

ALTER TABLE public.comunicaciones_campo ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comunicaciones_campo TO authenticated;

DROP POLICY IF EXISTS "comunicaciones_campo_select_authorized" ON public.comunicaciones_campo;
DROP POLICY IF EXISTS "comunicaciones_campo_insert_authorized" ON public.comunicaciones_campo;
DROP POLICY IF EXISTS "comunicaciones_campo_update_authorized" ON public.comunicaciones_campo;
DROP POLICY IF EXISTS "comunicaciones_campo_delete_authorized" ON public.comunicaciones_campo;

CREATE POLICY "comunicaciones_campo_select_authorized"
  ON public.comunicaciones_campo FOR SELECT
  USING (public.can_access_comunicaciones_campo());

CREATE POLICY "comunicaciones_campo_insert_authorized"
  ON public.comunicaciones_campo FOR INSERT
  WITH CHECK (public.can_access_comunicaciones_campo());

CREATE POLICY "comunicaciones_campo_update_authorized"
  ON public.comunicaciones_campo FOR UPDATE
  USING (public.can_access_comunicaciones_campo())
  WITH CHECK (public.can_access_comunicaciones_campo());

CREATE POLICY "comunicaciones_campo_delete_authorized"
  ON public.comunicaciones_campo FOR DELETE
  USING (public.can_access_comunicaciones_campo());
