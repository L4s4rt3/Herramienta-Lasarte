-- El historial de stock dice QUIÉN hizo cada cambio (petición del 09-09).
-- El uuid (cambiado_por) ya se registraba desde el primer día; se le suma el
-- correo DENORMALIZADO en la propia fila: el historial es un registro de
-- auditoría y debe leerse solo, sin depender de que el usuario siga existiendo
-- (cambiado_por es ON DELETE SET NULL) ni de poder mirar auth.users.

ALTER TABLE public.stock_consumibles_historial
  ADD COLUMN cambiado_por_email TEXT;

-- El trigger rellena también el correo (SECURITY DEFINER: puede leer auth.users).
CREATE OR REPLACE FUNCTION public.stock_consumibles_log_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock IS DISTINCT FROM OLD.stock THEN
    INSERT INTO public.stock_consumibles_historial
      (consumible_id, stock_anterior, stock_nuevo, cambiado_por, cambiado_por_email)
    VALUES (
      NEW.id,
      OLD.stock,
      NEW.stock,
      auth.uid(),
      (SELECT u.email FROM auth.users u WHERE u.id = auth.uid())
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Lo ya registrado desde el 01-09 recupera su autor por el uuid guardado.
UPDATE public.stock_consumibles_historial h
SET cambiado_por_email = u.email
FROM auth.users u
WHERE h.cambiado_por = u.id
  AND h.cambiado_por_email IS NULL;
