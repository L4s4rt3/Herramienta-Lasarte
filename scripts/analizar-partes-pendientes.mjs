/**
 * Analiza solos los partes que tienen sus archivos subidos y nadie ha analizado.
 *
 * EL PROBLEMA. Subir los informes al parte no basta: hay que darle al botón
 * "Analizar". Si nadie lo pulsa, el parte se queda en Borrador con los archivos
 * dentro y sin extraer — el del 10-ago llevaba dos días así, con sus 8 informes
 * puestos. Esto llama a la misma edge function `analizar-parte` que pulsa el
 * botón, ni más ni menos.
 *
 * QUÉ SE ANALIZA. Partes con archivos adjuntos que ademas cumplan una de dos:
 *   a) no se han analizado nunca (`resumen_ia` a null), o
 *   b) siguen en Borrador y tienen un GSTOCK subido pero `kg_palets_brutos` a
 *      cero — es decir, el archivo llegó DESPUÉS del análisis y su dato no está
 *      reflejado. Pasa cada vez que el GSTOCK se genera solo (ver
 *      generar-gstock-erp.mjs) sobre un parte que ya se había analizado.
 *
 * Un parte que no esté en Borrador NO se toca nunca: reanalizar uno cerrado
 * podría revivir valores que alguien corrigió a mano.
 *
 * EL ESTADO SE DEVUELVE A BORRADOR SI QUEDA TRABAJO. `analizar-parte` deja el
 * parte en "Analizado", y en la app eso lo pone de SOLO LECTURA
 * (PartDetail: readOnly = estado !== "Borrador"). Si aún faltan los datos del
 * papel, dejarlo así le cerraría la puerta al operario justo cuando le toca
 * escribir. Por eso: si tras analizar los cinco manuales siguen a cero, vuelve a
 * Borrador. Si ya había metido alguno, se respeta el estado que decida el
 * análisis.
 *
 * Los campos manuales NUNCA se pisan: eso ya lo garantiza la propia edge
 * function (su lista `manualFields` protege lo que el usuario haya escrito).
 *
 *   node scripts/analizar-partes-pendientes.mjs             # simulación
 *   node scripts/analizar-partes-pendientes.mjs --aplicar
 *   node scripts/analizar-partes-pendientes.mjs --dias=30 --aplicar
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

/** Los del papel. Si TODOS siguen a cero, es que nadie ha llegado a rellenarlos. */
const MANUALES = [
  "kg_industria_manual",
  "kg_reciclado_malla_z1",
  "kg_reciclado_malla_z2",
  "kg_inventario_sin_alta",
  "kg_podrido_bolsa_basura",
];

const dd = (n) => String(n).padStart(2, "0");
const comoFecha = (d) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;

export async function analizarPartesPendientes(supabase, { url, key, desde, aplicar = false } = {}) {
  const { data: partes, error } = await supabase.from("partes_diarios")
    .select("id, date, estado, resumen_ia, kg_palets_brutos, " + MANUALES.join(", "))
    .gte("date", desde).order("date");
  if (error) throw new Error(`partes: ${error.message}`);

  const resultados = [];
  for (const p of partes ?? []) {
    const { data: archivos, error: errA } = await supabase.from("partes_archivos")
      .select("file_type").eq("part_id", p.id);
    if (errA) throw new Error(`archivos: ${errA.message}`);
    const count = archivos?.length ?? 0;
    if (!count) {
      if (!p.resumen_ia) resultados.push({ fecha: p.date, accion: "sin-archivos" });
      continue;
    }

    const nuncaAnalizado = !p.resumen_ia;
    const gstockSinLeer = p.estado === "Borrador"
      && archivos.some((a) => a.file_type === "GSTOCK")
      && !(Number(p.kg_palets_brutos) > 0);
    if (!nuncaAnalizado && !gstockSinLeer) continue;
    if (!nuncaAnalizado && p.estado !== "Borrador") continue;
    if (!aplicar) {
      resultados.push({ fecha: p.date, accion: "analizaria", archivos: count });
      continue;
    }

    try {
      const res = await fetch(`${url}/functions/v1/analizar-parte`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ part_id: p.id }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        resultados.push({ fecha: p.date, accion: "error", motivo: cuerpo.error ?? `HTTP ${res.status}` });
        continue;
      }

      // ¿Queda trabajo del papel? Entonces el parte tiene que seguir editable.
      const faltanManuales = MANUALES.every((c) => !(Number(p[c]) > 0));
      if (faltanManuales && p.estado === "Borrador") {
        const { error: errE } = await supabase.from("partes_diarios")
          .update({ estado: "Borrador" }).eq("id", p.id);
        if (errE) throw new Error(`reabrir: ${errE.message}`);
      }
      resultados.push({
        fecha: p.date, accion: "analizado", archivos: count,
        reabierto: faltanManuales && p.estado === "Borrador",
        avisos: cuerpo.avisos ?? [],
      });
    } catch (e) {
      resultados.push({ fecha: p.date, accion: "error", motivo: e.message });
    }
  }
  return resultados;
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const dias = Number(args.find((a) => a.startsWith("--dias="))?.split("=")[1]) || 14;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const hoy = new Date();
  const desde = comoFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - dias));
  const r = await analizarPartesPendientes(supabase, { url, key, desde, aplicar });

  if (r.length === 0) return console.log("No hay ningun parte sin analizar.");
  for (const x of r) {
    const extra = x.accion === "analizado"
      ? ` (${x.archivos} archivos${x.reabierto ? ", devuelto a Borrador para los manuales" : ""})`
      : x.accion === "analizaria" ? ` (${x.archivos} archivos)` : x.motivo ? ` (${x.motivo})` : "";
    console.log(`  ${x.fecha}: ${x.accion}${extra}`);
    for (const a of x.avisos ?? []) console.log(`      aviso: ${a}`);
  }
  if (!aplicar) console.log("\n(simulacion: repite con --aplicar)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
