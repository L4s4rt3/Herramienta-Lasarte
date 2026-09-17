-- RRHH → Asistencia por periodos (17-09-2026).
--
-- LA PREGUNTA QUE NO SE PODÍA CONTESTAR. La página de asistencia solo sabía
-- mirar una semana: para saber desde cuándo hay datos había que ir pasando
-- semana a semana hacia atrás hasta topar con una vacía. Y una semana vacía
-- no distingue "no se trabajó" de "no se ha volcado el fichaje todavía" (el
-- volcado del reloj es semanal, los lunes, por semanas completas).
--
-- Esta vista la contesta de una vez: un renglón por día CON registros, con
-- cuántos hay y cuántos son presencias. Son ~100 filas hoy (99 días desde el
-- 18-05-2026) y unas 300 por campaña, frente a las 5.782 filas de
-- asistencia_detalle que habría que traerse enteras al navegador (6 páginas
-- de fetchAllRows) para deducir lo mismo.
--
-- `presentes` no sobra: un domingo volcado trae 58 registros y 0 presencias,
-- así que "día con registros" y "día trabajado" son cosas distintas y la
-- página enseña las dos por separado.
--
-- security_invoker: regla del proyecto desde la auditoría del 02-09-2026
-- (ver 20260902085430_cerrar_anon_y_security_invoker_vistas.sql). La RLS de
-- asistencia_detalle ya permite SELECT a cualquier usuario autenticado, así
-- que la vista ve exactamente lo mismo que la app.
create or replace view public.asistencia_cobertura_dia
with (security_invoker = on) as
select
  a.date                                         as fecha,
  count(*)::int                                  as registros,
  count(*) filter (where a.presente)::int        as presentes,
  count(*) filter (where not a.presente)::int    as ausentes
from public.asistencia_detalle a
group by a.date;

grant select on public.asistencia_cobertura_dia to authenticated, service_role;
revoke all on public.asistencia_cobertura_dia from anon;
