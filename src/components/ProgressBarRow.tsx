// ProgressBarRow — fila de "label + barra horizontal + valor" en una sola línea,
// compartida entre "Stock por variedad" (EntradasBascula.tsx) y "Calibres"
// (TrazabilidadLote.tsx). Nota: Productores.tsx tiene barras de progreso con
// aspecto similar (columna "% periodo" del ranking, y los desgloses "Por
// producto"/"Distribución de calibres") pero con una estructura distinta —sin
// label en la del ranking, y en dos líneas (label arriba, barra a ancho
// completo debajo) en los desgloses— por lo que deliberadamente no se
// migraron a este componente para no forzar un cambio visual.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ProgressBarRowProps {
  label: ReactNode;
  /** Porcentaje 0-100 que ocupa la barra. Se recorta al rango [0, 100]. */
  pct: number;
  /** Valor alineado a la derecha (kg, %, etc). */
  value: ReactNode;
  /** Contenido extra tras el valor (p.ej. "3 lotes"), oculto en móvil. */
  extra?: ReactNode;
  /** Etiqueta de porcentaje opcional, mostrada entre el valor y `extra` (p.ej. "32,4 %"). */
  pctLabel?: ReactNode;
  /** "sm" = barra fina y texto xs (calibres/clases); "md" = barra gruesa y texto sm (stock por variedad). */
  size?: "sm" | "md";
  labelClassName?: string;
  barClassName?: string;
  className?: string;
}

export function ProgressBarRow({
  label, pct, value, extra, pctLabel, size = "md", labelClassName, barClassName = "bg-primary", className,
}: ProgressBarRowProps) {
  const isSm = size === "sm";
  const pctClamped = Math.max(0, Math.min(100, pct));

  return (
    <div className={cn("flex items-center", isSm ? "gap-2.5 text-xs" : "gap-3", className)}>
      <span className={cn("shrink-0 truncate font-medium", isSm ? "w-24" : "w-44 text-sm sm:w-56", labelClassName)}>
        {label}
      </span>
      <div className={cn("min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]", isSm ? "h-1.5" : "h-2.5")}>
        <div
          className={cn("h-full rounded-full transition-all duration-500", barClassName)}
          style={{ width: `${pctClamped}%` }}
        />
      </div>
      <span className={cn("shrink-0 text-right tabular-nums", isSm ? "w-14 text-muted-foreground" : "text-sm font-semibold")}>
        {value}
      </span>
      {pctLabel != null && (
        <span className={cn("hidden shrink-0 text-right tabular-nums text-muted-foreground sm:inline", isSm ? "w-10 text-[11px]" : "w-14 text-xs")}>
          {pctLabel}
        </span>
      )}
      {extra}
    </div>
  );
}
