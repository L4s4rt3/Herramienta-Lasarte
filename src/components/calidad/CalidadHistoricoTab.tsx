import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, FileSearch, History, Loader2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalidadInformeDialog, type CalidadInformeLote } from "@/components/CalidadInformeDialog";
import { GRID, MARGIN, XAXIS, YAXIS, barFill } from "@/lib/chartTheme";
import { buildCalidadHistorico, CALIDAD_OPTIONS, formatCalidadDate, formatHoraCorta, type CalidadEstado, type CalidadLote } from "@/lib/calidad";
import { buildPeriodoRange } from "@/lib/consumoPeriodoView";
import { toISODateLocal } from "@/lib/format";
import { cn } from "@/lib/utils";

const QUALITY_CHART_COLOR: Record<CalidadEstado, string> = {
  Excelente: "hsl(var(--success))",
  Bueno: "hsl(var(--success))",
  Regular: "hsl(var(--warning))",
  Deficiente: "hsl(var(--warning))",
  Pésimo: "hsl(var(--destructive))",
};

const QUALITY_BADGE: Record<string, string> = {
  Excelente: "border-success/40 bg-success/10 text-success",
  Bueno: "border-success/40 bg-success/10 text-success",
  Regular: "border-warning/40 bg-warning/10 text-warning",
  Deficiente: "border-destructive/40 bg-destructive/10 text-destructive",
  Pésimo: "border-destructive/40 bg-destructive/10 text-destructive",
};

const QUALITY_BAR: Record<string, string> = {
  Excelente: "bg-success",
  Bueno: "bg-success/70",
  Regular: "bg-warning",
  Deficiente: "bg-destructive/70",
  Pésimo: "bg-destructive",
};

const badgeClass = (q: string) => QUALITY_BADGE[q] ?? "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground";

type PeriodoTipo = "semana" | "mes" | "campana" | "todo";

const PERIODO_OPTIONS: Array<{ value: PeriodoTipo; label: string }> = [
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
  { value: "campana", label: "Campaña" },
  { value: "todo", label: "Todo" },
];

interface PeriodoRango {
  desde: string | null;
  hasta: string | null;
  label: string;
  detail: string;
}

function buildCalidadPeriodoRango(tipo: PeriodoTipo, offset: number, today: Date = new Date()): PeriodoRango {
  if (tipo === "todo") {
    return { desde: null, hasta: null, label: "Todo el histórico", detail: "campaña completa" };
  }
  const p = buildPeriodoRange(tipo, offset, today);
  return { desde: p.start, hasta: p.end, label: p.label, detail: p.detail };
}

function toInforme(lote: CalidadLote): CalidadInformeLote {
  return {
    id: lote.id,
    fecha: lote.fecha,
    numero_lote: lote.numero_lote,
    productor_finca_nombre: lote.productor_finca_nombre,
    producto: lote.producto,
    variedad: lote.variedad,
    cantidad: lote.cantidad,
    hora: lote.hora,
    calidad: lote.calidad,
    defectos: lote.defectos ?? [],
    defecto_otro: lote.defecto_otro,
    observacion: lote.observacion,
    accion_recomendada: lote.accion_recomendada,
    informe_estado: lote.informe_estado,
    informe_generado: lote.informe_generado,
    aerobotics_realizado: lote.aerobotics_realizado,
    validado_at: lote.validado_at,
    validado_by: lote.validado_by,
  };
}

interface DiaLotes {
  fecha: string;
  lotes: CalidadLote[];
  byQuality: Record<CalidadEstado, number>;
}

interface CalidadHistoricoTabProps {
  lotes: CalidadLote[];
  loading: boolean;
}

/**
 * Pestaña "Histórico" de Calidad: navegador por Semana/Mes/Campaña/Todo con
 * KPIs y distribución de calidad del periodo, top defectos, ranking de
 * productores con incidencias y, sobre todo, el desglose día a día con cada
 * lote clicable a su informe completo (para poder ver la info cómodamente
 * sin ir jornada por jornada).
 */
export function CalidadHistoricoTab({ lotes, loading }: CalidadHistoricoTabProps) {
  const [tipo, setTipo] = useState<PeriodoTipo>("semana");
  const [offset, setOffset] = useState(0);
  const [informe, setInforme] = useState<CalidadInformeLote | null>(null);
  const [informeAbierto, setInformeAbierto] = useState(false);

  const rango = useMemo(() => buildCalidadPeriodoRango(tipo, offset), [tipo, offset]);

  const todayIso = toISODateLocal(new Date());
  const siguiente = tipo === "todo" ? null : buildCalidadPeriodoRango(tipo, offset + 1);
  const canNavigateNext = siguiente !== null && siguiente.desde !== null && siguiente.desde <= todayIso;

  const cambiarTipo = (t: PeriodoTipo) => {
    setTipo(t);
    setOffset(0);
  };

  const lotesPeriodo = useMemo(() => {
    if (!rango.desde || !rango.hasta) return lotes;
    return lotes.filter((l) => l.fecha >= rango.desde! && l.fecha <= rango.hasta!);
  }, [lotes, rango.desde, rango.hasta]);

  const summary = useMemo(() => {
    const byQuality = Object.fromEntries(CALIDAD_OPTIONS.map((q) => [q, 0])) as Record<CalidadEstado, number>;
    let aerobotics = 0;
    for (const l of lotesPeriodo) {
      if (l.calidad in byQuality) byQuality[l.calidad as CalidadEstado] += 1;
      if (l.aerobotics_realizado) aerobotics += 1;
    }
    return { total: lotesPeriodo.length, aerobotics, byQuality };
  }, [lotesPeriodo]);

  const resumen = useMemo(() => buildCalidadHistorico(lotesPeriodo), [lotesPeriodo]);

  const dias = useMemo<DiaLotes[]>(() => {
    const map = new Map<string, CalidadLote[]>();
    for (const l of lotesPeriodo) {
      const list = map.get(l.fecha) ?? [];
      list.push(l);
      map.set(l.fecha, list);
    }
    return Array.from(map.entries())
      .map(([fecha, ls]) => {
        const byQuality = Object.fromEntries(CALIDAD_OPTIONS.map((q) => [q, 0])) as Record<CalidadEstado, number>;
        for (const l of ls) if (l.calidad in byQuality) byQuality[l.calidad as CalidadEstado] += 1;
        return {
          fecha,
          byQuality,
          lotes: ls.slice().sort((a, b) => (formatHoraCorta(a.hora) ?? "").localeCompare(formatHoraCorta(b.hora) ?? "")),
        };
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [lotesPeriodo]);

  const abrirInforme = (lote: CalidadLote) => {
    setInforme(toInforme(lote));
    setInformeAbierto(true);
  };

  const chartData = resumen.semanas.map((s) => ({ label: s.label.replace(" · Sem ", " S"), ...s.byQuality }));
  const maxDefecto = resumen.defectos[0]?.count ?? 1;
  const revisar = summary.byQuality.Regular + summary.byQuality.Deficiente + summary.byQuality.Pésimo;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Cargando histórico de calidad...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Navegador de periodo */}
      <div className="section-toolbar flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1">
          {PERIODO_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => cambiarTipo(option.value)}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
                tipo === option.value
                  ? "bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {tipo !== "todo" && (
          <>
            <div className="flex items-center gap-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-1.5 py-1">
              <button
                type="button"
                onClick={() => setOffset((o) => o - 1)}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
                title="Periodo anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="min-w-[150px] px-1 text-center">
                <p className="text-xs font-semibold leading-tight">{rango.label}</p>
                <p className="text-[10.5px] leading-tight text-muted-foreground">{rango.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => setOffset((o) => o + 1)}
                disabled={!canNavigateNext}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                title="Periodo siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setOffset(0)}
              disabled={offset === 0}
              className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Hoy
            </button>
          </>
        )}
      </div>

      {lotesPeriodo.length === 0 ? (
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <History className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium">Sin controles de calidad en {rango.label.toLowerCase()}</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Prueba con otro periodo o navega a semanas anteriores.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPIs + distribución del periodo */}
          <Card className="glass-accented">
            <CardContent className="space-y-4 pt-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Lotes", value: String(summary.total), tone: "" },
                  { label: "Aerobotics", value: `${summary.aerobotics}/${summary.total}`, tone: "" },
                  { label: "Bueno", value: String(summary.byQuality.Excelente + summary.byQuality.Bueno), tone: "text-success" },
                  { label: "Revisar", value: String(revisar), tone: "text-warning" },
                ].map((stat) => (
                  <div key={stat.label} className="glass rounded-xl p-3">
                    <p className="panel-kicker mb-1">{stat.label}</p>
                    <p className={cn("text-2xl font-semibold tabular-nums", stat.tone)}>{stat.value}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex h-2.5 w-full overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                  {CALIDAD_OPTIONS.map((q) => {
                    const n = summary.byQuality[q];
                    if (n === 0) return null;
                    return <div key={q} className={QUALITY_BAR[q]} style={{ width: `${(n / summary.total) * 100}%` }} title={`${q}: ${n}`} />;
                  })}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {CALIDAD_OPTIONS.filter((q) => summary.byQuality[q] > 0).map((q) => (
                    <span key={q} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span className={cn("h-2 w-2 rounded-full", QUALITY_BAR[q])} />
                      {q} · {summary.byQuality[q]}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Distribución por semana (solo si el periodo abarca varias) */}
          {resumen.semanas.length > 1 && (
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Evolución</p>
                <CardTitle className="text-lg">Distribución de calidad por semana</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={MARGIN}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="label" {...XAXIS} />
                      <YAxis {...YAXIS} allowDecimals={false} />
                      {(["Excelente", "Bueno", "Regular", "Deficiente", "Pésimo"] as CalidadEstado[]).map((estado) => (
                        <Bar
                          key={estado}
                          dataKey={estado}
                          stackId="calidad"
                          name={estado}
                          fill={barFill(QUALITY_CHART_COLOR[estado], 0.55)}
                          stroke={QUALITY_CHART_COLOR[estado]}
                          strokeWidth={1.25}
                          radius={[2, 2, 2, 2]}
                          maxBarSize={34}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Top defectos</p>
                <CardTitle className="text-lg">Defectos más frecuentes</CardTitle>
              </CardHeader>
              <CardContent>
                {resumen.defectos.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Sin defectos registrados en el periodo.</p>
                ) : (
                  <div className="space-y-2.5">
                    {resumen.defectos.map((d) => (
                      <div key={d.defecto} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">{d.defecto}</span>
                          <span className="tabular-nums text-muted-foreground">{d.count}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                          <div className="h-full rounded-full bg-warning" style={{ width: `${(d.count / maxDefecto) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Ranking de incidencias</p>
                <CardTitle className="text-lg">Productores con más incidencias</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {resumen.productores.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <Users className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">Sin incidencias en el periodo.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-2 font-medium">Productor</th>
                          <th className="px-3 py-2 text-right font-medium">Notas</th>
                          <th className="px-3 py-2 text-right font-medium">Incidencias</th>
                          <th className="px-3 py-2 text-right font-medium">%</th>
                          <th className="px-4 py-2 text-right font-medium">Última fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumen.productores.slice(0, 12).map((p) => (
                          <tr key={p.productor} className="border-t border-[var(--glass-border)]">
                            <td className="max-w-[180px] truncate px-4 py-2 font-medium">{p.productor}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{p.notas}</td>
                            <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", p.pctIncidencias >= 50 ? "text-destructive" : "text-warning")}>
                              {p.incidencias}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p.pctIncidencias.toFixed(0)}%</td>
                            <td className="px-4 py-2 text-right text-xs text-muted-foreground">{formatCalidadDate(p.ultimaFecha)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Desglose día a día con lotes clicables a su informe */}
          <Card className="glass-accented overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" />
                <CardTitle className="text-lg">Detalle por día</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground">
                {dias.length} día{dias.length === 1 ? "" : "s"} con control · pulsa un lote para ver su informe completo.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {dias.map((d) => (
                <div key={d.fecha} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{formatCalidadDate(d.fecha)}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {CALIDAD_OPTIONS.filter((q) => d.byQuality[q] > 0).map((q) => (
                        <Badge key={q} variant="outline" className={cn("text-[11px]", badgeClass(q))}>
                          {q}: {d.byQuality[q]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {d.lotes.map((l) => (
                      <li
                        key={l.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => abrirInforme(l)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            abrirInforme(l);
                          }
                        }}
                        className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-2.5 py-1.5 text-xs transition-colors hover:border-primary/40"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {formatHoraCorta(l.hora) && (
                            <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{formatHoraCorta(l.hora)}</span>
                          )}
                          <span className="font-medium">{l.numero_lote || "Sin código"}</span>
                          <span className="truncate text-muted-foreground">
                            {l.productor_finca_nombre}{l.variedad ? ` · ${l.variedad}` : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline" className={cn("text-[11px]", badgeClass(l.calidad))}>
                            {l.calidad}
                          </Badge>
                          <FileSearch className="h-3.5 w-3.5 text-primary" />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>

          {resumen.productores.length > 0 && resumen.productores[0].pctIncidencias >= 50 && (
            <Card className="glass border-warning/30 bg-warning/6">
              <CardContent className="flex items-center gap-3 pt-6">
                <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
                <p className="text-sm">
                  <span className="font-semibold">{resumen.productores[0].productor}</span> tiene incidencias en el {resumen.productores[0].pctIncidencias.toFixed(0)}% de sus notas en {rango.label.toLowerCase()}.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <CalidadInformeDialog lote={informe} open={informeAbierto} onOpenChange={setInformeAbierto} />
    </div>
  );
}
