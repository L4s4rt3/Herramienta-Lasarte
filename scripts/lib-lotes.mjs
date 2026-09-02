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

/**
 * De varios informes DOCX de la MISMA PASADA, el mas reciente. El resto sobra.
 *
 * POR QUE EXISTE. El batch de un DOCX es hash(lote crudo + comienzo). Si planta
 * edita el nombre del lote en el Sizer y vuelve a guardar, sale otro batch y el
 * dia cuenta la pasada dos veces: el 31-08-2026 el 26082901 llego como
 * "26082901" (22.396 kg, 10:15) y al dia siguiente como "26082901 -95 BOX"
 * (25.939 kg) con el MISMO comienzo, y el parte sumo 53 t en un dia de 31 —
 * DSJ +50%. La vista clasificacion_lote ya aplicaba esta regla (migracion
 * 20260901100000); esta es la misma para los scripts, que leian
 * calibrador_informe por su cuenta.
 *
 * LA REGLA. Misma pasada = mismo codigo base (codigoBaseLote) + misma fecha +
 * mismo comienzo. Gana el recibido_at mas reciente (sin recibido_at pierde).
 * El comienzo es lo que separa un re-guardado de una pasada NUEVA del mismo
 * lote el mismo dia (26051507/12-08 a las 11:03 y a las 12:14 son dos y se
 * quedan las dos). Sin fecha en las filas (consulta de un solo dia) se compara
 * por base + comienzo, que es lo mismo.
 *
 * @param informes filas de calibrador_informe con lote, comienzo y, si se
 *                 tienen, fecha y recibido_at
 * @returns las mismas filas (mismos objetos, mismo orden) sin las repetidas
 */
export function pasadasDocxFrescas(informes) {
  const clave = (i) => `${codigoBaseLote(i.lote)}|${i.fecha ?? ""}|${String(i.comienzo ?? "").trim()}`;
  const instante = (i) => {
    const t = i.recibido_at ? new Date(i.recibido_at).getTime() : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  const mejor = new Map();
  for (const i of informes ?? []) {
    const k = clave(i);
    const actual = mejor.get(k);
    if (!actual || instante(i) > instante(actual)) mejor.set(k, i);
  }
  return (informes ?? []).filter((i) => mejor.get(clave(i)) === i);
}
