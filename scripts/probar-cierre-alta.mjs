/**
 * Comprobación de la deducción de la hora de cierre y del inventario sin alta.
 *
 * Lo que protege: estos dos números van a sustituir a un conteo manual, así que
 * más vale que se nieguen a dar un resultado cuando faltan datos, en vez de
 * inventar uno que nadie va a poder contrastar.
 *
 *   node scripts/probar-cierre-alta.mjs
 */
import { detectarCierre, inventarioSinAlta } from "./lib-cierre-alta.mjs";

let fallos = 0;
const comprobar = (titulo, cond) => {
  if (!cond) fallos++;
  console.log(`${cond ? "OK   " : "FALLA"}  ${titulo}`);
};

/** Foto a una hora local de Madrid (verano: +02:00). */
const foto = (hhmm, kg, palets = 0) => ({
  tomada_a: `2026-08-12T${hhmm}:00+02:00`, kg_netos: kg, palets,
});

// Un dia normal: sube toda la mañana y se para a las 13:00.
const dia = [
  foto("07:00", 4000, 10), foto("09:00", 22000, 55), foto("11:00", 48000, 110),
  foto("12:00", 59000, 130), foto("13:00", 66000, 146), foto("14:00", 66100, 146),
  foto("16:00", 66200, 146), foto("20:00", 66200, 146),
];

console.log("=== detectar la hora de cierre ===");
const c = detectarCierre(dia);
comprobar("se detecta el cierre", c.estado === "cerrado");
comprobar("y da la hora en que dejo de subir", c.hora === "13:00");
comprobar("con sus kilos", c.kg === 66000);

comprobar("con menos de 3 fotos no se aventura", detectarCierre([foto("13:00", 66000)]).estado === "pocas-fotos");
comprobar("un dia sin palets se dice", detectarCierre([foto("07:00", 0), foto("09:00", 0), foto("11:00", 0)]).estado === "sin-palets");

const subiendo = [foto("07:00", 4000), foto("09:00", 22000), foto("11:00", 48000)];
comprobar("si aun esta subiendo, avisa de que quiza no ha cerrado", detectarCierre(subiendo).estado === "quiza-abierto");

const tarde = [foto("07:00", 4000), foto("11:00", 30000), foto("13:00", 50000), foto("15:00", 70000), foto("17:00", 70100)];
comprobar("si un dia cierran mas tarde, lo pilla igual", detectarCierre(tarde).hora === "15:00");

console.log("\n=== inventario sin dar de alta ===");
// Al dia siguiente, a las 07:00, el dia 12 ha crecido de 66.000 a 71.500.
const conManana = [...dia, { tomada_a: "2026-08-13T07:00:00+02:00", kg_netos: 71500, palets: 158 }];
const inv = inventarioSinAlta("2026-08-12", conManana);
comprobar("se calcula", inv.estado === "calculado");
comprobar("y son los kilos que aparecieron despues del cierre", inv.kg === 5500);
comprobar("diciendo de que cierre parte", inv.cierre === "13:00");
comprobar("y a que hora se midio", inv.horaMedida === "07:00");

const soloDia = inventarioSinAlta("2026-08-12", dia);
comprobar("sin la foto de la mañana NO se inventa un numero", soloDia.estado === "sin-foto-de-la-mañana");

const soloManana = inventarioSinAlta("2026-08-12", [foto("07:00", 4000), foto("09:00", 22000), { tomada_a: "2026-08-13T07:00:00+02:00", kg_netos: 71500 }]);
comprobar("sin cierre claro tampoco", soloManana.estado !== "calculado");

// Si despues del cierre se ANULAN palets, el resultado seria negativo.
const conAnulacion = [...dia, { tomada_a: "2026-08-13T07:00:00+02:00", kg_netos: 64000 }];
const anul = inventarioSinAlta("2026-08-12", conAnulacion);
comprobar("una bajada no se cuenta como inventario", anul.kg === 0);
comprobar("y se reporta aparte como anulaciones", anul.anulaciones === 2000);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobacion(es) fallidas.`);
process.exit(fallos === 0 ? 0 : 1);
