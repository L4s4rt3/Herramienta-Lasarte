// La lib vive en supabase/functions/_shared/calibradorReparto.ts (patron fotoLotesCoherencia):
// la edge function reparto-pasadas (Deno) y el frontend comparten las MISMAS funciones
// puras sin copias que diverjan. Este re-export mantiene intactos a todos los
// consumidores de "@/lib/calibradorReparto".
export * from "../../supabase/functions/_shared/calibradorReparto.ts";
