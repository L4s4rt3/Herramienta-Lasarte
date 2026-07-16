import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePartesDashboard, computeRecicladoAgg, RecicladoAgg } from "@/hooks/usePartes";
import { useMercadona } from "@/hooks/useMercadona";
import { useMercadonaAprovechamiento } from "@/hooks/useMercadonaAprovechamiento";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { useMermaLotes } from "@/hooks/useMermaLote";
import { useUltimaJornadaCalidad } from "@/hooks/useCalidadJornada";
import { useUltimoParteLimpieza } from "@/hooks/useLimpiezaBox";
import { ConfeccionZonas } from "@/components/ConfeccionZonas";
import { KPICard } from "@/components/KPICard";
import { SemaforoPill } from "@/components/SemaforoPill";
import { InfoTooltip } from "@/components/InfoTooltip";
import { DsjScale } from "@/components/DsjScale";
import { Sparkline } from "@/components/Sparkline";
import { AutoWeekFallbackNotice } from "@/components/AutoWeekFallbackNotice";
import { SelectorPeriodo } from "@/components/SelectorPeriodo";
import { getSemaforo, DJPMN_HELP } from "@/lib/semaforo";
import { detectarTipoClasificacion, GRUPO_COLORS } from "@/lib/destinoClasificacion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip as UiTooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  ComposedChart, Line, Bar, Cell, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer,
  PieChart, Pie,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatKg, formatNumber, formatPct } from "@/lib/format";
import { calcularTphOperativa } from "@/lib/velocidadOperativa";
import { buildPeriodoRange } from "@/lib/consumoPeriodoView";
import { addDays, buildRecentWeeks } from "@/lib/isoWeek";
import { cn } from "@/lib/utils";
import {
  Truck, Package, TrendingDown, BarChart3,
  Gauge, Droplet, Plus, ShoppingCart,
  Recycle, Trash2, Warehouse, AlertTriangle, ArrowRight, Clock,
  ClipboardCheck, FileText, Waypoints, Sprout, Brush, History, LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { mermaLotesEnPeriodo } from "@/lib/mermaLote";
import {
  GlassTooltip, C, GRID, XAXIS, YAXIS, MARGIN,
  BAR_STYLE, CHART_CURSOR, CHART_LINE_CURSOR, CHART_PANEL_CLASS,
  PIE_STYLE, activeDotStyle, barFill,
} from "@/lib/chartTheme";

interface ChartPayloadItem {
  dataKey?: string;
  value?: number | string | null;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartPayloadItem[];
  label?: string | number;
}

interface DsjDotProps {
  cx?: number;
  cy?: number;
  payload?: {
    dsj_pct?: number;
  };
}

const WEEKS_IN_PANEL = 6;

// ─── Tooltip glass ───────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const dsj  = payload.find((p) => p.dataKey === "dsj_pct");
  const prod = payload.find((p) => p.dataKey === "produccion");
  const dsjValue = Number(dsj?.value ?? 0);
  const abs  = Math.abs(dsjValue);
  const items: { name: string; value: string; color: string }[] = [];
  if (prod) items.push({ name: "Producción", value: formatKg(Number(prod.value ?? 0)), color: C.primary });
  if (dsj)  items.push({ name: "DJPMN",      value: `${dsjValue >= 0 ? "+" : ""}${dsjValue.toFixed(2)}%`, color: abs <= 3 ? C.success : abs <= 5 ? C.warning : C.destructive });
  return <GlassTooltip active label={label !== undefined ? String(label) : undefined} payload={items} />;
}

// ─── Reciclado de malla ─────────────────────────────────────────────────────

interface RecicladoStatRowProps {
  label: string;
  kg: number;
  pct: number;
  color: string;
}

function RecicladoStatRow({ label, kg, pct, color }: RecicladoStatRowProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-xs text-muted-foreground">{formatKg(kg)}</span>
          <span className="min-w-[52px] text-right font-bold tabular-nums">{formatPct(pct)}</span>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(pct, 100)}%`,
            background: `linear-gradient(90deg, ${barFill(color, 0.5)}, ${barFill(color, 0.75)})`,
            borderRight: `1.5px solid ${color}`,
          }}
        />
      </div>
    </div>
  );
}

interface RecicladoColumnProps {
  title: string;
  subtitle: string;
  agg: RecicladoAgg;
}

function RecicladoColumn({ title, subtitle, agg }: RecicladoColumnProps) {
  return (
    <div className="space-y-3 rounded-xl bg-[var(--glass-bg)] p-4">
      <div>
        <p className="panel-kicker">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <RecicladoStatRow label="Malla Z1" kg={agg.z1_kg} pct={agg.z1_pct} color={C.info} />
      <RecicladoStatRow label="Malla Z2" kg={agg.z2_kg} pct={agg.z2_pct} color={C.warning} />
      <div className="border-t border-[var(--glass-border)] pt-2.5">
        <RecicladoStatRow label="Total reciclado" kg={agg.total_kg} pct={agg.total_pct} color={C.primary} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Sobre {formatKg(agg.calibrador_kg)} de calibrador
      </p>
    </div>
  );
}

// ─── Divisores del hilo físico (báscula → cámara → línea → palet) ──────────
// Marcan visualmente las 4 filas del rediseño (FASE 2, jul 2026) sin añadir
// otra caja glass: Cámara (stock) → Línea (producción de la semana) →
// Atención (podrido/avisos) → La sección (accesos a toda producción).

function FlujoDivider({ icon: Icon, label, hint }: { icon: LucideIcon; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
      <p className="panel-kicker whitespace-nowrap">{label}</p>
      {hint && <span className="truncate text-xs text-muted-foreground">· {hint}</span>}
      <div className="h-px flex-1 bg-[var(--glass-border)]" />
    </div>
  );
}

// ─── "La sección": accesos a todas las páginas de producción ───────────────

interface SeccionAcceso {
  to: string;
  label: string;
  icon: LucideIcon;
  dato?: string;
}

function SeccionAccesoCard({ item }: { item: SeccionAcceso }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className="glass glass-hover flex flex-col gap-2 rounded-xl p-3.5 transition-all hover:-translate-y-0.5"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg glass-strong text-primary">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{item.label}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.dato ?? " "}</p>
      </div>
    </Link>
  );
}

/** Fila de un mini-ranking de atención: enlaza al lote, con badge rojo de kg. Mismo patrón que RankingLoteRow de EntradasBascula.tsx. */
function AtencionLoteRow({ lote, kg }: { lote: string; kg: number }) {
  return (
    <Link
      to={`/trazabilidad?lote=${encodeURIComponent(lote)}`}
      className="flex items-center justify-between gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-sm transition-colors hover:bg-[var(--glass-bg-strong)]"
    >
      <span className="inline-flex items-center gap-1 font-medium tabular-nums">
        {lote} <ArrowRight className="h-3 w-3 opacity-40" />
      </span>
      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[11px] font-semibold text-destructive">
        {formatKg(kg)}
      </Badge>
    </Link>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  // 0 = semana actual; cada paso atrás resta 1 semana. No se permite ir al futuro.
  const [weekOffset, setWeekOffset] = useState(0);
  const isCurrentWeek = weekOffset === 0;
  const anchorDate = useMemo(() => addDays(new Date(), weekOffset * 7), [weekOffset]);
  const weeks = useMemo(() => buildRecentWeeks(WEEKS_IN_PANEL, anchorDate), [anchorDate]);
  const currentWeek = weeks[weeks.length - 1];
  const previousWeek = weeks[weeks.length - 2];
  // Cubre desde hoy hasta el inicio del panel visible, aunque el ancla esté en el pasado.
  const dashboardDays = useMemo(() => {
    const earliest = new Date(`${weeks[0].start}T12:00:00`);
    const diffDays = Math.ceil((Date.now() - earliest.getTime()) / 86400000);
    return Math.max(diffDays + 7, WEEKS_IN_PANEL * 7);
  }, [weeks]);
  const { partes, allPartes, loading, reciclado_dia, ultimoDiaConParte } = usePartesDashboard(dashboardDays);

  // Reciclado de malla (Z1/Z2) de la semana activa (respeta la navegación por semanas).
  const recicladoSemana = useMemo(() => {
    const weekPartes = partes.filter((p) => p.date >= currentWeek.start && p.date <= currentWeek.end);
    return computeRecicladoAgg(weekPartes);
  }, [partes, currentWeek]);

  // Reciclado del mes en curso y de toda la campaña (media ponderada del %):
  // se calcula sobre allPartes (histórico completo), reusando los rangos de
  // consumoPeriodoView (mes natural / campaña 1 sep – 31 ago).
  const rangoMes = useMemo(() => buildPeriodoRange("mes", 0), []);
  const rangoCampana = useMemo(() => buildPeriodoRange("campana", 0), []);
  const recicladoMes = useMemo(
    () => computeRecicladoAgg(allPartes.filter((p) => p.date >= rangoMes.start && p.date <= rangoMes.end)),
    [allPartes, rangoMes],
  );
  const recicladoCampana = useMemo(
    () => computeRecicladoAgg(allPartes.filter((p) => p.date >= rangoCampana.start && p.date <= rangoCampana.end)),
    [allPartes, rangoCampana],
  );

  const weeklyRows = useMemo(() => {
    return weeks.map((week) => {
      const weekPartes = partes.filter((p) => p.date >= week.start && p.date <= week.end);
      const produccion = weekPartes.reduce((s, p) => s + p.cascade.produccion_real, 0);
      const palets = weekPartes.reduce((s, p) => s + p.cascade.palets_ajustados, 0);
      const dsj = weekPartes.reduce((s, p) => s + p.cascade.dsj, 0);
      // Merma "real" del dashboard: podrido manual (bolsa basura) + podrido del calibrador.
      // Ojo: distinto de cascade.mermas_totales (que solo cuenta el podrido manual).
      const mermas = weekPartes.reduce((s, p) => s + p.cascade.podrido_manual + p.cascade.podrido_calibrador, 0);
      // Merma total ampliada: además de los podridos, suma la diferencia sin justificar
      // (el DSJ puede ser negativo si sobra fruta, se suma tal cual, con signo).
      const mermaTotalConDsj = mermas + dsj;
      return {
        ...week,
        produccion,
        palets,
        fechas: weekPartes.map((p) => p.date),
        dsj,
        dsj_pct: produccion > 0 ? (dsj / produccion) * 100 : 0,
        mermas,
        // % ponderado de la semana: total de mermas (podrido manual + calibrador)
        // entre producción real total de la semana.
        mermas_pct: produccion > 0 ? (mermas / produccion) * 100 : 0,
        mermaTotalConDsj,
        mermaTotalConDsjPct: produccion > 0 ? (mermaTotalConDsj / produccion) * 100 : 0,
        partes: weekPartes.length,
      };
    });
  }, [partes, weeks]);

  // ─── Fallback automático a la semana anterior (solo en la carga inicial) ──
  // Si al terminar de cargar la semana actual no tiene partes y la anterior sí,
  // saltamos una única vez a la semana anterior y lo avisamos explícitamente.
  const autoFallbackTried = useRef(false);
  const [autoFallbackActive, setAutoFallbackActive] = useState(false);
  const manualNavRef = useRef(false);

  useEffect(() => {
    if (loading || autoFallbackTried.current || manualNavRef.current) return;
    if (weekOffset !== 0) return;
    autoFallbackTried.current = true;
    const current = weeklyRows[weeklyRows.length - 1];
    const previous = weeklyRows[weeklyRows.length - 2];
    if (current && current.partes === 0 && previous && previous.partes > 0) {
      setWeekOffset(-1);
      setAutoFallbackActive(true);
    }
  }, [loading, weekOffset, weeklyRows]);

  function handleWeekOffsetChange(updater: (o: number) => number) {
    manualNavRef.current = true;
    setAutoFallbackActive(false);
    setWeekOffset(updater);
  }

  function handleGoToCurrentWeek() {
    manualNavRef.current = true;
    setAutoFallbackActive(false);
    setWeekOffset(0);
  }

  const currentWeekData = weeklyRows[weeklyRows.length - 1];
  const previousWeekData = weeklyRows[weeklyRows.length - 2];
  const weekChangePct = previousWeekData?.produccion
    ? ((currentWeekData.produccion - previousWeekData.produccion) / previousWeekData.produccion) * 100
    : 0;
  const paletsChangePct = previousWeekData?.palets
    ? ((currentWeekData.palets - previousWeekData.palets) / previousWeekData.palets) * 100
    : 0;
  const dsjTrend = previousWeekData ? currentWeekData.dsj_pct - previousWeekData.dsj_pct : 0;
  const mermasTrend = previousWeekData ? currentWeekData.mermas_pct - previousWeekData.mermas_pct : 0;
  const mermaTotalTrend = previousWeekData ? currentWeekData.mermaTotalConDsjPct - previousWeekData.mermaTotalConDsjPct : 0;
  const chartDisplayData = weeklyRows;
  const sem = getSemaforo(currentWeekData.dsj_pct);

  // Distribución por grupo de destino (semana actual)
  const { data: grupoDistribution, isLoading: grupoDistributionLoading } = useQuery({
    queryKey: ["dashboard-grupo-distribution", currentWeek.start, currentWeek.end],
    queryFn: async () => {
      const partesIds = await fetchAllRows<{ id: string }>((from, to) =>
        supabase.from("partes_diarios").select("id").gte("date", currentWeek.start).lte("date", currentWeek.end).order("id").range(from, to),
      );

      if (partesIds.length === 0) return [];

      const ids = partesIds.map((p) => p.id);
      // Una semana no debería acercarse a las 1.000 filas de calibres_dia,
      // pero el .limit(100000) tampoco protegía nada de verdad (PostgREST
      // recorta a su max-rows en silencio): se pagina por seguridad.
      const calibres = await fetchAllRows<{ grupo_destino: string | null; kg: number }>((from, to) =>
        supabase.from("calibres_dia").select("grupo_destino, kg").in("part_id", ids).order("id").range(from, to),
      );

      if (calibres.length === 0) return [];

      const map = new Map<string, number>();
      for (const c of calibres) {
        const kg = Number(c.kg) || 0;
        const grupo = detectarTipoClasificacion(c.grupo_destino);
        map.set(grupo, (map.get(grupo) ?? 0) + kg);
      }

      const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
      return Array.from(map.entries())
        .map(([grupo, kg]) => ({
          grupo,
          kg,
          pct: total > 0 ? (kg / total) * 100 : 0,
          color: GRUPO_COLORS[grupo] ?? GRUPO_COLORS["Otro"],
        }))
        .sort((a, b) => b.kg - a.kg);
    },
  });

  // Aprovechamiento Mercadona (mismo rango que la distribución por destino)
  const mercadona = useMercadona(currentWeek.start, currentWeek.end);
  const mercadonaFormatos = useMemo(() => mercadona.por_formato.slice(0, 6), [mercadona.por_formato]);
  // Aprovechamiento real/estimado (vendido del informe semanal o regla de palets).
  // Año ISO de la semana: el año del jueves (start + 3 días).
  const mercadonaAnioIso = useMemo(() => {
    const jueves = new Date(`${currentWeek.start}T12:00:00`);
    jueves.setDate(jueves.getDate() + 3);
    return jueves.getFullYear();
  }, [currentWeek.start]);
  const aprovechamiento = useMercadonaAprovechamiento(mercadonaAnioIso, currentWeek.weekNumber);

  // T/h con la jornada operativa de cada día (8 h hasta 1 jul 2026, 7 h después).
  const avgTph = calcularTphOperativa(currentWeekData.produccion, currentWeekData.fechas);

  // ─── Fila "Cámara": stock de fruta sin procesar (báscula → cámara) ──────
  const { stock, isLoading: stockLoading } = useEntradasBascula();

  // ─── Fila "Atención": lotes con más podrido de la semana activa (kg, sin €) ─
  // Mismo criterio que "Atención especial" de EntradasBascula.tsx: solo lotes
  // procesados y con análisis (excluye cerrados sin registro), podrido total =
  // calibrador + manual + pre-calibrador (asumido).
  const { lotes: mermaLotes, isLoading: mermaLoading } = useMermaLotes();
  const topPodridoSemana = useMemo(() => {
    const semana = mermaLotesEnPeriodo(mermaLotes, currentWeek.start, currentWeek.end);
    return semana
      .filter((l) => l.estado === "procesado" && !l.cerradoSinRegistro)
      .map((l) => ({ lote: l.lote, kg: (l.podridoCalibradorKg ?? 0) + (l.podridoManualKg ?? 0) + (l.podridoPreCalibradorKg ?? 0) }))
      .filter((r) => r.kg > 0)
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 5);
  }, [mermaLotes, currentWeek]);

  // ─── Fila "La sección": accesos a toda producción con dato barato donde lo hay ─
  const { fecha: ultimaCalidadFecha } = useUltimaJornadaCalidad();
  const { data: ultimoParteLimpieza } = useUltimoParteLimpieza();
  const seccionAccesos: SeccionAcceso[] = useMemo(() => [
    { to: "/entradas", label: "Entradas de fruta", icon: Truck, dato: !stockLoading ? `${formatKg(stock.kgEnCamara)} en cámara` : undefined },
    { to: "/trazabilidad", label: "Trazabilidad", icon: Waypoints, dato: "Ficha completa por lote" },
    { to: "/calidad", label: "Calidad", icon: ClipboardCheck, dato: ultimaCalidadFecha ? `Último informe ${formatDate(ultimaCalidadFecha)}` : "Sin informes todavía" },
    { to: "/partes", label: "Partes", icon: FileText, dato: ultimoDiaConParte ? `Último parte ${formatDate(ultimoDiaConParte)}` : undefined },
    { to: "/analisis/diario", label: "Análisis diario", icon: BarChart3, dato: "Lotes, calibres y destinos por día" },
    { to: "/productores", label: "Productores", icon: Sprout, dato: "Origen, rendimiento y comportamiento" },
    { to: "/mercadona", label: "Mercadona (planta)", icon: ShoppingCart, dato: mercadona.kg_mercadona > 0 ? `${formatKg(mercadona.kg_mercadona)} esta semana` : undefined },
    { to: "/costes/consumos", label: "Consumos", icon: Droplet, dato: "Agua · luz · gasoil · tratamientos" },
    { to: "/limpieza", label: "Limpieza de box", icon: Brush, dato: ultimoParteLimpieza ? `${formatNumber(ultimoParteLimpieza.box)} box · ${formatDate(ultimoParteLimpieza.fecha)}` : undefined },
    { to: "/historico", label: "Importar histórico", icon: History, dato: "Carga del histórico de campaña" },
  ], [stockLoading, stock.kgEnCamara, ultimaCalidadFecha, ultimoDiaConParte, mercadona.kg_mercadona, ultimoParteLimpieza]);

  return (
    <div className="page-shell">

      {/* ─── Header con semáforo + acciones ──────────────────────────────── */}
      <header className="page-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="page-title">Control de Producción</h1>
            {!loading && <SemaforoPill dsjPct={currentWeekData.dsj_pct} />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <SelectorPeriodo
              bare
              showLabel={false}
              showHoy={false}
              showDatePicker={false}
              canNavigateNext={!isCurrentWeek}
              value={{ modo: "semana", desde: currentWeek.start, hasta: currentWeek.end }}
              onChange={(next) => handleWeekOffsetChange((o) => (next.desde > currentWeek.start ? Math.min(0, o + 1) : o - 1))}
            />
            <p className="page-subtitle !mt-0">
              Semana {currentWeek.weekNumber} · {currentWeek.rangeLabel} · últimas {WEEKS_IN_PANEL} semanas
            </p>
            {!isCurrentWeek && (
              <button
                type="button"
                onClick={handleGoToCurrentWeek}
                className="text-xs font-medium text-primary hover:underline underline-offset-2"
              >
                Volver a hoy
              </button>
            )}
          </div>
        </div>
        <div className="button-row mt-1 flex flex-wrap items-center gap-2 sm:gap-3 lg:mt-0">
          <Link
            to="/partes"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl glass glass-hover px-3 py-2 text-xs font-medium"
          >
            <Plus className="h-3.5 w-3.5 text-primary" />
            Nuevo parte
          </Link>
          <Link
            to="/analisis/diario"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl glass glass-hover px-3 py-2 text-xs font-medium"
          >
            <BarChart3 className="h-3.5 w-3.5 text-success" />
            Análisis diario
          </Link>
          <Link
            to="/costes/consumos"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl glass glass-hover px-3 py-2 text-xs font-medium"
          >
            <Droplet className="h-3.5 w-3.5 text-info" />
            Consumos
          </Link>
        </div>
      </header>

      {/* ─── Aviso de fallback automático a la semana anterior ─────────────── */}
      {autoFallbackActive && (
        <AutoWeekFallbackNotice
          message={`Esta semana aún no tiene datos — mostrando la semana anterior (${currentWeek.rangeLabel})`}
          onGoToCurrentWeek={handleGoToCurrentWeek}
        />
      )}

      {/* ─── Fila 1 · Cámara: báscula → cámara, stock sin procesar ─────────── */}
      <FlujoDivider icon={Warehouse} label="Cámara" hint="stock de fruta sin procesar, antigüedad" />
      <Card className="overflow-hidden glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-lg font-semibold">Stock en cámara</CardTitle>
                <InfoTooltip>
                  Fruta entrada por báscula que el calibrador todavía no ha procesado del todo. "Firme" son lotes
                  activos sin señales de estar terminados; "probablemente terminado" son lotes parciales con ≥80%
                  procesado y sin actividad del calibrador en 7+ días — revisar y cerrar a mano si procede.
                </InfoTooltip>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Báscula → cámara · stock actual, no acotado a la semana</p>
            </div>
            <Link to="/entradas" className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-2">
              Ver entradas <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-1">
          {stockLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              <KPICard
                label="Stock firme"
                value={formatKg(stock.kgEnCamaraFirme)}
                icon={Warehouse}
                to="/entradas"
                labelInfo="Lotes en cámara (pendientes o parciales) que NO están marcados como probablemente terminados."
              />
              <KPICard
                label="Probablemente terminado"
                value={formatKg(stock.kgProbablementeTerminados)}
                icon={AlertTriangle}
                accent={stock.lotesProbablementeTerminados > 0 ? "warning" : "primary"}
                to="/entradas"
                hint={stock.lotesProbablementeTerminados > 0
                  ? `${stock.lotesProbablementeTerminados} lote${stock.lotesProbablementeTerminados === 1 ? "" : "s"} para revisar/cerrar`
                  : "Sin lotes que revisar"}
                labelInfo="Lotes parciales con ≥80% procesado y sin actividad del calibrador en 7+ días: probablemente terminados."
              />
              <KPICard
                label="Antigüedad máxima"
                value={`${stock.antiguedadMaxDias} día${stock.antiguedadMaxDias === 1 ? "" : "s"}`}
                icon={Clock}
                to="/entradas"
                accent={stock.antiguedadMaxDias > 14 ? "destructive" : stock.antiguedadMaxDias > 7 ? "warning" : "primary"}
                hint="Del lote activo más antiguo en cámara"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Fila 2 · Línea: producción de la semana, cascada DJPMN, clasificación ─ */}
      <FlujoDivider icon={Gauge} label="Línea" hint="producción de la semana seleccionada arriba" />

      {/* ─── KPIs principales ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : (
          <>
            <KPICard
              label={`Producción S${currentWeek.weekNumber}`}
              value={formatKg(currentWeekData.produccion)}
              icon={Truck}
              labelInfo="Producción real del calibrador: kg entrados, menos mujeres clase L y reciclado de mallas Z1/Z2."
              delta={previousWeek ? `${weekChangePct >= 0 ? "+" : ""}${weekChangePct.toFixed(1)}%` : undefined}
              deltaTrend={weekChangePct >= 0 ? "up" : "down"}
              hint={previousWeek ? `vs S${previousWeek.weekNumber}` : `${currentWeekData.partes} parte${currentWeekData.partes === 1 ? "" : "s"}`}
            >
              <Sparkline values={weeklyRows.map((w) => w.produccion)} />
            </KPICard>
            <KPICard
              label="Kg dados de alta"
              value={formatKg(currentWeekData.palets)}
              icon={Package}
              labelInfo="Palets ajustados: palets brutos dados de alta, menos el inventario pendiente de alta del día anterior."
              delta={previousWeek ? `${paletsChangePct >= 0 ? "+" : ""}${paletsChangePct.toFixed(1)}%` : undefined}
              deltaTrend={paletsChangePct >= 0 ? "up" : "down"}
              hint={previousWeek ? `vs S${previousWeek.weekNumber}` : undefined}
            />
            <KPICard
              label="Dif. Sin Justificar"
              value={formatKg(currentWeekData.dsj)}
              icon={TrendingDown}
              accent={sem.accent}
              labelInfo={DJPMN_HELP}
              delta={`${currentWeekData.dsj_pct >= 0 ? "+" : ""}${currentWeekData.dsj_pct.toFixed(2)}%`}
              deltaTrend={sem.deltaTrend}
              hint={previousWeek ? `${dsjTrend >= 0 ? "+" : ""}${dsjTrend.toFixed(2)} pp vs S${previousWeek.weekNumber}` : undefined}
            >
              <DsjScale dsjPct={currentWeekData.dsj_pct} />
            </KPICard>
            <KPICard
              label={`Mermas S${currentWeek.weekNumber}`}
              value={`${currentWeekData.mermas_pct.toFixed(2)}%`}
              icon={Trash2}
              labelInfo="Merma real de la semana: podrido manual (bolsa basura) + podrido del calibrador, sobre la producción real del calibrador. La línea '+ DSJ' de abajo añade además la diferencia sin justificar (con su signo: si sobra fruta puede bajar del valor principal) para ver toda la fruta perdida como merma."
              delta={previousWeek ? `${mermasTrend >= 0 ? "+" : ""}${mermasTrend.toFixed(2)} pp` : undefined}
              deltaTrend={mermasTrend > 0 ? "down" : mermasTrend < 0 ? "up" : "neutral"}
              hint={previousWeek ? `${formatKg(currentWeekData.mermas)} · vs S${previousWeek.weekNumber}` : formatKg(currentWeekData.mermas)}
            >
              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md border-l-[3px] border-warning bg-warning/10 px-2.5 py-1.5">
                <div className="min-w-0 leading-tight">
                  <p className="text-xs font-medium">Merma + DSJ</p>
                  {previousWeek && (
                    <p className="text-[11px] text-muted-foreground">
                      {mermaTotalTrend >= 0 ? "+" : ""}{mermaTotalTrend.toFixed(2)} pp vs S{previousWeek.weekNumber}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-base font-bold tabular-nums">
                  {currentWeekData.mermaTotalConDsjPct.toFixed(2)}%
                </span>
              </div>
              <Sparkline values={weeklyRows.map((w) => w.mermas_pct)} />
            </KPICard>
            <KPICard
              label="Velocidad media"
              value={avgTph !== null ? `${avgTph.toFixed(1)} T/h` : "—"}
              icon={Gauge}
              labelInfo="T/h = kg producidos entre las horas de jornada de cada día: 8 h/día hasta el 1 jul 2026 y 7 h/día desde el 2 jul (hasta nuevo aviso). Objetivo de referencia: 14,5 T/h."
              delta={avgTph !== null ? `${avgTph - 14.5 >= 0 ? "+" : ""}${(avgTph - 14.5).toFixed(1)} T/h` : undefined}
              deltaTrend={avgTph !== null ? (avgTph >= 14.5 ? "up" : avgTph >= 12.5 ? "neutral" : "down") : "neutral"}
              trend={avgTph !== null ? (avgTph >= 14.5 ? "up" : avgTph >= 12.5 ? "neutral" : "down") : "neutral"}
              hint={avgTph !== null ? `${currentWeekData.partes} día${currentWeekData.partes === 1 ? "" : "s"} · meta 14,5 T/h` : "Sin datos de velocidad esta semana"}
            />
          </>
        )}
      </section>

      {/* ─── Aprovechamiento Mercadona ──────────────────────────────────── */}
      <Card className="overflow-hidden glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-primary" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-lg font-semibold">Aprovechamiento Mercadona</CardTitle>
                <InfoTooltip>
                  Aprovechamiento real: kg vendidos según el informe semanal de Mercadona sobre los kg de entrada al
                  calibrador (L–S). Si la semana aún no tiene informe, se muestra el estimado por palets (error histórico
                  ±3%). La confección (kg en formatos MDNA) es métrica de fábrica: sobrestima la venta real ~15%.
                </InfoTooltip>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cliente principal · Semana {currentWeek.weekNumber} · {currentWeek.rangeLabel}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-1">
          {mercadona.isLoading ? (
            <Skeleton className="h-52" />
          ) : mercadona.kg_total === 0 ? (
            <div className="flex h-52 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-muted-foreground">
              <ShoppingCart className="mx-auto mb-2 h-10 w-10 text-muted-foreground/30" />
              <p className="font-medium text-foreground">Sin confección registrada</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                No hay kg confeccionados (informe de producto) en esta semana todavía, así que no se puede calcular el aprovechamiento de Mercadona.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* KPI grande: real (informe semanal) o, si aún no hay informe, estimado por palets */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-3xl font-semibold tabular-nums leading-tight sm:text-4xl">
                    {aprovechamiento.isLoading
                      ? "…"
                      : aprovechamiento.realPct != null
                        ? `${aprovechamiento.realPct.toFixed(1)}%`
                        : `${aprovechamiento.estimadoPct.toFixed(1)}%`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {aprovechamiento.isLoading
                      ? "calculando…"
                      : aprovechamiento.realPct != null
                        ? `vendido real (${formatKg(aprovechamiento.vendidoKg ?? 0)}, informe semanal) sobre los kg del calibrador`
                        : `estimado por palets (${formatKg(aprovechamiento.estimadoKg)}) sobre los kg del calibrador · aún sin informe semanal`}
                  </p>
                </div>
                <div className="flex items-center gap-4 rounded-xl bg-[var(--glass-bg)] px-4 py-2.5 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Confección MDNA</p>
                    <p className="font-semibold tabular-nums">{mercadona.pct_kg.toFixed(1)}%</p>
                  </div>
                  <div className="h-8 w-px bg-[var(--glass-border)]" />
                  <div>
                    <p className="text-xs text-muted-foreground">Kg confeccionados</p>
                    <p className="font-semibold tabular-nums">{formatKg(mercadona.kg_mercadona)}</p>
                  </div>
                  <div className="h-8 w-px bg-[var(--glass-border)]" />
                  <div>
                    <p className="text-xs text-muted-foreground">Cajas</p>
                    <p className="font-semibold tabular-nums">{mercadona.n_cajas_mercadona.toLocaleString("es-ES")}</p>
                  </div>
                </div>
              </div>

              {mercadonaFormatos.length > 0 && (
                <div className="grid gap-5 lg:grid-cols-2">
                  {/* Desglose por formato */}
                  <div className="space-y-3">
                    <p className="panel-kicker">Por formato</p>
                    {mercadonaFormatos.map((f) => (
                      <div key={f.formato} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <UiTooltip delayDuration={150}>
                            <TooltipTrigger asChild>
                              <span className="min-w-0 truncate font-medium underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
                                {f.formato}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
                              <ul className="list-disc space-y-0.5 pl-3">
                                {f.productos.map((nombre) => (
                                  <li key={nombre}>{nombre}</li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </UiTooltip>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="tabular-nums text-xs text-muted-foreground">{formatKg(f.kg)}</span>
                            <span className="tabular-nums text-xs text-muted-foreground">{f.n_cajas.toLocaleString("es-ES")} caj.</span>
                            <span className="min-w-[45px] text-right font-bold tabular-nums">{f.pct.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(f.pct, 100)}%`,
                              background: `linear-gradient(90deg, ${barFill(C.primary, 0.5)}, ${barFill(C.primary, 0.75)})`,
                              borderRight: `1.5px solid ${C.primary}`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Mini evolución diaria */}
                  <div className="space-y-2">
                    <p className="panel-kicker">Evolución diaria</p>
                    <div className={cn("h-40", CHART_PANEL_CLASS)}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={mercadona.por_dia} margin={MARGIN}>
                          <CartesianGrid {...GRID} />
                          <XAxis
                            dataKey="date"
                            {...XAXIS}
                            tickFormatter={(v: string) => v.slice(8, 10)}
                          />
                          <YAxis
                            {...YAXIS}
                            tickFormatter={(v) => `${v}%`}
                            width={32}
                            domain={[0, 100]}
                          />
                          <Tooltip
                            cursor={CHART_CURSOR}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              const d = payload[0].payload as { kg_mercadona: number; kg_total: number; pct: number };
                              return (
                                <GlassTooltip
                                  active
                                  label={typeof label === "string" ? new Date(`${label}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : undefined}
                                  payload={[
                                    { name: "% Mercadona", value: `${d.pct.toFixed(1)}%`, color: C.primary },
                                    { name: "Kg Mercadona", value: formatKg(d.kg_mercadona), color: C.primary },
                                    { name: "Kg total", value: formatKg(d.kg_total), color: C.muted },
                                  ]}
                                />
                              );
                            }}
                          />
                          <Bar dataKey="pct" {...BAR_STYLE} stroke={C.primary} name="pct">
                            {mercadona.por_dia.map((entry) => (
                              <Cell key={entry.date} fill={barFill(C.primary, 0.35)} />
                            ))}
                          </Bar>
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Reciclado de malla ───────────────────────────────────────────── */}
      <Card className="overflow-hidden glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-primary" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-lg font-semibold">Reciclado de malla</CardTitle>
                <InfoTooltip>
                  Kg retirados por reciclado de malla Z1 y Z2 en el calibrador. El % se calcula sobre los kg de producción del calibrador (kg_produccion_calibrador) del mismo período: el último día con parte (los partes se hacen del día anterior) para la columna Día, y la semana visible para la columna Semana.
                </InfoTooltip>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Día vs Semana {currentWeek.weekNumber} · {currentWeek.rangeLabel}
              </p>
            </div>
            <Recycle className="ml-auto h-5 w-5 shrink-0 text-primary/60" />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-1">
          {loading ? (
            <Skeleton className="h-56" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <RecicladoColumn
                title="Último día con parte"
                subtitle={ultimoDiaConParte
                  ? new Date(`${ultimoDiaConParte}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" })
                  : "Sin partes"}
                agg={reciclado_dia}
              />
              <RecicladoColumn
                title={`Semana ${currentWeek.weekNumber}`}
                subtitle={currentWeek.rangeLabel}
                agg={recicladoSemana}
              />
              <RecicladoColumn title="Mes" subtitle={rangoMes.label} agg={recicladoMes} />
              <RecicladoColumn title="Campaña" subtitle={rangoCampana.label} agg={recicladoCampana} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Confección por zona (mallas / granel / envasado / industria) ── */}
      <ConfeccionZonas
        semanaStart={currentWeek.start}
        semanaEnd={currentWeek.end}
        semanaTitle={`Semana ${currentWeek.weekNumber}`}
        semanaSubtitle={currentWeek.rangeLabel}
      />

      {/* ─── Evolución semanal ────────────────────────────────────────────── */}
      <Card className="overflow-hidden glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-primary" />
            <div className="min-w-0">
              <CardTitle className="text-lg font-semibold">Evolución semanal</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Últimas {WEEKS_IN_PANEL} semanas · barras = producción · línea = % DJPMN
              </p>
            </div>
            <div className="ml-auto hidden shrink-0 items-center gap-2 rounded-xl bg-[var(--glass-bg)] px-2.5 py-1.5 text-[10px] font-medium sm:flex">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: C.success }} /> ≤3%</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: C.warning }} /> 3-5%</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: C.destructive }} /> &gt;5%</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-1">
          <div className={CHART_PANEL_CLASS}>
            {loading ? (
              <Skeleton className="h-64 sm:h-[340px]" />
            ) : (
              <div className="h-64 sm:h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartDisplayData} margin={MARGIN}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="label" {...XAXIS} />
                    <YAxis
                      yAxisId="kg"
                      {...YAXIS}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}t`}
                      width={36}
                    />
                    <YAxis
                      yAxisId="pct"
                      orientation="right"
                      {...YAXIS}
                      tickFormatter={(v) => `${v}%`}
                      width={38}
                      domain={[-8, 8]}
                    />
                    <ReferenceArea
                      yAxisId="pct"
                      y1={-3}
                      y2={3}
                      fill={C.success}
                      fillOpacity={0.07}
                      stroke="none"
                      label={{ value: "Zona OK", position: "insideTopRight", fill: C.muted, fontSize: 9 }}
                    />
                    <Tooltip cursor={CHART_CURSOR} content={<ChartTooltip />} />
                    <Bar
                      yAxisId="kg"
                      dataKey="produccion"
                      {...BAR_STYLE}
                      stroke={C.primary}
                      name="produccion"
                    >
                      {chartDisplayData.map((entry, i) => (
                        <Cell
                          key={entry.label}
                          fill={barFill(C.primary, i === chartDisplayData.length - 1 ? 0.55 : 0.22)}
                        />
                      ))}
                    </Bar>
                    <ReferenceLine yAxisId="pct" y={3}  stroke={C.destructive} strokeDasharray="4 3" strokeWidth={1} opacity={0.5} />
                    <ReferenceLine yAxisId="pct" y={-3} stroke={C.destructive} strokeDasharray="4 3" strokeWidth={1} opacity={0.5} />
                    <ReferenceLine yAxisId="pct" y={0}  stroke={C.muted} strokeWidth={1} opacity={0.3} />
                    <Line
                      yAxisId="pct"
                      type="monotone"
                      dataKey="dsj_pct"
                      stroke={C.primary}
                      strokeWidth={2.5}
                      dot={(props: DsjDotProps) => {
                        const { cx, cy, payload } = props;
                        // recharts exige devolver siempre un elemento SVG (null rompe el tipado del prop `dot`).
                        if (cx === undefined || cy === undefined) return <g key={`dot-${cx}-${cy}`} />;
                        const abs = Math.abs(payload?.dsj_pct ?? 0);
                        const color = abs <= 3 ? C.success : abs <= 5 ? C.warning : C.destructive;
                        return <circle key={cx} cx={cx} cy={cy} r={abs > 5 ? 5 : 3.5} fill={color} stroke="var(--glass-bg-strong)" strokeWidth={2} />;
                      }}
                      activeDot={activeDotStyle(C.primary)}
                      name="dsj_pct"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Distribución por destino ─────────────────────────────────────── */}
      <Card className="overflow-hidden glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-primary" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-lg font-semibold">Distribución por destino</CardTitle>
                <InfoTooltip>
                  Exportación: fruta para mercados internacionales. Mercado: venta nacional. No exportación / No comercial: fruta que no cumple el estándar de exportación y va a industria u otros usos. Mujeres: clasificado manual en la línea de mujeres.
                </InfoTooltip>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Reparto de kg clasificados · Semana {currentWeek.weekNumber}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-1">
          {grupoDistributionLoading ? (
            <Skeleton className="h-52" />
          ) : !grupoDistribution || grupoDistribution.length === 0 ? (
            <div className="flex h-52 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-muted-foreground">
              <Package className="mx-auto mb-2 h-10 w-10 text-muted-foreground/30" />
              <p className="font-medium text-foreground">Sin datos de clasificación</p>
              <p className="max-w-xs text-xs text-muted-foreground">Sube el informe de tamaños/calibres al analizar un parte con IA para ver el reparto por destino.</p>
              <Link
                to="/analisis/diario"
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl glass glass-hover px-3 py-1.5 text-xs font-medium text-primary"
              >
                <BarChart3 className="h-3.5 w-3.5" /> Ir a Análisis diario
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
              {/* Donut */}
              <div className={cn("w-full max-w-[220px] shrink-0 sm:w-[220px]", CHART_PANEL_CLASS)}>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={grupoDistribution}
                      dataKey="kg"
                      nameKey="grupo"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      {...PIE_STYLE}
                    >
                      {grupoDistribution.map((entry) => (
                        <Cell
                          key={entry.grupo}
                          fill={barFill(entry.color, 0.35)}
                          stroke={entry.color}
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      cursor={CHART_LINE_CURSOR}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        const items = [
                          { name: "Kg", value: formatKg(d.kg), color: d.color },
                          { name: "% total", value: `${d.pct.toFixed(1)}%`, color: d.color },
                        ];
                        return <GlassTooltip active label={d.grupo} payload={items} />;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Leyenda con barras */}
              <div className="w-full flex-1 space-y-3">
                {grupoDistribution.map((g) => (
                  <div key={g.grupo} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border"
                          style={{ backgroundColor: barFill(g.color, 0.35), borderColor: g.color }}
                        />
                        <span className="font-medium">{g.grupo}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {formatKg(g.kg)}
                        </span>
                        <span className="min-w-[45px] text-right font-bold tabular-nums">
                          {g.pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(g.pct, 100)}%`,
                          background: `linear-gradient(90deg, ${barFill(g.color, 0.5)}, ${barFill(g.color, 0.75)})`,
                          borderRight: `1.5px solid ${g.color}`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Fila 3 · Atención: podrido de la semana + avisos ──────────────── */}
      <FlujoDivider icon={AlertTriangle} label="Atención" hint="lo que conviene revisar esta semana" />
      <Card className="overflow-hidden glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-warning" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-lg font-semibold">Lotes con más podrido</CardTitle>
                <InfoTooltip>
                  Podrido total del lote (calibrador + manual + pre-calibrador asumido) de los lotes procesados con
                  entrada esta semana. Solo kg — el desglose en € vive en Económico → Costes (solo administración).
                </InfoTooltip>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Semana {currentWeek.weekNumber} · {currentWeek.rangeLabel} · kg, sin €
              </p>
            </div>
            <Link
              to="/entradas?tab=mermas"
              className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-2"
            >
              Ver mermas y coste <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-1">
          {mermaLoading ? (
            <Skeleton className="h-24" />
          ) : topPodridoSemana.length === 0 ? (
            <div className="flex h-20 items-center justify-center text-center text-sm text-muted-foreground">
              Sin podrido registrado en lotes procesados esta semana.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {topPodridoSemana.map((r) => (
                <AtencionLoteRow key={r.lote} lote={r.lote} kg={r.kg} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Fila 4 · La sección: accesos a toda producción ────────────────── */}
      <FlujoDivider icon={LayoutDashboard} label="La sección" hint="todas las páginas de producción" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {seccionAccesos.map((item) => (
          <SeccionAccesoCard key={item.to} item={item} />
        ))}
      </div>
    </div>
  );
}
