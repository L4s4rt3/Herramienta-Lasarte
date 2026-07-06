import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KPICard } from "@/components/KPICard";
import { InfoTooltip } from "@/components/InfoTooltip";
import { C } from "@/lib/chartTheme";
import { cn } from "@/lib/utils";
import { Ruler } from "lucide-react";
import type { CalibreResumen } from "@/hooks/useAnalisisDiario";

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

function formatKgT(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + " t";
  return nf.format(v) + " kg";
}

function diaCorto(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const dia = d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
  return dia.charAt(0).toUpperCase() + dia.slice(1);
}

// Paleta fija para el mix apilado (top 5 calibres + resto).
const MIX_COLORS = [C.info, C.success, C.primary, C.warning, "hsl(0 75% 50% / 0.8)", "hsl(150 10% 40% / 0.5)"];

interface AnalisisCalibresProps {
  calibres: CalibreResumen[];
  days: string[];
  kgClasificados: number;
  kgProduccionReal: number;
}

export function AnalisisCalibres({ calibres, days, kgClasificados, kgProduccionReal }: AnalisisCalibresProps) {
  // Columnas de la matriz: categorías ordenadas por kg total descendente.
  const clasesCols = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of calibres) {
      for (const [clase, kg] of Object.entries(c.por_clase)) {
        map.set(clase, (map.get(clase) ?? 0) + kg);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([clase]) => clase);
  }, [calibres]);

  const maxCell = useMemo(() => {
    let max = 1;
    for (const c of calibres) for (const kg of Object.values(c.por_clase)) if (kg > max) max = kg;
    return max;
  }, [calibres]);

  const maxRowTotal = useMemo(
    () => Math.max(...calibres.map((c) => c.kg_total), 1),
    [calibres]
  );

  // Mix por día: top 5 calibres + "Resto".
  const mix = useMemo(() => {
    const top = calibres.slice(0, 5);
    const restoSet = new Set(calibres.slice(5).map((c) => c.calibre));
    return days
      .map((day) => {
        const segmentos = top.map((c) => c.por_dia[day] ?? 0);
        const resto = calibres
          .filter((c) => restoSet.has(c.calibre))
          .reduce((s, c) => s + (c.por_dia[day] ?? 0), 0);
        const total = segmentos.reduce((s, v) => s + v, 0) + resto;
        return { day, segmentos: [...segmentos, resto], total };
      })
      .filter((d) => d.total > 0);
  }, [calibres, days]);

  const dominante = calibres[0];

  if (calibres.length === 0) {
    return (
      <Card className="glass-accented">
        <CardContent className="py-12 text-center">
          <Ruler className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium">Sin datos de calibre en este periodo</p>
          <p className="mt-1 text-xs text-muted-foreground">Los calibres salen del Informe de tamaños al analizar cada parte con IA.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mini-KPIs */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KPICard
          label="Calibre dominante"
          value={dominante.calibre}
          hint={kgClasificados > 0 ? `${((dominante.kg_total / kgClasificados) * 100).toFixed(1)}% de los kg clasificados` : undefined}
          icon={Ruler}
        />
        <KPICard label="Calibres distintos" value={String(calibres.length)} hint="en el periodo" />
        <KPICard
          label="Kg clasificados"
          value={formatKgT(kgClasificados)}
          hint={kgProduccionReal > 0 ? `${((kgClasificados / kgProduccionReal) * 100).toFixed(1)}% de la producción real` : undefined}
        />
      </section>

      {/* Matriz calibre × categoría */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="panel-kicker">Matriz del periodo</p>
                <InfoTooltip iconClassName="h-3 w-3">
                  Kg por combinación de calibre (tamaño) y categoría comercial, sumados en el periodo. El color más intenso marca dónde se concentra la producción. Viene del Informe de tamaños, que es agregado por día — por eso no se puede cruzar con lote o productor.
                </InfoTooltip>
              </div>
              <CardTitle className="text-base">Calibre × Categoría</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--glass-border)]">
                  <th className="sticky left-0 z-10 bg-[var(--glass-bg)] px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Calibre</th>
                  {clasesCols.map((clase) => (
                    <th key={clase} className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{clase}</th>
                  ))}
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {calibres.map((c) => (
                  <tr key={c.calibre} className="border-b border-[var(--glass-border)] last:border-b-0">
                    <td className="sticky left-0 z-10 bg-[var(--glass-bg)] px-4 py-3 font-medium whitespace-nowrap">{c.calibre}</td>
                    {clasesCols.map((clase) => {
                      const kg = c.por_clase[clase] ?? 0;
                      const alpha = kg > 0 ? 0.04 + (kg / maxCell) * 0.24 : 0;
                      return (
                        <td
                          key={clase}
                          className={cn("px-4 py-3 text-right tabular-nums text-xs", kg === 0 && "text-muted-foreground/30")}
                          style={alpha > 0 ? { backgroundColor: `hsl(24 95% 53% / ${alpha.toFixed(3)})` } : undefined}
                        >
                          {kg > 0 ? nf.format(Math.round(kg)) : "—"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold tabular-nums">{nf.format(Math.round(c.kg_total))}</span>
                      <div className="ml-auto mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(c.kg_total / maxRowTotal) * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
                      {kgClasificados > 0 ? `${((c.kg_total / kgClasificados) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Mix de calibres por día */}
      {mix.length > 1 && (
        <Card className="glass-accented">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
              <div className="min-w-0">
                <p className="panel-kicker">Evolución</p>
                <CardTitle className="text-base">Mix de calibres por día</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">¿la fruta viene más gruesa o más fina según pasa el periodo?</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mix.map(({ day, segmentos, total }) => (
                <div key={day} className="grid grid-cols-[56px_1fr_76px] items-center gap-3">
                  <span className="text-xs font-medium tabular-nums text-muted-foreground" title={day}>{diaCorto(day)} {day.slice(8, 10)}</span>
                  <div className="flex h-5 overflow-hidden rounded-md border border-[var(--glass-border)]">
                    {segmentos.map((kg, i) => (
                      kg > 0 ? <div key={i} style={{ width: `${(kg / total) * 100}%`, backgroundColor: MIX_COLORS[i] }} /> : null
                    ))}
                  </div>
                  <span className="text-right text-xs tabular-nums text-muted-foreground">{formatKgT(total)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--glass-border)] pt-3 text-[11px] text-muted-foreground">
              {calibres.slice(0, 5).map((c, i) => (
                <span key={c.calibre} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: MIX_COLORS[i] }} />
                  {c.calibre}
                </span>
              ))}
              {calibres.length > 5 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: MIX_COLORS[5] }} />
                  Resto
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
