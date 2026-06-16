import {
  cuentaTrabajadorKgPersona,
  produccionRealParte,
} from "./asistenciaRendimiento";

interface TrabajadorComparativa {
  id: string;
  zona?: string | null;
}

interface AsistenciaComparativaRow {
  date: string;
  presente: boolean | null;
  trabajador_id: string;
}

export interface DiaComparativaData {
  date: string;
  workers: number;
  kg: number;
  kgPorPersona: number;
}

export interface SemanaComparativaData {
  weekStart: string;
  label: string;
  days: Record<string, DiaComparativaData>;
}

type ParteComparativa = Record<string, unknown> & {
  date?: string | null;
  kg_produccion_calibrador?: number | null;
};

export const ASISTENCIA_COMPARATIVA_RANGE_DAYS = 60;

const DAY_MAP: Record<number, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mie",
  4: "Jue",
  5: "Vie",
  6: "Sab",
  0: "Dom",
};

function num(value: unknown): number {
  return Number(value) || 0;
}

function getWeekStart(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

function formatWeekLabel(weekStart: string) {
  const d = new Date(weekStart + "T12:00:00");
  const day = d.getDate();
  const month = d.toLocaleDateString("es-ES", { month: "short" });
  return `${day} ${month}`;
}

export function contarPersonasComputablesPorDia(
  asistencia: AsistenciaComparativaRow[] | null | undefined,
  trabajadores: TrabajadorComparativa[] | null | undefined,
): Record<string, number> {
  const computables = new Set(
    (trabajadores ?? [])
      .filter(cuentaTrabajadorKgPersona)
      .map((trabajador) => trabajador.id),
  );

  return (asistencia ?? []).reduce<Record<string, number>>((acc, row) => {
    if (row.presente && computables.has(row.trabajador_id)) {
      acc[row.date] = (acc[row.date] ?? 0) + 1;
    }
    return acc;
  }, {});
}

export function kgComparativaParte(parte: ParteComparativa | null | undefined): number {
  return produccionRealParte(parte);
}

export function buildSemanasAsistenciaComparativa({
  asistencia,
  trabajadores,
  produccion,
}: {
  asistencia: AsistenciaComparativaRow[] | null | undefined;
  trabajadores: TrabajadorComparativa[] | null | undefined;
  produccion: ParteComparativa[] | null | undefined;
}): SemanaComparativaData[] {
  const dayWorkers = contarPersonasComputablesPorDia(asistencia, trabajadores);
  const kgByDay: Record<string, number> = {};

  for (const parte of produccion ?? []) {
    if (!parte.date) {
      continue;
    }

    const kg = kgComparativaParte(parte) || num(parte.kg_produccion_calibrador);
    if (kg > 0) {
      kgByDay[parte.date] = (kgByDay[parte.date] ?? 0) + kg;
    }
  }

  const weeksMap: Record<string, SemanaComparativaData> = {};
  for (const [date, workers] of Object.entries(dayWorkers)) {
    const kg = kgByDay[date] ?? 0;
    if (kg === 0) {
      continue;
    }

    const d = new Date(date + "T12:00:00");
    const dayKey = DAY_MAP[d.getDay()];
    const weekStart = getWeekStart(date);
    if (!weeksMap[weekStart]) {
      weeksMap[weekStart] = {
        weekStart,
        label: formatWeekLabel(weekStart),
        days: {},
      };
    }

    weeksMap[weekStart].days[dayKey] = {
      date,
      workers,
      kg,
      kgPorPersona: workers > 0 ? kg / workers : 0,
    };
  }

  return Object.values(weeksMap).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
