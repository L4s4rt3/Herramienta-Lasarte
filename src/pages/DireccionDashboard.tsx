// src/pages/DireccionDashboard.tsx
// "Panel de dirección": portada GLOBAL para el jefe (admin). Un vistazo rápido
// a las 4 grandes áreas — Producción, Comercial, RRHH, Económico — cada una
// con sus KPIs más importantes y un acceso directo a su dashboard completo.
// No recalcula nada por su cuenta: todo sale de useDireccionDashboard, que a
// su vez reutiliza los hooks/queries que ya alimentan cada sección.
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  Citrus,
  Euro,
  Factory,
  Gauge,
  HeartPulse,
  Layers,
  Receipt,
  Scale,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KPICard } from "@/components/KPICard";
import { useDireccionDashboard } from "@/hooks/useDireccionDashboard";
import { formatKg, formatNumber, formatPct } from "@/lib/format";
import {
  BAR_STYLE, C, CHART_PANEL_CLASS, GlassTooltip, GRID, lineStyle, MARGIN, XAXIS, YAXIS,
} from "@/lib/chartTheme";

function formatEuro(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, digits)} €`;
}

function cumplimientoAccent(pct: number): "success" | "warning" | "destructive" {
  if (pct >= 95) return "success";
  if (pct >= 80) return "warning";
  return "destructive";
}

function asistenciaAccent(pct: number): "success" | "warning" | "destructive" {
  if (pct >= 90) return "success";
  if (pct >= 75) return "warning";
  return "destructive";
}

// ─── Cabecera de bloque (icono + título + acceso directo a la sección) ─────

function AreaHeader({ icon: Icon, title, subtitle, to }: { icon: LucideIcon; title: string; subtitle: string; to: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">
        Ver panel completo <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function EstadoVacio({ texto }: { texto: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 py-6 text-center text-sm text-muted-foreground">
      <p>{texto}</p>
    </div>
  );
}

export default function DireccionDashboard() {
  const { produccion, comercial, rrhh, economico } = useDireccionDashboard();

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          {/* Acento de Dirección (--seccion-acento-texto, FASE 3 del rediseño). */}
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Dirección</p>
          <h1 className="page-title">Panel de dirección</h1>
          <p className="page-subtitle">
            Un vistazo a las 4 áreas: producción, comercial, RRHH y económico.
          </p>
        </div>
      </header>

      {/* ═══ Producción ═══════════════════════════════════════════════════ */}
      <section className="space-y-3">
        <AreaHeader icon={Factory} title="Producción" subtitle={`Semana ${produccion.semanaLabel} · cascada DJPMN`} to="/produccion" />

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {produccion.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)
          ) : (
            <>
              <KPICard
                className="glass-accented"
                label="Producción real (semana)"
                value={formatKg(produccion.produccionSemanaKg)}
                hint={produccion.hayDatos ? `Semana ${produccion.semanaLabel}` : "Sin partes esta semana"}
                icon={Truck}
                to="/produccion"
              />
              <KPICard
                className="glass-accented"
                label="Mermas (podrido)"
                value={`${produccion.mermasPct.toFixed(2)}%`}
                hint={produccion.hayDatos ? `${formatKg(produccion.mermasKg)} · manual + calibrador` : "Sin partes esta semana"}
                icon={Trash2}
                to="/produccion"
              >
                <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md border-l-[3px] border-warning bg-warning/10 px-2.5 py-1.5">
                  <p className="min-w-0 text-xs font-medium leading-tight">Merma + DSJ</p>
                  <span className="shrink-0 text-base font-bold tabular-nums">
                    {produccion.mermaTotalConDsjPct.toFixed(2)}%
                  </span>
                </div>
              </KPICard>
              <KPICard
                className="glass-accented"
                label="DJPMN medio"
                value={`${produccion.dsjPct >= 0 ? "+" : ""}${produccion.dsjPct.toFixed(2)}%`}
                hint={produccion.semaforo.label}
                accent={produccion.semaforo.accent}
                icon={TrendingDown}
                to="/produccion"
              />
              <KPICard
                className="glass-accented"
                label="Velocidad media"
                value={produccion.velocidadMedia != null ? `${produccion.velocidadMedia.toFixed(1)} T/h` : "—"}
                hint="Meta 14,5 T/h · 7 h/día desde el 2 jul"
                icon={Gauge}
                to="/produccion"
              />
              <KPICard
                className="glass-accented"
                label="Aprovechamiento Mercadona"
                value={produccion.aprovechamientoIsLoading ? "…" : formatPct(produccion.aprovechamientoMercadonaPct, 1)}
                hint={
                  produccion.aprovechamientoIsLoading
                    ? undefined
                    : produccion.aprovechamientoEsReal
                      ? "Vendido real (informe) / kg calibrador"
                      : "Estimado por palets · sin informe aún"
                }
                icon={ShoppingCart}
                to="/mercadona"
              />
            </>
          )}
        </div>

        <Card className="glass-accented overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Producción semanal (últimas semanas)</CardTitle>
          </CardHeader>
          <CardContent>
            {produccion.isLoading ? (
              <Skeleton className="h-40" />
            ) : produccion.evolucion.every((w) => w.kg === 0) ? (
              <EstadoVacio texto="Todavía no hay partes registrados en las últimas semanas." />
            ) : (
              <div className={CHART_PANEL_CLASS}>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={produccion.evolucion} margin={MARGIN}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="label" {...XAXIS} />
                    <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}t`} />
                    <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                    <Bar dataKey="kg" name="Producción" fill={C.primary} stroke={C.primary} {...BAR_STYLE} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ═══ Comercial ═════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        <AreaHeader icon={ShoppingCart} title="Comercial" subtitle="Mercadona y ventas por categoría" to="/comercial" />

        {comercial.tablesMissing ? (
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Las tablas de ventas semanales de Mercadona todavía no están activas.
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {comercial.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)
          ) : (
            <>
              <KPICard
                className="glass-accented"
                label="Vendido Mercadona (última semana)"
                value={comercial.hayUltimaSemana ? formatKg(comercial.vendidoKg) : "Sin semanas"}
                hint={comercial.hayUltimaSemana && comercial.hayPlanificado ? `${formatPct(comercial.pctCumplimiento, 0)} cumplimiento` : undefined}
                accent={comercial.hayUltimaSemana && comercial.hayPlanificado ? cumplimientoAccent(comercial.pctCumplimiento) : "primary"}
                icon={ShoppingCart}
                to="/comercial/mercadona"
              />
              <KPICard
                className="glass-accented"
                label="€/kg medio Mercadona"
                value={comercial.tieneBaseIva ? `${formatNumber(comercial.eurosPorKg, 3)} €/kg` : "—"}
                hint={comercial.tieneBaseIva ? "Base IVA / vendido, última semana" : "Sin base IVA en esta semana"}
                icon={Euro}
                to="/comercial/mercadona"
              />
              <KPICard
                className="glass-accented"
                label={`Ventas ${comercial.mesAnterior.label} (1ª + 2ª)`}
                value={
                  !comercial.hasAccessCategorias
                    ? "Sin acceso"
                    : comercial.mesAnterior.isLoading
                      ? "…"
                      : comercial.mesAnterior.hayDatos
                        ? formatKg(comercial.mesAnterior.kg)
                        : "Sin datos"
                }
                hint={
                  comercial.hasAccessCategorias && comercial.mesAnterior.hayDatos
                    ? `${formatEuro(comercial.mesAnterior.baseIva)} base IVA · mes pasado`
                    : `Mes pasado sin importar (${comercial.mesAnterior.label})`
                }
                icon={Layers}
                to="/comercial"
              />
            </>
          )}
        </div>

        <Card className="glass-accented overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Evolución semanal Mercadona</CardTitle>
          </CardHeader>
          <CardContent>
            {comercial.isLoading ? (
              <Skeleton className="h-40" />
            ) : comercial.evolucion.length === 0 ? (
              <EstadoVacio texto="Todavía no hay semanas de Mercadona importadas." />
            ) : (
              <div className={CHART_PANEL_CLASS}>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={comercial.evolucion} margin={MARGIN}>
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
      </section>

      {/* ═══ RRHH ══════════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        <AreaHeader icon={Users} title="RRHH" subtitle="Plantilla, asistencia y bajas" to="/rrhh" />

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {rrhh.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)
          ) : (
            <>
              <KPICard
                className="glass-accented"
                label="Plantilla activa"
                value={formatNumber(rrhh.plantillaActiva)}
                icon={Users}
                to="/rrhh/personas"
              />
              <KPICard
                className="glass-accented"
                label="Asistencia (último día)"
                value={rrhh.hayAsistenciaRegistrada ? formatPct(rrhh.pctAsistenciaUltimoDia ?? 0, 0) : "—"}
                hint={rrhh.hayAsistenciaRegistrada ? undefined : "Sin días con asistencia registrada"}
                accent={rrhh.hayAsistenciaRegistrada ? asistenciaAccent(rrhh.pctAsistenciaUltimoDia ?? 0) : "primary"}
                icon={CalendarCheck}
                to="/costes/asistencia"
              />
              <KPICard
                className="glass-accented"
                label="Ausencias esta semana"
                value={formatNumber(rrhh.ausenciasSemana)}
                hint="Desde el lunes"
                accent={rrhh.ausenciasSemana > 0 ? "warning" : "primary"}
                icon={AlertTriangle}
                to="/rrhh/ausencias"
              />
              <KPICard
                className="glass-accented"
                label="Bajas activas"
                value={formatNumber(rrhh.bajasActivas)}
                hint="Bajas laborales en curso"
                accent={rrhh.bajasActivas > 0 ? "warning" : "primary"}
                icon={HeartPulse}
                to="/rrhh/ausencias"
              />
            </>
          )}
        </div>
      </section>

      {/* ═══ Económico (solo admin) ═══════════════════════════════════════ */}
      {economico.mostrar && (
        <section className="space-y-3">
          <AreaHeader icon={Euro} title="Económico" subtitle={economico.periodoDetail} to="/economico" />

          {economico.sinPermiso ? (
            <Card className="glass-accented">
              <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <ShieldAlert className="h-8 w-8 text-warning" />
                <p className="text-sm text-muted-foreground">Solo administración puede ver este bloque.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {economico.hayPreciosACero && !economico.isLoading && (
                <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Hay tarifas a 0 en Precios: los costes de este bloque están incompletos.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {economico.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)
                ) : (
                  <>
                    <KPICard
                      className="glass-accented"
                      label={`Facturación (${economico.periodoLabel})`}
                      value={formatEuro(economico.facturacionPeriodo)}
                      icon={Euro}
                      labelInfo="Mercadona (base IVA de las semanas del periodo) + ventas de categoría segunda a clientes fijos. Mismo dato que 'Facturación (Mercadona + 2ª)' del Panel Económico."
                      to="/economico/facturacion"
                    />
                    <KPICard
                      className="glass-accented"
                      label="Costes totales"
                      value={formatEuro(economico.costeTotal)}
                      icon={Receipt}
                      labelInfo="Consumos (agua, gasoil, electricidad, químicos) + mallas rotas + compra de fruta + coste de personal. Mismo total que usa el Panel Económico para el margen bruto."
                      to="/economico/costes"
                    />
                    <KPICard
                      className="glass-accented"
                      label="Margen bruto estimado"
                      value={formatEuro(economico.margenBruto)}
                      accent={economico.margenBruto >= 0 ? "success" : "destructive"}
                      icon={TrendingUp}
                      labelInfo="Facturación (Mercadona + 2ª) − consumos − mallas − compra de fruta − coste de personal. Mismo cálculo y mismo número que el Panel Económico para este periodo."
                      /* --vivo: KPI principal de este dashboard (dato vivo, ajuste 2026-07-16) */
                      valueClassName="text-vivo"
                    >
                      <Link to="/economico" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                        Ver detalle <ArrowRight className="h-3 w-3" />
                      </Link>
                    </KPICard>
                    <KPICard
                      className="glass-accented"
                      label="Coste / kg producido"
                      value={economico.costePorKg != null ? `${formatNumber(economico.costePorKg, 4)} €/kg` : "—"}
                      icon={Scale}
                      labelInfo="Coste de consumos (sin mallas, fruta ni personal) dividido entre los kg producidos del periodo — no forma parte del margen bruto."
                      to="/economico/costes"
                    />
                  </>
                )}
              </div>

              {/* ─── Módulo "Compra de fruta y forfait" (FASE 3): promociona
                  /economico/fruta, hoy solo accesible desde dentro de Económico. ─── */}
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                {economico.fruta == null || economico.fruta.isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)
                ) : (
                  <>
                    <KPICard
                      className="glass-accented"
                      label="Compra de fruta (kg del periodo)"
                      value={formatKg(economico.fruta.kgComprados)}
                      icon={Citrus}
                      labelInfo="Kg comprados en entradas de báscula del periodo (mismo dato que 'Compra de fruta' del Panel Económico)."
                      to="/economico/fruta"
                    />
                    <KPICard
                      className="glass-accented"
                      label="€/kg medio de compra"
                      value={economico.fruta.eurosPorKgMedio != null ? `${formatNumber(economico.fruta.eurosPorKgMedio, 4)} €/kg` : "—"}
                      icon={Euro}
                      to="/economico/fruta"
                    />
                    <KPICard
                      className="glass-accented"
                      label="Forfait medio (coste/kg aprovechable)"
                      value={economico.fruta.forfaitMedioEurKg != null ? `${formatNumber(economico.fruta.forfaitMedioEurKg, 4)} €/kg` : "—"}
                      icon={Scale}
                      labelInfo="Σ coste de compra / Σ kg aprovechable (kg que llegan a venderse, tras merma y podrido) de todos los lotes procesados del periodo. Es el coste real por kilo vendible, no el €/kg de compra nominal — ver Económico → Compra de fruta para el detalle por productor/finca y el simulador."
                      to="/economico/fruta"
                    />
                  </>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
