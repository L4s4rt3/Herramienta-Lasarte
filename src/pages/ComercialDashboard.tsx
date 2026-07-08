// src/pages/ComercialDashboard.tsx
// "Panel comercial": portada del espacio Comercial. Da un vistazo rápido a lo
// importante en ventas — Mercadona (cliente principal), las dos categorías de
// venta y el ranking de clientes por kg expedido — con accesos directos a las
// páginas de detalle de cada sección.
import { Link } from "react-router-dom";
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, Boxes, Euro, FileStack, Layers, PackageCheck, ShoppingCart, Trophy, Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KPICard } from "@/components/KPICard";
import { useComercialDashboard } from "@/hooks/useComercialDashboard";
import { formatKg, formatNumber, formatPct } from "@/lib/format";
import { BAR_STYLE, C, CHART_PANEL_CLASS, GlassTooltip, GRID, lineStyle, MARGIN, XAXIS, YAXIS } from "@/lib/chartTheme";
import { cn } from "@/lib/utils";

function cumplimientoAccent(pct: number): "success" | "warning" | "destructive" {
  if (pct >= 95) return "success";
  if (pct >= 80) return "warning";
  return "destructive";
}

function EstadoVacio({ icon: Icon, texto }: { icon: typeof ShoppingCart; texto: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/40" />
      <p className="max-w-xs text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}

const ACCESOS_RAPIDOS = [
  { to: "/comercial/mercadona", label: "Mercadona", desc: "Ventas semanales y planificación", icon: ShoppingCart },
  { to: "/ventas/categoria-segunda", label: "Categoría segunda", desc: "Ranking, clientes y catálogo", icon: Layers },
  { to: "/ventas/categoria-primera", label: "Categoría primera", desc: "Ranking, clientes y catálogo", icon: Layers },
  { to: "/cmr", label: "CMR / Hojas de ruta", desc: "Documentos de transporte", icon: FileStack },
] as const;

export default function ComercialDashboard() {
  const d = useComercialDashboard();

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">Comercial</p>
          <h1 className="page-title">Panel comercial</h1>
          <p className="page-subtitle">Ventas de un vistazo: Mercadona, categorías y clientes.</p>
        </div>
      </header>

      {d.tablesMissing ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Las tablas de ventas semanales de Mercadona todavía no existen en la base de datos; esa parte del panel se mostrará en cuanto se activen.
        </div>
      ) : null}

      {/* ─── KPIs ─────────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {d.isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : (
          <>
            <KPICard
              className="glass-accented"
              label="Vendido Mercadona (última semana)"
              value={d.ultimaSemana ? formatKg(d.vendidoKg) : "Sin semanas"}
              hint={d.ultimaSemana && d.planificadoKg > 0 ? `${formatPct(d.pctCumplimiento, 0)} cumplimiento` : undefined}
              accent={d.ultimaSemana && d.planificadoKg > 0 ? cumplimientoAccent(d.pctCumplimiento) : "primary"}
              icon={ShoppingCart}
              to="/comercial/mercadona"
            />
            <KPICard
              className="glass-accented"
              label="€/kg medio Mercadona"
              value={d.tieneBaseIva ? `${formatNumber(d.eurosPorKg, 3)} €/kg` : "—"}
              hint={d.tieneBaseIva ? "Base IVA / vendido, última semana" : "Sin base IVA en esta semana"}
              icon={Euro}
              to="/comercial/mercadona"
            />
            <KPICard
              className="glass-accented"
              label="Categoría segunda (kg)"
              value={d.categoriaSegunda.hasAccess ? formatKg(d.categoriaSegunda.kg) : "Sin acceso"}
              hint={d.categoriaSegunda.hasAccess && d.categoriaSegunda.baseIva > 0 ? `${formatNumber(d.categoriaSegunda.baseIva, 0)} € del periodo` : undefined}
              icon={Layers}
              to="/ventas/categoria-segunda"
            />
            <KPICard
              className="glass-accented"
              label="Categoría primera (kg)"
              value={d.categoriaPrimera.hasAccess ? formatKg(d.categoriaPrimera.kg) : "Sin acceso"}
              hint={d.categoriaPrimera.hasAccess && d.categoriaPrimera.baseIva > 0 ? `${formatNumber(d.categoriaPrimera.baseIva, 0)} € del periodo` : undefined}
              icon={Layers}
              to="/ventas/categoria-primera"
            />
            <KPICard
              className="glass-accented"
              label="Clientes activos (mes)"
              value={formatNumber(d.totalClientesActivos)}
              hint="Con expediciones en los últimos 30 días"
              icon={Users}
            />
          </>
        )}
      </section>

      {/* ─── Evolución semanal Mercadona ──────────────────────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-primary">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Evolución semanal Mercadona</CardTitle>
              <p className="text-xs text-muted-foreground">Vendido (barras) vs planificado (línea) por semana importada.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {d.isLoading ? (
            <Skeleton className="h-64" />
          ) : d.evolucionSemanal.length === 0 ? (
            <EstadoVacio icon={ShoppingCart} texto="Todavía no hay semanas de Mercadona importadas." />
          ) : (
            <div className={CHART_PANEL_CLASS}>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={d.evolucionSemanal} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...XAXIS} />
                  <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                  <Bar dataKey="vendido" name="Vendido" fill={C.primary} stroke={C.primary} {...BAR_STYLE} />
                  <Line dataKey="planificado" name="Planificado" {...lineStyle(C.info)} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        {/* ─── Top clientes por kg ────────────────────────────────────────── */}
        <Card className="glass-accented overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-primary">
                <Trophy className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">Top clientes por kg</CardTitle>
                <p className="text-xs text-muted-foreground">Últimos 30 días, palets expedidos.</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {d.isLoading ? (
              <Skeleton className="h-64" />
            ) : d.topClientes.length === 0 ? (
              <EstadoVacio icon={Boxes} texto="Sin expediciones con cliente en los últimos 30 días." />
            ) : (
              <ul className="divide-y divide-[var(--glass-border)]">
                {d.topClientes.map((c, i) => {
                  const maxKg = d.topClientes[0]?.kg || 1;
                  return (
                    <li key={c.cliente} className="py-2.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                            i === 0 ? "bg-primary/15 text-primary" : "bg-[var(--glass-bg-strong)] text-muted-foreground",
                          )}>
                            {i + 1}
                          </span>
                          <span className="truncate font-medium">{c.cliente}</span>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold tabular-nums">{formatKg(c.kg)}</p>
                          <p className="text-[11px] text-muted-foreground">{formatNumber(c.palets)} palets · {formatNumber(c.cajas)} cajas</p>
                        </div>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round((c.kg / maxKg) * 100))}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ─── Accesos rápidos ─────────────────────────────────────────────── */}
        <Card className="glass-accented overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Accesos rápidos</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2.5 sm:grid-cols-2">
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
      </section>
    </div>
  );
}
