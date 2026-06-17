export interface ProductionEvolutionPoint {
  date: string;
  kg: number;
}

export function shouldShowProductionEvolution(points: readonly ProductionEvolutionPoint[]): boolean {
  return points.length > 1;
}
