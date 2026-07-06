import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConsumoPeriodoTipo, PeriodoRange } from "@/lib/consumoPeriodoView";

interface ConsumoPeriodoSelectorProps {
  tipo: ConsumoPeriodoTipo;
  onTipoChange: (tipo: ConsumoPeriodoTipo) => void;
  range: PeriodoRange;
  onNavigate: (direction: -1 | 1) => void;
  onToday: () => void;
  isCurrent: boolean;
  canNavigateNext?: boolean;
}

const TIPO_OPTIONS: { value: ConsumoPeriodoTipo; label: string }[] = [
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
  { value: "campana", label: "Campaña" },
];

export function ConsumoPeriodoSelector({
  tipo, onTipoChange, range, onNavigate, onToday, isCurrent, canNavigateNext = true,
}: ConsumoPeriodoSelectorProps) {
  return (
    <div className="section-toolbar flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {/* Segmentado Semana | Mes | Campaña */}
      <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-1 shadow-[var(--glass-shadow)]">
        {TIPO_OPTIONS.map((option) => {
          const active = tipo === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onTipoChange(option.value)}
              className={cn(
                "h-7 rounded-lg px-3 text-xs transition-all",
                active
                  ? "bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)] font-semibold"
                  : "text-muted-foreground hover:bg-[var(--glass-bg-strong)]/60 hover:text-foreground",
              )}
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      {/* Navegación ‹ › */}
      <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] px-1.5 py-1 shadow-[var(--glass-shadow)]">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg glass-hover"
          onClick={() => onNavigate(-1)}
          title="Periodo anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-[168px] px-1 text-center">
          <p className="text-xs font-semibold leading-tight">{range.label}</p>
          <p className="text-[10.5px] leading-tight text-muted-foreground">{range.detail}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg glass-hover"
          onClick={() => onNavigate(1)}
          disabled={!canNavigateNext}
          title="Periodo siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Hoy */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 glass glass-hover"
        onClick={onToday}
        disabled={isCurrent}
      >
        Hoy
      </Button>
    </div>
  );
}
