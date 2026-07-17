import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { usePartesFiltered, EstadoFiltro, PartesFilter, upsertParteInCache, type Parte, type ParteRaw } from "@/hooks/usePartes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SemaforoPill } from "@/components/SemaforoPill";
import { InfoTooltip } from "@/components/InfoTooltip";
import { AutoWeekFallbackNotice } from "@/components/AutoWeekFallbackNotice";
import { ExportPartesDialog } from "@/components/ExportPartesDialog";
import { PartesPeriodoNav, computePeriodoRango, parseAnchorDate, type VistaPeriodo } from "@/components/PartesPeriodoNav";
import { ColHead } from "@/components/SortableColumn";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatKg, today } from "@/lib/format";
import { getSemaforo, DJPMN_HELP } from "@/lib/semaforo";
import { format, parseISO, getISOWeek, startOfWeek, endOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Trash2, ChevronRight,
  Search, X, CalendarIcon, AlertTriangle, Factory,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SortKey = "date" | "produccion" | "palets" | "dsj_pct" | "estado";
type SortDir = "asc" | "desc";

/** Fecha corta para filas de tabla/tarjetas: "lun 29 jun". */
function formatDateShort(d: string): string {
  const date = parseISO(d);
  const label = format(date, "EEE d MMM", { locale: es });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Clases del <th> de PartesList: más densas que el header por defecto de `.data-table` (ver src/index.css). */
const COL_HEAD_CLASS = "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

function DSJBar({ pct }: { pct: number }) {
  const sem = getSemaforo(pct);
  const width = Math.min((Math.abs(pct) / 5) * 100, 100);
  return (
    <div className="flex items-center gap-1.5 min-w-[92px]">
      <div className="w-10 h-1 shrink-0 overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
        <div className={cn("h-full rounded-full", sem.bar)} style={{ width: `${width}%` }} />
      </div>
      <span className={cn("text-xs tabular-nums font-medium", sem.text)}>
        {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
      </span>
    </div>
  );
}

/** Chip de métrica compacto: kicker 10px + valor tabular. Para la franja de totales. */
function StatChip({ label, value, sub, valueClass, muted, info }: { label: string; value: string; sub?: string; valueClass?: string; muted?: boolean; info?: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {info && <InfoTooltip iconClassName="h-3 w-3">{info}</InfoTooltip>}
      </div>
      <span className={cn("text-sm font-semibold tabular-nums", muted && "text-muted-foreground", valueClass)}>{value}</span>
      {sub && <span className={cn("text-xs font-medium tabular-nums", valueClass)}>({sub})</span>}
    </div>
  );
}

function EstadoDot({ estado }: { estado: string }) {
  const dotClass =
    estado === "Validado" || estado === "Completado" ? "bg-success" :
    estado === "Analizado" ? "bg-info" :
    estado === "Con descuadre" ? "bg-warning" :
    estado === "Error" ? "bg-destructive" :
    "bg-muted-foreground/50";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
      <span className="text-xs text-foreground">{estado}</span>
    </span>
  );
}

function MobileField({ label, value, valueClass, muted }: { label: string; value: string; valueClass?: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium tabular-nums", muted && "text-muted-foreground", valueClass)}>{value}</span>
    </div>
  );
}

// ─── Agrupación por semana (vista Mes) ──────────────────────────────────────

interface WeekGroup {
  key: string;
  weekNumber: number;
  label: string;
  partes: Parte[];
  totals: { produccion: number; palets: number; dsj: number; dsj_pct: number };
}

function groupByWeek(partes: Parte[]): WeekGroup[] {
  const map = new Map<string, Parte[]>();
  for (const p of partes) {
    const d = parseISO(p.date);
    const start = startOfWeek(d, { weekStartsOn: 1 });
    const key = format(start, "yyyy-MM-dd");
    const arr = map.get(key);
    if (arr) arr.push(p);
    else map.set(key, [p]);
  }
  const groups: WeekGroup[] = Array.from(map.entries()).map(([key, groupPartes]) => {
    const start = parseISO(key);
    const end = endOfWeek(start, { weekStartsOn: 1 });
    const weekNumber = getISOWeek(start);
    const sameMonth = start.getMonth() === end.getMonth();
    const rangeLabel = sameMonth
      ? `${format(start, "d", { locale: es })} – ${format(end, "d MMM", { locale: es })}`
      : `${format(start, "d MMM", { locale: es })} – ${format(end, "d MMM", { locale: es })}`;
    const produccion = groupPartes.reduce((s, p) => s + p.cascade.produccion_real, 0);
    const dsj = groupPartes.reduce((s, p) => s + p.cascade.dsj, 0);
    return {
      key,
      weekNumber,
      label: `S${weekNumber} · ${rangeLabel}`,
      partes: groupPartes,
      totals: {
        produccion,
        palets: groupPartes.reduce((s, p) => s + p.cascade.palets_ajustados, 0),
        dsj,
        dsj_pct: produccion ? (dsj / produccion) * 100 : 0,
      },
    };
  });
  // Semanas más recientes primero
  groups.sort((a, b) => b.key.localeCompare(a.key));
  return groups;
}

export default function PartesList() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // ─── Vista y periodo (persistidos en query params) ───────────────────────
  const vistaParam = searchParams.get("vista");
  const vista: VistaPeriodo = vistaParam === "mes" || vistaParam === "todo" ? vistaParam : "semana";
  const anchor = useMemo(() => parseAnchorDate(searchParams.get("fecha")), [searchParams]);

  function updateParams(next: { vista?: VistaPeriodo; fecha?: string | null }) {
    const params = new URLSearchParams(searchParams);
    if (next.vista !== undefined) params.set("vista", next.vista);
    if (next.fecha !== undefined) {
      if (next.fecha === null) params.delete("fecha");
      else params.set("fecha", next.fecha);
    }
    setSearchParams(params, { replace: true });
  }

  function handleVistaChange(v: VistaPeriodo) {
    manualNavRef.current = true;
    setAutoFallbackActive(false);
    updateParams({ vista: v });
  }

  function handleAnchorChange(d: Date) {
    manualNavRef.current = true;
    setAutoFallbackActive(false);
    updateParams({ fecha: format(d, "yyyy-MM-dd") });
  }

  const periodo = useMemo(() => computePeriodoRango(vista, anchor), [vista, anchor]);

  const [filter, setFilter] = useState<PartesFilter>({
    search: "", estado: "todos", soloAlertas: searchParams.get("soloAlertas") === "1",
  });

  const { partes: allFilteredPartes, allPartes, loading, refetch } = usePartesFiltered(filter);

  // Filtra adicionalmente por el periodo visible (cliente, sobre los ya filtrados por búsqueda/estado/alertas)
  const partes = useMemo(() => {
    if (!periodo.desde || !periodo.hasta) return allFilteredPartes;
    return allFilteredPartes.filter((p) => p.date >= periodo.desde! && p.date <= periodo.hasta!);
  }, [allFilteredPartes, periodo]);

  const totals = useMemo(() => {
    const total_prod = partes.reduce((s, p) => s + p.cascade.produccion_real, 0);
    const total_dsj = partes.reduce((s, p) => s + p.cascade.dsj, 0);
    return {
      produccion_real: total_prod,
      palets_ajustados: partes.reduce((s, p) => s + p.cascade.palets_ajustados, 0),
      dsj: total_dsj,
      dsj_pct: total_prod ? (total_dsj / total_prod) * 100 : 0,
      mermas_totales: partes.reduce((s, p) => s + p.cascade.mermas_totales, 0),
    };
  }, [partes]);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function sortPartes(list: Parte[]) {
    return [...list].sort((a, b) => {
      let va: string | number, vb: string | number;
      switch (sortKey) {
        case "date":       va = a.date; vb = b.date; break;
        case "produccion": va = a.cascade.produccion_real; vb = b.cascade.produccion_real; break;
        case "palets":     va = a.cascade.palets_ajustados; vb = b.cascade.palets_ajustados; break;
        case "dsj_pct":    va = Math.abs(a.cascade.dsj_pct); vb = Math.abs(b.cascade.dsj_pct); break;
        case "estado":     va = a.estado; vb = b.estado; break;
        default:           va = a.date; vb = b.date;
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const sorted = useMemo(() => sortPartes(partes), [partes, sortKey, sortDir]);

  const weekGroups = useMemo(() => (vista === "mes" ? groupByWeek(partes) : []), [vista, partes]);

  const [collapsedWeeks, setCollapsedWeeks] = useState<Record<string, boolean>>({});
  // Las semanas empiezan expandidas: cualquier key no presente en el mapa se considera expandida.
  function toggleWeekCollapsed(key: string) {
    setCollapsedWeeks((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const [newDate, setNewDate] = useState(today());
  const [creating, setCreating] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Al cambiar de periodo, sugiere crear el parte en la fecha del periodo (si es Semana/Mes con fecha concreta)
  useEffect(() => {
    if (vista === "semana" && periodo.desde) {
      // Si el periodo visible es la semana actual, sugiere hoy; si no, el lunes del periodo.
      const todayStr = today();
      if (periodo.desde <= todayStr && todayStr <= (periodo.hasta ?? todayStr)) setNewDate(todayStr);
      else setNewDate(periodo.desde);
    }
  }, [vista, periodo.desde, periodo.hasta]);

  async function createParte() {
    if (!user) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("partes_diarios")
      .insert({ date: newDate, user_id: user.id, estado: "Borrador" })
      .select("*").single();
    setCreating(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    upsertParteInCache(queryClient, data as ParteRaw);
    navigate(`/partes/${data.id}`);
  }

  async function deleteParte(id: string) {
    const { error } = await supabase.from("partes_diarios").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Parte eliminado" });
    refetch();
  }

  const totalsSem = getSemaforo(totals.dsj_pct);
  const hasFilter = filter.search || filter.estado !== "todos" || filter.soloAlertas;

  // ─── Fallback automático a la semana anterior (solo en la carga inicial) ──
  // Si la vista es "semana" (por defecto), no hay ?fecha/?vista en la URL, no
  // hay filtros activos, y la semana actual no tiene partes pero la anterior
  // sí, saltamos el ancla 7 días atrás una única vez y lo avisamos.
  const hasUrlPeriodo = Boolean(searchParams.get("fecha")) || Boolean(searchParams.get("vista"));
  const autoFallbackTried = useRef(false);
  const [autoFallbackActive, setAutoFallbackActive] = useState(false);
  const manualNavRef = useRef(false);

  useEffect(() => {
    if (loading || autoFallbackTried.current || manualNavRef.current) return;
    if (hasUrlPeriodo || hasFilter || vista !== "semana") return;
    if (!periodo.desde || !periodo.hasta) return;
    autoFallbackTried.current = true;

    const currentWeekCount = allPartes.filter((p) => p.date >= periodo.desde! && p.date <= periodo.hasta!).length;
    if (currentWeekCount > 0) return;

    const prevAnchor = new Date(anchor);
    prevAnchor.setDate(prevAnchor.getDate() - 7);
    const prevPeriodo = computePeriodoRango("semana", prevAnchor);
    if (!prevPeriodo.desde || !prevPeriodo.hasta) return;
    const previousWeekCount = allPartes.filter((p) => p.date >= prevPeriodo.desde! && p.date <= prevPeriodo.hasta!).length;

    if (previousWeekCount > 0) {
      updateParams({ fecha: format(prevAnchor, "yyyy-MM-dd") });
      setAutoFallbackActive(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasUrlPeriodo, hasFilter, vista, periodo.desde, periodo.hasta, allPartes, anchor]);

  function handleGoToCurrentWeek() {
    manualNavRef.current = true;
    setAutoFallbackActive(false);
    updateParams({ fecha: null });
  }

  const deleteDialog = (p: Parte) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Borrar parte">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar parte?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminará el parte del {formatDate(p.date)}. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => deleteParte(p.id)}>{t("delete")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  function DesktopTable({ list }: { list: Parte[] }) {
    return (
      <div className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead>
            <tr>
              <ColHead label="Fecha"         sk="date"         sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} className={COL_HEAD_CLASS} />
              <ColHead label="Estado"        sk="estado"       sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} className={COL_HEAD_CLASS} />
              <ColHead label="Prod. real"    sk="produccion"   sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} right className={COL_HEAD_CLASS} />
              <ColHead label="Palets ajust." sk="palets"       sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} right className={COL_HEAD_CLASS} />
              <ColHead label="% DJPMN"       sk="dsj_pct"      sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} className={COL_HEAD_CLASS} />
              <th className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap">DJPMN (kg)</th>
              <th className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap">Mermas</th>
              <th className="w-8" />
            </tr>
          </thead>

          <tbody>
            {list.map((p, i) => {
              const abs = Math.abs(p.cascade.dsj_pct);
              const s = getSemaforo(p.cascade.dsj_pct);
              return (
                <tr
                  key={p.id}
                  className={cn(
                    "cursor-pointer transition-all group",
                    abs > 5
                      ? "bg-destructive/[0.04] hover:bg-destructive/[0.08]"
                      : i % 2 === 1
                        ? "bg-[var(--glass-bg)]/40 hover:bg-[var(--glass-bg-strong)]"
                        : "hover:bg-[var(--glass-bg-strong)]"
                  )}
                  onClick={() => navigate(`/partes/${p.id}`)}
                >
                  <td className="px-3 py-1.5 text-sm font-medium whitespace-nowrap">{formatDateShort(p.date)}</td>
                  <td className="px-3 py-1.5"><EstadoDot estado={p.estado} /></td>
                  <td className="px-3 py-1.5 text-sm text-right tabular-nums font-medium">{formatKg(p.cascade.produccion_real)}</td>
                  <td className="px-3 py-1.5 text-sm text-right tabular-nums text-muted-foreground">{formatKg(p.cascade.palets_ajustados)}</td>
                  <td className="px-3 py-1.5"><DSJBar pct={p.cascade.dsj_pct} /></td>
                  <td className={cn("px-3 py-1.5 text-sm text-right tabular-nums font-semibold", s.text)}>
                    {formatKg(p.cascade.dsj)}
                  </td>
                  <td className="px-3 py-1.5 text-sm text-right tabular-nums text-muted-foreground">{formatKg(p.cascade.mermas_totales)}</td>
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="opacity-0 transition-opacity group-hover:opacity-100">
                      {deleteDialog(p)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function MobileCards({ list }: { list: Parte[] }) {
    return (
      <div className="divide-y divide-[var(--glass-border)] md:hidden">
        {list.map((p) => {
          const abs = Math.abs(p.cascade.dsj_pct);
          const s = getSemaforo(p.cascade.dsj_pct);
          return (
            <div
              key={p.id}
              onClick={() => navigate(`/partes/${p.id}`)}
              className={cn(
                "cursor-pointer px-3 py-2 transition-colors",
                abs > 5 ? "bg-destructive/[0.04]" : "hover:bg-[var(--glass-bg-strong)]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{formatDateShort(p.date)}</span>
                <div className="flex items-center gap-1.5">
                  <EstadoDot estado={p.estado} />
                  <span onClick={(e) => e.stopPropagation()}>{deleteDialog(p)}</span>
                </div>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                <MobileField label="Producción" value={formatKg(p.cascade.produccion_real)} />
                <MobileField label="Palets" value={formatKg(p.cascade.palets_ajustados)} muted />
                <MobileField label="DJPMN" value={formatKg(p.cascade.dsj)} valueClass={s.text} />
                <MobileField label="Mermas" value={formatKg(p.cascade.mermas_totales)} muted />
              </div>
              <div className="mt-1.5">
                <DSJBar pct={p.cascade.dsj_pct} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="page-shell">

      {/* Header */}
      <header className="page-header">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="page-title">{t("partes")}</h1>
          {!loading && partes.length > 0 && <SemaforoPill dsjPct={totals.dsj_pct} />}
        </div>
        <ExportPartesDialog defaultFrom={periodo.desde ?? undefined} defaultTo={periodo.hasta ?? undefined} />
      </header>

      {/* Toolbar única: vista/periodo + filtros + acciones */}
      <div className="section-toolbar">
        <PartesPeriodoNav
          vista={vista}
          anchor={anchor}
          onVistaChange={handleVistaChange}
          onAnchorChange={handleAnchorChange}
        />

        <div className="hidden sm:block h-6 w-px bg-border" />

        {/* Búsqueda */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar fecha…"
            value={filter.search}
            onChange={(e) => { manualNavRef.current = true; setFilter((f) => ({ ...f, search: e.target.value })); }}
            className="pl-8 w-full sm:w-40 h-8"
          />
        </div>

        {/* Estado */}
        <Select value={filter.estado} onValueChange={(v) => { manualNavRef.current = true; setFilter((f) => ({ ...f, estado: v as EstadoFiltro })); }}>
          <SelectTrigger className="w-full sm:w-36 h-8">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="Analizado">Analizado</SelectItem>
            <SelectItem value="Borrador">Borrador</SelectItem>
          </SelectContent>
        </Select>

        {/* Solo críticos */}
        <Button
          variant={filter.soloAlertas ? "default" : "outline"}
          size="sm" className="h-8 glass glass-hover"
          onClick={() => { manualNavRef.current = true; setFilter((f) => ({ ...f, soloAlertas: !f.soloAlertas })); }}
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Críticos
        </Button>

        {hasFilter && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground"
            onClick={() => setFilter({ search: "", estado: "todos", soloAlertas: false })}>
            <X className="h-3.5 w-3.5" /> Limpiar
          </Button>
        )}

        <div className="hidden sm:block h-6 w-px bg-border sm:ml-auto" />

        {/* Crear parte */}
        <div className="flex items-center gap-1.5">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-36 justify-start gap-1.5 glass glass-hover font-normal"
              >
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="tabular-nums text-xs">
                  {newDate
                    ? format(parseISO(newDate), "dd MMM yyyy", { locale: es })
                    : "Seleccionar…"}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 glass-accented" align="start">
              <Calendar
                mode="single"
                selected={newDate ? parseISO(newDate) : undefined}
                onSelect={(d) => {
                  if (d) {
                    setNewDate(format(d, "yyyy-MM-dd"));
                    setPopoverOpen(false);
                  }
                }}
                locale={es}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <Button onClick={createParte} disabled={creating} size="sm" className="h-8 glass glass-hover">
            <Plus className="h-3.5 w-3.5" /> Nuevo parte
          </Button>
        </div>
      </div>

      {/* ─── Aviso de fallback automático a la semana anterior ─────────────── */}
      {autoFallbackActive && (
        <AutoWeekFallbackNotice
          message={`Esta semana aún no tiene datos — mostrando la semana anterior (${periodo.label})`}
          onGoToCurrentWeek={handleGoToCurrentWeek}
        />
      )}

      {/* Tabla / tarjetas */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="border-b px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 shrink-0 rounded-full bg-primary" />
              <CardTitle className="text-sm font-semibold">
                {loading ? "Cargando…" : hasFilter
                  ? `${partes.length} de ${allPartes.length} partes`
                  : `${partes.length} parte${partes.length !== 1 ? "s" : ""}`}
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {vista === "todo" ? "vista completa" : periodo.label}
              </span>
            </div>

            {!loading && sorted.length > 1 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto">
                <StatChip label="Prod." value={formatKg(totals.produccion_real)} />
                <StatChip label="Palets" value={formatKg(totals.palets_ajustados)} muted />
                <StatChip
                  label="DJPMN"
                  value={formatKg(totals.dsj)}
                  sub={`${totals.dsj_pct >= 0 ? "+" : ""}${totals.dsj_pct.toFixed(2)}%`}
                  valueClass={totalsSem.text}
                  info={DJPMN_HELP}
                />
                <StatChip label="Mermas" value={formatKg(totals.mermas_totales)} muted />
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-11 rounded" />)}
            </div>
          ) : partes.length === 0 ? (
            <div className="py-16 text-center glass m-6 rounded-xl">
              <Factory className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">
                {hasFilter
                  ? "Sin partes con los filtros actuales."
                  : vista === "todo"
                    ? "Aún no hay partes. Crea el primero arriba."
                    : `Sin partes en este periodo (${periodo.label}).`}
              </p>
              {hasFilter ? (
                <Button variant="link" size="sm" className="mt-2 text-xs"
                  onClick={() => setFilter({ search: "", estado: "todos", soloAlertas: false })}>
                  Limpiar filtros
                </Button>
              ) : (
                <Button size="sm" className="mt-4 glass glass-hover" onClick={() => setPopoverOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Crear parte
                </Button>
              )}
            </div>
          ) : vista === "mes" ? (
            <div className="divide-y divide-[var(--glass-border)]">
              {weekGroups.map((g) => {
                const collapsed = !!collapsedWeeks[g.key];
                const gSem = getSemaforo(g.totals.dsj_pct);
                const list = sortPartes(g.partes);
                return (
                  <div key={g.key}>
                    <button
                      type="button"
                      onClick={() => toggleWeekCollapsed(g.key)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--glass-bg-strong)]"
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")} />
                      <span className="text-xs font-semibold">{g.label}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {g.partes.length} parte{g.partes.length !== 1 ? "s" : ""}
                      </span>
                      <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>Prod. <span className="font-medium tabular-nums text-foreground">{formatKg(g.totals.produccion)}</span></span>
                        <span className="hidden sm:inline">Palets <span className="font-medium tabular-nums text-foreground">{formatKg(g.totals.palets)}</span></span>
                        <span className={cn("font-semibold tabular-nums", gSem.text)}>
                          {g.totals.dsj_pct >= 0 ? "+" : ""}{g.totals.dsj_pct.toFixed(2)}%
                        </span>
                      </div>
                    </button>
                    {!collapsed && (
                      <>
                        <DesktopTable list={list} />
                        <MobileCards list={list} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <DesktopTable list={sorted} />
              <MobileCards list={sorted} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
