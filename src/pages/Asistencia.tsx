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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar as DatePickerCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Plus, Trash2, Upload, ChevronLeft, ChevronRight, UserCheck, UserX,
  Users, AlertCircle, Calendar as CalendarIcon, CalendarDays, Search, BarChart3, Eraser,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";
import type { TrabajadorRow } from "@/lib/types";
import {
  buildAttendanceRecords,
  extractDailyAttendanceNames,
  extractWeeklyAttendance,
} from "@/lib/asistenciaImport";
import {
  RENDIMIENTO_GRUPOS,
  calcularRendimientoPersonas,
  calcularRendimientoGrupos,
  etiquetaTipoCoste,
  produccionRealParte,
  totalKgRendimiento,
  totalPersonasRendimiento,
} from "@/lib/asistenciaRendimiento";

const GRUPOS = ["Encargadas", "Produccion", "Aereo", "Tria podrido", "Punta", "Volcador", "Mecanica", "Mantenimiento", "Envasadoras", "Mallas", "Carretilla", "Graneleras", "Mozos", "Carga y descarga"];

function formatKg(value: number) {
  return new Intl.NumberFormat("es-ES").format(Math.round(value));
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// ─── KPI Stat Cards ───────────────────────────────────────────────────────────

function KPIStatCards({ presentes, ausentes, bajas, total, asistenciaPct }: {
  presentes: number; ausentes: number; bajas: number; total: number; asistenciaPct: number;
}) {
  const items = [
    { label: "Presentes", value: presentes, color: "text-success", icon: UserCheck, bg: "bg-success/10", border: "border-success/30", trend: `${asistenciaPct}% asistencia` },
    { label: "Ausentes", value: ausentes, color: "text-muted-foreground", icon: UserX, bg: "bg-[var(--glass-bg)]", border: "border-[var(--glass-border)]", trend: null },
    { label: "Bajas", value: bajas, color: "text-warning", icon: AlertCircle, bg: "bg-warning/10", border: "border-warning/30", trend: null },
    { label: "Total activos", value: total, color: "text-info", icon: Users, bg: "bg-info/10", border: "border-info/30", trend: null },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {items.map((item) => (
        <Card key={item.label} className="glass-accented overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-1.5">
                <p className="panel-kicker">{item.label}</p>
                <p className={cn("text-3xl font-semibold tabular-nums", item.color)}>{item.value}</p>
              </div>
              <div className={cn("rounded-xl border p-2", item.bg, item.border)}>
                <item.icon className={cn("h-5 w-5", item.color)} />
              </div>
            </div>
            {item.trend && (
              <p className="text-xs text-muted-foreground mt-2">{item.trend}</p>
            )}
            {item.label === "Presentes" && total > 0 && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                <div className={cn("h-full rounded-full", presentes > 0 ? "bg-success" : "bg-transparent")} style={{ width: `${asistenciaPct}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function AsistenciaDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="glass glass-hover h-9 min-w-[154px] justify-start gap-2 rounded-xl border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] px-3 text-sm font-semibold"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-primary/75" />
          <span className="tabular-nums">
            {selected ? format(selected, "dd MMM yyyy", { locale: es }) : "Seleccionar..."}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 glass-accented" align="end">
        <DatePickerCalendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) onChange(format(date, "yyyy-MM-dd"));
          }}
          locale={es}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export default function Asistencia() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trabajadores, setTrabajadores] = useState<TrabajadorRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(today());
  const [asistencia, setAsistencia] = useState<Record<string, boolean>>({});
  const [loadingTrabajadores, setLoadingTrabajadores] = useState(true);
  const [loadingAsistencia, setLoadingAsistencia] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerZona, setNewWorkerZona] = useState("");
  const [showWorkerList, setShowWorkerList] = useState(false);
  const [importingMode, setImportingMode] = useState<"daily" | "weekly" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [parteDelDia, setParteDelDia] = useState<Record<string, unknown> | null>(null);
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
    if (!user) return;
    setLoadingAsistencia(true);
    const { data, error } = await supabase
      .from("asistencia_detalle")
      .select("trabajador_id, presente")
      .eq("date", date)
      .eq("user_id", user.id);
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
      .select("id, resumen_ia, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
      .eq("date", date)
      .maybeSingle();
    if (!error && data) {
      const { data: productoDia } = await supabase
        .from("producto_dia")
        .select("linea, producto, formato_caja, kg, n_cajas, grupo_destino")
        .eq("part_id", data.id);
      setParteDelDia({ ...data, producto_dia: productoDia ?? [] });
    }
    setLoadingParte(false);
  }

  useEffect(() => { loadTrabajadores(); loadEficiencia(); }, []);
  useEffect(() => { loadAsistencia(selectedDate); }, [selectedDate, user]);
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
        { onConflict: "user_id,date,trabajador_id" }
      );

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      loadAsistencia(selectedDate);
    }
  }

  async function limpiarAsistenciaDia() {
    if (!user) return;

    const previous = asistencia;
    setAsistencia({});

    const { error } = await supabase
      .from("asistencia_detalle")
      .delete()
      .eq("user_id", user.id)
      .eq("date", selectedDate);

    if (error) {
      setAsistencia(previous);
      toast({ title: "Error", description: error.message, variant: "destructive" });
      loadAsistencia(selectedDate);
      return;
    }

    toast({ title: "Asistencia del día limpiada" });
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
      .upsert(records, { onConflict: "user_id,date,trabajador_id" });
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

  const importing = importingMode !== null;

  const handleDailyImportXLSX = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingMode("daily");

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rowsAll: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

      if (rowsAll.length < 2) {
        toast({ title: "Excel vacío o sin datos", variant: "destructive" });
        setImportingMode(null); e.target.value = ""; return;
      }

      const nombresImport = extractDailyAttendanceNames(rowsAll);
      if (nombresImport.length === 0) {
        toast({ title: "No se encontró columna 'Productor' o 'Nombre' en el Excel", variant: "destructive" });
        setImportingMode(null);
        e.target.value = "";
        return;
      }

      const activos = trabajadores.filter((t) => t.activo);
      if (!user) {
        setImportingMode(null);
        return;
      }

      const records = buildAttendanceRecords(nombresImport, activos, user.id, selectedDate);

      const { error } = await supabase
        .from("asistencia_detalle")
        .upsert(records, { onConflict: "user_id,date,trabajador_id" });

      if (error) throw error;

      await loadAsistencia(selectedDate);

      const presentes = records.filter((r) => r.presente).length;
      toast({
        title: `Diario importado — ${presentes} presentes de ${records.length} trabajadores`,
      });
    } catch (err: unknown) {
      toast({ title: "Error al importar", description: errorMessage(err), variant: "destructive" });
    }

    setImportingMode(null);
    e.target.value = "";
  }, [trabajadores, selectedDate, user]);

  const handleWeeklyImportXLSX = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingMode("weekly");

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const rowsBySheet = workbook.SheetNames.flatMap((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
      });

      const defaultYear = Number(selectedDate.slice(0, 4)) || new Date().getFullYear();
      const days = extractWeeklyAttendance(rowsBySheet, defaultYear);
      if (days.length === 0) {
        toast({ title: "No se encontraron fechas en el Excel", description: "Para importar semanal, el archivo debe incluir fechas visibles en cabeceras o bloques.", variant: "destructive" });
        setImportingMode(null);
        e.target.value = "";
        return;
      }

      const activos = trabajadores.filter((t) => t.activo);
      if (!user) {
        setImportingMode(null);
        return;
      }

      const records = days.flatMap((day) => buildAttendanceRecords(day.names, activos, user.id, day.date));
      if (records.length === 0) {
        toast({ title: "No hay registros para importar", variant: "destructive" });
        setImportingMode(null);
        e.target.value = "";
        return;
      }

      const { error } = await supabase
        .from("asistencia_detalle")
        .upsert(records, { onConflict: "user_id,date,trabajador_id" });
      if (error) throw error;

      if (days.some((day) => day.date === selectedDate)) await loadAsistencia(selectedDate);

      const presentes = records.filter((record) => record.presente).length;
      toast({
        title: `Semanal importado — ${days.length} día(s) detectado(s)`,
        description: `${presentes} presentes guardados sobre ${records.length} registros.`,
      });
    } catch (err: unknown) {
      toast({ title: "Error al importar semanal", description: errorMessage(err), variant: "destructive" });
    }

    setImportingMode(null);
    e.target.value = "";
  }, [trabajadores, selectedDate, user]);

  // ─── Date navigation ──────────────────────────────────────────────────

  function shiftDate(delta: number) {
    const d = new Date(`${selectedDate}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setSelectedDate(format(d, "yyyy-MM-dd"));
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

  const rendimientoGrupos = useMemo(
    () => calcularRendimientoGrupos({ parte: parteDelDia, trabajadores: activos, asistencia }),
    [parteDelDia, activos, asistencia]
  );

  const totalKg = totalKgRendimiento(rendimientoGrupos);
  const kgCalibrador = produccionRealParte(parteDelDia) || Number(parteDelDia?.kg_produccion_calibrador) || 0;
  const totalPersonas = totalPersonasRendimiento(rendimientoGrupos);
  const rendimientoPersonas = useMemo(
    () => calcularRendimientoPersonas({
      trabajadores: activos,
      asistencia,
      grupos: rendimientoGrupos,
      kgGeneralBase: kgCalibrador || totalKg,
    }),
    [activos, asistencia, kgCalibrador, rendimientoGrupos, totalKg]
  );
  const rendimientoPersonaById = useMemo(
    () => new Map(rendimientoPersonas.map((persona) => [persona.id, persona])),
    [rendimientoPersonas]
  );
  const presentesTratamiento = rendimientoPersonas.filter((persona) => persona.presente && persona.tipoCoste === "tratamiento").length;
  const presentesGenerales = rendimientoPersonas.filter((persona) => persona.presente && (persona.tipoCoste === "general" || persona.tipoCoste === "sin_grupo")).length;
  const presentesNoComputan = rendimientoPersonas.filter((persona) => persona.presente && !persona.cuentaKgPersona).length;
  const presentesKgPersona = rendimientoPersonas.filter((persona) => persona.presente && persona.cuentaKgPersona).length;
  const kgGeneralPersona = presentesKgPersona > 0 ? (kgCalibrador || totalKg) / presentesKgPersona : 0;

  // ─── Eficiencia histórica ──────────────────────────────────────────────

  interface EficienciaRow {
    rango: string;
    dias: number;
    kgMedia: number;
    kgPorPersona: number;
  }

  const [eficiencia, setEficiencia] = useState<EficienciaRow[]>([]);
  const [loadingEficiencia, setLoadingEficiencia] = useState(false);

  async function loadEficiencia() {
    setLoadingEficiencia(true);
    const until = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: attendance } = await supabase
      .from("asistencia_detalle")
      .select("date, presente")
      .gte("date", from)
      .lte("date", until);

    const dayWorkers: Record<string, number> = {};
    for (const r of attendance ?? []) {
      if (r.presente) dayWorkers[r.date] = (dayWorkers[r.date] ?? 0) + 1;
    }

    const { data: production } = await supabase
      .from("partes_diarios")
      .select("date, resumen_ia, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
      .gte("date", from)
      .lte("date", until);

    const kgByDay: Record<string, number> = {};
    for (const r of production ?? []) {
      const kg = produccionRealParte(r) || Number(r.kg_produccion_calibrador) || 0;
      if (kg > 0) kgByDay[r.date] = (kgByDay[r.date] ?? 0) + kg;
    }

    const buckets: Record<string, { days: number; totalKg: number; totalWorkers: number }> = {};
    for (const [date, workers] of Object.entries(dayWorkers)) {
      const kg = kgByDay[date] ?? 0;
      if (kg === 0) continue;
      let bucket: string;
      if (workers <= 5) bucket = "1–5";
      else if (workers <= 10) bucket = "6–10";
      else if (workers <= 15) bucket = "11–15";
      else if (workers <= 20) bucket = "16–20";
      else if (workers <= 25) bucket = "21–25";
      else bucket = "26+";
      if (!buckets[bucket]) buckets[bucket] = { days: 0, totalKg: 0, totalWorkers: 0 };
      buckets[bucket].days++;
      buckets[bucket].totalKg += kg;
      buckets[bucket].totalWorkers += workers;
    }

    const result = Object.entries(buckets)
      .sort(([a], [b]) => {
        const aMin = parseInt(a.replace(/\D/g, "")) || 0;
        const bMin = parseInt(b.replace(/\D/g, "")) || 0;
        return aMin - bMin;
      })
      .map(([rango, data]) => ({
        rango,
        dias: data.days,
        kgMedia: data.days > 0 ? data.totalKg / data.days : 0,
        kgPorPersona: data.totalWorkers > 0 ? data.totalKg / data.totalWorkers : 0,
      }));
    setEficiencia(result);
    setLoadingEficiencia(false);
  }

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
            <CalendarIcon className="h-4 w-4" />
            <span className="capitalize">{fechaDisplay}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/costes/asistencia/comparativa")} className="glass glass-hover">
            <BarChart3 className="h-4 w-4 mr-1" /> Comparativa
          </Button>
          <Dialog open={showWorkerList} onOpenChange={setShowWorkerList}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="glass glass-hover">
                <Users className="h-4 w-4 mr-1" /> Gestionar
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Lista de trabajadores</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
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
                    <Select
                      value={newWorkerZona || "__none__"}
                      onValueChange={(v) => setNewWorkerZona(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Sin grupo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sin grupo</SelectItem>
                        {GRUPOS.map((z) => (
                          <SelectItem key={z} value={z}>{z}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={addTrabajador} disabled={!newWorkerName.trim()} className="h-10 glass glass-hover">
                    <Plus className="h-4 w-4 mr-1" /> Añadir
                  </Button>
                </div>
                {loadingTrabajadores ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                  </div>
                ) : (
                  <div className="glass rounded-xl overflow-hidden">
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
                            <TableRow key={`h-${grupo}`} className="bg-[var(--glass-bg-strong)]">
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
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" onClick={() => shiftDate(-1)} className="glass glass-hover">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <AsistenciaDatePicker value={selectedDate} onChange={setSelectedDate} />
          <Button variant="outline" size="sm" onClick={() => shiftDate(1)} className="glass glass-hover">
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
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_460px] gap-6 items-start">
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
                <Button variant="outline" size="sm" disabled={!user} onClick={marcarTodosPresentes} className="glass glass-hover">
                  <UserCheck className="h-4 w-4 mr-1.5" /> Todos presentes
                </Button>
                <Button variant="outline" size="sm" disabled={!user || sinRegistro === totalActivos} onClick={limpiarAsistenciaDia} className="glass glass-hover">
                  <Eraser className="h-4 w-4 mr-1.5" /> Limpiar día
                </Button>
                <label className="relative">
                  <input type="file" accept=".xlsx,.xls" className="absolute inset-0 opacity-0 cursor-pointer peer" onChange={handleDailyImportXLSX} disabled={importing} />
                  <Button variant="outline" size="sm" disabled={importing} asChild className="glass transition-shadow duration-300 peer-hover:shadow-[var(--glass-shadow),var(--glass-glow)]">
                    <span className="cursor-pointer">
                      <Upload className="h-4 w-4 mr-1.5" />
                      {importingMode === "daily" ? "Importando…" : "Importar diario"}
                    </span>
                  </Button>
                </label>
                <label className="relative">
                  <input type="file" accept=".xlsx,.xls" className="absolute inset-0 opacity-0 cursor-pointer peer" onChange={handleWeeklyImportXLSX} disabled={importing} />
                  <Button variant="outline" size="sm" disabled={importing} asChild className="glass transition-shadow duration-300 peer-hover:shadow-[var(--glass-shadow),var(--glass-glow)]">
                    <span className="cursor-pointer">
                      <CalendarDays className="h-4 w-4 mr-1.5" />
                      {importingMode === "weekly" ? "Importando…" : "Importar semanal"}
                    </span>
                  </Button>
                </label>
              </div>

              {/* Stats summary */}
              <div className="mb-6 grid gap-3 glass p-3 text-sm sm:grid-cols-4">
                <span className="inline-flex items-center gap-1.5 text-success font-medium">
                  <UserCheck className="h-4 w-4" /> {presentesCount} presentes
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground font-medium">
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
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                            {workers.map((t) => {
                              const presente = asistencia[t.id];
                              const rendimientoPersona = rendimientoPersonaById.get(t.id);
                              return (
                                <div
                                  key={t.id}
                                  className={cn(
                                    "flex min-h-[74px] items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] px-4 py-3 transition-colors shadow-[var(--glass-shadow)] bg-[var(--glass-bg)]",
                                    presente === true && "bg-success/10 border-success/30",
                                    presente === false && "bg-destructive/10 border-destructive/30",
                                    presente === undefined && "border-[var(--glass-border)] bg-[var(--glass-bg)]",
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="line-clamp-2 text-base font-semibold leading-snug">{t.nombre}</p>
                                    {t.zona && (
                                      <p className="text-xs text-muted-foreground truncate mt-0.5">{t.zona}</p>
                                    )}
                                    {presente === true && rendimientoPersona?.cuentaKgPersona && rendimientoPersona.kgReferenciaPersona > 0 && (
                                      <p className="mt-1 text-xs font-semibold tabular-nums text-primary">
                                        {formatKg(rendimientoPersona.kgReferenciaPersona)} kg/p ref.
                                      </p>
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
            <Card className="glass-strong border">
              <CardContent className="p-5">
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
                </div>
              </CardContent>
            </Card>
          ) : parteDelDia ? (
            <>
            <div className="hidden" aria-hidden="true">
              <CardContent className="p-5 space-y-4">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Rendimiento por grupo directo</h3>
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
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>Total producción (calibrador)</span>
                    <span className="font-semibold tabular-nums">{new Intl.NumberFormat("es-ES").format(Math.round(kgCalibrador))} kg</span>
                  </div>
                </div>
              </CardContent>
            </div>
            <Card className="glass-strong border">
              <CardHeader className="pb-3 px-5 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-semibold">Kg/persona y coste operativo</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Produccion por grupos directos y personas que entran como linea o coste general.
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {formatKg(kgGeneralPersona)} kg/p
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-5">
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                    <p className="panel-kicker">Directas</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{totalPersonas}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                    <p className="panel-kicker">Tratamiento</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{presentesTratamiento}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                    <p className="panel-kicker">General</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{presentesGenerales}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                    <p className="panel-kicker">No kg/p</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{presentesNoComputan}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {RENDIMIENTO_GRUPOS.map((label) => {
                    const data = rendimientoGrupos[label];
                    const kgPersona = data.personas > 0 ? data.kg / data.personas : 0;
                    const maxKg = Math.max(...RENDIMIENTO_GRUPOS.map((grupo) => rendimientoGrupos[grupo].kg), 1);
                    return (
                      <div key={label} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{label}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatKg(data.kg)} kg / {data.personas} pers / {formatKg(kgPersona)} kg/p
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, (data.kg / maxKg) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] overflow-hidden">
                  <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Lista kg/persona</p>
                    <span className="text-xs text-muted-foreground">{rendimientoPersonas.length} trabajadoras</span>
                  </div>
                  <div className="max-h-[360px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Trabajadora</TableHead>
                          <TableHead className="text-xs">Coste</TableHead>
                          <TableHead className="text-right text-xs">Kg dir.</TableHead>
                          <TableHead className="text-right text-xs">Kg ref.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rendimientoPersonas.map((persona) => (
                          <TableRow key={persona.id} className={cn(!persona.presente && "opacity-50")}>
                            <TableCell className="py-2">
                              <p className="text-sm font-semibold leading-tight">{persona.nombre}</p>
                              <p className="text-[11px] text-muted-foreground">{persona.zona}</p>
                            </TableCell>
                            <TableCell className="py-2">
                              <Badge variant={persona.tipoCoste === "grupo" ? "default" : "secondary"} className="text-[11px]">
                                {etiquetaTipoCoste(persona.tipoCoste)}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2 text-right text-xs font-semibold tabular-nums">
                              {persona.presente && persona.cuentaKgPersona ? formatKg(persona.kgDirectosPersona) : "-"}
                            </TableCell>
                            <TableCell className="py-2 text-right text-xs font-semibold tabular-nums text-primary">
                              {persona.presente && persona.cuentaKgPersona ? formatKg(persona.kgReferenciaPersona) : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div className="flex justify-between items-center border-t border-[var(--glass-border)] pt-3 text-xs text-muted-foreground">
                  <span>Total produccion real</span>
                  <span className="font-semibold tabular-nums">{formatKg(kgCalibrador || totalKg)} kg</span>
                </div>
              </CardContent>
            </Card>
            </>
          ) : null}


        </div>
      </div>
    </div>
  );
}
