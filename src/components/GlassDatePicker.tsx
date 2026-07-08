// src/components/GlassDatePicker.tsx
// Selector de fecha con el diseño glass de la herramienta (mismo patrón que el
// calendario de la sección Partes): botón glass + popover glass-accented con el
// Calendar de shadcn en español. Sustituye a los <input type="date"> nativos,
// que rompen el lenguaje visual de la app. Trabaja con fechas "YYYY-MM-DD" en
// horario local (ancla a mediodía para evitar saltos por zona horaria/UTC).
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface GlassDatePickerProps {
  /** Fecha en formato "YYYY-MM-DD" (o "" si no hay). */
  value: string;
  onChange: (value: string) => void;
  /** Texto cuando no hay fecha seleccionada. */
  label?: string;
  /** Formato de visualización (date-fns). Por defecto "dd MMM". */
  displayFormat?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export function GlassDatePicker({
  value,
  onChange,
  label = "Elegir fecha",
  displayFormat = "dd MMM",
  className,
  disabled,
  id,
}: GlassDatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "glass glass-hover h-9 min-w-[130px] justify-start gap-2 rounded-xl border-[var(--glass-border)] px-2.5 text-xs font-medium",
            className,
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="tabular-nums">
            {selected ? format(selected, displayFormat, { locale: es }) : label}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 glass-accented" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) onChange(format(date, "yyyy-MM-dd"));
            setOpen(false);
          }}
          locale={es}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
