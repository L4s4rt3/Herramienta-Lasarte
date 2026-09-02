/**
 * Comprobacion de codigoBaseLote.
 *
 * Lo que protege: de esta funcion depende que dos filas se consideren la MISMA
 * pasada, y con eso que se borre una. Un fallo aqui no da error: junta pasadas
 * distintas o deja repetidas sin ver.
 *
 *   node scripts/probar-lib-lotes.mjs
 */
import { codigoBaseLote, pasadasDocxFrescas } from "./lib-lotes.mjs";

let fallos = 0;
const comprobar = (titulo, cond) => {
  if (!cond) fallos++;
  console.log(`${cond ? "OK   " : "FALLA"}  ${titulo}`);
};

comprobar("un lote limpio se queda como esta", codigoBaseLote("26051802") === "26051802");
comprobar("lo que apunto planta detras no cuenta",
  codigoBaseLote("26051802+ 2 BOX DE RECICLAJE") === "26051802");
comprobar("ni lo que apunto delante", codigoBaseLote("PREC --26073101") === "26073101");
comprobar("ni los box restados", codigoBaseLote("26051904-15 BOX +7 BOX DE RECICLAJE") === "26051904");
comprobar("los espacios de los lados no cambian nada", codigoBaseLote("  26051802 ") === "26051802");
comprobar("se coge el PRIMER lote de los dos que hay",
  codigoBaseLote("26051807+6 10 BOX DE PREC 26080502") === "26051807");
comprobar("sin ocho digitos se compara el nombre", codigoBaseLote("-MUESTRA-") === "-MUESTRA-");
comprobar("y en mayusculas, para que no dependa de como se escribio",
  codigoBaseLote("industria") === codigoBaseLote("INDUSTRIA"));
comprobar("un codigo mas corto no se confunde con un lote", codigoBaseLote("2605") === "2605");
comprobar("sin codigo no revienta", codigoBaseLote(null) === "" && codigoBaseLote(undefined) === "");

// ── pasadasDocxFrescas: el re-guardado del 31-08-2026 ─────────────────────────
const viejo = { lote: "26082901", comienzo: "31-Aug-26 07:06 AM", fecha: "2026-08-31", recibido_at: "2026-08-31T10:15:07Z" };
const nuevo = { lote: "26082901 -95 BOX", comienzo: "31-Aug-26 07:06 AM", fecha: "2026-08-31", recibido_at: "2026-09-01T08:45:08Z" };
const otro = { lote: "26082701 22 BOX + 4 BOX RECICLAJE Y PREC", comienzo: "31-Aug-26 06:03 AM", fecha: "2026-08-31", recibido_at: "2026-08-31T05:18:07Z" };
const frescas = pasadasDocxFrescas([otro, viejo, nuevo]);
comprobar("el re-guardado con otro nombre y el mismo comienzo se queda en uno",
  frescas.length === 2 && frescas.includes(nuevo) && frescas.includes(otro));
comprobar("y gana el informe mas reciente, no el primero", !frescas.includes(viejo));
comprobar("se devuelven los mismos objetos y en su orden", frescas[0] === otro && frescas[1] === nuevo);
comprobar("gana el reciente aunque llegue antes en la lista",
  pasadasDocxFrescas([nuevo, viejo]).length === 1 && pasadasDocxFrescas([nuevo, viejo])[0] === nuevo);

const pasada1 = { lote: "26051507", comienzo: "12-Aug-26 11:03 AM", fecha: "2026-08-12", recibido_at: "2026-08-12T12:00:00Z" };
const pasada2 = { lote: "26051507", comienzo: "12-Aug-26 12:14 PM", fecha: "2026-08-12", recibido_at: "2026-08-12T13:00:00Z" };
comprobar("dos pasadas del mismo lote el mismo dia (comienzos distintos) se quedan las dos",
  pasadasDocxFrescas([pasada1, pasada2]).length === 2);
comprobar("el mismo lote otro dia es otra pasada",
  pasadasDocxFrescas([viejo, { ...viejo, fecha: "2026-09-01" }]).length === 2);
comprobar("sin fecha en las filas se compara por base y comienzo",
  pasadasDocxFrescas([{ lote: "26082901", comienzo: "X", recibido_at: "2026-08-31T10:00:00Z" },
    { lote: "26082901 -95 BOX", comienzo: "X", recibido_at: "2026-09-01T10:00:00Z" }]).length === 1);
comprobar("sin recibido_at se pierde frente al que lo tiene",
  pasadasDocxFrescas([{ ...nuevo, recibido_at: null }, viejo])[0] === viejo);
comprobar("una lista vacia o nula no revienta",
  pasadasDocxFrescas([]).length === 0 && pasadasDocxFrescas(null).length === 0);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobacion(es) fallidas.`);
process.exit(fallos === 0 ? 0 : 1);
