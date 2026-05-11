import { useMemo } from "react";
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
import { Truck, Package, TrendingDown, Recycle, FileText, Plus, AlertTriangle, Globe, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─── Tooltip personalizado para el gráfico compuesto ─────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const dsj = payload.find((p: any) => p.dataKey === "dsj_pct");
  const prod = payload.find((p: any) => p.dataKey === "produccion");
  const palets = payload.find((p: any) => p.dataKey === "palets");
  const abs = Math.abs(dsj?.value ?? 0);
  const semColor = abs <= 5 ? "text-success" : abs <= 5 ? "text-warning" : "text-destructive";
  return (
    <div className="rounded-lg border bg-card shadow-lg p-3 text-xs space-y-1.5 min-w-[160px]">
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

  // M6 — T/h promedio de los últimos 30 días (desde lotes_dia)
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
      const tph =
        totalMin > 0
          ? rows.reduce((s: number, r: any) => s + r.toneladas_hora * (r.duracion_min ?? 1), 0) / totalMin
          : rows.reduce((s: number, r: any) => s + r.toneladas_hora, 0) / rows.length;
      return tph;
    },
  });

  // M3 — Rendimiento comercial acumulado (desde calibres_dia / producto_dia)
  const { data: rcData } = useQuery({
    queryKey: ["dashboard-rendimiento-comercial"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data } = await (supabase as any)
        .from("calibres_dia")
        .select("kg, grupo_destino")
        .gte("created_at", since.toISOString());
      if (!data || data.length === 0) return null;
      const kg_exp = (data as any[])
        .filter((r) => {
          const g = (r.grupo_destino ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          return g.includes("export");
        })
        .reduce((s: number, r: any) => s + (r.kg ?? 0), 0);
      const kg_total = (data as any[]).reduce((s: number, r: any) => s + (r.kg ?? 0), 0);
      return kg_total > 0 ? (kg_exp / kg_total) * 100 : null;
    },
  });

  // Datos de los últimos 10 partes para la lista
  const recentPartes = useMemo(
    () => [...partes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
    [partes]
  );

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">{t("dashboard")}</h1>
          <p className="text-sm text-muted-foreground">{t("last_30_days")}</p>
        </div>
        <Button asChild>
          <Link to="/partes"><FileText className="h-4 w-4" /> {t("partes")}</Link>
        </Button>
      </header>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KPICard
              label="Producción real"
              value={formatKg(totals.produccion_real)}
              hint={`${partes.length} partes`}
              icon={Truck}
            />
            <KPICard
              label="Palets alta ajustados"
              value={formatKg(totals.palets_ajustados)}
              icon={Package}
              trend="up"
            />
            <KPICard
              label="Mermas totales"
              value={formatKg(totals.mermas_totales)}
              icon={Recycle}
            />
            <KPICard
              label="DJPMN acumulado"
              value={formatKg(totals.dsj)}
              hint={`${totals.dsj_pct >= 0 ? "+" : ""}${totals.dsj_pct.toFixed(2)}%`}
              icon={TrendingDown}
              trend={Math.abs(totals.dsj_pct) <= 3 ? "neutral" : "down"}
            />
            <KPICard
              label="Eficiencia máquina"
              value={tphData ? `${tphData.toFixed(2)} T/h` : "Sin datos"}
              hint="promedio 30 días"
              icon={Gauge}
              trend={tphData ? (tphData >= 16 ? "up" : tphData >= 12 ? "neutral" : "down") : "neutral"}
            />
            <KPICard
              label="Rend. comercial"
              value={rcData !== null && rcData !== undefined ? `${rcData.toFixed(1)}%` : "Sin datos"}
              hint="exportación / producción"
              icon={Globe}
              trend={rcData ? (rcData >= 70 ? "up" : rcData >= 50 ? "neutral" : "down") : "neutral"}
            />
          </>
        )}
      </section>

      {/* Semáforo resumen */}
      {!loading && partes.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Partes OK", n: totals.n_ok,       color: "border-l-success bg-success/5",     textColor: "text-success",     sub: "DJPMN ≤ 3%" },
            { label: "A revisar", n: totals.n_amarillo, color: "border-l-warning bg-warning/5",     textColor: "text-warning",     sub: "DJPMN 3–5%" },
            { label: "Críticos",  n: totals.n_rojo,     color: "border-l-destructive bg-destructive/5", textColor: "text-destructive", sub: "DJPMN > 5%" },
          ].map(({ label, n, color, textColor, sub }) => (
            <div key={label} className={cn("rounded-lg border-l-4 px-4 py-3", color)}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className={cn("text-3xl font-bold tabular-nums mt-0.5", textColor)}>{n}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Gráfico compuesto: barras de producción + línea DJPMN */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Producción y % DJPMN · últimos 30 días</CardTitle>
          <p className="text-xs text-muted-foreground">Barras = producción real (kg) · Línea = % DJPMN</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72" />
          ) : chartSeries.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              {t("no_data")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
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
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  formatter={(val) => val === "produccion" ? "Producción (kg)" : val === "palets" ? "Palets (kg)" : "% DJPMN"}
                />
                <Bar
                  yAxisId="kg"
                  dataKey="produccion"
                  fill="hsl(var(--primary) / 0.25)"
                  stroke="hsl(var(--primary) / 0.6)"
                  strokeWidth={1}
                  radius={[2, 2, 0, 0]}
                  name="produccion"
                />
                {/* Zona de referencia DJPMN */}
                <ReferenceLine yAxisId="pct" y={3}  stroke="hsl(var(--destructive))" strokeDasharray="4 3" strokeWidth={1} />
                <ReferenceLine yAxisId="pct" y={-3} stroke="hsl(var(--destructive))" strokeDasharray="4 3" strokeWidth={1} />
                <ReferenceLine yAxisId="pct" y={1}  stroke="hsl(var(--warning))"     strokeDasharray="4 3" strokeWidth={1} />
                <ReferenceLine yAxisId="pct" y={-1} stroke="hsl(var(--warning))"     strokeDasharray="4 3" strokeWidth={1} />
                <ReferenceLine yAxisId="pct" y={0}  stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="dsj_pct"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    const abs = Math.abs(payload.dsj_pct);
                    const color = abs <= 3
                      ? "hsl(var(--success))"
                      : abs <= 5
                        ? "hsl(var(--warning))"
                        : "hsl(var(--destructive))";
                    return <circle key={cx} cx={cx} cy={cy} r={abs > 5 ? 4 : 3} fill={color} stroke="white" strokeWidth={1} />;
                  }}
                  activeDot={{ r: 5 }}
                  name="dsj_pct"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Lista de partes recientes */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg">{t("partes")} recientes</CardTitle>
          <Button size="sm" asChild>
            <Link to="/partes"><Plus className="h-4 w-4" />{t("new_parte")}</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : recentPartes.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t("no_data")}</div>
          ) : (
            <ul className="divide-y">
              {recentPartes.map((p) => {
                const abs = Math.abs(p.cascade.dsj_pct);
                return (
                  <li key={p.id}>
                    <Link
                      to={`/partes/${p.id}`}
                      className={cn(
                        "flex items-center justify-between px-6 py-3.5 hover:bg-muted/40 transition-colors",
                        abs > 5 && "bg-destructive/[0.03] hover:bg-destructive/[0.07]"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {abs > 5 && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                        <span className="font-medium whitespace-nowrap">{formatDate(p.date)}</span>
                        <StatusBadge estado={p.estado} />
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-4 shrink-0">
                        <span className="tabular-nums hidden sm:inline">{formatKg(p.cascade.produccion_real)} prod.</span>
                        <span className={cn(
                          "tabular-nums font-semibold",
                          abs <= 5 ? "text-success" : abs <= 5 ? "text-warning" : "text-destructive"
                        )}>
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
