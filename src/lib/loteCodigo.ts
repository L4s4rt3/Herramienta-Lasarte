// La lib vive en supabase/functions/_shared/loteCodigo.ts (patrón
// fotoLotesCoherencia): las edge functions (Deno) y el frontend comparten las
// DOS convenciones de normalización de lote sin copias que diverjan.
// Este re-export mantiene intactos a todos los consumidores de "@/lib/loteCodigo".
export * from "../../supabase/functions/_shared/loteCodigo.ts";
