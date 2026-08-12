/**
 * El buzón: clasifica un archivo que ha llegado por correo y lo importa si se
 * puede hacer solo.
 *
 * POR QUÉ. Hoy, para meter un Excel en la Herramienta hay que entrar en
 * /importar y soltarlo. Eso significa que si nadie se acuerda, no entra: el
 * registro de cámaras externas llevaba 78 días sin actualizarse y nadie se
 * había enterado. Con esto basta con reenviar el correo al receptor de la LAN.
 *
 * REUTILIZA EL CLASIFICADOR DE VERDAD (src/lib/importBandeja.ts, 13 tipos y sus
 * 23 tests) — aquí no se re-implementa ni una regla de reconocimiento. Por eso
 * el script es TypeScript y se ejecuta con vite-node: para poder importar el
 * mismo código que usa la página, en vez de una copia que se quedaría atrás.
 *
 * QUÉ IMPORTA SOLO Y QUÉ NO. La página /importar distingue entre lo que se
 * importa sin preguntar (zona automática) y lo que pide confirmación humana.
 * ESA DISTINCIÓN SE RESPETA: el buzón solo escribe lo que la app ya escribiría
 * sola. Lo que necesita que alguien mire (ventas, Mercadona, báscula, stock,
 * merma) se guarda y se avisa, pero NO se importa a espaldas de nadie.
 *
 *   node node_modules/vite-node/vite-node.mjs scripts/importar-adjunto.ts <archivo> [--aplicar]
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { clasificarArchivoBandeja, TIPO_BANDEJA_LABEL, type TipoArchivoBandeja } from "../src/lib/importBandeja";
import type { CamionCamaraExterna, ParseRegistroCamaraResult } from "../supabase/functions/_shared/camarasExternas";

process.loadEnvFile(".env");

/**
 * Los tipos que la app importa sin preguntar (ZonaAutomatica.tsx). El buzón no
 * amplía esta lista por su cuenta: si un tipo pide confirmación en la página,
 * la pide también aquí.
 */
const AUTOMATICOS: TipoArchivoBandeja[] = [
  "informe-lote", "informe-produccion", "palets-campana",
  "camaras-externas", "informe-productor",
];

/** Lectura canónica de la bandeja (misma receta que importBandejaLectura.ts). */
export function leerExcel(ruta: string): Record<string, unknown[][]> | null {
  try {
    const wb = XLSX.read(fs.readFileSync(ruta), { type: "buffer", cellDates: true });
    const sheets: Record<string, unknown[][]> = {};
    for (const nombre of wb.SheetNames) {
      sheets[nombre] = XLSX.utils.sheet_to_json(wb.Sheets[nombre], {
        header: 1, raw: true, defval: null,
      }) as unknown[][];
    }
    return sheets;
  } catch {
    return null;
  }
}

/** El user_id se hereda del último parte: no se inventa una identidad nueva. */
async function usuarioDeReferencia(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.from("partes_diarios")
    .select("user_id").order("date", { ascending: false }).limit(1);
  if (error) throw new Error(`user_id: ${error.message}`);
  const id = data?.[0]?.user_id;
  if (!id) throw new Error("No hay ningun parte previo del que heredar el user_id.");
  return id as string;
}

/**
 * Camiones de cámara externa: upsert por su clave natural, igual que
 * useCamarasExternas.importar. El PARSEO lo ha hecho ya el clasificador.
 */
async function importarCamarasExternas(
  supabase: SupabaseClient, registros: CamionCamaraExterna[], userId: string,
): Promise<string> {
  if (registros.length === 0) throw new Error("el archivo no trae ningun camion");
  let n = 0;
  for (let i = 0; i < registros.length; i += 200) {
    const chunk = registros.slice(i, i + 200).map((r) => ({
      ...r, user_id: userId, updated_at: new Date().toISOString(),
    }));
    // La clave natural del registro de la cámara es (procedencia, s_ref): el
    // mismo camión reenviado dos veces se actualiza, no se duplica.
    const { error } = await supabase.from("camara_externa_camiones")
      .upsert(chunk, { onConflict: "procedencia,s_ref" });
    if (error) throw new Error(error.message);
    n += chunk.length;
  }
  return `${n} camion(es) importado(s)/actualizado(s)`;
}

export interface ResultadoAdjunto {
  fichero: string;
  tipo: TipoArchivoBandeja;
  etiqueta: string;
  motivo: string;
  n: number;
  /** "importado" | "esperando" (necesita confirmacion) | "no-reconocido" | "error" */
  estado: "importado" | "esperando" | "no-reconocido" | "error";
  detalle?: string;
}

export async function procesarAdjunto(
  supabase: SupabaseClient, ruta: string, { aplicar = false } = {},
): Promise<ResultadoAdjunto> {
  const fichero = path.basename(ruta);
  const sheets = leerExcel(ruta);
  const clasificado = clasificarArchivoBandeja({
    fileName: fichero, sheets, anio: new Date().getFullYear(),
  });

  const base = {
    fichero,
    tipo: clasificado.tipo,
    etiqueta: TIPO_BANDEJA_LABEL[clasificado.tipo],
    motivo: clasificado.motivo,
    n: clasificado.n,
  };

  if (clasificado.tipo === "desconocido" || clasificado.tipo === "no-soportado") {
    return { ...base, estado: "no-reconocido" };
  }
  if (!AUTOMATICOS.includes(clasificado.tipo)) {
    return { ...base, estado: "esperando" };
  }
  if (!aplicar) return { ...base, estado: "esperando", detalle: "simulacion" };

  try {
    const userId = await usuarioDeReferencia(supabase);
    if (clasificado.tipo === "camaras-externas") {
      const payload = clasificado.payload as ParseRegistroCamaraResult;
      const detalle = await importarCamarasExternas(supabase, payload.registros, userId);
      return { ...base, estado: "importado", detalle };
    }
    // Los otros cuatro automáticos escriben con reglas propias (reparación de
    // lotes_dia, backfill de palets…) que hoy solo viven en sus hooks de React.
    // Hasta poder reutilizarlas de verdad, se avisa en vez de improvisar una
    // copia: un importador a medias haría daño silencioso.
    return { ...base, estado: "esperando", detalle: "reconocido, pero su importador todavia solo vive en /importar" };
  } catch (e) {
    return { ...base, estado: "error", detalle: e instanceof Error ? e.message : String(e) };
  }
}

const ruta = process.argv.find((a) => !a.startsWith("--") && /\.(xlsx?|csv)$/i.test(a));
if (ruta) {
  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const r = await procesarAdjunto(supabase, ruta, { aplicar: process.argv.includes("--aplicar") });
  console.log(JSON.stringify(r));
}
