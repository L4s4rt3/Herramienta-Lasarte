// La lib vive en supabase/functions/_shared/cierreMensual.ts (patrón
// fotoLotesCoherencia): la edge function cierre-mensual (Deno) y el frontend
// comparten las MISMAS funciones puras sin copias que diverjan.
export * from "../../supabase/functions/_shared/cierreMensual.ts";
