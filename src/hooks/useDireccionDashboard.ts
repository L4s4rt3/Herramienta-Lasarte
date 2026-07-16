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
 * - Económico: useEconomicoPanel, el MISMO hook que alimenta
 *   src/pages/EconomicoPanel.tsx — no se recompone un margen parcial aquí.
 *   El margen bruto de Dirección es por tanto idéntico al del Panel
 *   Económico para el mismo periodo (facturación Mercadona + 2ª categoría
 *   − consumos − mallas − compra de fruta − coste de personal). Solo admin:
 *   las tablas (economico_precios) tienen RLS restringida, así que además
 *   de `sinPermiso` se expone `mostrar` para que la página pueda ocultar el
 *   bloque completo a otros roles.
 *
 * Cada área expone su propio `isLoading` para que la página pueda pintar los
 * 4 bloques de forma independiente y degradar con "—" lo que no haya, en vez
 * de bloquear todo el panel a la carga más lenta.
 */
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthProvider";
import { usePartesDashboard } from "@/hooks/usePartes";
import { useMercadonaAprovechamiento } from "@/hooks/useMercadonaAprovechamiento";
import { useComercialDashboard, type ComercialMesAnterior } from "@/hooks/useComercialDashboard";
import { useRrhhDashboard } from "@/hooks/useRrhhDashboard";
import { useEconomicoPanel, useCosteFruta, type EconomicoPanelData } from "@/hooks/useEconomico";
import { useMermaLotes } from "@/hooks/useMermaLote";
import { mermaLotesEnPeriodo } from "@/lib/mermaLote";
import { agruparForfait, type ItemForfaitAgrupable } from "@/lib/forfait";
import { buildPeriodoRange } from "@/lib/consumoPeriodoView";
import { calcularTphOperativa } from "@/lib/velocidadOperativa";
import { getSemaforo, type SemaforoState } from "@/lib/semaforo";
import { buildRecentWeeks } from "@/lib/isoWeek";

const WEEKS_IN_PANEL = 6;

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
  mermasPct: number;
  mermasKg: number;
  mermaTotalConDsjPct: number;
  dsjPct: number;
  semaforo: SemaforoState;
  velocidadMedia: number | null;
  aprovechamientoMercadonaPct: number;
  /** true si el % es el vendido real del informe semanal; false si es el estimado por palets. */
  aprovechamientoEsReal: boolean;
  aprovechamientoIsLoading: boolean;
  evolucion: DireccionProduccionEvolucion[];
}

function useDireccionProduccion(): DireccionProduccion {
  const semanas = useMemo(() => buildRecentWeeks(WEEKS_IN_PANEL, new Date()), []);
  const currentWeek = semanas[semanas.length - 1];
  // Suficientes días para cubrir el panel de semanas ISO completo.
  const dashboardDays = WEEKS_IN_PANEL * 7 + 7;
  const { partes, loading } = usePartesDashboard(dashboardDays);
  // Aprovechamiento real (informe semanal) o estimado por palets. Año ISO de la
  // semana = año del jueves (start + 3 días).
  const anioIso = useMemo(() => {
    const jueves = new Date(`${currentWeek.start}T12:00:00`);
    jueves.setDate(jueves.getDate() + 3);
    return jueves.getFullYear();
  }, [currentWeek.start]);
  const aprovechamiento = useMercadonaAprovechamiento(anioIso, currentWeek.weekNumber);

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
    // Merma real: podrido manual + podrido calibrador, mismo criterio que el
    // KPI "Mermas" de src/pages/Dashboard.tsx (no incluye el DSJ).
    const mermas = weekPartes.reduce((s, p) => s + p.cascade.podrido_manual + p.cascade.podrido_calibrador, 0);
    return {
      produccion,
      dsjPct: produccion > 0 ? (dsj / produccion) * 100 : 0,
      mermasKg: mermas,
      mermasPct: produccion > 0 ? (mermas / produccion) * 100 : 0,
      // Merma total ampliada: podridos + DSJ (con signo), como en el Dashboard.
      mermaTotalConDsjPct: produccion > 0 ? ((mermas + dsj) / produccion) * 100 : 0,
      fechas: weekPartes.map((p) => p.date),
      nDias: weekPartes.length,
    };
  }, [partes, currentWeek]);

  const velocidadMedia = calcularTphOperativa(currentWeekData.produccion, currentWeekData.fechas);

  return {
    isLoading: loading,
    hayDatos: currentWeekData.nDias > 0,
    produccionSemanaKg: currentWeekData.produccion,
    semanaLabel: currentWeek.label,
    mermasPct: currentWeekData.mermasPct,
    mermasKg: currentWeekData.mermasKg,
    mermaTotalConDsjPct: currentWeekData.mermaTotalConDsjPct,
    dsjPct: currentWeekData.dsjPct,
    semaforo: getSemaforo(currentWeekData.dsjPct),
    velocidadMedia,
    aprovechamientoMercadonaPct: aprovechamiento.realPct ?? aprovechamiento.estimadoPct,
    aprovechamientoEsReal: aprovechamiento.realPct != null,
    aprovechamientoIsLoading: aprovechamiento.isLoading,
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
  /** Ventas por categoría (1ª+2ª) del mes natural anterior (importador mensual). */
  mesAnterior: ComercialMesAnterior;
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
    mesAnterior: d.mesAnterior,
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
//
// El margen bruto se toma tal cual de useEconomicoPanel (el mismo hook que usa
// EconomicoPanel.tsx) — Dirección NO recompone su propio margen a partir de
// facturación/coste parciales, para no arriesgarse a mostrar un número con el
// mismo nombre ("Margen bruto") pero distinto valor que el Panel Económico.

/**
 * Módulo "Compra de fruta y forfait" (FASE 3 del rediseño): resumen del
 * periodo para promocionar /economico/fruta desde Dirección. `forfaitMedioEurKg`
 * agrupa TODOS los lotes procesados del periodo en un único grupo (misma
 * `agruparForfait` que usa EconomicoFruta.tsx por productor/finca, aquí con
 * una sola clave) — Σcoste/Σaprovechable del periodo, no una media de forfaits.
 * Opcional en el tipo porque `composeDireccionEconomico` (testeado sin red,
 * ver useDireccionDashboard.test.ts) no lo calcula: lo añade `useDireccionEconomico`.
 */
export interface DireccionEconomicoFruta {
  isLoading: boolean;
  kgComprados: number;
  eurosPorKgMedio: number | null;
  forfaitMedioEurKg: number | null;
}

export interface DireccionEconomico {
  mostrar: boolean;
  isLoading: boolean;
  sinPermiso: boolean;
  periodoLabel: string;
  periodoDetail: string;
  /** Facturación Mercadona + ventas 2ª categoría del periodo (panel.facturacionTotalRango). */
  facturacionPeriodo: number;
  /** Consumos + mallas + compra de fruta + coste de personal del periodo (panel.costeTotalPeriodo). */
  costeTotal: number;
  /** Idéntico a panel.margenBruto — mismo número que el Panel Económico para el mismo periodo. */
  margenBruto: number;
  costePorKg: number | null;
  hayPreciosACero: boolean;
  fruta?: DireccionEconomicoFruta;
}

type EconomicoPanelForDireccion = Pick<
  EconomicoPanelData,
  "isLoading" | "sinPermiso" | "hayPrecioCero" | "facturacionTotalRango" | "costeTotalPeriodo" | "margenBruto"
> & { costes: Pick<EconomicoPanelData["costes"], "costePorKg"> };

/**
 * Composición pura (sin hooks) de `DireccionEconomico` a partir de los campos
 * ya calculados por `useEconomicoPanel`. Extraída aparte para poder testear
 * sin montar React Query/Supabase: solo hace passthrough de facturación,
 * coste y margen — no reimplementa ninguna fórmula.
 */
export function composeDireccionEconomico(
  mostrar: boolean,
  periodo: { label: string; detail: string },
  panel: EconomicoPanelForDireccion,
): DireccionEconomico {
  return {
    mostrar,
    isLoading: panel.isLoading,
    sinPermiso: panel.sinPermiso,
    periodoLabel: periodo.label,
    periodoDetail: periodo.detail,
    facturacionPeriodo: panel.facturacionTotalRango,
    costeTotal: panel.costeTotalPeriodo,
    margenBruto: panel.margenBruto,
    costePorKg: panel.costes.costePorKg,
    hayPreciosACero: panel.hayPrecioCero,
  };
}

function useDireccionEconomico(): DireccionEconomico {
  const { role } = useAuth();
  const mostrar = role === "admin";
  const periodo = useMemo(() => buildPeriodoRange("mes", 0), []);

  // Mismo rango ("mes" actual) y mismo hook que EconomicoPanel.tsx por
  // defecto (preset "mes") — de ahí que el margen coincida para el periodo
  // por defecto de ambas páginas.
  const panel = useEconomicoPanel(periodo.start, periodo.end);

  // Módulo "Compra de fruta y forfait": mismos hooks cacheados por React
  // Query que ya usan EconomicoPanel/EconomicoFruta (useCosteFruta,
  // useMermaLotes) — no se reimplementa ninguna fórmula, solo se reagrupan
  // los lotes procesados del periodo en un único grupo con agruparForfait
  // (misma función pura que usa EconomicoFruta.tsx por productor/finca).
  const fruta = useCosteFruta(periodo.start, periodo.end);
  const { lotes: mermaLotesTodos, isLoading: isLoadingMermaLotes } = useMermaLotes();
  const forfaitMedioEurKg = useMemo(() => {
    const procesados = mermaLotesEnPeriodo(mermaLotesTodos, periodo.start, periodo.end)
      .filter((l) => l.estado === "procesado");
    const items: ItemForfaitAgrupable[] = procesados.map((lote) => ({
      lote, groupKey: "periodo", groupLabel: "Periodo",
    }));
    return agruparForfait(items).grupos[0]?.forfaitEurKg ?? null;
  }, [mermaLotesTodos, periodo]);

  return {
    ...composeDireccionEconomico(mostrar, periodo, panel),
    fruta: {
      isLoading: fruta.isLoading || isLoadingMermaLotes,
      kgComprados: fruta.kgTotales,
      eurosPorKgMedio: fruta.kgTotales > 0 ? fruta.totalImporte / fruta.kgTotales : null,
      forfaitMedioEurKg,
    },
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
