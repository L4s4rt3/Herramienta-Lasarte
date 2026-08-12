/**
 * EL DIFF completo del aprovechamiento por productor: qué cambia al aplicar
 *
 *   1. el reparto por capacidad pendiente a las pasadas que nombran varios lotes
 *      sin box (fase 1 de conciliacionKg.ts, regla del dueño 21-jul-2026), y
 *   2. la exclusión del pseudo-productor PRECALIBRADO y los movimientos internos
 *      del ranking (regla ya establecida en productoresCanonicos.ts).
 *
 * NO ESCRIBE NADA. Solo enseña qué pasaría.
 *
 *   node node_modules/vite-node/vite-node.mjs scripts/probar-reparto-capacidad.ts
 */
import { createClient } from "@supabase/supabase-js";
import {
  aplicarReparto,
  codigosDelNombre,
  esProductorReal,
  type CapacidadLote,
  type DuenoLote,
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
const firma = (n: number) => (n > 0 ? "+" : "") + miles(n);

const { data: pasadasRaw } = await supabase.rpc("calibrador_pasadas_con_desglose", { desde: null, hasta: null });
const pasadas: PasadaConDesglose[] = (pasadasRaw ?? []).map((p) => ({
  batch_id: num(p.batch_id), batch_name: String(p.batch_name ?? ""),
  lote: String(p.lote ?? ""), fecha: String(p.fecha ?? ""),
  kg_total: num(p.kg_total), kg_exportacion: num(p.kg_exportacion),
  kg_no_exportacion: num(p.kg_no_exportacion), kg_industria: num(p.kg_industria),
  kg_mujeres: num(p.kg_mujeres), kg_otros: num(p.kg_otros),
}));

const capacidad = new Map<string, CapacidadLote>();
for (let d = 0; ; d += 1000) {
  const { data } = await supabase.rpc("calibrador_capacidad_lotes").range(d, d + 999);
  for (const r of data ?? []) {
    capacidad.set(String(r.lote), { kgEntrada: num(r.kg_entrada), kgAtribuidoSimple: num(r.kg_atribuido_simple) });
  }
  if (!data || data.length < 1000) break;
}

const codigos = new Set<string>();
for (const p of pasadas) { codigos.add(p.lote); for (const c of codigosDelNombre(p.batch_name)) codigos.add(c); }
const dueno = new Map<string, DuenoLote>();
const lista = [...codigos];
for (let i = 0; i < lista.length; i += 200) {
  const { data } = await supabase.rpc("productor_por_lote", { lotes: lista.slice(i, i + 200) });
  for (const x of data ?? []) {
    const lote = String(x.lote);
    dueno.set(lote, [...(dueno.get(lote) ?? []), {
      productor_id: x.productor_id ?? null,
      productor: String(x.productor ?? ""),
      fraccion: num(x.fraccion) || 1,
    }]);
  }
}

const { data: prodRaw } = await supabase.rpc("calibrador_aprovechamiento_productor", { desde: null, hasta: null });
const antesTodo = (prodRaw as unknown as FilaProductor[]) ?? [];
const antes = new Map(antesTodo.map((p) => [p.productor, p]));

const r = aplicarReparto(antesTodo, pasadas, dueno, capacidad);

const tot = (fs: FilaProductor[]) => fs.reduce((s, f) => s + f.kg_total, 0);
console.log("═══ ANTES ═══");
console.log(`  ${antesTodo.length} filas · ${miles(tot(antesTodo))} kg`);
console.log(`  de ellas NO son productores: ${antesTodo.filter((p) => !esProductorReal(p)).length} · ${miles(tot(antesTodo.filter((p) => !esProductorReal(p))))} kg`);

console.log("\n═══ DESPUES ═══");
console.log(`  ranking de productores...... ${r.productores.length} filas · ${miles(tot(r.productores))} kg`);
console.log(`  fuera del ranking (no son productores):`);
for (const f of r.noProductores) console.log(`      ${miles(f.kg_total).padStart(9)} kg · ${f.productor}`);
console.log(`  liberados por el reparto.... ${miles(r.kgLiberados)} kg`);
console.log(`  pasadas repartidas.......... ${r.pasadasRepartidas} de ${pasadas.length}`);
console.log(`  siguen en cola.............. ${r.cola.length}`);

const delta = [...new Set([...antes.keys(), ...r.productores.map((p) => p.productor)])]
  .map((nombre) => {
    const a = antes.get(nombre);
    const d = r.productores.find((p) => p.productor === nombre);
    return {
      nombre,
      kgAntes: a?.kg_total ?? 0,
      kgDespues: d?.kg_total ?? 0,
      expAntes: a?.pct_exportacion ?? null,
      expDespues: d?.pct_exportacion ?? null,
      fuera: !!a && !d,
    };
  })
  .filter((x) => Math.abs(x.kgDespues - x.kgAntes) > 1)
  .sort((a, b) => Math.abs(b.kgDespues - b.kgAntes) - Math.abs(a.kgDespues - a.kgAntes));

console.log(`\n═══ QUIEN CAMBIA (${delta.length}) ═══\n`);
console.log("        kg   % suyo   productor                                     export.");
for (const x of delta) {
  const dif = x.kgDespues - x.kgAntes;
  const pct = x.kgAntes > 0 ? (dif / x.kgAntes) * 100 : 0;
  const exp = x.fuera ? "sale del ranking"
    : `${x.expAntes?.toFixed(1) ?? "—"}% -> ${x.expDespues?.toFixed(1) ?? "—"}%`;
  console.log(`${firma(dif).padStart(10)} ${(pct.toFixed(1) + "%").padStart(7)}   ${x.nombre.slice(0, 44).padEnd(44)} ${exp}`);
}

const mediaAntes = tot(antesTodo) > 0 ? (antesTodo.reduce((s, f) => s + f.kg_exportacion, 0) / tot(antesTodo)) * 100 : 0;
const mediaDesp = tot(r.productores) > 0 ? (r.productores.reduce((s, f) => s + f.kg_exportacion, 0) / tot(r.productores)) * 100 : 0;
console.log(`\nMedia de exportacion del conjunto: ${mediaAntes.toFixed(2)}% -> ${mediaDesp.toFixed(2)}%`);
