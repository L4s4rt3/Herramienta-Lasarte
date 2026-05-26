import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePartesDashboard, usePartes } from "@/hooks/usePartes";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ComposedChart, Line, Bar, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatKg, formatPct } from "@/lib/format";

import {
  Truck, Package, TrendingDown, Plus, FileText, BarChart3,
  AlertTriangle, Gauge, CheckCircle2, AlertCircle, XCircle,
  CalendarSync, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SemaforoCard } from "@/components/SemaforoCard";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type ProductionPaceData = {
  avgTph: number | null;
  loteCount: number;
};

// ─── Tooltip personalizado ───────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const dsj = payload.find((p: any) => p.dataKey === "dsj_pct");
  const prod = payload.find((p: any) => p.dataKey === "produccion");
  const palets = payload.find((p: any) => p.dataKey === "palets");
  const abs = Math.abs(dsj?.value ?? 0);
  const semColor = abs <= 3 ? "text-emerald-600" : abs <= 5 ? "text-amber-600" : "text-red-600";
  return (
    <div className="rounded-lg border bg-card shadow-lg p-3 text-xs space-y-1.5 min-w-[170px]">
      <p className="font-semibold text-foreground border-b pb-1.5 mb-1.5">{label}</p>
      {prod && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Producción</span>
          <span className="font-medium tabular-nums">{formatKg(prod.value)}</span>
        </div>
      )}
      {palets && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Palets</span>
          <span className="font-medium tabular-nums">{formatKg(palets.value)}</span>
        </div>
      )}
      {dsj && (
        <div className="flex justify-between gap-4 border-t pt-1.5 mt-1.5">
          <span className="text-muted-foreground">DJPMN</span>
          <span className={cn("font-bold tabular-nums", semColor)}>
            {dsj.value >= 0 ? "+" : ""}{dsj.value.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { partes, loading, totals, chartSeries } = usePartesDashboard(30);
  const { partes: allPartes } = usePartes();

  const [showYoY, setShowYoY] = useState(false);

  // Year-over-Year comparison
  const yoyData = useMemo(() => {
    if (!showYoY) return null;

    const today = new Date();
    const periodEnd = new Date(today);
    const periodStart = new Date(today);
    periodStart.setDate(periodStart.getDate() - 30);

    // Same period last year
    const prevStart = new Date(periodStart);
    prevStart.setFullYear(prevStart.getFullYear() - 1);
    const prevEnd = new Date(periodEnd);
    prevEnd.setFullYear(prevEnd.getFullYear() - 1);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const startStr = fmt(periodStart);
    const endStr = fmt(periodEnd);
    const prevStartStr = fmt(prevStart);
    const prevEndStr = fmt(prevEnd);

    const current = allPartes.filter(
      (p) => p.date >= startStr && p.date <= endStr
    );
    const previous = allPartes.filter(
      (p) => p.date >= prevStartStr && p.date <= prevEndStr
    );

    const calcTotals = (list: typeof allPartes) => {
      const prod = list.reduce((s, p) => s + p.cascade.produccion_real, 0);
      const dsj = list.reduce((s, p) => s + p.cascade.dsj, 0);
      const palets = list.reduce((s, p) => s + p.cascade.palets_ajustados, 0);
      return {
        produccion_real: prod,
        dsj_pct: prod > 0 ? (dsj / prod) * 100 : 0,
        palets_ajustados: palets,
        count: list.length,
      };
    };

    const curT = calcTotals(current);
    const prevT = calcTotals(previous);

    const pctChange = (cur: number, prev: number) =>
      prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0;

    return {
      current: curT,
      previous: prevT,
      change: {
        produccion_real: pctChange(curT.produccion_real, prevT.produccion_real),
        dsj_pct: curT.dsj_pct - prevT.dsj_pct,
        palets_ajustados: pctChange(curT.palets_ajustados, prevT.palets_ajustados),
      },
    };
  }, [showYoY, allPartes]);

  // T/h promedio: resumen ejecutivo. El detalle vive en Analisis Diario y Productores.
  const { data: paceData } = useQuery<ProductionPaceData | null>({
    queryKey: ["dashboard-production-pace"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data } = await supabase
        .from("lotes_dia")
        .select("toneladas_hora, duracion_min, partes_diarios!inner(date)")
        .gte("partes_diarios.date", sinceStr)
        .not("toneladas_hora", "is", null);
      const rows = (data ?? []).filter((row) => (row.toneladas_hora ?? 0) > 0);
      if (rows.length === 0) return null;
      const totalMin = rows.reduce((sum, row) => sum + (row.duracion_min ?? 0), 0);
      const weightedTph = rows.reduce(
        (sum, row) => sum + (row.toneladas_hora ?? 0) * (row.duracion_min ?? 1),
        0
      );
      const simpleTph = rows.reduce((sum, row) => sum + (row.toneladas_hora ?? 0), 0);

      return {
        avgTph: totalMin > 0 ? weightedTph / totalMin : simpleTph / rows.length,
        loteCount: rows.length,
      };
    },
  });

  // Últimos 10 partes para la lista
  const recentPartes = useMemo(
    () => [...partes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
    [partes]
  );

  const avgTph = paceData?.avgTph ?? null;

  return (
    <div className="page-shell">

      {/* ─── Header con acción principal ─────────────────────────────────── */}
      <header className="page-header">
        <div>
          <h1 className="page-title">Control de Producción</h1>
          <p className="page-subtitle">
            Revisión de producción · últimos 30 días · {partes.length} partes
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showYoY ? "default" : "outline"}
            size="sm"
            onClick={() => setShowYoY(!showYoY)}
            className="shadow-sm"
          >
            <CalendarSync className={cn("h-4 w-4 mr-1.5", showYoY && "animate-pulse")} />
            vs año anterior
          </Button>
          <Button size="lg" asChild className="shadow-md">
            <Link to="/partes">
              <Plus className="h-4 w-4 mr-1" />
              Nuevo Parte
            </Link>
          </Button>
        </div>
      </header>

      {/* ─── KPIs principales ─────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KPICard
              label="Producción real"
              value={formatKg(totals.produccion_real)}
              hint={`${partes.length} partes analizados`}
              icon={Truck}
            />
            <KPICard
              label="Kg dados de alta"
              value={formatKg(totals.palets_ajustados)}
              icon={Package}
            />
            <KPICard
              label="Dif. Sin Justificar"
              value={formatKg(totals.dsj)}
              hint={`${totals.dsj_pct >= 0 ? "+" : ""}${totals.dsj_pct.toFixed(2)}% sobre producción`}
              icon={TrendingDown}
              trend={Math.abs(totals.dsj_pct) <= 3 ? "up" : Math.abs(totals.dsj_pct) <= 5 ? "neutral" : "down"}
            />
            <KPICard
              label="Velocidad media"
              value={avgTph !== null ? `${avgTph.toFixed(1)} T/h` : "—"}
              hint={`${paceData?.loteCount ?? 0} lotes con velocidad`}
              icon={Gauge}
              trend={avgTph !== null ? (avgTph >= 16 ? "up" : avgTph >= 12 ? "neutral" : "down") : "neutral"}
            />
          </>
        )}
      </section>

      {/* ─── Semáforo de estado (lo más importante, primero) ──────────────── */}
      {!loading && partes.length > 0 && (
        <section className="grid gap-4 md:grid-cols-3">
          <SemaforoCard
            icon={CheckCircle2}
            label="OK"
            count={totals.n_ok}
            total={partes.length}
            color="emerald"
            description="DJPMN ≤ 3%"
          />
          <SemaforoCard
            icon={AlertCircle}
            label="A revisar"
            count={totals.n_amarillo}
            total={partes.length}
            color="amber"
            description="DJPMN 3–5%"
          />
          <SemaforoCard
            icon={XCircle}
            label="Críticos"
            count={totals.n_rojo}
            total={partes.length}
            color="red"
            description="DJPMN > 5%"
          />
        </section>
      )}

      {/* ─── Year-over-Year comparison ──────────────────────────────────── */}
      {showYoY && yoyData && (
        <Collapsible defaultOpen className="space-y-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 text-sm font-medium w-full justify-start px-1">
              {yoyData.current.count > 0 || yoyData.previous.count > 0 ? (
                <>
                  <CalendarSync className="h-4 w-4 text-primary" />
                  Comparativa respecto al mismo período del año anterior
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
                        yoyData.change.produccion_real > 0 ? "text-emerald-600" : yoyData.change.produccion_real < 0 ? "text-red-600" : "text-muted-foreground"
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
                        Math.abs(yoyData.current.dsj_pct) <= 3 ? "text-emerald-600" : Math.abs(yoyData.current.dsj_pct) <= 5 ? "text-amber-600" : "text-red-600"
                      )}>
                        {yoyData.current.dsj_pct >= 0 ? "+" : ""}{yoyData.current.dsj_pct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Año anterior</span>
                      <span className={cn(
                        "font-semibold",
                        Math.abs(yoyData.previous.dsj_pct) <= 3 ? "text-emerald-600" : Math.abs(yoyData.previous.dsj_pct) <= 5 ? "text-amber-600" : "text-red-600"
                      )}>
                        {yoyData.previous.dsj_pct >= 0 ? "+" : ""}{yoyData.previous.dsj_pct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-t pt-2">
                      <span className="text-xs text-muted-foreground">Diferencia</span>
                      <span className={cn(
                        "font-bold text-sm",
                        Math.abs(yoyData.change.dsj_pct) <= 3 ? "text-emerald-600" : Math.abs(yoyData.change.dsj_pct) <= 5 ? "text-amber-600" : "text-red-600"
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
                        yoyData.change.palets_ajustados > 0 ? "text-emerald-600" : yoyData.change.palets_ajustados < 0 ? "text-red-600" : "text-muted-foreground"
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

      {/* ─── Gráfico (más espacio, lectura clara) ─────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold">Evolución DJPMN</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Barras = producción real · Línea = % diferencia sin justificar
              </p>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-medium">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> ≤3%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 3-5%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> &gt;5%</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {loading ? (
            <Skeleton className="h-80" />
          ) : chartSeries.length === 0 ? (
            <div className="h-80 flex flex-col items-center justify-center text-sm text-muted-foreground">
              <BarChart3 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p>Sin datos para mostrar</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={chartSeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                <YAxis
                  yAxisId="kg"
                  fontSize={10}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}t`}
                  width={36}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  fontSize={10}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `${v}%`}
                  width={38}
                  domain={[-8, 8]}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  yAxisId="kg"
                  dataKey="produccion"
                  fill="hsl(var(--primary) / 0.15)"
                  stroke="hsl(var(--primary) / 0.4)"
                  strokeWidth={1}
                  radius={[3, 3, 0, 0]}
                  name="produccion"
                />
                <ReferenceLine yAxisId="pct" y={3}  stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1} opacity={0.5} />
                <ReferenceLine yAxisId="pct" y={-3} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1} opacity={0.5} />
                <ReferenceLine yAxisId="pct" y={0}  stroke="hsl(var(--muted-foreground))" strokeWidth={1} opacity={0.3} />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="dsj_pct"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    const abs = Math.abs(payload.dsj_pct);
                    const color = abs <= 3 ? "#10b981" : abs <= 5 ? "#f59e0b" : "#ef4444";
                    return <circle key={cx} cx={cx} cy={cy} r={abs > 5 ? 5 : 3.5} fill={color} stroke="white" strokeWidth={1.5} />;
                  }}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                  name="dsj_pct"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ─── Partes recientes (compacto, accionable) ──────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-lg font-semibold">Últimos partes</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Haz clic para ver detalle</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/partes">Ver todos</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : recentPartes.length === 0 ? (
            <div className="p-10 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-4">
                No hay partes en los últimos 30 días
              </p>
              <Button size="sm" asChild>
                <Link to="/partes">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Crear primer parte
                </Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {recentPartes.map((p) => {
                const abs = Math.abs(p.cascade.dsj_pct);
                const semaforoColor = abs <= 3 ? "text-emerald-600" : abs <= 5 ? "text-amber-600" : "text-red-600";
                return (
                  <li key={p.id}>
                    <Link
                      to={`/partes/${p.id}`}
                      className={cn(
                        "flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors",
                        abs > 5 && "bg-red-50/50 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {abs > 5 && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        <span className="font-medium text-sm">{formatDate(p.date)}</span>
                        <StatusBadge estado={p.estado} />
                      </div>
                      <div className="flex items-center gap-5 shrink-0 text-sm">
                        <span className="tabular-nums text-muted-foreground hidden sm:inline">
                          {formatKg(p.cascade.produccion_real)}
                        </span>
                        <span className={cn("tabular-nums font-bold min-w-[60px] text-right", semaforoColor)}>
                          {p.cascade.dsj_pct >= 0 ? "+" : ""}{p.cascade.dsj_pct.toFixed(2)}%
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
