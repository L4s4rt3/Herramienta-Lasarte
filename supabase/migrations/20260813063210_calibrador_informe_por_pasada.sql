-- Un lote puede entrar en linea VARIOS DIAS, y cada entrada tiene su informe.
--
-- EL CASO REAL (13-08-2026). El lote 26051506 se paso el 11 (48 bins, 8.589 kg)
-- y otra vez el 12 (56 bins, 12.480 kg). Con la clave primaria en `lote` a
-- secas, el informe del 12 sobreescribio al del 11 y esos 8.589 kg
-- desaparecieron sin que nadie se enterase.
--
-- La clave pasa a ser (lote, comienzo): el comienzo identifica la pasada. Ojo,
-- NO se usa `fecha`, porque un mismo lote puede pasar dos veces el mismo dia y
-- volveriamos a perder una.
--
-- LA FECHA SIGUE SIENDO LA DEL COMIENZO, no la del fin (regla del dueño,
-- 13-08-2026): el ultimo lote del dia se abre a las 12:03 y no se cierra hasta
-- la mañana siguiente — el informe del 11 declara 17 h 19 min de lote y solo
-- 40 min de maquina — pero ese lote es del dia 11. Ya lo resuelve
-- fechaDeComienzo() en scripts/lib-informe-calibrador.mjs.

ALTER TABLE public.calibrador_informe DROP CONSTRAINT IF EXISTS calibrador_informe_pkey;

-- Sin comienzo no se puede distinguir una pasada de otra: se rellena con la
-- fecha para las filas viejas (las del volcado SQL, que no traen hora).
UPDATE public.calibrador_informe
   SET comienzo = coalesce(comienzo, fecha::text)
 WHERE comienzo IS NULL;

ALTER TABLE public.calibrador_informe ALTER COLUMN comienzo SET NOT NULL;
ALTER TABLE public.calibrador_informe ADD PRIMARY KEY (lote, comienzo);

CREATE INDEX IF NOT EXISTS calibrador_informe_lote_idx ON public.calibrador_informe (lote);
CREATE INDEX IF NOT EXISTS calibrador_informe_fecha_idx ON public.calibrador_informe (fecha);

COMMENT ON TABLE public.calibrador_informe IS
  'Un informe por PASADA de lote, no por lote: el mismo lote puede entrar en linea varios dias. La fecha es la del COMIENZO (el ultimo lote del dia se cierra a la mañana siguiente pero cuenta como del dia que empezo).';
