import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Calendar, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
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
}

const PERIODOS: { value: Periodo; label: string; icon: React.ElementType }[] = [
  { value: "esta_semana", label: "Esta semana", icon: CalendarDays },
  { value: "anterior", label: "Anterior", icon: Calendar },
  { value: "ultimas_4", label: "4 semanas", icon: Calendar },
  { value: "custom", label: "Rango", icon: Calendar },
];

export function WeekSelector({
  periodo, onPeriodoChange,
  customDesde, customHasta, onCustomDesdeChange, onCustomHastaChange,
  onNavigateWeek, canNavigate = true,
}: WeekSelectorProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl glass-accented p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
      {/* Navegación de semana */}
      <div className="flex items-center gap-1 rounded-xl glass border border-[var(--glass-border)] px-1.5 py-1 shadow-[var(--glass-shadow)]">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 glass glass-hover"
          onClick={() => onNavigateWeek(-1)}
          disabled={!canNavigate}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs font-medium text-muted-foreground px-1 select-none">Semana</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 glass glass-hover"
          onClick={() => onNavigateWeek(1)}
          disabled={!canNavigate}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Botones de periodo */}
      <div className="flex items-center gap-1.5">
        {PERIODOS.map((p) => {
          const Icon = p.icon;
          const active = periodo === p.value;
          return (
            <Button
              key={p.value}
              variant="outline"
              size="sm"
              onClick={() => onPeriodoChange(p.value)}
              className={cn(
                "h-8 text-xs gap-1.5 glass transition-all",
                active
                  ? "border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)] font-semibold"
                  : "glass-hover text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </Button>
          );
        })}
      </div>

      {/* Selector de día rápido */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ver día:</span>
        <Input
          type="date"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            onCustomDesdeChange(e.target.value);
            onCustomHastaChange(e.target.value);
            onPeriodoChange("custom");
          }}
          className="w-auto h-8 text-xs glass glass-hover cursor-pointer"
        />
      </div>

      {/* Rango de fechas custom */}
      {periodo === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customDesde}
            onChange={(e) => onCustomDesdeChange(e.target.value)}
            className="w-36 h-8 text-xs glass glass-hover"
          />
          <span className="text-muted-foreground text-xs">—</span>
          <Input
            type="date"
            value={customHasta}
            onChange={(e) => onCustomHastaChange(e.target.value)}
            className="w-36 h-8 text-xs glass glass-hover"
          />
        </div>
      )}
    </div>
  );
}
