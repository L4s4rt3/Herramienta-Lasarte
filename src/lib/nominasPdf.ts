// src/lib/nominasPdf.ts
// Lógica pura (sin Supabase/React/pdf-lib/pdfjs) para la importación masiva de
// nóminas: normalización de nombres y "casado" de cada página del PDF (una
// nómina = una página) contra la plantilla de trabajadores.
//
// Nada aquí lee archivos ni toca IO: recibe el TEXTO ya extraído de una página
// (pdfjs-dist, desde el hook/página) y la lista de trabajadores, y devuelve
// una decisión. Así es 100% testeable sin mockear PDFs reales.

/** Trabajador mínimo necesario para casar una página (ver useTrabajadoresActivos). */
export interface TrabajadorNominaCandidato {
  id: string;
  nombre: string;
}

export type ConfianzaMatch = "alta" | "baja" | "ninguna";

export interface CasarPaginaResultado {
  trabajadorId: string | null;
  confianza: ConfianzaMatch;
  /**
   * Presente cuando hay más de un candidato posible (ambigüedad) o cuando solo
   * hay coincidencias débiles (solo nombre de pila): se muestran en la cola de
   * revisión para que el usuario elija a mano.
   */
  candidatos?: TrabajadorNominaCandidato[];
}

/** Una página del PDF importado, ya clasificada contra la plantilla. */
export interface PaginaNomina {
  indice: number;
  trabajadorId: string | null;
  confianza: ConfianzaMatch;
  textoPreview: string;
}

/**
 * Normaliza un nombre para comparar: quita tildes, pasa a minúsculas, quita
 * comas/puntos y colapsa espacios múltiples.
 *
 * Mismo criterio que `normalizeTrabajadorName` (privada, no exportada) de
 * src/lib/asistenciaTrabajadores.ts — se reimplementa aquí en vez de
 * importarla porque no está exportada y ese archivo no se puede tocar.
 */
export function normalizarNombre(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;]/g, " ")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}

function tokensDeNombre(nombre: string): string[] {
  return normalizarNombre(nombre).split(" ").filter(Boolean);
}

/** ¿Aparece `token` como palabra completa (no como substring de otra palabra) en el texto normalizado? */
function contieneToken(textoNormalizado: string, token: string): boolean {
  if (!token) return false;
  const escapado = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escapado}(\\s|$)`).test(textoNormalizado);
}

interface EvaluacionTrabajador {
  /** Nombre Y apellido (primer y último token) presentes → match seguro. */
  completo: boolean;
  /** Solo el nombre de pila (primer token) presente, sin confirmar apellido → ambiguo. */
  soloNombre: boolean;
}

function evaluarTrabajador(textoNormalizado: string, trabajador: TrabajadorNominaCandidato): EvaluacionTrabajador {
  const tokens = tokensDeNombre(trabajador.nombre);
  if (tokens.length === 0) return { completo: false, soloNombre: false };

  // Exigimos nombre + apellido (primer y último token) para evitar falsos
  // positivos entre personas que comparten nombre de pila. Si el trabajador
  // solo tiene un token de nombre, ese único token es lo que se exige.
  const requeridos = tokens.length >= 2 ? [tokens[0], tokens[tokens.length - 1]] : tokens;
  const completo = requeridos.every((token) => contieneToken(textoNormalizado, token));
  const soloNombre = !completo && contieneToken(textoNormalizado, tokens[0]);

  return { completo, soloNombre };
}

/**
 * Dado el texto de una página del PDF de nóminas y la lista de trabajadores,
 * decide a quién pertenece esa página.
 *
 * - "alta": exactamente un trabajador tiene nombre+apellido presentes en el texto.
 * - "baja": hay ambigüedad (varios trabajadores casan completos, o solo hay
 *   coincidencias débiles por nombre de pila) — se listan en `candidatos` para
 *   que el usuario resuelva a mano en la cola de revisión.
 * - "ninguna": no hay ninguna coincidencia, ni siquiera débil.
 */
export function casarPaginaConTrabajador(
  textoPagina: string,
  trabajadores: readonly TrabajadorNominaCandidato[],
): CasarPaginaResultado {
  const textoNormalizado = normalizarNombre(textoPagina);

  const completos = trabajadores.filter((t) => evaluarTrabajador(textoNormalizado, t).completo);
  if (completos.length === 1) {
    return { trabajadorId: completos[0].id, confianza: "alta" };
  }
  if (completos.length > 1) {
    // Varios trabajadores con nombre+apellido detectados en la misma página:
    // no debería pasar con datos limpios, pero por seguridad no se asigna solo.
    return { trabajadorId: null, confianza: "baja", candidatos: completos };
  }

  const parciales = trabajadores.filter((t) => evaluarTrabajador(textoNormalizado, t).soloNombre);
  if (parciales.length > 0) {
    return { trabajadorId: null, confianza: "baja", candidatos: parciales };
  }

  return { trabajadorId: null, confianza: "ninguna" };
}
