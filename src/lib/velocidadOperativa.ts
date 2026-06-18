export const HORAS_OPERATIVAS_DIA = 8;

export function calcularTphOperativa(kg: number | null | undefined, nDias = 1): number | null {
  const kgValue = Number(kg) || 0;
  const diasValue = Number(nDias) || 0;

  if (kgValue <= 0 || diasValue <= 0) {
    return null;
  }

  // Método corregido: toneladas / (días × 8 horas)
  // Usa exactamente 8 horas por día como base fija
  return kgValue / 1000 / (diasValue * HORAS_OPERATIVAS_DIA);
}
