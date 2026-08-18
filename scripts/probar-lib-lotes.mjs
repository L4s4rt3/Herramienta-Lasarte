/**
 * Comprobacion de codigoBaseLote.
 *
 * Lo que protege: de esta funcion depende que dos filas se consideren la MISMA
 * pasada, y con eso que se borre una. Un fallo aqui no da error: junta pasadas
 * distintas o deja repetidas sin ver.
 *
 *   node scripts/probar-lib-lotes.mjs
 */
import { codigoBaseLote } from "./lib-lotes.mjs";

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

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobacion(es) fallidas.`);
process.exit(fallos === 0 ? 0 : 1);
