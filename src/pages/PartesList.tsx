import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { usePartesFiltered, EstadoFiltro, PartesFilter, upsertParteInCache, type ParteRaw } from "@/hooks/usePartes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/StatusBadge";
import { SemaforoPill } from "@/components/SemaforoPill";
import { ExportPartesDialog } from "@/components/ExportPartesDialog";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatKg, today } from "@/lib/format";
import { getSemaforo } from "@/lib/semaforo";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Trash2, ChevronUp, ChevronDown, ChevronsUpDown,
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

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ChevronUp className="h-3 w-3 text-primary" />
    : <ChevronDown className="h-3 w-3 text-primary" />;
}

function ColHead({ label, sk, right, sortKey, sortDir, onToggle }: { label: string; sk: SortKey; right?: boolean; sortKey: SortKey; sortDir: SortDir; onToggle: (k: SortKey) => void }) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors",
        right && "text-right"
      )}
      onClick={() => onToggle(sk)}
    >
      <span className={cn("inline-flex items-center gap-1", right && "flex-row-reverse")}>
        {label}<SortIcon active={sortKey === sk} dir={sortDir} />
      </span>
    </th>
  );
}

function DSJBar({ pct }: { pct: number }) {
  const sem = getSemaforo(pct);
  const width = Math.min((Math.abs(pct) / 5) * 100, 100);
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="w-14 h-1.5 shrink-0 overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
        <div className={cn("h-full rounded-full", sem.bar)} style={{ width: `${width}%` }} />
      </div>
      <span className={cn("text-xs tabular-nums font-medium", sem.text)}>
        {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
      </span>
    </div>
  );
}

function StatBox({ label, value, sub, valueClass, muted }: { label: string; value: string; sub?: string; valueClass?: string; muted?: boolean }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="panel-kicker mb-1">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", muted && "text-muted-foreground", valueClass)}>{value}</div>
      {sub && <div className={cn("text-xs font-medium", valueClass)}>{sub}</div>}
    </div>
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

export default function PartesList() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<PartesFilter>({
    search: "", estado: "todos", soloAlertas: false,
  });

  const { partes, allPartes, loading, totals, refetch } = usePartesFiltered(filter);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = useMemo(() => {
    return [...partes].sort((a, b) => {
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
  }, [partes, sortKey, sortDir]);

  const [newDate, setNewDate] = useState(today());
  const [creating, setCreating] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

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

  const deleteDialog = (p: (typeof sorted)[number]) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive">
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

  return (
    <div className="page-shell">

      {/* Header */}
      <header className="page-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="page-title">{t("partes")}</h1>
            {!loading && partes.length > 0 && <SemaforoPill dsjPct={totals.dsj_pct} />}
          </div>
          <p className="page-subtitle">
            Reconciliación diaria de masa
            {!loading && <> · <span className="font-medium text-foreground">{allPartes.length}</span> partes</>}
          </p>
        </div>
        <ExportPartesDialog />
      </header>

      {/* Toolbar */}
      <div className="section-toolbar">
        {/* Crear parte */}
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium whitespace-nowrap">Nuevo parte</Label>
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-40 justify-start gap-2 glass glass-hover font-normal"
              >
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="tabular-nums">
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
          <Button onClick={createParte} disabled={creating} size="sm" className="glass glass-hover">
            <Plus className="h-3.5 w-3.5" /> Crear
          </Button>
        </div>

        <div className="hidden sm:block h-8 w-px bg-border" />

        {/* Búsqueda */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar fecha…"
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            className="pl-8 w-full sm:w-44 h-9"
          />
        </div>

        {/* Estado */}
        <Select value={filter.estado} onValueChange={(v) => setFilter((f) => ({ ...f, estado: v as EstadoFiltro }))}>
          <SelectTrigger className="w-full sm:w-44 h-9">
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
          size="sm" className="h-9 glass glass-hover"
          onClick={() => setFilter((f) => ({ ...f, soloAlertas: !f.soloAlertas }))}
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Solo críticos
        </Button>

        {hasFilter && (
          <Button variant="ghost" size="sm" className="h-9 text-muted-foreground"
            onClick={() => setFilter({ search: "", estado: "todos", soloAlertas: false })}>
            <X className="h-3.5 w-3.5" /> Limpiar
          </Button>
        )}
      </div>

      {/* Tabla / tarjetas */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-6 w-1 shrink-0 rounded-full bg-primary" />
            <CardTitle className="text-sm font-semibold">
              {loading ? "Cargando…" : hasFilter
                ? `${partes.length} de ${allPartes.length} partes`
                : `${partes.length} parte${partes.length !== 1 ? "s" : ""}`}
            </CardTitle>
            {!loading && partes.length > 0 && (
              <p className="ml-auto hidden text-xs text-muted-foreground sm:block">Haz clic en una fila para ver el detalle</p>
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
                {hasFilter ? "Sin partes con los filtros actuales." : "Aún no hay partes. Crea el primero arriba."}
              </p>
              {hasFilter ? (
                <Button variant="link" size="sm" className="mt-2 text-xs"
                  onClick={() => setFilter({ search: "", estado: "todos", soloAlertas: false })}>
                  Limpiar filtros
                </Button>
              ) : (
                <Button size="sm" className="mt-4 glass glass-hover" onClick={() => setPopoverOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Crear primer parte
                </Button>
              )}
            </div>
          ) : (
            <>
              {sorted.length > 1 && (
                <div className="border-b border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-4">
                  <div className="panel-kicker mb-2">Total · {sorted.length} partes</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatBox label="Producción real" value={formatKg(totals.produccion_real)} />
                    <StatBox label="Palets ajustados" value={formatKg(totals.palets_ajustados)} muted />
                    <StatBox
                      label="DJPMN"
                      value={formatKg(totals.dsj)}
                      sub={`${totals.dsj_pct >= 0 ? "+" : ""}${totals.dsj_pct.toFixed(2)}%`}
                      valueClass={totalsSem.text}
                    />
                    <StatBox label="Mermas" value={formatKg(totals.mermas_totales)} muted />
                  </div>
                </div>
              )}

              {/* Escritorio: tabla */}
              <div className="hidden overflow-x-auto md:block">
                <table className="data-table">
                  <thead>
                    <tr>
                      <ColHead label="Fecha"         sk="date"         sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                      <ColHead label="Estado"        sk="estado"       sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                      <ColHead label="Prod. real"    sk="produccion"   sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} right />
                      <ColHead label="Palets ajust." sk="palets"       sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} right />
                      <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-left">% DJPMN</th>
                      <ColHead label="DJPMN (kg)"   sk="dsj_pct"      sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} right />
                      <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap">Mermas</th>
                      <th className="w-10" />
                    </tr>
                  </thead>

                  <tbody>
                    {sorted.map((p) => {
                      const abs = Math.abs(p.cascade.dsj_pct);
                      const s = getSemaforo(p.cascade.dsj_pct);
                      return (
                        <tr
                          key={p.id}
                          className={cn(
                            "cursor-pointer transition-all group",
                            abs > 5
                              ? "bg-destructive/[0.04] hover:bg-destructive/[0.08]"
                              : "hover:bg-[var(--glass-bg-strong)]"
                          )}
                          onClick={() => navigate(`/partes/${p.id}`)}
                        >
                          <td className="px-4 py-3 font-medium whitespace-nowrap">{formatDate(p.date)}</td>
                          <td className="px-4 py-3"><StatusBadge estado={p.estado} /></td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">{formatKg(p.cascade.produccion_real)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatKg(p.cascade.palets_ajustados)}</td>
                          <td className="px-4 py-3"><DSJBar pct={p.cascade.dsj_pct} /></td>
                          <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", s.text)}>
                            {formatKg(p.cascade.dsj)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatKg(p.cascade.mermas_totales)}</td>
                          <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
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

              {/* Móvil: tarjetas */}
              <div className="divide-y divide-[var(--glass-border)] md:hidden">
                {sorted.map((p) => {
                  const abs = Math.abs(p.cascade.dsj_pct);
                  const s = getSemaforo(p.cascade.dsj_pct);
                  return (
                    <div
                      key={p.id}
                      onClick={() => navigate(`/partes/${p.id}`)}
                      className={cn(
                        "cursor-pointer px-4 py-3 transition-colors",
                        abs > 5 ? "bg-destructive/[0.04]" : "hover:bg-[var(--glass-bg-strong)]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{formatDate(p.date)}</span>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge estado={p.estado} />
                          <span onClick={(e) => e.stopPropagation()}>{deleteDialog(p)}</span>
                        </div>
                      </div>
                      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                        <MobileField label="Producción" value={formatKg(p.cascade.produccion_real)} />
                        <MobileField label="Palets" value={formatKg(p.cascade.palets_ajustados)} muted />
                        <MobileField label="DJPMN" value={formatKg(p.cascade.dsj)} valueClass={s.text} />
                        <MobileField label="Mermas" value={formatKg(p.cascade.mermas_totales)} muted />
                      </div>
                      <div className="mt-2.5">
                        <DSJBar pct={p.cascade.dsj_pct} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
