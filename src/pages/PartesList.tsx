import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { usePartesFiltered, EstadoFiltro, PartesFilter } from "@/hooks/usePartes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { ExportPartesDialog } from "@/components/ExportPartesDialog";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatKg, today } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Trash2, ChevronUp, ChevronDown, ChevronsUpDown,
  Factory, Package, TrendingDown, AlertTriangle,
  Search, X, Calendar, BarChart3,
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

function DSJBar({ pct }: { pct: number }) {
  const abs = Math.abs(pct);
  const color = abs <= 3 ? "bg-success" : abs <= 5 ? "bg-warning" : "bg-destructive";
  const width = Math.min((abs / 5) * 100, 100);
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${width}%` }} />
      </div>
      <span className={cn(
        "text-xs tabular-nums font-medium",
        abs <= 3 ? "text-success" : abs <= 5 ? "text-warning" : "text-destructive"
      )}>
        {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
      </span>
    </div>
  );
}

export default function PartesList() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

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

  async function createParte() {
    if (!user) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("partes_diarios")
      .insert({ date: newDate, user_id: user.id, estado: "Borrador" })
      .select("id").single();
    setCreating(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    navigate(`/partes/${data.id}`);
  }

  async function deleteParte(id: string) {
    const { error } = await supabase.from("partes_diarios").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Parte eliminado" });
    refetch();
  }

  function ColHead({ label, sk, right }: { label: string; sk: SortKey; right?: boolean }) {
    return (
      <th
        className={cn(
          "px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors",
          right && "text-right"
        )}
        onClick={() => toggleSort(sk)}
      >
        <span className={cn("inline-flex items-center gap-1", right && "flex-row-reverse")}>
          {label}<SortIcon active={sortKey === sk} dir={sortDir} />
        </span>
      </th>
    );
  }

  const dsjAbs = Math.abs(totals.dsj_pct);
  const hasFilter = filter.search || filter.estado !== "todos" || filter.soloAlertas;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">{t("partes")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Reconciliación diaria de masa
            {!loading && <> · <span className="font-medium text-foreground">{allPartes.length}</span> partes en total</>}
          </p>
        </div>
        <ExportPartesDialog />
      </header>

      {/* KPIs */}
      {!loading && partes.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-l-4 border-l-primary">
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <Factory className="h-3.5 w-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Producción real</span>
              </div>
              <p className="text-xl font-bold tabular-nums">{formatKg(totals.produccion_real)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{partes.length} parte{partes.length !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-info">
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <Package className="h-3.5 w-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Palets ajustados</span>
              </div>
              <p className="text-xl font-bold tabular-nums">{formatKg(totals.palets_ajustados)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">neto</p>
            </CardContent>
          </Card>

          <Card className={cn("border-l-4", dsjAbs <= 3 ? "border-l-success" : dsjAbs <= 5 ? "border-l-warning" : "border-l-destructive")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <TrendingDown className="h-3.5 w-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">DJPMN acumulado</span>
              </div>
              <p className="text-xl font-bold tabular-nums">{formatKg(totals.dsj)}</p>
              <p className={cn(
                "text-xs font-semibold mt-0.5 tabular-nums",
                dsjAbs <= 3 ? "text-success" : dsjAbs <= 5 ? "text-warning" : "text-destructive"
              )}>
                {totals.dsj_pct >= 0 ? "+" : ""}{totals.dsj_pct.toFixed(2)}% global
              </p>
            </CardContent>
          </Card>

          <Card className={cn("border-l-4", totals.n_rojo === 0 ? "border-l-success" : "border-l-destructive")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Semáforos</span>
              </div>
              <div className="flex gap-3 mt-1">
                <span className="text-success font-bold tabular-nums text-lg">{totals.n_ok}</span>
                <span className="text-warning font-bold tabular-nums text-lg">{totals.n_amarillo}</span>
                <span className="text-destructive font-bold tabular-nums text-lg">{totals.n_rojo}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">verde · amari. · rojo</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center flex-wrap">
        {/* Crear parte */}
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <Label htmlFor="newdate" className="text-sm font-medium whitespace-nowrap">Nuevo parte</Label>
          <Input id="newdate" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-40 h-9" />
          <Button onClick={createParte} disabled={creating} size="sm">
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
            className="pl-8 w-44 h-9"
          />
        </div>

        {/* Estado */}
        <Select value={filter.estado} onValueChange={(v) => setFilter((f) => ({ ...f, estado: v as EstadoFiltro }))}>
          <SelectTrigger className="w-44 h-9">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="Borrador">Borrador</SelectItem>
            <SelectItem value="Analizado">Analizado</SelectItem>
            <SelectItem value="Con descuadre">Con descuadre</SelectItem>
            <SelectItem value="Validado">Validado</SelectItem>
          </SelectContent>
        </Select>

        {/* Solo críticos */}
        <Button
          variant={filter.soloAlertas ? "default" : "outline"}
          size="sm" className="h-9"
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

      {/* Tabla */}
      <Card className="overflow-hidden">
        <CardHeader className="py-3 px-4 border-b flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">
              {loading ? "Cargando…" : hasFilter
                ? `${partes.length} de ${allPartes.length} partes`
                : `${partes.length} parte${partes.length !== 1 ? "s" : ""}`}
            </CardTitle>
          </div>
          {!loading && partes.length > 0 && (
            <p className="text-xs text-muted-foreground">Haz clic en una fila para ver el detalle</p>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-11 rounded" />)}
            </div>
          ) : partes.length === 0 ? (
            <div className="py-16 text-center">
              <Factory className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {hasFilter ? "Sin partes con los filtros actuales." : "Aún no hay partes. Crea el primero arriba."}
              </p>
              {hasFilter && (
                <Button variant="link" size="sm" className="mt-2 text-xs"
                  onClick={() => setFilter({ search: "", estado: "todos", soloAlertas: false })}>
                  Limpiar filtros
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <ColHead label="Fecha"         sk="date" />
                    <ColHead label="Estado"        sk="estado" />
                    <ColHead label="Prod. real"    sk="produccion" right />
                    <ColHead label="Palets ajust." sk="palets" right />
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-left">% DJPMN</th>
                    <ColHead label="DJPMN (kg)"   sk="dsj_pct" right />
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap">Mermas</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap">T/h</th>
                    <th className="w-10" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-border/60">
                  {sorted.map((p) => {
                    const abs = Math.abs(p.cascade.dsj_pct);
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          "cursor-pointer transition-colors group",
                          abs > 5
                            ? "bg-destructive/[0.04] hover:bg-destructive/[0.08]"
                            : "hover:bg-muted/40"
                        )}
                        onClick={() => navigate(`/partes/${p.id}`)}
                      >
                        <td className="px-4 py-3 font-medium whitespace-nowrap">{formatDate(p.date)}</td>
                        <td className="px-4 py-3"><StatusBadge estado={p.estado} /></td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{formatKg(p.cascade.produccion_real)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatKg(p.cascade.palets_ajustados)}</td>
                        <td className="px-4 py-3"><DSJBar pct={p.cascade.dsj_pct} /></td>
                        <td className={cn(
                          "px-4 py-3 text-right tabular-nums font-semibold",
                          abs <= 3 ? "text-success" : abs <= 5 ? "text-warning" : "text-destructive"
                        )}>
                          {formatKg(p.cascade.dsj)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatKg(p.cascade.mermas_totales)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground text-xs">
                          {p.cascade.tph_promedio ? `${p.cascade.tph_promedio.toFixed(1)} T/h` : "—"}
                        </td>
                        <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon"
                                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {sorted.length > 1 && (
                  <tfoot className="border-t-2 border-border bg-muted/60">
                    <tr>
                      <td className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" colSpan={2}>
                        Total ({sorted.length} partes)
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold">{formatKg(totals.produccion_real)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-muted-foreground">{formatKg(totals.palets_ajustados)}</td>
                      <td className="px-4 py-3"><DSJBar pct={totals.dsj_pct} /></td>
                      <td className={cn(
                        "px-4 py-3 text-right tabular-nums font-bold",
                        dsjAbs <= 3 ? "text-success" : dsjAbs <= 5 ? "text-warning" : "text-destructive"
                      )}>
                        {formatKg(totals.dsj)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground font-semibold">{formatKg(totals.mermas_totales)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground text-xs">—</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
