import { produccionRealParte, cuentaTrabajadorKgPersona, calcularRendimientoGrupos, RENDIMIENTO_GRUPOS } from "./asistenciaRendimiento";
import { calcularRendimientoZonasAlmacen } from "./asistenciaPlantilla";
import { clasificarProductoInforme } from "./asistenciaProductoClasificacion";
import { shouldApplyBajaLaboralToDate } from "./asistenciaBajasLaborales";
import type { TrabajadorRow } from "./types";
import type { AsistenciaBajaLaboralRow } from "./types";

export interface DiaSemanaData {
  date: string;
  presente: boolean | null;
  motivo_ausencia: string | null;
}

export interface SemanaDataRaw {
  weekStart: string;
  weekEnd: string;
  days: string[];
  trabajadores: TrabajadorRow[];
  asistencia: Record<string, DiaSemanaData[]>;
  bajasLaborales: AsistenciaBajaLaboralRow[];
  partes: Record<string, ParteSemanal | null>;
}

interface ParteSemanal {
  id?: string;
  kg_produccion_calibrador?: number | null;
  kg_industria_manual?: number | null;
  kg_mujeres_calibrador?: number | null;
  kg_reciclado_malla_z1?: number | null;
  kg_reciclado_malla_z2?: number | null;
  resumen_ia?: unknown;
  producto_dia?: ProductoSemanal[];
}

interface ProductoSemanal {
  linea?: string | null;
  producto?: string | null;
  formato_caja?: string | null;
  kg?: number | string | null;
  kg_neto?: number | string | null;
  n_cajas?: number | string | null;
  grupo_destino?: string | null;
}

export interface FaltasSemanalesRow {
  trabajadorId: string;
  nombre: string;
  zona: string | null;
  days: Record<string, "presente" | "ausente" | "baja" | "sinRegistrar">;
  totalFaltas: number;
  totalBajas: number;
  totalPresentes: number;
  totalSinRegistrar: number;
}

export interface DiaGrupoData {
  date: string;
  kg: number;
  personas: number;
}

export interface RendimientoGrupoSemanal {
  label: string;
  totalKg: number;
  totalPersonasDia: number;
  mediaPersonasDia: number;
  kgPersona: number;
  porcentajeKg: number;
  daily: DiaGrupoData[];
}

export interface ProductoClasificadoSemanal {
  producto: string;
  empaque: string;
  zona: string;
  computa: boolean;
  kg: number;
}

export const INCLUIR_SABADO_STORAGE_KEY = "lasarte.asistencia.incluirSabado";

const RENDIMIENTO_GROUP_LABELS: Record<string, string> = {
  Envasadoras: "Mesas",
  Industria: "Industria",
  Mallas: "Mallas",
  Graneleras: "Graneleras",
};

function buildDailyAsistencia(semana: SemanaDataRaw, date: string): Record<string, boolean> {
  const asistencia: Record<string, boolean> = {};
  for (const [trabajadorId, registros] of Object.entries(semana.asistencia)) {
    const diaData = registros.find((r) => r.date === date);
    if (diaData) {
      asistencia[trabajadorId] = diaData.presente === true;
    }
  }
  for (const baja of semana.bajasLaborales) {
    if (shouldApplyBajaLaboralToDate(baja, date)) {
      if (asistencia[baja.trabajador_id] !== true) {
        asistencia[baja.trabajador_id] = false;
      }
    }
  }
  return asistencia;
}

function tieneBajaActiva(bajasLaborales: AsistenciaBajaLaboralRow[], trabajadorId: string, date: string): boolean {
  return bajasLaborales.some((b) => b.trabajador_id === trabajadorId && shouldApplyBajaLaboralToDate(b, date));
}

export function getDiasLaborables(dates: string[], incluirSabado: boolean): string[] {
  return dates.filter((date) => {
    const d = new Date(date + "T12:00:00");
    const day = d.getDay();
    if (day === 0) return false;
    if (day === 6 && !incluirSabado) return false;
    return true;
  });
}

export function getWeekDates(dateStr: string): string[] {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const next = new Date(monday);
    next.setDate(monday.getDate() + i);
    dates.push(next.toISOString().slice(0, 10));
  }
  return dates;
}

export function getWeekLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const start = new Date(dates[0] + "T12:00:00");
  const end = new Date(dates[dates.length - 1] + "T12:00:00");
  const fmt = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  return `${fmt(start)} - ${fmt(end)} ${end.getFullYear()}`;
}

export function getWeekShortLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const start = new Date(dates[0] + "T12:00:00");
  const fmt = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  return `Sem ${fmt(start)}`;
}

export function shiftWeek(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

export function buildFaltasSemanales(
  semana: SemanaDataRaw,
  incluirSabado = false,
): FaltasSemanalesRow[] {
  const diasLaborables = getDiasLaborables(semana.days, incluirSabado);
  const BAJA_LABORAL_MOTIVO = "baja_laboral";
  const trabajadorDias: Record<string, FaltasSemanalesRow> = {};

  for (const t of semana.trabajadores.filter((t) => t.activo)) {
    const days: Record<string, "presente" | "ausente" | "baja" | "sinRegistrar"> = {};
    for (const date of semana.days) {
      days[date] = "sinRegistrar";
    }
    trabajadorDias[t.id] = {
      trabajadorId: t.id,
      nombre: t.nombre,
      zona: t.zona,
      days,
      totalFaltas: 0,
      totalBajas: 0,
      totalPresentes: 0,
      totalSinRegistrar: 0,
    };
  }

  for (const [trabajadorId, registros] of Object.entries(semana.asistencia)) {
    const row = trabajadorDias[trabajadorId];
    if (!row) continue;
    for (const r of registros) {
      if (r.presente === true) {
        const tieneBaja = tieneBajaActiva(semana.bajasLaborales, trabajadorId, r.date);
        row.days[r.date] = tieneBaja ? "baja" : "presente";
      } else if (r.presente === false) {
        const esBaja = r.motivo_ausencia === BAJA_LABORAL_MOTIVO || tieneBajaActiva(semana.bajasLaborales, trabajadorId, r.date);
        row.days[r.date] = esBaja ? "baja" : "ausente";
      }
    }
  }

  for (const row of Object.values(trabajadorDias)) {
    for (const date of diasLaborables) {
      if (row.days[date] === "sinRegistrar" && tieneBajaActiva(semana.bajasLaborales, row.trabajadorId, date)) {
        row.days[date] = "baja";
      }
    }
  }

  for (const row of Object.values(trabajadorDias)) {
    for (const date of diasLaborables) {
      const status = row.days[date] ?? "sinRegistrar";
      if (status === "presente") row.totalPresentes++;
      else if (status === "ausente") row.totalFaltas++;
      else if (status === "baja") row.totalBajas++;
      else if (status === "sinRegistrar") row.totalSinRegistrar++;
    }
  }

  return Object.values(trabajadorDias).sort((a, b) => {
    const zonaCmp = (a.zona ?? "").localeCompare(b.zona ?? "", "es") || a.nombre.localeCompare(b.nombre, "es");
    return zonaCmp;
  });
}

export function calcularKgPersonaSemanal(semana: SemanaDataRaw, incluirSabado = false): {
  totalKg: number;
  mediaPersonasComputables: number;
  mediaPersonasTotales: number;
  kgPersona: number;
  diasConDatos: number;
} {
  const diasLaborables = getDiasLaborables(semana.days, incluirSabado);
  let totalKg = 0;
  let totalPersonasComputables = 0;
  let totalPersonasPresentes = 0;
  let diasConDatos = 0;

  for (const date of diasLaborables) {
    const dailyAsistencia = buildDailyAsistencia(semana, date);
    const parte = semana.partes[date];
    const kg = parte ? produccionRealParte(parte) || Number(parte.kg_produccion_calibrador) || 0 : 0;
    const tieneProduccion = kg > 0;
    if (tieneProduccion) {
      totalKg += kg;
      diasConDatos++;
    }

    for (const t of semana.trabajadores) {
      if (!t.activo) continue;
      if (dailyAsistencia[t.id] === true) {
        totalPersonasPresentes++;
        // Para kg/persona solo se cuentan las personas de los días con producción,
        // de modo que numerador (kg) y denominador (personas) cubran los mismos días.
        if (tieneProduccion && cuentaTrabajadorKgPersona(t)) totalPersonasComputables++;
      }
    }
  }

  const totalWorkingDays = diasLaborables.length;
  const mediaPersonas = diasConDatos > 0 ? totalPersonasComputables / diasConDatos : 0;
  const mediaTotales = totalWorkingDays > 0 ? totalPersonasPresentes / totalWorkingDays : 0;
  const kgPersona = mediaPersonas > 0 ? totalKg / mediaPersonas : 0;

  return { totalKg, mediaPersonasComputables: mediaPersonas, mediaPersonasTotales: mediaTotales, kgPersona, diasConDatos };
}

export function calcularRendimientoGrupoSemanal(semana: SemanaDataRaw, incluirSabado = false): RendimientoGrupoSemanal[] {
  const diasLaborables = getDiasLaborables(semana.days, incluirSabado);
  const gruposKg: Record<string, number> = {};
  const gruposPersonas: Record<string, number> = {};
  const gruposDaily: Record<string, DiaGrupoData[]> = {};

  for (const grupo of RENDIMIENTO_GRUPOS) {
    gruposKg[grupo] = 0;
    gruposPersonas[grupo] = 0;
    gruposDaily[grupo] = [];
  }

  const GRUPO_TO_ZONA: Record<string, string> = {
    Envasadoras: "mesas",
    Industria: "industria",
    Mallas: "mallas",
    Graneleras: "granelRp",
  };

  for (const date of diasLaborables) {
    const dailyAsistencia = buildDailyAsistencia(semana, date);
    const dailyGrupos = calcularRendimientoGrupos({
      parte: (semana.partes[date] ?? null) as Record<string, unknown> | null | undefined,
      trabajadores: semana.trabajadores,
      asistencia: dailyAsistencia,
    });

    const trabajadoresActivos = semana.trabajadores.filter((t) => t.activo);
    const dailyZonas = calcularRendimientoZonasAlmacen({
      trabajadores: trabajadoresActivos,
      asistencia: dailyAsistencia,
      kgPorZona: {
        mallas: dailyGrupos.Mallas.kg,
        granelRp: dailyGrupos.Graneleras.kg,
        mesas: dailyGrupos.Envasadoras.kg,
        industria: dailyGrupos.Industria.kg,
      },
    });

    for (const grupo of RENDIMIENTO_GRUPOS) {
      const kg = dailyGrupos[grupo].kg;
      const zonaId = GRUPO_TO_ZONA[grupo];
      const zonaData = dailyZonas.zonas.find((z) => z.id === zonaId);
      const personas = zonaData?.presentes ?? dailyGrupos[grupo].personas;

      gruposKg[grupo] += kg;
      gruposPersonas[grupo] += personas;
      gruposDaily[grupo].push({ date, kg, personas });
    }
  }

  const totalKgGrupos = Object.values(gruposKg).reduce((s, v) => s + v, 0);
  const totalWorkingDays = diasLaborables.length;

  return RENDIMIENTO_GRUPOS.map((grupo) => {
    const kg = gruposKg[grupo];
    const personas = gruposPersonas[grupo];
    const mediaPersonasDia = totalWorkingDays > 0 ? personas / totalWorkingDays : 0;
    const kgPersona = mediaPersonasDia > 0 ? kg / mediaPersonasDia : 0;
    const porcentajeKg = totalKgGrupos > 0 ? (kg / totalKgGrupos) * 100 : 0;
    return {
      label: RENDIMIENTO_GROUP_LABELS[grupo] ?? grupo,
      totalKg: kg,
      totalPersonasDia: personas,
      mediaPersonasDia,
      kgPersona,
      porcentajeKg,
      daily: gruposDaily[grupo],
    };
  });
}

export function calcularKgSeccionSemanal(semana: SemanaDataRaw, incluirSabado = false): { zona: string; kg: number; computa: boolean }[] {
  const diasLaborables = getDiasLaborables(semana.days, incluirSabado);
  const zonaKg: Record<string, { kg: number; computa: boolean }> = {};

  for (const date of diasLaborables) {
    const parte = semana.partes[date];
    if (!parte) continue;
    const productoDia = parte.producto_dia ?? [];
    for (const item of productoDia) {
      if (!item.producto?.trim()) continue;
      const clasificacion = clasificarProductoInforme({
        producto: item.producto,
        empaque: item.formato_caja,
        formato_caja: item.formato_caja,
        grupo_destino: item.grupo_destino,
        linea: item.linea,
      });
      const zona = clasificacion.zona;
      if (!zonaKg[zona]) zonaKg[zona] = { kg: 0, computa: clasificacion.computaKgZona };
      const itemKg = Number(item.kg ?? item.kg_neto) || 0;
      zonaKg[zona].kg += itemKg;
    }
  }

  return Object.entries(zonaKg)
    .map(([zona, data]) => ({ zona, kg: data.kg, computa: data.computa }))
    .filter((item) => item.kg > 0)
    .sort((a, b) => b.kg - a.kg);
}

export function productosClasificadosSemanales(semana: SemanaDataRaw, incluirSabado = false): ProductoClasificadoSemanal[] {
  const diasLaborables = getDiasLaborables(semana.days, incluirSabado);
  const productMap = new Map<string, ProductoClasificadoSemanal>();

  for (const date of diasLaborables) {
    const parte = semana.partes[date];
    if (!parte) continue;
    const productoDia = parte.producto_dia ?? [];
    for (const item of productoDia) {
      if (!item.producto?.trim()) continue;
      const clasificacion = clasificarProductoInforme({
        producto: item.producto,
        empaque: item.formato_caja,
        formato_caja: item.formato_caja,
        grupo_destino: item.grupo_destino,
        linea: item.linea,
      });
      const key = `${item.producto?.trim()}|${item.formato_caja?.trim() ?? ""}`;
      const itemKg = Number(item.kg ?? item.kg_neto) || 0;
      if (productMap.has(key)) {
        const existing = productMap.get(key)!;
        existing.kg += itemKg;
      } else {
        productMap.set(key, {
          producto: item.producto?.trim() || "Sin producto",
          empaque: item.formato_caja?.trim() || "Sin empaque",
          zona: clasificacion.zona,
          computa: clasificacion.computaKgZona,
          kg: itemKg,
        });
      }
    }
  }

  return Array.from(productMap.values())
    .sort((a, b) => {
      if (a.computa !== b.computa) return a.computa ? -1 : 1;
      return b.kg - a.kg || a.producto.localeCompare(b.producto, "es");
    });
}
