/**
 * podridoInspecciones.ts — muestreos manuales de podrido por lote.
 *
 * El almacén cuenta las naranjas podridas de N box de un lote en la línea
 * (primer caso real, 27-jul-2026: lote 26050508, 7 box, 12,66% podrido tras
 * 78 días en cámara de Guadex). El nº de naranjas por box no se cuenta una a
 * una: se deriva del peso del box y del peso medio de una naranja
 * (kg_por_box / peso_naranja_kg). Todo el cálculo es determinista y va aquí
 * para poder testearlo; la tabla podrido_inspecciones (migración
 * 20260727120000) guarda tanto las entradas como los totales calculados.
 *
 * La inspección es una SEÑAL de calidad (fracción de fruta podrida a la
 * llegada): no entra en ninguna suma de pérdidas (el podrido pesado ya lo
 * capturan bateas/calibrador/informe LOTE) — sirve para contrastarlas.
 */

export interface InspeccionPodridoInput {
  /** Peso medio de una naranja, en gramos (p. ej. 176,11). */
  pesoNaranjaG: number;
  /** Kg de fruta de cada box inspeccionado (p. ej. 196). */
  kgPorBox: number;
  /** Naranjas podridas contadas en cada box (un elemento por box). */
  podridasPorBox: number[];
}

export interface InspeccionPodridoCalculo {
  naranjasPorBox: number;
  nBox: number;
  naranjasInspeccionadas: number;
  naranjasPodridas: number;
  /** Fracción 0-1 (no %). */
  pctPodrido: number;
  porBox: Array<{ podridas: number; pct: number }>;
}

/** Deriva los totales de una inspección. `null` si los datos no dan para calcular (sin adivinar). */
export function computeInspeccionPodrido(input: InspeccionPodridoInput): InspeccionPodridoCalculo | null {
  const { pesoNaranjaG, kgPorBox, podridasPorBox } = input;
  if (!(pesoNaranjaG > 0) || !(kgPorBox > 0) || podridasPorBox.length === 0) return null;
  if (podridasPorBox.some((n) => !Number.isFinite(n) || n < 0)) return null;

  const naranjasPorBox = Math.round(kgPorBox / (pesoNaranjaG / 1000));
  if (naranjasPorBox <= 0) return null;
  // Más podridas que naranjas en un box = error de registro, no se calcula.
  if (podridasPorBox.some((n) => n > naranjasPorBox)) return null;

  const naranjasInspeccionadas = naranjasPorBox * podridasPorBox.length;
  const naranjasPodridas = podridasPorBox.reduce((s, n) => s + n, 0);
  return {
    naranjasPorBox,
    nBox: podridasPorBox.length,
    naranjasInspeccionadas,
    naranjasPodridas,
    pctPodrido: naranjasPodridas / naranjasInspeccionadas,
    porBox: podridasPorBox.map((podridas) => ({ podridas, pct: podridas / naranjasPorBox })),
  };
}

/** Parsea "119, 136 128;144" → [119, 136, 128, 144]. `null` si algo no es un entero ≥ 0. */
export function parsePodridasPorBox(text: string): number[] | null {
  const partes = text.split(/[\s,;]+/).filter((t) => t.length > 0);
  if (partes.length === 0) return null;
  const nums = partes.map((t) => Number(t));
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return nums;
}
