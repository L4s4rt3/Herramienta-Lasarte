/**
 * Normalización de códigos de lote — DOS convenciones DISTINTAS a propósito.
 * No las unifiques: cada una casa con un dato de origen distinto y cambiar
 * cualquiera de las dos rompería el cruce con datos ya guardados.
 *
 * Convención A — `normalizarLoteCodigo`: primer grupo de 8 dígitos que
 * aparezca en cualquier posición del texto (clave global "AAMMDDNN"). El
 * calibrador a veces guarda el lote con texto pegado ("26042712 + 7 BOX DE
 * RECICLAJE"); la báscula lo guarda limpio. Usada por: useEntradasBascula,
 * useTrazabilidadLote, EntradasBascula.tsx, TrazabilidadLote.tsx (y
 * buildStockEntradas en entradasBascula.ts).
 *
 * Convención B — `prefijoNumericoLote`: los dígitos del INICIO del texto
 * (/^(\d+)/), sin exigir 8 dígitos ni buscarlos en cualquier posición. Se usa
 * como "código base" para emparejar por part_id cuando el código completo no
 * casa de forma exacta (columna `lote_codigo_base`). Usada por:
 * supabase/functions/analizar-lote-excel/index.ts:~106 (Deno no puede
 * importar de src/lib — esa función replica esta misma lógica a mano, con un
 * comentario que apunta aquí) y src/hooks/useAnalisisDiario.ts.
 */

/** Convención A: primer grupo de 8 dígitos en cualquier posición ("AAMMDDNN"). */
export function normalizarLoteCodigo(value: string | null | undefined): string | null {
  const match = String(value ?? "").match(/\d{8}/);
  return match ? match[0] : null;
}

/** Convención B: dígitos iniciales del texto (código base, sin longitud fija). */
export function prefijoNumericoLote(value: string | null | undefined): string | null {
  const match = String(value ?? "").match(/^(\d+)/);
  return match ? match[1] : null;
}
