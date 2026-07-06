import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { AlertTriangle, History, Loader2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GRID, MARGIN, XAXIS, YAXIS, barFill } from "@/lib/chartTheme";
import { buildCalidadHistorico, formatCalidadDate, type CalidadEstado, type CalidadLote } from "@/lib/calidad";
import { cn } from "@/lib/utils";

const QUALITY_CHART_COLOR: Record<CalidadEstado, string> = {
  Excelente: "hsl(var(--success))",
  Bueno: "hsl(var(--success))",
  Regular: "hsl(var(--warning))",
  Deficiente: "hsl(var(--warning))",
  Pésimo: "hsl(var(--destructive))",
};

interface CalidadHistoricoTabProps {
  lotes: CalidadLote[];
  loading: boolean;
}

/**
 * Pestaña "Histórico": agrega las notas de calidad de las últimas 8 semanas
 * en distribución semanal por estado, top defectos y ranking de productores
 * con más incidencias. V1 informativa (sin drill-down al clicar).
 */
export function CalidadHistoricoTab({ lotes, loading }: CalidadHistoricoTabProps) {
  const resumen = useMemo(() => buildCalidadHistorico(lotes), [lotes]);

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

  if (lotes.length === 0) {
    return (
      <Card className="glass-accented">
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <History className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium">Sin histórico en las últimas 8 semanas</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            En cuanto se registren notas de calidad en jornadas anteriores, aquí aparecerá la evolución semanal, los defectos más frecuentes y el ranking de productores con incidencias.
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = resumen.semanas.map((semana) => ({
    label: semana.label.replace(" · Sem ", " S"),
    ...semana.byQuality,
  }));
  const maxDefecto = resumen.defectos[0]?.count ?? 1;

  return (
    <div className="space-y-5">
      <Card className="glass-accented">
        <CardHeader>
          <p className="panel-kicker">Últimas 8 semanas</p>
          <CardTitle className="text-lg">Distribución de calidad por semana</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
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

      {resumen.productores.length > 0 && resumen.productores[0].pctIncidencias >= 50 && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <span className="font-semibold">{resumen.productores[0].productor}</span> tiene incidencias en el {resumen.productores[0].pctIncidencias.toFixed(0)}% de sus notas en las últimas 8 semanas.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
