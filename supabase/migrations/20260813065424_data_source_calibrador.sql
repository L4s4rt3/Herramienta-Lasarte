-- Un lote puede entrar en `lotes_dia` porque lo dio de alta el calibrador, no
-- una persona ni la IA. Hasta ahora solo existían 'manual' e 'ia', así que un
-- lote conciliado desde la máquina se habría tenido que disfrazar de uno de los
-- dos — y de dónde viene un dato es justo lo que no se debe perder.
ALTER TYPE public.data_source ADD VALUE IF NOT EXISTS 'calibrador';
