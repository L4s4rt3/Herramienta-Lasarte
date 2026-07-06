import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Trend = "up" | "down" | "neutral";

interface DeltaChipProps {
  value: string;
  trend?: Trend;
  className?: string;
}

const DELTA_CHIP: Record<Trend, string> = {
  up: "bg-success/12 text-success",
  down: "bg-destructive/12 text-destructive",
  neutral: "bg-muted/50 text-muted-foreground",
};

/** Píldora de variación (p. ej. "+3,2%") con icono de tendencia. */
export function DeltaChip({ value, trend = "neutral", className }: DeltaChipProps) {
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", DELTA_CHIP[trend], className)}>
      <Icon className="h-3 w-3" />
      {value}
    </span>
  );
}
