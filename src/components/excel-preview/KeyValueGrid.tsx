import { Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isNumericCell, formatCell } from "./formatters";
import type { KeyValueBlock } from "./types";

interface KeyValueGridProps {
  blocks: KeyValueBlock[];
}

// Sección 2: bloques etiqueta→valor detectados en la cabecera del informe
// (p.ej. "ANTEQUERA VERDURA | 400.879", "Commodity: VALENCIA DELTA").
// Se pintan como grid de pares clave-valor de 2-3 columnas, agrupados por
// bloque cuando la hoja trae varios (uno por sección/producto).
export function KeyValueGrid({ blocks }: KeyValueGridProps) {
  if (blocks.length === 0) return null;

  return (
    <section className="shrink-0 space-y-2">
      {blocks.map((block, bi) => (
        <div key={bi} className="glass rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="hidden sm:inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md glass-strong text-muted-foreground">
              <Rows3 className="h-3.5 w-3.5" />
            </span>
            <h2 className="panel-kicker">
              {block.title || "Datos del informe"}
            </h2>
          </div>
          <dl
            className={cn(
              "grid gap-x-4 gap-y-2",
              "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            )}
          >
            {block.pairs.map((pair, pi) => {
              const value = String(pair.value);
              const numeric = isNumericCell(value);
              return (
                <div
                  key={pi}
                  className="flex items-baseline justify-between gap-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 min-w-0"
                >
                  <dt className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide truncate min-w-0">
                    {pair.label}
                  </dt>
                  <dd
                    className={cn(
                      "text-sm font-semibold text-foreground truncate shrink-0",
                      numeric && "tabular-nums"
                    )}
                    title={value}
                  >
                    {formatCell(value)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </section>
  );
}
