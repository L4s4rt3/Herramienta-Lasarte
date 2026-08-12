/**
 * Cuánto del 8,9% de kilos mal atribuidos se arregla solo, y qué queda en cola.
 *
 * Usa la MISMA función que la pantalla (src/lib/calibradorReparto.ts), contra los
 * datos reales. No escribe nada: solo cuenta y enseña ejemplos, para poder decidir
 * con cifras si el corte de "clara" está donde debe.
 *
 *   npx vite-node scripts/probar-reparto-calibrador.ts
 */
import { createClient } from "@supabase/supabase-js";
import {
  aplicarReparto,
  repartirPasada,
  type FilaProductor,
  type PasadaConDesglose,
} from "../src/lib/calibradorReparto";

process.loadEnvFile(".env");

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const num = (v: unknown) => Number(v) || 0;
const miles = (n: number) => Math.round(n).toLocaleString("es-ES");

const { data: pasadasRaw, error: e1 } = await supabase.rpc("calibrador_pasadas_con_desglose", {
  desde: null, hasta: null,
});
if (e1) throw new Error(e1.message);

const pasadas: PasadaConDesglose[] = (pasadasRaw ?? []).map((p) => ({
  batch_id: num(p.batch_id), batch_name: String(p.batch_name ?? ""),
  lote: String(p.lote ?? ""), fecha: String(p.fecha ?? ""),
  kg_total: num(p.kg_total), kg_exportacion: num(p.kg_exportacion),
  kg_no_exportacion: num(p.kg_no_exportacion), kg_industria: num(p.kg_industria),
  kg_mujeres: num(p.kg_mujeres), kg_otros: num(p.kg_otros),
}));

const { data: prodRaw, error: e2 } = await supabase.rpc("calibrador_aprovechamiento_productor", {
  desde: null, hasta: null,
});
if (e2) throw new Error(e2.message);
const productores = (prodRaw ?? []) as unknown as FilaProductor[];

// Los lotes que hacen falta: el de la pasada y todos los que nombre el texto.
const codigos = new Set<string>();
for (const p of pasadas) {
  codigos.add(p.lote);
  for (const m of p.batch_name.matchAll(/\d{8}/g)) codigos.add(m[0]);
}
const dueno = new Map<string, { productor_id: string | null; productor: string }>();
const lista = [...codigos];
for (let i = 0; i < lista.length; i += 200) {
  const { data } = await supabase.rpc("productor_por_lote", { lotes: lista.slice(i, i + 200) });
  for (const r of data ?? []) {
    dueno.set(String(r.lote), { productor_id: r.productor_id ?? null, productor: String(r.productor ?? "") });
  }
}

const kgTotal = pasadas.reduce((s, p) => s + p.kg_total, 0);
const claras = pasadas.filter((p) => repartirPasada(p).estado === "repartida");
const kgClaras = claras.reduce((s, p) => s + p.kg_total, 0);

console.log(`Pasadas con desglose: ${pasadas.length} · ${miles(kgTotal)} kg`);
console.log(`  se reparten solas... ${claras.length} (${((claras.length / pasadas.length) * 100).toFixed(1)}%) · ${miles(kgClaras)} kg`);
console.log(`  a cola manual....... ${pasadas.length - claras.length} · ${miles(kgTotal - kgClaras)} kg`);
console.log(`  lotes sin dueño conocido: ${lista.filter((c) => !dueno.has(c)).length} de ${lista.length}`);

const r = aplicarReparto(productores, pasadas, dueno);
console.log(`\nAplicado: ${r.pasadasRepartidas} pasadas · ${miles(r.kgLiberados)} kg liberados (reciclaje o sin dueño)`);

const antes = new Map(productores.map((p) => [p.productor, p]));
const cambios = r.productores
  .map((p) => ({ p, dif: p.kg_total - (antes.get(p.productor)?.kg_total ?? 0) }))
  .filter((x) => Math.abs(x.dif) > 1)
  .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));

console.log(`\nProductores que cambian (${cambios.length}):`);
for (const { p, dif } of cambios.slice(0, 12)) {
  const pctAntes = antes.get(p.productor)?.pct_exportacion;
  console.log(`  ${(dif > 0 ? "+" : "") + miles(dif)} kg  ${p.productor.slice(0, 42).padEnd(42)}` +
    ` export. ${pctAntes == null ? "—" : pctAntes.toFixed(1)}% -> ${p.pct_exportacion?.toFixed(1) ?? "—"}%`);
}

const motivos = new Map<string, { n: number; kg: number }>();
for (const c of r.cola) {
  const k = c.motivo.replace(/^\d+ /, "N ");
  const a = motivos.get(k) ?? { n: 0, kg: 0 };
  a.n += 1; a.kg += c.kg_total;
  motivos.set(k, a);
}
console.log("\nPor qué se quedan en cola:");
for (const [m, a] of [...motivos].sort((x, y) => y[1].kg - x[1].kg)) {
  console.log(`  ${String(a.n).padStart(3)} pasadas · ${miles(a.kg).padStart(10)} kg · ${m}`);
}
console.log("\nEjemplos de cola (los de más kilos):");
for (const c of [...r.cola].sort((a, b) => b.kg_total - a.kg_total).slice(0, 8)) {
  console.log(`  ${miles(c.kg_total).padStart(8)} kg · "${c.batch_name}"`);
}
