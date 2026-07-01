import { Check, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSemaforo } from "@/lib/semaforo";

const ICONS = { verde: Check, amarillo: AlertTriangle, rojo: X } as const;

interface SemaforoPillProps {
  dsjPct: number;
  /** Sufijo tras el porcentaje (por defecto "DJPMN"). Pasa "" para omitirlo. */
  suffix?: string;
  className?: string;
}

export function SemaforoPill({ dsjPct, suffix = "DJPMN", className }: SemaforoPillProps) {
  const sem = getSemaforo(dsjPct);
  const Icon = ICONS[sem.key];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", sem.pill, className)}>
      <Icon className="h-3.5 w-3.5" />
      {sem.label} · {dsjPct >= 0 ? "+" : ""}{dsjPct.toFixed(1)}%{suffix ? ` ${suffix}` : ""}
    </span>
  );
}
