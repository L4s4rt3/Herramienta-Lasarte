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
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Upload, ChevronLeft, ChevronRight, UserCheck, UserX,
} from "lucide-react";
import { today } from "@/lib/format";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import type { TrabajadorRow } from "@/lib/types";

const GRUPOS = ["Encargadas", "Produccion", "Aereo", "Tria podrido", "Punta", "Volcador", "Mecanica", "Envasadoras", "Mallas", "Carretilla", "Graneleras", "Mozos", "Carga y descarga"];

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

    // Sumar kg desde producto_detalle
    const detalle = (parteDelDia as any)?.resumen_ia?.producto_detalle;
    if (Array.isArray(detalle)) {
      for (const item of detalle) {
        const grupo = classificarProducto(item.producto ?? "");
        if (grupo) {
          grupos[grupo].kg += Number(item.kg ?? 0);
        }
      }
    }

    // Contar personas presentes por grupo
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
    <div className="p-4 md:p-6 mx-auto space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl">Asistencia</h1>
        <p className="text-sm text-muted-foreground">
          Gestión de trabajadores y control de asistencia diaria
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[1fr_300px] gap-6 items-start">

      {/* ── Left Column: Attendance ──────────────────────────────────── */}
      <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-base">Asistencia del día</CardTitle>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => shiftDate(-1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-32 h-7 text-xs text-center"
            />
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => shiftDate(1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-medium capitalize">{fechaDisplay}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {totalActivos > 0 && (
                <>
                  <span className="inline-flex items-center gap-0.5 text-green-600 font-medium">
                    <UserCheck className="h-3 w-3" />{presentesCount}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-destructive font-medium">
                    <UserX className="h-3 w-3" />{ausentesCount}
                  </span>
                  {sinRegistro > 0 && (
                    <span className="text-muted-foreground">? {sinRegistro}</span>
                  )}
                  <span className="text-muted-foreground">de {totalActivos}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative flex-1 min-w-[140px]">
              <Input
                placeholder="Buscar…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 text-xs pl-6"
              />
              <svg className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" disabled={!user} onClick={marcarTodosPresentes}>
              <UserCheck className="h-3 w-3 mr-1" /> Todos
            </Button>
            <label className="relative">
              <Button variant="outline" size="sm" className="h-7 text-xs px-2" disabled={importing} asChild>
                <span className="cursor-pointer">
                  <Upload className="h-3 w-3 mr-1" />
                  {importing ? "…" : "XLSX"}
                </span>
              </Button>
              <input type="file" accept=".xlsx,.xls" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImportXLSX} disabled={importing} />
            </label>
          </div>

          {loadingAsistencia ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : activos.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Añade trabajadores activos en la lista de referencia para registrar asistencia.
            </div>
          ) : (() => {
            const filtered = searchQuery
              ? activos.filter(t => t.nombre.toLowerCase().includes(searchQuery.toLowerCase()))
              : activos;
            const grouped = groupByZona(filtered);
            if (filtered.length === 0) return (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Sin resultados para &quot;{searchQuery}&quot;
              </div>
            );
            return (
              <div className="space-y-3">
                {grouped.map(({ grupo, workers }) => {
                  const presentes = workers.filter((w) => asistencia[w.id] === true).length;
                  const todosPresentes = presentes === workers.length;
                  return (
                    <div key={grupo}>
                      <div className="flex items-center justify-between mb-1.5 px-1">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {grupo}
                          <span className="ml-1.5 font-normal text-[10px]">
                            ({presentes}/{workers.length})
                          </span>
                        </h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px] px-2"
                          onClick={() => {
                            for (const w of workers) {
                              if (asistencia[w.id] !== true) toggleAsistencia(w.id, true);
                            }
                          }}
                          disabled={todosPresentes}
                        >
                          <UserCheck className="h-3 w-3 mr-1" />Todos
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-1.5">
                        {workers.map((t) => {
                          const presente = asistencia[t.id];
                          return (
                            <div
                              key={t.id}
                              className={cn(
                                "flex items-center justify-between gap-1 rounded-md border px-2.5 py-1.5 transition-colors",
                                presente === true && "bg-green-50 border-green-200",
                                presente === false && "bg-red-50 border-red-200",
                                presente === undefined && "bg-card",
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">{t.nombre}</p>
                                {t.zona && (
                                  <p className="text-[10px] text-muted-foreground truncate">{t.zona}</p>
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

      {/* ── Right Column ────────────────────────────────────────────── */}
      <div className="space-y-6">

      {/* ── Rendimiento por grupo ──────────────────────────────────────── */}
      {loadingParte ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Rendimiento por grupo</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          </CardContent>
        </Card>
      ) : parteDelDia ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Rendimiento por grupo</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Envasadoras:</span>
                <span className="font-mono tabular-nums">
                  {new Intl.NumberFormat("es-ES").format(Math.round(rendimientoGrupos.Envasadoras.kg))} kg &middot;{" "}
                  {rendimientoGrupos.Envasadoras.personas} pers &middot;{" "}
                  {new Intl.NumberFormat("es-ES").format(
                    Math.round(rendimientoGrupos.Envasadoras.personas > 0
                      ? rendimientoGrupos.Envasadoras.kg / rendimientoGrupos.Envasadoras.personas
                      : 0)
                  )} kg/pers
                </span>
              </div>
              <div className="flex justify-between">
                <span>Mallas:</span>
                <span className="font-mono tabular-nums">
                  {new Intl.NumberFormat("es-ES").format(Math.round(rendimientoGrupos.Mallas.kg))} kg &middot;{" "}
                  {rendimientoGrupos.Mallas.personas} pers &middot;{" "}
                  {new Intl.NumberFormat("es-ES").format(
                    Math.round(rendimientoGrupos.Mallas.personas > 0
                      ? rendimientoGrupos.Mallas.kg / rendimientoGrupos.Mallas.personas
                      : 0)
                  )} kg/pers
                </span>
              </div>
              <div className="flex justify-between">
                <span>Graneleras:</span>
                <span className="font-mono tabular-nums">
                  {new Intl.NumberFormat("es-ES").format(Math.round(rendimientoGrupos.Graneleras.kg))} kg &middot;{" "}
                  {rendimientoGrupos.Graneleras.personas} pers &middot;{" "}
                  {new Intl.NumberFormat("es-ES").format(
                    Math.round(rendimientoGrupos.Graneleras.personas > 0
                      ? rendimientoGrupos.Graneleras.kg / rendimientoGrupos.Graneleras.personas
                      : 0)
                  )} kg/pers
                </span>
              </div>
              <Separator className="my-1" />
              <div className="flex justify-between font-semibold">
                <span>Total directo:</span>
                <span className="font-mono tabular-nums">
                  {new Intl.NumberFormat("es-ES").format(Math.round(totalKg))} kg &middot;{" "}
                  {totalPersonas} pers &middot;{" "}
                  {new Intl.NumberFormat("es-ES").format(
                    Math.round(totalPersonas > 0 ? totalKg / totalPersonas : 0)
                  )} kg/pers
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Workers Reference List ─────────────────────────────────── */}
      <Collapsible open={showWorkerList} onOpenChange={setShowWorkerList}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Lista de trabajadores</CardTitle>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">
                {showWorkerList ? "Cerrar" : "Gestionar"}
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs text-muted-foreground mb-1 block">Nombre</label>
                  <Input
                    placeholder="Nuevo trabajador"
                    value={newWorkerName}
                    onChange={(e) => setNewWorkerName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addTrabajador()}
                  />
                </div>
                <div className="w-44">
                  <label className="text-xs text-muted-foreground mb-1 block">Grupo</label>
                  <select
                    value={newWorkerZona}
                    onChange={(e) => setNewWorkerZona(e.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">Sin grupo</option>
                    {GRUPOS.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
                <Button onClick={addTrabajador} disabled={!newWorkerName.trim()}>
                  <Plus className="h-4 w-4" /> Añadir
                </Button>
              </div>

              {loadingTrabajadores ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Grupo</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trabajadores.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                            Añade trabajadores para comenzar
                          </TableCell>
                        </TableRow>
                      ) : (
                        groupByZona(trabajadores).flatMap(({ grupo, workers }) => [
                          <TableRow key={`h-${grupo}`} className="bg-muted/50">
                            <TableCell colSpan={4} className="font-semibold text-sm py-2">
                              {grupo} <span className="text-muted-foreground font-normal">({workers.length})</span>
                            </TableCell>
                          </TableRow>,
                          ...workers.map((t) => (
                            <TableRow key={t.id} className={cn(!t.activo && "opacity-50")}>
                              <TableCell className="font-medium">{t.nombre}</TableCell>
                              <TableCell className="text-muted-foreground">{t.zona ?? "—"}</TableCell>
                              <TableCell>
                                <Badge variant={t.activo ? "default" : "secondary"}>
                                  {t.activo ? "Activo" : "Inactivo"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => toggleTrabajadorActivo(t)}
                                    title={t.activo ? "Desactivar" : "Activar"}
                                  >
                                    {t.activo ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive"
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
