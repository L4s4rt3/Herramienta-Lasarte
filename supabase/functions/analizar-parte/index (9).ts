import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ArchivoRow {
  id: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  mime_type: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const { part_id } = await req.json();
    if (!part_id || typeof part_id !== "string") {
      return json({ error: "part_id requerido" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY =
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY");
    if (!NVIDIA_API_KEY) return json({ error: "NVIDIA_API_KEY no configurada" }, 500);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "No autenticado" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: parte, error: pErr } = await userClient
      .from("partes_diarios")
      .select("*")
      .eq("id", part_id)
      .maybeSingle();
    if (pErr || !parte) return json({ error: "Parte no encontrado" }, 404);

    if (!Number(parte.kg_inventario_anterior_sin_alta)) {
      const { data: prev } = await userClient
        .from("partes_diarios")
        .select("kg_inventario_sin_alta, date")
        .eq("user_id", parte.user_id)
        .lt("date", parte.date)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prev && Number(prev.kg_inventario_sin_alta) > 0) {
        await userClient
          .from("partes_diarios")
          .update({ kg_inventario_anterior_sin_alta: Number(prev.kg_inventario_sin_alta) })
          .eq("id", part_id);
        parte.kg_inventario_anterior_sin_alta = Number(prev.kg_inventario_sin_alta);
      }
    }

    const { data: archivos, error: aErr } = await userClient
      .from("partes_archivos")
      .select("id,file_name,file_path,file_type,mime_type")
      .eq("part_id", part_id);
    if (aErr) return json({ error: aErr.message }, 500);
    const files = (archivos ?? []) as ArchivoRow[];
    if (files.length === 0) return json({ error: "No hay archivos adjuntos" }, 400);

    const classify = (f: ArchivoRow) => {
      const name = (f.file_name ?? "").toLowerCase();
      const ft = (f.file_type ?? "").toLowerCase();
      if (ft === "gstock" || /g[\s_-]?stock/i.test(name)) return "gstock";
      if (/producci[oó]n/i.test(name) && !/producto/i.test(name)) return "produccion";
      if (/tama[ñn]o|clase|calidad|producto/i.test(name)) return "tamanos";
      if (/palet/i.test(name)) return "palets";
      return "otro";
    };

    const server: Record<string, number> = {};
    let paletsFromGstock = 0;
    let paletsFromPalets = 0;
    const serverDebug: Array<{
      file: string;
      kind: string;
      sheet?: string;
      colHint?: string;
      produccion?: number;
      mujeres?: number;
      podrido?: number;
      palets?: number;
    }> = [];
    const csvContexts: { name: string; kind: string; csv: string }[] = [];

    // Solo procesar archivos XLSX — ignorar imágenes completamente
    for (const f of files) {
      if (!f.file_path) continue;
      const mime = f.mime_type ?? "";
      const isXlsx =
        /\.xlsx?$/i.test(f.file_name ?? "") ||
        mime.includes("spreadsheet") ||
        mime === "application/vnd.ms-excel";

      // Ignorar imágenes y PDFs — no descargar ni procesar
      if (!isXlsx) {
        console.log("Ignorando archivo no-XLSX:", f.file_name);
        continue;
      }

      const { data: blob, error: dlErr } = await admin.storage
        .from("partes-archivos")
        .download(f.file_path);
      if (dlErr || !blob) { console.warn("dl fail", f.file_path, dlErr?.message); continue; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const kind = classify(f);

      try {
        const repaired = repairXlsx(bytes);
        const wb = XLSX.read(repaired, { type: "array" });

        // Importante: NO concatenar todas las hojas y sumar todo (causa duplicados).
        // En su lugar, evaluar cada hoja y quedarnos con el mejor valor por fichero.
        let bestPalets = 0;
        let bestProd = 0;
        let bestMujeres = 0;
        let bestPodrido = 0;

        for (const sn of wb.SheetNames) {
          const ws = wb.Sheets[sn];
          const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: null });
          if (!rows?.length) continue;

          const dbg: any = { file: f.file_name ?? "", kind, sheet: sn };

          if (kind === "gstock" || kind === "palets") {
            const v = extractNetos(rows);
            dbg.palets = v;
            if (v > bestPalets) bestPalets = v;
          } else if (kind === "tamanos") {
            const { mujeres, podrido } = extractTamanos(rows);
            dbg.mujeres = mujeres;
            dbg.podrido = podrido;
            if (mujeres > bestMujeres) bestMujeres = mujeres;
            if (podrido > bestPodrido) bestPodrido = podrido;
          } else if (kind === "produccion") {
            const peso = findCol(rows, [
              (s) => s === "peso(kg)" || s === "peso (kg)" || s === "peso kg",
              (s) => s === "kg" || s === "kilos" || s === "kilogramos",
              (s) => s === "netos" || s === "neto" || s === "kg netos" || s === "peso neto",
              (s) => s.includes("peso") && s.includes("kg"),
              (s) => s.includes("neto"),
            ]) ??
              findCol(rows, [(s) => s.includes("kg") || s.includes("neto") || s.includes("peso")]);
            const v = extractProduccionTotal(rows);
            dbg.produccion = v;
            if (peso) dbg.colHint = colNameAt(rows, peso.headerIdx, peso.colIdx);
            if (v > bestProd) bestProd = v;
          }

          serverDebug.push(dbg);

          const csv = rows
            .map((r) => r.map((c) => (c == null ? "" : String(c))).join(","))
            .join("\n")
            .slice(0, 6000);
          csvContexts.push({ name: `${f.file_name ?? ""} · ${sn}`, kind, csv });
        }

        // Consolidar el mejor valor encontrado por fichero
        if (bestPalets > 0) {
          if (kind === "gstock") paletsFromGstock = Math.max(paletsFromGstock, bestPalets);
          else if (kind === "palets") paletsFromPalets = Math.max(paletsFromPalets, bestPalets);
        }
        if (bestProd > 0) server.kg_produccion_calibrador = Math.max(server.kg_produccion_calibrador ?? 0, bestProd);
        if (bestMujeres > 0) server.kg_mujeres_calibrador = Math.max(server.kg_mujeres_calibrador ?? 0, bestMujeres);
        if (bestPodrido > 0) server.kg_podrido_calibrador_auto = Math.max(server.kg_podrido_calibrador_auto ?? 0, bestPodrido);
      } catch (e) {
        console.warn("xlsx parse fail", f.file_name, e);
      }
    }

    // Consolidar palets: preferir GSTOCK.
    if (paletsFromGstock > 0) server.kg_palets_brutos = paletsFromGstock;
    else if (paletsFromPalets > 0) server.kg_palets_brutos = paletsFromPalets;

    // Construir prompt para IA (solo texto, sin imágenes)
    const hint = "Eres analista de una empresa citricola. Extrae datos del parte diario en kg.\n" +
      "Devuelve JSON con: kg_produccion_total, kg_mujeres_l, kg_podrido_calibrador, kg_palets_alta, notas.\n" +
      "Solo devuelve JSON, sin texto adicional.";

    const textParts: string[] = [hint];
    for (const c of csvContexts) {
      textParts.push("\n--- [" + c.kind + "] " + c.name + " ---\n" + c.csv);
    }
    const finalText = textParts.join("\n").slice(0, 30000);

    let aiData: any = {};
    let aiWarning: string | null = null;
    const modelChain = ["meta/llama-3.3-70b-instruct"];
    const RETRYABLE = new Set([429, 500, 502, 503, 504]);
    let lastStatus = 0;
    let lastBody = "";
    let succeeded = false;

    outer: for (const model of modelChain) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        // Nvidia puede tardar; 12s suele cortar demasiado pronto en Edge.
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          const aiResp = await fetch(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + NVIDIA_API_KEY,
              },
              signal: controller.signal,
              body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: finalText }],
                response_format: { type: "json_object" },
                temperature: 0.1,
              }),
            },
          );
          clearTimeout(timeout);

          if (aiResp.ok) {
            const aiJson = await aiResp.json();
            const text = aiJson && aiJson.choices && aiJson.choices[0] && aiJson.choices[0].message
              ? aiJson.choices[0].message.content
              : "{}";
            try {
              aiData = JSON.parse(text);
              succeeded = true;
            } catch {
              aiWarning = "La IA devolvio un JSON no valido";
              aiData = {};
              succeeded = true;
            }
            break outer;
          }

          lastStatus = aiResp.status;
          lastBody = await aiResp.text();
          console.warn("Nvidia " + model + " intento " + (attempt + 1) + " -> " + aiResp.status);
          if (lastBody) console.warn("Nvidia body (trunc):", lastBody.slice(0, 500));

          if (aiResp.status === 403) { aiWarning = "Nvidia rechazo la clave"; break outer; }
          if (!RETRYABLE.has(aiResp.status)) { aiWarning = "Nvidia devolvio " + aiResp.status; break; }
          const delay = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
          await new Promise((r) => setTimeout(r, delay));
        } catch (e) {
          clearTimeout(timeout);
          const isAbort = e instanceof Error && e.name === "AbortError";
          lastStatus = 0;
          lastBody = isAbort ? "timeout" : (e instanceof Error ? e.message : "error");
          console.warn("Nvidia fetch error:", lastBody);
          const delay = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (!succeeded && !aiWarning) {
      if (lastStatus === 429) aiWarning = "Limite IA superado";
      else if (lastStatus === 503) aiWarning = "IA saturada, reintenta en unos minutos";
      else if (lastStatus === 0) aiWarning = "Timeout al consultar IA";
      else aiWarning = "Nvidia devolvio " + lastStatus;
      console.error("Nvidia exhausted retries", lastStatus, (lastBody ?? "").slice(0, 500));
    }

    const mapping: Record<string, string> = {
      kg_produccion_total: "kg_produccion_calibrador",
      kg_mujeres_l: "kg_mujeres_calibrador",
      kg_podrido_calibrador: "kg_podrido_calibrador_auto",
      kg_palets_alta: "kg_palets_brutos",
    };
    const update: Record<string, any> = {};
    for (const [specKey, dbKey] of Object.entries(mapping)) {
      const sv = server[dbKey];
      const av = Number(aiData?.[specKey]);
      if (typeof sv === "number" && sv > 0) update[dbKey] = sv;
      else if (isFinite(av) && av > 0) update[dbKey] = av;
    }
    aiData = aiData ?? {};
    update.resumen_ia = { ...aiData, _server_side: server, _server_side_debug: serverDebug, _ai_warning: aiWarning };
    update.estado = "Analizado";

    const { error: upErr } = await userClient
      .from("partes_diarios")
      .update(update)
      .eq("id", part_id);
    if (upErr) {
      console.error("partes_diarios update failed", upErr);
      return json({ error: "No se pudo actualizar el parte: " + upErr.message }, 500);
    }

    await userClient.from("production_runs").delete().eq("part_id", part_id);
    await userClient.from("gstock_entries").delete().eq("part_id", part_id);
    await userClient.from("lotes_dia").delete().eq("part_id", part_id).eq("source", "ia");

    const uid = userData.user.id;
    if (Array.isArray(aiData.produccion) && aiData.produccion.length > 0) {
      const rows = aiData.produccion
        .filter((r: any) => Number(r?.kg_produced) > 0)
        .map((r: any) => ({
          part_id, user_id: uid, date: parte.date, source: "ia",
          product: r.product ?? null, size_range: r.size_range ?? null,
          kg_produced: Number(r.kg_produced) || 0,
        }));
      if (rows.length) await userClient.from("production_runs").insert(rows);
    }
    if (Array.isArray(aiData.gstock) && aiData.gstock.length > 0) {
      const rows = aiData.gstock
        .filter((r: any) => Number(r?.kg_expected) > 0)
        .map((r: any) => ({
          part_id, user_id: uid, date: parte.date, source: "ia",
          product: r.product ?? null, size_range: r.size_range ?? null,
          kg_expected: Number(r.kg_expected) || 0,
        }));
      if (rows.length) await userClient.from("gstock_entries").insert(rows);
    }
    if (Array.isArray(aiData.lotes) && aiData.lotes.length > 0) {
      const rows = aiData.lotes.map((r: any) => ({
        part_id, user_id: uid, source: "ia",
        producto: r.producto ?? null, lote_codigo: r.lote_codigo ?? null, notas: r.notas ?? null,
      }));
      if (rows.length) await userClient.from("lotes_dia").insert(rows);
    }

    return json({
      message: aiWarning
        ? "Analisis completado con extraccion server-side; IA no disponible (" + aiWarning + ")."
        : "Analisis completado: " + files.length + " archivo(s).",
      server_side: server,
      ai: aiData,
      ai_warning: aiWarning,
    });
  } catch (e) {
    console.error("analizar-parte error", e);
    return json({ error: e instanceof Error ? e.message : "Error desconocido" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function repairXlsx(bytes: Uint8Array): Uint8Array {
  for (let i = 0; i < Math.min(bytes.length - 4, 65536); i++) {
    if (bytes[i] === 0x50 && bytes[i+1] === 0x4b && bytes[i+2] === 0x03 && bytes[i+3] === 0x04) {
      return i === 0 ? bytes : bytes.slice(i);
    }
  }
  return bytes;
}

function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/\s/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (hasComma) s = s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

const norm = (s: any) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

// Detección robusta de filas TOTAL/SUBTOTAL para evitar duplicados.
const isTotal = (row: any[]) => {
  for (const c of row) {
    const s = norm(String(c ?? ""));
    if (!s) continue;
    if (
      s.includes("subtotal") ||
      s.includes("sub total") ||
      s.includes("total general") ||
      s.includes("totales") ||
      s.includes("total") ||
      s === "tot."
    ) return true;
  }
  return false;
};

function findCol(rows: any[][], predicates: ((s: string) => boolean)[]): { headerIdx: number; colIdx: number } | null {
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const s = norm(r[j]);
      if (predicates.some((p) => p(s))) return { headerIdx: i, colIdx: j };
    }
  }
  return null;
}

function colNameAt(rows: any[][], headerIdx: number, colIdx: number): string {
  const v = rows?.[headerIdx]?.[colIdx];
  return String(v ?? "").trim();
}

function extractNetos(rows: any[][]): number {
  const hit = findCol(rows, [
    (s) => s === "netos" || s === "neto" || s === "kg netos" || s === "peso neto",
    (s) => s.includes("neto"),
  ]);
  if (!hit) return 0;
  let sum = 0;
  for (let i = hit.headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (isTotal(r)) continue;
    const v = toNum(r[hit.colIdx]);
    if (v > 0) sum += v;
  }
  return sum;
}

function extractTamanos(rows: any[][]): { mujeres: number; podrido: number } {
  let mujeres = 0;
  let podrido = 0;
  let inMujeresSection = false;
  let pesoCol = -1;
  let sectionValues: number[] = [];

  const finalizeMujeres = () => {
    if (sectionValues.length > 1) {
      const last = sectionValues[sectionValues.length - 1];
      const sumRest = sectionValues.slice(0, -1).reduce((a: number, b: number) => a + b, 0);
      const val = Math.abs(last - sumRest) < 1 ? last : sectionValues.reduce((a: number, b: number) => a + b, 0);
      if (val > mujeres) mujeres = val; // quedarse con el mayor
    }
    sectionValues = [];
    pesoCol = -1;
    inMujeresSection = false;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rowVals = r.map((c: any) => norm(String(c ?? "")));

    if (rowVals.some((v: string) => v === "mujeres")) {
      if (inMujeresSection) finalizeMujeres();
      inMujeresSection = true;
      pesoCol = -1;
      sectionValues = [];
      continue;
    }

    if (inMujeresSection && rowVals.some((v: string) =>
      v === "exportacion" || v === "no exportacion" || v === "no comercial"
    )) {
      finalizeMujeres();
    }

    if (inMujeresSection && pesoCol === -1) {
      for (let j = 0; j < r.length; j++) {
        const cell = norm(String(r[j] ?? ""));
        if (cell === "peso (kg)" || cell === "peso(kg)" || cell === "peso kg") {
          pesoCol = j; break;
        }
      }
      continue;
    }

    if (inMujeresSection && pesoCol >= 0) {
      const v = toNum(r[pesoCol]);
      if (v > 0) sectionValues.push(v);
    }

    // Podrido puede aparecer fuera de la sección “mujeres”; intentar extraerlo de la fila.
    if (rowVals.some((v: string) => v === "podrido")) {
      const kg = pesoCol >= 0 ? toNum(r[pesoCol]) : 0;
      if (kg > 0) podrido = Math.max(podrido, kg);
      else {
        // fallback: mayor número de la fila (suele estar en la última columna numérica)
        let best = 0;
        for (const cell of r) {
          const n = toNum(cell);
          if (n > best) best = n;
        }
        if (best > 0) podrido = Math.max(podrido, best);
      }
    }
  }

  if (inMujeresSection) finalizeMujeres();

  return { mujeres, podrido };
}

function extractProduccionTotal(rows: any[][]): number {
  // Caso 1: fila de resumen con "Peso (kg):" como etiqueta y valor al lado (formato Spectrim)
  // Ej: fila 4 → [..., "Peso (kg):", ..., "110.924,49 (110.924,49)*", ...]
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const cell = norm(String(r[j] ?? ""));
      if (cell === "peso (kg):" || cell === "peso(kg):") {
        for (let k = j + 1; k < r.length; k++) {
          if (r[k] != null && String(r[k]).trim() !== "") {
            const v = toNum(r[k]);
            if (v > 0) return v;
          }
        }
      }
    }
  }

  // Caso 2: tabla con cabecera "Peso (kg)" — coger el último valor de esa columna (fila total)
  const peso = findCol(rows, [
    (s) => s === "peso(kg)" || s === "peso (kg)" || s === "peso kg",
    (s) => s === "kg" || s === "kilos" || s === "kilogramos",
    (s) => s === "netos" || s === "neto" || s === "kg netos" || s === "peso neto",
    (s) => s.includes("peso") && s.includes("kg"),
    (s) => s.includes("neto"),
  ]) ?? findCol(rows, [(s) => s.includes("kg") || s.includes("neto") || s.includes("peso")]);
  if (!peso) return 0;

  // Buscar desde abajo el último valor numérico > 0 (es el total/subtotal)
  for (let i = rows.length - 1; i > peso.headerIdx; i--) {
    const r = rows[i] ?? [];
    const v = toNum(r[peso.colIdx]);
    if (v > 0) return v;
  }

  return 0;
}
