/**
 * recicladoZonas.ts — tara de los box de reciclaje POR ZONA (regla del dueño,
 * 2026-07-29): "si hay 3 box en Z1, se quitan 90 kg del peso que se muestra
 * en la celda". El operario apunta el BRUTO del papel y los box de cada zona;
 * la app calcula el NETO aquí (fórmula única, la misma que ya usaba el OCR en
 * partManualVision.ts) y lo guarda en kg_reciclado_malla_z1/z2 — que siguen
 * siendo lo que consume todo lo demás (cascada, conciliación, coste de
 * mallas).
 */

/** Tara física de un box de reciclaje. Única fuente (antes vivía duplicada en conciliacionKg.ts —sin usos— y partManualVision.ts). */
export const TARA_BOX_KG = 30;

/**
 * Neto de fruta de una zona: bruto del papel − box × 30. Una FRACCIÓN de box
 * ocupa un box físico completo (⌈box⌉, mismo criterio que el OCR). Clamp a 0:
 * un bruto menor que su tara es un error de papel, no fruta negativa.
 */
export function netoRecicladoZona(brutoKg: number, nBox: number | null | undefined): number {
  const bruto = Number(brutoKg) || 0;
  const box = nBox == null ? 0 : Math.max(0, Math.ceil(Number(nBox) || 0));
  return Math.max(0, bruto - box * TARA_BOX_KG);
}
