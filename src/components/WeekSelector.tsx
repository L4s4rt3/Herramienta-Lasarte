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
      <div className="flex items-center gap-1 rounded-lg glass border border-[var(--glass-border)] px-1.5 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onNavigateWeek(-1)}
          disabled={!canNavigate}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs font-medium text-muted-foreground px-1 select-none">Semana</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
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
          return (
            <Button
              key={p.value}
              variant={periodo === p.value ? "default" : "outline"}
              size="sm"
              onClick={() => onPeriodoChange(p.value)}
              className={cn(
                "h-8 text-xs gap-1.5",
                periodo === p.value
                  ? "glass border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] shadow-[var(--glass-shadow)]"
                  : "glass glass-hover"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </Button>
          );
        })}
      </div>

      {/* Inputs de fecha para rango custom */}
      {periodo === "custom" && (
        <div className="flex items-center gap-2 rounded-lg glass border border-[var(--glass-border)] px-3 py-1.5">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            type="date"
            value={customDesde}
            onChange={(e) => onCustomDesdeChange(e.target.value)}
            className="w-32 h-7 border-0 bg-transparent p-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <span className="text-muted-foreground text-xs">—</span>
          <Input
            type="date"
            value={customHasta}
            onChange={(e) => onCustomHastaChange(e.target.value)}
            className="w-32 h-7 border-0 bg-transparent p-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      )}
    </div>
  );
}
