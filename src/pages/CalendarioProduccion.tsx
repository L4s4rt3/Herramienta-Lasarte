import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { usePartes } from "@/hooks/usePartes";
import type { Parte } from "@/hooks/usePartes";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, CalendarDays, Download,
  CheckCircle2, AlertTriangle, XCircle, TrendingUp, TrendingDown,
  FileText, Clock, User, AlertCircle,
} from "lucide-react";

const SEMAFORO_META: Record<string, { label: string; color: string; bg: string; border: string; dot: string; text: string }> = {
  verde:   { label: "OK", color: "text-emerald-600", bg: "bg-emerald-50",   border: "border-emerald-200", dot: "bg-emerald-500",  text: "text-emerald-700" },
  amarillo:{ label: "Revisar", color: "text-amber-600", bg: "bg-amber-50",   border: "border-amber-200",  dot: "bg-amber-500",   text: "text-amber-700" },
  rojo:    { label: "Crítico", color: "text-red-600",   bg: "bg-red-50",     border: "border-red-200",    dot: "bg-red-500",     text: "text-red-700" },
};

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── KPI Stat Cards ───────────────────────────────────────────────────────────

function KPIStatCards({ monthPartes, totalDays }: { monthPartes: Parte[]; totalDays: number }) {
  const nVerde = monthPartes.filter(p => p.cascade.semaforo === "verde").length;
  const nAmarillo = monthPartes.filter(p => p.cascade.semaforo === "amarillo").length;
  const nRojo = monthPartes.filter(p => p.cascade.semaforo === "rojo").length;
  const avgDsj = monthPartes.length > 0
    ? monthPartes.reduce((s, p) => s + Math.abs(p.cascade.dsj_pct), 0) / monthPartes.length
    : 0;
  const worstDay = monthPartes.length > 0
    ? monthPartes.reduce((a, b) => Math.abs(a.cascade.dsj_pct) > Math.abs(b.cascade.dsj_pct) ? a : b)
    : null;
  const coverage = monthPartes.length;
  const pctCoverage = totalDays > 0 ? Math.round((coverage / totalDays) * 100) : 0;

  const items = [
    { label: "Días OK", value: nVerde, color: "text-emerald-600", icon: CheckCircle2, bg: "bg-emerald-50", border: "border-emerald-200", trend: nVerde > 0 ? `${Math.round(nVerde / Math.max(coverage, 1) * 100)}% del mes` : null },
    { label: "Revisar", value: nAmarillo, color: "text-amber-600", icon: AlertTriangle, bg: "bg-amber-50", border: "border-amber-200", trend: null },
    { label: "Crítico", value: nRojo, color: "text-red-600", icon: XCircle, bg: "bg-red-50", border: "border-red-200", trend: null },
    { label: "DJPMN medio", value: `${avgDsj.toFixed(1)}%`, color: "text-sky-600", icon: TrendingUp, bg: "bg-sky-50", border: "border-sky-200", trend: `${coverage} días` },
    { label: "Peor día", value: worstDay ? `${Math.abs(worstDay.cascade.dsj_pct).toFixed(1)}%` : "—", color: "text-slate-600", icon: TrendingDown, bg: "bg-slate-50", border: "border-slate-200", trend: worstDay ? format(parseISO(worstDay.date), "d MMM", { locale: es }) : null },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {items.map((item) => (
        <Card key={item.label} className={cn("border shadow-sm", item.border)}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{item.label}</p>
                <p className={cn("text-2xl font-bold tabular-nums", item.color)}>{item.value}</p>
              </div>
              <item.icon className={cn("h-5 w-5 mt-0.5", item.color)} />
            </div>
            {item.trend && (
              <p className="text-xs text-muted-foreground mt-1">{item.trend}</p>
            )}
            {item.label === "Días OK" && coverage > 0 && (
              <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", nVerde > 0 ? "bg-emerald-500" : "bg-transparent")} style={{ width: `${(nVerde / coverage) * 100}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Calendar Header ──────────────────────────────────────────────────────────

function CalendarHeader({
  currentMonth, onPrev, onNext, onToday, onExport,
}: {
  currentMonth: Date; onPrev: () => void; onNext: () => void; onToday: () => void; onExport: () => void;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">Calendario de Producción</h1>
        <p className="page-subtitle">Vista mensual con estado DJPMN por día</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onToday}>
          <CalendarDays className="h-4 w-4 mr-1.5" /> Hoy
        </Button>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="h-4 w-4 mr-1.5" /> Exportar
        </Button>
      </div>
    </div>
  );
}

// ─── Month Navigator ──────────────────────────────────────────────────────────

function MonthNavigator({ currentMonth, onPrev, onNext }: { currentMonth: Date; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onPrev}>
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <h2 className="text-lg font-bold capitalize">
        {format(currentMonth, "MMMM yyyy", { locale: es })}
      </h2>
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onNext}>
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}

// ─── Status Filters + Legend ──────────────────────────────────────────────────

const STATUS_OPTS = [
  { key: "todos", label: "Todos", color: "" },
  { key: "verde", label: "OK", color: "bg-emerald-500" },
  { key: "amarillo", label: "Revisar", color: "bg-amber-500" },
  { key: "rojo", label: "Crítico", color: "bg-red-500" },
];

function CalendarFilters({
  statusFilter, onStatusChange,
}: {
  statusFilter: string; onStatusChange: (k: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_OPTS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onStatusChange(opt.key)}
          className={cn(
            "inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors",
            statusFilter === opt.key
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          {opt.color && <span className={cn("h-2 w-2 rounded-full", opt.color)} />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-emerald-500" /> OK ≤3%
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-amber-500" /> Revisar 3–5%
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-red-500" /> Crítico &gt;5%
      </span>
    </div>
  );
}

// ─── Calendar Day Cell ────────────────────────────────────────────────────────

function CalendarDayCell({
  day, parte, isCurrentMonth, isSelected, isTodayDate, statusFilter, onClick,
}: {
  day: Date; parte: Parte | undefined; isCurrentMonth: boolean; isSelected: boolean; isTodayDate: boolean;
  statusFilter: string; onClick: (d: Date) => void;
}) {
  const semaforo = parte?.cascade?.semaforo;
  const meta = semaforo ? SEMAFORO_META[semaforo] : null;
  const isFilteredOut = statusFilter !== "todos" && semaforo && semaforo !== statusFilter;
  const isAbsent = !parte && isCurrentMonth;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
            <button
            onClick={() => onClick(day)}
            disabled={!isCurrentMonth && !parte}
            className={cn(
              "relative w-full flex flex-col items-center justify-center rounded-xl border p-3 transition-all min-h-[90px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !isCurrentMonth && !parte && "border-transparent",
              isCurrentMonth && !parte && "border-dashed border-muted-foreground/20 bg-muted/10",
              parte && meta && cn(meta.bg, meta.border, "shadow-sm"),
              parte && isFilteredOut && "opacity-30",
              isSelected && "ring-2 ring-primary ring-offset-2",
              isTodayDate && !isSelected && "ring-1 ring-muted-foreground/30",
              "hover:shadow-md hover:z-10",
            )}
          >
            <span className={cn(
              "text-sm font-bold leading-tight",
              !isCurrentMonth && "text-muted-foreground/40",
              isTodayDate && "text-primary font-bold",
              isAbsent && "text-muted-foreground/50",
            )}>
              {format(day, "d")}
            </span>
            {parte && meta && (
              <>
                <span className={cn(
                  "text-xs font-bold tabular-nums mt-1 leading-tight",
                  meta.text,
                )}>
                  {parte.cascade.dsj_pct > 0 ? "+" : ""}{parte.cascade.dsj_pct.toFixed(1)}%
                </span>
                <span className={cn("h-1.5 w-10 rounded-full mt-1", meta.dot)} />
              </>
            )}
            {isAbsent && <span className="text-xs text-muted-foreground/40 mt-1">—</span>}
          </button>
        </TooltipTrigger>
        {parte && meta && (
          <TooltipContent side="top" className="text-sm space-y-1">
            <p className="font-semibold">{format(day, "EEEE d MMMM", { locale: es })}</p>
            <p className={meta.text}>{meta.label} · DJPMN {parte.cascade.dsj_pct > 0 ? "+" : ""}{parte.cascade.dsj_pct.toFixed(1)}%</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Calendar Grid ────────────────────────────────────────────────────────────

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function CalendarGrid({
  currentMonth, dateParteMap, selectedDate, onDayClick, statusFilter,
}: {
  currentMonth: Date; dateParteMap: Map<string, Parte>; selectedDate: Date | null;
  onDayClick: (d: Date) => void; statusFilter: string;
}) {
  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [currentMonth]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-2">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="text-center text-xs font-bold text-muted-foreground uppercase tracking-wider py-1">
            {wd}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => (
          <CalendarDayCell
            key={day.toISOString()}
            day={day}
            parte={dateParteMap.get(formatDateStr(day))}
            isCurrentMonth={isSameMonth(day, currentMonth)}
            isSelected={selectedDate ? isSameDay(day, selectedDate) : false}
            isTodayDate={isToday(day)}
            statusFilter={statusFilter}
            onClick={onDayClick}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Day Details Panel ────────────────────────────────────────────────────────

function DayDetailsPanel({ date, parte, onClose, onNavigate }: { date: Date; parte: Parte | undefined; onClose: () => void; onNavigate: (id: string) => void }) {
  if (!parte) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{format(date, "EEEE d MMMM", { locale: es })}</h3>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <FileText className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm">Sin parte registrado</p>
          <p className="text-xs mt-0.5">No hay datos de producción para este día</p>
        </div>
      </div>
    );
  }

  const meta = SEMAFORO_META[parte.cascade.semaforo] ?? SEMAFORO_META.rojo;
  const dsj = parte.cascade.dsj_pct;
  const totalKg = (parte.kg_produccion_calibrador ?? 0) + (parte.kg_mujeres_calibrador ?? 0);
  const mermas = parte.cascade.mermas_totales ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold capitalize">{format(date, "EEEE d MMMM", { locale: es })}</h3>
          <p className="text-sm text-muted-foreground">{format(date, "yyyy")}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => onNavigate(parte.id)}>
          <FileText className="h-3.5 w-3.5" />
          Abrir parte
        </Button>
      </div>

      <div className={cn("flex items-center justify-between rounded-xl border p-4", meta.border, meta.bg)}>
        <div>
          <p className={cn("text-sm font-semibold", meta.text)}>{meta.label}</p>
          <p className={cn("text-3xl font-bold tabular-nums", meta.color)}>
            {dsj > 0 ? "+" : ""}{dsj.toFixed(1)}%
          </p>
        </div>
        <div className={cn("h-12 w-12 rounded-full flex items-center justify-center", meta.dot.replace("bg-", "bg-").replace("-500", "-100"))}>
          {parte.cascade.semaforo === "verde" ? <CheckCircle2 className={cn("h-7 w-7", meta.color)} /> :
           parte.cascade.semaforo === "amarillo" ? <AlertTriangle className={cn("h-7 w-7", meta.color)} /> :
           <XCircle className={cn("h-7 w-7", meta.color)} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border p-3 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Producción</span>
          <p className="font-bold tabular-nums text-base">{totalKg.toFixed(0)} kg</p>
        </div>
        <div className="rounded-xl border p-3 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Mermas</span>
          <p className="font-bold tabular-nums text-base">{mermas.toFixed(0)} kg</p>
        </div>
        <div className="rounded-xl border p-3 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Diferencia bruta</span>
          <p className="font-bold tabular-nums text-base">{parte.cascade.diferencia_bruta?.toFixed(0) ?? "—"} kg</p>
        </div>
        <div className="rounded-xl border p-3 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Palets brutos</span>
          <p className="font-bold tabular-nums text-base">{parte.kg_palets_brutos ?? "—"}</p>
        </div>
      </div>

      {parte.notas_generales && (
        <div className="rounded-xl border p-4 space-y-1.5">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span className="font-semibold">Observaciones</span>
          </div>
          <p className="text-sm leading-relaxed">{parte.notas_generales}</p>
        </div>
      )}

      {parte.notas_inventario && (
        <div className="rounded-xl border p-4 space-y-1.5">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span className="font-semibold">Notas de inventario</span>
          </div>
          <p className="text-sm leading-relaxed">{parte.notas_inventario}</p>
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {parte.created_at ? format(parseISO(parte.created_at), "d MMM HH:mm", { locale: es }) : "—"}
        </span>
        {parte.estado && (
          <Badge variant="outline" className="text-[10px] h-5">{parte.estado}</Badge>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CalendarioProduccion() {
  const navigate = useNavigate();
  const { partes, loading } = usePartes();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [statusFilter, setStatusFilter] = useState("todos");

  const dateParteMap = useMemo(() => {
    const map = new Map<string, Parte>();
    for (const p of partes) map.set(p.date, p);
    return map;
  }, [partes]);

  const monthPartes = useMemo(() => {
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    return partes.filter((p) => {
      const d = parseISO(p.date);
      return d.getFullYear() === y && d.getMonth() === m;
    });
  }, [partes, currentMonth]);

  const selectedParte = selectedDate ? dateParteMap.get(formatDateStr(selectedDate)) ?? null : null;

  const totalDaysInMonth = endOfMonth(currentMonth).getDate();

  const handleDayClick = (day: Date) => {
    setSelectedDate(day);
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentMonth(now);
    setSelectedDate(now);
  };

  const handleExport = () => {
    const rows = monthPartes.map((p) => ({
      Fecha: p.date,
      Estado: SEMAFORO_META[p.cascade.semaforo]?.label ?? "—",
      "DJPMN %": p.cascade.dsj_pct.toFixed(1),
      "Prod. (kg)": (p.kg_produccion_calibrador ?? 0) + (p.kg_mujeres_calibrador ?? 0),
      Mermas: p.cascade.mermas_totales?.toFixed(0) ?? "—",
      Observaciones: p.notas_generales ?? "",
    }));
    const csv = [
      Object.keys(rows[0] ?? {}).join(","),
      ...rows.map((r) => Object.values(r).map((v) => `"${v}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `calendario-${format(currentMonth, "yyyy-MM")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="page-shell">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-96" />
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <CalendarHeader currentMonth={currentMonth} onPrev={() => setCurrentMonth(subMonths(currentMonth, 1))} onNext={() => setCurrentMonth(addMonths(currentMonth, 1))} onToday={handleToday} onExport={handleExport} />

      <div className="mt-8">
        <KPIStatCards monthPartes={monthPartes} totalDays={totalDaysInMonth} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <CalendarFilters statusFilter={statusFilter} onStatusChange={setStatusFilter} />
        <StatusLegend />
      </div>

      {/* Desktop: grid | sidebar  |  Mobile: stack + drawer */}
      <div className="mt-6 lg:grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <Card className="shadow-sm border">
          <CardContent className="p-5 sm:p-6">
            <MonthNavigator currentMonth={currentMonth} onPrev={() => setCurrentMonth(subMonths(currentMonth, 1))} onNext={() => setCurrentMonth(addMonths(currentMonth, 1))} />
            <div className="mt-4">
              <CalendarGrid currentMonth={currentMonth} dateParteMap={dateParteMap} selectedDate={selectedDate} onDayClick={handleDayClick} statusFilter={statusFilter} />
            </div>
          </CardContent>
        </Card>

        {/* Desktop sidebar */}
        <div className="hidden lg:block">
          <Card className="shadow-sm border sticky top-6">
            <CardContent className="p-6">
              <ScrollArea className="h-[calc(100vh-12rem)]">
                {selectedDate ? (
                  <DayDetailsPanel date={selectedDate} parte={selectedParte} onClose={() => setSelectedDate(null)} onNavigate={(id) => navigate(`/partes/${id}`)} />
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <CalendarDays className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm font-medium">Selecciona un día</p>
                    <p className="text-xs mt-1">Haz clic en cualquier día del calendario</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mobile: Drawer for day details */}
      <Drawer>
        <DrawerTrigger asChild>
          <button className="hidden" id="mobile-detail-trigger" />
        </DrawerTrigger>
        <DrawerContent className="p-4 max-h-[80vh]">
          <ScrollArea className="h-full">
            {selectedDate && <DayDetailsPanel date={selectedDate} parte={selectedParte} onClose={() => {}} onNavigate={(id) => navigate(`/partes/${id}`)} />}
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
