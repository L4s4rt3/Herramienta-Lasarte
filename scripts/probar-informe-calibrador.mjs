/**
 * Lee los informes del calibrador que haya en outputs/calibrador y comprueba
 * que el parser los entiende.
 *
 * La comprobación fuerte no es que no pete: es que **la suma de cada bloque
 * cuadre con el total que declara el propio informe**. Si cuadra, la lectura es
 * correcta. Si no, el formato ha cambiado y hay que mirarlo antes de meter esos
 * números en la Herramienta.
 *
 *   node scripts/probar-informe-calibrador.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { parsearInformeCalibrador, validarBloques } from "./lib-informe-calibrador.mjs";

const dir = path.resolve("outputs/calibrador");
if (!fs.existsSync(dir)) {
  console.error(`No existe ${dir}. Todavia no ha llegado ningun informe.`);
  process.exit(1);
}

const ficheros = fs
  .readdirSync(dir, { recursive: true })
  .map((f) => path.join(dir, String(f)))
  .filter((f) => f.endsWith(".docx"))
  .sort();

if (ficheros.length === 0) {
  console.error("No hay ningun .docx en outputs/calibrador.");
  process.exit(1);
}

let fallos = 0;
for (const f of ficheros) {
  console.log(`\n=== ${path.relative(dir, f)} ===`);
  let r;
  try {
    r = parsearInformeCalibrador(fs.readFileSync(f));
  } catch (e) {
    console.error(`  NO SE PUDO LEER: ${e.message}`);
    fallos += 1;
    continue;
  }

  const c = r.cabecera;
  console.log(`  Lote ${c.lote} · ${c.commodity} · ${c.productorNombre} (${c.productorCodigo})`);
  console.log(`  Comienzo ${c.comienzo} · maquina ${c.tiempoMaquina} · lote ${c.tiempoLote}`);
  console.log(
    `  Utilizacion ${c.utilizacionPct}% · ${c.toneladasHora} t/h · ${c.binsEjecutados} bins` +
      ` · rechazo ${c.rechazoPct}%`,
  );

  const productos = [...new Set(r.lineas.map((l) => l.producto))];
  const kg = r.lineas.reduce((s, l) => s + (l.kg ?? 0), 0);
  const piezas = r.lineas.reduce((s, l) => s + (l.piezas ?? 0), 0);
  console.log(`  ${r.lineas.length} lineas · ${productos.length} productos · ${Math.round(kg)} kg · ${piezas} piezas`);

  const grupos = new Map();
  for (const l of r.lineas) grupos.set(l.grupo, (grupos.get(l.grupo) ?? 0) + (l.kg ?? 0));
  console.log("  por grupo: " + [...grupos].map(([g, k]) => `${g ?? "sin grupo"} ${Math.round(k)} kg`).join(" · "));

  const malos = validarBloques(r.bloques);
  const conTotal = r.bloques.filter((b) => b.totalDeclarado).length;
  if (malos.length === 0) {
    console.log(`  AUTOVALIDACION OK: ${conTotal} bloques cuadran con sus totales`);
  } else {
    fallos += 1;
    console.error(`  AUTOVALIDACION FALLA en ${malos.length} de ${conTotal} bloques:`);
    for (const m of malos.slice(0, 6)) {
      console.error(`    ${m.producto} / ${m.clase} / ${m.campo}: informe ${m.dice} vs suma ${m.suma}`);
    }
  }
  if (!c.lote || !/^\d{8}$/.test(c.lote)) {
    fallos += 1;
    console.error(`  EL LOTE NO TIENE EL FORMATO ESPERADO (AAMMDDNN): "${c.lote}"`);
  }
}

console.log(
  fallos === 0
    ? `\n${ficheros.length} informe(s) leidos y validados.`
    : `\n${fallos} problema(s) en ${ficheros.length} informe(s).`,
);
process.exit(fallos === 0 ? 0 : 1);
