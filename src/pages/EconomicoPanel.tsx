// src/pages/EconomicoPanel.tsx
// Sección "Económico → Panel": dashboard de portada del modo económico. Cruza
// la facturación de Mercadona (base_iva de mercadona_semanas/_metodos, semanas
// cuyo rango L-S solapa el periodo elegido) + ventas de categoría segunda
// (dato mensual del importador, ver ventasCategoria) con el coste de consumos,
// mallas rotas, compra de fruta y personal del mismo periodo (useEconomicoPanel,
// que compone useCostesPeriodo + useCosteMallas + useCosteFruta +
// useCostePersonal + useMercadonaVentas + useVentasCategoria) para un margen
// bruto estimado, su evolución semanal y los desgloses por recurso y por
// método. Quedan fuera del margen: el envasado de la fruta BUENA vendida
// (solo se descuenta el de las mallas rotas) y las amortizaciones.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, Calculator, Citrus, Droplet, Euro, FlaskConical, Fuel, Info, PackageX, Receipt, Scale,
  ShieldAlert, ShoppingCart, Tag, TrendingUp, Users, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KPICard } from "@/components/KPICard";
import { ProgressBarRow } from "@/components/ProgressBarRow";
import { SelectorPeriodo } from "@/components/SelectorPeriodo";
import { ReferenciaMedia } from "@/components/charts/ReferenciaMedia";
import { EconomicoSubnav } from "@/components/economico/EconomicoSubnav";
import { useEconomicoPanel } from "@/hooks/useEconomico";
import { useMermaLotes } from "@/hooks/useMermaLote";
import { useCmvCostesMensuales } from "@/hooks/useCmv";
import { metodoLabel } from "@/components/mercadona/mercadonaAnalisis.helpers";
import { periodoDeFecha, rangoPersonalizado, type PeriodoValue } from "@/lib/selectorPeriodo";
import { formatDate, formatEuro, formatKg, formatNumber, today, toISODateLocal } from "@/lib/format";
import { agregarMermaLotes, mermaLotesEnPeriodo } from "@/lib/mermaLote";
import { mesesEnRango } from "@/lib/economico";
import {
  C, CHART_CURSOR, CHART_PANEL_CLASS, GRID, GlassTooltip, MARGIN, XAXIS, YAXIS, barFill, legendStyle, lineStyle,
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

/** Formato compacto para los ticks del eje Y (evita números crudos sin separador de miles). */
function formatEuroCompact(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1000) return `${formatNumber(value / 1000, 1)}k €`;
  return `${formatNumber(value, 0)} €`;
}

/** Resumen de dónde sale el precio de mallas usado en el desglose de "Coste por recurso". */
function fuenteMallasResumen(fuenteZ1: "envasado" | "manual" | null, fuenteZ2: "envasado" | "manual" | null): string {
  const FUENTE_LABEL: Record<"envasado" | "manual", string> = { envasado: "del envasado", manual: "manual" };
  if (!fuenteZ1 && !fuenteZ2) return "";
  if (fuenteZ1 === fuenteZ2 && fuenteZ1) return `Precio de malla: ${FUENTE_LABEL[fuenteZ1]} (Z1 y Z2).`;
  const partes: string[] = [];
  if (fuenteZ1) partes.push(`Z1 ${FUENTE_LABEL[fuenteZ1]}`);
  if (fuenteZ2) partes.push(`Z2 ${FUENTE_LABEL[fuenteZ2]}`);
  return partes.length > 0 ? `Precio de malla: ${partes.join(" · ")}.` : "";
}

const ACCESOS_RAPIDOS = [
  { to: "/economico/cmv", label: "CMV", desc: "Coste medio por kg vendido y margen", icon: Calculator },
  { to: "/economico/facturacion", label: "Facturación", desc: "Semanas y métodos de Mercadona", icon: Euro },
  { to: "/economico/costes", label: "Costes", desc: "Consumos vs tarifas por periodo", icon: Receipt },
  { to: "/economico/fruta", label: "Compra de fruta", desc: "Detalle por lote, agricultor y forfait", icon: Citrus },
  { to: "/economico/precios", label: "Precios", desc: "Tarifas de agua, gasoil, luz y químicos", icon: Tag },
] as const;

// ─── Accesos rápidos de periodo (Este mes / Últimas 4 semanas / Campaña) ────────
// El periodo en sí lo controla el SelectorPeriodo único (mes/campaña con
// flechas + "Hoy" + saltar a fecha); estos 3 botones son atajos que lo fijan
// de un toque, igual que antes de introducir el selector.

type RangoPreset = "mes" | "ultimas4" | "campana";

const PRESETS: { value: RangoPreset; label: string }[] = [
  { value: "mes", label: "Este mes" },
  { value: "ultimas4", label: "Últimas 4 semanas" },
  { value: "campana", label: "Campaña" },
];

function presetPeriodo(preset: RangoPreset): PeriodoValue {
  if (preset === "mes") return periodoDeFecha("mes", today());
  if (preset === "campana") return periodoDeFecha("campana", today());
  // ultimas4: 4 semanas completas (28 dias) terminando hoy — no es una
  // granularidad de SelectorPeriodo, así que se representa como "rango" libre.
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 27);
  return rangoPersonalizado(toISODateLocal(start), toISODateLocal(end));
}

function mismoPeriodo(a: PeriodoValue, b: PeriodoValue): boolean {
  return a.modo === b.modo && a.desde === b.desde && a.hasta === b.hasta;
}

export default function EconomicoPanel() {
  const [periodo, setPeriodo] = useState<PeriodoValue>(() => presetPeriodo("mes"));

  const panel = useEconomicoPanel(periodo.desde, periodo.hasta);

  // Pérdida de fruta (merma + podrido): DESGLOSE informativo de "Compra de
  // fruta" de arriba, calculado aparte (useMermaLotes) porque no forma parte
  // de useEconomicoPanel — nunca se resta del margen bruto ni de ningún total.
  const { lotes: mermaLotesTodos, isLoading: isLoadingMerma } = useMermaLotes();
  const perdidaFrutaAgregado = useMemo(() => {
    const enRango = mermaLotesEnPeriodo(mermaLotesTodos, periodo.desde, periodo.hasta).filter((l) => l.estado === "procesado");
    return agregarMermaLotes(enRango);
  }, [mermaLotesTodos, periodo]);

  // Aviso: ¿hay coste de personal REAL registrado en el CMV (cmv_costes_mensuales)
  // para algún mes que solape este periodo? Este margen (useEconomicoPanel →
  // useCostePersonal) siempre usa la ESTIMACIÓN por asistencia, nunca el
  // apunte manual del CMV — se avisa para que no se lea como "personal real"
  // por error. Reutiliza la query cacheada de useCmvCostesMensuales (misma
  // clave que ya usa Económico → CMV) en vez de duplicar el fetch.
  const manualesCmv = useCmvCostesMensuales();
  const mesesPersonalRealEnPeriodo = useMemo(() => {
    const meses = new Set(mesesEnRango(periodo.desde, periodo.hasta));
    return manualesCmv.rows.filter((r) => r.tipo === "personal_real" && meses.has(r.mes));
  }, [manualesCmv.rows, periodo]);

  const mostrarGrafico = panel.serieCombinada.length >= 2;
  const maxSerie = Math.max(...panel.serieCombinada.map((s) => Math.max(s.facturacion, s.coste)), 0);
  // Media de facturación de las semanas visibles: umbral con significado
  // (línea fantasma), mismo patrón que Dashboard.tsx (FASE 5, jul 2026).
  const mediaFacturacion = panel.serieCombinada.length > 0
    ? panel.serieCombinada.reduce((s, r) => s + r.facturacion, 0) / panel.serieCombinada.length
    : 0;

  if (panel.sinPermiso) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
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
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Económico</p>
          <h1 className="page-title">Panel económico</h1>
          <p className="page-subtitle">Facturación, costes y margen bruto estimado del periodo elegido.</p>
        </div>
      </header>

      <EconomicoSubnav />

      <div className="section-toolbar flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-1 shadow-[var(--glass-shadow)]">
          {PRESETS.map((option) => {
            const active = mismoPeriodo(periodo, presetPeriodo(option.value));
            return (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPeriodo(presetPeriodo(option.value))}
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
        <SelectorPeriodo
          bare
          value={periodo}
          onChange={setPeriodo}
          canNavigateNext={periodo.desde <= today()}
        />
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

      {panel.mallas.faltanDatos && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">Falta config de mallas:</span> el gasto de mallas rotas puede estar infravalorado.
            </p>
            <Button asChild size="sm" variant="outline" className="glass glass-hover">
              <Link to="/economico/precios">Configurar mallas</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {panel.hayPrecioCeroEmpaque && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">Faltan precios de envasado:</span> el coste total por malla (y por tanto el gasto de mallas rotas) puede estar infravalorado.
            </p>
            <Button asChild size="sm" variant="outline" className="glass glass-hover">
              <Link to="/economico/precios">Ver precios de envasado</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {panel.costeFruta.faltanImportes && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">Faltan importes en báscula:</span> hay kg de fruta comprados en el periodo sin precio en el export, así que el coste de compra de fruta puede estar infravalorado.
            </p>
            <Button asChild size="sm" variant="outline" className="glass glass-hover">
              <Link to="/entradas">Ver entradas de báscula</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {mesesPersonalRealEnPeriodo.length > 0 && (
        <Card className="glass border-info/30 bg-info/6">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <Info className="h-5 w-5 shrink-0 text-info" />
            <p className="flex-1 text-sm">
              Hay coste de personal REAL registrado en CMV para este periodo; este margen usa la estimación por asistencia.
            </p>
            <Button asChild size="sm" variant="outline" className="glass glass-hover">
              <Link to="/economico/cmv">Ver CMV</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── KPIs ─────────────────────────────────────────────────────────── */}
      {panel.isLoading || isLoadingMerma ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <KPICard
            className="glass-accented"
            label="Facturación Mercadona"
            value={formatEuro(panel.facturacionRango)}
            icon={Euro}
            hint={`${panel.semanasEnRango.length} semana(s) con base IVA en el periodo`}
          />
          <KPICard
            className="glass-accented"
            label="Ventas 2ª categoría"
            value={formatEuro(panel.facturacionSegunda.total)}
            icon={Tag}
            labelInfo="Clientes fijos de categoría segunda (LN211/LN314/LN210/LN560/L1020/L1511/LN551) del importador mensual — no incluye Mercadona, se suma sin doble conteo. Dato MENSUAL: se cuentan enteros los meses que solapan el periodo, no se reparte por semana ni aparece en el gráfico de evolución."
            hint={panel.facturacionSegunda.disponible
              ? `${panel.facturacionSegunda.meses.length} mes(es) del importador mensual`
              : "Sin datos importados todavía"}
          />
          <KPICard
            className="glass-accented"
            label="Coste de consumos"
            value={formatEuro(panel.costes.costeTotal)}
            icon={Receipt}
          />
          <KPICard
            className="glass-accented"
            label="Compra de fruta"
            value={formatEuro(panel.costeFruta.totalImporte)}
            icon={Citrus}
            accent={panel.costeFruta.faltanImportes ? "warning" : "primary"}
            labelInfo="Entradas de báscula del periodo: importe_total si el export lo trae relleno, si no compra + recolección + transporte + comisión. No incluye el stock inicial reconstruido (kg de cámara ya existentes antes de empezar a registrar entradas)."
            hint={`${formatKg(panel.costeFruta.kgTotales)} comprados`}
          />
          <KPICard
            className="glass-accented"
            label="Pérdida de fruta"
            value={formatEuro(perdidaFrutaAgregado.eurPerdidaTotal)}
            icon={Scale}
            accent={perdidaFrutaAgregado.eurPerdidaTotal > 0 ? "warning" : "primary"}
            labelInfo="Merma (natural estimada + podrido pre-calibrador asumido) + podrido (calibrador + manual), valorados al €/kg de compra de cada lote procesado del periodo. Es un DESGLOSE de 'Compra de fruta' de arriba, ya incluido en ese importe — no se resta otra vez del margen bruto. Detalle completo en Económico → Costes."
            hint={perdidaFrutaAgregado.pctPerdidaTotalSobreCoste != null ? `${formatNumber(perdidaFrutaAgregado.pctPerdidaTotalSobreCoste, 1)}% del coste de fruta` : undefined}
            to="/economico/costes"
          />
          <KPICard
            className="glass-accented"
            label="Coste de personal"
            value={formatEuro(panel.costePersonal.total)}
            icon={Users}
            labelInfo="Coste por hora × horas estimadas (días presentes × jornada de 8h) de la plantilla activa — mismo cálculo que Económico → Costes."
            hint={`${panel.costePersonal.porZona.length} zona(s) con personal`}
          />
          <KPICard
            className="glass-accented"
            label="Mallas rotas"
            value={formatEuro(panel.mallas.totalGasto)}
            icon={PackageX}
            accent={panel.mallas.totalGasto > 0 ? "warning" : "primary"}
            labelInfo="Reciclado de malla Z1/Z2 del periodo valorado al coste total de envasado por malla (etiqueta, caja, palet, malla, banda, fleje y asa)."
            hint={`${formatNumber(panel.mallas.totalMallas, 0)} malla(s) rota(s)`}
          />
          <KPICard
            className="glass-accented"
            label="Margen bruto estimado"
            value={formatEuro(panel.margenBruto)}
            icon={TrendingUp}
            accent={panel.margenBruto >= 0 ? "success" : "destructive"}
            hint="Facturación (Mercadona + 2ª) − consumos − mallas − fruta − personal"
            labelInfo="Facturación BRUTA (base IVA) de Mercadona + categoría segunda, menos consumos, mallas rotas, compra de fruta y personal. Para el escandallo por kg con facturación NETA (tras comisión/transporte de venta, 1ª + 2ª categoría), ver Económico → CMV — los dos márgenes difieren a propósito."
            /* --vivo: KPI principal de este dashboard (dato vivo, ajuste 2026-07-16) */
            valueClassName="text-vivo"
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
          <p className="text-xs text-muted-foreground">
            Facturación Mercadona, coste de consumos y mallas rotas (barras apiladas), margen bruto (línea).
            No incluye ventas de 2ª categoría (dato mensual), compra de fruta ni personal — solo en los KPIs.
          </p>
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
                  <YAxis {...YAXIS} width={52} domain={[0, Math.max(maxSerie * 1.15, 1)]} tickFormatter={formatEuroCompact} />
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
                  <Legend wrapperStyle={legendStyle} />
                  <ReferenciaMedia y={mediaFacturacion} label="Media facturación" />
                  <Bar dataKey="facturacion" name="Facturación" fill={barFill(C.primary, 0.4)} stroke={C.primary} strokeWidth={1.5} radius={[6, 6, 2, 2]} maxBarSize={28} />
                  <Bar dataKey="costeConsumos" name="Coste de consumos" stackId="coste" fill={barFill(C.warning, 0.4)} stroke={C.warning} strokeWidth={1.5} radius={[6, 6, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="mallas" name="Mallas rotas" stackId="coste" fill={barFill(C.destructive, 0.5)} stroke={C.destructive} strokeWidth={1.5} radius={[0, 0, 2, 2]} maxBarSize={28} />
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
            ) : (() => {
              const filas = [...panel.porRecursoConKg].sort((a, b) => b.coste - a.coste);
              const totalCoste = filas.reduce((s, r) => s + r.coste, 0) + panel.mallas.totalGasto;
              return (
                <div className="space-y-2.5 p-4 sm:p-5">
                  {filas.map((r) => {
                    const Icon = RECURSO_ICON[r.recurso] ?? Droplet;
                    return (
                      <ProgressBarRow
                        key={r.recurso}
                        label={(
                          <span className="inline-flex items-center gap-1.5">
                            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            {recursoLabel(r.recurso)}
                          </span>
                        )}
                        labelClassName="w-32 sm:w-40"
                        pct={totalCoste > 0 ? (r.coste / totalCoste) * 100 : 0}
                        value={formatEuro(r.coste)}
                        extra={(
                          <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">
                            {r.costePorKg != null ? `${formatNumber(r.costePorKg, 4)} €/kg` : "—"}
                          </span>
                        )}
                      />
                    );
                  })}
                  <ProgressBarRow
                    label={(
                      <span className="inline-flex items-center gap-1.5 text-destructive">
                        <PackageX className="h-3.5 w-3.5 shrink-0" />
                        Mallas rotas
                      </span>
                    )}
                    labelClassName="w-32 sm:w-40"
                    barClassName="bg-destructive"
                    pct={totalCoste > 0 ? (panel.mallas.totalGasto / totalCoste) * 100 : 0}
                    value={<span className="text-destructive">{formatEuro(panel.mallas.totalGasto)}</span>}
                    extra={(
                      <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">
                        {panel.costes.kgProducidos > 0 ? `${formatNumber(panel.mallas.totalGasto / panel.costes.kgProducidos, 4)} €/kg` : "—"}
                      </span>
                    )}
                  />
                  <p className="pt-1 text-[11px] text-muted-foreground">
                    {formatNumber(panel.mallas.totalMallas, 0)} malla(s) rota(s) en el periodo · barras a escala del coste total ({formatEuro(totalCoste)})
                  </p>
                  {fuenteMallasResumen(panel.mallas.z1.fuentePrecio, panel.mallas.z2.fuentePrecio) && (
                    <p className="text-[11px] text-muted-foreground">
                      {fuenteMallasResumen(panel.mallas.z1.fuentePrecio, panel.mallas.z2.fuentePrecio)}
                    </p>
                  )}
                </div>
              );
            })()}
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
        <CardContent className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
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
                {/* Compra de fruta: dato-resumen del periodo elegido, ya disponible
                    en useEconomicoPanel (mismo importe que el KPI "Compra de
                    fruta" de arriba) — antes esta tarjeta era una isla sin dato. */}
                {to === "/economico/fruta" && !panel.isLoading && (
                  <p className="mt-1 text-xs font-semibold tabular-nums text-foreground">
                    {formatEuro(panel.costeFruta.totalImporte)} en el periodo
                  </p>
                )}
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
            <span className="font-semibold text-foreground">Margen bruto estimado</span> = (facturación Mercadona +
            ventas de 2ª categoría) − coste de consumos − mallas rotas − compra de fruta − coste de personal.
            Las mallas rotas se valoran al coste TOTAL de envasado por malla (etiqueta, caja, palet, malla, banda,
            fleje y asa), pero el envasado de la fruta buena que sí se vende no se descuenta todavía. Tampoco
            incluye amortizaciones ni otros costes indirectos.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
