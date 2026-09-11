/**
 * Comprobacion del emparejado de pasadas repetidas.
 *
 * Lo que protege: de esta funcion depende QUE FILA SE BORRA. Emparejar de mas
 * borra una pasada de verdad y se pierden kilos; emparejar de menos deja la
 * repetida contando doble. Ninguna de las dos da error por pantalla.
 *
 *   node scripts/probar-pasadas-repetidas.mjs
 */
import { emparejarRepetidas, limpiarRepetidasDeParte } from "./quitar-pasadas-repetidas.mjs";

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

// ── La limpieza de UN parte, que corre sola cada mañana (11-09-2026) ────────
//
// Aqui se prueba QUE SE BORRA Y QUE NO, que es lo unico irreversible de todo
// el sistema del parte. Los datos reales no sirven para probarlo: hoy las dos
// repetidas que quedan son justo de las que NO se tocan, asi que la rama del
// borrado solo se ejercita con un doble de la base.

/** Un doble de Supabase con lo justo: leer lotes_dia, mirar quien cuelga, borrar. */
function baseFalsa({ filas, cuelgan = [] }) {
  const borrados = [];
  const responde = (data) => ({ data, error: null });
  return {
    borrados,
    from(tabla) {
      if (tabla === "lotes_dia") {
        return {
          select: () => ({ eq: () => ({ order: () => Promise.resolve(responde(filas)) }) }),
          delete: () => ({ in: (_c, ids) => { borrados.push(...ids); return Promise.resolve({ error: null }); } }),
        };
      }
      // clasificacion_lote y pasada_anotaciones: quien cuelga de una fila.
      return { select: () => ({ in: (_c, ids) => Promise.resolve(responde(
        cuelgan.filter((id) => ids.includes(id)).map((id) => ({ lote_dia_id: id })))) }) };
    },
  };
}

const limpia = [delParte("26051802+ 2 BOX", 17725, { producto: "Naranja" }), delVolcado("26051802", 17725)];
let base = baseFalsa({ filas: limpia });
let r = await limpiarRepetidasDeParte(base, "parte-1", { aplicar: true });
comprobar("repetida limpia: se quita, y solo la del volcado",
  r.quitadas.length === 1 && base.borrados.length === 1 && base.borrados[0] === "c-26051802-17725");
comprobar("y se devuelve la fila ENTERA, que es la copia de seguridad",
  r.quitadas[0].fila.lote_codigo === "26051802" && r.quitadas[0].gemela_id === "p-26051802+ 2 BOX-17725");
comprobar("con sus kilos, para poder decir cuanto se dejo de contar dos veces", r.kg === 17725);

// El caso real del 10-08: la del volcado lleva notas y kg_industria que la del
// parte no tiene. Perder eso para arreglar una suma es un mal cambio.
const conNotas = [delParte("26051802+ 2 BOX", 17725), delVolcado("26051802", 17725, { notas: "Mucho podrido", kg_industria: 400 })];
base = baseFalsa({ filas: conNotas });
r = await limpiarRepetidasDeParte(base, "parte-1", { aplicar: true });
comprobar("si la del volcado tiene algo que la del parte no, NO se borra",
  base.borrados.length === 0 && r.quitadas.length === 0 && r.paraRevisar.length === 1);
comprobar("y se dice exactamente que se perderia",
  r.paraRevisar[0].perderia.includes("notas") && r.paraRevisar[0].perderia.includes("kg_industria"));

// Un 0 no es un dato que se pueda perder: si fuera asi, casi nada se limpiaria.
base = baseFalsa({ filas: [delParte("26051802", 17725), delVolcado("26051802", 17725, { kg_industria: 0 })] });
r = await limpiarRepetidasDeParte(base, "parte-1", { aplicar: true });
comprobar("un campo numerico a 0 no cuenta como dato que se pierda", r.quitadas.length === 1);

// Nada se borra si algo cuelga de ello, aunque la fila no aporte nada.
base = baseFalsa({ filas: limpia, cuelgan: ["c-26051802-17725"] });
r = await limpiarRepetidasDeParte(base, "parte-1", { aplicar: true });
comprobar("si cuelgan datos de la fila, no se borra",
  base.borrados.length === 0 && r.paraRevisar.length === 1);
comprobar("y se dice por que", r.paraRevisar[0].perderia.some((x) => /colgando/.test(x)));

// Sin --aplicar no se toca nada: es lo que permite mirar antes de decidir.
base = baseFalsa({ filas: limpia });
r = await limpiarRepetidasDeParte(base, "parte-1", { aplicar: false });
comprobar("en simulacion se dice que se quitaria pero no se borra",
  r.quitadas.length === 1 && base.borrados.length === 0);

// Si no se puede comprobar quien cuelga, se prefiere no borrar antes que
// borrar a ciegas: la funcion lanza y quien llama lo cuenta como incidencia.
const baseRota = {
  from(tabla) {
    if (tabla === "lotes_dia") return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: limpia, error: null }) }) }) };
    return { select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "sin permiso" } }) }) };
  },
};
let lanzo = false;
try { await limpiarRepetidasDeParte(baseRota, "parte-1", { aplicar: true }); } catch { lanzo = true; }
comprobar("si no se puede comprobar quien cuelga, no se borra: lanza", lanzo);

// Un parte sano no hace ni una consulta de mas.
base = baseFalsa({ filas: [delParte("26051802", 17725), delParte("26051806", 25645)] });
r = await limpiarRepetidasDeParte(base, "parte-1", { aplicar: true });
comprobar("sin repetidas no se borra nada y no se inventa trabajo",
  r.quitadas.length === 0 && r.paraRevisar.length === 0 && r.kg === 0 && base.borrados.length === 0);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobacion(es) fallidas.`);
process.exit(fallos === 0 ? 0 : 1);
