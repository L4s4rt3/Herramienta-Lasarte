// src/lib/supabaseErrors.ts — helpers puros para clasificar errores de
// Supabase/PostgREST que varios hooks necesitan para DEGRADAR una página
// (mostrar "sin permiso"/"sección pendiente") en vez de romperla con un error
// crudo.
//
// CONSOLIDACIÓN PARCIAL (hallazgo de auditoría del CMV, jul 2026): el mismo
// `isPermissionError` (código 42501/PGRST301/PGRST302, HTTP 401/403, mensaje
// "permission denied"/"row level security") vivía copiado en useEconomico.ts,
// useCosteMallas.ts, useEmpaquePrecios.ts, useRrhhDocs.ts y useCmv.ts. Se
// extrajo aquí y useCmv.ts + useRrhhDocs.ts ya importan desde este módulo
// (useRrhhDocs.ts lo re-exporta tal cual para no romper a quien lo importaba
// de ahí). El resto de copias (useEconomico.ts, useCosteMallas.ts,
// useEmpaquePrecios.ts) NO se tocaron en esta pasada — mismo criterio,
// duplicado, pendiente de una migración aparte.
//
// "Tabla o columna inexistente" (migración sin aplicar) tiene su propio
// helper ya consolidado: `esErrorTablaOColumnaInexistente` en
// src/lib/productoresCanonicos.ts — no se duplica aquí.

const PERMISSION_ERROR_CODES = new Set(["42501", "PGRST301", "PGRST302"]);

/** Distingue "sin permiso RLS" (degradar con aviso) de otros errores (relanzar). */
export function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; status?: number };
  if (record.code && PERMISSION_ERROR_CODES.has(record.code)) return true;
  if (record.status === 401 || record.status === 403) return true;
  const message = (record.message ?? "").toLowerCase();
  return (
    message.includes("permission denied") ||
    message.includes("row-level security") ||
    message.includes("row level security")
  );
}
