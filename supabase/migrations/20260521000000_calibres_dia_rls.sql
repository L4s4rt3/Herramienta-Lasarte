-- =============================================================================
-- MIGRACIÓN: RLS policies faltantes para calibres_dia
--
-- calibres_dia se creó manualmente y no tiene políticas RLS,
-- lo que bloquea cualquier consulta SELECT.
-- =============================================================================

ALTER TABLE public.calibres_dia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calibres_select_all_authenticated"
  ON public.calibres_dia FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "calibres_insert_own"
  ON public.calibres_dia FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "calibres_update_own_or_admin"
  ON public.calibres_dia FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "calibres_delete_own_or_admin"
  ON public.calibres_dia FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
