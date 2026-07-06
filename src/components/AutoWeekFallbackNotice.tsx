import { Info } from "lucide-react";

interface AutoWeekFallbackNoticeProps {
  /** Texto explicando el salto, p.ej. "Esta semana aún no tiene datos — mostrando la semana anterior (29 jun – 5 jul)". */
  message: string;
  /** Vuelve a la semana actual (y no debe volver a disparar el salto automático). */
  onGoToCurrentWeek: () => void;
}

/**
 * Franja fina glass con aviso de fallback automático a la semana anterior.
 * Compartida por Dashboard, AnalisisDiario y PartesList: mismo aspecto en
 * las tres páginas cuando la semana actual está vacía y se salta a la anterior.
 */
export function AutoWeekFallbackNotice({ message, onGoToCurrentWeek }: AutoWeekFallbackNoticeProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg)] px-4 py-2.5 text-sm shadow-[var(--glass-shadow)] backdrop-blur-xl">
      <Info className="h-4 w-4 shrink-0 text-info" />
      <p className="min-w-0 flex-1 text-foreground">{message}</p>
      <button
        type="button"
        onClick={onGoToCurrentWeek}
        className="shrink-0 text-xs font-semibold text-primary hover:underline underline-offset-2"
      >
        Ir a esta semana
      </button>
    </div>
  );
}
