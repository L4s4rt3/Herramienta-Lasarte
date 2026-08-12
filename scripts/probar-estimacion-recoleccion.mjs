/**
 * Comprobación de la estimación del coste de recolección.
 *
 * No toca el ERP ni Supabase: alimenta con datos de mentira las funciones puras
 * de `sincronizar-entradas-erp.mjs`. Lo que protege es que la estimación NUNCA
 * invente coste de recolección donde no lo hay — sobre todo en las re-entradas
 * de precalibrado, que son fruta interna que nadie recolecta pero cuyo proveedor
 * sí tiene contratos de recolección en el ERP con precios de hasta 0,37 €/kg.
 *
 *   node scripts/probar-estimacion-recoleccion.mjs
 */
import { indiceTarifas, aFilaApp } from "./sincronizar-entradas-erp.mjs";

const historico = [
  // Balca: 0,103 €/kg en La Torrecilla con Delta Seedless.
  { fecha: "2026-05-11", finca: "La Torrecilla BN", articulo: "NAR VAL DELTA SEEDLESS",
    agricultor: "Balca", kg_entrada: 22620, coste_recoleccion: 2329.86 },
  { fecha: "2026-05-13", finca: "La Torrecilla BN", articulo: "NAR VAL DELTA SEEDLESS",
    agricultor: "Balca", kg_entrada: 23220, coste_recoleccion: 2391.66 },
  // Misma finca, otra variedad: sirve para probar el escalón intermedio.
  { fecha: "2026-03-02", finca: "La Torrecilla BN", articulo: "NARANJA LANE LATE",
    agricultor: "Balca", kg_entrada: 10000, coste_recoleccion: 860 },
  // Precalibrado: tres entradas y ninguna con recolección.
  { fecha: "2026-07-01", finca: "PREC 1 ALMACEN", articulo: "NAR VAL DELTA SEEDLESS",
    agricultor: "LASARTE ALMACEN PRECALIBRADO", kg_entrada: 314, coste_recoleccion: 0 },
  { fecha: "2026-07-02", finca: "PREC 1 ALMACEN", articulo: "NAR VAL DELTA SEEDLESS",
    agricultor: "LASARTE ALMACEN PRECALIBRADO", kg_entrada: 862, coste_recoleccion: null },
  { fecha: "2026-07-03", finca: "PREC 2 ALMACEN", articulo: "NAR VAL DELTA SEEDLESS",
    agricultor: "LASARTE ALMACEN PRECALIBRADO", kg_entrada: 980, coste_recoleccion: 0 },
];

const estimar = indiceTarifas(historico);
const fila = (r) => aFilaApp({ certificada: 0, ...r }, "usuario-de-prueba", estimar);

let fallos = 0;
const comprobar = (titulo, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? "OK   " : "FALLA"}  ${titulo}`);
  if (!ok) console.log(`         esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}`);
};

const prec = fila({
  lote: "26081001", finca: "PREC 1 ALMACEN", articulo: "NAR VAL DELTA SEEDLESS",
  agricultor: "LASARTE ALMACEN PRECALIBRADO", kg_entrada: 4480, tarifa_contrato: "0.3700",
});
comprobar(
  "el precalibrado no recibe estimación aunque tenga contrato tipo 8",
  [prec.coste_recoleccion_estimado, prec.recol_estimacion_origen],
  [null, null],
);

const balca = fila({
  lote: "26051401", finca: "La Torrecilla BN", articulo: "NAR VAL DELTA SEEDLESS",
  agricultor: "Balca", kg_entrada: 20000, tarifa_contrato: "0.0850",
});
comprobar(
  "usa la tarifa de la misma finca y variedad, no la del contrato",
  [balca.coste_recoleccion_estimado, balca.recol_estimacion_origen],
  [2060, "finca_articulo"],
);

const nuevaVariedad = fila({
  lote: "26051402", finca: "La Torrecilla BN", articulo: "NARANJA SALUSTIANA",
  agricultor: "Balca", kg_entrada: 10000, tarifa_contrato: "0.0850",
});
comprobar(
  "una variedad nueva en finca conocida baja al escalón de finca",
  [nuevaVariedad.recol_estimacion_origen],
  ["finca"],
);

const agricultorNuevo = fila({
  lote: "26051403", finca: "Finca Nueva", articulo: "NARANJA NAVELINA",
  agricultor: "Agricultor Nuevo S.L.", kg_entrada: 10000, tarifa_contrato: "0.0850",
});
comprobar(
  "un agricultor nuevo cae al contrato de recolección del ERP",
  [agricultorNuevo.coste_recoleccion_estimado, agricultorNuevo.recol_estimacion_origen],
  [850, "contrato_erp"],
);

const sinNada = fila({
  lote: "26051404", finca: "Otra Finca", articulo: "NARANJA NAVELINA",
  agricultor: "Otro Nuevo S.L.", kg_entrada: 10000, tarifa_contrato: null,
});
comprobar(
  "sin historial ni contrato se queda a NULL, nunca a 0",
  [sinNada.coste_recoleccion_estimado, sinNada.recol_estimacion_origen],
  [null, null],
);

comprobar(
  "el coste real no se rellena en ningún caso",
  [balca.coste_recoleccion ?? null, agricultorNuevo.coste_recoleccion ?? null],
  [null, null],
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) fallidas.`);
process.exit(fallos === 0 ? 0 : 1);
