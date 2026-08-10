// La lib vive en supabase/functions/_shared/rentabilidadDia.ts (patrón
// fotoLotesCoherencia): la edge function informe-semanal (Deno) y el frontend
// usan EXACTAMENTE el mismo cálculo — mismo número ⇒ misma función pura.
// Este re-export mantiene intactos a todos los consumidores de "@/lib/rentabilidadDia".
export * from "../../supabase/functions/_shared/rentabilidadDia.ts";
