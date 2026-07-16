import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { unzipSync, zipSync } from "https://esm.sh/fflate@0.8.2";

// Parser determinista (sin IA) para el "Informe LOTE": un informe por lote individual,
// con el desglose completo Producto -> Calidad -> Clase/Grupo -> Tamaño para ese lote.
// El formato es una exportación de máquina, siempre con el mismo patrón de filas, por lo
// que reglas fijas son más fiables (y gratis) que pasarlo por un LLM.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ClasificacionRow {
  producto: string;
  calidad: string | null;
  clase: string;
  grupo_destino: string | null;
  tamano: string;
  piezas: number | null;
  pct_piezas: number | null;
  peso_kg: number;
  pct_peso: number | null;
  cartons: number | null;
  pct_cartons: number | null;
}

interface LoteHeader {
  lote_codigo: string | null;
  productor: string | null;
  fecha: string | null;
  toneladas_hora: number | null;
  peso_fruta_promedio_g: number | null;
  duracion_min: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const { archivo_id } = await req.json();
    if (!archivo_id || typeof archivo_id !== "string") {
      return json({ error: "archivo_id requerido" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "No autorizado" }, 401);
    const uid = userData.user.id;

    const { data: archivo, error: aErr } = await userClient
      .from("partes_archivos")
      .select("id, part_id, user_id, file_name, file_path, mime_type")
      .eq("id", archivo_id)
      .maybeSingle();
    if (aErr || !archivo) return json({ error: "Archivo no encontrado" }, 404);
    if (!archivo.file_path) return json({ error: "El archivo no tiene ruta de almacenamiento" }, 400);

    const { data: blob, error: dlErr } = await admin.storage.from("partes-archivos").download(archivo.file_path);
    if (dlErr || !blob) return json({ error: "No se pudo descargar el archivo: " + (dlErr?.message ?? "") }, 500);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let converted = deflate64ToDeflate(bytes);
    if (converted === bytes) converted = repairXlsx(bytes);

    let rowsAll: any[][];
    try {
      const wb = XLSX.read(converted, { type: "array" });
      rowsAll = [];
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn];
        rowsAll.push(...XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: null }));
      }
    } catch (e) {
      return json({ error: "No se pudo leer el Excel: " + (e as Error).message }, 400);
    }

    const header = extractLoteHeader(rowsAll);
    if (!header.lote_codigo) {
      return json({ error: "Este archivo no parece un Informe LOTE (no se encontró 'Nombre del Lote')" }, 400);
    }

    const clasificacion = extractClasificacion(rowsAll);
    if (clasificacion.length === 0) {
      return json({ error: "No se encontraron filas de calibre/clase en el archivo" }, 400);
    }

    // Convención B de normalización de lote (código base = dígitos iniciales
    // del texto). Deno no puede importar de src/lib, así que esta función
    // replica la lógica a mano; ver src/lib/loteCodigo.ts (prefijoNumericoLote)
    // para la documentación completa de las dos convenciones y quién usa cada una.
    const loteCodigoBase = (header.lote_codigo.match(/^(\d+)/)?.[1]) ?? null;

    // Emparejar (best-effort) con un lote de lotes_dia del mismo parte, por código.
    const { data: candidatos } = await userClient
      .from("lotes_dia")
      .select("id, lote_codigo")
      .eq("part_id", archivo.part_id);
    const rawNorm = header.lote_codigo.trim().toLowerCase();
    const baseNorm = (loteCodigoBase ?? "").toLowerCase();
    let matched = (candidatos ?? []).find((c) => (c.lote_codigo ?? "").trim().toLowerCase() === rawNorm) ?? null;
    if (!matched && baseNorm) {
      matched = (candidatos ?? []).find((c) => (c.lote_codigo ?? "").trim().toLowerCase() === baseNorm) ?? null;
    }
    if (!matched && baseNorm) {
      matched = (candidatos ?? []).find((c) => (c.lote_codigo ?? "").trim().toLowerCase().startsWith(baseNorm)) ?? null;
    }

    // Idempotente: si se reprocesa este archivo o se sube otro para el mismo lote, se sustituye.
    await admin.from("lote_clasificacion").delete().eq("part_id", archivo.part_id).eq("lote_codigo", header.lote_codigo);

    const rows = clasificacion.map((c) => ({
      part_id: archivo.part_id,
      user_id: uid,
      archivo_id: archivo.id,
      lote_dia_id: matched?.id ?? null,
      lote_codigo: header.lote_codigo,
      lote_codigo_base: loteCodigoBase,
      productor: header.productor,
      fecha: header.fecha,
      toneladas_hora: header.toneladas_hora,
      peso_fruta_promedio_g: header.peso_fruta_promedio_g,
      duracion_min: header.duracion_min,
      producto: c.producto,
      calidad: c.calidad,
      clase: c.clase,
      grupo_destino: c.grupo_destino,
      tamano: c.tamano,
      piezas: c.piezas,
      pct_piezas: c.pct_piezas,
      peso_kg: c.peso_kg,
      pct_peso: c.pct_peso,
      cartons: c.cartons,
      pct_cartons: c.pct_cartons,
    }));

    const { error: insErr } = await admin.from("lote_clasificacion").insert(rows);
    if (insErr) return json({ error: "No se pudo guardar la clasificación: " + insErr.message }, 500);

    const kgTotal = rows.reduce((s, r) => s + (r.peso_kg || 0), 0);
    return json({
      ok: true,
      lote_codigo: header.lote_codigo,
      productor: header.productor,
      kg_total: kgTotal,
      n_registros: rows.length,
      n_productos: new Set(rows.map((r) => r.producto)).size,
      n_clases: new Set(rows.map((r) => r.clase)).size,
      matched_lote_dia_id: matched?.id ?? null,
    });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message ?? "Error desconocido" }, 500);
  }
});

// ─── Extracción determinista ────────────────────────────────────────────────

/** Celdas no vacías de una fila, en orden, con su índice de columna original. */
function nonEmptyCells(row: any[]): { v: any; idx: number }[] {
  const out: { v: any; idx: number }[] = [];
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    if (v !== null && v !== undefined && v !== "") out.push({ v, idx: i });
  }
  return out;
}

/** Busca `label` (texto exacto, trim) en la lista de celdas y devuelve el valor de la celda siguiente. */
function valueAfterLabel(cells: { v: any; idx: number }[], label: string, fromIndex = 0): any {
  for (let i = fromIndex; i < cells.length; i++) {
    if (typeof cells[i].v === "string" && cells[i].v.trim() === label) {
      return cells[i + 1]?.v ?? null;
    }
  }
  return undefined;
}

function extractLoteHeader(rowsAll: any[][]): LoteHeader {
  const header: LoteHeader = {
    lote_codigo: null,
    productor: null,
    fecha: null,
    toneladas_hora: null,
    peso_fruta_promedio_g: null,
    duracion_min: null,
  };

  for (const row of rowsAll) {
    const cells = nonEmptyCells(row);
    if (cells.length === 0) continue;
    // Dejar de buscar cabecera una vez empieza la tabla de productos.
    if (typeof cells[0].v === "string" && cells[0].v.trim() === "Producto:") break;

    const nombreLote = valueAfterLabel(cells, "Nombre del Lote");
    if (nombreLote !== undefined && nombreLote !== null) header.lote_codigo = String(nombreLote).trim();

    const productorRaw = valueAfterLabel(cells, "Productor / Código");
    if (productorRaw !== undefined && productorRaw !== null) {
      const s = String(productorRaw).trim();
      const idx = s.lastIndexOf(" / ");
      header.productor = idx === -1 ? s : s.slice(0, idx).trim();
    }

    const fechaRaw = valueAfterLabel(cells, "Fecha y Hora de Comienzo");
    if (typeof fechaRaw === "number") header.fecha = excelSerialToISODate(fechaRaw);

    const tph = valueAfterLabel(cells, "Toneladas / Hora");
    if (tph !== undefined && tph !== null) header.toneladas_hora = parseLeadingSpanishNumber(tph);

    const pesoFruta = valueAfterLabel(cells, "Peso de Fruta Promedio (g)");
    if (pesoFruta !== undefined && pesoFruta !== null) header.peso_fruta_promedio_g = parseLeadingSpanishNumber(pesoFruta);

    const tiempoLote = valueAfterLabel(cells, "Tiempo Lote");
    if (typeof tiempoLote === "string") header.duracion_min = hhmmssToMinutes(tiempoLote);
  }

  return header;
}

function extractClasificacion(rowsAll: any[][]): ClasificacionRow[] {
  const out: ClasificacionRow[] = [];
  let producto: string | null = null;
  let calidad: string | null = null;
  let clase: string | null = null;
  let grupo: string | null = null;

  for (const row of rowsAll) {
    const cells = nonEmptyCells(row);
    if (cells.length === 0) continue;
    const first = cells[0].v;

    if (typeof first === "string") {
      const label = first.trim();
      if (label === "Producto:") {
        producto = String(cells[1]?.v ?? "").trim() || null;
        continue;
      }
      if (label === "Calidad:") {
        calidad = String(cells[1]?.v ?? "").trim() || null;
        continue;
      }
      if (label === "Clase:") {
        clase = String(cells[1]?.v ?? "").trim() || null;
        const gi = cells.findIndex((c, i) => i > 1 && typeof c.v === "string" && c.v.trim() === "Grupo de Clasificación:");
        grupo = gi !== -1 ? (String(cells[gi + 1]?.v ?? "").trim() || null) : null;
        continue;
      }
      if (label === "Tamaño") continue; // cabecera de la mini-tabla
      if (label.startsWith("Total")) continue; // subtotales de calidad/producto/lote

      // Fila de datos: label = tamaño, seguido de valores numéricos.
      if (producto && clase) {
        const values = cells.slice(1).map((c) => c.v).filter((v) => typeof v === "number") as number[];
        if (values.length > 0) {
          const [piezas, pctPiezas, pesoKg, pctPeso, cartons, pctCartons] = values;
          out.push({
            producto,
            calidad,
            clase,
            grupo_destino: grupo,
            tamano: label,
            piezas: piezas ?? null,
            pct_piezas: pctPiezas ?? null,
            peso_kg: pesoKg ?? 0,
            pct_peso: pctPeso ?? null,
            cartons: cartons ?? null,
            pct_cartons: pctCartons ?? null,
          });
        }
      }
    }
    // Si `first` es number, es una fila de subtotal de la clase (sin tamaño) -> se ignora,
    // ya que sus valores son la suma de las filas de tamaño ya capturadas arriba.
  }

  return out;
}

function excelSerialToISODate(serial: number): string | null {
  try {
    const d = (XLSX as any).SSF.parse_date_code(serial);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  } catch {
    return null;
  }
}

function parseLeadingSpanishNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).trim();
  const m = s.match(/^(-?[\d.,]+)/);
  if (!m) return null;
  let numStr = m[1];
  if (numStr.includes(",") && numStr.includes(".")) numStr = numStr.replace(/\./g, "").replace(",", ".");
  else if (numStr.includes(",")) numStr = numStr.replace(",", ".");
  const n = parseFloat(numStr);
  return isFinite(n) ? n : null;
}

function hhmmssToMinutes(v: string): number | null {
  const m = v.trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
}

// ─── Reparación de XLSX con compresión no estándar (mismo criterio que analizar-parte) ──

function deflate64ToDeflate(bytes: Uint8Array): Uint8Array {
  try {
    const unzipped = unzipSync(bytes);
    return zipSync(unzipped, { level: 6 });
  } catch {
    return bytes;
  }
}

function repairXlsx(bytes: Uint8Array): Uint8Array {
  let start = 0;
  for (let i = 0; i < Math.min(bytes.length - 4, 65536); i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      start = i;
      break;
    }
  }
  const buf = start === 0 ? new Uint8Array(bytes) : new Uint8Array(bytes.slice(start));

  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method = buf[i + 8] | (buf[i + 9] << 8);
      if (method !== 0 && method !== 8) {
        buf[i + 8] = 8;
        buf[i + 9] = 0;
      }
      const fnLen = buf[i + 26] | (buf[i + 27] << 8);
      const exLen = buf[i + 28] | (buf[i + 29] << 8);
      i += 30 + fnLen + exLen - 1;
    }
  }

  for (let i = 0; i < buf.length - 46; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
      const method = buf[i + 10] | (buf[i + 11] << 8);
      if (method !== 0 && method !== 8) {
        buf[i + 10] = 8;
        buf[i + 11] = 0;
      }
      const fnLen = buf[i + 28] | (buf[i + 29] << 8);
      const exLen = buf[i + 30] | (buf[i + 31] << 8);
      const cmLen = buf[i + 32] | (buf[i + 33] << 8);
      i += 46 + fnLen + exLen + cmLen - 1;
    }
  }

  return buf;
}
