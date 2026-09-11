-- La revisión automática del parte, antes del correo diario.
--
-- POR QUÉ. Hasta hoy el correo de las 07:40 salía con el parte a medias y el
-- descuadre enterrado en mitad del texto: no había forma de saber, de un
-- vistazo, si el día estaba en orden o no, ni qué se había intentado arreglar.
-- Encargo del dueño (11-09-2026): "que los partes se cuadren antes de enviar
-- los correos; se investiga y se cuadra con la información que se tenga, y si
-- no es posible, que el correo lo avise y diga qué se cree que ha pasado".
--
-- QUÉ GUARDA. Lo que la revisión comprobó ese día y cómo salió:
--   { revisado_at, veredicto: 'en-orden'|'con-reparos',
--     comprobaciones: [{clave, titulo, estado: 'ok'|'reparo'|'n/a', detalle}],
--     reparaciones: [texto],   -- lo que la propia tarea arregló
--     diagnostico:  [texto] }  -- la valoración de lo que no se pudo cuadrar
--
-- NO ES "Validado". El estado del parte sigue teniendo un único candado
-- humano (regla del dueño del 28-08-2026): esto dice "la máquina lo ha
-- repasado", no "una persona lo firma". Por eso vive en su propia columna y
-- no toca `estado`.
alter table public.partes_diarios
  add column if not exists revision jsonb;

comment on column public.partes_diarios.revision is
  'Revisión automática del parte antes del correo diario (scripts/lib-revision-parte.mjs): '
  'revisado_at, veredicto (en-orden / con-reparos), la lista de comprobaciones con su estado, '
  'lo que la tarea reparó sola y el diagnóstico de lo que no pudo cuadrar. '
  'NO sustituye al estado "Validado", que sigue siendo el único candado humano.';
