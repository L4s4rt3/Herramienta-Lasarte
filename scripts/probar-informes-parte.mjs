/**
 * Pruebas offline de las hojas que genera generar-informes-parte.mjs.
 *
 * Lo que protege: el Informe PRODUCTO alimenta producto_dia, que es de donde el
 * CMV deduce los kg por bulto. La columna Empaque nació vacía (11-08) y el CMV
 * dejó de acumular empaques sin que nadie lo notara: estas comprobaciones
 * hacen que eso no pueda volver a pasar en silencio.
 *
 *   node scripts/probar-informes-parte.mjs
 */
import assert from "node:assert/strict";
import { hojaProducto } from "./generar-informes-parte.mjs";

const FILAS = [
  { producto: "MDNA 4KG GIRSAC CAL 6/8", grupo_destino: "EXPORTACION", peso_kg: 5420.85, piezas: 100, cartons: 456 },
  { producto: "MDNA 4KG GIRSAC CAL 6/8", grupo_destino: "EXPORTACION", peso_kg: 100, piezas: 4, cartons: 8 },
  { producto: "GRANEL CAL 6/7", grupo_destino: "EXPORTACION", peso_kg: 2923.45, piezas: 60, cartons: 195 },
  { producto: "PRODUCTO NUEVO SIN HISTORIAL", grupo_destino: "EXPORTACION", peso_kg: 50, piezas: 2, cartons: 5 },
];
const EMPAQUES = new Map([
  ["MDNA 4KG GIRSAC CAL 6/8", "12 K MDNA 618 LOGIFRUIT"],
  ["GRANEL CAL 6/7", "15 K PLAST FINO 26"],
]);

const hoja = hojaProducto(FILAS, EMPAQUES);
const fila = (producto) => hoja.find((f) => f[0] === producto);

assert.deepEqual(hoja[0], ["Producto", "Empaque", "Cajas", "Peso (kg)", "Grupo"], "la cabecera no cambia: classify() y el parser deciden por ella");
assert.equal(fila("MDNA 4KG GIRSAC CAL 6/8")[1], "12 K MDNA 618 LOGIFRUIT", "el empaque habitual se rellena");
assert.equal(fila("MDNA 4KG GIRSAC CAL 6/8")[3], 5520.85, "las dos filas del mismo producto+grupo se agrupan");
assert.equal(fila("GRANEL CAL 6/7")[1], "15 K PLAST FINO 26", "cada producto lleva el suyo");
assert.equal(fila("PRODUCTO NUEVO SIN HISTORIAL")[1], "", "un producto sin historial va VACIO, no inventado");
assert.equal(hoja[1][0], "MDNA 4KG GIRSAC CAL 6/8", "ordenado por kg de mayor a menor");
assert.equal(fila("TOTAL")[3], 8494.3, "la fila TOTAL suma el dia entero");

// Sin mapa de empaques (la RPC falla o no hay historial) el informe sale igual.
const sinEmpaques = hojaProducto(FILAS);
assert.equal(sinEmpaques.find((f) => f[0] === "GRANEL CAL 6/7")[1], "", "sin empaques el informe no se rompe: columna vacia");

console.log("probar-informes-parte: todo en orden.");
