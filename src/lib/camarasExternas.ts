// La lib vive en supabase/functions/_shared/camarasExternas.ts (patron fotoLotesCoherencia):
// las edge functions (Deno) y el frontend comparten las MISMAS funciones puras
// sin copias que diverjan. Este re-export mantiene intactos a todos los
// consumidores de "@/lib/camarasExternas".
export * from "../../supabase/functions/_shared/camarasExternas.ts";
