import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePartesDashboard } from "@/hooks/usePartes";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ComposedChart, Line, Bar, CartesianGrid, XAxis, YAxis,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatKg, formatPct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  Truck, Package, TrendingDown, Recycle, FileText, Plus,
  AlertTriangle, Gauge, CheckCircle2, AlertCircle, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  const { t } = useI18n();
  const { partes, loading, totals, chartSeries } = usePartesDashboard(30);

  // T/h promedio últimos 30 días
  const { data: tphData } = useQuery({
    queryKey: ["dashboard-tph"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data } = await (supabase as any)
        .from("lotes_dia")
        .select("toneladas_hora, duracion_min")
        .gte("created_at", since.toISOString())
        .not("toneladas_hora", "is", null);
      const rows = (data ?? []).filter((r: any) => r.toneladas_hora > 0);
      if (rows.length === 0) return null;
      const totalMin = rows.reduce((s: number, r: any) => s + (r.duracion_min ?? 1), 0);
      return totalMin > 0
        ? rows.reduce((s: number, r: any) => s + r.toneladas_hora * (r.duracion_min ?? 1), 0) / totalMin
        : rows.reduce((s: number, r: any) => s + r.toneladas_hora, 0) / rows.length;
    },
  });

  // Últimos 10 partes para la lista
  const recentPartes = useMemo(
    () => [...partes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
    [partes]
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      {/* ─── Header con acción principal ─────────────────────────────────── */}
      <header className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Panel de Control</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Resumen operativo · últimos 30 días · {partes.length} partes
          </p>
        </div>
        <Button size="lg" asChild className="shadow-md">
          <Link to="/partes">
            <Plus className="h-4 w-4 mr-1" />
            Nuevo Parte
          </Link>
        </Button>
      </header>

      {/* ─── Semáforo de estado (lo más importante, primero) ──────────────── */}
      {!loading && partes.length > 0 && (
        <section className="grid grid-cols-3 gap-4">
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
              label="Palets ajustados"
              value={formatKg(totals.palets_ajustados)}
              icon={Package}
            />
            <KPICard
              label="Dif. Sin Justificar"
              value={`${totals.dsj_pct >= 0 ? "+" : ""}${totals.dsj_pct.toFixed(2)}%`}
              hint={formatKg(totals.dsj)}
              icon={TrendingDown}
              trend={Math.abs(totals.dsj_pct) <= 3 ? "up" : Math.abs(totals.dsj_pct) <= 5 ? "neutral" : "down"}
            />
            <KPICard
              label="Eficiencia máquina"
              value={tphData ? `${tphData.toFixed(1)} T/h` : "—"}
              hint="promedio ponderado"
              icon={Gauge}
              trend={tphData ? (tphData >= 16 ? "up" : tphData >= 12 ? "neutral" : "down") : "neutral"}
            />
          </>
        )}
      </section>

      {/* ─── Gráfico (más espacio, lectura clara) ─────────────────────────── */}
      <Card>
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
            <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
              Sin datos para mostrar
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
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
      <Card>
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
            <div className="p-8 text-center text-sm text-muted-foreground">
              No hay partes en los últimos 30 días
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

// ─── Componente Semáforo ─────────────────────────────────────────────────────

function SemaforoCard({
  icon: Icon,
  label,
  count,
  total,
  color,
  description,
}: {
  icon: any;
  label: string;
  count: number;
  total: number;
  color: "emerald" | "amber" | "red";
  description: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  const colorClasses = {
    emerald: {
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      border: "border-emerald-200 dark:border-emerald-800",
      icon: "text-emerald-600 dark:text-emerald-400",
      count: "text-emerald-700 dark:text-emerald-300",
      bar: "bg-emerald-500",
    },
    amber: {
      bg: "bg-amber-50 dark:bg-amber-950/30",
      border: "border-amber-200 dark:border-amber-800",
      icon: "text-amber-600 dark:text-amber-400",
      count: "text-amber-700 dark:text-amber-300",
      bar: "bg-amber-500",
    },
    red: {
      bg: "bg-red-50 dark:bg-red-950/30",
      border: "border-red-200 dark:border-red-800",
      icon: "text-red-600 dark:text-red-400",
      count: "text-red-700 dark:text-red-300",
      bar: "bg-red-500",
    },
  }[color];

  return (
    <div className={cn("rounded-xl border p-4 space-y-2", colorClasses.bg, colorClasses.border)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", colorClasses.icon)} />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <p className={cn("text-4xl font-black tabular-nums", colorClasses.count)}>{count}</p>
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-black/5 dark:bg-white/5 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", colorClasses.bar)} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
