/**
 * Carga el calibre de campo de Aerobotics: medidas por semana y curvas de
 * crecimiento.
 *
 * QUÉ ENTRA
 *   · yield_measurement_report.xlsx (uno o varios) → milímetros por bloque y
 *     semana. Los mismos bloques pueden venir en varios ficheros; se juntan.
 *   · growthcurves.xlsx → floración, ventana de recolección y ritmo de
 *     crecimiento por finca y variedad, con la fuente de cada curva.
 *
 * MEDIDA O PREVISIÓN. El fichero no lo dice. Lo dice el calendario: una semana
 * que ya pasó es una medida, una que no ha llegado es una previsión. Y cuando
 * una semana prevista llega y se mide de verdad, la previsión NO se pierde: se
 * queda en mm_previsto con la fecha en que se hizo. Sin eso no se puede saber
 * nunca si la previsión valía.
 *
 * ADEMÁS. Cuelga cada bloque de su parcela dibujada (campo_parcelas) cuando el
 * nombre casa, y de paso rellena el nombre de la finca de Aerobotics, que los
 * planos no traen.
 *
 * USO:
 *   node scripts/aerobotics-cargar-calibre.mjs <growthcurves.xlsx|yield_*.xlsx...> [--dry]
 */
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import xlsx from "xlsx";
import { leerInformesCalibre, normalizar, palabras, parecido } from "./aerobotics-emparejar-parcelas.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

/** La semana ISO de una fecha, en el formato de Aerobotics: "2026W38". */
export function semanaIso(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  // Jueves de esa semana: define a qué año ISO pertenece.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d - inicioAno) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}W${String(semana).padStart(2, "0")}`;
}

/** Las curvas de crecimiento: una fila por finca y variedad. */
export function leerCurvas(fichero) {
  const wb = xlsx.readFile(fichero);
  const filas = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  return filas
    .filter((f) => f.Farm && f.Cultivar)
    .map((f) => {
      // Las columnas de mes vienen como "May 2026 " (con espacio de más).
      const crecimiento = {};
      for (const [k, v] of Object.entries(f)) {
        const m = /^([A-Z][a-z]{2})\s+(\d{4})\s*$/.exec(k.trim());
        if (!m || v == null) continue;
        const meses = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
        if (meses[m[1]]) crecimiento[`${m[2]}-${meses[m[1]]}`] = Number(v);
      }
      const ventana = String(f["Harvest window"] ?? "").trim();
      const partes = ventana.split("-").map((s) => s.trim()).filter(Boolean);
      return {
        origen: "aerobotics",
        finca_nombre: String(f.Farm).trim(),
        cultivo: f["Crop type"] ? String(f["Crop type"]).trim() : null,
        variedad: String(f.Cultivar).trim(),
        floracion_semana: f["Full bloom"] ? String(f["Full bloom"]).trim() : null,
        ventana: ventana || null,
        ventana_desde: partes[0] ?? null,
        ventana_hasta: partes[1] ?? null,
        crecimiento,
        fuente: f.Source ? String(f.Source).trim() : null,
      };
    });
}

async function main() {
  const ficheros = process.argv.slice(2).filter((a) => a.endsWith(".xlsx"));
  const soloEnsayo = process.argv.includes("--dry");
  if (ficheros.length === 0) {
    console.error("Uso: node scripts/aerobotics-cargar-calibre.mjs <ficheros.xlsx...> [--dry]");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Los de curvas traen la hoja "GrowthCurves"; los demás son informes de medidas.
  const deCurvas = ficheros.filter((f) => xlsx.readFile(f).SheetNames.some((h) => /growth/i.test(h)));
  const deMedidas = ficheros.filter((f) => !deCurvas.includes(f));

  const hoy = new Date();
  const semanaHoy = semanaIso(hoy);
  const fechaHoy = hoy.toISOString().slice(0, 10);
  console.log(`Hoy es la semana ${semanaHoy}: hasta ahí son medidas, de ahí en adelante previsión.\n`);

  // ─── Parcelas dibujadas, para colgar cada bloque de la suya ───
  const { data: parcelas, error: errorParcelas } = await supabase
    .from("campo_parcelas")
    .select("id, origen_finca_id, nombre, variedad");
  if (errorParcelas) throw new Error(errorParcelas.message);

  // ─── Medidas ───
  const bloques = deMedidas.length > 0 ? leerInformesCalibre(deMedidas, xlsx) : [];
  const medidas = [];
  const fincaDeParcela = new Map(); // id de parcela → nombre de finca de Aerobotics
  let sinParcela = 0;

  for (const b of bloques) {
    const pb = palabras(b.bloque);
    const mejor = (parcelas ?? [])
      .map((p) => ({ p, puntos: parecido(pb, palabras(p.nombre)) }))
      .sort((x, y) => y.puntos - x.puntos)[0];
    const parcela = mejor && mejor.puntos >= 0.8 ? mejor.p : null;
    if (parcela) fincaDeParcela.set(parcela.id, b.finca);
    else sinParcela += 1;

    for (const m of b.medidas) {
      const esMedida = m.semana <= semanaHoy;
      medidas.push({
        origen: "aerobotics",
        finca_nombre: b.finca,
        bloque: b.bloque,
        cultivo: b.cultivo || null,
        variedad: b.variedad || null,
        semana: m.semana,
        mm: m.mm,
        tipo: esMedida ? "medida" : "prevision",
        // La previsión se apunta solo mientras lo es; cuando llega la medida se
        // conserva la que había (ver el upsert de abajo).
        ...(esMedida ? {} : { mm_previsto: m.mm, previsto_en: fechaHoy }),
        parcela_id: parcela?.id ?? null,
      });
    }
  }

  const medidasReales = medidas.filter((m) => m.tipo === "medida").length;
  console.log(`Medidas de calibre: ${medidas.length} (${medidasReales} medidas de verdad, ${medidas.length - medidasReales} previsiones) en ${bloques.length} bloques.`);
  console.log(`Bloques colgados de su parcela dibujada: ${bloques.length - sinParcela} de ${bloques.length}.`);

  // ─── Curvas ───
  const curvas = deCurvas.flatMap(leerCurvas);
  if (curvas.length > 0) {
    const porFuente = new Map();
    for (const c of curvas) porFuente.set(c.fuente ?? "(sin decir)", (porFuente.get(c.fuente ?? "(sin decir)") ?? 0) + 1);
    console.log(`\nCurvas de crecimiento: ${curvas.length} de ${new Set(curvas.map((c) => c.finca_nombre)).size} fincas.`);
    for (const [f, n] of [...porFuente.entries()].sort((a, b) => b[1] - a[1])) {
      const aviso = f === "region_cultivar_default" ? "  ← media de la comarca, NO fruta de la finca" : "";
      console.log(`   ${String(f).padEnd(26)} ${n}${aviso}`);
    }
  }

  if (soloEnsayo) {
    console.log("\n--dry: no se ha escrito nada.");
    return;
  }

  // Lo previo, para no pisar una previsión ya guardada con la medida que llega.
  const { data: previas, error: errorPrevias } = await supabase
    .from("campo_calibre_medidas")
    .select("origen, finca_nombre, bloque, semana, mm_previsto, previsto_en");
  if (errorPrevias) throw new Error(errorPrevias.message);
  const claveMedida = (m) => `${m.origen}|${m.finca_nombre}|${m.bloque}|${m.semana}`;
  const previasPorClave = new Map((previas ?? []).map((p) => [claveMedida(p), p]));

  const aGuardar = medidas.map((m) => {
    const previa = previasPorClave.get(claveMedida(m));
    if (m.tipo === "medida" && previa?.mm_previsto != null) {
      return { ...m, mm_previsto: previa.mm_previsto, previsto_en: previa.previsto_en };
    }
    return m;
  });
  const conservadas = aGuardar.filter((m) => m.tipo === "medida" && m.mm_previsto != null).length;
  if (conservadas > 0) console.log(`\nPrevisiones conservadas al llegar su medida: ${conservadas}.`);

  const TANDA = 200;
  for (let i = 0; i < aGuardar.length; i += TANDA) {
    const { error } = await supabase
      .from("campo_calibre_medidas")
      .upsert(aGuardar.slice(i, i + TANDA), { onConflict: "origen,finca_nombre,bloque,semana" });
    if (error) throw new Error(error.message);
  }

  if (curvas.length > 0) {
    for (let i = 0; i < curvas.length; i += TANDA) {
      const { error } = await supabase
        .from("campo_curvas_crecimiento")
        .upsert(curvas.slice(i, i + TANDA), { onConflict: "origen,finca_nombre,variedad" });
      if (error) throw new Error(error.message);
    }
  }

  // El nombre de la finca en las parcelas dibujadas (los planos solo traen el número).
  for (const [id, nombre] of fincaDeParcela) {
    const parcela = (parcelas ?? []).find((p) => p.id === id);
    if (!parcela) continue;
    const hermanas = (parcelas ?? []).filter((p) => p.origen_finca_id === parcela.origen_finca_id).map((p) => p.id);
    const { error } = await supabase.from("campo_parcelas").update({ origen_finca_nombre: nombre }).in("id", hermanas);
    if (error) throw new Error(error.message);
  }

  console.log(`\nGuardadas ${aGuardar.length} medidas y ${curvas.length} curvas. Nombre de finca puesto a ${fincaDeParcela.size} grupos de parcelas.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
