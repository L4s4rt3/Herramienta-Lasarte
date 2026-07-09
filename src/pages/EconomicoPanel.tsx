// src/pages/EconomicoPanel.tsx
// Sección "Económico → Panel": dashboard de portada del modo económico. Cruza
// la facturación de Mercadona (base_iva de mercadona_semanas/_metodos, semanas
// cuyo rango L-S solapa el periodo elegido) con el coste de consumos del mismo
// periodo (useEconomicoPanel, que compone useCostesPeriodo + useMercadonaVentas)
// para un margen bruto estimado, su evolución semanal y los desgloses por
// recurso y por método. Fase 1: no incluye mano de obra ni fruta, solo
// agua/gasoil/electricidad/quimicos vs facturación.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, Droplet, Euro, FlaskConical, Fuel, Info, Receipt, Scale, ShieldAlert,
  ShoppingCart, Tag, TrendingUp, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KPICard } from "@/components/KPICard";
import { useEconomicoPanel } from "@/hooks/useEconomico";
import { metodoLabel } from "@/components/mercadona/mercadonaAnalisis.helpers";
import { buildPeriodoRange } from "@/lib/consumoPeriodoView";
import { formatDate, formatKg, formatNumber, toISODateLocal } from "@/lib/format";
import {
  C, CHART_CURSOR, CHART_PANEL_CLASS, GRID, GlassTooltip, MARGIN, XAXIS, YAXIS, barFill, lineStyle,
} from "@/lib/chartTheme";
import { cn } from "@/lib/utils";

const RECURSO_LABEL: Record<string, string> = {
  agua: "Agua",
  electricidad: "Electricidad",
  gasoil: "Gasoil",
  quimicos: "Quimicos",
};

const RECURSO_ICON: Record<string, LucideIcon> = {
  agua: Droplet,
  electricidad: Zap,
  gasoil: Fuel,
  quimicos: FlaskConical,
};

function recursoLabel(recurso: string): string {
  return RECURSO_LABEL[recurso] ?? recurso.charAt(0).toUpperCase() + recurso.slice(1);
}

function formatEuro(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, digits)} €`;
}

const ACCESOS_RAPIDOS = [
  { to: "/economico/facturacion", label: "Facturación", desc: "Semanas y métodos de Mercadona", icon: Euro },
  { to: "/economico/costes", label: "Costes", desc: "Consumos vs tarifas por periodo", icon: Receipt },
  { to: "/economico/precios", label: "Precios", desc: "Tarifas de agua, gasoil, luz y químicos", icon: Tag },
] as const;

// ─── Selector de rango sencillo (Este mes / Últimas 4 semanas / Campaña) ────────

type RangoPreset = "mes" | "ultimas4" | "campana";

interface RangoSimple {
  start: string; // ISO, inclusive
  end: string;   // ISO, inclusive
  label: string;
  detail: string;
}

const PRESETS: { value: RangoPreset; label: string }[] = [
  { value: "mes", label: "Este mes" },
  { value: "ultimas4", label: "Últimas 4 semanas" },
  { value: "campana", label: "Campaña" },
];

function buildRango(preset: RangoPreset): RangoSimple {
  if (preset === "mes") {
    const r = buildPeriodoRange("mes", 0);
    return { start: r.start, end: r.end, label: r.label, detail: r.detail };
  }
  if (preset === "campana") {
    const r = buildPeriodoRange("campana", 0);
    return { start: r.start, end: r.end, label: r.label, detail: r.detail };
  }
  // ultimas4: 4 semanas completas (28 dias) terminando hoy.
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 27);
  const startIso = toISODateLocal(start);
  const endIso = toISODateLocal(end);
  return {
    start: startIso,
    end: endIso,
    label: "Últimas 4 semanas",
    detail: `${formatDate(startIso)} – ${formatDate(endIso)}`,
  };
}

export default function EconomicoPanel() {
  const [preset, setPreset] = useState<RangoPreset>("mes");
  const rango = useMemo(() => buildRango(preset), [preset]);

  const panel = useEconomicoPanel(rango.start, rango.end);

  const mostrarGrafico = panel.serieCombinada.length >= 2;
  const maxSerie = Math.max(...panel.serieCombinada.map((s) => Math.max(s.facturacion, s.coste)), 0);

  if (panel.sinPermiso) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker">Económico</p>
            <h1 className="page-title">Panel económico</h1>
            <p className="page-subtitle">Facturación, costes y margen bruto estimado del periodo elegido.</p>
          </div>
        </header>
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Acceso restringido</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Solo administración puede ver esta sección.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">Económico</p>
          <h1 className="page-title">Panel económico</h1>
          <p className="page-subtitle">Facturación, costes y margen bruto estimado del periodo elegido.</p>
        </div>
      </header>

      <div className="section-toolbar flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-1 shadow-[var(--glass-shadow)]">
          {PRESETS.map((option) => {
            const active = preset === option.value;
            return (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPreset(option.value)}
                className={cn(
                  "h-7 rounded-lg px-3 text-xs transition-all",
                  active
                    ? "bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)] font-semibold"
                    : "text-muted-foreground hover:bg-[var(--glass-bg-strong)]/60 hover:text-foreground",
                )}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{rango.detail}</p>
      </div>

      {panel.tablesMissingVentas ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Las tablas de ventas semanales de Mercadona todavía no existen en la base de datos; la facturación de este panel se mostrará en cuanto se activen.
        </div>
      ) : null}

      {panel.hayPrecioCero && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">Faltan tarifas reales:</span> los costes están incompletos.
            </p>
            <Button asChild size="sm" variant="outline" className="glass glass-hover">
              <Link to="/economico/precios">Ver tarifas</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── KPIs ─────────────────────────────────────────────────────────── */}
      {panel.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          <KPICard
            className="glass-accented"
            label="Facturación Mercadona"
            value={formatEuro(panel.facturacionRango)}
            icon={Euro}
            hint={`${panel.semanasEnRango.length} semana(s) con base IVA en el periodo`}
          />
          <KPICard
            className="glass-accented"
            label="Coste de consumos"
            value={formatEuro(panel.costes.costeTotal)}
            icon={Receipt}
          />
          <KPICard
            className="glass-accented"
            label="Margen bruto estimado"
            value={formatEuro(panel.margenBruto)}
            icon={TrendingUp}
            accent={panel.margenBruto >= 0 ? "success" : "destructive"}
          />
          <KPICard
            className="glass-accented"
            label="Coste / kg producido"
            value={panel.costes.costePorKg != null ? `${formatNumber(panel.costes.costePorKg, 4)} €/kg` : "—"}
            icon={Scale}
          />
          <KPICard
            className="glass-accented"
            label="€/kg medio Mercadona"
            value={panel.eurosPorKgMedio != null ? `${formatNumber(panel.eurosPorKgMedio, 3)} €/kg` : "—"}
            icon={ShoppingCart}
            hint="Base IVA / vendido del periodo"
          />
        </section>
      )}

      {/* ─── Evolución semanal: facturación, coste y margen ──────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <p className="panel-kicker">Evolución</p>
          <CardTitle className="text-base">Facturación, coste y margen por semana</CardTitle>
          <p className="text-xs text-muted-foreground">Facturación Mercadona y coste de consumos (barras), margen bruto (línea).</p>
        </CardHeader>
        <CardContent>
          {panel.isLoading ? (
            <Skeleton className="h-64" />
          ) : !mostrarGrafico ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay suficientes semanas con datos en este periodo para dibujar la evolución.
            </p>
          ) : (
            <div className={CHART_PANEL_CLASS}>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={panel.serieCombinada} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis {...XAXIS} dataKey="semanaInicio" tickFormatter={(value: string) => formatDate(value)} />
                  <YAxis {...YAXIS} domain={[0, Math.max(maxSerie * 1.15, 1)]} />
                  <Tooltip
                    cursor={CHART_CURSOR}
                    content={({ active, payload, label }) => (
                      <GlassTooltip
                        active={active}
                        payload={payload as { name: string; value: number | string; color?: string; fill?: string; stroke?: string }[] | undefined}
                        label={label ? `Semana del ${formatDate(String(label))}` : undefined}
                        formatter={(value) => formatEuro(Number(value))}
                      />
                    )}
                  />
                  <Bar dataKey="facturacion" name="Facturación" fill={barFill(C.primary, 0.4)} stroke={C.primary} strokeWidth={1.5} radius={[6, 6, 2, 2]} maxBarSize={28} />
                  <Bar dataKey="coste" name="Coste" fill={barFill(C.warning, 0.4)} stroke={C.warning} strokeWidth={1.5} radius={[6, 6, 2, 2]} maxBarSize={28} />
                  <Line dataKey="margen" name="Margen" {...lineStyle(C.success)} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        {/* ─── Desglose de costes por recurso ─────────────────────────────── */}
        <Card className="glass-accented overflow-hidden">
          <CardHeader>
            <p className="panel-kicker">Costes</p>
            <CardTitle className="text-base">Coste por recurso</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {panel.isLoading ? (
              <Skeleton className="m-4 h-40" />
            ) : panel.porRecursoConKg.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Sin consumo registrado en este periodo.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recurso</TableHead>
                    <TableHead className="text-right">Coste</TableHead>
                    <TableHead className="text-right">Coste/kg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...panel.porRecursoConKg].sort((a, b) => b.coste - a.coste).map((r) => {
                    const Icon = RECURSO_ICON[r.recurso] ?? Droplet;
                    return (
                      <TableRow key={r.recurso}>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            {recursoLabel(r.recurso)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatEuro(r.coste)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.costePorKg != null ? `${formatNumber(r.costePorKg, 4)} €/kg` : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ─── Facturación Mercadona por método ────────────────────────────── */}
        <Card className="glass-accented overflow-hidden">
          <CardHeader>
            <p className="panel-kicker">Facturación</p>
            <CardTitle className="text-base">Por método del periodo</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {panel.isLoading ? (
              <Skeleton className="m-4 h-40" />
            ) : panel.metodosDelPeriodo.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Sin base IVA por método en este periodo.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Kilos</TableHead>
                    <TableHead className="text-right">Base IVA</TableHead>
                    <TableHead className="text-right">€/kg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {panel.metodosDelPeriodo.map((f) => (
                    <TableRow key={f.metodo}>
                      <TableCell className="font-medium">
                        <div>{metodoLabel(f.metodo)}</div>
                        <div className="text-xs text-muted-foreground">{f.metodo}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(f.kilos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(f.baseIva)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.eurosPorKg != null ? `${formatNumber(f.eurosPorKg, 3)} €/kg` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Accesos rápidos ────────────────────────────────────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Accesos rápidos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2.5 sm:grid-cols-3">
          {ACCESOS_RAPIDOS.map(({ to, label, desc, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group flex items-start gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3.5 transition-colors hover:bg-[var(--glass-bg-strong)]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg glass-strong text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
              </div>
              <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card className="glass border-[var(--glass-border)] bg-[var(--glass-bg)]">
        <CardContent className="flex items-start gap-3 pt-6">
          <Info className="h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Margen bruto estimado</span> = facturación Mercadona −
            coste de consumos. No incluye mano de obra, fruta ni otros costes (Fase 1).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
