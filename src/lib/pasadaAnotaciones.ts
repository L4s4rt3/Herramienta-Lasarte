/**
 * pasadaAnotaciones — anotación a posteriori de qué MÁS se echó en una pasada
 * del calibrador (lotes_dia): lotes o precalibrados que planta metió a la
 * línea sin escribirlos en el código de la pasada. Ver la migración
 * supabase/migrations/20260804150000_pasada_anotaciones.sql.
 *
 * DISEÑO (encargo del dueño, 04-ago-2026): el motor (conciliarKgProcesados,
 * src/lib/conciliacionKg.ts) no sabe NADA de esta tabla ni se toca — la
 * anotación se INYECTA antes de llamar al motor (useEntradasBascula.ts, al
 * construir las `pasadas`): se añade al lote_codigo EFECTIVO de la fila de
 * lotes_dia el código extra, exactamente como si el calibrador lo hubiera
 * escrito él mismo. Así el reparto nombrado de la fase 1 (el principal se
 * llena primero, el resto según el ORDEN en que se anotó — regla del dueño,
 * jamás FIFO) sale gratis de conciliarKgProcesados sin duplicar ninguna
 * fórmula: para el motor, un código anotado es indistinguible de un código
 * que el calibrador escribió de verdad.
 *
 * ORDEN: la tabla no tiene columna de posición explícita (solo lo que pidió
 * el dueño: id/user_id/lote_dia_id/codigo_extra/nota/created_at) — el orden
 * de prioridad se conserva con `created_at` ascendente, así que las
 * mutaciones de alta (useEntradasBascula.ts) insertan las filas de una misma
 * pasada UNA A UNA (nunca en un solo INSERT por lotes) para garantizar
 * timestamps crecientes de verdad entre códigos de la misma pasada.
 */
import { normalizarLoteCodigo } from "@/lib/loteCodigo";

export interface PasadaAnotacionRow {
  id: string;
  user_id: string;
  lote_dia_id: string;
  codigo_extra: string;
  nota: string | null;
  created_at: string;
}

/**
 * Construye el lote_codigo EFECTIVO de una pasada: el texto ORIGINAL tal
 * cual (el código principal jamás se toca, siempre queda primero) más los
 * códigos anotados que no aparezcan YA en el texto original, en el orden
 * dado (ver cabecera del módulo sobre por qué el orden importa), sin repetir
 * ninguno entre sí (dos anotaciones del mismo código, o el mismo código
 * anotado dos veces por error). Sin códigos extra, devuelve el texto
 * original SIN TOCAR NI UN CARÁCTER — no-op para el caso normal (pasada sin
 * anotación).
 */
export function construirLoteCodigoEfectivo(
  loteCodigoOriginal: string | null | undefined,
  codigosExtra: string[],
): string {
  const original = String(loteCodigoOriginal ?? "");
  if (codigosExtra.length === 0) return original;

  // Códigos YA presentes en el texto original (en cualquier posición, igual
  // que normalizarLoteCodigo/conciliarKgProcesados extraen códigos): nunca se
  // repiten. Se va ampliando también con cada extra ya añadido, para no
  // repetir tampoco entre sí las anotaciones.
  const yaPresentes = new Set(original.match(/\d{8}/g) ?? []);
  const extras: string[] = [];
  for (const codigo of codigosExtra) {
    if (yaPresentes.has(codigo)) continue;
    yaPresentes.add(codigo);
    extras.push(codigo);
  }
  if (extras.length === 0) return original;

  const base = original.trim();
  return base ? `${base} - ${extras.join(" - ")}` : extras.join(" - ");
}

/**
 * Agrupa las anotaciones por pasada (lote_dia_id), en el ORDEN en que se
 * indicaron (created_at asc, id como desempate estable ante un timestamp
 * idéntico) — mismo orden que necesita `construirLoteCodigoEfectivo` para
 * respetar "el resto según indicación, jamás FIFO".
 */
export function agruparAnotacionesPorLoteDia(
  anotaciones: PasadaAnotacionRow[],
): Map<string, PasadaAnotacionRow[]> {
  const ordenadas = [...anotaciones].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const mapa = new Map<string, PasadaAnotacionRow[]>();
  for (const a of ordenadas) {
    const arr = mapa.get(a.lote_dia_id) ?? [];
    arr.push(a);
    mapa.set(a.lote_dia_id, arr);
  }
  return mapa;
}

/**
 * Separa por comas, espacios o saltos de línea y normaliza cada trozo a su
 * código de 8 dígitos (Convención A), sin duplicados y conservando el orden
 * de aparición — el usuario teclea los códigos en el orden que quiere que el
 * motor los llene (regla del dueño: nunca FIFO, según indicación). Mismo
 * criterio que ConfirmarLotesEnCamaraDialog.tsx (parsearCodigos).
 */
export function parsearCodigosAnotacion(texto: string): string[] {
  const vistos = new Set<string>();
  const codigos: string[] = [];
  for (const trozo of texto.split(/[,\s]+/)) {
    const codigo = normalizarLoteCodigo(trozo);
    if (codigo && !vistos.has(codigo)) {
      vistos.add(codigo);
      codigos.push(codigo);
    }
  }
  return codigos;
}

export interface ValidacionCodigosAnotacion {
  encontrados: string[];
  noEncontrados: string[];
}

/**
 * Separa los códigos parseados en encontrados/no-encontrados contra el
 * conjunto de códigos que SÍ existen en báscula (entradas_bascula, incluido
 * el precalibrado interno — el dueño puede anotar tanto un lote real como una
 * re-entrada PREC). Nunca se inventa un cruce: lo que no está en
 * `codigosBascula` se reporta tal cual para que el usuario lo revise, igual
 * que ConfirmarLotesEnCamaraDialog.tsx con los "no encontrados".
 */
export function validarCodigosContraBascula(
  codigos: string[],
  codigosBascula: Set<string>,
): ValidacionCodigosAnotacion {
  const encontrados: string[] = [];
  const noEncontrados: string[] = [];
  for (const codigo of codigos) {
    if (codigosBascula.has(codigo)) encontrados.push(codigo);
    else noEncontrados.push(codigo);
  }
  return { encontrados, noEncontrados };
}
