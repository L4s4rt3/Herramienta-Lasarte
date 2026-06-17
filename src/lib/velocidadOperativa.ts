export const HORAS_OPERATIVAS_DIA = 8;

export function calcularTphOperativa(kg: number | null | undefined, dias = 1): number | null {
  const kgValue = Number(kg) || 0;
  const diasValue = Number(dias) || 0;

  if (kgValue <= 0 || diasValue <= 0) {
    return null;
  }

  return kgValue / 1000 / (diasValue * HORAS_OPERATIVAS_DIA);
}
