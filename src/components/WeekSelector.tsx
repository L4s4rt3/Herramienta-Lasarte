import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import type { Periodo } from "@/lib/analisisDiarioView";

interface WeekSelectorProps {
  periodo: Periodo;
  onPeriodoChange: (p: Periodo) => void;
  customDesde: string;
  customHasta: string;
  onCustomDesdeChange: (v: string) => void;
  onCustomHastaChange: (v: string) => void;
  onNavigateWeek: (direction: -1 | 1) => void;
  canNavigate?: boolean;
  /** Deshabilita solo la flecha "siguiente" (p.ej. para no navegar a semanas futuras). */
  canNavigateNext?: boolean;
  /** Si es true, añade la píldora "Todo" (histórico completo) al segmented control. */
  showTodo?: boolean;
}

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "esta_semana", label: "Esta semana" },
  { value: "anterior", label: "Anterior" },
  { value: "ultimas_4", label: "4 semanas" },
  { value: "custom", label: "Rango" },
];

const PERIODO_TODO: { value: Periodo; label: string } = { value: "todo", label: "Todo" };

export function WeekSelector({
  periodo, onPeriodoChange,
  customDesde, customHasta, onCustomDesdeChange, onCustomHastaChange,
  onNavigateWeek, canNavigate = true, canNavigateNext = true, showTodo = false,
}: WeekSelectorProps) {
  const isTodo = showTodo && periodo === "todo";
  const periodos = showTodo ? [...PERIODOS, PERIODO_TODO] : PERIODOS;
  return (
    <div className="flex flex-col gap-3 rounded-xl glass-accented p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
      {/* Navegación de semana */}
      {!isTodo && (
        <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] px-1.5 py-1 shadow-[var(--glass-shadow)]">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg glass-hover"
            onClick={() => onNavigateWeek(-1)}
            disabled={!canNavigate}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-1 text-xs font-medium text-muted-foreground select-none">Semana</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg glass-hover"
            onClick={() => onNavigateWeek(1)}
            disabled={!canNavigate || !canNavigateNext}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Segmented control de periodo */}
      <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-1 shadow-[var(--glass-shadow)]">
        {periodos.map((p) => {
          const active = periodo === p.value;
          return (
            <Button
              key={p.value}
              variant="ghost"
              size="sm"
              onClick={() => onPeriodoChange(p.value)}
              className={cn(
                "h-7 rounded-lg px-3 text-xs transition-all",
                active
                  ? "bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)] font-semibold"
                  : "text-muted-foreground hover:bg-[var(--glass-bg-strong)]/60 hover:text-foreground"
              )}
            >
              {p.label}
            </Button>
          );
        })}
      </div>

      {/* Selector de día rápido */}
      <div className="flex items-center gap-2">
        <span className="panel-kicker">Ver día</span>
        <GlassDatePicker
          value=""
          onChange={(v) => {
            onCustomDesdeChange(v);
            onCustomHastaChange(v);
            onPeriodoChange("custom");
          }}
          label="Elegir día"
        />
      </div>

      {/* Rango de fechas custom */}
      {periodo === "custom" && (
        <div className="flex items-center gap-2">
          <GlassDatePicker value={customDesde} onChange={onCustomDesdeChange} label="Desde" />
          <span className="text-xs text-muted-foreground">—</span>
          <GlassDatePicker value={customHasta} onChange={onCustomHastaChange} label="Hasta" />
        </div>
      )}
    </div>
  );
}
