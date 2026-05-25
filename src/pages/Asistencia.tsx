import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
  const [importing, setImporting] = useState(false);
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
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      const nombresImport: string[] = [];
      for (const row of rows) {
        const cell = row[0];
        if (typeof cell === "string" && cell.trim()) {
          nombresImport.push(cell.trim());
        }
      }

      if (nombresImport.length === 0) {
        toast({ title: "El archivo no contiene nombres", variant: "destructive" });
        setImporting(false);
        e.target.value = "";
        return;
      }

      const activos = trabajadores.filter((t) => t.activo);
      if (!user) return;

      toast({ title: `Filas: ${rows.length}, Nombres: ${nombresImport.length}` });
      const testScore = matchScore(nombresImport[0], activos[0]?.nombre || '');
      const testEWords = wordSet(nombresImport[0]).join(",");
      const testDWords = wordSet(activos[0]?.nombre || '').join(",");
      toast({ title: `Test: "${nombresImport[0]}" -> "${activos[0]?.nombre}" score=${testScore}`
        + ` eW=[${testEWords}] dW=[${testDWords}]` });

      function cleanName(s: string) {
        const corruptMap: Record<string, string> = {
          '\u01ed': 'A', '\u01ec': 'A',
          '\u01f8': 'E', '\u01f9': 'E',
          '\u01d0': 'I', '\u01cf': 'I',
        };
        let r = s;
        for (const [k, v] of Object.entries(corruptMap)) r = r.split(k).join(v);
        return r.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[,\u00ad]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
      }
      function wordSet(s: string) {
        return cleanName(s).split(" ").filter(w => w.length >= 2).sort();
      }
      function wordsMatch(a: string, b: string) {
        if (a === b || a.includes(b) || b.includes(a)) return true;
        let prefixLen = 0;
        const minLen = Math.min(a.length, b.length);
        for (let i = 0; i < minLen; i++) { if (a[i] === b[i]) prefixLen++; else break; }
        return prefixLen >= 4;
      }
      function matchScore(excelName: string, dbName: string) {
        const eWords = wordSet(excelName);
        const dWords = wordSet(dbName);
        if (!eWords.length || !dWords.length) return 0;
        let hits = 0;
        for (const dw of dWords) {
          if (eWords.some(ew => wordsMatch(ew, dw))) hits++;
        }
        return hits / dWords.length;
      }

      const records = activos.map((t) => {
        const matched = nombresImport.some((n) => {
          const score = matchScore(n, t.nombre);
          const eWords = wordSet(n);
          const need = Math.min(eWords.length, 2) / Math.max(eWords.length, 1);
          return score >= Math.max(0.5, need);
        });
        if (!matched) {
          const bestScore = Math.max(...nombresImport.map(n => matchScore(n, t.nombre)));
          const bestName = nombresImport.reduce((a, b) => matchScore(a, t.nombre) > matchScore(b, t.nombre) ? a : b);
          if (bestScore > 0) console.log("NO MATCH:", t.nombre, "-> mejor:", bestName, "score:", bestScore);
        }
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
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl">Asistencia</h1>
        <p className="text-sm text-muted-foreground">
          Gestión de trabajadores y control de asistencia diaria
        </p>
      </header>

      {/* ── Workers Reference List ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lista de trabajadores</CardTitle>
        </CardHeader>
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
      </Card>

      {/* ── Daily Attendance ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Asistencia del día</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => shiftDate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-40 h-8 text-center"
            />
            <Button variant="outline" size="sm" onClick={() => shiftDate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium capitalize">{fechaDisplay}</p>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              {totalActivos > 0 && (
                <>
                  <span className="inline-flex items-center gap-1 text-green-600">
                    <UserCheck className="h-3.5 w-3.5" />{presentesCount}
                  </span>
                  <span className="mx-1">·</span>
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <UserX className="h-3.5 w-3.5" />{ausentesCount}
                  </span>
                  {sinRegistro > 0 && (
                    <>
                      <span className="mx-1">·</span>
                      <span className="text-muted-foreground">? {sinRegistro} sin registro</span>
                    </>
                  )}
                  <span className="mx-1">·</span>
                  <span>{totalActivos} total</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!user}
              onClick={marcarTodosPresentes}
            >
              <UserCheck className="h-4 w-4" /> Marcar todos presentes
            </Button>
            <label className="relative">
              <Button variant="outline" size="sm" disabled={importing} asChild>
                <span className="cursor-pointer">
                  <Upload className="h-4 w-4" />
                  {importing ? "Importando…" : "Importar XLSX"}
                </span>
              </Button>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleImportXLSX}
                disabled={importing}
              />
            </label>
          </div>

          <Separator />

          {/* ── Rendimiento por grupo ──────────────────────────────────── */}
          {loadingParte ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
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

          {loadingAsistencia ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : activos.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Añade trabajadores activos en la lista de referencia para registrar asistencia.
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trabajador</TableHead>
                    <TableHead>Grupo</TableHead>
                    <TableHead>Asistencia</TableHead>
                    <TableHead className="w-24 text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupByZona(activos).flatMap(({ grupo, workers }) => {
                    const presentes = workers.filter((w) => asistencia[w.id] === true).length;
                    return [
                      <TableRow key={`h-${grupo}`} className="bg-muted/50">
                        <TableCell colSpan={4} className="font-semibold text-sm py-2">
                          {grupo} <span className="text-muted-foreground font-normal">({presentes}/{workers.length})</span>
                        </TableCell>
                      </TableRow>,
                      ...workers.map((t) => {
                        const presente = asistencia[t.id];
                        return (
                          <TableRow key={t.id}>
                            <TableCell className="font-medium">{t.nombre}</TableCell>
                            <TableCell className="text-muted-foreground">{t.zona ?? "—"}</TableCell>
                            <TableCell>
                              {presente === true && (
                                <Badge variant="default" className="bg-green-600">Presente</Badge>
                              )}
                              {presente === false && (
                                <Badge variant="destructive">Ausente</Badge>
                              )}
                              {presente === undefined && (
                                <Badge variant="secondary">Sin registrar</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    "h-8 w-8",
                                    presente === true && "bg-green-100 text-green-700"
                                  )}
                                  onClick={() => toggleAsistencia(t.id, true)}
                                  disabled={presente === true}
                                >
                                  <UserCheck className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    "h-8 w-8",
                                    presente === false && "bg-red-100 text-red-700"
                                  )}
                                  onClick={() => toggleAsistencia(t.id, false)}
                                  disabled={presente === false}
                                >
                                  <UserX className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }),
                    ];
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
