-- Nº de box de reciclaje del día (dato manual del parte, regla del dueño
-- 21-jul-2026). Los 30 kg son la TARA del box de plástico vacío: el parte
-- apunta el reciclado de malla Z1/Z2 en BRUTO (fruta + envases), y el neto de
-- fruta que vuelve a la línea es bruto − nBox × 30 (su ejemplo: "700 kg de
-- reciclaje en Z1 y son 3 box → 700 − 90 = 610 kg netos"). La conciliación de
-- kg (src/lib/conciliacionKg.ts) descuenta ese neto de las pasadas del día
-- para que la fruta reciclada —ya contada en su lote original— no infle
-- ningún lote: primero a las pasadas que anotan boxes en su nombre
-- ("+7 BOX DE RECICLAJE"), el resto proporcionalmente.
-- NULL = sin dato (partes anteriores a esta columna); 0 = "ese día no hubo".
alter table public.partes_diarios
  add column if not exists box_reciclaje integer;

comment on column public.partes_diarios.box_reciclaje is
  'Nº de box de reciclaje del día. Su tara (~30 kg/box) se resta del reciclado bruto Z1+Z2 para obtener el neto de fruta reciclada. Manual, del parte. NULL = sin dato.';
