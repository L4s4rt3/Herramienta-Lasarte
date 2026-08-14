/**
 * Pruebas offline de la lógica pura de la copia (lib-copia-seguridad.mjs).
 * La rotación BORRA ficheros de verdad: tiene que estar bien antes de estrenarse.
 *
 *   node scripts/probar-copia-seguridad.mjs
 */
import assert from "node:assert/strict";
import { carpetasABorrar, comoTamano, rutaSegura } from "./lib-copia-seguridad.mjs";

// ── Rotación: 14 diarias + la primera de cada mes ───────────────────────────
{
  // 40 días seguidos de copias: se conservan las 14 últimas y la primera de
  // cada mes que asoma; el resto sobra.
  const dias = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(2026, 6, 1 + i); // 1-jul .. 9-ago de 2026
    dias.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  const borrar = carpetasABorrar(dias);
  assert.ok(!borrar.includes("2026-07-01"), "la primera de julio se conserva (mensual)");
  assert.ok(!borrar.includes("2026-08-01"), "la primera de agosto se conserva (mensual)");
  assert.ok(!borrar.includes("2026-08-09"), "la más reciente se conserva");
  assert.ok(!borrar.includes("2026-07-27"), "la 14ª más reciente se conserva");
  assert.ok(borrar.includes("2026-07-02"), "una diaria vieja no-mensual se borra");
  assert.ok(borrar.includes("2026-07-26"), "la 15ª más reciente ya se borra");
  assert.equal(borrar.length, 40 - 14 - 1, "40 días = 14 diarias + jul-01 mensual (ago-01 aún está entre las 14)");
}

{
  // Con pocas copias no se borra nada, y lo que no parece fecha se ignora.
  assert.deepEqual(carpetasABorrar(["2026-08-01", "2026-08-02", "archivos"]), []);
  assert.deepEqual(carpetasABorrar([]), []);
}

{
  // Huecos: se conserva la PRIMERA copia existente de cada mes, aunque no sea
  // el día 1 (la tarea puede no haber corrido ese día).
  const borrar = carpetasABorrar([
    "2026-05-03", "2026-05-20",
    ...Array.from({ length: 20 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`),
  ]);
  assert.ok(!borrar.includes("2026-05-03"), "la primera de mayo existente se conserva");
  assert.ok(borrar.includes("2026-05-20"), "la segunda de mayo se borra");
}

// ── Rutas seguras para el espejo del storage ────────────────────────────────
assert.equal(rutaSegura("cmr/2026/albaran 18424.pdf"), "cmr/2026/albaran 18424.pdf");
assert.equal(rutaSegura("../../windows/system32"), "windows/system32");
assert.equal(rutaSegura("c:\\malo\\..\\peor.pdf"), "c_/malo/peor.pdf");
assert.equal(rutaSegura("con<raro>|nombre?.pdf"), "con_raro__nombre_.pdf");
assert.equal(rutaSegura(null), "");

// ── Tamaños con palabras ────────────────────────────────────────────────────
assert.equal(comoTamano(0), "0 B");
assert.equal(comoTamano(2048), "2 KB");
assert.ok(comoTamano(48 * 1048576).includes("MB"));

console.log("probar-copia-seguridad: todo en orden.");
