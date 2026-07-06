import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCell, isNumericCell } from "./formatters";
import type { Metric } from "./types";

interface SummaryRowsStripProps {
  rows: Metric[];
}

// Detecta si la etiqueta de la fila-resumen indica una tendencia positiva
// ("VENDIDO", "AUMENTO") o negativa ("DESCENSO") para acentuar el valor.
function trendOf(label: string): "up" | "down" | null {
  const normalized = label.toLowerCase();
  if (/aumento|vendid/i.test(normalized)) return "up";
  if (/descenso/i.test(normalized)) return "down";
  return null;
}

// Sección 4: filas-resumen tipo mini-KPI detectadas justo después de una
// tabla (p.ej. "SEMANA 21 HEMOS VENDIDO | 215.260", "AUMENTO DEL | 3,19%").
export function SummaryRowsStrip({ rows }: SummaryRowsStripProps) {
  if (rows.length === 0) return null;

  return (
    <section className="shrink-0 space-y-2">
      <h2 className="panel-kicker px-1">Resumen del periodo</h2>
      <div
        className={cn(
          "grid gap-2",
          "grid-cols-1 sm:grid-cols-2",
          rows.length >= 3 && "lg:grid-cols-3"
        )}
      >
        {rows.map((row, i) => {
          const trend = trendOf(row.label);
          const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : null;
          const value = String(row.value);
          const numeric = isNumericCell(value);
          return (
            <div
              key={i}
              className={cn(
                "glass rounded-xl p-3 flex items-center justify-between gap-3 min-w-0",
                trend === "up" && "border-success/40",
                trend === "down" && "border-destructive/40"
              )}
            >
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider truncate min-w-0">
                {row.label}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-base font-bold shrink-0",
                  numeric && "tabular-nums",
                  trend === "up" && "text-success",
                  trend === "down" && "text-destructive",
                  !trend && "text-foreground"
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {formatCell(value)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
