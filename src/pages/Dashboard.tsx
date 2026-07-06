import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePartesDashboard } from "@/hooks/usePartes";
import { useMercadona } from "@/hooks/useMercadona";
import { KPICard } from "@/components/KPICard";
import { SemaforoPill } from "@/components/SemaforoPill";
import { InfoTooltip } from "@/components/InfoTooltip";
import { DsjScale } from "@/components/DsjScale";
import { Sparkline } from "@/components/Sparkline";
import { getSemaforo, DJPMN_HELP } from "@/lib/semaforo";
import { detectarTipoClasificacion, GRUPO_COLORS } from "@/lib/destinoClasificacion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip as UiTooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  ComposedChart, Line, Bar, Cell, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer,
  PieChart, Pie,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatKg } from "@/lib/format";
import { calcularTphOperativa } from "@/lib/velocidadOperativa";
import { cn } from "@/lib/utils";
import {
  Truck, Package, TrendingDown, BarChart3,
  Gauge, Droplet, Plus, ShoppingCart,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

function toIsoDate(date: Date) {
  // Componentes locales, no UTC (en España toISOString adelantaría el día de madrugada).
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getIsoWeekNumber(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getWeekStart(date: Date) {
  const d = new Date(date);
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - day);
  d.setHours(12, 0, 0, 0);
  return d;
}

function buildRecentWeeks(count: number, anchor: Date) {
  const currentStart = getWeekStart(anchor);
  return Array.from({ length: count }, (_, index) => {
    const start = addDays(currentStart, (index - count + 1) * 7);
    const end = addDays(start, 6);
    const weekNumber = getIsoWeekNumber(start);
    return {
      start: toIsoDate(start),
      end: toIsoDate(end),
      weekNumber,
      label: `S${weekNumber}`,
      rangeLabel: `${start.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} - ${end.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`,
    };
  });
}

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
  const { partes, loading } = usePartesDashboard(dashboardDays);

  const weeklyRows = useMemo(() => {
    return weeks.map((week) => {
      const weekPartes = partes.filter((p) => p.date >= week.start && p.date <= week.end);
      const produccion = weekPartes.reduce((s, p) => s + p.cascade.produccion_real, 0);
      const palets = weekPartes.reduce((s, p) => s + p.cascade.palets_ajustados, 0);
      const dsj = weekPartes.reduce((s, p) => s + p.cascade.dsj, 0);
      return {
        ...week,
        produccion,
        palets,
        dsj,
        dsj_pct: produccion > 0 ? (dsj / produccion) * 100 : 0,
        partes: weekPartes.length,
      };
    });
  }, [partes, weeks]);

  const currentWeekData = weeklyRows[weeklyRows.length - 1];
  const previousWeekData = weeklyRows[weeklyRows.length - 2];
  const weekChangePct = previousWeekData?.produccion
    ? ((currentWeekData.produccion - previousWeekData.produccion) / previousWeekData.produccion) * 100
    : 0;
  const paletsChangePct = previousWeekData?.palets
    ? ((currentWeekData.palets - previousWeekData.palets) / previousWeekData.palets) * 100
    : 0;
  const dsjTrend = previousWeekData ? currentWeekData.dsj_pct - previousWeekData.dsj_pct : 0;
  const chartDisplayData = weeklyRows;
  const sem = getSemaforo(currentWeekData.dsj_pct);

  // Distribución por grupo de destino (semana actual)
  const { data: grupoDistribution, isLoading: grupoDistributionLoading } = useQuery({
    queryKey: ["dashboard-grupo-distribution", currentWeek.start, currentWeek.end],
    queryFn: async () => {
      const { data: partesIds } = await supabase
        .from("partes_diarios")
        .select("id")
        .gte("date", currentWeek.start)
        .lte("date", currentWeek.end);

      if (!partesIds || partesIds.length === 0) return [];

      const ids = partesIds.map((p) => p.id);
      const { data: calibres } = await supabase
        .from("calibres_dia")
        .select("grupo_destino, kg")
        .in("part_id", ids)
        .limit(100000);

      if (!calibres || calibres.length === 0) return [];

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

  // T/h usando exactamente 8 horas por día
  const avgTph = calcularTphOperativa(currentWeekData.produccion, currentWeekData.partes);

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
            <div className="flex items-center gap-0.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] px-1 py-0.5 shadow-[var(--glass-shadow)]">
              <button
                type="button"
                onClick={() => setWeekOffset((o) => o - 1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--glass-bg-strong)] hover:text-foreground"
                aria-label="Semana anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setWeekOffset((o) => Math.min(0, o + 1))}
                disabled={isCurrentWeek}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--glass-bg-strong)] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                aria-label="Semana siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <p className="page-subtitle !mt-0">
              Semana {currentWeek.weekNumber} · {currentWeek.rangeLabel} · últimas {WEEKS_IN_PANEL} semanas
            </p>
            {!isCurrentWeek && (
              <button
                type="button"
                onClick={() => setWeekOffset(0)}
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

      {/* ─── KPIs principales ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)
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
              label="Velocidad media"
              value={avgTph !== null ? `${avgTph.toFixed(1)} T/h` : "—"}
              icon={Gauge}
              labelInfo="T/h = kg producidos entre horas trabajadas, usando 8 h/día como base fija. Objetivo de referencia: 14,5 T/h."
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
                  % de los kg confeccionados (informe de producto) del período en formatos Mercadona (MDNA).
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
              {/* KPI grande */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-3xl font-semibold tabular-nums leading-tight sm:text-4xl">
                    {mercadona.pct_kg.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    de los kg confeccionados de la semana fueron para Mercadona
                  </p>
                </div>
                <div className="flex items-center gap-4 rounded-xl bg-[var(--glass-bg)] px-4 py-2.5 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Kg Mercadona</p>
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
    </div>
  );
}
