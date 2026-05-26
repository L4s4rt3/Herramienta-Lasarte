import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Upload, ChevronLeft, ChevronRight, UserCheck, UserX,
  Users, AlertCircle, Calendar, Search, Download,
} from "lucide-react";
import { today } from "@/lib/format";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import type { TrabajadorRow } from "@/lib/types";

const GRUPOS = ["Encargadas", "Produccion", "Aereo", "Tria podrido", "Punta", "Volcador", "Mecanica", "Envasadoras", "Mallas", "Carretilla", "Graneleras", "Mozos", "Carga y descarga"];

// ─── KPI Stat Cards ───────────────────────────────────────────────────────────

function KPIStatCards({ presentes, ausentes, bajas, total, asistenciaPct }: {
  presentes: number; ausentes: number; bajas: number; total: number; asistenciaPct: number;
}) {
  const items = [
    { label: "Presentes", value: presentes, color: "text-emerald-600", icon: UserCheck, bg: "bg-emerald-50", border: "border-emerald-200", trend: `${asistenciaPct}% asistencia` },
    { label: "Ausentes", value: ausentes, color: "text-slate-500", icon: UserX, bg: "bg-slate-50", border: "border-slate-200", trend: null },
    { label: "Bajas", value: bajas, color: "text-amber-600", icon: AlertCircle, bg: "bg-amber-50", border: "border-amber-200", trend: null },
    { label: "Total activos", value: total, color: "text-sky-600", icon: Users, bg: "bg-sky-50", border: "border-sky-200", trend: null },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {items.map((item) => (
        <Card key={item.label} className={cn("overflow-hidden", item.border)}>
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-1.5">
                <p className="panel-kicker">{item.label}</p>
                <p className={cn("text-3xl font-semibold tabular-nums", item.color)}>{item.value}</p>
              </div>
              <div className={cn("rounded-lg border p-2", item.bg, item.border)}>
                <item.icon className={cn("h-5 w-5", item.color)} />
              </div>
            </div>
            {item.trend && (
              <p className="text-xs text-muted-foreground mt-2">{item.trend}</p>
            )}
            {item.label === "Presentes" && total > 0 && (
              <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", presentes > 0 ? "bg-emerald-500" : "bg-transparent")} style={{ width: `${asistenciaPct}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Asistencia() {
  const { user } = useAuth();
  const [trabajadores, setTrabajadores] = useState<TrabajadorRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(today());
  const [asistencia, setAsistencia] = useState<Record<string, boolean>>({});
  const [loadingTrabajadores, setLoadingTrabajadores] = useState(true);
  const [loadingAsistencia, setLoadingAsistencia] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerZona, setNewWorkerZona] = useState("");
  const [showWorkerList, setShowWorkerList] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [parteDelDia, setParteDelDia] = useState<any>(null);
  const [loadingParte, setLoadingParte] = useState(false);

  // ─── Load trabajadores ──────────────────────────────────────────────────

  async function loadTrabajadores() {
    setLoadingTrabajadores(true);
    const { data, error } = await supabase
      .from("trabajadores")
      .select("*")
      .order("nombre", { ascending: true });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setTrabajadores(data ?? []);
    }
    setLoadingTrabajadores(false);
  }

  // ─── Load asistencia for date ──────────────────────────────────────────

  async function loadAsistencia(date: string) {
    setLoadingAsistencia(true);
    const { data, error } = await supabase
      .from("asistencia_detalle")
      .select("trabajador_id, presente")
      .eq("date", date);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      const map: Record<string, boolean> = {};
      for (const r of data ?? []) {
        map[r.trabajador_id] = r.presente;
      }
      setAsistencia(map);
    }
    setLoadingAsistencia(false);
  }

  // ─── Load parte del día ──────────────────────────────────────────────────

  async function loadParteDelDia(date: string) {
    setLoadingParte(true);
    setParteDelDia(null);
    const { data, error } = await supabase
      .from("partes_diarios")
      .select("resumen_ia, kg_produccion_calibrador")
      .eq("date", date)
      .maybeSingle();
    if (!error && data) {
      setParteDelDia(data);
    }
    setLoadingParte(false);
  }

  useEffect(() => { loadTrabajadores(); }, []);
  useEffect(() => { loadAsistencia(selectedDate); }, [selectedDate]);
  useEffect(() => { loadParteDelDia(selectedDate); }, [selectedDate]);

  // ─── Worker CRUD ───────────────────────────────────────────────────────

  async function addTrabajador() {
    if (!user || !newWorkerName.trim()) return;
    const { error } = await supabase.from("trabajadores").insert({
      user_id: user.id,
      nombre: newWorkerName.trim(),
      zona: newWorkerZona || null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setNewWorkerName("");
    setNewWorkerZona("");
    loadTrabajadores();
  }

  async function toggleTrabajadorActivo(t: TrabajadorRow) {
    const { error } = await supabase
      .from("trabajadores")
      .update({ activo: !t.activo })
      .eq("id", t.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setTrabajadores((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, activo: !x.activo } : x))
    );
  }

  async function deleteTrabajador(id: string) {
    const { error } = await supabase.from("trabajadores").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setTrabajadores((prev) => prev.filter((x) => x.id !== id));
  }

  // ─── Asistencia CRUD ──────────────────────────────────────────────────

  async function toggleAsistencia(trabajadorId: string, presente: boolean) {
    if (!user) return;

    setAsistencia((prev) => ({ ...prev, [trabajadorId]: presente }));

    const { error } = await supabase
      .from("asistencia_detalle")
      .upsert(
        {
          user_id: user.id,
          date: selectedDate,
          trabajador_id: trabajadorId,
          presente,
        },
        { onConflict: "date, trabajador_id" }
      );

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      loadAsistencia(selectedDate);
    }
  }

  async function marcarTodosPresentes() {
    if (!user) return;
    const activos = trabajadores.filter((t) => t.activo);
    const records = activos.map((t) => ({
      user_id: user.id,
      date: selectedDate,
      trabajador_id: t.id,
      presente: true,
    }));
    const { error } = await supabase
      .from("asistencia_detalle")
      .upsert(records, { onConflict: "date, trabajador_id" });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    const map: Record<string, boolean> = {};
    for (const t of activos) map[t.id] = true;
    setAsistencia(map);
    toast({ title: "Todos marcados como presentes" });
  }

  // ─── XLSX Import ──────────────────────────────────────────────────────

  const handleImportXLSX = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rowsAll: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

      if (rowsAll.length < 2) {
        toast({ title: "Excel vacío o sin datos", variant: "destructive" });
        setImporting(false); e.target.value = ""; return;
      }

      const header = rowsAll[0] ?? [];
      let colIdx: number | null = null;
      for (let i = 0; i < header.length; i++) {
        const h = String(header[i] ?? "").toLowerCase().trim();
        if (/productor|nombre/.test(h)) { colIdx = i; break; }
      }
      if (colIdx === null) {
        toast({ title: "No se encontró columna 'Productor' o 'Nombre' en el Excel", variant: "destructive" });
        setImporting(false); e.target.value = ""; return;
      }

      const nombresImport: string[] = [];
      for (let i = 1; i < rowsAll.length; i++) {
        const cell = rowsAll[i]?.[colIdx];
        const nombre = String(cell ?? "").trim();
        if (nombre && !nombresImport.includes(nombre)) nombresImport.push(nombre);
      }

      if (nombresImport.length === 0) {
        toast({ title: "El archivo no contiene nombres", variant: "destructive" });
        setImporting(false);
        e.target.value = "";
        return;
      }

      const activos = trabajadores.filter((t) => t.activo);
      if (!user) return;

      const cleanName = (s: string) => {
        const corruptMap: Record<string, string> = {
          '\u01ed': 'A', '\u01ec': 'A',
          '\u01f8': 'E', '\u01f9': 'E',
          '\u01d0': 'I', '\u01cf': 'I',
        };
        let r = s;
        for (const [k, v] of Object.entries(corruptMap)) r = r.split(k).join(v);
        return r.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[,\u00ad]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
      };
      const wordSet = (s: string) => cleanName(s).split(" ").filter(w => w.length >= 2).sort();
      const wordsMatch = (a: string, b: string) => {
        if (a === b || a.includes(b) || b.includes(a)) return true;
        let prefixLen = 0;
        const minLen = Math.min(a.length, b.length);
        for (let i = 0; i < minLen; i++) { if (a[i] === b[i]) prefixLen++; else break; }
        return prefixLen >= 4;
      };
      const matchScore = (excelName: string, dbName: string) => {
        const eWords = wordSet(excelName);
        const dWords = wordSet(dbName);
        if (!eWords.length || !dWords.length) return 0;
        let hits = 0;
        for (const dw of dWords) {
          if (eWords.some(ew => wordsMatch(ew, dw))) hits++;
        }
        return hits / dWords.length;
      };

      const records = activos.map((t) => {
        const matched = nombresImport.some((n) => {
          const score = matchScore(n, t.nombre);
          const eWords = wordSet(n);
          const need = Math.min(eWords.length, 2) / Math.max(eWords.length, 1);
          return score >= Math.max(0.5, need);
        });
        return {
          user_id: user.id,
          date: selectedDate,
          trabajador_id: t.id,
          presente: matched,
        };
      });

      const { error } = await supabase
        .from("asistencia_detalle")
        .upsert(records, { onConflict: "date, trabajador_id" });

      if (error) throw error;

      await loadAsistencia(selectedDate);

      const presentes = records.filter((r) => r.presente).length;
      toast({
        title: `Importado — ${presentes} presentes de ${records.length} trabajadores`,
      });
    } catch (err: any) {
      toast({ title: "Error al importar", description: err.message, variant: "destructive" });
    }

    setImporting(false);
    e.target.value = "";
  }, [trabajadores, selectedDate, user]);

  // ─── Date navigation ──────────────────────────────────────────────────

  function shiftDate(delta: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().slice(0, 10));
  }

  // ─── Computed ─────────────────────────────────────────────────────────

  const activos = trabajadores.filter((t) => t.activo);
  const totalActivos = activos.length;
  const presentesCount = activos.filter((t) => asistencia[t.id] === true).length;
  const ausentesCount = activos.filter(
    (t) => asistencia[t.id] === false
  ).length;
  const sinRegistro = activos.filter((t) => asistencia[t.id] === undefined).length;
  const asistenciaPct = totalActivos > 0 ? Math.round((presentesCount / totalActivos) * 100) : 0;
  const bajas = trabajadores.filter((t) => !t.activo).length;

  // ─── Rendimiento por grupo (producto_detalle) ────────────────────────────

  function classificarProducto(producto: string): "Envasadoras" | "Mallas" | "Graneleras" | null {
    const upper = producto.toUpperCase();
    const isMdna = upper.includes("MDNA") || upper.includes("MERCADONA");
    const isGranel = upper.includes("GRANEL");
    const isExcluded =
      upper.includes("INDUSTRIA GENERADA") ||
      upper.includes("PODRIDO") ||
      upper.includes("MUESTRA");
    if (isExcluded) return null;
    if (!isMdna) return "Envasadoras";
    if (isGranel) return "Graneleras";
    return "Mallas";
  }

  interface GrupoRendimiento {
    kg: number;
    personas: number;
  }

  const rendimientoGrupos = useMemo<Record<string, GrupoRendimiento>>(() => {
    const grupos: Record<string, GrupoRendimiento> = {
      Envasadoras: { kg: 0, personas: 0 },
      Mallas: { kg: 0, personas: 0 },
      Graneleras: { kg: 0, personas: 0 },
    };

    const detalle = (parteDelDia as any)?.resumen_ia?.producto_detalle;
    if (Array.isArray(detalle)) {
      for (const item of detalle) {
        const grupo = classificarProducto(item.producto ?? "");
        if (grupo) {
          grupos[grupo].kg += Number(item.kg ?? 0);
        }
      }
    }

    for (const t of activos) {
      if (asistencia[t.id] === true && t.zona && grupos[t.zona]) {
        grupos[t.zona].personas++;
      }
    }

    return grupos;
  }, [parteDelDia, trabajadores, asistencia]);

  const totalKg = rendimientoGrupos.Envasadoras.kg + rendimientoGrupos.Mallas.kg + rendimientoGrupos.Graneleras.kg;
  const totalPersonas = rendimientoGrupos.Envasadoras.personas + rendimientoGrupos.Mallas.personas + rendimientoGrupos.Graneleras.personas;

  // ─── Grouping helper ─────────────────────────────────────────────────

  function groupByZona(workers: TrabajadorRow[]) {
    const groups: Record<string, TrabajadorRow[]> = {};
    const noGroup: TrabajadorRow[] = [];
    for (const w of workers) {
      if (w.zona && GRUPOS.includes(w.zona)) {
        if (!groups[w.zona]) groups[w.zona] = [];
        groups[w.zona].push(w);
      } else {
        noGroup.push(w);
      }
    }
    const ordered: { grupo: string; workers: TrabajadorRow[] }[] = [];
    for (const g of GRUPOS) {
      if (groups[g]) ordered.push({ grupo: g, workers: groups[g] });
    }
    if (noGroup.length > 0) ordered.push({ grupo: "Sin grupo", workers: noGroup });
    return ordered;
  }

  const fechaDisplay = new Date(selectedDate + "T12:00:00").toLocaleDateString(
    "es-ES",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" }
  );

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="page-shell">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="page-header">
        <div>
          <h1 className="page-title">Asistencia</h1>
          <p className="page-subtitle flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            <span className="capitalize">{fechaDisplay}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => shiftDate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-36 h-9 text-sm text-center"
          />
          <Button variant="outline" size="sm" onClick={() => shiftDate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ── KPI Cards ───────────────────────────────────────────── */}
      <KPIStatCards
        presentes={presentesCount}
        ausentes={ausentesCount}
        bajas={bajas}
        total={totalActivos}
        asistenciaPct={asistenciaPct}
      />

      {/* ── Main Grid ───────────────────────────────────────────── */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        {/* Left: Attendance */}
        <div className="space-y-6">
          <Card>
            <CardContent className="p-5 sm:p-6">
              {/* Search + actions bar */}
              <div className="section-toolbar mb-6 shadow-none">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar trabajador…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 pl-9 text-sm"
                  />
                </div>
                <Button variant="outline" size="sm" disabled={!user} onClick={marcarTodosPresentes}>
                  <UserCheck className="h-4 w-4 mr-1.5" /> Todos presentes
                </Button>
                <label className="relative">
                  <Button variant="outline" size="sm" disabled={importing} asChild>
                    <span className="cursor-pointer">
                      <Upload className="h-4 w-4 mr-1.5" />
                      {importing ? "Importando…" : "Importar XLSX"}
                    </span>
                  </Button>
                  <input type="file" accept=".xlsx,.xls" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImportXLSX} disabled={importing} />
                </label>
              </div>

              {/* Stats summary */}
              <div className="mb-6 grid gap-3 rounded-lg border bg-muted/35 p-3 text-sm sm:grid-cols-4">
                <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                  <UserCheck className="h-4 w-4" /> {presentesCount} presentes
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-500 font-medium">
                  <UserX className="h-4 w-4" /> {ausentesCount} ausentes
                </span>
                {sinRegistro > 0 && (
                  <span className="text-muted-foreground">{sinRegistro} sin registro</span>
                )}
                <span className="text-muted-foreground">de {totalActivos} activos</span>
              </div>

              {/* Worker grid */}
              {loadingAsistencia ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : activos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Users className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm font-medium">Añade trabajadores activos</p>
                  <p className="text-xs mt-1">Gestiona la lista desde el panel lateral</p>
                </div>
              ) : (() => {
                const filtered = searchQuery
                  ? activos.filter(t => t.nombre.toLowerCase().includes(searchQuery.toLowerCase()))
                  : activos;
                const grouped = groupByZona(filtered);
                if (filtered.length === 0) return (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Search className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm font-medium">Sin resultados para "{searchQuery}"</p>
                  </div>
                );
                return (
                  <div className="space-y-5">
                    {grouped.map(({ grupo, workers }) => {
                      const presentes = workers.filter((w) => asistencia[w.id] === true).length;
                      const todosPresentes = presentes === workers.length;
                      return (
                        <div key={grupo}>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
                              {grupo}
                              <span className="ml-2 font-normal text-xs">
                                ({presentes}/{workers.length})
                              </span>
                            </h3>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs px-3"
                              onClick={() => {
                                for (const w of workers) {
                                  if (asistencia[w.id] !== true) toggleAsistencia(w.id, true);
                                }
                              }}
                              disabled={todosPresentes}
                            >
                              <UserCheck className="h-3.5 w-3.5 mr-1" />Todos
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                            {workers.map((t) => {
                              const presente = asistencia[t.id];
                              return (
                                <div
                                  key={t.id}
                                  className={cn(
                                    "flex items-center justify-between gap-2 rounded-xl border px-4 py-3 transition-colors shadow-sm",
                                    presente === true && "bg-emerald-50 border-emerald-200",
                                    presente === false && "bg-red-50 border-red-200",
                                    presente === undefined && "bg-card border-muted",
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold truncate">{t.nombre}</p>
                                    {t.zona && (
                                      <p className="text-xs text-muted-foreground truncate mt-0.5">{t.zona}</p>
                                    )}
                                  </div>
                                  <Switch
                                    checked={presente === true}
                                    onCheckedChange={(checked) => toggleAsistencia(t.id, checked)}
                                    className="shrink-0"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>

        {/* ── Right Column ──────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* ── Rendimiento por grupo ── */}
          {loadingParte ? (
            <Card className="shadow-sm border">
              <CardContent className="p-5">
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
                </div>
              </CardContent>
            </Card>
          ) : parteDelDia ? (
            <Card className="shadow-sm border">
              <CardContent className="p-5 space-y-4">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Rendimiento por grupo</h3>
                <div className="space-y-3 text-sm">
                  {([
                    { label: "Envasadoras", data: rendimientoGrupos.Envasadoras },
                    { label: "Mallas", data: rendimientoGrupos.Mallas },
                    { label: "Graneleras", data: rendimientoGrupos.Graneleras },
                  ] as const).map(({ label, data }) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">{label}</span>
                      <span className="font-semibold tabular-nums text-right">
                        {new Intl.NumberFormat("es-ES").format(Math.round(data.kg))} kg
                        <span className="text-muted-foreground font-normal mx-1">·</span>
                        {data.personas} pers
                        <span className="text-muted-foreground font-normal mx-1">·</span>
                        {new Intl.NumberFormat("es-ES").format(
                          Math.round(data.personas > 0 ? data.kg / data.personas : 0)
                        )} kg/p
                      </span>
                    </div>
                  ))}
                  <div className="border-t pt-3 flex justify-between items-center font-bold">
                    <span>Total directo</span>
                    <span className="tabular-nums">
                      {new Intl.NumberFormat("es-ES").format(Math.round(totalKg))} kg
                      <span className="text-muted-foreground font-normal mx-1">·</span>
                      {totalPersonas} pers
                      <span className="text-muted-foreground font-normal mx-1">·</span>
                      {new Intl.NumberFormat("es-ES").format(
                        Math.round(totalPersonas > 0 ? totalKg / totalPersonas : 0)
                      )} kg/p
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* ── Workers Reference List ── */}
          <Collapsible open={showWorkerList} onOpenChange={setShowWorkerList}>
            <Card className="shadow-sm border">
              <CardHeader className="flex flex-row items-center justify-between py-4 px-5">
                <CardTitle className="text-lg font-bold">Lista de trabajadores</CardTitle>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm">
                    {showWorkerList ? "Cerrar" : "Gestionar"}
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-4 px-5 pb-5">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Nombre</label>
                      <Input
                        placeholder="Nuevo trabajador"
                        value={newWorkerName}
                        onChange={(e) => setNewWorkerName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addTrabajador()}
                        className="h-10"
                      />
                    </div>
                    <div className="w-44">
                      <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Grupo</label>
                      <select
                        value={newWorkerZona}
                        onChange={(e) => setNewWorkerZona(e.target.value)}
                        className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                      >
                        <option value="">Sin grupo</option>
                        {GRUPOS.map((z) => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </div>
                    <Button onClick={addTrabajador} disabled={!newWorkerName.trim()} className="h-10">
                      <Plus className="h-4 w-4 mr-1" /> Añadir
                    </Button>
                  </div>

                  {loadingTrabajadores ? (
                    <div className="space-y-2">
                      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                    </div>
                  ) : (
                    <div className="border rounded-xl overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs font-bold uppercase">Nombre</TableHead>
                            <TableHead className="text-xs font-bold uppercase">Grupo</TableHead>
                            <TableHead className="text-xs font-bold uppercase">Estado</TableHead>
                            <TableHead className="w-24"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {trabajadores.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                Añade trabajadores para comenzar
                              </TableCell>
                            </TableRow>
                          ) : (
                            groupByZona(trabajadores).flatMap(({ grupo, workers }) => [
                              <TableRow key={`h-${grupo}`} className="bg-muted/50">
                                <TableCell colSpan={4} className="font-bold text-sm py-3">
                                  {grupo} <span className="text-muted-foreground font-normal">({workers.length})</span>
                                </TableCell>
                              </TableRow>,
                              ...workers.map((t) => (
                                <TableRow key={t.id} className={cn(!t.activo && "opacity-50")}>
                                  <TableCell className="font-semibold text-sm">{t.nombre}</TableCell>
                                  <TableCell className="text-muted-foreground text-sm">{t.zona ?? "—"}</TableCell>
                                  <TableCell>
                                    <Badge variant={t.activo ? "default" : "secondary"} className="text-xs">
                                      {t.activo ? "Activo" : "Inactivo"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9"
                                        onClick={() => toggleTrabajadorActivo(t)}
                                        title={t.activo ? "Desactivar" : "Activar"}
                                      >
                                        {t.activo ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 text-destructive"
                                        onClick={() => deleteTrabajador(t.id)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )),
                            ])
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
