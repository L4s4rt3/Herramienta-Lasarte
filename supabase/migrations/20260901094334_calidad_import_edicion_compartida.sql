-- Edición compartida de los controles de importación.
--
-- El control es de la EMPRESA, no de quien lo teclea: en la práctica los
-- crean cuentas distintas (soporte, eusebio, raquel) y la evaluadora tiene
-- que poder completar cualquiera. Con el patrón anterior (update solo del
-- creador o admin) un UPDATE ajeno ni siquiera daba error: RLS lo filtraba y
-- se quedaba en "0 filas", con la app diciendo "Guardado" en falso.
DROP POLICY IF EXISTS "calidad_import_controles_update_own_or_admin" ON public.calidad_import_controles;
DROP POLICY IF EXISTS "calidad_import_controles_delete_own_or_admin" ON public.calidad_import_controles;
DROP POLICY IF EXISTS "calidad_import_controles_update_authenticated" ON public.calidad_import_controles;
DROP POLICY IF EXISTS "calidad_import_controles_delete_authenticated" ON public.calidad_import_controles;

CREATE POLICY "calidad_import_controles_update_authenticated"
  ON public.calidad_import_controles FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "calidad_import_controles_delete_authenticated"
  ON public.calidad_import_controles FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "calidad_import_fotos_update_own_or_admin" ON public.calidad_import_fotos;
DROP POLICY IF EXISTS "calidad_import_fotos_delete_own_or_admin" ON public.calidad_import_fotos;
DROP POLICY IF EXISTS "calidad_import_fotos_update_authenticated" ON public.calidad_import_fotos;
DROP POLICY IF EXISTS "calidad_import_fotos_delete_authenticated" ON public.calidad_import_fotos;

CREATE POLICY "calidad_import_fotos_update_authenticated"
  ON public.calidad_import_fotos FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "calidad_import_fotos_delete_authenticated"
  ON public.calidad_import_fotos FOR DELETE
  USING (auth.role() = 'authenticated');
