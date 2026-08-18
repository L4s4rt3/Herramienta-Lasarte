/**
 * Comprobacion del emparejado de pasadas repetidas.
 *
 * Lo que protege: de esta funcion depende QUE FILA SE BORRA. Emparejar de mas
 * borra una pasada de verdad y se pierden kilos; emparejar de menos deja la
 * repetida contando doble. Ninguna de las dos da error por pantalla.
 *
 *   node scripts/probar-pasadas-repetidas.mjs
 */
import { emparejarRepetidas } from "./quitar-pasadas-repetidas.mjs";

let fallos = 0;
const comprobar = (titulo, cond) => {
  if (!cond) fallos++;
  console.log(`${cond ? "OK   " : "FALLA"}  ${titulo}`);
};

const delParte = (lote, kg, extra = {}) => ({ id: `p-${lote}-${kg}`, source: "ia", lote_codigo: lote, kg_peso_total: kg, ...extra });
const delVolcado = (lote, kg, extra = {}) => ({ id: `c-${lote}-${kg}`, source: "calibrador", lote_codigo: lote, kg_peso_total: kg, ...extra });

// El caso real del 10-08-2026: el parte con la nota de planta detras, el volcado
// con el codigo limpio, los mismos kilos.
const real = emparejarRepetidas([
  delParte("26051802+ 2 BOX DE RECICLAJE", 17725),
  delParte("26051806", 25645),
  delVolcado("26051802", 17725),
]);
comprobar("casa la pasada aunque planta escribiera algo detras",
  real.length === 1 && real[0].base === "26051802");
comprobar("y la que se borra es la del volcado", real[0].fila.source === "calibrador");
comprobar("la del parte que no tiene gemela no se toca",
  !real.some((p) => p.gemela.lote_codigo === "26051806"));

comprobar("sin fila del volcado no hay nada repetido",
  emparejarRepetidas([delParte("26051802", 17725), delParte("26051806", 25645)]).length === 0);
comprobar("una pasada del volcado que la app NO tiene no es una repetida",
  emparejarRepetidas([delParte("26051806", 25645), delVolcado("26051802", 17725)]).length === 0);

// Mismo lote, kilos distintos: son dos pasadas del mismo lote en el mismo dia.
comprobar("mismo lote con otros kilos no se casa",
  emparejarRepetidas([delParte("26051802", 17725), delVolcado("26051802", 33982)]).length === 0);
comprobar("un kilo de diferencia si se casa (los informes redondean)",
  emparejarRepetidas([delParte("26051802", 17725), delVolcado("26051802", 17724.6)]).length === 1);

// UNO A UNO: dos camiones seguidos del mismo lote con los mismos kilos son dos
// pasadas de verdad. Con una sola fila del volcado solo se borra una.
const dosCamiones = emparejarRepetidas([
  delParte("26051802", 17725), delParte("26051802", 17725), delVolcado("26051802", 17725),
]);
comprobar("dos camiones iguales y un volcado: se casa uno, no los dos", dosCamiones.length === 1);
const dosYDos = emparejarRepetidas([
  { ...delParte("26051802", 17725), id: "p1" }, { ...delParte("26051802", 17725), id: "p2" },
  { ...delVolcado("26051802", 17725), id: "c1" }, { ...delVolcado("26051802", 17725), id: "c2" },
]);
comprobar("y dos contra dos casan cada uno con el suyo, sin repetir gemela",
  dosYDos.length === 2
  && new Set(dosYDos.map((p) => p.fila.id)).size === 2
  && new Set(dosYDos.map((p) => p.gemela.id)).size === 2);

// El precalibrado lleva el lote delante y con guiones.
comprobar("el precalibrado tambien casa",
  emparejarRepetidas([delParte("PREC --26073101", 10830), delVolcado("26073101", 10830)]).length === 1);

// Una fila sin lote no puede casar con nada por parecido que sea el kg.
comprobar("sin lote no se casa nada",
  emparejarRepetidas([delParte("-MUESTRA-", 110), { ...delVolcado("", 110), lote_codigo: null }]).length === 0);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobacion(es) fallidas.`);
process.exit(fallos === 0 ? 0 : 1);
