// src/components/SelectorPeriodo.tsx
// Componente ÚNICO de navegación temporal (FASE 1 del rediseño del lenguaje
// temporal). Sustituye a las 7 implementaciones que había para 4 necesidades
// reales (día / semana / mes / campaña, más un rango libre): WeekSelector,
// los chevrons ad-hoc de Dashboard/MercadonaProduccion/Mercadona/
// CalidadJornada/Asistencia, los 3 botones sueltos de EconomicoPanel y
// ConsumoPeriodoSelector. WeekSelector, PartesPeriodoNav y ConsumoPeriodoSelector
// siguen existiendo como wrappers finos de este componente (para no tocar a
// sus consumidores actuales) — los consumidores nuevos deberían usar este
// componente directamente.
//
// Totalmente controlado: `value` + `onChange`. Toda la aritmética de fechas
// vive en src/lib/selectorPeriodo.ts (que a su vez reutiliza
// buildPeriodoRange de consumoPeriodoView.ts) — aquí solo hay UI.
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import {
  avanzarPeriodo,
  esPeriodoActual,
  formatPeriodoLabel,
  hoyPeriodo,
  periodoDeFecha,
  rangoPersonalizado,
  type PeriodoModo,
  type PeriodoValue,
} from "@/lib/selectorPeriodo";

const MODO_LABEL: Record<PeriodoModo, string> = {
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
  campana: "Campaña",
  rango: "Rango",
};

export interface SelectorPeriodoProps {
  value: PeriodoValue;
  onChange: (value: PeriodoValue) => void;
  /** Granularidades que el usuario puede elegir. Con 0 o 1 elementos no se muestra el segmentado. */
  modos?: PeriodoModo[];
  /** Deshabilita solo la flecha "siguiente" (p.ej. para no navegar a periodos futuros). */
  canNavigateNext?: boolean;
  /** Deshabilita solo la flecha "anterior" (p.ej. cuando no hay más histórico atrás). */
  canNavigatePrev?: boolean;
  /** Fecha de referencia para "Hoy" y el resaltado de periodo actual (tests / previsualización). */
  hoy?: Date;
  /** Oculta el botón "Hoy". Se oculta también automáticamente en modo "rango" y cuando ya es el periodo actual. */
  showHoy?: boolean;
  /** Oculta la etiqueta legible del periodo (para páginas que ya muestran su propio texto). */
  showLabel?: boolean;
  /** Oculta el GlassDatePicker de "ir a fecha" / los selectores Desde-Hasta en modo rango. */
  showDatePicker?: boolean;
  /**
   * Modo "desnudo": no envuelve en su propia caja glass ni controla el
   * layout — pensado para componentes que ya tienen su propio contenedor
   * (p.ej. los wrappers finos WeekSelector/PartesPeriodoNav/ConsumoPeriodoSelector,
   * o una toolbar `section-toolbar` que agrupa varios controles).
   */
  bare?: boolean;
  /** Deshabilita todos los controles (p.ej. mientras se guarda un formulario). */
  disabled?: boolean;
  className?: string;
}

export function SelectorPeriodo({
  value,
  onChange,
  modos,
  canNavigateNext = true,
  canNavigatePrev = true,
  hoy,
  showHoy = true,
  showLabel = true,
  showDatePicker = true,
  bare = false,
  disabled = false,
  className,
}: SelectorPeriodoProps) {
  const esActual = esPeriodoActual(value, hoy);
  const mostrarSegmentado = modos && modos.length > 1;
  const mostrarHoy = showHoy && value.modo !== "rango" && !esActual;
  // Cuando SÍ estás en el periodo de hoy no hay botón "Hoy" que pulsar (ya
  // estás ahí) — en su lugar, una etiqueta no interactiva en --vivo (dato
  // vivo, ajuste de color 2026-07-16) confirma "estás viendo el presente".
  const mostrarHoyVivo = showHoy && value.modo !== "rango" && esActual;

  function ir(next: PeriodoValue) {
    onChange(next);
  }

  const wrapperClass = bare
    ? cn("contents", className)
    : cn("flex flex-col gap-3 rounded-xl glass-accented p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4", className);

  return (
    <div className={wrapperClass}>
      {/* Segmentado de granularidad (solo si la página admite varias) */}
      {mostrarSegmentado && (
        <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-1 shadow-[var(--glass-shadow)]">
          {modos!.map((modo) => {
            const active = value.modo === modo;
            return (
              <Button
                key={modo}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => ir(periodoDeFecha(modo, value.desde))}
                disabled={disabled}
                className={cn(
                  "h-7 rounded-lg px-3 text-xs transition-all",
                  active
                    ? "bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)] font-semibold"
                    : "text-muted-foreground hover:bg-[var(--glass-bg-strong)]/60 hover:text-foreground",
                )}
              >
                {MODO_LABEL[modo]}
              </Button>
            );
          })}
        </div>
      )}

      {/* Flechas + etiqueta */}
      <div className="flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] px-1.5 py-1 shadow-[var(--glass-shadow)]">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg glass-hover"
          onClick={() => ir(avanzarPeriodo(value, -1))}
          disabled={disabled || !canNavigatePrev}
          aria-label="Periodo anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {showLabel && (
          <div className="flex items-center gap-1.5 px-1.5 text-sm font-medium whitespace-nowrap">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="tabular-nums">{formatPeriodoLabel(value)}</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg glass-hover"
          onClick={() => ir(avanzarPeriodo(value, 1))}
          disabled={disabled || !canNavigateNext}
          aria-label="Periodo siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Hoy: botón interactivo (navega al periodo actual) cuando NO estás en
          él; etiqueta fija en --vivo cuando SÍ lo estás (no hay a dónde navegar). */}
      {mostrarHoy && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => ir(hoyPeriodo(value.modo, hoy))}
          disabled={disabled}
        >
          Hoy
        </Button>
      )}
      {mostrarHoyVivo && (
        <span className="flex h-7 items-center gap-1.5 px-2 text-xs font-semibold text-vivo">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-vivo" aria-hidden="true" />
          Hoy
        </span>
      )}

      {/* Saltar a fecha */}
      {showDatePicker && value.modo !== "rango" && (
        <GlassDatePicker
          value=""
          onChange={(v) => ir(periodoDeFecha(value.modo, v))}
          label="Ir a fecha"
          disabled={disabled}
        />
      )}
      {showDatePicker && value.modo === "rango" && (
        <div className="flex items-center gap-2">
          <GlassDatePicker
            value={value.desde}
            onChange={(v) => ir(rangoPersonalizado(v, value.hasta))}
            label="Desde"
            disabled={disabled}
          />
          <span className="text-xs text-muted-foreground">—</span>
          <GlassDatePicker
            value={value.hasta}
            onChange={(v) => ir(rangoPersonalizado(value.desde, v))}
            label="Hasta"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

export interface PeriodoFlechasProps {
  onPrev: () => void;
  onNext: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  className?: string;
}

/**
 * Solo el par de flechas ◀▶ con el mismo cromado glass que `SelectorPeriodo`,
 * sin ningún `PeriodoValue` propio. Para páginas cuya "semana" no es la
 * semana ISO estándar (p.ej. Mercadona: lunes-sábado con numeración propia,
 * ver mercadonaWeekDateRange) — ahí forzar la aritmética de fechas de
 * `avanzarPeriodo` daría un rango incorrecto, así que la página conserva su
 * propia lógica de navegación/etiqueta y solo reutiliza este chrome visual.
 */
export function PeriodoFlechas({ onPrev, onNext, canPrev = true, canNext = true, className }: PeriodoFlechasProps) {
  return (
    <div className={cn("flex items-center gap-1 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] px-1.5 py-1 shadow-[var(--glass-shadow)]", className)}>
      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg glass-hover" onClick={onPrev} disabled={!canPrev} aria-label="Periodo anterior">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg glass-hover" onClick={onNext} disabled={!canNext} aria-label="Periodo siguiente">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
