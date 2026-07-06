import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getDiaSemana, formatFechaCorta, getIntensityColor } from "@/lib/analisisDiarioView";

function formatKg(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + " t";
  return v.toFixed(0) + " kg";
}

const DIMENSION_BADGE_CLASSES: Record<string, string> = {
  Exportación: "border-success/40 bg-success/10 text-success",
  Mercado: "border-info/40 bg-info/10 text-info",
  "No exportación": "border-warning/40 bg-warning/10 text-warning",
  "No comercial": "border-destructive/40 bg-destructive/10 text-destructive",
  Mujeres: "border-info/40 bg-info/10 text-info",
  Otro: "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground",
};

interface DailyMatrixTableProps {
  data: Record<string, Record<string, number>>;
  days: string[];
  dimensions: string[];
  dayTotals: Record<string, number>;
  dimensionTotals: Record<string, number>;
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
      <Card className="glass-accented">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Sin datos para este periodo</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass overflow-hidden">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm data-table">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--glass-bg-strong)]">Dia</th>
                {dimensions.map((dim) => (
                  <th key={dim} className="text-right">
                    <Badge variant="outline" className={`text-[10px] ${DIMENSION_BADGE_CLASSES[dim] ?? DIMENSION_BADGE_CLASSES["Otro"]}`}>
                      {dim}
                    </Badge>
                  </th>
                ))}
                <th className="sticky right-0 z-10 bg-[var(--glass-bg-strong)] text-right border-l border-[var(--glass-border)]">
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
                  <tr key={day}>
                    <td className="sticky left-0 z-10 bg-[var(--glass-bg)]">
                      <Badge variant="outline" className="font-mono text-xs">
                        {diaSemana} {fechaCorta}
                      </Badge>
                    </td>
                    {dimensions.map((dim) => {
                      const kg = dayData[dim] ?? 0;
                      return (
                        <td key={dim} className={cn("text-right font-mono tabular-nums", getIntensityColor(kg, maxCellKg))}>
                          {kg > 0 ? formatKg(kg) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 bg-[var(--glass-bg)] text-right font-mono font-semibold tabular-nums border-l border-[var(--glass-border)]">
                      {formatKg(total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--glass-border-accent)] font-semibold">
                <td className="sticky left-0 z-10 bg-[var(--glass-bg-strong)]">Total</td>
                {dimensions.map((dim) => (
                  <td key={dim} className="text-right font-mono tabular-nums">
                    {formatKg(dimensionTotals[dim] ?? 0)}
                  </td>
                ))}
                <td className="sticky right-0 z-10 bg-[var(--glass-bg-strong)] text-right font-mono font-bold tabular-nums border-l border-[var(--glass-border)]">
                  {formatKg(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
