export interface BajaLaboralPeriodo {
  fecha_inicio: string;
  fecha_fin?: string | null;
}

export function enumerateIsoDateRange(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (end < start) return [];

  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(formatIsoDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function shouldApplyBajaLaboralToDate(periodo: BajaLaboralPeriodo, date: string): boolean {
  if (date < periodo.fecha_inicio) return false;
  if (periodo.fecha_fin && date > periodo.fecha_fin) return false;
  return true;
}

export function previousIsoDate(date: string): string {
  const parsed = parseIsoDate(date);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return formatIsoDate(parsed);
}

function parseIsoDate(date: string): Date {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Fecha invalida: ${date}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
