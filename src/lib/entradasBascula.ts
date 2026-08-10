// La lib vive en supabase/functions/_shared/entradasBascula.ts (patron fotoLotesCoherencia):
// las edge functions (Deno) y el frontend comparten las MISMAS funciones puras
// sin copias que diverjan. Este re-export mantiene intactos a todos los
// consumidores de "@/lib/entradasBascula".
export * from "../../supabase/functions/_shared/entradasBascula.ts";
