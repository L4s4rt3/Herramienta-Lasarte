import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const body = await req.json();
    const { file_path, file_content, date, user_id: bodyUserId } = body;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    let uid: string;
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      if (bodyUserId) {
        uid = bodyUserId;
      } else {
        return json({ error: "Usuario no autenticado. Proporcione user_id" }, 401);
      }
    } else {
      uid = userData.user.id;
    }
    if (!file_path && !file_content) return json({ error: "file_path o file_content requerido" }, 400);

    let bytes: Uint8Array;
    if (file_content) {
      // Accept base64-encoded file content
      const binary = atob(file_content);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else {
      const { data: blob, error: dlErr } = await admin.storage.from("partes-archivos").download(file_path);
      if (dlErr || !blob) return json({ error: "No se pudo descargar el archivo" }, 404);
      bytes = new Uint8Array(await blob.arrayBuffer());
    }
    const wb = XLSX.read(bytes, { type: "array" });

    const rowsAll: any[][] = [];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      rowsAll.push(...XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: null }));
    }

    if (rowsAll.length < 2) return json({ error: "Excel sin datos" }, 400);

    const header = rowsAll[0] ?? [];
    const colIdx: Record<string, number> = {};
    const headerNorm = header.map((h: any) => norm(String(h ?? "")));
    headerNorm.forEach((h: string, i: number) => {
      if (/productor|nombre/.test(h)) colIdx.nombre = i;
      if (/actividad/.test(h)) colIdx.actividad = i;
      if (/fecha/.test(h)) colIdx.fecha = i;
    });

    if (colIdx.nombre === undefined) return json({ error: "No se encontró columna 'Productor'" }, 400);

    // ── Leer todos los trabajadores y zonas del Excel ──
    const excelWorkers: { nombre: string; actividad: string }[] = [];
    for (let i = 1; i < rowsAll.length; i++) {
      const r = rowsAll[i] ?? [];
      const nombre = String(r[colIdx.nombre] ?? "").trim();
      if (!nombre) continue;
      excelWorkers.push({
        nombre,
        actividad: colIdx.actividad !== undefined ? String(r[colIdx.actividad] ?? "").trim() : "",
      });
    }

    if (excelWorkers.length === 0) return json({ error: "No hay trabajadores en el Excel" }, 400);

    // ── Extraer fecha del Excel o usar la proporcionada ──
    let targetDate = date;
    if (!targetDate && colIdx.fecha !== undefined) {
      const firstDate = String(rowsAll[1]?.[colIdx.fecha] ?? "").trim();
      if (firstDate) targetDate = firstDate;
    }
    if (!targetDate) return json({ error: "Fecha no encontrada en Excel ni en parámetros" }, 400);

    // ── Cargar trabajadores de la DB ──
    const { data: dbWorkers, error: dbErr } = await admin
      .from("trabajadores").select("id, nombre, zona")
      .eq("user_id", uid)
      .eq("activo", true);
    if (dbErr) return json({ error: dbErr.message }, 500);
    if (!dbWorkers || dbWorkers.length === 0) return json({ error: "No hay trabajadores dados de alta" }, 404);

    // ── Matching de nombres ──
    const EXCEL_SURNAME_FIRST = true; // Excel: SURNAME SURNAME NAME

    const accentMap: Record<string, string> = {
      Á: "A", É: "E", Í: "I", Ó: "O", Ú: "U", Ü: "U", Ñ: "N",
      À: "A", È: "E", Ì: "I", Ò: "O", Ù: "U",
      Â: "A", Ê: "E", Î: "I", Ô: "O", Û: "U",
      Ä: "A", Ë: "E", Ï: "I", Ö: "O",
    };

    function cleanName(s: string): string {
      let r = s.replace(/\u00ad/g, "").toUpperCase();
      for (const [k, v] of Object.entries(accentMap)) r = r.split(k).join(v);
      r = r.replace(/[,;:!?()\-]/g, "").replace(/\s+/g, " ").trim();
      return r;
    }

    function wordSet(s: string): string[] {
      return cleanName(s).split(" ").filter((w) => w.length >= 2).sort();
    }

    function wordsMatch(a: string, b: string): boolean {
      if (a === b || a.includes(b) || b.includes(a)) return true;
      // Check common prefix of at least 4 chars (handles Encarni↔Encarnacion, etc.)
      let prefixLen = 0;
      const minLen = Math.min(a.length, b.length);
      for (let i = 0; i < minLen; i++) {
        if (a[i] === b[i]) prefixLen++; else break;
      }
      if (prefixLen >= 4) return true;
      return false;
    }

    function matchScore(excelName: string, dbName: string): number {
      const eWords = wordSet(excelName);
      const dWords = wordSet(dbName);
      if (eWords.length === 0 || dWords.length === 0) return 0;
      let hits = 0;
      for (const dw of dWords) {
        if (eWords.some((ew) => wordsMatch(ew, dw))) hits++;
      }
      return hits / dWords.length;
    }

    // Match each Excel worker to a DB worker
    const matchedDbIds = new Set<string>();
    const presenteTrabajadorIds: string[] = [];
    const unmatchedDbIds = new Set(dbWorkers.map((w: any) => w.id));

    for (const ew of excelWorkers) {
      let bestId: string | null = null;
      let bestScore = 0;
      for (const dw of dbWorkers) {
        const score = matchScore(ew.nombre, dw.nombre);
        if (score > bestScore) {
          bestScore = score;
          bestId = dw.id;
        }
      }
      // Threshold: at least 50% word overlap OR at least 2 words match
      const eWords = wordSet(ew.nombre);
      const need = Math.min(eWords.length, 2) / Math.max(eWords.length, 1);
      const threshold = Math.max(0.5, need);

      if (bestId && bestScore >= threshold) {
        matchedDbIds.add(bestId);
        presenteTrabajadorIds.push(bestId);
        unmatchedDbIds.delete(bestId);
      }
    }

    const ausenteTrabajadorIds = [...unmatchedDbIds];
    const plantillaTotal = presenteTrabajadorIds.length + ausenteTrabajadorIds.length;

    // ── Determinar zona desde las actividades del Excel ──
    const actividades = [...new Set(excelWorkers.map((w) => w.actividad).filter(Boolean))];
    const zonaId = actividades.length > 0 ? actividades.join(", ") : "General";

    // ── Guardar asistencia_diaria ──
    const diariaPayload = {
      user_id: uid,
      date: targetDate,
      zona_id: zonaId,
      plantilla_total: plantillaTotal,
      presentes: presenteTrabajadorIds.length,
      ausentes: ausenteTrabajadorIds.length,
    };

    // Upsert: si ya existe un registro para esta fecha, actualizarlo
    const { data: existingDiaria } = await admin
      .from("asistencia_diaria")
      .select("id")
      .eq("user_id", uid)
      .eq("date", targetDate)
      .maybeSingle();

    if (existingDiaria) {
      await admin.from("asistencia_diaria").update(diariaPayload).eq("id", existingDiaria.id);
    } else {
      await admin.from("asistencia_diaria").insert(diariaPayload);
    }

    // ── Guardar asistencia_detalle (borrar previos + insertar nuevos) ──
    await admin.from("asistencia_detalle").delete().eq("user_id", uid).eq("date", targetDate);

    const detalleRows: any[] = [
      ...presenteTrabajadorIds.map((tid) => ({
        user_id: uid,
        date: targetDate,
        trabajador_id: tid,
        presente: true,
      })),
      ...ausenteTrabajadorIds.map((tid) => ({
        user_id: uid,
        date: targetDate,
        trabajador_id: tid,
        presente: false,
      })),
    ];

    if (detalleRows.length > 0) {
      await admin.from("asistencia_detalle").insert(detalleRows);
    }

    return json({
      message: "Asistencia importada correctamente",
      date: targetDate,
      zona: zonaId,
      plantilla_total: plantillaTotal,
      presentes: presenteTrabajadorIds.length,
      ausentes: ausenteTrabajadorIds.length,
      trabajadores_presentes: presenteTrabajadorIds.length,
      trabajadores_ausentes: ausenteTrabajadorIds.length,
      excel_leidos: excelWorkers.length,
      db_trabajadores: dbWorkers.length,
    });
  } catch (e) {
    console.error("importar-asistencia", e);
    return json({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
