import { useRef } from "react";
import { Button } from "@/components/ui/button";
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

function GlassDateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const display = value
    ? new Date(value + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" })
    : label;
  return (
    <button
      type="button"
      onClick={() => ref.current?.showPicker()}
      className="inline-flex items-center gap-1.5 rounded-lg glass border border-[var(--glass-border)] px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-[var(--glass-bg-strong)] transition-colors cursor-pointer"
    >
      <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span>{display}</span>
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
    </button>
  );
}

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
          const active = periodo === p.value;
          return (
            <Button
              key={p.value}
              variant="outline"
              size="sm"
              onClick={() => onPeriodoChange(p.value)}
              className={cn(
                "h-8 text-xs gap-1.5 border transition-all",
                active
                  ? "border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)] font-semibold"
                  : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground hover:text-foreground hover:bg-[var(--glass-bg-strong)]"
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
        <GlassDateInput
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
        <div className="flex items-center gap-1.5">
          <GlassDateInput value={customDesde} onChange={onCustomDesdeChange} label="Desde" />
          <span className="text-muted-foreground text-xs">—</span>
          <GlassDateInput value={customHasta} onChange={onCustomHastaChange} label="Hasta" />
        </div>
      )}
    </div>
  );
}
