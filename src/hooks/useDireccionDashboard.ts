/**
 * useDireccionDashboard — agrega los KPIs de cabecera de las 4 grandes áreas
 * (Producción / Comercial / RRHH / Económico) para el "Panel de dirección":
 * la portada global que ve el jefe (admin) con un vistazo rápido de todo.
 *
 * No reimplementa lógica de negocio: reutiliza los hooks/queries que ya
 * alimentan cada dashboard de sección para no duplicar queries pesadas ni
 * criterios de cálculo (DJPMN, cumplimiento Mercadona, asistencia, costes...):
 * - Producción: usePartesDashboard (cascada DJPMN) + useMercadona (aprovecha-
 *   miento Mercadona sobre kg confeccionados), igual que src/pages/Dashboard.tsx.
 * - Comercial: useComercialDashboard (ya agrega Mercadona + categorías).
 * - RRHH: useRrhhDashboard (ya agrega plantilla/asistencia/bajas).
 * - Económico: useCostesPeriodo + useMercadonaVentas (mismo cruce que
 *   src/pages/EconomicoPanel.tsx: facturación Mercadona del periodo −
 *   coste de consumos = margen bruto). Solo admin: las tablas
 *   (economico_precios) tienen RLS restringida, así que además de
 *   `sinPermiso` se expone `mostrarEconomico` para que la página pueda
 *   ocultar el bloque completo a otros roles sin disparar la query.
 *
 * Cada área expone su propio `isLoading` para que la página pueda pintar los
 * 4 bloques de forma independiente y degradar con "—" lo que no haya, en vez
 * de bloquear todo el panel a la carga más lenta.
 */
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { usePartesDashboard } from "@/hooks/usePartes";
import { useMercadona } from "@/hooks/useMercadona";
import { useComercialDashboard } from "@/hooks/useComercialDashboard";
import { useRrhhDashboard } from "@/hooks/useRrhhDashboard";
import { useCostesPeriodo, usePreciosRecursos } from "@/hooks/useEconomico";
import { useMercadonaVentas, type MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { buildPeriodoRange } from "@/lib/consumoPeriodoView";
import { calcularTphOperativa } from "@/lib/velocidadOperativa";
import { getSemaforo, type SemaforoState } from "@/lib/semaforo";

const WEEKS_IN_PANEL = 6;

// ─── Semanas ISO (lunes-domingo), mismo criterio que src/pages/Dashboard.tsx ──

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - day);
  d.setHours(12, 0, 0, 0);
  return d;
}

interface SemanaIso {
  start: string;
  end: string;
  weekNumber: number;
  label: string;
}

function buildRecentIsoWeeks(count: number, anchor: Date): SemanaIso[] {
  const currentStart = getWeekStart(anchor);
  return Array.from({ length: count }, (_, index) => {
    const start = addDays(currentStart, (index - count + 1) * 7);
    const end = addDays(start, 6);
    const weekNumber = getIsoWeekNumber(start);
    return { start: toIsoDate(start), end: toIsoDate(end), weekNumber, label: `S${weekNumber}` };
  });
}

// ─── Producción ──────────────────────────────────────────────────────────────

export interface DireccionProduccionEvolucion {
  label: string;
  kg: number;
}

export interface DireccionProduccion {
  isLoading: boolean;
  hayDatos: boolean;
  produccionSemanaKg: number;
  semanaLabel: string;
  dsjPct: number;
  semaforo: SemaforoState;
  velocidadMedia: number | null;
  aprovechamientoMercadonaPct: number;
  aprovechamientoIsLoading: boolean;
  evolucion: DireccionProduccionEvolucion[];
}

function useDireccionProduccion(): DireccionProduccion {
  const semanas = useMemo(() => buildRecentIsoWeeks(WEEKS_IN_PANEL, new Date()), []);
  const currentWeek = semanas[semanas.length - 1];
  // Suficientes días para cubrir el panel de semanas ISO completo.
  const dashboardDays = WEEKS_IN_PANEL * 7 + 7;
  const { partes, loading } = usePartesDashboard(dashboardDays);
  const mercadona = useMercadona(currentWeek.start, currentWeek.end);

  const evolucion = useMemo<DireccionProduccionEvolucion[]>(
    () => semanas.map((s) => {
      const weekPartes = partes.filter((p) => p.date >= s.start && p.date <= s.end);
      const kg = weekPartes.reduce((sum, p) => sum + p.cascade.produccion_real, 0);
      return { label: s.label, kg };
    }),
    [partes, semanas],
  );

  const currentWeekData = useMemo(() => {
    const weekPartes = partes.filter((p) => p.date >= currentWeek.start && p.date <= currentWeek.end);
    const produccion = weekPartes.reduce((s, p) => s + p.cascade.produccion_real, 0);
    const dsj = weekPartes.reduce((s, p) => s + p.cascade.dsj, 0);
    return {
      produccion,
      dsjPct: produccion > 0 ? (dsj / produccion) * 100 : 0,
      nDias: weekPartes.length,
    };
  }, [partes, currentWeek]);

  const velocidadMedia = calcularTphOperativa(currentWeekData.produccion, currentWeekData.nDias);

  return {
    isLoading: loading,
    hayDatos: currentWeekData.nDias > 0,
    produccionSemanaKg: currentWeekData.produccion,
    semanaLabel: currentWeek.label,
    dsjPct: currentWeekData.dsjPct,
    semaforo: getSemaforo(currentWeekData.dsjPct),
    velocidadMedia,
    aprovechamientoMercadonaPct: mercadona.pct_kg,
    aprovechamientoIsLoading: mercadona.isLoading,
    evolucion,
  };
}

// ─── Comercial ───────────────────────────────────────────────────────────────

export interface DireccionComercial {
  isLoading: boolean;
  tablesMissing: boolean;
  hayUltimaSemana: boolean;
  vendidoKg: number;
  hayPlanificado: boolean;
  pctCumplimiento: number;
  tieneBaseIva: boolean;
  eurosPorKg: number;
  kgCategorias: number;
  hasAccessCategorias: boolean;
  evolucion: { label: string; vendido: number; planificado: number }[];
}

function useDireccionComercial(): DireccionComercial {
  const d = useComercialDashboard();
  return {
    isLoading: d.isLoading,
    tablesMissing: d.tablesMissing,
    hayUltimaSemana: d.ultimaSemana != null,
    vendidoKg: d.vendidoKg,
    hayPlanificado: d.planificadoKg > 0,
    pctCumplimiento: d.pctCumplimiento,
    tieneBaseIva: d.tieneBaseIva,
    eurosPorKg: d.eurosPorKg,
    kgCategorias: d.categoriaSegunda.kg + d.categoriaPrimera.kg,
    hasAccessCategorias: d.categoriaSegunda.hasAccess || d.categoriaPrimera.hasAccess,
    evolucion: d.evolucionSemanal,
  };
}

// ─── RRHH ────────────────────────────────────────────────────────────────────

export interface DireccionRrhh {
  isLoading: boolean;
  plantillaActiva: number;
  hayAsistenciaRegistrada: boolean;
  pctAsistenciaUltimoDia: number | null;
  ausenciasSemana: number;
  bajasActivas: number;
}

function useDireccionRrhh(): DireccionRrhh {
  const r = useRrhhDashboard();
  return {
    isLoading: r.isLoading,
    plantillaActiva: r.plantillaActiva,
    hayAsistenciaRegistrada: r.hayAsistenciaRegistrada,
    pctAsistenciaUltimoDia: r.pctAsistenciaUltimoDia,
    ausenciasSemana: r.ausenciasSemana,
    bajasActivas: r.bajasActivas.length,
  };
}

// ─── Económico (solo admin) ──────────────────────────────────────────────────

/** true si la semana trae base_iva real (formato semanal real, v2) — mismo criterio que EconomicoPanel.tsx. */
function semanaTieneBaseIva(semana: MercadonaSemanaConMetodos): boolean {
  return semana.metodos.some((m) => m.base_iva != null) || semana.ajustes_base_iva != null;
}

/** Neto (€) de la semana: suma de base_iva de métodos + ajustes/abonos. */
function netoSemana(semana: MercadonaSemanaConMetodos): number {
  const facturacionMetodos = semana.metodos.reduce((sum, m) => sum + (m.base_iva ?? 0), 0);
  return facturacionMetodos + (semana.ajustes_base_iva ?? 0);
}

function solapaRango(desde: string, hasta: string, rangoStart: string, rangoEnd: string): boolean {
  return desde <= rangoEnd && hasta >= rangoStart;
}

export interface DireccionEconomico {
  mostrar: boolean;
  isLoading: boolean;
  sinPermiso: boolean;
  periodoLabel: string;
  periodoDetail: string;
  facturacionPeriodo: number;
  costeTotal: number;
  margenBruto: number;
  costePorKg: number | null;
  hayPreciosACero: boolean;
}

function useDireccionEconomico(): DireccionEconomico {
  const { role } = useAuth();
  const mostrar = role === "admin";
  const periodo = useMemo(() => buildPeriodoRange("mes", 0), []);

  const { hayPrecioCero, sinPermiso: sinPermisoPrecios, isLoading: loadingPrecios } = usePreciosRecursos();
  const costes = useCostesPeriodo(periodo.start, periodo.end);
  const ventas = useMercadonaVentas();

  const facturacionPeriodo = useMemo(() => {
    if (!mostrar) return 0;
    return ventas.semanas
      .filter(semanaTieneBaseIva)
      .filter((s) => {
        const { desde, hasta } = mercadonaWeekDateRange(s.anio, s.semana);
        return solapaRango(desde, hasta, periodo.start, periodo.end);
      })
      .reduce((sum, s) => sum + netoSemana(s), 0);
  }, [mostrar, ventas.semanas, periodo]);

  const margenBruto = facturacionPeriodo - costes.costeTotal;
  const sinPermiso = sinPermisoPrecios || costes.sinPermiso;
  const isLoading = loadingPrecios || costes.isLoading || ventas.isLoading;

  return {
    mostrar,
    isLoading,
    sinPermiso,
    periodoLabel: periodo.label,
    periodoDetail: periodo.detail,
    facturacionPeriodo,
    costeTotal: costes.costeTotal,
    margenBruto,
    costePorKg: costes.costePorKg,
    hayPreciosACero: hayPrecioCero,
  };
}

// ─── Hook principal ──────────────────────────────────────────────────────────

export function useDireccionDashboard() {
  const produccion = useDireccionProduccion();
  const comercial = useDireccionComercial();
  const rrhh = useDireccionRrhh();
  const economico = useDireccionEconomico();

  return { produccion, comercial, rrhh, economico };
}
