export const HORAS_OPERATIVAS_DIA = 8;

export function calcularTphOperativa(kg: number | null | undefined, horas = 8): number | null {
  const kgValue = Number(kg) || 0;
  const horasValue = Number(horas) || 0;

  if (kgValue <= 0 || horasValue <= 0) {
    return null;
  }

  // Nuevo método: toneladas / horas_reales (más preciso)
  // Parámetro horas ahora representa horas reales trabajadas
  return kgValue / 1000 / horasValue;
}
