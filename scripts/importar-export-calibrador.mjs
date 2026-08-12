/**
 * Importa un export SQL del Sizer (zip con lotes.csv + clasificacion.csv) a
 * calibrador_batch / calibrador_informe / calibrador_clasificacion.
 *
 * Lo llama el receptor AUTOMATICAMENTE al llegar el zip por correo, y tambien
 * se puede lanzar a mano contra un zip archivado:
 *
 *   node scripts/importar-export-calibrador.mjs                # el zip mas reciente
 *   node scripts/importar-export-calibrador.mjs --zip=ruta.zip
 *
 * SIRVE PARA EXPORTS COMPLETOS Y PARCIALES. El borrado es por pasada
 * (batch_id), no por lote: un export incremental de los ultimos dias no
 * destruye las pasadas antiguas de un lote que no vengan en el fichero. Las
 * filas batch_id=0 (provisionales de DOCX) de los lotes cubiertos si se
 * limpian: el SQL es la verdad completa.
 *
 * El grupo_destino se deriva por (producto,clase) del historico de
 * lote_clasificacion — por clase sola hay conflictos reales. Ambiguo => NULL.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { createClient } from "@supabase/supabase-js";

/**
 * El lote que hay dentro del BatchName, que es TEXTO LIBRE.
 *
 * El operario escribe "26051102+ 6 BOX DE RECICLAJE", "PREC --26073101" o
 * "26051807+6 10 BOX DE PREC 26080502". Se coge la PRIMERA tirada de 8 digitos,
 * misma laxitud que normalizarLoteCodigo en src/lib/entradasBascula.ts. Si no
 * hay ninguna ("22/07 22 BOX - 23/07 43 BOX"), devuelve null: esa pasada cuenta
 * para los kilos del dia pero no se puede atribuir a un productor.
 *
 * OJO: aqui NO se voltea el formato de palet (NN+AAMMDD). El BatchName lleva el
 * lote de ENTRADA tal cual.
 */
export function loteDeBatchName(texto) {
  const m = String(texto ?? "").match(/\d{8}/);
  return m ? m[0] : null;
}
const norm = (s) => String(s ?? "").replace(/^\([^)]*\)\s*/, "").trim().toLowerCase();
const filasCsv = (texto) => texto.replace(/^﻿/, "").trim().split(/\r?\n/).slice(1).map((l) => l.split(";"));

async function mapaGrupos(supabase) {
  const porProdClase = new Map();
  const porClase = new Map();
  const anota = (m, k, g) => { if (!m.has(k)) m.set(k, g); else if (m.get(k) !== g) m.set(k, null); };
  for (let d = 0; ; d += 1000) {
    const { data, error } = await supabase.from("lote_clasificacion")
      .select("producto, clase, grupo_destino").order("id").range(d, d + 999);
    if (error) throw new Error(`mapa de grupos: ${error.message}`);
    for (const r of data) {
      if (!r.clase || !r.grupo_destino) continue;
      const g = r.grupo_destino.trim().toUpperCase();
      anota(porProdClase, `${norm(r.producto)}||${norm(r.clase)}`, g);
      anota(porClase, norm(r.clase), g);
    }
    if (!data || data.length < 1000) break;
  }
  return (producto, clase) =>
    porProdClase.get(`${norm(producto)}||${norm(clase)}`) ?? porClase.get(norm(clase)) ?? null;
}

export async function importarExportSizer(supabase, { lotesCsv, clasifCsv }) {
  const grupoDe = await mapaGrupos(supabase);

  // Pasadas (espejo fiel, incluidas las de arranque sin lote valido).
  // `batch_name` guarda el texto CRUDO: el codigo normalizado que va en `lote`
  // se lleva por delante el desglose que escribe el operario ("26051904-15 BOX
  // +7 BOX DE RECICLAJE"), y sin el texto no se puede ni detectar ni repartir
  // despues con desgloseBox.ts. Espejo fiel = no se tira nada del origen.
  const batches = filasCsv(lotesCsv).map((b) => ({
    batch_id: Number(b[0]), lote: loteDeBatchName(b[1]) ?? b[1],
    batch_name: b[1] || null, grower_code: b[2] || null,
    productor: b[3] || null, variedad: b[4] || null,
    inicio: b[5] ? b[5].replace(" ", "T") : null, fin: b[6] ? b[6].replace(" ", "T") : null,
    bins: Number(b[7]) || 0, presort_reject_kg: Number(b[8]) || 0,
    outlet_reject_kg: Number(b[9]) || 0, total_reject_kg: Number(b[10]) || 0,
    finalizado: b[11] === "1",
  }));
  for (let i = 0; i < batches.length; i += 500) {
    const { error } = await supabase.from("calibrador_batch")
      .upsert(batches.slice(i, i + 500), { onConflict: "batch_id" });
    if (error) throw new Error(`calibrador_batch: ${error.message}`);
  }

  // NO se descarta nada: una pasada sin lote legible aporta kilos igual.
  const clasif = filasCsv(clasifCsv);
  let sinGrupo = 0;
  const filas = clasif.map((f) => {
    const grupo = grupoDe(f[2], f[4]);
    if (grupo == null) sinGrupo += 1;
    return {
      lote: loteDeBatchName(f[1]), batch_id: Number(f[0]), producto: f[2] || "", calidad: f[3] || "",
      clase: f[4] || "", tamano: f[5] || "", grupo_destino: grupo,
      piezas: Number(f[6]) || 0, peso_kg: Number(f[7]) || 0,
    };
  });
  const lotes = [...new Set(filas.map((r) => r.lote).filter(Boolean))];

  // Cabeceras minimas ANTES del detalle (FK) para lotes que no tengan informe.
  const ya = new Set();
  for (let i = 0; i < lotes.length; i += 200) {
    const { data, error } = await supabase.from("calibrador_informe")
      .select("lote").in("lote", lotes.slice(i, i + 200));
    if (error) throw new Error(`informes existentes: ${error.message}`);
    for (const r of data) ya.add(r.lote);
  }
  const porLote = new Map();
  for (const b of batches) {
    if (!/^\d{8}$/.test(b.lote) || ya.has(b.lote)) continue;
    const acc = porLote.get(b.lote) ?? { bins: 0, inicio: null, productor: null, variedad: null };
    acc.bins += b.bins;
    if (!acc.inicio || (b.inicio && b.inicio < acc.inicio)) acc.inicio = b.inicio;
    acc.productor = acc.productor ?? b.productor;
    acc.variedad = acc.variedad ?? b.variedad;
    porLote.set(b.lote, acc);
  }
  const cabeceras = [...porLote.entries()].map(([lote, a]) => ({
    lote, productor: a.productor, commodity: a.variedad,
    fecha: a.inicio ? a.inicio.slice(0, 10) : null,
    bins_ejecutados: a.bins, fichero: "sql-export",
  }));
  for (let i = 0; i < cabeceras.length; i += 500) {
    const { error } = await supabase.from("calibrador_informe")
      .upsert(cabeceras.slice(i, i + 500), { onConflict: "lote" });
    if (error) throw new Error(`calibrador_informe: ${error.message}`);
  }

  // Borrado por PASADA (idempotente y seguro con exports parciales)…
  const batchIds = [...new Set(filas.map((r) => r.batch_id))];
  for (let i = 0; i < batchIds.length; i += 200) {
    const { error } = await supabase.from("calibrador_clasificacion")
      .delete().in("batch_id", batchIds.slice(i, i + 200));
    if (error) throw new Error(`delete pasadas: ${error.message}`);
  }
  // …y limpieza de las provisionales (DOCX) de los lotes cubiertos.
  for (let i = 0; i < lotes.length; i += 200) {
    const { error } = await supabase.from("calibrador_clasificacion")
      .delete().eq("batch_id", 0).in("lote", lotes.slice(i, i + 200));
    if (error) throw new Error(`delete provisionales: ${error.message}`);
  }
  for (let i = 0; i < filas.length; i += 2000) {
    const { error } = await supabase.from("calibrador_clasificacion").insert(filas.slice(i, i + 2000));
    if (error) throw new Error(`insert: ${error.message}`);
  }

  const kg = Math.round(filas.reduce((s, r) => s + r.peso_kg, 0));
  const sinLote = filas.filter((r) => !r.lote).length;
  return { pasadas: batches.length, lotes: lotes.length, filas: filas.length, kg, sinGrupo, sinLote, cabecerasNuevas: cabeceras.length };
}

/** Abre un zip del export y devuelve los dos CSV, o null si no es un export. */
export function abrirZipExport(buffer) {
  const z = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  if (!z["lotes.csv"] || !z["clasificacion.csv"]) return null;
  return { lotesCsv: strFromU8(z["lotes.csv"]), clasifCsv: strFromU8(z["clasificacion.csv"]) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }
  const arg = process.argv.find((a) => a.startsWith("--zip="));
  let zipPath = arg ? arg.slice(6) : null;
  if (!zipPath) {
    const dir = path.resolve("outputs/calibrador");
    zipPath = fs.readdirSync(dir, { recursive: true })
      .map((f) => path.join(dir, String(f))).filter((f) => f.endsWith(".zip")).sort().at(-1);
  }
  if (!zipPath) { console.error("No hay ningun zip."); process.exit(1); }
  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } },
  );
  const csvs = abrirZipExport(fs.readFileSync(zipPath));
  if (!csvs) { console.error("Ese zip no es un export del Sizer."); process.exit(1); }
  console.log(`Importando ${path.basename(zipPath)}…`);
  const r = await importarExportSizer(supabase, csvs);
  console.log(`OK: ${r.pasadas} pasadas · ${r.lotes} lotes · ${r.filas} filas · ${r.kg.toLocaleString("es")} kg · ${r.sinGrupo} sin grupo · ${r.cabecerasNuevas} cabeceras nuevas`);
}
