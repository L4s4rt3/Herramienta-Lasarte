import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "esta_semana", label: "Esta semana" },
  { value: "anterior", label: "Anterior" },
  { value: "ultimas_4", label: "4 semanas" },
  { value: "custom", label: "Rango" },
];

export function WeekSelector({
  periodo, onPeriodoChange,
  customDesde, customHasta, onCustomDesdeChange, onCustomHastaChange,
  onNavigateWeek, canNavigate = true,
}: WeekSelectorProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl glass-accented p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onNavigateWeek(-1)}
          disabled={!canNavigate}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
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

      <div className="flex items-center gap-2 flex-wrap">
        {PERIODOS.map((p) => (
          <Button
            key={p.value}
            variant={periodo === p.value ? "default" : "outline"}
            size="sm"
            onClick={() => onPeriodoChange(p.value)}
            className="glass glass-hover h-8 text-xs"
          >
            {p.label}
          </Button>
        ))}
      </div>

      {periodo === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customDesde}
            onChange={(e) => onCustomDesdeChange(e.target.value)}
            className="w-36 h-8"
          />
          <span className="text-muted-foreground text-xs">—</span>
          <Input
            type="date"
            value={customHasta}
            onChange={(e) => onCustomHastaChange(e.target.value)}
            className="w-36 h-8"
          />
        </div>
      )}
    </div>
  );
}
