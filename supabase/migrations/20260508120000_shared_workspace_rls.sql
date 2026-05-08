-- =============================================================================
-- MIGRACIÓN: Modelo de workspace compartido
--
-- PROBLEMA: Las políticas actuales usan auth.uid() = user_id en SELECT,
-- lo que hace que cada usuario solo vea sus propios datos.
--
-- SOLUCIÓN: Todos los usuarios autenticados pueden VER todos los datos.
-- Solo pueden EDITAR / BORRAR los suyos propios (o los admins todo).
-- Esto refleja el uso real: un equipo de trabajo compartiendo partes diarios.
-- =============================================================================

-- ─── partes_diarios ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own partes"     ON public.partes_diarios;
DROP POLICY IF EXISTS "Users can insert own partes"   ON public.partes_diarios;
DROP POLICY IF EXISTS "Users can update own partes"   ON public.partes_diarios;
DROP POLICY IF EXISTS "Users can delete own partes"   ON public.partes_diarios;
DROP POLICY IF EXISTS "users_own_partes"              ON public.partes_diarios;

CREATE POLICY "partes_select_all_authenticated"
  ON public.partes_diarios FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "partes_insert_own"
  ON public.partes_diarios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "partes_update_own_or_admin"
  ON public.partes_diarios FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "partes_delete_own_or_admin"
  ON public.partes_diarios FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ─── partes_archivos ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own files"      ON public.partes_archivos;
DROP POLICY IF EXISTS "Users can insert own files"    ON public.partes_archivos;
DROP POLICY IF EXISTS "Users can update own files"    ON public.partes_archivos;
DROP POLICY IF EXISTS "Users can delete own files"    ON public.partes_archivos;
DROP POLICY IF EXISTS "users_own_archivos"            ON public.partes_archivos;

CREATE POLICY "archivos_select_all_authenticated"
  ON public.partes_archivos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "archivos_insert_own"
  ON public.partes_archivos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "archivos_update_own"
  ON public.partes_archivos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "archivos_delete_own_or_admin"
  ON public.partes_archivos FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ─── production_runs ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own runs"       ON public.production_runs;
DROP POLICY IF EXISTS "Users can insert own runs"     ON public.production_runs;
DROP POLICY IF EXISTS "Users can update own runs"     ON public.production_runs;
DROP POLICY IF EXISTS "Users can delete own runs"     ON public.production_runs;

CREATE POLICY "runs_select_all_authenticated"
  ON public.production_runs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "runs_insert_own"
  ON public.production_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "runs_update_own"
  ON public.production_runs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "runs_delete_own_or_admin"
  ON public.production_runs FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ─── gstock_entries ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own gstock"     ON public.gstock_entries;
DROP POLICY IF EXISTS "Users can insert own gstock"   ON public.gstock_entries;
DROP POLICY IF EXISTS "Users can update own gstock"   ON public.gstock_entries;
DROP POLICY IF EXISTS "Users can delete own gstock"   ON public.gstock_entries;

CREATE POLICY "gstock_select_all_authenticated"
  ON public.gstock_entries FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "gstock_insert_own"
  ON public.gstock_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "gstock_update_own"
  ON public.gstock_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "gstock_delete_own_or_admin"
  ON public.gstock_entries FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ─── lotes_dia ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own lotes"      ON public.lotes_dia;
DROP POLICY IF EXISTS "Users can insert own lotes"    ON public.lotes_dia;
DROP POLICY IF EXISTS "Users can update own lotes"    ON public.lotes_dia;
DROP POLICY IF EXISTS "Users can delete own lotes"    ON public.lotes_dia;

CREATE POLICY "lotes_select_all_authenticated"
  ON public.lotes_dia FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "lotes_insert_own"
  ON public.lotes_dia FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "lotes_update_own"
  ON public.lotes_dia FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "lotes_delete_own_or_admin"
  ON public.lotes_dia FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ─── costes_diarios ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own costes"     ON public.costes_diarios;
DROP POLICY IF EXISTS "Users can insert own costes"   ON public.costes_diarios;
DROP POLICY IF EXISTS "Users can update own costes"   ON public.costes_diarios;
DROP POLICY IF EXISTS "Users can delete own costes"   ON public.costes_diarios;

CREATE POLICY "costes_select_all_authenticated"
  ON public.costes_diarios FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "costes_insert_own"
  ON public.costes_diarios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "costes_update_own_or_admin"
  ON public.costes_diarios FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "costes_delete_own_or_admin"
  ON public.costes_diarios FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ─── asistencia_diaria ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own asistencia" ON public.asistencia_diaria;
DROP POLICY IF EXISTS "Users can insert own asistencia" ON public.asistencia_diaria;
DROP POLICY IF EXISTS "Users can update own asistencia" ON public.asistencia_diaria;
DROP POLICY IF EXISTS "Users can delete own asistencia" ON public.asistencia_diaria;

CREATE POLICY "asistencia_select_all_authenticated"
  ON public.asistencia_diaria FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "asistencia_insert_own"
  ON public.asistencia_diaria FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "asistencia_update_own_or_admin"
  ON public.asistencia_diaria FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "asistencia_delete_own_or_admin"
  ON public.asistencia_diaria FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ─── Storage: partes-archivos ─────────────────────────────────────────────────
-- Los archivos también deben ser visibles para todos los autenticados
DROP POLICY IF EXISTS "Users can view own files in storage"   ON storage.objects;
DROP POLICY IF EXISTS "partes_archivos_select_own"            ON storage.objects;

CREATE POLICY "storage_partes_select_authenticated"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'partes-archivos'
    AND auth.role() = 'authenticated'
  );

-- INSERT / UPDATE / DELETE siguen siendo solo del propietario (carpeta = user_id)
-- (las políticas existentes de insert/update/delete no cambian)
