import { produccionRealParte } from "./asistenciaRendimiento";

type ParteAnalisisProduccion = Record<string, unknown>;

export function calcularProduccionRealParteAnalisis(parte: ParteAnalisisProduccion | null | undefined): number {
  return produccionRealParte(parte);
}

export function calcularProduccionRealPartesAnalisis(partes: readonly (ParteAnalisisProduccion | null | undefined)[]): number {
  return partes.reduce((total, parte) => total + calcularProduccionRealParteAnalisis(parte), 0);
}
