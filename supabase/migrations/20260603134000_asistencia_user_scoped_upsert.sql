-- Scope asistencia_detalle upserts by user so weekly imports do not collide
-- with attendance rows created by another authenticated user.

ALTER TABLE public.asistencia_detalle
  DROP CONSTRAINT IF EXISTS asistencia_detalle_date_trabajador_id_key;

ALTER TABLE public.asistencia_detalle
  ADD CONSTRAINT asistencia_detalle_user_date_trabajador_key
  UNIQUE (user_id, date, trabajador_id);

DROP POLICY IF EXISTS "asistencia_detalle_update_own_or_admin" ON public.asistencia_detalle;
CREATE POLICY "asistencia_detalle_update_own_or_admin"
  ON public.asistencia_detalle FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
