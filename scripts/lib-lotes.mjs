/**
 * El codigo con el que se casan las dos caras de una misma pasada.
 *
 * POR QUE EXISTE. Planta escribe en `lote_codigo` el lote Y lo que echo de mas:
 * "26051802+ 2 BOX DE RECICLAJE", "26051904-15 BOX +7 BOX DE RECICLAJE",
 * "PREC --26073101". El calibrador manda "26051802" a secas. Comparar los
 * codigos crudos hacia creer que la pasada FALTABA:
 * conciliar-lotes-calibrador.mjs la daba de alta otra vez y la campana acabo con
 * 157 pasadas repetidas — 2.708.859 kg contados dos veces (visto el 18-08-2026).
 *
 * Es la MISMA funcion para todos: quien decide si dos filas son la misma pasada
 * no puede tener dos opiniones segun quien pregunte.
 *
 * Lo que no lleva ocho digitos (-MUESTRA-, INDUSTRIA) se compara tal cual en
 * mayusculas: no tiene lote, pero tampoco puede casar con cualquier cosa.
 */
export function codigoBaseLote(codigo) {
  const s = String(codigo ?? "").trim();
  return (s.match(/\d{8}/) ?? [s.toUpperCase()])[0];
}
