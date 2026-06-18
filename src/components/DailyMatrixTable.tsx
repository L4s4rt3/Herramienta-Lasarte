import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getDiaSemana, formatFechaCorta, getIntensityColor } from "@/lib/analisisDiarioView";

function formatKg(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + " t";
  return v.toFixed(0) + " kg";
}

const DIMENSION_COLORS: Record<string, string> = {
  Exportación: "text-success",
  Mercado: "text-info",
  "No exportación": "text-warning",
  "No comercial": "text-destructive",
  Mujeres: "text-info",
  Otro: "text-muted-foreground",
};

interface DailyMatrixTableProps {
  data: Record<string, Record<string, number>>; // { "2026-06-16": { "Exportación": 5200, ... } }
  days: string[];                                // sorted ISO dates
  dimensions: string[];                          // sorted dimension names
  dayTotals: Record<string, number>;             // { "2026-06-16": 8500 }
  dimensionTotals: Record<string, number>;       // { "Exportación": 26200 }
  grandTotal: number;
}

export function DailyMatrixTable({
  data, days, dimensions, dayTotals, dimensionTotals, grandTotal,
}: DailyMatrixTableProps) {
  const maxCellKg = useMemo(() => {
    let max = 0;
    for (const dayData of Object.values(data)) {
      for (const v of Object.values(dayData)) {
        if (v > max) max = v;
      }
    }
    return max;
  }, [data]);

  if (days.length === 0 || dimensions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] py-12 text-center">
        <p className="text-sm text-muted-foreground">Sin datos para este periodo</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--glass-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
            <th className="sticky left-0 z-10 bg-[var(--glass-bg-strong)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Dia
            </th>
            {dimensions.map((dim) => (
              <th key={dim} className={cn("px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider", DIMENSION_COLORS[dim] ?? "text-muted-foreground")}>
                {dim}
              </th>
            ))}
            <th className="sticky right-0 z-10 bg-[var(--glass-bg-strong)] px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-l border-[var(--glass-border)]">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const diaSemana = getDiaSemana(day);
            const fechaCorta = formatFechaCorta(day);
            const dayData = data[day] ?? {};
            const total = dayTotals[day] ?? 0;
            return (
              <tr key={day} className="border-b border-[var(--glass-border)] last:border-0 hover:bg-[var(--glass-bg-strong)] transition-colors">
                <td className="sticky left-0 z-10 bg-[var(--glass-bg)] px-4 py-2.5">
                  <Badge variant="outline" className="font-mono text-xs">
                    {diaSemana} {fechaCorta}
                  </Badge>
                </td>
                {dimensions.map((dim) => {
                  const kg = dayData[dim] ?? 0;
                  return (
                    <td key={dim} className={cn("px-4 py-2.5 text-right font-mono tabular-nums", getIntensityColor(kg, maxCellKg))}>
                      {kg > 0 ? formatKg(kg) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                  );
                })}
                <td className="sticky right-0 z-10 bg-[var(--glass-bg)] px-4 py-2.5 text-right font-mono font-semibold tabular-nums border-l border-[var(--glass-border)]">
                  {formatKg(total)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)]">
            <td className="sticky left-0 z-10 bg-[var(--glass-bg-strong)] px-4 py-2.5 text-sm font-semibold">
              Total
            </td>
            {dimensions.map((dim) => (
              <td key={dim} className={cn("px-4 py-2.5 text-right font-mono font-semibold tabular-nums", DIMENSION_COLORS[dim] ?? "")}>
                {formatKg(dimensionTotals[dim] ?? 0)}
              </td>
            ))}
            <td className="sticky right-0 z-10 bg-[var(--glass-bg-strong)] px-4 py-2.5 text-right font-mono font-bold tabular-nums border-l border-[var(--glass-border)]">
              {formatKg(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
