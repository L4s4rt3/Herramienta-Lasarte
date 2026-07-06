import { Check, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSemaforo, DJPMN_HELP } from "@/lib/semaforo";
import { InfoTooltip } from "@/components/InfoTooltip";

const ICONS = { verde: Check, amarillo: AlertTriangle, rojo: X } as const;

interface SemaforoPillProps {
  dsjPct: number;
  /** Sufijo tras el porcentaje (por defecto "DJPMN"). Pasa "" para omitirlo. */
  suffix?: string;
  className?: string;
  /** Muestra el icono "?" con la explicación del DJPMN (por defecto sí). */
  info?: boolean;
}

export function SemaforoPill({ dsjPct, suffix = "DJPMN", className, info = true }: SemaforoPillProps) {
  const sem = getSemaforo(dsjPct);
  const Icon = ICONS[sem.key];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", sem.pill, className)}>
      <Icon className="h-3.5 w-3.5" />
      {sem.label} · {dsjPct >= 0 ? "+" : ""}{dsjPct.toFixed(1)}%{suffix ? ` ${suffix}` : ""}
      {info && (
        <InfoTooltip
          className="bg-transparent text-current opacity-70 hover:bg-white/20 hover:text-current hover:opacity-100 focus-visible:bg-white/20 focus-visible:text-current focus-visible:opacity-100"
          iconClassName="h-3 w-3"
        >
          {DJPMN_HELP}
        </InfoTooltip>
      )}
    </span>
  );
}
