/**
 * chatMemoria.ts — Memoria persistente de Vadim (inspirada en el proyecto Midas:
 * https://github.com/vornicx/Midas), adaptada a un asistente que corre en una
 * Edge Function de Supabase, sin disco local ni MCP.
 *
 * Mecanismo de escritura sin coste extra: el propio modelo emite en su
 * respuesta etiquetas `[[recordar clave-slug: texto del recuerdo]]` cuando
 * detecta un hecho estable que merece memoria (ver DOMAIN_PROMPT en
 * src/lib/gemini.ts, sección "MEMORIA PERSISTENTE"). No hace falta una
 * segunda llamada al LLM: se extraen esas etiquetas del texto ya generado.
 *
 * Revisión de creencias: `chat_memoria.clave` es UNIQUE. `guardarRecuerdos`
 * hace upsert por esa clave, así que un recuerdo nuevo con la misma clave
 * reemplaza (no duplica) el contenido anterior.
 *
 * Olvido selectivo: `olvidarMemoria` no borra la fila, marca `activa=false`
 * (soft delete) para conservar trazabilidad ("qué se aprendió y cuándo se
 * olvidó").
 *
 * IMPORTANTE: la tabla `chat_memoria` todavia NO existe en
 * src/integrations/supabase/types.ts (migracion en
 * scratchpad/migracion_chat_memoria.sql, pendiente de aplicar por el
 * orquestador). Mientras tanto se usa un cast local a `any` (mismo patron que
 * useMercadonaVentas.ts) y las funciones degradan con gracia si la tabla aun
 * no existe (relation/table does not exist), devolviendo listas vacias o
 * ignorando el guardado en vez de lanzar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Cast local: la tabla chat_memoria aun no esta en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

export interface RecuerdoExtraido {
  clave: string;
  contenido: string;
}

export interface ExtraccionRecuerdos {
  textoLimpio: string;
  recuerdos: RecuerdoExtraido[];
}

export interface MemoriaRow {
  id: string;
  clave: string;
  contenido: string;
  origen: string | null;
  user_id: string;
  activa: boolean;
  created_at: string;
  updated_at: string;
}

const TABLE_MISSING_CODES = new Set(["42P01", "PGRST205", "PGRST204"]);

function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code && TABLE_MISSING_CODES.has(record.code)) return true;
  const message = (record.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find the table");
}

// ─── Extracción de etiquetas [[recordar clave: contenido]] ────────────────────
//
// Formato esperado (ver DOMAIN_PROMPT): `[[recordar clave-slug: texto libre]]`.
// Tolerante a espacios extra, mayúsculas/minúsculas en la palabra "recordar",
// y a que el contenido ocupe varias líneas (se corta en el próximo `]]` o en
// la siguiente etiqueta `[[recordar`).
const RECORDAR_RE = /\[\[\s*recordar\s+([a-z0-9][a-z0-9_-]{1,60})\s*:\s*([\s\S]*?)\s*\]\]/gi;

/**
 * Extrae las etiquetas `[[recordar clave: contenido]]` de un texto de
 * respuesta del asistente. Devuelve el texto sin las etiquetas (textoLimpio,
 * el que se muestra al usuario) y la lista de recuerdos detectados.
 *
 * Etiquetas malformadas (sin `]]` de cierre, clave vacía o con caracteres no
 * permitidos, contenido vacío) se ignoran sin romper la extracción del resto.
 */
export function extraerRecuerdos(texto: string): ExtraccionRecuerdos {
  if (!texto) return { textoLimpio: "", recuerdos: [] };

  const recuerdos: RecuerdoExtraido[] = [];
  RECORDAR_RE.lastIndex = 0;

  const textoLimpio = texto.replace(RECORDAR_RE, (_match, claveRaw: string, contenidoRaw: string) => {
    const clave = claveRaw.trim().toLowerCase();
    const contenido = contenidoRaw.replace(/\s+/g, " ").trim();
    if (clave && contenido) {
      recuerdos.push({ clave, contenido });
    }
    return "";
  }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  return { textoLimpio, recuerdos };
}

// ─── Persistencia ───────────────────────────────────────────────────────────

/**
 * Guarda (upsert por `clave`) los recuerdos extraídos. Revisión de creencias:
 * si la clave ya existe, se actualiza contenido/origen/updated_at en vez de
 * duplicar la fila. Silencioso si la tabla aún no existe (degradación).
 */
export async function guardarRecuerdos(
  recuerdos: RecuerdoExtraido[],
  origen: string,
  userId: string,
): Promise<void> {
  if (!recuerdos.length || !userId) return;

  const origenCorto = origen.trim().slice(0, 300) || null;

  for (const { clave, contenido } of recuerdos) {
    try {
      const { error } = await SUPA
        .from("chat_memoria")
        .upsert(
          {
            clave,
            contenido,
            origen: origenCorto,
            user_id: userId,
            activa: true,
          },
          { onConflict: "clave" },
        );
      if (error && !isTableMissingError(error)) throw error;
    } catch (error) {
      if (isTableMissingError(error)) return; // tabla aún no aplicada: abandona en silencio
      throw error;
    }
  }
}

/** Carga las memorias activas, más recientes primero (cap 50). Lista vacía si la tabla no existe. */
export async function cargarMemorias(): Promise<MemoriaRow[]> {
  try {
    const { data, error } = await SUPA
      .from("chat_memoria")
      .select("*")
      .eq("activa", true)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      if (isTableMissingError(error)) return [];
      throw error;
    }
    return (data ?? []) as MemoriaRow[];
  } catch (error) {
    if (isTableMissingError(error)) return [];
    throw error;
  }
}

/** Olvido selectivo: marca la memoria como inactiva (soft delete, conserva trazabilidad). */
export async function olvidarMemoria(id: string): Promise<void> {
  const { error } = await SUPA
    .from("chat_memoria")
    .update({ activa: false })
    .eq("id", id);
  if (error && !isTableMissingError(error)) throw error;
}

// ─── Formato para inyectar en el system prompt ─────────────────────────────

/** Bloque de texto compacto con las memorias activas, listo para el system prompt. */
export function formatearMemoriasParaPrompt(memorias: MemoriaRow[]): string {
  if (!memorias.length) return "";
  const lineas = memorias.map((m) => `- ${m.contenido}`).join("\n");
  return `MEMORIA PERSISTENTE (hechos aprendidos en conversaciones anteriores):\n${lineas}`;
}
