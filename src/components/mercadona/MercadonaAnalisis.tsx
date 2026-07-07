// src/components/mercadona/MercadonaAnalisis.tsx
// Pestaña "Análisis" de Mercadona: cumplimiento histórico, mix de métodos en el
// tiempo y comparativa semana a semana. Puramente operativo (kg/cumplimiento/mix):
// sin nada de facturación, base IVA ni €/kg — eso vive en la pestaña Resumen.
import { Fragment, useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight, Gauge, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KPICard } from "@/components/KPICard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatKg, formatNumber, formatPct } from "@/lib/format";
import { BAR_STYLE_STACKED, C, CHART_PANEL_CLASS, GlassTooltip, GRID, MARGIN, SERIES_PALETTE, XAXIS, YAXIS, areaStops, barFill } from "@/lib/chartTheme";
import { cn } from "@/lib/utils";
import type { MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import {
  METODOS_ORDEN,
  buildComparativaSemanas,
  buildCumplimientoSerie,
  buildMixSerie,
  metodoLabel,
  resumenCumplimiento,
  tendenciasMetodos,
  type ComparativaMetodoRow,
} from "./mercadonaAnalisis.helpers";

function cumplimientoAccent(pct: number): "success" | "warning" | "destructive" {
  if (pct >= 95) return "success";
  if (pct >= 80) return "warning";
  return "destructive";
}

function accentColor(accent: "success" | "warning" | "destructive"): string {
  if (accent === "success") return C.success;
  if (accent === "warning") return C.warning;
  return C.destructive;
}

export function MercadonaAnalisis({ semanas }: { semanas: MercadonaSemanaConMetodos[] }) {
  if (semanas.length < 2) {
    return (
      <Card className="glass-accented">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <Gauge className="h-10 w-10 text-muted-foreground/50" />
          <div>
            <h2 className="text-lg font-semibold">Análisis no disponible todavía</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Se necesitan al menos 2 semanas importadas para el análisis
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <CumplimientoHistorico semanas={semanas} />
      <MixMetodos semanas={semanas} />
      <ComparativaSemanaASemana semanas={semanas} />
    </div>
  );
}

// ─── 1. Cumplimiento histórico ────────────────────────────────────────────────

function CumplimientoHistorico({ semanas }: { semanas: MercadonaSemanaConMetodos[] }) {
  const serie = useMemo(() => buildCumplimientoSerie(semanas), [semanas]);
  const resumen = useMemo(() => resumenCumplimiento(serie), [serie]);

  if (serie.length === 0) {
    return (
      <Card className="glass-accented">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cumplimiento histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">
            Ninguna semana tiene planificación registrada todavía.
          </p>
        </CardContent>
      </Card>
    );
  }

  const mediaAccent = cumplimientoAccent(resumen.media);

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KPICard
          className="glass-accented"
          label="Cumplimiento medio"
          value={formatPct(resumen.media)}
          accent={mediaAccent}
          icon={Gauge}
          hint={`${serie.length} semana(s) con planificación`}
          labelInfo="Media del % vendido/planificado de las semanas con planificación > 0."
        />
        <KPICard
          className="glass-accented"
          label="Mejor semana"
          value={resumen.mejor ? formatPct(resumen.mejor.pct) : "—"}
          accent="success"
          icon={TrendingUp}
          hint={resumen.mejor ? `Semana ${resumen.mejor.semana} · ${resumen.mejor.anio}` : undefined}
        />
        <KPICard
          className="glass-accented"
          label="Peor semana"
          value={resumen.peor ? formatPct(resumen.peor.pct) : "—"}
          accent="destructive"
          icon={TrendingDown}
          hint={resumen.peor ? `Semana ${resumen.peor.semana} · ${resumen.peor.anio}` : undefined}
        />
      </section>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cumplimiento histórico</CardTitle>
          <p className="text-xs text-muted-foreground">
            % vendido/planificado por semana. Solo semanas con planificación registrada.
          </p>
        </CardHeader>
        <CardContent>
          <div className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={serie} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" {...XAXIS} />
                <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v))}%`} />
                <Tooltip content={<GlassTooltip formatter={(v) => formatPct(Number(v))} />} />
                <ReferenceLine
                  y={resumen.media}
                  stroke={accentColor(mediaAccent)}
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  label={{ value: `Media ${formatPct(resumen.media)}`, position: "insideTopRight", fill: accentColor(mediaAccent), fontSize: 10 }}
                />
                <ReferenceLine y={95} stroke={C.success} strokeDasharray="2 4" strokeWidth={1} opacity={0.35} />
                <ReferenceLine y={80} stroke={C.warning} strokeDasharray="2 4" strokeWidth={1} opacity={0.35} />
                <Line
                  type="monotone"
                  dataKey="pct"
                  name="Cumplimiento"
                  stroke={C.primary}
                  strokeWidth={2.5}
                  dot={(props: { cx?: number; cy?: number; payload?: { pct: number } }) => {
                    const { cx, cy, payload } = props;
                    if (cx == null || cy == null || !payload) return <circle key={`${cx}-${cy}`} r={0} />;
                    const color = accentColor(cumplimientoAccent(payload.pct));
                    return (
                      <circle
                        key={`${cx}-${cy}`}
                        cx={cx}
                        cy={cy}
                        r={4}
                        fill={color}
                        stroke="var(--glass-bg-strong)"
                        strokeWidth={2}
                      />
                    );
                  }}
                  activeDot={{ r: 6, strokeWidth: 3, stroke: "var(--glass-bg-strong)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 2. Mix de métodos en el tiempo ───────────────────────────────────────────

function MixMetodos({ semanas }: { semanas: MercadonaSemanaConMetodos[] }) {
  const serie = useMemo(() => buildMixSerie(semanas), [semanas]);
  const tendencias = useMemo(() => tendenciasMetodos(semanas), [semanas]);

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Mix de métodos en el tiempo</CardTitle>
        <p className="text-xs text-muted-foreground">Kg por método de venta, semana a semana (apilado).</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={CHART_PANEL_CLASS}>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={serie} margin={MARGIN}>
              {METODOS_ORDEN.map((metodo, i) => (
                <Fragment key={metodo}>{areaStops(`mix-${metodo}`, SERIES_PALETTE[i], 0.32, 0.05)}</Fragment>
              ))}
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" {...XAXIS} />
              <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
              <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
              {METODOS_ORDEN.map((metodo, i) => (
                <Area
                  key={metodo}
                  type="monotone"
                  dataKey={metodo}
                  name={metodoLabel(metodo)}
                  stackId="mix"
                  stroke={SERIES_PALETTE[i]}
                  strokeWidth={BAR_STYLE_STACKED.strokeWidth}
                  fill={`url(#mix-${metodo})`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {METODOS_ORDEN.map((metodo, i) => (
            <span key={metodo} className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: barFill(SERIES_PALETTE[i], 1) }} />
              {metodoLabel(metodo)}
            </span>
          ))}
        </div>

        {tendencias ? (
          <div className="flex flex-wrap gap-2">
            {tendencias.map((t) => {
              const chipAccent = t.direccion === "up" ? "text-success border-success/40 bg-success/10"
                : t.direccion === "down" ? "text-destructive border-destructive/40 bg-destructive/10"
                : "text-muted-foreground border-[var(--glass-border)] bg-[var(--glass-bg)]";
              const Icon = t.direccion === "up" ? TrendingUp : t.direccion === "down" ? TrendingDown : null;
              return (
                <span key={t.metodo} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", chipAccent)}>
                  {Icon ? <Icon className="h-3 w-3" /> : null}
                  {t.label}
                  <span className="tabular-nums">
                    {t.variacionPct == null ? "—" : `${t.variacionPct >= 0 ? "+" : ""}${formatNumber(t.variacionPct, 0)}%`}
                  </span>
                </span>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── 3. Comparativa semana a semana ───────────────────────────────────────────

function deltaClass(delta: number): string {
  if (delta > 0) return "text-success";
  if (delta < 0) return "text-destructive";
  return "text-muted-foreground";
}

function ComparativaFila({ fila, isTotal, sinAnterior }: { fila: ComparativaMetodoRow; isTotal?: boolean; sinAnterior?: boolean }) {
  return (
    <tr className={isTotal ? "border-t border-[var(--glass-border)] font-semibold" : undefined}>
      <td className="px-3 py-1.5 font-medium">{fila.label}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(fila.kgActual)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{sinAnterior ? "—" : formatKg(fila.kgAnterior)}</td>
      <td className={cn("px-3 py-1.5 text-right tabular-nums", sinAnterior ? "text-muted-foreground" : deltaClass(fila.deltaKg))}>
        {sinAnterior ? "—" : `${fila.deltaKg >= 0 ? "+" : ""}${formatKg(fila.deltaKg)}`}
      </td>
      <td className={cn("px-3 py-1.5 text-right tabular-nums", !sinAnterior && fila.deltaPct != null ? deltaClass(fila.deltaPct) : "text-muted-foreground")}>
        {!sinAnterior && fila.deltaPct != null ? `${fila.deltaPct >= 0 ? "+" : ""}${formatNumber(fila.deltaPct, 0)}%` : "—"}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(fila.palets)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(fila.cajas)}</td>
    </tr>
  );
}

function ComparativaSemanaASemana({ semanas }: { semanas: MercadonaSemanaConMetodos[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeIndex = useMemo(() => {
    if (semanas.length === 0) return -1;
    if (!selectedId) return semanas.length - 1;
    const idx = semanas.findIndex((s) => s.id === selectedId);
    return idx === -1 ? semanas.length - 1 : idx;
  }, [semanas, selectedId]);

  const actual = activeIndex >= 0 ? semanas[activeIndex] : null;
  const anterior = activeIndex > 0 ? semanas[activeIndex - 1] : null;

  const comparativa = useMemo(() => (actual ? buildComparativaSemanas(actual, anterior) : null), [actual, anterior]);

  const navigate = (direction: -1 | 1) => {
    if (activeIndex === -1) return;
    const nextIndex = activeIndex + direction;
    if (nextIndex < 0 || nextIndex >= semanas.length) return;
    setSelectedId(semanas[nextIndex].id);
  };

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Comparativa semana a semana</CardTitle>
            <p className="text-xs text-muted-foreground">Kg, delta y palets/cajas por método frente a la semana anterior.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigate(-1)} disabled={activeIndex <= 0}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select value={actual?.id} onValueChange={setSelectedId}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {semanas.map((s) => (
                  <SelectItem key={s.id} value={s.id}>S{s.semana} · {s.anio}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigate(1)} disabled={activeIndex === -1 || activeIndex >= semanas.length - 1}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!comparativa ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sin semana seleccionada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                <tr>
                  <th className="text-left">Método</th>
                  <th className="text-right">Kg semana</th>
                  <th className="text-right">Kg anterior</th>
                  <th className="text-right">Delta kg</th>
                  <th className="text-right">Delta %</th>
                  <th className="text-right">Palets</th>
                  <th className="text-right">Cajas</th>
                </tr>
              </thead>
              <tbody>
                {comparativa.filas.map((fila) => (
                  <ComparativaFila key={fila.metodo} fila={fila} sinAnterior={anterior == null} />
                ))}
                <ComparativaFila fila={comparativa.total} isTotal sinAnterior={anterior == null} />
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
