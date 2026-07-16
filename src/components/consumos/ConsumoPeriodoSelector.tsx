// src/components/consumos/ConsumoPeriodoSelector.tsx
// Wrapper fino de SelectorPeriodo (src/components/SelectorPeriodo.tsx),
// FASE 1 del rediseño del lenguaje temporal. Se mantiene la API externa
// intacta (tipo/onTipoChange/range/onNavigate/onToday/isCurrent/canNavigateNext)
// porque la consume EconomicoCostes.tsx, que no se toca en esta fase: por eso
// el segmentado Semana|Mes|Campaña y el botón "Hoy" siguen usando exactamente
// los mismos callbacks que antes, y solo el par de flechas + etiqueta delega
// en SelectorPeriodo (que por debajo reutiliza buildPeriodoRange).
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConsumoPeriodoTipo, PeriodoRange } from "@/lib/consumoPeriodoView";
import { SelectorPeriodo } from "@/components/SelectorPeriodo";
import type { PeriodoValue } from "@/lib/selectorPeriodo";

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
  // Adaptador: SelectorPeriodo trabaja con un PeriodoValue completo, pero este
  // wrapper solo puede comunicar "avanza"/"retrocede" (onNavigate(±1)) — el
  // signo de la nueva fecha "desde" contra la actual basta para saber la
  // dirección, sin necesitar que el wrapper calcule fechas por su cuenta.
  const value: PeriodoValue = { modo: tipo, desde: range.start, hasta: range.end };

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

      {/* Navegación ‹ › + etiqueta (delegado en SelectorPeriodo) */}
      <SelectorPeriodo
        bare
        value={value}
        onChange={(next) => onNavigate(next.desde > value.desde ? 1 : -1)}
        canNavigateNext={canNavigateNext}
        showHoy={false}
        showDatePicker={false}
      />

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
