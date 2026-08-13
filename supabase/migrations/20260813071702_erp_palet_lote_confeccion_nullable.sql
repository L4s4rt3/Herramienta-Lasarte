-- Un palet no comercial puede no tener lote de confección, y eso no es un error
-- que haya que tapar: son los 2 movimientos a granel del ERP con `lote = ''`.
-- La clave primaria es `numero`, así que nada depende de que esta columna esté
-- llena. Dejarla NOT NULL obligaría a inventarse una cadena vacía y a que luego
-- alguien la confundiera con un lote de verdad.
ALTER TABLE public.erp_palet ALTER COLUMN lote_confeccion DROP NOT NULL;
