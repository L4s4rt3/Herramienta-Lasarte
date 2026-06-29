import { useMemo } from "react";
import { Link } from "react-router-dom";
import { usePartesDashboard } from "@/hooks/usePartes";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ComposedChart, Line, Bar, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatKg, formatPct } from "@/lib/format";
import { calcularTphOperativa } from "@/lib/velocidadOperativa";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  Truck, Package, TrendingDown, BarChart3,
  Gauge, CalendarSync, ChevronDown, Droplet,
  Plus, ChevronRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  GlassTooltip, C, DEST_COLORS, GRID, XAXIS, YAXIS, MARGIN,
  BAR_STYLE, CHART_CURSOR, CHART_LINE_CURSOR, CHART_PANEL_CLASS,
  PIE_STYLE, activeDotStyle, barFill,
} from "@/lib/chartTheme";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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

function detectarTipoClasificacion(valor: string | null): string {
  if (!valor) return "Otro";
  const v = valor.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (v.includes("no_export") || v.includes("no export") || v.includes("no_exportac") || v.includes("no exportac")) return "No exportación";
  if (v.includes("no_comerc") || v.includes("no comerc") || v.includes("industria") || v.includes("ind")) return "No comercial";
  if (v.includes("export") || v.includes("ext")) return "Exportación";
  if (v.includes("mujer")) return "Mujeres";
  if (v.includes("mercado") || v.includes("nac") || v.includes("interior") || v.includes("int")) return "Mercado";
  return valor;
}

const GRUPO_COLORS: Record<string, string> = {
  "Exportación":   DEST_COLORS.exportacion,
  "Mercado":       DEST_COLORS.mercado,
  "No exportación": DEST_COLORS.noExportacion,
  "No comercial":  DEST_COLORS.noComercial,
  "Mujeres":       DEST_COLORS.mujeres,
  "Otro":          DEST_COLORS.otro,
};

const WEEKS_IN_PANEL = 6;

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
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

function buildRecentWeeks(count: number) {
  const currentStart = getWeekStart(new Date());
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
  return <GlassTooltip active label={label} payload={items} />;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const weeks = useMemo(() => buildRecentWeeks(WEEKS_IN_PANEL), []);
  const currentWeek = weeks[weeks.length - 1];
  const previousWeek = weeks[weeks.length - 2];
  const dashboardDays = WEEKS_IN_PANEL * 7;
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
  const dsjTrend = previousWeekData ? currentWeekData.dsj_pct - previousWeekData.dsj_pct : 0;
  const chartDisplayData = weeklyRows;
  const weeklyView = true;
  const setWeeklyView = (_next: boolean) => undefined;
  const trendPeriod: "30d" | "90d" = "30d";
  const setTrendPeriod = (_next: "30d" | "90d") => undefined;
  const compareMode: "week" | "month" | "year" | null = null;
  const compareOpen = false;
  const setCompareOpen = (_next: boolean) => undefined;
  const setCompareMode = (_next: "week" | "month" | "year" | null) => undefined;
  const yoyData = null as {
    current: { count: number; produccion_real: number; dsj_pct: number; palets_ajustados: number };
    previous: { produccion_real: number; dsj_pct: number; palets_ajustados: number };
    compareLabel: string;
    change: { produccion_real: number; dsj_pct: number; palets_ajustados: number };
  } | null;

  // T/h promedio: resumen ejecutivo. El detalle vive en Analisis Diario y Productores.
  // Distribución por grupo de destino
  const { data: grupoDistribution } = useQuery({
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

  // Calcular T/h usando exactamente 8 horas por día
  const avgTph = calcularTphOperativa(currentWeekData.produccion, currentWeekData.partes);

  return (
    <div className="page-shell">

      {/* ─── Header con acción principal ─────────────────────────────────── */}
      <header className="page-header">
        <div className="flex min-w-0 items-start justify-between">
          <div className="min-w-0">
            <h1 className="page-title">Control de Producción</h1>
            <p className="page-subtitle">
              Semana {currentWeek.weekNumber} · {currentWeek.rangeLabel} · últimas {WEEKS_IN_PANEL} semanas
            </p>
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
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KPICard
              label={`Producción real S${currentWeek.weekNumber}`}
              value={formatKg(currentWeekData.produccion)}
              hint={`${currentWeekData.partes} partes esta semana`}
              icon={Truck}
            />
            <KPICard
              label="Kg dados de alta"
              value={formatKg(currentWeekData.palets)}
              hint={previousWeek ? `vs S${previousWeek.weekNumber}: ${weekChangePct >= 0 ? "+" : ""}${weekChangePct.toFixed(1)}% kg` : undefined}
              icon={Package}
            />
            <KPICard
              label="Dif. Sin Justificar"
              value={formatKg(currentWeekData.dsj)}
              hint={`${currentWeekData.dsj_pct >= 0 ? "+" : ""}${currentWeekData.dsj_pct.toFixed(2)}% · ${dsjTrend >= 0 ? "+" : ""}${dsjTrend.toFixed(2)} pp vs semana ant.`}
              icon={TrendingDown}
              trend={Math.abs(currentWeekData.dsj_pct) <= 3 ? "up" : Math.abs(currentWeekData.dsj_pct) <= 5 ? "neutral" : "down"}
            />
            <KPICard
              label="Velocidad media"
              value={avgTph !== null ? `${avgTph.toFixed(1)} T/h` : "—"}
              hint={`${currentWeekData.partes} días × 8 h/día`}
              icon={Gauge}
              trend={avgTph !== null ? (avgTph >= 14.5 ? "up" : avgTph >= 12.5 ? "neutral" : "down") : "neutral"}
            />
          </>
        )}
      </section>

      {/* ─── Period comparison ──────────────────────────────────── */}
      {compareMode && yoyData && (
        <Collapsible defaultOpen className="space-y-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 text-sm font-medium w-full justify-start px-1">
              {yoyData.current.count > 0 || yoyData.previous.count > 0 ? (
                <>
                  <CalendarSync className="h-4 w-4 text-primary" />
                  Comparativa respecto al {yoyData.compareLabel}
                  <ChevronDown className="h-4 w-4 ml-auto" />
                </>
              ) : (
                <>
                  <CalendarSync className="h-4 w-4 text-muted-foreground" />
                  Sin datos históricos para comparar
                </>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Producción real */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Producción real</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Este período</span>
                      <span className="font-semibold">{formatKg(yoyData.current.produccion_real)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Año anterior</span>
                      <span className="font-semibold">{formatKg(yoyData.previous.produccion_real)}</span>
                    </div>
                    <div className="flex justify-between items-center border-t pt-2">
                      <span className="text-xs text-muted-foreground">Variación</span>
                      <span className={cn(
                        "font-bold text-sm",
                        yoyData.change.produccion_real > 0 ? "text-success" : yoyData.change.produccion_real < 0 ? "text-destructive" : "text-muted-foreground"
                      )}>
                        {yoyData.change.produccion_real > 0 ? "+" : ""}{formatPct(yoyData.change.produccion_real, 1)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* DJPMN % */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">DJPMN %</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Este período</span>
                      <span className={cn(
                        "font-semibold",
                        Math.abs(yoyData.current.dsj_pct) <= 3 ? "text-success" : Math.abs(yoyData.current.dsj_pct) <= 5 ? "text-warning" : "text-destructive"
                      )}>
                        {yoyData.current.dsj_pct >= 0 ? "+" : ""}{yoyData.current.dsj_pct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Año anterior</span>
                      <span className={cn(
                        "font-semibold",
                        Math.abs(yoyData.previous.dsj_pct) <= 3 ? "text-success" : Math.abs(yoyData.previous.dsj_pct) <= 5 ? "text-warning" : "text-destructive"
                      )}>
                        {yoyData.previous.dsj_pct >= 0 ? "+" : ""}{yoyData.previous.dsj_pct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-t pt-2">
                      <span className="text-xs text-muted-foreground">Diferencia</span>
                      <span className={cn(
                        "font-bold text-sm",
                        Math.abs(yoyData.change.dsj_pct) <= 3 ? "text-success" : Math.abs(yoyData.change.dsj_pct) <= 5 ? "text-warning" : "text-destructive"
                      )}>
                        {yoyData.change.dsj_pct >= 0 ? "+" : ""}{yoyData.change.dsj_pct.toFixed(2)} pp
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Palets ajustados */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Palets ajustados</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Este período</span>
                      <span className="font-semibold">{formatKg(yoyData.current.palets_ajustados)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Año anterior</span>
                      <span className="font-semibold">{formatKg(yoyData.previous.palets_ajustados)}</span>
                    </div>
                    <div className="flex justify-between items-center border-t pt-2">
                      <span className="text-xs text-muted-foreground">Variación</span>
                      <span className={cn(
                        "font-bold text-sm",
                        yoyData.change.palets_ajustados > 0 ? "text-success" : yoyData.change.palets_ajustados < 0 ? "text-destructive" : "text-muted-foreground"
                      )}>
                        {yoyData.change.palets_ajustados > 0 ? "+" : ""}{formatPct(yoyData.change.palets_ajustados, 1)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="hidden">
        <Popover open={compareOpen} onOpenChange={setCompareOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-2 glass glass-hover"
            >
              <CalendarSync className={cn("h-3.5 w-3.5 mr-1", compareMode && "animate-pulse")} />
              {compareMode
                ? `vs ${compareMode === "year" ? "año" : compareMode === "month" ? "mes" : "semana"} anterior`
                : "Comparar períodos"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pb-1.5 pt-1">Comparar con</p>
            {([
              { value: "week" as const, label: "Semana anterior" },
              { value: "month" as const, label: "Mes anterior" },
              { value: "year" as const, label: "Año anterior" },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setCompareMode(compareMode === opt.value ? null : opt.value); setCompareOpen(false); }}
                className={cn(
                  "w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs transition-colors",
                  compareMode === opt.value
                    ? "bg-primary/10 text-primary font-semibold"
                    : "hover:bg-[var(--glass-bg-strong)] text-foreground"
                )}
              >
                <ChevronRight className={cn("h-3 w-3", compareMode === opt.value ? "opacity-100" : "opacity-0")} />
                {opt.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {compareMode && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCompareMode(null)}
            className="h-7 text-xs px-1.5 text-muted-foreground hover:text-destructive"
            title="Quitar comparación"
          >
            ✕
          </Button>
        )}
      </div>

      {/* ─── Gráfico (más espacio, lectura clara) ─────────────────────────── */}
      <Card className="overflow-hidden glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="h-7 w-1 rounded-full bg-primary" />
                <CardTitle className="text-lg font-semibold">Evolución semanal</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground pl-10">
                Últimas {WEEKS_IN_PANEL} semanas · barras = producción real · línea = % diferencia sin justificar
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium bg-[var(--glass-bg)] rounded-xl px-2.5 py-1.5">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{backgroundColor: C.success}} /> ≤3%</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{backgroundColor: C.warning}} /> 3-5%</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{backgroundColor: C.destructive}} /> &gt;5%</span>
              </div>
              <div className="hidden">
                <Button
                  variant={trendPeriod === "30d" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setTrendPeriod("30d")}
                >
                  30d
                </Button>
                <Button
                  variant={trendPeriod === "90d" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setTrendPeriod("90d")}
                >
                  90d
                </Button>
                <div className="w-px h-5 bg-border mx-0.5" />
                <Button
                  variant={weeklyView ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setWeeklyView(!weeklyView)}
                >
                  {weeklyView ? "Día" : "Sem"}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-1">
          <div className={CHART_PANEL_CLASS}>
          {loading ? (
            <Skeleton className="h-80" />
          ) : chartDisplayData.length === 0 ? (
            <div className="h-80 flex flex-col items-center justify-center text-sm text-muted-foreground">
              <BarChart3 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p>Sin datos para mostrar</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
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
                <Tooltip cursor={CHART_CURSOR} content={<ChartTooltip />} />
                <Bar
                  yAxisId="kg"
                  dataKey="produccion"
                  {...BAR_STYLE}
                  fill={barFill(C.primary, 0.28)}
                  stroke={C.primary}
                  name="produccion"
                />
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
                    if (cx === undefined || cy === undefined) return null;
                    const abs = Math.abs(payload?.dsj_pct ?? 0);
                    const color = abs <= 3 ? C.success : abs <= 5 ? C.warning : C.destructive;
                    return <circle key={cx} cx={cx} cy={cy} r={abs > 5 ? 5 : 3.5} fill={color} stroke="var(--glass-bg-strong)" strokeWidth={2} />;
                  }}
                  activeDot={activeDotStyle(C.primary)}
                  name="dsj_pct"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Distribución por destino ─────────────────────────────────────── */}
        <Card className="overflow-hidden glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 rounded-full bg-primary" />
            <div>
              <CardTitle className="text-lg font-semibold">Distribución por destino</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Reparto de kg clasificados · Semana {currentWeek.weekNumber}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-1">
          {!grupoDistribution || grupoDistribution.length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-sm text-muted-foreground">
              <Package className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p>Sin datos de clasificación en el período</p>
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
              <div className="flex-1 w-full space-y-3">
                {grupoDistribution.map((g) => (
                  <div key={g.grupo} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border"
                          style={{ backgroundColor: barFill(g.color, 0.35), borderColor: g.color }}
                        />
                        <span className="font-medium">{g.grupo}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground tabular-nums text-xs">
                          {formatKg(g.kg)}
                        </span>
                        <span className="font-bold tabular-nums min-w-[45px] text-right">
                          {g.pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${g.pct}%`,
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
