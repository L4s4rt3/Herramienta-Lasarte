import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { unzipSync, zipSync, type AsyncZipOptions } from "https://esm.sh/fflate@0.8.2";

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

    const { part_id, current_values, vision_crops } = await req.json();
    if (!part_id || typeof part_id !== "string") {
      return json({ error: "part_id requerido" }, 400);
    }
    const visionWeightCrops = sanitizeVisionCrops(vision_crops);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OPENCODE_API_KEY = Deno.env.get("OPENCODE_API_KEY");
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY");
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const OPENROUTER_VISION_MODEL = Deno.env.get("OPENROUTER_VISION_MODEL") ?? "google/gemma-4-26b-a4b-it:free";
    if (!OPENCODE_API_KEY && !GROQ_API_KEY && !GEMINI_API_KEY && !DEEPSEEK_API_KEY && !NVIDIA_API_KEY && !OPENROUTER_API_KEY) {
      return json({ error: "Ninguna API key configurada (OPENCODE/GROQ/GEMINI/DEEPSEEK/NVIDIA/OPENROUTER)" }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    let uid: string;
    let userClient: ReturnType<typeof createClient>;
    // Try normal user auth; fall back to admin if service_role key
    userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      // Fallback: use admin client (service_role calls, testing, etc.)
      uid = "00000000-0000-0000-0000-000000000000";
      userClient = admin;
    } else {
      uid = userData.user.id;
    }

    const { data: parte, error: pErr } = await userClient
      .from("partes_diarios").select("*").eq("id", part_id).maybeSingle();
    if (pErr || !parte) return json({ error: "Parte no encontrado" }, 404);

    // Use the parte's actual user_id instead of dummy fallback (FK to auth.users)
    if (uid === "00000000-0000-0000-0000-000000000000" && parte.user_id) {
      uid = parte.user_id;
    }

    const { data: prev } = await userClient
      .from("partes_diarios")
      .select("kg_inventario_sin_alta, date")
      .eq("user_id", parte.user_id)
      .lt("date", parte.date)
      .order("date", { ascending: false })
      .limit(1).maybeSingle();
    if (prev) {
      const prevInv = Number(prev.kg_inventario_sin_alta) || 0;
      if (prevInv !== Number(parte.kg_inventario_anterior_sin_alta)) {
        await userClient.from("partes_diarios")
          .update({ kg_inventario_anterior_sin_alta: prevInv })
          .eq("id", part_id);
        parte.kg_inventario_anterior_sin_alta = prevInv;
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
      // Primero por NOMBRE (mas preciso)
      if (ft === "gstock" || /g[\s_-]?stock/i.test(name)) return "gstock";
      if (/tama[ñn]o|clase|calidad|producto|empaque|envase|packing|formato/i.test(name)) return "tamanos";
      if (/producci[oó]n/i.test(name) && !/producto|tamaño|tamano|clase|calidad|empaque|envase/i.test(name)) return "produccion";
      if (/palet/i.test(name)) return "palets";
      // Fallback por file_type (etiqueta del usuario)
      if (ft === "gstock") return "gstock";
      if (ft === "produccion") return "produccion";
      return "tamanos";
    };

    const server: Record<string, number> = {};
    const csvContexts: { name: string; kind: string; csv: string }[] = [];
    let serverLotes: any[] = [];
    let serverPalets: any[] = [];
    let serverCalibres: any[] = [];
    let serverProducto: any[] = [];
    // Fotos adjuntas (la hoja diaria de lotes anotada a mano): se mandan al
    // subagente de visión al final, cuando ya existen los lotes_dia del parte.
    const fotosLotes: Array<{ mime: string; b64: string }> = [];

    for (const f of files) {
      if (!f.file_path) continue;
      // Los "Informe LOTE" se procesan aparte con un parser determinista (analizar-lote-excel);
      // no tienen el formato que este bucle espera y no deben mezclarse con el análisis por IA.
      if (f.file_type === "InformeLote") continue;
      const mime = f.mime_type ?? "";
      const esImagen = mime.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.file_name ?? "");
      if (esImagen) {
        const { data: blob, error: dlErr } = await admin.storage.from("partes-archivos").download(f.file_path);
        if (dlErr || !blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length > 8_000_000) { console.warn("[FOTO] demasiado grande, se salta:", f.file_name); continue; }
        let bin = "";
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        fotosLotes.push({ mime: mime || "image/jpeg", b64: btoa(bin) });
        console.log("[FOTO] adjunta para visión:", f.file_name, bytes.length, "bytes");
        continue;
      }
      const isXlsx = /\.xlsx?$/i.test(f.file_name ?? "") || mime.includes("spreadsheet") || mime === "application/vnd.ms-excel";
      if (!isXlsx) continue;

      const { data: blob, error: dlErr } = await admin.storage.from("partes-archivos").download(f.file_path);
      if (dlErr || !blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const kind = classify(f);
      console.log("[CLASSIFY] file=" + (f.file_name ?? "") + " type=" + (f.file_type ?? "") + " kind=" + kind);

      try {
        // Primero convertir DEFLATE64 real, luego parchear bytes por si acaso
        let converted = deflate64ToDeflate(bytes);
        if (converted === bytes) converted = repairXlsx(bytes);
        const wb = XLSX.read(converted, { type: "array" });
        const rowsAll: any[][] = [];
        for (const sn of wb.SheetNames) {
          const ws = wb.Sheets[sn];
          rowsAll.push(...XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: null }));
        }

        if (kind === "gstock" || kind === "palets") {
          const v = extractNetos(rowsAll);
          if (v > 0 && (kind === "gstock" || !server.kg_palets_brutos)) server.kg_palets_brutos = v;
          const palets = extractPaletsDetalle(rowsAll);
          if (palets.length > 0) serverPalets = palets;
        } else if (kind === "tamanos") {
          const { mujeres, podrido } = extractTamanos(rowsAll);
          if (mujeres > 0) server.kg_mujeres_calibrador = mujeres;
          if (podrido > 0) server.kg_podrido_calibrador_auto = podrido;
          const calibres = extractCalibresDetalle(rowsAll);
          if (calibres.length > 0) serverCalibres = (serverCalibres.length > 0 ? serverCalibres : []).concat(calibres);
          const producto = extractProductoDetalle(rowsAll);
          if (producto.length > 0) serverProducto = (serverProducto.length > 0 ? serverProducto : []).concat(producto);
        } else if (kind === "produccion") {
          const v = extractProduccionTotal(rowsAll);
          if (v > 0) server.kg_produccion_calibrador = v;
          const lotes = extractLotesDetalle(rowsAll);
          if (lotes.length > 0) serverLotes = lotes;
        }

        const csv = rowsAll.map((r) => r.map((c) => (c == null ? "" : String(c))).join(",")).join("\n").slice(0, 1500);
        csvContexts.push({ name: f.file_name ?? "", kind, csv });
      } catch (e) { console.warn("xlsx parse fail", f.file_name, e); }
    }

    // ── Proveedores IA (compartido entre subagentes) ──────────────────────
    const providers = [
      ...(NVIDIA_API_KEY ? [{ name: "NVIDIA", url: "https://integrate.api.nvidia.com/v1/chat/completions", key: NVIDIA_API_KEY, model: "meta/llama-3.3-70b-instruct", jsonMode: true }] : []),
      ...(GEMINI_API_KEY ? [{ name: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: GEMINI_API_KEY, model: "gemini-2.0-flash", jsonMode: false }] : []),
      ...(OPENCODE_API_KEY ? [{ name: "OpenCode", url: "https://opencode.ai/zen/v1/chat/completions", key: OPENCODE_API_KEY, model: "ring-2.6-1t-free", jsonMode: true }] : []),
      ...(GROQ_API_KEY ? [{ name: "Groq", url: "https://api.groq.com/openai/v1/chat/completions", key: GROQ_API_KEY, model: "llama-3.3-70b-versatile", jsonMode: false }] : []),
      ...(DEEPSEEK_API_KEY ? [{ name: "DeepSeek", url: "https://api.deepseek.com/v1/chat/completions", key: DEEPSEEK_API_KEY, model: "deepseek-chat", jsonMode: true }] : []),
    ];
    const RETRYABLE = new Set([429, 500, 502, 503, 504]);

    // ── SUBAGENTES IA ─────────────────────────────────────────────────────
    // Cada tipo de archivo tiene su propio subagente con prompt especializado
    const dateStr = parte.date ?? "desconocida";

    // Agrupar CSVs por tipo
    const grouped: Record<string, { name: string; kind: string; csv: string }[]> = {};
    for (const ctx of csvContexts) {
      if (!grouped[ctx.kind]) grouped[ctx.kind] = [];
      grouped[ctx.kind].push(ctx);
    }

    interface SubAgentResult {
      kind: string;
      data: Record<string, any>;
      warning: string | null;
      success: boolean;
    }

    const agents = [
      {
        kind: "palets",
        label: "Palets / GSTOCK",
        files: [...(grouped["palets"] ?? []), ...(grouped["gstock"] ?? [])],
        jsonTemplate: '{"kg_palets_alta":0,"palets_detalle":[],"gstock":[]}',
        prompt: `Analista planta citrica Lasarte SAT. Extrae datos de archivo PALETS/GSTOCK.

REGLAS: Solo datos explicitos. Priorizar fila TOTAL. Cantidades en kg. No redondear. Dato inexistente=0. Sin texto adicional, SOLO JSON.

Campos:
- kg_palets_alta: suma "Netos"/"Peso" >0, excluir TOTALES.
- palets_detalle: array de {palet_id, producto, cliente, destino, kg_neto, situacion, n_cajas}
  Col: Palet/ID, Producto, Cliente, Destino, Netos/Peso, Sit, Cajas.
- gstock: array de {product, sizerange, kgexpected}

JSON: ${'{"kg_palets_alta":0,"palets_detalle":[],"gstock":[]}'}`,
        fallback: () => ({ kg_palets_alta: server.kg_palets_brutos || 0, palets_detalle: serverPalets, gstock: [] }),
      },
      {
        kind: "produccion",
        label: "Producción",
        files: grouped["produccion"] ?? [],
        jsonTemplate: '{"kg_produccion_total":0,"lotes_detalle":[],"produccion":[]}',
        prompt: `Analista planta citrica Lasarte SAT. Extrae datos de archivo PRODUCCION.

REGLAS: Solo datos explicitos. Priorizar fila TOTAL o ultimo valor. Cantidades en kg. No redondear. Dato inexistente=0. Sin texto adicional, SOLO JSON.

Campos:
- kg_produccion_total: "Peso kg" fila TOTAL o ultimo valor.
- lotes_detalle: array de {lote_codigo, productor, producto, kg_peso_total, toneladas_hora, duracion_min, peso_fruta_promedio_g, hora_inicio}
  Col: ID/Lote, Nombre Productor (NO el codigo), Variedad(Producto), Peso(kg), T/h, Duracion(min), PesoFruta(g), HoraInicio.
- produccion: array de {product, sizerange, kgproduced, destination}

JSON: ${'{"kg_produccion_total":0,"lotes_detalle":[],"produccion":[]}'}`,
        fallback: () => ({ kg_produccion_total: server.kg_produccion_calibrador || 0, lotes_detalle: serverLotes, produccion: [] }),
      },
      {
        kind: "tamanos",
        label: "Tamaños / Producto",
        files: grouped["tamanos"] ?? [],
        jsonTemplate: '{"kg_mujeres_l":0,"kg_podrido_calibrador":0,"producto_detalle":[],"calibres_detalle":[]}',
        prompt: `Analista planta citrica Lasarte SAT. Extrae datos de archivo TAMANOS / PRODUCTO.

REGLAS: Solo datos explicitos. Cantidades en kg. No redondear. Dato inexistente=0. Sin texto adicional, SOLO JSON.

Campos:
- kg_mujeres_l: suma "Peso kg" donde clase="L" o seccion="Mujeres".
- kg_podrido_calibrador: "Peso kg" fila Producto="PODRIDO" (excluir MUESTRA/PREC).
- calibres_detalle: array de {calibre, clase, kg, piezas, pct, grupo_destino}
  Col: Calibre, Clase(Exportacion/Mercado), Peso(kg), Piezas, %, Destino.
- producto_detalle: array de {linea, producto, formato_caja, kg, n_cajas, grupo_destino}
  Col: Linea, Producto, Formato/Caja, Peso(kg), Cajas, Destino/Grupo.

JSON: ${'{"kg_mujeres_l":0,"kg_podrido_calibrador":0,"calibres_detalle":[],"producto_detalle":[]}'}`,
        fallback: () => ({
          kg_mujeres_l: server.kg_mujeres_calibrador || 0,
          kg_podrido_calibrador: server.kg_podrido_calibrador_auto || 0,
          calibres_detalle: serverCalibres,
          producto_detalle: serverProducto,
        }),
      },
    ];

    // ── Procesar cada subagente ───────────────────────────────────────────
    const aiData: any = {};
    let aiWarning: string | null = null;
    let subagentSuccessCount = 0;
    const subagentErrors: string[] = [];

    for (const agent of agents) {
      if (agent.files.length === 0) {
        // Sin archivos de este tipo, usar fallback server-side
        Object.assign(aiData, agent.fallback());
        console.log("[SUBAGENT] " + agent.kind + ": sin archivos, fallback server-side");
        continue;
      }

      // Construir mensaje de usuario solo con CSVs de este tipo
      let userMsg = `Parte ${dateStr}. Archivos ${agent.label}:\n`;
      for (const c of agent.files) userMsg += "- " + c.name + "\n";
      for (const c of agent.files) userMsg += "\n--- [" + c.kind + "] " + c.name + " ---\n" + c.csv;
      const finalUserMsg = userMsg.slice(0, 8000);

      // Llamar IA para este subagente
      const result = await callAIForSubagent(
        agent.label, agent.prompt, finalUserMsg,
        providers, RETRYABLE,
      );

      if (result.success) {
        // Fusionar IA + server-side: server-side tiene prioridad en arrays detallados
        const merged = { ...result.data };
        if (agent.kind === "produccion") {
          console.log("[SUBAGENT] produccion: serverLotes=" + serverLotes.length + " AI lotes=" + (result.data.lotes_detalle?.length ?? 0));
          if (serverLotes.length > 0) {
            // Merge: serverLotes as base, fill missing fields from AI data
            const aiLotes = Array.isArray(result.data.lotes_detalle) ? result.data.lotes_detalle : [];
            if (aiLotes.length > 0) {
              merged.lotes_detalle = serverLotes.map((sl: any) => {
                // Find matching AI lote by lote_codigo or productor+producto
                const match = aiLotes.find((al: any) =>
                  (al.lote_codigo && al.lote_codigo === sl.lote_codigo) ||
                  (al.productor === sl.productor && al.producto === sl.producto)
                );
                if (!match) return sl;
                return {
                  ...match,  // AI data as base (has more fields)
                  lote_codigo: sl.lote_codigo ?? match.lote_codigo,
                  productor: sl.productor ?? match.productor,
                  producto: sl.producto ?? match.producto,
                  kg_peso_total: sl.kg_peso_total || match.kg_peso_total,
                  toneladas_hora: sl.toneladas_hora ?? match.toneladas_hora,
                  duracion_min: sl.duracion_min ?? match.duracion_min,
                  peso_fruta_promedio_g: sl.peso_fruta_promedio_g ?? match.peso_fruta_promedio_g,
                  // La hora del servidor manda: la IA confundía la "Hora de
                  // la Máquina" (duración) con la hora de inicio.
                  hora_inicio: sl.hora_inicio ?? match.hora_inicio ?? null,
                };
              });
            } else {
              merged.lotes_detalle = serverLotes;
            }
            console.log("[SUBAGENT] produccion: usando serverLotes (prio 1)");
          }
          if (server.kg_produccion_calibrador) merged.kg_produccion_total = server.kg_produccion_calibrador;
        } else if (agent.kind === "palets") {
          console.log("[SUBAGENT] palets: serverPalets=" + serverPalets.length + " AI palets=" + (result.data.palets_detalle?.length ?? 0));
          if (serverPalets.length > 0) {
            merged.palets_detalle = serverPalets;
            console.log("[SUBAGENT] palets: usando serverPalets (prio 1)");
          }
          if (server.kg_palets_brutos) merged.kg_palets_alta = server.kg_palets_brutos;
        } else if (agent.kind === "tamanos") {
          console.log("[SUBAGENT] tamanos: serverCalibres=" + serverCalibres.length + " AI calibres=" + (result.data.calibres_detalle?.length ?? 0) + " serverProducto=" + serverProducto.length + " AI producto=" + (result.data.producto_detalle?.length ?? 0));
          if (serverCalibres.length > 0) {
            merged.calibres_detalle = serverCalibres;
            console.log("[SUBAGENT] tamanos: usando serverCalibres (prio 1)");
          }
          if (serverProducto.length > 0) {
            merged.producto_detalle = serverProducto;
            console.log("[SUBAGENT] tamanos: usando serverProducto (prio 1)");
          }
          if (server.kg_mujeres_calibrador) merged.kg_mujeres_l = server.kg_mujeres_calibrador;
          if (server.kg_podrido_calibrador_auto) merged.kg_podrido_calibrador = server.kg_podrido_calibrador_auto;
        }
        Object.assign(aiData, merged);
        subagentSuccessCount++;
        console.log("[SUBAGENT] " + agent.kind + " OK, keys:", Object.keys(merged).join(",") + " lotes_sample=" + JSON.stringify(merged.lotes_detalle?.slice(0, 2)));
      } else {
        // Fallback server-side para este subagente
        const fb = agent.fallback();
        Object.assign(aiData, fb);
        if (result.warning) subagentErrors.push(agent.kind + ": " + result.warning);
        console.log("[SUBAGENT] " + agent.kind + " fallback server-side, warning:", result.warning);
      }
    }

    if (subagentSuccessCount === 0 && subagentErrors.length > 0) {
      aiWarning = subagentErrors.join("; ");
    } else if (subagentErrors.length > 0) {
      aiWarning = "Algunos subagentes usaron fallback: " + subagentErrors.join("; ");
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

    // Calcular kg_palets_egipto y kg_palets_campo desde serverPalets
    const kgEgipto = (serverPalets as any[])
      .filter((p: any) => p.es_egipto)
      .reduce((s: number, p: any) => s + (Number(p.kg_neto) || 0), 0);
    if (kgEgipto > 0) update.kg_palets_egipto = kgEgipto;
    const kgCampo = (serverPalets as any[])
      .filter((p: any) => p.es_campo)
      .reduce((s: number, p: any) => s + (Number(p.kg_neto) || 0), 0);
    if (kgCampo > 0) update.kg_palets_campo = kgCampo;
    
    // Construir resumen_ia: aiData (con fallbacks) + metadata server-side
    update.resumen_ia = { ...aiData, _server_side: server, _ai_warning: aiWarning };
    for (const arr of ["produccion","gstock","lotes_detalle","palets_detalle","producto_detalle","calibres_detalle"]) {
      if (!Array.isArray(update.resumen_ia[arr])) update.resumen_ia[arr] = [];
    }
    console.log("[IA] resumen_ia keys:", Object.keys(update.resumen_ia).join(",") + " serverLotes=" + serverLotes.length + " serverPalets=" + serverPalets.length);
    console.log("[IA] lotes_detalle sample:", JSON.stringify(update.resumen_ia.lotes_detalle?.slice(0, 3)));
    update.estado = "Analizado";

    const { error: upErr } = await admin.from("partes_diarios").update(update).eq("id", part_id);
    console.log("[UPDATE] result:", upErr ? "ERROR: " + upErr.message : "OK");
    if (upErr) return json({ error: "No se pudo actualizar: " + upErr.message }, 500);

    // ── Verificación: leer lo que se guardó ────────────────────────────────────
    const { data: verificacion } = await userClient.from("partes_diarios").select("kg_produccion_calibrador, kg_mujeres_calibrador, kg_palets_brutos, kg_podrido_calibrador_auto").eq("id", part_id).maybeSingle();
    console.log("[VERIFY] Datos guardados en BD:", JSON.stringify(verificacion));

    const hasIaData = Object.keys(aiData).length > 0 && (Array.isArray(aiData.produccion) || Array.isArray(aiData.gstock) || Array.isArray(aiData.lotes_detalle) || Array.isArray(aiData.palets_detalle) || Array.isArray(aiData.producto_detalle) || Array.isArray(aiData.calibres_detalle)) && (aiData.produccion?.length || aiData.gstock?.length || aiData.lotes_detalle?.length || aiData.palets_detalle?.length || aiData.producto_detalle?.length || aiData.calibres_detalle?.length);
    
    // ── Preservar datos manuales por lote entre re-análisis ───────────────
    // El operario escribe notas y kg_industria sobre lotes creados por IA;
    // como el re-análisis borra y reinserta esos lotes, se rescatan antes
    // (por lote_codigo) y se reaplican al insertar.
    const manualPorLote = new Map<string, { notas: string | null; kg_industria: number; kg_precalibrado_z1: number; kg_precalibrado_z2: number }>();
    if (hasIaData) {
      const { data: prevLotes } = await admin
        .from("lotes_dia")
        .select("lote_codigo, notas, kg_industria, kg_precalibrado_z1, kg_precalibrado_z2")
        .eq("part_id", part_id);
      for (const l of prevLotes ?? []) {
        if (!l.lote_codigo) continue;
        const notas = typeof l.notas === "string" && l.notas.trim() ? l.notas : null;
        const kgIndustria = Number(l.kg_industria) || 0;
        const kgPrec1 = Number(l.kg_precalibrado_z1) || 0;
        const kgPrec2 = Number(l.kg_precalibrado_z2) || 0;
        if (notas || kgIndustria > 0 || kgPrec1 > 0 || kgPrec2 > 0) {
          manualPorLote.set(String(l.lote_codigo), { notas, kg_industria: kgIndustria, kg_precalibrado_z1: kgPrec1, kg_precalibrado_z2: kgPrec2 });
        }
      }
    }

    // ── Limpiar tablas de detalle previas (solo si hay datos IA nuevos) ───
    if (hasIaData) {
      await Promise.all([
        admin.from("production_runs").delete().eq("part_id", part_id).eq("source", "ia"),
        admin.from("gstock_entries").delete().eq("part_id", part_id).eq("source", "ia"),
        admin.from("lotes_dia").delete().eq("part_id", part_id).eq("source", "ia"),
        admin.from("palets_dia").delete().eq("part_id", part_id).eq("source", "ia"),
        admin.from("producto_dia").delete().eq("part_id", part_id).eq("source", "ia"),
        admin.from("calibres_dia").delete().eq("part_id", part_id).eq("source", "ia"),
      ]);
    }
    console.log("[CLEAN] hasIaData=" + hasIaData + " aiKeys=" + Object.keys(aiData).join(","));

    // uid already declared above

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
      const rows = lotesArr.map((r: any) => {
        const loteCodigo = r.lote_codigo ?? r.lotecodigo ?? null;
        const manual = loteCodigo ? manualPorLote.get(String(loteCodigo)) : undefined;
        return {
          part_id, user_id: uid, source: "ia",
          lote_codigo:           loteCodigo,
          productor:             r.productor ?? null,
          producto:              r.producto ?? null,
          kg_peso_total:         Number(r.kg_peso_total) || 0,
          toneladas_hora:        Number(r.toneladas_hora) || null,
          duracion_min:          Number(r.duracion_min) || null,
          peso_fruta_promedio_g: Number(r.peso_fruta_promedio_g) || null,
          hora_inicio:           r.hora_inicio ?? null,
          notas:                 manual?.notas ?? null,
          kg_industria:          manual?.kg_industria ?? 0,
          kg_precalibrado_z1:    manual?.kg_precalibrado_z1 ?? null,
          kg_precalibrado_z2:    manual?.kg_precalibrado_z2 ?? null,
        };
      });
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
        // Canónico AAMMDDNN (lo trae extractPaletsDetalle desde la columna
        // "Lote" del programa de palets): enlaza el palet con su lote de
        // confección en Trazabilidad sin depender del backfill del histórico.
        lote_codigo: r.lote_codigo ?? null,
        egipto:     r.es_egipto === true,
        campo:      r.es_campo === true,
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

    // ── Reenlazar Informes por lote (lote_clasificacion) con los lotes_dia recién insertados ──
    // El emparejamiento inicial se intenta al subir el Informe LOTE, pero cada análisis borra y
    // reinserta lotes_dia con IDs nuevos, dejando el enlace obsoleto. Se repara aquí.
    const { data: clasifSinLink } = await admin
      .from("lote_clasificacion")
      .select("lote_codigo")
      .eq("part_id", part_id)
      .is("lote_dia_id", null);
    if (clasifSinLink && clasifSinLink.length > 0) {
      const { data: lotesActuales } = await admin.from("lotes_dia").select("id, lote_codigo").eq("part_id", part_id);
      const codigosPendientes = Array.from(new Set(clasifSinLink.map((c) => c.lote_codigo)));
      for (const codigo of codigosPendientes) {
        const rawNorm = codigo.trim().toLowerCase();
        const baseNorm = (codigo.match(/^(\d+)/)?.[1] ?? "").toLowerCase();
        let matched = (lotesActuales ?? []).find((l) => (l.lote_codigo ?? "").trim().toLowerCase() === rawNorm) ?? null;
        if (!matched && baseNorm) matched = (lotesActuales ?? []).find((l) => (l.lote_codigo ?? "").trim().toLowerCase() === baseNorm) ?? null;
        if (!matched && baseNorm) matched = (lotesActuales ?? []).find((l) => (l.lote_codigo ?? "").trim().toLowerCase().startsWith(baseNorm)) ?? null;
        if (matched) {
          await admin.from("lote_clasificacion").update({ lote_dia_id: matched.id }).eq("part_id", part_id).eq("lote_codigo", codigo);
        }
      }
    }

    // ── Foto diaria de lotes (visión): comentarios, kg industria, P1/P2,
    // boxes echados y lotes juntados anotados a mano → campos manuales de
    // lotes_dia. Va al FINAL, con los lotes del parte ya insertados. La nota
    // de la foto SUSTITUYE la lectura anterior para que un reanálisis no la
    // concatene ni la duplique; los kg solo se actualizan si trae valor > 0.
    let fotoResumen: {
      imagenes: number;
      extraidos: number;
      aplicados: number;
      no_emparejados: string[];
      dudas: string[];
      fecha_detectada: string | null;
      modelo: string | null;
      modelo_pesos: string | null;
      recortes_pesos: number;
      pesos_extraidos: number;
      warning: string | null;
    } | null = null;
    if (fotosLotes.length > 0) {
      const unavailable = { data: {}, success: false, model: null, warning: "OPENROUTER_API_KEY no configurada" };
      const [vision, weightVision] = await Promise.all([
        OPENROUTER_API_KEY
          ? callVisionFotoLotes(fotosLotes, OPENROUTER_API_KEY, OPENROUTER_VISION_MODEL, String(parte.date ?? ""), "full")
          : Promise.resolve(unavailable),
        OPENROUTER_API_KEY && visionWeightCrops.length > 0
          ? callVisionFotoLotes(visionWeightCrops, OPENROUTER_API_KEY, OPENROUTER_VISION_MODEL, String(parte.date ?? ""), "weights")
          : Promise.resolve({ data: {}, success: false, model: null, warning: null }),
      ]);
      const fechaEsperada = normalizeVisionDate(parte.date);
      const fechaDetectada = normalizeVisionDate(vision.data?.fecha_produccion);
      const fechaNoCoincide = Boolean(fechaEsperada && fechaDetectada && fechaEsperada !== fechaDetectada);
      const fullItems = Array.isArray(vision.data?.lotes_foto) ? vision.data.lotes_foto : [];
      const weightItems = Array.isArray(weightVision.data?.lotes_pesos) ? weightVision.data.lotes_pesos : [];
      const itemsExtraidos = mergeVisionLotWeights(fullItems, weightItems, visionWeightCrops.length > 0);
      const items = fechaNoCoincide ? [] : itemsExtraidos;
      let aplicados = 0;
      const noEmparejados: string[] = [];
      const dudasLectura: string[] = [];
      if (items.length > 0) {
        const { data: lotesRows } = await admin
          .from("lotes_dia")
          .select("id, lote_codigo, productor, notas, kg_industria, kg_precalibrado_z1, kg_precalibrado_z2")
          .eq("part_id", part_id);
        const norm8 = (s: unknown) => String(s ?? "").match(/\d{8}/)?.[0] ?? null;
        const normTxt = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
        for (const item of items) {
          const code = norm8(item.lote_codigo);
          const dudasItem = Array.isArray(item.dudas)
            ? item.dudas.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
            : [];
          for (const duda of dudasItem) dudasLectura.push(`${code ?? "lote sin identificar"}: ${duda}`);
          let row = code ? (lotesRows ?? []).find((l: any) => norm8(l.lote_codigo) === code) : undefined;
          if (!row) {
            const p = normTxt(item.productor);
            if (p) {
              const cands = (lotesRows ?? []).filter((l: any) => normTxt(l.productor).includes(p) || p.includes(normTxt(l.productor)));
              if (cands.length === 1) row = cands[0]; // solo si es inequívoco
            }
          }
          if (!row) {
            noEmparejados.push(code ?? (String(item.productor ?? "").trim() || "sin identificar"));
            continue;
          }
          const patch: Record<string, unknown> = {};
          const kgInd = parseVisionKg(item.kg_industria);
          const kgP1 = parseVisionKg(item.kg_prec1);
          const kgP2 = parseVisionKg(item.kg_prec2);
          if (kgInd > 0) patch.kg_industria = kgInd;
          if (kgP1 > 0) patch.kg_precalibrado_z1 = kgP1;
          if (kgP2 > 0) patch.kg_precalibrado_z2 = kgP2;
          const trozos: string[] = [];
          const comentario = String(item.comentario ?? "").trim();
          if (comentario) trozos.push(comentario);
          const incidencias = Array.isArray(item.incidencias)
            ? item.incidencias.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
            : [];
          for (const incidencia of incidencias) trozos.push(`Incidencia: ${incidencia}`);
          const movimientos = Array.isArray(item.movimientos_box) ? item.movimientos_box : [];
          for (const movimiento of movimientos) {
            const textoOriginal = String(movimiento?.texto_original ?? "").trim();
            if (textoOriginal) {
              trozos.push(`Box: ${textoOriginal}`);
              continue;
            }
            const boxes = parseVisionKg(movimiento?.boxes);
            const destino = visionBoxDestination(movimiento?.destino);
            const kgTotal = parseVisionKg(movimiento?.kg_total);
            const pesoPorBox = parseVisionDecimal(movimiento?.peso_por_box_kg);
            const categoria = String(movimiento?.categoria ?? "").trim();
            const partesMovimiento = [
              boxes > 0 ? `${boxes} box` : "Movimiento de box",
              destino ? `a ${destino}` : "",
              kgTotal > 0 ? `(${kgTotal} kg totales)` : "",
              pesoPorBox > 0 ? `(${formatVisionNumber(pesoPorBox)} kg/box)` : "",
              categoria ? `[${categoria}]` : "",
            ].filter(Boolean);
            trozos.push(partesMovimiento.join(" "));
          }
          // Compatibilidad con respuestas del esquema anterior. Solo se usa
          // cuando el modelo no ha devuelto movimientos con destino.
          const boxes = parseVisionKg(item.boxes_echados);
          if (movimientos.length === 0 && boxes > 0) trozos.push(`Se echaron ${boxes} box (destino no identificado)`);
          const juntado = String(item.juntado_con ?? "").trim();
          if (juntado) trozos.push(`JUNTADO CON ${juntado}`);
          if (trozos.length > 0) {
            const notaFoto = Array.from(new Set(trozos.map((t) => t.trim()).filter(Boolean))).join(" · ");
            patch.notas = notaFoto;
          }
          if (Object.keys(patch).length === 0) continue;
          await admin.from("lotes_dia").update(patch).eq("id", (row as any).id);
          aplicados += 1;
        }
      }
      fotoResumen = {
        imagenes: fotosLotes.length,
        extraidos: itemsExtraidos.length,
        aplicados,
        no_emparejados: noEmparejados,
        dudas: dudasLectura,
        fecha_detectada: fechaDetectada,
        modelo: vision.model,
        modelo_pesos: weightVision.model,
        recortes_pesos: visionWeightCrops.length,
        pesos_extraidos: weightItems.length,
        warning: fechaNoCoincide
          ? `La fecha de la foto (${fechaDetectada}) no coincide con la del parte (${fechaEsperada}); no se aplicaron datos`
          : [
              vision.warning,
              visionWeightCrops.length > 0 ? weightVision.warning : null,
              vision.success && items.length === 0 ? "La foto no produjo ningún lote legible" : null,
            ].filter(Boolean).join(" | ") || null,
      };
      update.resumen_ia._foto_lotes = fotoResumen;
      const { error: fotoMetaErr } = await admin
        .from("partes_diarios")
        .update({ resumen_ia: update.resumen_ia })
        .eq("id", part_id);
      if (fotoMetaErr) console.warn("[FOTO] no se pudo guardar el resumen:", fotoMetaErr.message);
      console.log(`[FOTO] lotes actualizados desde la foto: ${fotoResumen.aplicados}/${fotoResumen.extraidos}; modelo=${fotoResumen.modelo ?? "ninguno"}`);
    }

    return json({
      message: aiWarning ? "Server-side OK; IA: " + aiWarning : "OK: " + files.length + " archivo(s)",
      parte_actualizado: true,
      datos_guardados: Object.keys(update).length,
      detalles_insertados: {
        lotes: serverLotes.length,
        palets: Array.isArray(aiData.palets_detalle) ? aiData.palets_detalle.length : serverPalets.length,
        campo: (serverPalets as any[]).filter((p: any) => p.es_campo).length,
        ...(fotoResumen ? { foto_lotes: fotoResumen } : {}),
      },
      server_side: server,
      ai: aiData,
      ai_warning: aiWarning,
      vision_warning: fotoResumen?.warning ?? null,
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

/**
 * Convierte ZIP con DEFLATE64 (method 9) a DEFLATE (method 8) usando fflate.
 * fflate soporta descompresion DEFLATE64 real (no solo parcheo de byte).
 */
function deflate64ToDeflate(bytes: Uint8Array): Uint8Array {
  try {
    const unzipped = unzipSync(bytes);
    return zipSync(unzipped, { level: 6 });
  } catch (e) {
    console.warn("[DEFLATE64] fflate fallo, usando original:", (e as Error).message?.slice(0, 100));
    return bytes;
  }
}

function repairXlsx(bytes: Uint8Array): Uint8Array {
  // v3: byte-by-byte ZIP header scanning - fixes DEFLATE64 (method 9) files
  // Some Excel files use compression method 9 which xlsx library doesn't support.
  // We patch method 9 to method 8 (DEFLATE) in both local headers and central directory.
  const MAGIC_PK03 = 0x50; const MAGIC_PK04 = 0x4b;
  // 1. Strip any prefix before ZIP magic bytes (PK\x03\x04)
  let start = 0;
  for (let i = 0; i < Math.min(bytes.length - 4, 65536); i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      start = i;
      break;
    }
  }
  const buf = start === 0 ? new Uint8Array(bytes) : new Uint8Array(bytes.slice(start));

  // 2. Patch ALL local file headers: scan byte-by-byte for PK\x03\x04
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method = buf[i + 8] | (buf[i + 9] << 8);
      if (method !== 0 && method !== 8) {
        buf[i + 8] = 8;
        buf[i + 9] = 0;
      }
      // Skip past this header + filename + extra fields (don't trust cSize)
      const fnLen = buf[i + 26] | (buf[i + 27] << 8);
      const exLen = buf[i + 28] | (buf[i + 29] << 8);
      i += 30 + fnLen + exLen - 1; // -1 porque el for hace i++
    }
  }

  // 3. Patch Central Directory entries (PK\x01\x02): scan byte-by-byte
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
  const sampleValues: string[] = [];
  for (let i = hit.headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (isTotal(r)) continue;
    const raw = r[hit.colIdx];
    const v = toNum(raw);
    if (sampleValues.length < 5) sampleValues.push(String(raw ?? "") + "->" + v);
    if (v > 0) {
      sum += v;
      count++;
    }
  }
  
  console.log("[EXTRACT] NETOS: suma=" + sum + " (de " + count + " filas), muestras: " + sampleValues.join(", "));
  return sum;
}

function extractTamanos(rows: any[][]): { mujeres: number; podrido: number } {
  let mujeres = 0;
  let podrido = 0;
  let inMuj = false;
  let pesoCol = -1;
  let vals: number[] = [];
  let foundMujeres = false;
  let foundPodrido = false;

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

  // Buscar columna "Peso(kg)" globalmente para tablas planas sin sección Mujeres
  let pesoColGlobal = -1;
  for (let i = 0; i < Math.min(rows.length, 100); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const c = norm(r[j]);
      if (c === "peso (kg)" || c === "peso(kg)" || c === "peso kg") { pesoColGlobal = j; break; }
    }
    if (pesoColGlobal >= 0) break;
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rv = r.map((c: any) => norm(c));

    if (rv.some((v: string) => v === "podrido")) {
      foundPodrido = true;
      const col = pesoCol >= 0 ? pesoCol : pesoColGlobal;
      if (col >= 0) { const kg = toNum(r[col]); if (kg > 0) podrido = kg; }
      continue;
    }

    if (rv.some((v: string) => v === "mujeres")) {
      if (inMuj) flush();
      foundMujeres = true;
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
  }
  if (inMuj) flush();
  
  console.log("[TAMANOS] pesoColGlobal=" + pesoColGlobal + " encontroMujeres=" + foundMujeres + " encontroPodrido=" + foundPodrido + " -> mujeres=" + mujeres + " podrido=" + podrido);
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

// "Tiempo de Inicio" a "HH:MM:SS". Las hojas se leen SIN cellDates, así que
// un datetime llega como serial de Excel (número, la fracción es la hora);
// se toleran también Date y texto con hora por robustez.
function horaInicioDesdeCelda(value: unknown): string | null {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (typeof value === "number" && isFinite(value) && value > 0) {
    const frac = value % 1;
    const totalSeg = Math.round(frac * 24 * 60 * 60);
    return `${pad2(Math.floor(totalSeg / 3600) % 24)}:${pad2(Math.floor(totalSeg / 60) % 60)}:${pad2(totalSeg % 60)}`;
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;
  }
  const m = String(value ?? "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${pad2(Number(m[1]))}:${m[2]}:${m[3] ?? "00"}`;
}

function extractLotesDetalle(rows: any[][]): any[] {
  // Buscar columnas en las primeras 50 filas
  let pesoCol = -1, nombreProdCol = -1, codigoProdCol = -1, loteCol = -1, tphCol = -1, variedadCol = -1, pesoFrutaCol = -1, duracionCol = -1, inicioCol = -1;
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const c = norm(r[j]);
      const raw = String(r[j] ?? "");
      if (/^peso(k?g)?(\s*\(kg\))?$/.test(c) || c === "peso") pesoCol = j;
      // "Nombre Productor" o "Nombre del Productor" → nombre
      if (/nombre/.test(c) && /productor/.test(c)) nombreProdCol = j;
      // "Código Productor" o "Codigo Productor" → codigo
      if (/^(codigo|código)/.test(c) && /productor/.test(c)) codigoProdCol = j;
      // "Productor" solo (sin nombre/codigo) → asumir nombre
      if (c === "productor") { nombreProdCol = j; }
      if (/^(id|lote)/.test(c) && !/productor/i.test(raw)) loteCol = j;
      if (/^t\/?h$|^toneladas/.test(c)) tphCol = j;
      if (/^(variedad|producto)/.test(c) && !/productor/i.test(raw)) variedadCol = j;
      if (/peso.*fruta.*promedio|peso.*fruta|peso.*pieza|peso.*medio.*fruta|peso.*promedio.*fruta/.test(c)) {
        console.log("[EXTRACT] pesoFrutaCol found at col " + j + ": raw=" + raw + " norm=" + c);
        pesoFrutaCol = j;
      }
      // "Tiempo de Inicio" es la HORA de arranque del volcado, no una
      // duración: hasta jul-2026 caía en duracionCol (por el `tiempo` suelto
      // del regex) y la IA acababa metiendo la "Hora de la Máquina" como
      // hora_inicio. Se detecta aparte y se excluye de la duración.
      if (/inicio/.test(c) && /tiempo|hora/.test(c)) {
        console.log("[EXTRACT] inicioCol found at col " + j + ": raw=" + raw + " norm=" + c);
        inicioCol = j;
      }
      if (/hora.*maquina|tiempo.*maquina|duracion|tiempo|hora.*calibrador|machine.*time/.test(c) && !/inicio/.test(c)) {
        console.log("[EXTRACT] duracionCol found at col " + j + ": raw=" + raw + " norm=" + c);
        duracionCol = j;
      }
    }
  }
  if (pesoCol < 0) return [];
  console.log("[EXTRACT] pesoCol=" + pesoCol + " pesoFrutaCol=" + pesoFrutaCol + " tphCol=" + tphCol + " duracionCol=" + duracionCol + " inicioCol=" + inicioCol);
  
  const lotes: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (isTotal(r)) continue;
    const kg = toNum(r[pesoCol]);
    if (kg <= 0) continue;
    
    const nombreProd = nombreProdCol >= 0 ? String(r[nombreProdCol] ?? "").trim() : "";
    const codigoProd = codigoProdCol >= 0 ? String(r[codigoProdCol] ?? "").trim() : "";
    const lote = loteCol >= 0 ? String(r[loteCol] ?? "").trim() : "";
    const variedad = variedadCol >= 0 ? String(r[variedadCol] ?? "").trim() : "";
    
    const productor = nombreProd || codigoProd || "";
    const fallbackLote = lote || (r[0] != null ? String(r[0]).trim() : "");
    const fallbackProductor = productor || (r[1] != null ? String(r[1]).trim() : "");
    const fallbackVariedad = variedad || (r[2] != null ? String(r[2]).trim() : "");
    
    // Skip rows where productor looks like a bare number (total row misparse)
    if (/^\d{1,3}$/.test(fallbackProductor) && /^\d{1,3}$/.test(fallbackVariedad) && /^\d{1,3}$/.test(fallbackLote)) continue;
    
    // Parse duracion: could be "HH:MM:SS" string or numeric minutes
    let duracionMin: number | null = null;
    if (duracionCol >= 0) {
      const raw = r[duracionCol];
      if (raw != null) {
        const rawStr = String(raw).trim();
        // Try HH:MM:SS or HH:MM
        const timeMatch = rawStr.match(/^(\d+):(\d+)(?::(\d+))?$/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1], 10) || 0;
          const m = parseInt(timeMatch[2], 10) || 0;
          const s = parseInt(timeMatch[3], 10) || 0;
          duracionMin = h * 60 + m + (s > 0 ? Math.round(s / 60) : 0);
        } else {
          // Try as number (minutes)
          const numVal = toNum(raw);
          if (numVal > 0) duracionMin = numVal;
        }
      }
    }
    
    lotes.push({
      lote_codigo: fallbackLote || null,
      codigo_productor: codigoProd || null,
      productor: fallbackProductor || "—",
      producto: fallbackVariedad || "—",
      kg_peso_total: kg,
      toneladas_hora: tphCol >= 0 ? (toNum(r[tphCol]) || null) : null,
      duracion_min: duracionMin,
      peso_fruta_promedio_g: pesoFrutaCol >= 0 ? (toNum(r[pesoFrutaCol]) || null) : null,
      hora_inicio: inicioCol >= 0 ? horaInicioDesdeCelda(r[inicioCol]) : null,
    });
  }
  if (lotes.length > 0) {
    console.log("[EXTRACT] lotes found=" + lotes.length + " first peso_fruta=" + lotes[0].peso_fruta_promedio_g);
  }
  return lotes;
}

// Lote del programa de palets ("NN+AAMMDD", p. ej. "02260710" = lote 02 del
// 10/07/26) al canónico AAMMDD+NN ("26071002") que usa el resto de la app.
// Réplica de convertirLotePaletACanonico (src/lib/historicoPalets.ts): Deno
// no puede importar de src/lib. Cualquier cosa que no sean 8 dígitos → null.
function lotePaletACanonico(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(2)}${text.slice(0, 2)}`;
}

function extractPaletsDetalle(rows: any[][]): any[] {
  let netoCol = -1, clienteCol = -1, paletCol = -1, productoCol = -1, loteCol = -1, cajasCol = -1;
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const c = norm(r[j]);
      // Solo letras/dígitos para la columna del nº de palet: la cabecera real
      // del programa es "NºPalet" (el "º" no es diacrítico y norm() no lo
      // quita — hasta jul-2026 esta columna NO se reconocía y ~12.000 palets
      // quedaron con palet_id NULL, imposibles de casar con el histórico).
      const compacto = c.replace(/[^a-z0-9]/g, "");
      if (c === "netos" || c === "neto" || c === "kg netos" || c === "peso neto" || c === "kgnetos" || c === "peso") netoCol = j;
      if (c === "cliente") clienteCol = j;
      if (c === "palet" || c === "id" || c === "palet_id" || compacto === "npalet" || compacto === "nopalet" || compacto === "numpalet" || compacto === "numeropalet") paletCol = j;
      if (c === "producto" || c === "variedad" || c === "denominacion_producto" || c === "denominacion producto" || c === "denominacion" || c === "denominación") productoCol = j;
      if (c === "lote") loteCol = j;
      if (c === "cajas") cajasCol = j;
    }
  }
  if (netoCol < 0) return [];

  const palets: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (isTotal(r)) continue;
    const kg = toNum(r[netoCol]);
    if (kg <= 0) continue;

    const prodName = productoCol >= 0 ? String(r[productoCol] ?? "").trim() : null;
    const nCajas = cajasCol >= 0 ? toNum(r[cajasCol]) : 0;
    palets.push({
      palet_id: paletCol >= 0 ? String(r[paletCol] ?? "").trim() : null,
      producto: prodName,
      cliente: clienteCol >= 0 ? String(r[clienteCol] ?? "").trim() : null,
      destino: null,
      kg_neto: kg,
      situacion: null,
      n_cajas: nCajas > 0 ? nCajas : null,
      lote_codigo: loteCol >= 0 ? lotePaletACanonico(r[loteCol]) : null,
      es_egipto: !!prodName && /EGIPTO/i.test(prodName),
      es_campo: !!prodName && /CAMPO|DEL CAMPO|DE CAMPO|CAMPI/i.test(prodName),
    });
  }
  return palets;
}

// ─── Helper: subagente de VISIÓN (foto diaria de lotes) ─────────────────────
// El operario entrega cada día una FOTO de la hoja de lotes con anotaciones a
// mano por lote: comentarios, kg de industria, P1 (kg apartados a
// precalibrado 1), cuántos box se echaron y marcas de lotes juntados
// (workflow del dueño, 22-jul-2026). Se envía en base64 a OpenRouter,
// usando modelos gratuitos con visión y fallback si uno está saturado.
const FOTO_LOTES_PROMPT = `Analista de planta cítrica Lasarte SAT. La imagen es una hoja DIARIA de producción escrita a mano: la fecha grande del encabezado pertenece al parte y cada bloque horizontal corresponde a una pegatina de lote.

REGLAS DE LECTURA (basadas en las hojas reales de esta planta):
1. Extrae SOLO lo visible. No completes cifras ni palabras dudosas. Campo ausente = 0, "" o [].
2. lote_codigo es el número grande impreso de 8 dígitos de la pegatina (p. ej. 26071601). La fecha pequeña impresa en la pegatina es la fecha de entrada del lote: NO es fecha_produccion.
3. La fecha grande manuscrita del encabezado ("PRODUCCIÓN DD.MM.AAAA" o similar) es fecha_produccion. Devuélvela como YYYY-MM-DD.
4. "I", "I-" o "Industria" junto a una cifra significa kg_industria. "P1"/"PREC1" y "P2"/"PREC2" junto a una cifra significan kg_prec1/kg_prec2. Devuelve kilos como número sin separador de miles: "2.566 kg" = 2566.
5. NO confundas peso por caja con kilos totales. Ejemplo: "PREC 4 kg MONA - 43 box" significa 43 cajas con peso_por_box_kg=4 y categoría MONA; NO significa kg_prec1=4.
6. Distingue los destinos escritos de las cajas: reciclaje, PREC1, PREC2, industria u otro. El "Nº envases entrada" impreso en la pegatina NO es un movimiento; solo cuenta correcciones o movimientos manuscritos.
7. Paros, averías, hueco de volcador, mallas llenas, calibrador, transportador, velocidad y limpieza son incidencias. Calidad de fruta (podrío, deshidratado, densidad, verde, manchada, blanda, saltamontes) va en comentario. No conviertas estos textos en kilos ni cajas.
8. Si una flecha o llave une lotes, usa juntado_con. Si algo no es inequívoco, consérvalo en dudas y deja a cero el campo estructurado.
9. Devuelve cada lote una sola vez aunque la misma hoja aparezca duplicada o con otro encuadre.

Responde SOLO JSON con este contrato exacto:
{"fecha_produccion":"YYYY-MM-DD o vacío","lotes_foto":[{"lote_codigo":"","productor":"","kg_industria":0,"kg_prec1":0,"kg_prec2":0,"movimientos_box":[{"destino":"reciclaje|prec1|prec2|industria|otro","boxes":0,"kg_total":0,"peso_por_box_kg":0,"categoria":"","texto_original":""}],"incidencias":[],"comentario":"","juntado_con":"","confianza":{"lote_codigo":0.0,"kg_industria":0.0,"kg_prec1":0.0,"kg_prec2":0.0,"contenido":0.0},"dudas":[]}]}`;

const FOTO_PESOS_PROMPT = `Las imágenes son recortes ampliados y solapados SOLO de la columna de pegatinas de una misma hoja diaria de producción de Lasarte SAT.

Por cada pegatina lee:
- lote_codigo: número grande impreso de 8 dígitos.
- texto_industria: copia literal de la anotación manuscrita que empiece por I, I- o I.xxx junto a la pegatina.
- texto_prec1: copia literal de la anotación manuscrita P1/P1- (el 1 puede parecer I o l).
- texto_prec2: copia literal de la anotación manuscrita P2/P2-.

No uses fechas, Nº envases, pesos impresos, RESTO BOX, densidad ni cifras de comentarios. No asignes una cifra si no ves también la etiqueta I/P1/P2. El punto manuscrito separa miles: 12.200 = 12200. Los recortes se solapan: devuelve cada lote una sola vez. Si dudas entre P1 y P2, deja ambos a 0 y explica la duda.

Responde SOLO JSON:
{"lotes_pesos":[{"lote_codigo":"","kg_industria":0,"kg_prec1":0,"kg_prec2":0,"texto_industria":"","texto_prec1":"","texto_prec2":"","confianza":0.0,"dudas":[]}]}`;

function sanitizeVisionCrops(value: unknown): Array<{ mime: string; b64: string }> {
  if (!Array.isArray(value)) return [];
  const result: Array<{ mime: string; b64: string }> = [];
  let totalChars = 0;
  for (const raw of value.slice(0, 10)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const mime = String(item.mime ?? "").toLowerCase();
    const b64 = String(item.b64 ?? "").trim();
    if (!/^image\/(?:jpeg|png|webp)$/.test(mime)) continue;
    if (b64.length < 100 || b64.length > 1_500_000 || !/^[a-z0-9+/=]+$/i.test(b64)) continue;
    if (totalChars + b64.length > 5_500_000) break;
    totalChars += b64.length;
    result.push({ mime, b64 });
  }
  return result;
}

function normalizeVisionDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  return null;
}

function parseVisionKg(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const rawNumber = String(value);
    return /^\d{1,3}\.\d{3}$/.test(rawNumber) ? Math.round(value * 1000) : value;
  }
  let raw = String(value ?? "").trim().replace(/\s+/g, "");
  if (!raw) return 0;
  raw = raw.replace(/kg$/i, "");
  // En estas hojas el punto suele ser separador de miles: 2.566 = 2566 kg.
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  else raw = raw.replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseVisionDecimal(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  const parsed = Number(String(value ?? "").trim().replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatVisionNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function visionBoxDestination(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    reciclaje: "reciclaje",
    prec1: "PREC 1",
    prec2: "PREC 2",
    industria: "industria",
    otro: "otro destino",
  };
  return labels[normalized] ?? "";
}

function extractLabeledVisionWeight(rawValue: unknown, kind: "industria" | "p1" | "p2"): number {
  const raw = String(rawValue ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  if (!raw) return 0;
  const numberPattern = "(\\d{1,3}(?:[.\\s]\\d{3})+|\\d+(?:,\\d+)?)";
  const label = kind === "industria"
    ? "I(?:ND(?:USTRIA)?)?(?:\\.[A-Z]+)?"
    : kind === "p1" ? "P[1IL]" : "P2";
  const match = raw.match(new RegExp(`(?:^|\\b)${label}\\s*[-:=]?\\s*${numberPattern}\\s*(?:KG)?`, "i"));
  return match ? parseVisionKg(match[1]) : 0;
}

function mergeVisionLotWeights(fullItemsRaw: unknown[], weightItemsRaw: unknown[], hasCrops: boolean): any[] {
  const norm8 = (value: unknown) => String(value ?? "").match(/\d{8}/)?.[0] ?? "";
  const result = fullItemsRaw
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...(item as Record<string, unknown>) }));
  const byCode = new Map<string, any>();
  for (const item of result) {
    const code = norm8(item.lote_codigo);
    if (code) byCode.set(code, item);
    if (hasCrops) {
      // Con recortes disponibles no se aceptan kilos inferidos desde la hoja
      // completa, porque pueden proceder de densidad u otras observaciones.
      item.kg_industria = 0;
      item.kg_prec1 = 0;
      item.kg_prec2 = 0;
    }
  }

  for (const rawItem of weightItemsRaw) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const weight = rawItem as Record<string, unknown>;
    const code = norm8(weight.lote_codigo);
    if (!code) continue;
    let target = byCode.get(code);
    if (!target) {
      target = {
        lote_codigo: code,
        productor: "",
        comentario: "",
        movimientos_box: [],
        incidencias: [],
        juntado_con: "",
        dudas: [],
      };
      result.push(target);
      byCode.set(code, target);
    }

    const evidence = [weight.texto_industria, weight.texto_prec1, weight.texto_prec2];
    const kgIndustria = Math.max(...evidence.map((text) => extractLabeledVisionWeight(text, "industria")));
    const kgP1 = Math.max(...evidence.map((text) => extractLabeledVisionWeight(text, "p1")));
    const kgP2 = Math.max(...evidence.map((text) => extractLabeledVisionWeight(text, "p2")));
    target.kg_industria = kgIndustria;
    target.kg_prec1 = kgP1;
    target.kg_prec2 = kgP2;
    const doubts = [
      ...(Array.isArray(target.dudas) ? target.dudas : []),
      ...(Array.isArray(weight.dudas) ? weight.dudas : []),
    ].map((value) => String(value ?? "").trim()).filter(Boolean);
    target.dudas = Array.from(new Set(doubts));
  }
  return result;
}

async function callVisionFotoLotes(
  imagenes: Array<{ mime: string; b64: string }>,
  openRouterKey: string,
  preferredModel: string,
  expectedDate: string,
  mode: "full" | "weights" = "full",
): Promise<{ data: any; success: boolean; model: string | null; warning: string | null }> {
  const responseKey = mode === "weights" ? "lotes_pesos" : "lotes_foto";
  const systemPrompt = mode === "weights" ? FOTO_PESOS_PROMPT : FOTO_LOTES_PROMPT;
  const content: any[] = [{
    type: "text",
    text: mode === "weights"
      ? "Lee exclusivamente las anotaciones I/P1/P2 de estos recortes ampliados."
      : `Extrae los datos de la(s) hoja(s). La fecha esperada del parte es ${expectedDate || "desconocida"}; aun así, informa la fecha que realmente leas en la imagen.`,
  }];
  for (const img of imagenes) {
    content.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.b64}` } });
  }
  const models = Array.from(new Set([
    preferredModel,
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "openrouter/free",
  ].filter(Boolean)));
  const errors: string[] = [];

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      console.log(`[IA-foto_lotes] OpenRouter modelo=${model}`);
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + openRouterKey,
          "X-Title": "Herramienta Lasarte",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content }],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 4096,
        }),
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        const detail = String(await resp.text()).slice(0, 300);
        errors.push(`${model}: HTTP ${resp.status}`);
        console.warn(`[IA-foto_lotes] ${model} status=${resp.status} detail=${detail}`);
        continue;
      }
      const jsonResp = await resp.json();
      const actualModel = String(jsonResp?.model ?? model);
      let text = jsonResp?.choices?.[0]?.message?.content ?? "{}";
      console.log(`[IA-foto_lotes] ${model} raw (first 300):`, String(text).slice(0, 300));
      text = String(text).replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data?.[responseKey])) return { data, success: true, model: actualModel, warning: null };
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            const data = JSON.parse(match[0]);
            if (Array.isArray(data?.[responseKey])) return { data, success: true, model: actualModel, warning: null };
          } catch { /* probar el siguiente modelo */ }
        }
      }
      errors.push(`${model}: respuesta JSON inválida`);
    } catch (e) {
      clearTimeout(timeout);
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${model}: ${message}`);
      console.warn(`[IA-foto_lotes] ${model} error`, e);
    }
  }

  return {
    data: {},
    success: false,
    model: null,
    warning: "No se pudo leer la foto con OpenRouter. " + errors.join(" | "),
  };
}

// ─── Helper: llamar IA para un subagente específico ──────────────────────────
async function callAIForSubagent(
  label: string,
  sysPrompt: string,
  userMsg: string,
  providers: any[],
  RETRYABLE: Set<number>,
): Promise<{ data: any; warning: string | null; success: boolean }> {
  for (const provider of providers) {
    const timeoutMs = 25000;
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        console.log("[IA-" + label + "] " + provider.name + " intento=" + (attempt + 1));
        const reqBody: any = {
          model: provider.model,
          messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userMsg }],
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
          console.log("[IA-" + label + "] raw (first 300):", text.slice(0, 300));
          text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
          try {
            const data = JSON.parse(text);
            console.log("[IA-" + label + "] " + provider.name + " OK");
            return { data, warning: null, success: true };
          } catch {
            const m = text.match(/\{[\s\S]*\}/);
            if (m) {
              try {
                const data = JSON.parse(m[0]);
                console.log("[IA-" + label + "] JSON extraído de texto");
                return { data, warning: null, success: true };
              } catch {
                return { data: {}, warning: provider.name + ": JSON invalido", success: false };
              }
            }
            return { data: {}, warning: provider.name + ": JSON invalido (sin objeto)", success: false };
          }
        }
        if (aiResp.status === 401 || aiResp.status === 403) {
          console.warn("[IA-" + label + "] " + provider.name + " auth failed");
          break;
        }
        if (aiResp.status === 429) {
          console.warn("[IA-" + label + "] " + provider.name + " rate limited");
          break;
        }
        if (!RETRYABLE.has(aiResp.status)) {
          console.warn("[IA-" + label + "] " + provider.name + " status=" + aiResp.status);
          break;
        }
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 300)));
      } catch (e) {
        clearTimeout(timeout);
        const isTimeout = e instanceof Error && e.name === "AbortError";
        console.warn("[IA-" + label + "] " + provider.name + " error: " + (isTimeout ? "timeout" : String(e)));
        if (isTimeout) break;
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  return { data: {}, warning: "Sin respuesta IA para " + label, success: false };
}

function extractCalibresDetalle(rows: any[][]): any[] {
  const items: any[] = [];
  let currentClase: string | null = null;
  let currentGrupo: string | null = null;
  let inTable = false;

  const nextValue = (r: any[], j: number) => {
    for (let k = j + 1; k < Math.min(j + 20, r.length); k++) {
      const v = r[k]; if (v != null && v !== "") return String(v).trim();
    }
    return null;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];

    // Detect quality name: "(A) Extra 1", "(B) Extra 2", etc.
    for (let j = 0; j < Math.min(r.length, 20); j++) {
      const v = String(r[j] ?? "").trim();
      if (/^\([A-Za-z]\)\s+\w/.test(v)) {
        currentClase = v.replace(/^\([A-Za-z]\)\s*/, "").trim();
        currentGrupo = null;
        inTable = false;
        break;
      }
    }

    // Detect "Grupo de Clasificación:" (up to col 55)
    for (let j = 0; j < Math.min(r.length, 55); j++) {
      if (norm(r[j]) === "grupo de clasificacion:") {
        const gv = nextValue(r, j);
        if (gv) currentGrupo = norm(gv);
        break;
      }
    }

    // Detect header row: "Tamaño", "Piezas", "Peso (kg)"
    let tamCol = -1, piezasCol = -1, pesoCol = -1, pctCol = -1;
    for (let j = 0; j < Math.min(r.length, 40); j++) {
      const raw = String(r[j] ?? "").trim();
      const cj = norm(raw);
      if (cj === "tamano" || raw.toLowerCase() === "tamaño") tamCol = j;
      if (cj === "piezas") piezasCol = j;
      if (cj === "peso (kg)") pesoCol = j;
      if (cj === "% piezas" || cj === "% peso") { if (pctCol < 0) pctCol = j; }
    }

    if (currentClase && tamCol >= 0 && (piezasCol >= 0 || pesoCol >= 0)) {
      inTable = true;
      for (let di = i + 1; di < rows.length; di++) {
        const dr = rows[di] ?? [];
        const calibreVal = String(dr[tamCol] ?? "").trim();
        if (!calibreVal) { inTable = false; break; }
        if (/^(total|subtotal)/i.test(calibreVal)) continue;
        if (!calibreVal.startsWith("(")) { inTable = false; break; }
        const piezas = piezasCol >= 0 ? toNum(dr[piezasCol]) : 0;
        const kg = pesoCol >= 0 ? toNum(dr[pesoCol]) : 0;
        const pct = pctCol >= 0 ? toNum(dr[pctCol]) : 0;
        if (piezas > 0 || kg > 0) {
          items.push({
            calibre: calibreVal,
            clase: currentClase,
            kg,
            piezas,
            pct,
            grupo_destino: currentGrupo,
          });
        }
      }
      continue;
    }
  }

  console.log("[CALIBRES] " + items.length + " items (section-based parser)");
  return items;
}

function extractProductoDetalle(rows: any[][]): any[] {
  let productoCol = -1, formatoCol = -1, pesoKgCol = -1, cajasCol = -1, grupoCol = -1, lineaCol = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const r = rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const c = norm(r[j]);
      if (/^(producto|articulo|descripcion)$/.test(c)) productoCol = j;
      if (/^(empaque|formato|formato_caja|tipo_caja|envase|packaging)$/.test(c)) formatoCol = j;
      if (/^peso\s*\(?\s*kg\s*\)?\s*$|^total\s*kg$|^kg$|^kilos$/.test(c)) pesoKgCol = j;
      if (/^(cajas|empaques|bultos|unidades)$/.test(c)) cajasCol = j;
      if (/^(grupo|destino|grupo_destino|clasificacion|mercado)$/.test(c)) grupoCol = j;
      if (/^(linea|line|maquina|linea_envasado)$/.test(c)) lineaCol = j;
    }
  }
  if (productoCol < 0 && formatoCol < 0) return [];
  if (pesoKgCol < 0) return [];
  const items: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (isTotal(r)) continue;
    const sinDato = r.every((c) => c == null || String(c).trim() === "");
    if (sinDato) continue;
    const kg = toNum(r[pesoKgCol]);
    if (kg <= 0) continue;
    const producto = productoCol >= 0 ? String(r[productoCol] ?? "").trim() : null;
    const formato = formatoCol >= 0 ? String(r[formatoCol] ?? "").trim() : null;
    const cajas = cajasCol >= 0 ? toNum(r[cajasCol]) : 0;
    const grupo = grupoCol >= 0 ? String(r[grupoCol] ?? "").trim() : null;
    const linea = lineaCol >= 0 ? String(r[lineaCol] ?? "").trim() : null;
    if (producto && /\b(total|subtotal)\b/i.test(producto)) continue;
    if (producto && /^(producto|articulo|descripcion|empaque|formato|peso|cajas|grupo|destino|linea)$/i.test(producto)) continue;
    items.push({
      linea: linea || null,
      producto: producto || null,
      formato_caja: formato || null,
      kg,
      n_cajas: cajas || null,
      grupo_destino: grupo || null,
    });
  }
  console.log("[PRODUCTO] productoCol=" + productoCol + " formatoCol=" + formatoCol + " pesoCol=" + pesoKgCol + " -> " + items.length + " items");
  return items;
}
