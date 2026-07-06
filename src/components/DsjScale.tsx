import { cn } from "@/lib/utils";
import { getSemaforo } from "@/lib/semaforo";

interface DsjScaleProps {
  dsjPct: number;
  className?: string;
}

// ±8%, mismo rango que el eje del gráfico de evolución semanal.
const DOMAIN = 8;

function pctPos(v: number) {
  return ((Math.max(-DOMAIN, Math.min(DOMAIN, v)) + DOMAIN) / (DOMAIN * 2)) * 100;
}

/** Mini escala visual: dónde cae el % DJPMN dentro de las zonas verde/ámbar/rojo. */
export function DsjScale({ dsjPct, className }: DsjScaleProps) {
  const sem = getSemaforo(dsjPct);
  const markerPos = pctPos(dsjPct);

  return (
    <div className={cn("mt-2.5", className)}>
      <div className="relative h-2 w-full">
        <div className="absolute inset-0 overflow-hidden rounded-full bg-destructive/20">
          <div
            className="absolute inset-y-0 bg-warning/40"
            style={{ left: `${pctPos(-5)}%`, right: `${100 - pctPos(5)}%` }}
          />
          <div
            className="absolute inset-y-0 bg-success/50"
            style={{ left: `${pctPos(-3)}%`, right: `${100 - pctPos(3)}%` }}
          />
        </div>
        <div
          className={cn(
            "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--glass-bg-strong)] shadow-[var(--glass-shadow)]",
            sem.bar,
          )}
          style={{ left: `${markerPos}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] tabular-nums text-muted-foreground/60">
        <span>-{DOMAIN}%</span>
        <span>0%</span>
        <span>+{DOMAIN}%</span>
      </div>
    </div>
  );
}
