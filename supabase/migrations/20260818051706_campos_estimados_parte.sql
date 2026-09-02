-- Los manuales del parte se ESTIMAN cuando nadie los mete — pero jamás en silencio.
--
-- ENCARGO DEL USUARIO (17-08-2026, se va una semana): "si no hay información de
-- la que yo pongo manual, se haga una estimación según histórico". Sin esto, los
-- partes se quedan en Borrador esperando a una persona y la semana entera sale
-- con descuadres provisionales y análisis a medias.
--
-- LA REGLA DE LA CASA SIGUE VALIENDO (nunca estimar en silencio): cada campo
-- estimado queda apuntado aquí con su valor y su método. El dato real SIEMPRE
-- gana: si alguien teclea el campo, la estimación se retira sola en la
-- siguiente pasada (scripts/estimar-manuales-parte.mjs), y un parte con
-- estimaciones vigentes no se queda en "Analizado" (se reabre a Borrador) ni
-- debería validarse — el correo avisa si pasa.
--
-- Forma del JSON:
--   { "estimado_at": "2026-08-17T...", "gracia_dias": 2,
--     "campos": { "kg_inventario_sin_alta": { "valor": 845, "metodo": "fotos-erp" }, ... } }
alter table public.partes_diarios
  add column if not exists campos_estimados jsonb;

comment on column public.partes_diarios.campos_estimados is
  'Campos manuales rellenados por estimación (scripts/estimar-manuales-parte.mjs) con su valor y método. NULL = todo lo que hay lo metió una persona. El dato real pisa la estimación y la retira.';
