// La lib vive en supabase/functions/_shared/vigiaNegocio.ts (patrón
// fotoLotesCoherencia): la edge function vigia-negocio (Deno) y el frontend
// comparten las MISMAS funciones puras sin copias que diverjan.
export * from "../../supabase/functions/_shared/vigiaNegocio.ts";
