import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  getISOWeek,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toISODateLocal } from "@/lib/format";

export type VistaPeriodo = "semana" | "mes" | "todo";

export interface PeriodoRango {
  /** Fecha ancla (cualquier día dentro del periodo), a mediodía local. */
  anchor: Date;
  /** Rango [desde, hasta] en formato YYYY-MM-DD, inclusive. Null si vista = "todo". */
  desde: string | null;
  hasta: string | null;
  /** Etiqueta legible del periodo, p.ej. "Semana 27 · 30 jun – 6 jul 2026" o "Julio 2026". */
  label: string;
}

const VISTAS: { value: VistaPeriodo; label: string }[] = [
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
  { value: "todo", label: "Todo" },
];

/** Parsea "YYYY-MM-DD" anclado al mediodía local (evita desfases UTC). */
export function parseAnchorDate(value: string | null | undefined): Date {
  if (value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  }
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return now;
}

/** Calcula el rango [desde, hasta] + etiqueta para una vista y fecha ancla dadas. */
export function computePeriodoRango(vista: VistaPeriodo, anchor: Date): PeriodoRango {
  if (vista === "todo") {
    return { anchor, desde: null, hasta: null, label: "Todo el histórico" };
  }

  if (vista === "mes") {
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    const label = format(start, "MMMM yyyy", { locale: es });
    return {
      anchor,
      desde: toISODateLocal(start),
      hasta: toISODateLocal(end),
      label: label.charAt(0).toUpperCase() + label.slice(1),
    };
  }

  // Semana: lunes a domingo
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const end = endOfWeek(anchor, { weekStartsOn: 1 });
  const weekNumber = getISOWeek(start);
  const sameMonth = start.getMonth() === end.getMonth();
  const rangeLabel = sameMonth
    ? `${format(start, "d", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })}`
    : `${format(start, "d MMM", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })}`;
  return {
    anchor,
    desde: toISODateLocal(start),
    hasta: toISODateLocal(end),
    label: `Semana ${weekNumber} · ${rangeLabel}`,
  };
}

function shiftAnchor(vista: VistaPeriodo, anchor: Date, dir: -1 | 1): Date {
  if (vista === "mes") return addMonths(anchor, dir);
  return addWeeks(anchor, dir);
}

interface PartesPeriodoNavProps {
  vista: VistaPeriodo;
  anchor: Date;
  onVistaChange: (v: VistaPeriodo) => void;
  onAnchorChange: (d: Date) => void;
}

/**
 * Controles de navegación de periodo (segmentado Semana|Mes|Todo + flechas + etiqueta + Hoy).
 * No incluye wrapper de layout propio: se integra en la toolbar única de la página que lo usa
 * (p.ej. `section-toolbar` en PartesList) para evitar filas/cards intermedias.
 */
export function PartesPeriodoNav({ vista, anchor, onVistaChange, onAnchorChange }: PartesPeriodoNavProps) {
  const rango = computePeriodoRango(vista, anchor);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const isToday = isSameDay(anchor, today);

  return (
    <>
      {/* Segmented control de vista */}
      <div className="flex items-center gap-1 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] p-0.5 shadow-[var(--glass-shadow)]">
        {VISTAS.map((v) => {
          const active = vista === v.value;
          return (
            <Button
              key={v.value}
              variant="ghost"
              size="sm"
              onClick={() => onVistaChange(v.value)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs transition-all",
                active
                  ? "bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)] font-semibold"
                  : "text-muted-foreground hover:bg-[var(--glass-bg-strong)]/60 hover:text-foreground"
              )}
            >
              {v.label}
            </Button>
          );
        })}
      </div>

      {vista !== "todo" && (
        <>
          {/* Flechas de navegación */}
          <div className="flex items-center gap-0.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] px-1 py-0.5 shadow-[var(--glass-shadow)]">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md glass-hover"
              onClick={() => onAnchorChange(shiftAnchor(vista, anchor, -1))}
              aria-label="Periodo anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md glass-hover"
              onClick={() => onAnchorChange(shiftAnchor(vista, anchor, 1))}
              aria-label="Periodo siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Etiqueta del periodo */}
          <div className="flex items-center gap-1.5 text-sm font-medium whitespace-nowrap">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="tabular-nums">{rango.label}</span>
          </div>

          {!isToday && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => onAnchorChange(today)}
            >
              Hoy
            </Button>
          )}
        </>
      )}
    </>
  );
}
