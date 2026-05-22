import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DayPicker } from "react-day-picker";
import { usePartes } from "@/hooks/usePartes";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import "react-day-picker/dist/style.css";

// ─── Helper ─────────────────────────────────────────────────────────────────
function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Custom Day Content ──────────────────────────────────────────────────────

function DayCell({
  date,
  dateParteMap,
}: {
  date: Date;
  dateParteMap: Map<string, any>;
}) {
  const dateStr = formatDateStr(date);
  const parte = dateParteMap.get(dateStr);
  const semaforo = parte?.cascade?.semaforo as string | undefined;

  return (
    <div className="relative flex flex-col items-center justify-center py-0.5">
      <span className="text-sm leading-none">{date.getDate()}</span>
      {semaforo && (
        <span
          className={cn(
            "mt-0.5 h-1.5 w-1.5 rounded-full shrink-0",
            semaforo === "verde" && "bg-emerald-500",
            semaforo === "amarillo" && "bg-amber-500",
            semaforo === "rojo" && "bg-red-500",
          )}
        />
      )}
    </div>
  );
}

// ─── Calendar Page ────────────────────────────────────────────────────────────

export default function Calendario() {
  const navigate = useNavigate();
  const { partes, loading } = usePartes();
  const [month, setMonth] = useState<Date>(new Date());

  // Build a map of date -> Parte (fast lookup)
  const dateParteMap = useMemo(() => {
    const map = new Map<string, (typeof partes)[0]>();
    for (const p of partes) {
      map.set(p.date, p);
    }
    return map;
  }, [partes]);

  // Filter partes for the selected month
  const monthPartes = useMemo(() => {
    const year = month.getFullYear();
    const m = month.getMonth(); // 0-indexed
    return partes.filter((p) => {
      const d = new Date(p.date + "T12:00:00");
      return d.getFullYear() === year && d.getMonth() === m;
    });
  }, [partes, month]);

  const monthTotals = useMemo(() => {
    const n_ok = monthPartes.filter(
      (p) => p.cascade.semaforo === "verde"
    ).length;
    const n_amarillo = monthPartes.filter(
      (p) => p.cascade.semaforo === "amarillo"
    ).length;
    const n_rojo = monthPartes.filter(
      (p) => p.cascade.semaforo === "rojo"
    ).length;
    return { total: monthPartes.length, n_ok, n_amarillo, n_rojo };
  }, [monthPartes]);

  const handleDayClick = (day: Date) => {
    const dateStr = formatDateStr(day);
    const parte = dateParteMap.get(dateStr);
    if (parte) {
      navigate(`/partes/${parte.id}`);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Calendario de Producción
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vista mensual con estado DJPMN por día · Haz clic en un día para ver
          el detalle
        </p>
      </header>

      {/* ─── Summary cards ──────────────────────────────────────── */}
      {!loading && monthPartes.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-emerald-200 dark:border-emerald-900">
            <CardContent className="flex items-center gap-3 p-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 shrink-0" />
              <div>
                <p className="text-2xl font-bold">{monthTotals.n_ok}</p>
                <p className="text-xs text-muted-foreground">OK (≤3%)</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 dark:border-amber-900">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertCircle className="h-8 w-8 text-amber-500 shrink-0" />
              <div>
                <p className="text-2xl font-bold">{monthTotals.n_amarillo}</p>
                <p className="text-xs text-muted-foreground">Revisar (3–5%)</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="flex items-center gap-3 p-4">
              <XCircle className="h-8 w-8 text-red-500 shrink-0" />
              <div>
                <p className="text-2xl font-bold">{monthTotals.n_rojo}</p>
                <p className="text-xs text-muted-foreground">Crítico (&gt;5%)</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && monthPartes.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            No hay partes en este mes
          </CardContent>
        </Card>
      )}

      {/* ─── Calendar ───────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4 md:p-6">
          {loading ? (
            <Skeleton className="h-80" />
          ) : (
            <div className="flex justify-center">
              <DayPicker
                month={month}
                onMonthChange={setMonth}
                onDayClick={handleDayClick}
                fixedWeeks
                components={{
                  DayContent: (props: any) => (
                    <DayCell date={props.date} dateParteMap={dateParteMap} />
                  ),
                  IconLeft: () => <ChevronLeft className="h-4 w-4" />,
                  IconRight: () => <ChevronRight className="h-4 w-4" />,
                }}
                classNames={{
                  months: "flex flex-col",
                  month: "space-y-4",
                  caption: "flex justify-center pt-1 relative items-center text-sm font-medium mb-2 px-8",
                  caption_label: "text-sm font-medium",
                  nav: "space-x-1 flex items-center",
                  nav_button:
                    "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center rounded-md",
                  nav_button_previous: "absolute left-1",
                  nav_button_next: "absolute right-1",
                  table: "w-full border-collapse",
                  head_row: "flex",
                  head_cell:
                    "text-muted-foreground rounded-md w-10 font-normal text-[0.8rem] pb-2",
                  row: "flex w-full mt-0.5",
                  cell: cn(
                    "h-10 w-10 text-center text-sm p-0 relative",
                    "[&:has([aria-selected])]:bg-accent",
                    "first:[&:has([aria-selected])]:rounded-l-md",
                    "last:[&:has([aria-selected])]:rounded-r-md",
                    "focus-within:relative focus-within:z-20"
                  ),
                  day: cn(
                    "h-10 w-10 p-0 font-normal aria-selected:opacity-100",
                    "hover:bg-accent hover:text-accent-foreground rounded-md inline-flex items-center justify-center"
                  ),
                  day_today: "bg-accent/50 text-accent-foreground font-semibold",
                  day_outside:
                    "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
                  day_disabled: "text-muted-foreground opacity-50",
                  day_hidden: "invisible",
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Legend ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-6 text-sm flex-wrap">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">OK · DJPMN ≤ 3%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-amber-500" />
          <span className="text-muted-foreground">Revisar · DJPMN ≤ 5%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-500" />
          <span className="text-muted-foreground">Crítico · DJPMN &gt; 5%</span>
        </div>
      </div>
    </div>
  );
}
