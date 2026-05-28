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
import {
  Plus, Trash2, Upload, ChevronLeft, ChevronRight, UserCheck, UserX,
  Users, AlertCircle, Calendar, Search, BarChart3,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { today } from "@/lib/format";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import type { TrabajadorRow } from "@/lib/types";

const GRUPOS = ["Encargadas", "Produccion", "Aereo", "Tria podrido", "Punta", "Volcador", "Mecanica", "Envasadoras", "Mallas", "Carretilla", "Graneleras", "Mozos", "Carga y descarga"];

const RENDIMIENTO_GRUPOS = ["Envasadoras", "Mallas", "Graneleras"] as const;
type RendimientoGrupoKey = typeof RENDIMIENTO_GRUPOS[number];

function num(value: unknown): number {
  return Number(value) || 0;
}

function produccionRealParte(parte: any): number {
  if (!parte) return 0;
  return (
    num(parte.kg_produccion_calibrador) +
    num(parte.kg_industria_manual) -
    num(parte.kg_mujeres_calibrador) -
    num(parte.kg_reciclado_malla_z1) -
    num(parte.kg_reciclado_malla_z2)
  );
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

    interface GrupoRendimiento {
    kg: number;
    personas: number;
  }

  function normalizarTexto(value: unknown): string {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function esLineaTotal(value: unknown): boolean {
    const text = normalizarTexto(value);
    return /\b(total|totales|subtotal|suma|gran total)\b/.test(text);
  }

  function esFilaTotal(item: any): boolean {
    return [
      item?.producto,
      item?.linea,
      item?.grupo_destino,
      item?.destino,
      item?.formato_caja,
      item?.situacion,
    ].some(esLineaTotal);
  }

  function normalizarGrupoRendimiento(value: unknown): RendimientoGrupoKey | null {
    const text = normalizarTexto(value);
    if (!text) return null;
    if (/\bgranel|graneler|bulk/.test(text)) return "Graneleras";
    if (/malla|malladora|mercadona/.test(text)) return "Mallas";
    if (/envas|encaj|caja|linea\s*1|linea\s*2|linea\s*3/.test(text)) return "Envasadoras";
    return null;
  }

  function prodToGrupo(prod: string): RendimientoGrupoKey | null {
    if (esLineaTotal(prod)) return null;
    const text = normalizarTexto(prod);
    if (text.includes("granel")) return "Graneleras";
    if (text.includes("malla")) return "Mallas";
    if (text.includes("mercadona")) return text.includes("granel") ? "Graneleras" : "Mallas";
    if (/envas|encaj|caja/.test(text)) return "Envasadoras";
    return "Envasadoras";
  }

  function grupoDeLineaProducto(item: any): RendimientoGrupoKey | null {
    return (
      normalizarGrupoRendimiento(item.linea) ??
      normalizarGrupoRendimiento(item.zona) ??
      normalizarGrupoRendimiento(item.seccion) ??
      normalizarGrupoRendimiento(item.maquina) ??
      normalizarGrupoRendimiento(item.grupo_rendimiento) ??
      normalizarGrupoRendimiento(item.grupo_destino) ??
      normalizarGrupoRendimiento(item.destino) ??
      prodToGrupo(item.producto ?? "")
    );
  }

  const rendimientoGrupos = useMemo<Record<string, GrupoRendimiento>>(() => {
    const grupos: Record<RendimientoGrupoKey, GrupoRendimiento> = {
      Envasadoras: { kg: 0, personas: 0 },
      Mallas: { kg: 0, personas: 0 },
      Graneleras: { kg: 0, personas: 0 },
    };
    const gruposValidos = new Set<string>(RENDIMIENTO_GRUPOS);

    const addKg = (grupo: string | null, kg: number) => {
      if (grupo && gruposValidos.has(grupo) && kg > 0) {
        grupos[grupo as RendimientoGrupoKey].kg += kg;
      }
    };

    // Fuente prioritaria: tabla normalizada producto_dia. Su campo "linea"
    // es mas fiable para asignar kg a Envasadoras/Mallas/Graneleras que el nombre del producto.
    const detalleDb = (parteDelDia as any)?.producto_dia;
    const detalleIa = (parteDelDia as any)?.resumen_ia?.producto_detalle;
    const detalle = Array.isArray(detalleDb) && detalleDb.length > 0 ? detalleDb : detalleIa;
    if (Array.isArray(detalle) && detalle.length > 0) {
      for (const item of detalle) {
        if (esFilaTotal(item)) continue;
        const grupo = grupoDeLineaProducto(item);
        addKg(grupo, num(item.kg));
      }
    }

    // Fallback: palets_detalle cuando no existe detalle de producto.
    const kgFromDetalle = RENDIMIENTO_GRUPOS.reduce((s, g) => s + grupos[g].kg, 0);
    if (kgFromDetalle === 0) {
      const palets = (parteDelDia as any)?.resumen_ia?.palets_detalle;
      if (Array.isArray(palets)) {
        for (const item of palets) {
          if (esFilaTotal(item)) continue;
          const grupo =
            normalizarGrupoRendimiento(item.linea) ??
            normalizarGrupoRendimiento(item.grupo_destino) ??
            normalizarGrupoRendimiento(item.destino) ??
            normalizarGrupoRendimiento(item.situacion) ??
            prodToGrupo(item.producto ?? "");
          addKg(grupo, num(item.kg_neto));
        }
      }
    }

    const kgObjetivo = produccionRealParte(parteDelDia) || num((parteDelDia as any)?.kg_produccion_calibrador);
    const kgClasificados = RENDIMIENTO_GRUPOS.reduce((s, g) => s + grupos[g].kg, 0);
    if (kgObjetivo > 0 && kgClasificados > kgObjetivo * 1.02) {
      const factor = kgObjetivo / kgClasificados;
      for (const grupo of RENDIMIENTO_GRUPOS) {
        grupos[grupo].kg *= factor;
      }
    }

    for (const t of activos) {
      if (asistencia[t.id] === true && t.zona && grupos[t.zona]) {
        grupos[t.zona as RendimientoGrupoKey].personas++;
      }
    }
    return grupos;
  }, [parteDelDia, activos, asistencia]);

  const totalKg = rendimientoGrupos.Envasadoras.kg + rendimientoGrupos.Mallas.kg + rendimientoGrupos.Graneleras.kg;
  const kgCalibrador = produccionRealParte(parteDelDia) || ((parteDelDia as any)?.kg_produccion_calibrador ?? 0);
  const totalPersonas = rendimientoGrupos.Envasadoras.personas + rendimientoGrupos.Mallas.personas + rendimientoGrupos.Graneleras.personas;

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
      .select("date, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
      .gte("date", from)
      .lte("date", until);

    const kgByDay: Record<string, number> = {};
    for (const r of production ?? []) {
      const kg = produccionRealParte(r) || num(r.kg_produccion_calibrador);
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
            <Calendar className="h-4 w-4" />
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
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-36 h-9 text-sm text-center"
          />
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
                <Button variant="outline" size="sm" disabled={!user} onClick={marcarTodosPresentes} className="glass glass-hover">
                  <UserCheck className="h-4 w-4 mr-1.5" /> Todos presentes
                </Button>
                <label className="relative">
                  <input type="file" accept=".xlsx,.xls" className="absolute inset-0 opacity-0 cursor-pointer peer" onChange={handleImportXLSX} disabled={importing} />
                  <Button variant="outline" size="sm" disabled={importing} asChild className="glass transition-shadow duration-300 peer-hover:shadow-[var(--glass-shadow),var(--glass-glow)]">
                    <span className="cursor-pointer">
                      <Upload className="h-4 w-4 mr-1.5" />
                      {importing ? "Importando…" : "Importar XLSX"}
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
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                            {workers.map((t) => {
                              const presente = asistencia[t.id];
                              return (
                                <div
                                  key={t.id}
                                  className={cn(
                                    "flex items-center justify-between gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-3 transition-colors shadow-[var(--glass-shadow)] bg-[var(--glass-bg)]",
                                    presente === true && "bg-success/10 border-success/30",
                                    presente === false && "bg-destructive/10 border-destructive/30",
                                    presente === undefined && "border-[var(--glass-border)] bg-[var(--glass-bg)]",
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
            <Card className="glass-strong border">
              <CardContent className="p-5">
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
                </div>
              </CardContent>
            </Card>
          ) : parteDelDia ? (
            <Card className="glass-strong border">
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
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>Total producción (calibrador)</span>
                    <span className="font-semibold tabular-nums">{new Intl.NumberFormat("es-ES").format(Math.round(kgCalibrador))} kg</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}


        </div>
      </div>
    </div>
  );
}
