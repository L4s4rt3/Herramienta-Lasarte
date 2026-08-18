/**
 * Pruebas offline de la estimación de manuales (lib-estimar-manuales.mjs).
 *
 * Lo que protege: esto escribe en los partes cuando no hay nadie mirando (el
 * usuario fuera una semana). Una estimación que se pasa de lista —tocar un
 * parte que no toca, inventar bateas, no retirarse ante el dato real— es peor
 * que no estimar.
 *
 *   node scripts/probar-estimar-manuales.mjs
 */
import assert from "node:assert/strict";
import {
  CINCO_DEL_PAPEL, derivadosReciclado, esCandidato, estimarCampos, mediana, pisados, sinManuales,
} from "./lib-estimar-manuales.mjs";

// ── mediana ──────────────────────────────────────────────────────────────────
assert.equal(mediana([3, 1, 2]), 2);
assert.equal(mediana([4, 1, 3, 2]), 2.5);
assert.equal(mediana([]), null, "sin datos no hay mediana, no un 0");

// ── ¿papel sin meter? ────────────────────────────────────────────────────────
const vacio = Object.fromEntries(CINCO_DEL_PAPEL.map((c) => [c, 0]));
assert.equal(sinManuales(vacio), true);
assert.equal(sinManuales({ ...vacio, kg_inventario_sin_alta: 882 }), false,
  "un solo campo metido ya cuenta como papel metido");

// ── ¿candidato? ──────────────────────────────────────────────────────────────
const base = { ...vacio, estado: "Borrador", date: "2026-08-12", kg_produccion_calibrador: 85682 };
assert.equal(esCandidato(base, "2026-08-15"), true);
assert.equal(esCandidato({ ...base, estado: "Analizado" }, "2026-08-15"), false, "Analizado no se toca");
assert.equal(esCandidato({ ...base, date: "2026-08-16" }, "2026-08-15"), false, "dia de gracia: lo reciente espera a una persona");
assert.equal(esCandidato({ ...base, kg_produccion_calibrador: 0 }, "2026-08-15"), false, "sin produccion no hay que estimar nada");
assert.equal(esCandidato({ ...base, kg_podrido_bolsa_basura: 333 }, "2026-08-15"), false, "con papel metido no se estima");

// ── la aritmética del box: los 6 días reales que la traen, clavados ─────────
for (const [neto, box, bruto] of [[1135, 5, 1285], [382, 2, 442], [216, 1, 246], [190, 1, 220], [402, 2, 462], [828, 4, 948]]) {
  const r = derivadosReciclado(neto);
  assert.equal(r.box, box, `box de ${neto}`);
  assert.equal(r.bruto, bruto, `bruto de ${neto}`);
}
assert.deepEqual(derivadosReciclado(0), { box: 0, bruto: 0 });

// ── estimarCampos ────────────────────────────────────────────────────────────
const dia = (industria, z1, z2, inv, bolsa) => ({
  kg_industria_manual: industria, kg_reciclado_malla_z1: z1, kg_reciclado_malla_z2: z2,
  kg_inventario_sin_alta: inv, kg_podrido_bolsa_basura: bolsa,
});
// 5 días de histórico parecidos a los reales: industria casi siempre 0.
const historico = [dia(0, 420, 630, 2231, 198), dia(0, 609, 812, 3746, 460),
  dia(1158, 203, 204, 2575, 318), dia(0, 216, 216, 1547, 486), dia(0, 214, 423, 635, 304)];

const conFotos = estimarCampos({ historico, inventarioDeducido: 845 });
assert.equal(conFotos.campos.kg_inventario_sin_alta, 845, "con fotos, el inventario es el deducido");
assert.equal(conFotos.detalle.find((d) => d.campo === "kg_inventario_sin_alta").metodo, "fotos-erp");
assert.equal(conFotos.campos.kg_industria_manual, 0, "la mediana de industria es 0: no se inventa camion");
assert.equal(conFotos.campos.kg_reciclado_malla_z1, 216, "reciclado Z1 por mediana");
assert.equal(conFotos.campos.kg_reciclado_malla_z1_bruto, 246, "y su bruto por la aritmetica del box");
assert.equal(conFotos.campos.box_reciclaje_z1, 1);
assert.equal(conFotos.campos.kg_podrido_bateas, undefined, "las bateas NO se estiman jamas");
assert.ok(conFotos.detalle.some((d) => d.campo === "kg_podrido_bateas" && d.metodo === "no-se-estima"),
  "pero se dice que no se estiman y por que");

const sinFotos = estimarCampos({ historico, inventarioDeducido: null });
assert.equal(sinFotos.campos.kg_inventario_sin_alta, 2231, "sin fotos, mediana del historico");
assert.equal(sinFotos.detalle.find((d) => d.campo === "kg_inventario_sin_alta").metodo, "mediana-14d");

const sinNada = estimarCampos({ historico: [], inventarioDeducido: null });
assert.equal(Object.keys(sinNada.campos).length, 0, "sin historico ni fotos NO se inventa nada");

// ── el dato real gana ────────────────────────────────────────────────────────
const marcado = {
  kg_inventario_sin_alta: 845, kg_reciclado_malla_z1: 216,
  campos_estimados: { campos: {
    kg_inventario_sin_alta: { valor: 845, metodo: "fotos-erp" },
    kg_reciclado_malla_z1: { valor: 216, metodo: "mediana-14d" },
  } },
};
assert.deepEqual(pisados(marcado), [], "si nadie toco nada, no hay nada que retirar");
assert.deepEqual(pisados({ ...marcado, kg_inventario_sin_alta: 900 }), ["kg_inventario_sin_alta"],
  "el campo que una persona cambio se detecta y su estimacion se retira");

console.log("probar-estimar-manuales: todo en orden.");
