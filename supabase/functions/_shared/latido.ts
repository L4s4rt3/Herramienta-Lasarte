/**
 * latido.ts — el latido de las edge functions en sistema_latidos.
 *
 * POR QUÉ. El 17 y el 24-08-2026 el informe semanal murió en silencio: el cron
 * disparó (pg_net encola y dice "succeeded" pase lo que pase), la función
 * cascó a medias y no dejó NI fila de envío NI latido — dos lunes sin correo
 * y nadie lo supo hasta el 31-08. Un trabajo que puede morir sin rastro no
 * está vigilado: desde entonces TODAS las funciones de correo laten al acabar
 * (ok/aviso/error) y también en su catch, y el vigilante (saludTrabajos.ts)
 * avisa cuando un latido semanal se pasa de fecha.
 *
 * Best-effort a propósito: registrar el latido jamás rompe el trabajo.
 */

// Tipado estructural laxo (patrón campanaEdge): sin dependencia de supabase-js.
// deno-lint-ignore no-explicit-any
type DbLike = { from(tabla: string): any };

export async function registrarLatido(
  db: DbLike,
  trabajo: string,
  estado: "ok" | "aviso" | "error",
  detalle: string,
): Promise<void> {
  try {
    const { error } = await db.from("sistema_latidos").upsert({
      trabajo,
      visto_a: new Date().toISOString(),
      estado,
      detalle: detalle.slice(0, 500),
      equipo: "supabase-edge",
    });
    if (error) console.error(`[latido] ${trabajo}: ${error.message}`);
  } catch (e) {
    console.error(`[latido] ${trabajo}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
