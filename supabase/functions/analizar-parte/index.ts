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
  console.log("[START] Function invoked, checking...");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    console.log("[AUTH] Header present:", !!authHeader);
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const { part_id, current_values } = await req.json();
    if (!part_id || typeof part_id !== "string") {
      return json({ error: "part_id requerido" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OPENCODE_API_KEY = Deno.env.get("OPENCODE_API_KEY");
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY");
    if (!OPENCODE_API_KEY && !GROQ_API_KEY && !DEEPSEEK_API_KEY && !NVIDIA_API_KEY) {
      return json({ error: "Ninguna API key configurada (OPENCODE/GROQ/DEEPSEEK/NVIDIA)" }, 500);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "No autenticado" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: parte, error: pErr } = await userClient
      .from("partes_diarios").select("*").eq("id", part_id).maybeSingle();
    if (pErr || !parte) return json({ error: "Parte no encontrado" }, 404);

    if (!Number(parte.kg_inventario_anterior_sin_alta)) {
      const { data: prev } = await userClient
        .from("partes_diarios")
        .select("kg_inventario_sin_alta, date")
        .eq("user_id", parte.user_id)
        .lt("date", parte.date)
        .order("date", { ascending: false })
        .limit(1).maybeSingle();
      if (prev && Number(prev.kg_inventario_sin_alta) > 0) {
        await userClient.from("partes_diarios")
          .update({ kg_inventario_anterior_sin_alta: Number(prev.kg_inventario_sin_alta) })
          .eq("id", part_id);
        parte.kg_inventario_anterior_sin_alta = Number(prev.kg_inventario_sin_alta);
      }
    }

    const { data: archivos, error: aErr } = await userClient
      .from("partes_archivos").select("id,file_name,file_path,file_type,mime_type").eq("part_id", part_id);
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
    const csvContexts: { name: string; kind: string; csv: string }[] = [];

    for (const f of files) {
      if (!f.file_path) continue;
      const mime = f.mime_type ?? "";
      const isXlsx = /\.xlsx?$/i.test(f.file_name ?? "") || mime.includes("spreadsheet") || mime === "application/vnd.ms-excel";
      if (!isXlsx) continue;

      const { data: blob, error: dlErr } = await admin.storage.from("partes-archivos").download(f.file_path);
      if (dlErr || !blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const kind = classify(f);

      try {
        const repaired = repairXlsx(bytes);
        const wb = XLSX.read(repaired, { type: "array" });
        const rowsAll: any[][] = [];
        for (const sn of wb.SheetNames) {
          const ws = wb.Sheets[sn];
          rowsAll.push(...XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: null }));
        }

        if (kind === "gstock" || kind === "palets") {
          const v = extractNetos(rowsAll);
          if (v > 0 && (kind === "gstock" || !server.kg_palets_brutos)) server.kg_palets_brutos = v;
        } else if (kind === "tamanos") {
          const { mujeres, podrido } = extractTamanos(rowsAll);
          if (mujeres > 0) server.kg_mujeres_calibrador = mujeres;
          if (podrido > 0) server.kg_podrido_calibrador_auto = podrido;
        } else if (kind === "produccion") {
          const v = extractProduccionTotal(rowsAll);
          if (v > 0) server.kg_produccion_calibrador = v;
        }

        const csv = rowsAll.map((r) => r.map((c) => (c == null ? "" : String(c))).join(",")).join("\n").slice(0, 1500);
        csvContexts.push({ name: f.file_name ?? "", kind, csv });
      } catch (e) { console.warn("xlsx parse fail", f.file_name, e); }
    }

    // ── PROMPT OPTIMIZADO ─────────────────────────────────────────────────
    const jsonTemplate = '{"kg_produccion_total":0,"kg_mujeres_l":0,"kg_podrido_calibrador":0,"kg_palets_alta":0,"industria_manual":0,"reciclado_z1":0,"reciclado_z2":0,"kg_palets_brutos":0,"inventario_dia_anterior":0,"inventario_final":0,"kg_podrido_manual":0,"produccion_real":0,"palets_ajustados":0,"dif_bruta":0,"mermas_totales":0,"djpmn":0,"pct_djpmn":0,"produccion":[],"gstock":[],"lotes_detalle":[],"palets_detalle":[],"producto_detalle":[],"calibres_detalle":[],"analisis":"","fuentes":{}}';

    const sysPrompt = `Analista planta citrica Lasarte SAT. Extrae datos de Excel adjuntos y devuelve JSON.

REGLAS: Solo datos explicitos. Priorizar fila TOTAL. Si no existe, ultimo valor valido de columna peso. Cantidades en kg. No redondear hasta el final. Dato inexistente=0.

EXTRACCION:
- PRODUCCION (*produccion*.xlsx): kg_produccion_total = "Peso kg" fila TOTAL o ultimo valor.
- TAMANOS (*tamanos*.xlsx): kg_mujeres_l = suma "Peso kg" donde clase="L" o seccion="Mujeres".
- PRODUCTO (*producto*.xlsx): kg_podrido_calibrador = "Peso kg" fila Producto="PODRIDO" (excluir MUESTRA/PREC).
- PALETS (palets*.xlsx/GSTOCK*.xlsx): kg_palets_alta = suma "Netos"/"Peso" >0, excluir totales.

CASCADA:
produccion_real = kg_produccion_total + industria_manual - kg_mujeres_l - reciclado_z1 - reciclado_z2
palets_ajustados = kg_palets_brutos - inventario_dia_anterior
dif_bruta = produccion_real - palets_ajustados - inventario_final
mermas_totales = kg_podrido_calibrador + kg_podrido_manual
djpmn = dif_bruta - mermas_totales
pct_djpmn = djpmn/produccion_real*100 (2 dec, 0 si prod=0)

Responde SOLO con JSON valido usando esta estructura (rellena valores): ${jsonTemplate}

ARRAYS DETALLADOS (extraer TODAS las filas, no solo totales):

- produccion: array de {product, sizerange, kgproduced, destination}
- gstock: array de {product, sizerange, kgexpected}

- lotes_detalle: array de objetos por cada lote del informe produccion:
  {lote_codigo, productor, producto, kg_peso_total, toneladas_hora, duracion_min, peso_fruta_promedio_g, hora_inicio}
  Buscar columnas: ID/Lote, Nombre/Productor, Variedad/Producto, Peso(kg), T/h, Duracion(min), PesoFruta(g), HoraInicio/Tiempo.

- palets_detalle: array de objetos por cada palet del informe palets/gstock:
  {palet_id, producto, cliente, destino, kg_neto, situacion, n_cajas}
  Buscar columnas: Palet/ID, Producto/Variedad, Cliente, Destino/Camara, Netos/Peso, Situacion, Cajas.

- producto_detalle: array de objetos por cada linea del informe producto/tamanos:
  {linea, producto, formato_caja, kg, n_cajas, grupo_destino}
  Buscar columnas: Linea, Producto/Variedad, Formato/Caja, Peso(kg), Cajas, Destino/Grupo(Exportacion/Mercado/Industria).

- calibres_detalle: array de objetos por cada calibre del informe tamanos:
  {calibre, clase, kg, piezas, pct, grupo_destino}
  Buscar columnas: Calibre/Tamano, Clase(Exportacion/Mercado/Industria), Peso(kg), Piezas/Unidades, %(porcentaje), Destino.

- analisis: string con breve resumen
- fuentes: objeto con origen de cada dato (nombre archivo o null)`;

    // ── Mensaje de usuario ────────────────────────────────────────────────
    const dateStr = parte.date ?? "desconocida";
    let userMsg = `Parte ${dateStr}. Archivos:\n${csvContexts.map(c => "- " + c.name).join("\n")}\n`;
    for (const c of csvContexts) userMsg += "\n--- [" + c.kind + "] " + c.name + " ---\n" + c.csv;
    const finalUserMsg = userMsg.slice(0, 8000);

    // ── Llamada IA con fallback DeepSeek -> NVIDIA ────────────────────────
    let aiData: any = {};
    let aiWarning: string | null = null;
    let lastStatus = 0;
    let lastBody = "";
    let succeeded = false;

    const providers = [
      ...(NVIDIA_API_KEY ? [{ name: "NVIDIA", url: "https://integrate.api.nvidia.com/v1/chat/completions", key: NVIDIA_API_KEY, model: "meta/llama-3.3-70b-instruct", jsonMode: true }] : []),
      ...(OPENCODE_API_KEY ? [{ name: "OpenCode", url: "https://opencode.ai/zen/v1/chat/completions", key: OPENCODE_API_KEY, model: "ring-2.6-1t-free", jsonMode: true }] : []),
      ...(GROQ_API_KEY ? [{ name: "Groq", url: "https://api.groq.com/openai/v1/chat/completions", key: GROQ_API_KEY, model: "llama-3.3-70b-versatile", jsonMode: false }] : []),
      ...(DEEPSEEK_API_KEY ? [{ name: "DeepSeek", url: "https://api.deepseek.com/v1/chat/completions", key: DEEPSEEK_API_KEY, model: "deepseek-chat", jsonMode: true }] : []),
    ];
    const RETRYABLE = new Set([429, 500, 502, 503, 504]);

    outer: for (const provider of providers) {
      const timeoutMs = 25000;
      const maxAttempts = 2;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          console.log("[IA] " + provider.name + " modelo=" + provider.model + " intento=" + (attempt + 1));
          const reqBody: any = {
            model: provider.model,
            messages: [{ role: "system", content: sysPrompt }, { role: "user", content: finalUserMsg }],
            temperature: 0.1,
            max_tokens: 4096,
          };
          if (provider.jsonMode) reqBody.response_format = { type: "json_object" };
          const aiResp = await fetch(provider.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + provider.key },
            signal: controller.signal,
            body: JSON.stringify(reqBody),
          });
          clearTimeout(timeout);
            if (aiResp.ok) {
            const aiJson = await aiResp.json();
            let text = aiJson?.choices?.[0]?.message?.content ?? "{}";
            console.log("[IA] raw response (first 300 chars):", text.slice(0, 300));
            text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
            try {
              aiData = JSON.parse(text);
              succeeded = true;
              console.log("[IA] JSON parseado correctamente");
            } catch {
              // Si falla, buscar un objeto JSON dentro del texto
              const m = text.match(/\{[\s\S]*\}/);
              if (m) {
                try {
                  aiData = JSON.parse(m[0]);
                  succeeded = true;
                  console.log("[IA] JSON encontrado dentro de texto (markdown removido)");
                } catch (innerErr) {
                  console.warn("[IA] Error parseando JSON extraído:", innerErr);
                  aiWarning = provider.name + ": JSON en posición incorrecta";
                  aiData = {};
                  succeeded = true;
                }
              } else {
                console.warn("[IA] No se encontró JSON válido en respuesta. Texto (primeros 200):", text.slice(0, 200));
                aiWarning = provider.name + ": JSON invalido (len=" + text.length + ")";
                aiData = {};
                succeeded = true;
              }
            }
            aiWarning = null; // limpiar warning de proveedores anteriores
            console.log("[IA] " + provider.name + " OK, keys:", Object.keys(aiData).join(","));
            break outer;
          }
          lastStatus = aiResp.status;
          lastBody = await aiResp.text();
          console.warn("[IA] " + provider.name + " intento " + (attempt + 1) + " -> " + aiResp.status + " body(100):", lastBody.slice(0, 100));
          if (aiResp.status === 401 || aiResp.status === 403) { aiWarning = provider.name + " auth failed (" + aiResp.status + ")"; break; }
          if (aiResp.status === 429) { aiWarning = provider.name + " rate limited (" + aiResp.status + ")"; break; }
          if (!RETRYABLE.has(aiResp.status)) { aiWarning = provider.name + " " + aiResp.status; break; }
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 300)));
        } catch (e) {
          clearTimeout(timeout);
          lastBody = e instanceof Error ? e.message : "error";
          const isTimeout = e instanceof Error && e.name === "AbortError";
          console.warn("[IA] " + provider.name + " intento " + (attempt + 1) + " error: " + lastBody + (isTimeout ? " (TIMEOUT)" : ""));
          if (isTimeout) { aiWarning = provider.name + " timeout"; break; }
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
      console.warn("[IA] " + provider.name + " agotado, siguiente proveedor...");
    }
    if (!succeeded && !aiWarning) {
      aiWarning = lastStatus === 429 ? "Rate limit" : lastStatus === 0 ? "Timeout" : "Error " + lastStatus;
    }

    // ── Mapeo IA -> DB ────────────────────────────────────────────────────
    // NOTA: Los campos manuales (ingresados por usuario) NUNCA deben ser sobrescritos por IA
    const manualFields = new Set(["kg_industria_manual", "kg_reciclado_malla_z1", "kg_reciclado_malla_z2", "kg_inventario_sin_alta", "kg_podrido_bolsa_basura"]);
    
    const mapping: Record<string, string> = {
      kg_produccion_total: "kg_produccion_calibrador",
      kg_mujeres_l: "kg_mujeres_calibrador",
      kg_podrido_calibrador: "kg_podrido_calibrador_auto",
      kg_palets_alta: "kg_palets_brutos",
      industria_manual: "kg_industria_manual",
      reciclado_z1: "kg_reciclado_malla_z1",
      reciclado_z2: "kg_reciclado_malla_z2",
      inventario_final: "kg_inventario_sin_alta",
      kg_podrido_manual: "kg_podrido_bolsa_basura",
    };
    
    console.log("[MAP] server values:", JSON.stringify(server));
    console.log("[MAP] aiData keys:", Object.keys(aiData));
    console.log("[MAP] aiData complete:", JSON.stringify(aiData).slice(0, 500));
    
    const update: Record<string, any> = {};
    for (const [specKey, dbKey] of Object.entries(mapping)) {
      const sv = Number(server[dbKey]) || 0;  // Valor de archivos
      const av = Number(aiData?.[specKey]) || 0;  // Valor de IA
      const currentUserValue = Number(current_values?.[dbKey]) || Number(parte[dbKey as keyof typeof parte]) || 0;  // Valor actual del usuario (del frontend o BD)
      const isManualField = manualFields.has(dbKey);
      
      let selectedValue = 0;
      let reason = "sin valor";
      
      // PROTEGER CAMPOS MANUALES: si el usuario ya ingresó valor, NO sobrescribir
      if (isManualField && currentUserValue > 0) {
        selectedValue = currentUserValue;
        reason = "PROTEGIDO (manual)";
      } else if (sv > 0) {
        // PRIORIDAD 1: Valor de archivos extraído
        selectedValue = sv;
        reason = "de ARCHIVOS";
      } else if (av > 0) {
        // PRIORIDAD 2: Valor de IA
        selectedValue = av;
        reason = "de IA";
      } else if (currentUserValue > 0) {
        // PRIORIDAD 3: Mantener valor anterior si existe
        selectedValue = currentUserValue;
        reason = "anterior";
      }
      
      // CRÍTICO: SIEMPRE actualizar todos los campos (incluso si son 0) para forzar que Supabase
      // registre el cambio en updated_at y updated_at sea consistente con los datos nuevos
      update[dbKey] = selectedValue;
      
      console.log("[MAP] " + specKey + " -> " + dbKey + ": sv=" + sv + ", av=" + av + ", user=" + currentUserValue + " => " + selectedValue + " (" + reason + ")");
    }
    console.log("[UPDATE] Update object (COMPLETO):", JSON.stringify(update));
    console.log("[UPDATE] fields que se actualizarán:", Object.keys(update).join(","));
    update.resumen_ia = { ...aiData, _server_side: server, _ai_warning: aiWarning };
    update.estado = "Analizado";

    const { error: upErr } = await admin.from("partes_diarios").update(update).eq("id", part_id);
    console.log("[UPDATE] result:", upErr ? "ERROR: " + upErr.message : "OK");
    if (upErr) return json({ error: "No se pudo actualizar: " + upErr.message }, 500);

    // ── Verificación: leer lo que se guardó ────────────────────────────────────
    const { data: verificacion } = await userClient.from("partes_diarios").select("kg_produccion_calibrador, kg_mujeres_calibrador, kg_palets_brutos, kg_podrido_calibrador_auto").eq("id", part_id).maybeSingle();
    console.log("[VERIFY] Datos guardados en BD:", JSON.stringify(verificacion));

    // ── Limpiar tablas de detalle previas (source=ia) ─────────────────────
    await Promise.all([
      admin.from("production_runs").delete().eq("part_id", part_id).eq("source", "ia"),
      admin.from("gstock_entries").delete().eq("part_id", part_id).eq("source", "ia"),
      admin.from("lotes_dia").delete().eq("part_id", part_id).eq("source", "ia"),
      admin.from("palets_dia").delete().eq("part_id", part_id).eq("source", "ia"),
      admin.from("producto_dia").delete().eq("part_id", part_id).eq("source", "ia"),
      admin.from("calibres_dia").delete().eq("part_id", part_id).eq("source", "ia"),
    ]);

    const uid = userData.user.id;

    // ── production_runs (legacy) ──────────────────────────────────────────
    if (Array.isArray(aiData.produccion)) {
      const rows = aiData.produccion.flatMap((r: any) =>
        Number(r?.kgproduced) > 0 ? [{
          part_id, user_id: uid, date: parte.date, source: "ia",
          product: r.product ?? null, size_range: r.sizerange ?? null, kg_produced: Number(r.kgproduced) || 0,
        }] : []
      );
      if (rows.length) await admin.from("production_runs").insert(rows);
    }

    // ── gstock_entries (legacy) ───────────────────────────────────────────
    if (Array.isArray(aiData.gstock)) {
      const rows = aiData.gstock.flatMap((r: any) =>
        Number(r?.kgexpected) > 0 ? [{
          part_id, user_id: uid, date: parte.date, source: "ia",
          product: r.product ?? null, size_range: r.sizerange ?? null, kg_expected: Number(r.kgexpected) || 0,
        }] : []
      );
      if (rows.length) await admin.from("gstock_entries").insert(rows);
    }

    // ── lotes_dia (detallado) ─────────────────────────────────────────────
    const lotesArr = Array.isArray(aiData.lotes_detalle) ? aiData.lotes_detalle
      : Array.isArray(aiData.lotes) ? aiData.lotes : [];
    if (lotesArr.length > 0) {
      const rows = lotesArr.map((r: any) => ({
        part_id, user_id: uid, source: "ia",
        lote_codigo:           r.lote_codigo ?? r.lotecodigo ?? null,
        productor:             r.productor ?? null,
        producto:              r.producto ?? null,
        kg_peso_total:         Number(r.kg_peso_total) || 0,
        toneladas_hora:        Number(r.toneladas_hora) || null,
        duracion_min:          Number(r.duracion_min) || null,
        peso_fruta_promedio_g: Number(r.peso_fruta_promedio_g) || null,
        hora_inicio:           r.hora_inicio ?? null,
      }));
      await admin.from("lotes_dia").insert(rows);
    }

    // ── palets_dia (detallado) ────────────────────────────────────────────
    if (Array.isArray(aiData.palets_detalle) && aiData.palets_detalle.length > 0) {
      const rows = aiData.palets_detalle.map((r: any) => ({
        part_id, user_id: uid, source: "ia",
        palet_id:   r.palet_id ?? null,
        producto:   r.producto ?? null,
        cliente:    r.cliente ?? null,
        destino:    r.destino ?? null,
        kg_neto:    Number(r.kg_neto) || 0,
        situacion:  r.situacion ?? null,
        n_cajas:    Number(r.n_cajas) || null,
      }));
      await admin.from("palets_dia").insert(rows);
    }

    // ── producto_dia (detallado) ──────────────────────────────────────────
    if (Array.isArray(aiData.producto_detalle) && aiData.producto_detalle.length > 0) {
      const rows = aiData.producto_detalle.map((r: any) => ({
        part_id, user_id: uid, source: "ia",
        linea:         r.linea ?? null,
        producto:      r.producto ?? null,
        formato_caja:  r.formato_caja ?? null,
        kg:            Number(r.kg) || 0,
        n_cajas:       Number(r.n_cajas) || null,
        grupo_destino: r.grupo_destino ?? null,
      }));
      await admin.from("producto_dia").insert(rows);
    }

    // ── calibres_dia (detallado) ──────────────────────────────────────────
    if (Array.isArray(aiData.calibres_detalle) && aiData.calibres_detalle.length > 0) {
      const rows = aiData.calibres_detalle.map((r: any) => ({
        part_id, user_id: uid, source: "ia",
        calibre:       r.calibre ?? "—",
        clase:         r.clase ?? null,
        kg:            Number(r.kg) || 0,
        piezas:        Number(r.piezas) || 0,
        pct:           Number(r.pct) || 0,
        grupo_destino: r.grupo_destino ?? null,
      }));
      await admin.from("calibres_dia").insert(rows);
    }

    return json({
      message: aiWarning ? "Server-side OK; IA: " + aiWarning : "OK: " + files.length + " archivo(s)",
      server_side: server, ai: aiData, ai_warning: aiWarning,
    });
  } catch (e) {
    console.error("analizar-parte", e);
    return json({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function repairXlsx(bytes: Uint8Array): Uint8Array {
  // 1. Strip any prefix before ZIP magic bytes (PK\x03\x04)
  let start = 0;
  for (let i = 0; i < Math.min(bytes.length - 4, 65536); i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      start = i;
      break;
    }
  }
  const buf = start === 0 ? new Uint8Array(bytes) : new Uint8Array(bytes.slice(start));

  // 2. Fix unsupported compression methods in ZIP local file headers.
  //    Some modern Excel files use compression method 9 (DEFLATE64) or have
  //    corrupted headers that cause NaN. The xlsx library only supports
  //    method 0 (STORE) and 8 (DEFLATE). Patch invalid methods to 8.
  let offset = 0;
  while (offset + 30 < buf.length) {
    // Check for local file header signature PK\x03\x04
    if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4b ||
        buf[offset + 2] !== 0x03 || buf[offset + 3] !== 0x04) break;

    const method = buf[offset + 8] | (buf[offset + 9] << 8);
    if (method !== 0 && method !== 8) {
      // Patch to DEFLATE (8)
      buf[offset + 8] = 8;
      buf[offset + 9] = 0;
    }

    const fnLen = buf[offset + 26] | (buf[offset + 27] << 8);
    const exLen = buf[offset + 28] | (buf[offset + 29] << 8);
    const cSize = buf[offset + 18] | (buf[offset + 19] << 8) |
                  (buf[offset + 20] << 16) | (buf[offset + 21] << 24);

    offset += 30 + fnLen + exLen + cSize;
  }

  // 3. Also patch Central Directory entries (PK\x01\x02)
  while (offset + 46 < buf.length) {
    if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4b ||
        buf[offset + 2] !== 0x01 || buf[offset + 3] !== 0x02) break;

    const method = buf[offset + 10] | (buf[offset + 11] << 8);
    if (method !== 0 && method !== 8) {
      buf[offset + 10] = 8;
      buf[offset + 11] = 0;
    }

    const fnLen = buf[offset + 28] | (buf[offset + 29] << 8);
    const exLen = buf[offset + 30] | (buf[offset + 31] << 8);
    const cmLen = buf[offset + 32] | (buf[offset + 33] << 8);
    offset += 46 + fnLen + exLen + cmLen;
  }

  return buf;
}

function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/\s/g, "");
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (hasComma) s = s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const isTotal = (row: any[]) => row.some((c) => /\b(sub)?total(es)?\b/i.test(String(c ?? "")));

function findCol(rows: any[][], predicates: ((s: string) => boolean)[]): { headerIdx: number; colIdx: number } | null {
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      if (predicates.some((p) => p(norm(r[j])))) return { headerIdx: i, colIdx: j };
    }
  }
  return null;
}

function extractNetos(rows: any[][]): number {
  // Búsqueda más flexible de columnas
  const hit = findCol(rows, [
    (s) => s === "netos" || s === "neto" || s === "kg netos" || s === "peso neto" ||
           s === "kgnetos" || s === "kgneto" || s === "neto(kg)" || s === "netos(kg)" ||
           s === "peso" && s.length === 4  // "peso" exacto
  ]);
  
  if (!hit) {
    console.warn("[EXTRACT] NO SE ENCONTRÓ COLUMNA 'NETOS'. Columnas disponibles en primeras 5 filas:");
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const r = rows[i] ?? [];
      console.warn("[EXTRACT] Fila " + i + ":", r.slice(0, 10).map(c => String(c ?? "")).join(" | "));
    }
    return 0;
  }
  
  console.log("[EXTRACT] Columna 'NETOS' encontrada en header row " + hit.headerIdx + ", col " + hit.colIdx);
  
  let sum = 0;
  let count = 0;
  for (let i = hit.headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (isTotal(r)) continue;
    const v = toNum(r[hit.colIdx]);
    if (v > 0) {
      sum += v;
      count++;
    }
  }
  
  console.log("[EXTRACT] NETOS: suma=" + sum + " (de " + count + " filas)");
  return sum;
}

function extractTamanos(rows: any[][]): { mujeres: number; podrido: number } {
  let mujeres = 0;
  let podrido = 0;
  let inMuj = false;
  let pesoCol = -1;
  let vals: number[] = [];

  const flush = () => {
    if (vals.length > 1) {
      const last = vals[vals.length - 1];
      const sumRest = vals.slice(0, -1).reduce((a, b) => a + b, 0);
      mujeres = Math.abs(last - sumRest) < 1 ? last : vals.reduce((a, b) => a + b, 0);
    }
    vals = [];
    pesoCol = -1;
    inMuj = false;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rv = r.map((c: any) => norm(c));

    if (rv.some((v: string) => v === "mujeres")) {
      if (inMuj) flush();
      inMuj = true; pesoCol = -1; vals = [];
      continue;
    }
    if (inMuj && rv.some((v: string) => v === "exportacion" || v === "no exportacion" || v === "no comercial")) flush();
    if (inMuj && pesoCol === -1) {
      for (let j = 0; j < r.length; j++) {
        const c = norm(r[j]);
        if (c === "peso (kg)" || c === "peso(kg)" || c === "peso kg") { pesoCol = j; break; }
      }
      continue;
    }
    if (inMuj && pesoCol >= 0) { const v = toNum(r[pesoCol]); if (v > 0) vals.push(v); }
    if (rv.some((v: string) => v === "podrido") && pesoCol >= 0) { const kg = toNum(r[pesoCol]); if (kg > 0) podrido = kg; }
  }
  if (inMuj) flush();
  return { mujeres, podrido };
}

function extractProduccionTotal(rows: any[][]): number {
  const peso = findCol(rows, [(s) => s === "peso(kg)" || s === "peso (kg)" || s === "peso kg"]);
  if (!peso) return 0;
  for (let i = peso.headerIdx + 1; i < rows.length; i++) {
    if (isTotal(rows[i] ?? [])) { const v = toNum(rows[i][peso.colIdx]); if (v > 0) return v; }
  }
  let last = 0;
  for (let i = peso.headerIdx + 1; i < rows.length; i++) { const v = toNum(rows[i]?.[peso.colIdx]); if (v > 0) last = v; }
  return last;
}
