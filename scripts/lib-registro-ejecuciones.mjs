/**
 * El rastro de los trabajos automáticos, EN LA BASE en vez de en ficheros del
 * portátil (Fase 1 de docs/SISTEMA_LASARTE.md).
 *
 * POR QUÉ. El log de la tarea diaria y el registro.jsonl del receptor viven en
 * el mismo portátil que los trabajos: si el equipo no arranca, no hay ni datos
 * ni señal de que faltan. Escribiendo aquí, la página /datos/fuentes lo enseña
 * a cualquiera y la edge function `vigilante` avisa desde fuera del portátil.
 *
 * DOS REGLAS:
 *   1. NUNCA lanza. El trabajo importa más que su cuaderno de bitácora: si
 *      Supabase no responde, se queja por consola y el trabajo sigue.
 *   2. No pide cliente: se lo hace él del .env, que el script anfitrión ya
 *      cargó con process.loadEnvFile al arrancar.
 */
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

const EQUIPO = os.hostname();
let cliente; // se crea una vez, al primer uso

function supabase() {
  if (cliente !== undefined) return cliente;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cliente = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  if (!cliente) {
    console.warn("[registro] sin credenciales de Supabase en el entorno: este trabajo no dejará rastro en la base");
  }
  return cliente;
}

/**
 * El último estado conocido del trabajo (upsert en sistema_latidos).
 * Para procesos largos —el receptor— es literalmente el latido: se llama cada
 * 5 minutos y su frescura es lo que dice "sigo vivo".
 */
export async function latido(trabajo, { estado = "ok", detalle = null } = {}) {
  const db = supabase();
  if (!db) return;
  try {
    const { error } = await db.from("sistema_latidos").upsert({
      trabajo,
      visto_a: new Date().toISOString(),
      estado,
      detalle,
      equipo: EQUIPO,
    });
    if (error) console.warn(`[registro] latido de ${trabajo}: ${error.message}`);
  } catch (e) {
    console.warn(`[registro] latido de ${trabajo}: ${e.message}`);
  }
}

/**
 * Una ejecución terminada: fila en el histórico (sistema_ejecuciones) y de paso
 * el latido con el resultado, para que el último estado siempre esté al día.
 *
 * estado: 'ok' | 'aviso' (corrió pero dejó cosas que revisar) | 'error'.
 */
export async function anotarEjecucion({ trabajo, inicio = null, estado, detalle = null, datos = {} }) {
  const db = supabase();
  if (!db) return;
  try {
    const { error } = await db.from("sistema_ejecuciones").insert({
      trabajo,
      inicio,
      estado,
      detalle,
      equipo: EQUIPO,
      datos,
    });
    if (error) console.warn(`[registro] ejecución de ${trabajo}: ${error.message}`);
  } catch (e) {
    console.warn(`[registro] ejecución de ${trabajo}: ${e.message}`);
  }
  await latido(trabajo, { estado, detalle });
}
