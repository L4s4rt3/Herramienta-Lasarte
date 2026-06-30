import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar as DatePickerCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Plus, Trash2, Upload, ChevronLeft, ChevronRight, UserCheck, UserX,
  Users, Calendar as CalendarIcon, CalendarDays, Search, BarChart3, Eraser,
  CheckCircle2, PackageCheck, FileText, Download, ChevronDown, Pencil, X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";
import { appendRowsSheet, createWorkbook, saveWorkbook } from "@/lib/exportWorkbook";
import type { AsistenciaBajaLaboralRow, TrabajadorRow } from "@/lib/types";
import {
  buildAttendanceRecords,
  extractDailyAttendanceNames,
  extractWeeklyAttendance,
} from "@/lib/asistenciaImport";
import {
  calcularResumenKgPersonaOperacion,
  calcularRendimientoGrupos,
  produccionRealParte,
  RENDIMIENTO_GRUPOS,
} from "@/lib/asistenciaRendimiento";
import {
  enumerateIsoDateRange,
  previousIsoDate,
  shouldApplyBajaLaboralToDate,
} from "@/lib/asistenciaBajasLaborales";
import {
  ASISTENCIA_COMPARATIVA_RANGE_DAYS,
  buildSemanasAsistenciaComparativa,
  type SemanaComparativaData,
} from "@/lib/asistenciaComparativa";
import { exportEficienciaToExcel, exportEficienciaToPDF } from "@/lib/exportEficiencia";
import {
  addAsistenciaGroup,
  ASISTENCIA_GROUPS_STORAGE_KEY,
  DEFAULT_ASISTENCIA_GRUPOS,
  removeAsistenciaGroup,
  renameAsistenciaGroup,
  sanitizeAsistenciaGroups,
  SIN_GRUPO_LABEL,
} from "@/lib/asistenciaGrupos";
import {
  aplicarZonasOperativasTrabajadores,
  darBajaTrabajadorPreservandoHistorial,
  resolveTrabajadoresPorNombre,
} from "@/lib/asistenciaTrabajadores";
import {
  calcularRendimientoZonasAlmacen,
} from "@/lib/asistenciaPlantilla";
import { clasificarProductoInforme } from "@/lib/asistenciaProductoClasificacion";
import {
  buildProductoClasificadoExportRow,
  buildRendimientoZonaExportRow,
  buildTrabajadorDiaExportRow,
  normalizeAsistenciaExportZona,
} from "@/lib/asistenciaExport";
import AsistenciaSemanalPanel from "@/components/AsistenciaSemanalPanel";
import {
  type SemanaDataRaw,
  getWeekDates,
  getWeekLabel,
  getWeekShortLabel,
  shiftWeek,
  buildFaltasSemanales as buildFaltasSemanalesFnc,
  calcularKgPersonaSemanal,
  calcularRendimientoGrupoSemanal,
  calcularKgSeccionSemanal,
  productosClasificadosSemanales,
  INCLUIR_SABADO_STORAGE_KEY,
} from "@/lib/asistenciaSemanal";

type WorkerFilter = "todos" | "presentes" | "ausentes" | "bajaLaboral" | "sinRegistro" | "conKg" | "fueraKg";

const BAJA_LABORAL_MOTIVO = "baja_laboral";
const RENDIMIENTO_GROUP_LABELS: Record<string, string> = {
  Envasadoras: "Mesas",
  Industria: "Industria",
  Mallas: "Mallas",
  Graneleras: "Graneleras",
};
const DEFAULT_BAJA_LABORAL_NAMES = [
  "Anais Castells Sanchez",
  "Lucia Ferrero Martinez",
  "Monserrat Garcia Alcazar",
  "Cristobalina Pigner Garcia",
  "Cristobalina Reyes Cadiz",
].join("\n");

function formatoEntero(value: number) {
  return new Intl.NumberFormat("es-ES").format(Math.round(value));
}

function formatoPorcentaje(value: number) {
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)}%`;
}

function kgProductoInforme(item: ProductoConfeccionDia) {
  return Number(item.kg ?? item.kg_neto) || 0;
}

function zonaProductoBadgeClass(zona: string) {
  if (zona === "Mallas") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (zona === "Graneleras") return "border-sky-300 bg-sky-50 text-sky-900";
  if (zona === "Mesas") return "border-amber-300 bg-amber-50 text-amber-900";
  if (zona === "Industria") return "border-violet-300 bg-violet-50 text-violet-900";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Error desconocido";
}

function inferExportColumnWidths(rows: Record<string, unknown>[]) {
  const headers = Array.from(rows.reduce<Set<string>>((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set()));

  if (headers.length === 0) return [18];

  return headers.map((header) => {
    const maxContent = rows.reduce((max, row) => {
      const value = row[header];
      return Math.max(max, String(value ?? "").length);
    }, header.length);
    return Math.min(Math.max(maxContent + 3, 12), 46);
  });
}

function appendJsonSheet(workbook: XLSX.WorkBook, sheetName: string, rows: Record<string, unknown>[]) {
  const safeRows = rows.length > 0 ? rows : [{ Sin_datos: "" }];
  return appendRowsSheet(workbook, sheetName, safeRows, inferExportColumnWidths(safeRows), { freezeHeader: true });
}

function inicialesTrabajador(nombre: string) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return partes.slice(0, 2).map((parte) => parte[0]?.toLocaleUpperCase("es")).join("");
}

interface ParteDiarioRendimiento {
  id?: string;
  resumen_ia?: unknown;
  kg_produccion_calibrador?: number | null;
  kg_industria_manual?: number | null;
  kg_mujeres_calibrador?: number | null;
  kg_reciclado_malla_z1?: number | null;
  kg_reciclado_malla_z2?: number | null;
  producto_dia?: ProductoConfeccionDia[];
}

interface ProductoConfeccionDia {
  linea?: string | null;
  producto?: string | null;
  formato_caja?: string | null;
  kg?: number | string | null;
  kg_neto?: number | string | null;
  n_cajas?: number | string | null;
  grupo_destino?: string | null;
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

function loadStoredGrupos() {
  if (typeof window === "undefined") return [...DEFAULT_ASISTENCIA_GRUPOS];

  const rawGroups = window.localStorage.getItem(ASISTENCIA_GROUPS_STORAGE_KEY);
  if (!rawGroups) return [...DEFAULT_ASISTENCIA_GRUPOS];

  try {
    const parsed = JSON.parse(rawGroups);
    if (!Array.isArray(parsed)) return [...DEFAULT_ASISTENCIA_GRUPOS];
    const sanitized = sanitizeAsistenciaGroups([...parsed, ...DEFAULT_ASISTENCIA_GRUPOS]);
    return sanitized.length > 0 ? sanitized : [...DEFAULT_ASISTENCIA_GRUPOS];
  } catch {
    return [...DEFAULT_ASISTENCIA_GRUPOS];
  }
}

export default function Asistencia() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trabajadores, setTrabajadores] = useState<TrabajadorRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(today());
  const [asistencia, setAsistencia] = useState<Record<string, boolean>>({});
  const [asistenciaMotivos, setAsistenciaMotivos] = useState<Record<string, string | null>>({});
  const [bajasLaborales, setBajasLaborales] = useState<AsistenciaBajaLaboralRow[]>([]);
  const [loadingTrabajadores, setLoadingTrabajadores] = useState(true);
  const [loadingAsistencia, setLoadingAsistencia] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerZona, setNewWorkerZona] = useState("");
  const [grupos, setGrupos] = useState<string[]>(loadStoredGrupos);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editingGroupValue, setEditingGroupValue] = useState("");
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [editingWorkerName, setEditingWorkerName] = useState("");
  const [showWorkerList, setShowWorkerList] = useState(false);
  const [importingMode, setImportingMode] = useState<"daily" | "weekly" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [workerFilter, setWorkerFilter] = useState<WorkerFilter>("todos");
  const [selectedGroup, setSelectedGroup] = useState("todos");
  const [parteDelDia, setParteDelDia] = useState<ParteDiarioRendimiento | null>(null);
  const [exportingAsistencia, setExportingAsistencia] = useState<"excel" | "pdf" | "lista" | "parte" | null>(null);
  const [bajaLaboralNamesInput, setBajaLaboralNamesInput] = useState(DEFAULT_BAJA_LABORAL_NAMES);
  const [bajaLaboralStartDate, setBajaLaboralStartDate] = useState(today());
  const [bajaLaboralEndDate, setBajaLaboralEndDate] = useState("");
  const [applyingBajaLaboral, setApplyingBajaLaboral] = useState(false);
  const [viewMode, setViewMode] = useState<"daily" | "weekly">("daily");
  const [weekStart, setWeekStart] = useState(() => getWeekDates(today())[0]);
  const [semanaData, setSemanaData] = useState<SemanaDataRaw | null>(null);
  const [loadingSemana, setLoadingSemana] = useState(false);
  const [incluirSabado, setIncluirSabado] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(INCLUIR_SABADO_STORAGE_KEY) === "true";
  });
  function toggleIncluirSabado() {
    const next = !incluirSabado;
    setIncluirSabado(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(INCLUIR_SABADO_STORAGE_KEY, next ? "true" : "false");
    }
  }

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
      setTrabajadores(aplicarZonasOperativasTrabajadores(data ?? []));
    }
    setLoadingTrabajadores(false);
  }

  // ─── Load asistencia for date ──────────────────────────────────────────

  async function loadAsistencia(date: string) {
    if (!user) return;
    setLoadingAsistencia(true);
    const { data, error } = await supabase
      .from("asistencia_detalle")
      .select("trabajador_id, presente, motivo_ausencia")
      .eq("date", date)
      .eq("user_id", user.id);
    const { data: bajasData, error: bajasError } = await supabase
      .from("asistencia_bajas_laborales")
      .select("*")
      .eq("user_id", user.id)
      .lte("fecha_inicio", date)
      .or(`fecha_fin.is.null,fecha_fin.gte.${date}`);

    if (error || bajasError) {
      const message = error?.message ?? bajasError?.message ?? "Error desconocido";
      toast({ title: "Error", description: message, variant: "destructive" });
    } else {
      const bajasDelDia = (bajasData ?? []).filter((baja) => shouldApplyBajaLaboralToDate(baja, date));
      const map: Record<string, boolean> = {};
      const motivos: Record<string, string | null> = {};
      for (const r of data ?? []) {
        map[r.trabajador_id] = r.presente;
        motivos[r.trabajador_id] = r.motivo_ausencia ?? null;
      }
      for (const baja of bajasDelDia) {
        if (map[baja.trabajador_id] !== true) {
          map[baja.trabajador_id] = false;
          motivos[baja.trabajador_id] = BAJA_LABORAL_MOTIVO;
        }
      }
      setBajasLaborales(bajasDelDia);
      setAsistencia(map);
      setAsistenciaMotivos(motivos);
    }
    setLoadingAsistencia(false);
  }

  // ─── Load parte del día ──────────────────────────────────────────────────

  async function loadParteDelDia(date: string) {
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
  }

  async function loadSemanasExportables(): Promise<SemanaComparativaData[]> {
    const until = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - ASISTENCIA_COMPARATIVA_RANGE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: attendance, error: attendanceError } = await supabase
      .from("asistencia_detalle")
      .select("date, presente, trabajador_id")
      .gte("date", from)
      .lte("date", until);
    if (attendanceError) throw attendanceError;

    const { data: trabajadoresExport, error: trabajadoresError } = await supabase
      .from("trabajadores")
      .select("id, zona");
    if (trabajadoresError) throw trabajadoresError;

    const { data: production, error: productionError } = await supabase
      .from("partes_diarios")
      .select("id, date, resumen_ia, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
      .gte("date", from)
      .lte("date", until);
    if (productionError) throw productionError;

    return buildSemanasAsistenciaComparativa({
      asistencia: attendance,
      trabajadores: trabajadoresExport,
      produccion: production,
    });
  }

  async function exportarAsistencia(tipo: "excel" | "pdf") {
    setExportingAsistencia(tipo);

    try {
      const semanas = await loadSemanasExportables();
      if (semanas.length === 0) {
        toast({
          title: "Sin datos para exportar",
          description: "No hay semanas con asistencia y produccion registrada en el periodo.",
          variant: "destructive",
        });
        return;
      }

      const totalKg = semanas.reduce((sum, semana) => sum + Object.values(semana.days).reduce((acc, dia) => acc + dia.kg, 0), 0);
      const totalWorkers = semanas.reduce((sum, semana) => sum + Object.values(semana.days).reduce((acc, dia) => acc + dia.workers, 0), 0);
      const kgPersonaGlobal = totalWorkers > 0 ? Math.round(totalKg / totalWorkers) : 0;
      const resumen = `Media global: ${kgPersonaGlobal} kg/persona`;

      if (tipo === "excel") {
        exportEficienciaToExcel(semanas, resumen);
      } else {
        exportEficienciaToPDF(semanas, resumen);
      }
    } catch (err: unknown) {
      toast({
        title: "Error al exportar asistencia",
        description: errorMessage(err),
        variant: "destructive",
      });
    } finally {
      setExportingAsistencia(null);
    }
  }

  function estadoTrabajadorExport(trabajador: TrabajadorRow) {
    const presente = asistencia[trabajador.id];
    if (presente === true) return "Presente";
    if (presente === false && asistenciaMotivos[trabajador.id] === BAJA_LABORAL_MOTIVO) return "Baja laboral";
    if (presente === false) return "Ausente";
    return "Sin marcar";
  }

  function exportarListaTrabajadores() {
    setExportingAsistencia("lista");
    try {
      const workbook = createWorkbook("Lasarte SAT - Lista de trabajadores", "Plantilla operativa de trabajadores");
      const rows = [...trabajadores]
        .sort((a, b) => (a.zona ?? "").localeCompare(b.zona ?? "", "es") || a.nombre.localeCompare(b.nombre, "es"))
        .map((trabajador) => ({
          Nombre: trabajador.nombre,
          Zona: normalizeAsistenciaExportZona(trabajador.zona),
          Estado: trabajador.activo ? "Activo" : "Inactivo",
        }));
      const resumen = Array.from(
        rows.reduce<Map<string, { Zona: string; Activos: number; Inactivos: number; Total: number }>>((map, row) => {
          const current = map.get(row.Zona) ?? { Zona: row.Zona, Activos: 0, Inactivos: 0, Total: 0 };
          current.Total += 1;
          if (row.Estado === "Activo") current.Activos += 1;
          else current.Inactivos += 1;
          map.set(row.Zona, current);
          return map;
        }, new Map()).values(),
      ).sort((a, b) => a.Zona.localeCompare(b.Zona, "es"));

      appendJsonSheet(workbook, "Resumen zonas", resumen);
      appendJsonSheet(workbook, "Trabajadores", rows);
      saveWorkbook(workbook, `lista_trabajadores_${selectedDate}.xlsx`);
      toast({ title: "Lista de trabajadores descargada" });
    } catch (err) {
      toast({ title: "Error al exportar trabajadores", description: errorMessage(err), variant: "destructive" });
    } finally {
      setExportingAsistencia(null);
    }
  }

  function exportarParteDiarioAsistencia() {
    setExportingAsistencia("parte");
    try {
      const workbook = createWorkbook("Lasarte SAT - Parte diario asistencia", "Informe de ausencias y rendimiento");
      appendJsonSheet(workbook, "Resumen", [
        { Campo: "Fecha", Valor: selectedDate },
        { Campo: "Trabajadores activos", Valor: totalActivos },
        { Campo: "Presentes", Valor: presentesCount },
        { Campo: "Ausentes", Valor: ausentesSinBajaTrabajadores.length },
        { Campo: "Baja laboral", Valor: bajaLaboralTrabajadores.length },
        { Campo: "Sin marcar", Valor: sinRegistro },
        { Campo: "Presentes kg/persona", Valor: presentesComputables },
        { Campo: "Kg produccion", Valor: Math.round(kgProduccionDia) },
        { Campo: "Kg/persona general", Valor: Math.round(kgPersonaLista) },
      ]);
      appendJsonSheet(workbook, "Rendimiento zonas", kgPorConfeccion.map((zona) => ({
        ...buildRendimientoZonaExportRow(zona, formatoPorcentaje(zona.porcentajeKg)),
      })));
      appendJsonSheet(workbook, "Faltas", [
        ...ausentesSinBajaTrabajadores.map((trabajador) => ({
          Tipo: "Ausente",
          Nombre: trabajador.nombre,
          Zona: normalizeAsistenciaExportZona(trabajador.zona),
        })),
        ...bajaLaboralTrabajadores.map((trabajador) => ({
          Tipo: "Baja laboral",
          Nombre: trabajador.nombre,
          Zona: normalizeAsistenciaExportZona(trabajador.zona),
        })),
        ...sinRegistroTrabajadores.map((trabajador) => ({
          Tipo: "Sin marcar",
          Nombre: trabajador.nombre,
          Zona: normalizeAsistenciaExportZona(trabajador.zona),
        })),
      ]);
      appendJsonSheet(workbook, "Trabajadores dia", activos
        .slice()
        .sort((a, b) => (a.zona ?? "").localeCompare(b.zona ?? "", "es") || a.nombre.localeCompare(b.nombre, "es"))
        .map((trabajador) => {
          const metric = listaKgPersonaById.get(trabajador.id);
          return buildTrabajadorDiaExportRow({
            nombre: trabajador.nombre,
            zona: trabajador.zona,
            estado: estadoTrabajadorExport(trabajador),
            coste: metric?.coste ?? "",
            calculo: metric?.calculo ?? "",
            kgRef: metric?.kgRef,
          });
        }));
      appendJsonSheet(workbook, "Productos clasificados", productosInformeClasificados.map(buildProductoClasificadoExportRow));
      saveWorkbook(workbook, `parte_asistencia_${selectedDate}.xlsx`);
      toast({ title: "Parte diario descargado", description: selectedDate });
    } catch (err) {
      toast({ title: "Error al exportar parte diario", description: errorMessage(err), variant: "destructive" });
    } finally {
      setExportingAsistencia(null);
    }
  }

  async function loadSemanaData(weekStartDate: string) {
    if (!user) return;
    setLoadingSemana(true);
    const dates = getWeekDates(weekStartDate);
    const weekEnd = dates[dates.length - 1];

    try {
      const [asistenciaRes, bajasRes, trabajadoresRes, partesRes] = await Promise.all([
        supabase.from("asistencia_detalle").select("trabajador_id, date, presente, motivo_ausencia").in("date", dates).eq("user_id", user.id),
        supabase.from("asistencia_bajas_laborales").select("*").eq("user_id", user.id).lte("fecha_inicio", weekEnd).or(`fecha_fin.is.null,fecha_fin.gte.${dates[0]}`),
        supabase.from("trabajadores").select("*").order("nombre", { ascending: true }),
        supabase.from("partes_diarios").select("id, date, resumen_ia, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2").in("date", dates),
      ]);

      if (asistenciaRes.error || bajasRes.error || trabajadoresRes.error || partesRes.error) {
        toast({ title: "Error", description: "Error al cargar datos semanales", variant: "destructive" });
        setLoadingSemana(false);
        return;
      }

      const partesMap: Record<string, SemanaDataRaw["partes"][string]> = {};
      for (const parte of partesRes.data ?? []) {
        const { data: productoDia } = await supabase
          .from("producto_dia")
          .select("linea, producto, formato_caja, kg, n_cajas, grupo_destino")
          .eq("part_id", parte.id);
        partesMap[parte.date] = { ...parte, producto_dia: productoDia ?? [] };
      }

      const asistenciaMap: Record<string, { date: string; presente: boolean | null; motivo_ausencia: string | null }[]> = {};
      for (const r of asistenciaRes.data ?? []) {
        if (!asistenciaMap[r.trabajador_id]) asistenciaMap[r.trabajador_id] = [];
        asistenciaMap[r.trabajador_id].push({ date: r.date, presente: r.presente, motivo_ausencia: r.motivo_ausencia });
      }

      setSemanaData({
        weekStart: weekStartDate,
        weekEnd,
        days: dates,
        trabajadores: aplicarZonasOperativasTrabajadores(trabajadoresRes.data ?? []),
        asistencia: asistenciaMap,
        bajasLaborales: bajasRes.data ?? [],
        partes: partesMap,
      });
    } catch (err) {
      toast({ title: "Error", description: "Error inesperado al cargar datos semanales", variant: "destructive" });
    }
    setLoadingSemana(false);
  }

  function exportarSemanaExcel() {
    if (!semanaData) {
      toast({ title: "Sin datos", description: "No hay datos semanales para exportar.", variant: "destructive" });
      return;
    }
    setExportingAsistencia("excel");
    try {
      const faltas = buildFaltasSemanalesFnc(semanaData, incluirSabado);
      const kgP = calcularKgPersonaSemanal(semanaData, incluirSabado);
      const grupos = calcularRendimientoGrupoSemanal(semanaData, incluirSabado);
      const secciones = calcularKgSeccionSemanal(semanaData, incluirSabado);
      const productos = productosClasificadosSemanales(semanaData, incluirSabado);
      const weekLabel = getWeekLabel(semanaData.days);

      const workbook = createWorkbook(`Lasarte SAT - Informe semanal ${weekLabel}`, "Resumen semanal de asistencia y rendimiento");
      appendJsonSheet(workbook, "Resumen", [
        { Campo: "Semana", Valor: weekLabel },
        { Campo: "Dias laborables", Valor: incluirSabado ? "Lun a Sab" : "Lun a Vie" },
        { Campo: "Dias con datos", Valor: kgP.diasConDatos },
        { Campo: "Kg totales", Valor: Math.round(kgP.totalKg) },
        { Campo: "Media personas/dia total", Valor: +kgP.mediaPersonasTotales.toFixed(1) },
        { Campo: "Media personas/dia computables", Valor: +kgP.mediaPersonasComputables.toFixed(1) },
        { Campo: "Kg/persona semanal", Valor: Math.round(kgP.kgPersona) },
        { Campo: "Total ausencias", Valor: faltas.reduce((s: number, r: { totalFaltas: number }) => s + r.totalFaltas, 0) },
        { Campo: "Bajas laborales distintas", Valor: faltas.filter((r: { totalBajas: number }) => r.totalBajas > 0).length },
      ]);
      appendJsonSheet(workbook, "Rendimiento zonas", grupos.map((g: { label: string; totalKg: number; totalPersonasDia: number; mediaPersonasDia: number; kgPersona: number; porcentajeKg: number }) => ({
        Zona: normalizeAsistenciaExportZona(g.label),
        "Kg totales": Math.round(g.totalKg),
        "Personas-dia": g.totalPersonasDia,
        "Media pers/dia": +g.mediaPersonasDia.toFixed(1),
        "Kg/persona": Math.round(g.kgPersona),
        "%": +g.porcentajeKg.toFixed(1),
      })));
      appendJsonSheet(workbook, "Kg por seccion", secciones.map((s: { zona: string; kg: number; computa: boolean }) => ({
        Seccion: s.zona,
        Kg: Math.round(s.kg),
        Computa: s.computa ? "Si" : "No",
      })));
      appendJsonSheet(workbook, "Faltas semanales", faltas.map((r: { nombre: string; zona: string | null; totalFaltas: number; totalBajas: number; totalPresentes: number; totalSinRegistrar: number }) => ({
        Trabajador: r.nombre,
        Zona: normalizeAsistenciaExportZona(r.zona),
        Faltas: r.totalFaltas,
        "Bajas laborales": r.totalBajas > 0 ? "Sí" : "No",
        "Días de baja": r.totalBajas,
        Presentes: r.totalPresentes,
      })));
      appendJsonSheet(workbook, "Productos clasificados", productos.map((p: { producto: string; empaque: string; kg: number; zona: string; computa: boolean }) => ({
        Producto: p.producto,
        Empaque: p.empaque,
        Kg: Math.round(p.kg),
        Zona: p.zona,
        Computa: p.computa ? "Si" : "No",
      })));
      saveWorkbook(workbook, `informe_semanal_${weekStart}.xlsx`);
      toast({ title: "Informe semanal descargado", description: weekLabel });
    } catch (err) {
      toast({ title: "Error al exportar", description: errorMessage(err), variant: "destructive" });
    } finally {
      setExportingAsistencia(null);
    }
  }

  useEffect(() => { loadTrabajadores(); loadEficiencia(); }, []);
  useEffect(() => { loadAsistencia(selectedDate); }, [selectedDate, user]);
  useEffect(() => { loadParteDelDia(selectedDate); }, [selectedDate]);
  useEffect(() => {
    if (viewMode === "weekly" && user) {
      loadSemanaData(weekStart);
    }
  }, [viewMode, weekStart, user]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ASISTENCIA_GROUPS_STORAGE_KEY, JSON.stringify(grupos));
    }
  }, [grupos]);

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
    const trabajador = trabajadores.find((item) => item.id === id);
    if (trabajador && !trabajador.activo) return;

    const { error } = await supabase
      .from("trabajadores")
      .update({ activo: false })
      .eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setTrabajadores((prev) => darBajaTrabajadorPreservandoHistorial(prev, id));
    toast({ title: "Trabajador dado de baja", description: "Se conserva su asistencia histórica." });
  }

  async function aplicarBajaLaboralPorNombre() {
    if (!user) return;

    const fechaInicio = bajaLaboralStartDate || selectedDate;
    const fechaFin = bajaLaboralEndDate || null;
    if (fechaFin && fechaFin < fechaInicio) {
      toast({ title: "Fechas no validas", description: "La fecha fin no puede ser anterior al inicio.", variant: "destructive" });
      return;
    }

    const preview = resolveTrabajadoresPorNombre(trabajadores, bajaLaboralNamesInput);
    const ids = preview.matches.map((match) => match.trabajador.id);
    if (ids.length === 0) {
      toast({
        title: "Sin ausencias para aplicar",
        description: preview.inputs.length === 0 ? "Pega al menos un nombre." : "No hay coincidencias activas en la lista.",
        variant: "destructive",
      });
      return;
    }

    setApplyingBajaLaboral(true);
    const periodRows = ids.map((id) => ({
      user_id: user.id,
      trabajador_id: id,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      motivo: BAJA_LABORAL_MOTIVO,
    }));
    const { error: periodError } = await supabase
      .from("asistencia_bajas_laborales")
      .insert(periodRows);

    if (periodError) {
      setApplyingBajaLaboral(false);
      toast({ title: "Error", description: periodError.message, variant: "destructive" });
      return;
    }

    const attendanceEnd = fechaFin ?? (selectedDate >= fechaInicio ? selectedDate : fechaInicio);
    const dates = enumerateIsoDateRange(fechaInicio, attendanceEnd);
    const records = ids.flatMap((id) => dates.map((date) => ({
      user_id: user.id,
      date,
      trabajador_id: id,
      presente: false,
      motivo_ausencia: BAJA_LABORAL_MOTIVO,
    })));
    const { error } = await supabase
      .from("asistencia_detalle")
      .upsert(records, { onConflict: "user_id,date,trabajador_id" });
    setApplyingBajaLaboral(false);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    await loadAsistencia(selectedDate);
    toast({
      title: `${ids.length} baja(s) laboral(es) registrada(s)`,
      description: preview.missing.length > 0
        ? `No encontrados: ${preview.missing.slice(0, 3).join(", ")}${preview.missing.length > 3 ? "..." : ""}`
        : fechaFin ? `${fechaInicio} a ${fechaFin}.` : `Desde ${fechaInicio}, sin fecha fin.`,
    });
  }

  function startEditingTrabajador(trabajador: TrabajadorRow) {
    setEditingWorkerId(trabajador.id);
    setEditingWorkerName(trabajador.nombre);
  }

  function cancelEditingTrabajador() {
    setEditingWorkerId(null);
    setEditingWorkerName("");
  }

  async function updateTrabajadorNombre(trabajador: TrabajadorRow) {
    const nextName = editingWorkerName.trim().replace(/\s+/g, " ");
    if (!nextName) return;

    const { error } = await supabase
      .from("trabajadores")
      .update({ nombre: nextName })
      .eq("id", trabajador.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setTrabajadores((prev) =>
      prev.map((item) => (item.id === trabajador.id ? { ...item, nombre: nextName } : item))
    );
    cancelEditingTrabajador();
    toast({ title: "Nombre actualizado", description: nextName });
  }

  function addGrupo() {
    const sanitizedGroup = sanitizeAsistenciaGroups([newGroupName])[0];
    if (!sanitizedGroup) return;

    const nextGroups = addAsistenciaGroup(grupos, sanitizedGroup);
    if (nextGroups.length === grupos.length) {
      toast({ title: "Grupo ya existe", description: sanitizedGroup });
      setNewGroupName("");
      return;
    }

    setGrupos(nextGroups);
    setNewGroupName("");
    setNewWorkerZona(sanitizedGroup);
    toast({ title: "Grupo añadido", description: sanitizedGroup });
  }

  function startEditingGrupo(grupo: string) {
    setEditingGroupName(grupo);
    setEditingGroupValue(grupo);
  }

  function cancelEditingGrupo() {
    setEditingGroupName(null);
    setEditingGroupValue("");
  }

  async function renameGrupo(grupo: string) {
    if (!user) return;

    const sanitizedGroup = sanitizeAsistenciaGroups([editingGroupValue])[0];
    if (!sanitizedGroup) return;

    const nextGroups = renameAsistenciaGroup(gruposDisponibles, grupo, sanitizedGroup);
    if (JSON.stringify(nextGroups) === JSON.stringify(gruposDisponibles) && sanitizedGroup !== grupo) {
      toast({ title: "No se pudo renombrar", description: "Revisa que el nombre no exista ya.", variant: "destructive" });
      return;
    }

    const { error } = await supabase
      .from("trabajadores")
      .update({ zona: sanitizedGroup })
      .eq("user_id", user.id)
      .eq("zona", grupo);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setTrabajadores((prev) =>
      prev.map((trabajador) => (trabajador.zona === grupo ? { ...trabajador, zona: sanitizedGroup } : trabajador))
    );
    setGrupos(nextGroups);
    if (selectedGroup === grupo) setSelectedGroup(sanitizedGroup);
    if (newWorkerZona === grupo) setNewWorkerZona(sanitizedGroup);
    cancelEditingGrupo();
    toast({ title: "Grupo renombrado", description: sanitizedGroup });
  }

  async function deleteGrupo(grupo: string) {
    if (!user) return;

    const trabajadoresEnGrupo = trabajadores.filter((trabajador) => trabajador.zona === grupo);
    const shouldDelete =
      trabajadoresEnGrupo.length === 0 ||
      typeof window === "undefined" ||
      window.confirm(`Borrar "${grupo}" y dejar ${trabajadoresEnGrupo.length} trabajador(es) sin grupo?`);

    if (!shouldDelete) return;

    if (trabajadoresEnGrupo.length > 0) {
      const { error } = await supabase
        .from("trabajadores")
        .update({ zona: null })
        .eq("user_id", user.id)
        .eq("zona", grupo);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }
    }

    setTrabajadores((prev) =>
      prev.map((trabajador) => (trabajador.zona === grupo ? { ...trabajador, zona: null } : trabajador))
    );
    setGrupos((prev) => removeAsistenciaGroup(prev, grupo));
    if (selectedGroup === grupo) setSelectedGroup("todos");
    if (newWorkerZona === grupo) setNewWorkerZona("");
    toast({ title: "Grupo borrado", description: grupo });
  }

  async function updateTrabajadorZona(trabajador: TrabajadorRow, zona: string) {
    const nextZona = zona || null;
    const { error } = await supabase
      .from("trabajadores")
      .update({ zona: nextZona })
      .eq("id", trabajador.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setTrabajadores((prev) =>
      prev.map((item) => (item.id === trabajador.id ? { ...item, zona: nextZona } : item))
    );
  }

  // ─── Asistencia CRUD ──────────────────────────────────────────────────

  async function toggleAsistencia(trabajadorId: string, presente: boolean, motivoAusencia: string | null = null) {
    if (!user) return;

    setAsistencia((prev) => ({ ...prev, [trabajadorId]: presente }));
    setAsistenciaMotivos((prev) => ({ ...prev, [trabajadorId]: presente ? null : motivoAusencia }));

    const { error } = await supabase
      .from("asistencia_detalle")
      .upsert(
        {
          user_id: user.id,
          date: selectedDate,
          trabajador_id: trabajadorId,
          presente,
          motivo_ausencia: presente ? null : motivoAusencia,
        },
        { onConflict: "user_id,date,trabajador_id" }
      );

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      loadAsistencia(selectedDate);
      return;
    }

    if (presente) {
      await cerrarBajaLaboralAbierta(trabajadorId, selectedDate);
    }
  }

  async function cerrarBajaLaboralAbierta(trabajadorId: string, date: string) {
    const abiertas = bajasLaborales.filter((baja) =>
      baja.trabajador_id === trabajadorId &&
      baja.fecha_fin == null &&
      baja.fecha_inicio <= date
    );
    if (abiertas.length === 0) return;

    for (const baja of abiertas) {
      if (baja.fecha_inicio >= date) {
        const { error } = await supabase
          .from("asistencia_bajas_laborales")
          .delete()
          .eq("id", baja.id);
        if (error) {
          toast({ title: "No se pudo cerrar la baja", description: error.message, variant: "destructive" });
          return;
        }
      } else {
        const { error } = await supabase
          .from("asistencia_bajas_laborales")
          .update({ fecha_fin: previousIsoDate(date) })
          .eq("id", baja.id);
        if (error) {
          toast({ title: "No se pudo cerrar la baja", description: error.message, variant: "destructive" });
          return;
        }
      }
    }

    setBajasLaborales((prev) => prev.filter((baja) => !abiertas.some((item) => item.id === baja.id)));
  }

  async function limpiarAsistenciaDia() {
    if (!user) return;

    const previous = asistencia;
    const previousMotivos = asistenciaMotivos;
    setAsistencia({});
    setAsistenciaMotivos({});

    const { error } = await supabase
      .from("asistencia_detalle")
      .delete()
      .eq("user_id", user.id)
      .eq("date", selectedDate);

    if (error) {
      setAsistencia(previous);
      setAsistenciaMotivos(previousMotivos);
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
      motivo_ausencia: null,
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
    setAsistenciaMotivos({});
    for (const trabajador of activos) {
      await cerrarBajaLaboralAbierta(trabajador.id, selectedDate);
    }
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
      const rowsAll = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

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

      const records = buildAttendanceRecords(nombresImport, activos, user.id, selectedDate)
        .map((record) => ({ ...record, motivo_ausencia: null }));

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
        return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
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

      const records = days
        .flatMap((day) => buildAttendanceRecords(day.names, activos, user.id, day.date))
        .map((record) => ({ ...record, motivo_ausencia: null }));
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

  const gruposDisponibles = useMemo(
    () => sanitizeAsistenciaGroups([...grupos, ...trabajadores.map((trabajador) => trabajador.zona ?? "")]),
    [grupos, trabajadores]
  );
  const groupByZona = useCallback((workers: TrabajadorRow[]) => {
    const groups: Record<string, TrabajadorRow[]> = {};
    const noGroup: TrabajadorRow[] = [];
    for (const w of workers) {
      if (w.zona && gruposDisponibles.includes(w.zona)) {
        if (!groups[w.zona]) groups[w.zona] = [];
        groups[w.zona].push(w);
      } else {
        noGroup.push(w);
      }
    }
    const ordered: { grupo: string; workers: TrabajadorRow[] }[] = [];
    for (const g of gruposDisponibles) {
      if (groups[g]) ordered.push({ grupo: g, workers: groups[g] });
    }
    if (noGroup.length > 0) ordered.push({ grupo: SIN_GRUPO_LABEL, workers: noGroup });
    return ordered;
  }, [gruposDisponibles]);
  const activos = useMemo(() => trabajadores.filter((t) => t.activo), [trabajadores]);
  const bajaLaboralPreview = useMemo(
    () => resolveTrabajadoresPorNombre(trabajadores, bajaLaboralNamesInput),
    [trabajadores, bajaLaboralNamesInput],
  );
  const totalActivos = activos.length;
  const presentesCount = activos.filter((t) => asistencia[t.id] === true).length;
  const sinRegistro = activos.filter((t) => asistencia[t.id] === undefined).length;
  const asistenciaPct = totalActivos > 0 ? Math.round((presentesCount / totalActivos) * 100) : 0;
  const bajaLaboralTrabajadores = useMemo(
    () => activos.filter((t) => asistencia[t.id] === false && asistenciaMotivos[t.id] === BAJA_LABORAL_MOTIVO),
    [activos, asistencia, asistenciaMotivos],
  );
  const ausentesSinBajaTrabajadores = useMemo(
    () => activos.filter((t) => asistencia[t.id] === false && asistenciaMotivos[t.id] !== BAJA_LABORAL_MOTIVO),
    [activos, asistencia, asistenciaMotivos],
  );
  const sinRegistroTrabajadores = useMemo(() => activos.filter((t) => asistencia[t.id] === undefined), [activos, asistencia]);

  // ─── Kg/persona de lista y coste operativo ───────────────────────────────

  const presentes = activos.filter((t) => asistencia[t.id] === true);
  const kgProduccionDia = parteDelDia
    ? produccionRealParte(parteDelDia) || Number(parteDelDia.kg_produccion_calibrador) || 0
    : 0;
  const kgPersonaResumen = useMemo(
    () => calcularResumenKgPersonaOperacion({ trabajadores: activos, asistencia, kgProduccionDia }),
    [activos, asistencia, kgProduccionDia]
  );
  const presentesComputables = kgPersonaResumen.presentesComputables;
  const kgPersonaLista = kgPersonaResumen.kgPersona;
  const rendimientoConfeccion = useMemo(
    () => calcularRendimientoGrupos({ parte: parteDelDia, trabajadores: activos, asistencia }),
    [parteDelDia, activos, asistencia]
  );
  const productosInformeClasificados = useMemo(() => (
    (parteDelDia?.producto_dia ?? [])
      .filter((item) => item.producto?.trim())
      .map((item) => {
        const clasificacion = clasificarProductoInforme({
          producto: item.producto,
          empaque: item.formato_caja,
          formato_caja: item.formato_caja,
          grupo_destino: item.grupo_destino,
          linea: item.linea,
        });
        return {
          producto: item.producto?.trim() || "Sin producto",
          empaque: item.formato_caja?.trim() || "Sin empaque",
          kg: kgProductoInforme(item),
          zona: clasificacion.zona,
          computa: clasificacion.computaKgZona,
        };
      })
      .filter((item) => item.kg > 0)
      .sort((a, b) => {
        if (a.computa !== b.computa) return a.computa ? -1 : 1;
        return b.kg - a.kg || a.producto.localeCompare(b.producto, "es");
      })
  ), [parteDelDia]);
  const productosInformeKgComputable = useMemo(
    () => productosInformeClasificados.reduce((total, item) => total + (item.computa ? item.kg : 0), 0),
    [productosInformeClasificados]
  );
  const resumenCosteOperativo = kgPersonaResumen.costes;
  const listaKgPersona = kgPersonaResumen.rows;
  const listaKgPersonaById = useMemo(() => new Map(listaKgPersona.map((row) => [row.trabajador.id, row])), [listaKgPersona]);
  const gruposResumen = useMemo(() => (
    groupByZona(activos).map(({ grupo, workers }) => {
      const presentesGrupo = workers.filter((worker) => asistencia[worker.id] === true).length;
      const ausentesGrupo = workers.filter((worker) => asistencia[worker.id] === false).length;
      const pendientesGrupo = workers.length - presentesGrupo - ausentesGrupo;
      return {
        grupo,
        total: workers.length,
        presentes: presentesGrupo,
        ausentes: ausentesGrupo,
        pendientes: pendientesGrupo,
        pct: workers.length > 0 ? Math.round((presentesGrupo / workers.length) * 100) : 0,
      };
    })
  ), [activos, asistencia, groupByZona]);
  const rendimientoZonasAlmacen = useMemo(() => calcularRendimientoZonasAlmacen({
    trabajadores: activos,
    asistencia,
    kgPorZona: {
      mallas: rendimientoConfeccion.Mallas.kg,
      granelRp: rendimientoConfeccion.Graneleras.kg,
      mesas: rendimientoConfeccion.Envasadoras.kg,
      industria: rendimientoConfeccion.Industria.kg,
    },
  }), [activos, asistencia, rendimientoConfeccion]);
  const rendimientoZonaByGrupo = useMemo(() => new Map([
    ["Envasadoras", rendimientoZonasAlmacen.zonas.find((zona) => zona.id === "mesas")],
    ["Industria", rendimientoZonasAlmacen.zonas.find((zona) => zona.id === "industria")],
    ["Mallas", rendimientoZonasAlmacen.zonas.find((zona) => zona.id === "mallas")],
    ["Graneleras", rendimientoZonasAlmacen.zonas.find((zona) => zona.id === "granelRp")],
  ]), [rendimientoZonasAlmacen]);
  const kgPorConfeccion = useMemo(() => {
    const maxKg = Math.max(...RENDIMIENTO_GRUPOS.map((grupo) => rendimientoConfeccion[grupo].kg), 1);
    const totalKgGrupos = RENDIMIENTO_GRUPOS.reduce((total, grupo) => total + rendimientoConfeccion[grupo].kg, 0);
    return RENDIMIENTO_GRUPOS.map((grupo) => {
      const zona = rendimientoZonaByGrupo.get(grupo);
      const kg = rendimientoConfeccion[grupo].kg;
      return {
        label: RENDIMIENTO_GROUP_LABELS[grupo] ?? grupo,
        kg,
        pct: kg / maxKg,
        porcentajeKg: totalKgGrupos > 0 ? (kg / totalKgGrupos) * 100 : 0,
        personas: zona?.presentes ?? rendimientoConfeccion[grupo].personas,
        objetivo: zona?.objetivo ?? null,
        kgPersona: zona?.kgPersonaPresentes ?? (
          rendimientoConfeccion[grupo].personas > 0
            ? kg / rendimientoConfeccion[grupo].personas
            : 0
        ),
      };
    });
  }, [rendimientoConfeccion, rendimientoZonaByGrupo]);
  const filterOptions: { id: WorkerFilter; label: string; count: number }[] = [
    { id: "todos", label: "Todos", count: activos.length },
    { id: "presentes", label: "Presentes", count: presentesCount },
    { id: "ausentes", label: "Ausentes", count: ausentesSinBajaTrabajadores.length },
    { id: "bajaLaboral", label: "Baja laboral", count: bajaLaboralTrabajadores.length },
    { id: "sinRegistro", label: "Sin registro", count: sinRegistro },
    { id: "conKg", label: "Entra kg/p", count: presentesComputables },
    { id: "fueraKg", label: "Fuera kg/p", count: resumenCosteOperativo["No computa kg/p"] },
  ];
  const trabajadoresVisibles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return activos.filter((trabajador) => {
      if (query && !trabajador.nombre.toLowerCase().includes(query) && !(trabajador.zona ?? "").toLowerCase().includes(query)) return false;
      const grupoTrabajador = trabajador.zona && gruposDisponibles.includes(trabajador.zona) ? trabajador.zona : SIN_GRUPO_LABEL;
      if (selectedGroup !== "todos" && grupoTrabajador !== selectedGroup) return false;
      const row = listaKgPersonaById.get(trabajador.id);
      switch (workerFilter) {
        case "presentes":
          return asistencia[trabajador.id] === true;
        case "ausentes":
          return asistencia[trabajador.id] === false && asistenciaMotivos[trabajador.id] !== BAJA_LABORAL_MOTIVO;
        case "bajaLaboral":
          return asistencia[trabajador.id] === false && asistenciaMotivos[trabajador.id] === BAJA_LABORAL_MOTIVO;
        case "sinRegistro":
          return asistencia[trabajador.id] === undefined;
        case "conKg":
          return row?.presente === true && row?.kgRef !== null;
        case "fueraKg":
          return row?.coste === "No computa kg/p";
        default:
          return true;
      }
    });
  }, [activos, asistencia, asistenciaMotivos, gruposDisponibles, listaKgPersonaById, searchQuery, selectedGroup, workerFilter]);
  const gruposVisibles = useMemo(() => groupByZona(trabajadoresVisibles), [groupByZona, trabajadoresVisibles]);
  const fueraKgTrabajadores = useMemo(
    () => presentes.filter((trabajador) => listaKgPersonaById.get(trabajador.id)?.coste === "No computa kg/p"),
    [listaKgPersonaById, presentes]
  );
  const revisionItems = [
    {
      label: "Sin marcar",
      value: sinRegistro,
      detail: "Todo marcado",
      names: sinRegistroTrabajadores.map((t) => t.nombre),
      filter: "sinRegistro" as WorkerFilter,
      tone: "border-amber-300/50 bg-amber-50/60 text-amber-950",
    },
    {
      label: "Ausentes",
      value: ausentesSinBajaTrabajadores.length,
      detail: "Sin ausencias",
      names: ausentesSinBajaTrabajadores.map((t) => t.nombre),
      filter: "ausentes" as WorkerFilter,
      tone: "border-rose-300/50 bg-rose-50/60 text-rose-950",
    },
    {
      label: "Baja laboral",
      value: bajaLaboralTrabajadores.length,
      detail: "Sin bajas laborales",
      names: bajaLaboralTrabajadores.map((t) => t.nombre),
      filter: "bajaLaboral" as WorkerFilter,
      tone: "border-sky-300/50 bg-sky-50/70 text-sky-950",
    },
    {
      label: "Fuera kg/p",
      value: fueraKgTrabajadores.length,
      detail: "Nadie fuera",
      names: fueraKgTrabajadores.map((t) => t.nombre),
      filter: "fueraKg" as WorkerFilter,
      tone: "border-slate-300/60 bg-slate-50/70 text-slate-950",
    },
  ];

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
            {viewMode === "daily" ? (
              <span className="capitalize">{fechaDisplay}</span>
            ) : (
              <span className="font-semibold">{getWeekLabel(getWeekDates(weekStart))}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0.5">
            <Button
              variant={viewMode === "daily" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("daily")}
              className={cn("h-8 rounded-lg px-3 text-xs", viewMode !== "daily" && "text-muted-foreground")}
            >
              <CalendarDays className="h-3.5 w-3.5 mr-1" /> Diario
            </Button>
            <Button
              variant={viewMode === "weekly" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("weekly")}
              className={cn("h-8 rounded-lg px-3 text-xs", viewMode !== "weekly" && "text-muted-foreground")}
            >
              <CalendarDays className="h-3.5 w-3.5 mr-1" /> Semanal
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/costes/asistencia/comparativa")} className="glass glass-hover">
            <BarChart3 className="h-4 w-4 mr-1" /> Comparativa
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={exportingAsistencia !== null} className="glass glass-hover">
                <Download className="h-4 w-4 mr-1" />
                {exportingAsistencia ? "Exportando..." : "Exportar"}
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled={exportingAsistencia !== null} onSelect={exportarListaTrabajadores}>
                <Users className="mr-2 h-4 w-4" />
                Lista de trabajadores
              </DropdownMenuItem>
              {viewMode === "daily" ? (
                <>
                  <DropdownMenuItem disabled={exportingAsistencia !== null} onSelect={exportarParteDiarioAsistencia}>
                    <FileText className="mr-2 h-4 w-4" />
                    Parte diario Excel
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem disabled={exportingAsistencia !== null || !semanaData} onSelect={exportarSemanaExcel}>
                  <FileText className="mr-2 h-4 w-4" />
                  Informe semanal Excel
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={exportingAsistencia !== null} onSelect={() => exportarAsistencia("excel")}>
                <FileText className="mr-2 h-4 w-4" />
                Comparativa semanal Excel
              </DropdownMenuItem>
              <DropdownMenuItem disabled={exportingAsistencia !== null} onSelect={() => exportarAsistencia("pdf")}>
                <Download className="mr-2 h-4 w-4" />
                Comparativa semanal PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                {/*
                <div>
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">Grupos</p>
                      <p className="text-xs text-muted-foreground">{gruposDisponibles.length} grupos disponibles</p>
                    </div>
                    <Badge variant="secondary" className="rounded-full">
                      {trabajadores.length} trabajadores
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      placeholder="Nuevo grupo"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addGrupo()}
                      className="h-10 min-w-[190px] flex-1"
                    />
                    <Button
                      type="button"
                      onClick={addGrupo}
                      disabled={sanitizeAsistenciaGroups([newGroupName]).length === 0}
                      className="h-10 glass glass-hover"
                    >
                      <Plus className="mr-1 h-4 w-4" /> Añadir grupo
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {gruposDisponibles.map((grupo) => {
                      const totalGrupo = trabajadores.filter((trabajador) => trabajador.zona === grupo).length;
                      return (
                        <div
                          key={grupo}
                          className="flex items-center gap-2 rounded-full border border-[var(--glass-border)] bg-background/55 py-1 pl-3 pr-1 text-sm shadow-sm"
                        >
                          {editingGroupName === grupo ? (
                            <>
                              <Input
                                value={editingGroupValue}
                                onChange={(e) => setEditingGroupValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void renameGrupo(grupo);
                                  if (e.key === "Escape") cancelEditingGrupo();
                                }}
                                className="h-8 w-44 rounded-full bg-background/80 px-3 text-sm"
                                autoFocus
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full text-emerald-700"
                                onClick={() => void renameGrupo(grupo)}
                                title={`Guardar ${grupo}`}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full text-muted-foreground"
                                onClick={cancelEditingGrupo}
                                title="Cancelar"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <span className="font-semibold">{grupo}</span>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{totalGrupo}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full text-muted-foreground hover:text-primary"
                                onClick={() => startEditingGrupo(grupo)}
                                title={`Editar ${grupo}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full text-muted-foreground hover:text-destructive"
                                onClick={() => void deleteGrupo(grupo)}
                                title={`Borrar ${grupo}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                */}
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
                        {gruposDisponibles.map((z) => (
                          <SelectItem key={z} value={z}>{z}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" className="h-10 gap-2 glass glass-hover">
                        <Users className="h-4 w-4" />
                        Grupos
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[380px] rounded-2xl border-[var(--glass-border)] bg-background/95 p-3 shadow-[var(--glass-shadow)] backdrop-blur-xl" align="end">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-foreground">Grupos</p>
                            <p className="text-xs text-muted-foreground">{gruposDisponibles.length} activos</p>
                          </div>
                          <Badge variant="secondary" className="rounded-full">{trabajadores.length}</Badge>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Nuevo grupo"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && addGrupo()}
                            className="h-9"
                          />
                          <Button
                            type="button"
                            size="icon"
                            onClick={addGrupo}
                            disabled={sanitizeAsistenciaGroups([newGroupName]).length === 0}
                            className="h-9 w-9 shrink-0 glass glass-hover"
                            title="Añadir grupo"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
                          {gruposDisponibles.map((grupo) => {
                            const totalGrupo = trabajadores.filter((trabajador) => trabajador.zona === grupo).length;
                            return (
                              <div
                                key={grupo}
                                className="flex min-h-10 items-center gap-2 rounded-xl border border-transparent px-2 py-1.5 hover:border-[var(--glass-border)] hover:bg-muted/45"
                              >
                                {editingGroupName === grupo ? (
                                  <>
                                    <Input
                                      value={editingGroupValue}
                                      onChange={(e) => setEditingGroupValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") void renameGrupo(grupo);
                                        if (e.key === "Escape") cancelEditingGrupo();
                                      }}
                                      className="h-8 min-w-0 flex-1 bg-background/80 text-sm"
                                      autoFocus
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 shrink-0 text-emerald-700"
                                      onClick={() => void renameGrupo(grupo)}
                                      title={`Guardar ${grupo}`}
                                    >
                                      <CheckCircle2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 shrink-0 text-muted-foreground"
                                      onClick={cancelEditingGrupo}
                                      title="Cancelar"
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{grupo}</span>
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{totalGrupo}</span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                                      onClick={() => startEditingGrupo(grupo)}
                                      title={`Editar ${grupo}`}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                      onClick={() => void deleteGrupo(grupo)}
                                      title={`Borrar ${grupo}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button onClick={addTrabajador} disabled={!newWorkerName.trim()} className="h-10 glass glass-hover">
                    <Plus className="h-4 w-4 mr-1" /> Añadir
                  </Button>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <p className="text-sm font-semibold">Ausencias por baja laboral</p>
                        <p className="text-xs text-muted-foreground">Define inicio y fin opcional. Si no hay fin, queda abierta hasta marcar presente.</p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Desde</p>
                          <Input
                            type="date"
                            value={bajaLaboralStartDate}
                            onChange={(event) => setBajaLaboralStartDate(event.target.value)}
                            className="h-9 bg-background/60"
                          />
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Hasta</p>
                          <Input
                            type="date"
                            value={bajaLaboralEndDate}
                            onChange={(event) => setBajaLaboralEndDate(event.target.value)}
                            className="h-9 bg-background/60"
                            placeholder="Sin fecha fin"
                          />
                        </div>
                      </div>
                      <Textarea
                        value={bajaLaboralNamesInput}
                        onChange={(event) => setBajaLaboralNamesInput(event.target.value)}
                        placeholder={"Anais Castells Sanchez\nLucia Ferrero Martinez"}
                        className="min-h-[88px] bg-background/60"
                      />
                    </div>
                    <div className="flex w-full flex-col gap-2 lg:w-56">
                      <Button
                        type="button"
                        className="h-9"
                        onClick={() => void aplicarBajaLaboralPorNombre()}
                        disabled={applyingBajaLaboral || bajaLaboralPreview.matches.length === 0}
                      >
                        <UserX className="h-4 w-4" />
                        {applyingBajaLaboral ? "Aplicando..." : "Marcar baja laboral"}
                      </Button>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <Badge variant="outline" className="justify-center rounded-md">
                          {bajaLaboralPreview.matches.length} encontradas
                        </Badge>
                        <Badge variant="secondary" className="justify-center rounded-md">
                          {bajaLaboralPreview.inactive.length} inactivas
                        </Badge>
                        <Badge variant={bajaLaboralPreview.missing.length > 0 ? "destructive" : "outline"} className="col-span-2 justify-center rounded-md">
                          {bajaLaboralPreview.missing.length} sin encontrar
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {bajaLaboralPreview.missing.length > 0 ? (
                    <p className="mt-2 text-xs text-destructive">
                      Sin encontrar: {bajaLaboralPreview.missing.slice(0, 4).join(", ")}{bajaLaboralPreview.missing.length > 4 ? "..." : ""}
                    </p>
                  ) : null}
                  {bajaLaboralPreview.ambiguous.length > 0 ? (
                    <p className="mt-2 text-xs text-warning">
                      Revisa duplicados: {bajaLaboralPreview.ambiguous.map((item) => item.input).join(", ")}
                    </p>
                  ) : null}
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
                                <TableCell className="min-w-[220px]">
                                  {editingWorkerId === t.id ? (
                                    <div className="flex items-center gap-1">
                                      <Input
                                        value={editingWorkerName}
                                        onChange={(e) => setEditingWorkerName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") void updateTrabajadorNombre(t);
                                          if (e.key === "Escape") cancelEditingTrabajador();
                                        }}
                                        className="h-9 min-w-[190px] bg-background/70 text-sm"
                                        autoFocus
                                      />
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-emerald-700"
                                        onClick={() => void updateTrabajadorNombre(t)}
                                        title="Guardar nombre"
                                      >
                                        <CheckCircle2 className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground"
                                        onClick={cancelEditingTrabajador}
                                        title="Cancelar"
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-semibold text-sm">{t.nombre}</span>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                                        onClick={() => startEditingTrabajador(t)}
                                        title={`Editar ${t.nombre}`}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={t.zona ?? "__none__"}
                                    onValueChange={(value) => void updateTrabajadorZona(t, value === "__none__" ? "" : value)}
                                  >
                                    <SelectTrigger className="h-9 min-w-[160px] border-[var(--glass-border)] bg-background/60 text-sm">
                                      <SelectValue placeholder="Sin grupo" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">Sin grupo</SelectItem>
                                      {gruposDisponibles.map((z) => (
                                        <SelectItem key={z} value={z}>{z}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
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
                                      disabled={!t.activo}
                                      onClick={() => deleteTrabajador(t.id)}
                                      title="Quitar de la lista activa sin borrar historial"
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
          {viewMode === "daily" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => shiftDate(-1)} className="glass glass-hover">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <AsistenciaDatePicker value={selectedDate} onChange={setSelectedDate} />
              <Button variant="outline" size="sm" onClick={() => shiftDate(1)} className="glass glass-hover">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setWeekStart(shiftWeek(weekStart, -1))} className="glass glass-hover">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" className="glass glass-hover h-9 min-w-[200px] justify-start gap-2 rounded-xl border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] px-3 text-sm font-semibold">
                <CalendarDays className="h-4 w-4 shrink-0 text-primary/75" />
                <span>{getWeekLabel(getWeekDates(weekStart))}</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeekStart(shiftWeek(weekStart, 1))} className="glass glass-hover">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </header>

      {viewMode === "weekly" ? (
        <AsistenciaSemanalPanel
          semana={semanaData}
          loading={loadingSemana}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          onExport={exportarSemanaExcel}
          exporting={exportingAsistencia !== null}
          incluirSabado={incluirSabado}
          onToggleSabado={toggleIncluirSabado}
        />
      ) : (<>
      <Card className="glass-accented glass-accent-top overflow-hidden">
        <CardContent className="p-0">
          <div className="grid xl:grid-cols-[0.92fr_1.58fr]">
            <div className="border-b border-[var(--glass-border)] p-5 xl:border-b-0 xl:border-r">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="panel-kicker">Asistencia del turno</p>
                  <div className="mt-3 flex items-end gap-3">
                    <p className="text-5xl font-semibold leading-none tabular-nums text-success">{asistenciaPct}%</p>
                    <div className="pb-1">
                      <p className="text-lg font-semibold tabular-nums">{presentesCount}/{totalActivos}</p>
                      <p className="text-xs text-muted-foreground">presentes marcados</p>
                    </div>
                  </div>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-success/25 bg-success/10 text-success shadow-[var(--glass-shadow)]">
                  <UserCheck className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-5 h-3 overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                <div className="h-full rounded-full bg-success" style={{ width: `${asistenciaPct}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2 py-2">
                  <p className="text-lg font-semibold tabular-nums">{ausentesSinBajaTrabajadores.length}</p>
                  <p className="text-[11px] text-muted-foreground">ausentes</p>
                </div>
                <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2 py-2">
                  <p className="text-lg font-semibold tabular-nums">{sinRegistro}</p>
                  <p className="text-[11px] text-muted-foreground">sin marcar</p>
                </div>
                <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2 py-2">
                  <p className="text-lg font-semibold tabular-nums">{presentesComputables}</p>
                  <p className="text-[11px] text-muted-foreground">kg/p</p>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Revisar primero</p>
                  <p className="text-xs text-muted-foreground">atajos</p>
                </div>
                <div className="grid gap-2">
                  {revisionItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setWorkerFilter(item.filter);
                        setSelectedGroup("todos");
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--glass-shadow)]",
                        item.tone
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-xs font-semibold uppercase tracking-wide">{item.label}</span>
                        <span className="text-xl font-semibold tabular-nums">{item.value}</span>
                      </div>
                      {item.names.length > 0 ? (
                        <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-md border border-current/10 bg-white/35 p-2 text-xs leading-snug opacity-85">
                          {item.names.map((name) => (
                            <p key={name} className="whitespace-normal break-words">
                              {name}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs opacity-75">{item.detail}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-5 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="panel-kicker">Rendimiento del dia</p>
                  <p className="mt-1 text-sm text-muted-foreground">Produccion real, media general y lectura por zona.</p>
                </div>
                <Badge variant="secondary" className="w-fit rounded-full tabular-nums">
                  {productosInformeClasificados.length} productos clasificados
                </Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] p-4 shadow-[var(--glass-shadow)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="panel-kicker">Kg/persona general</p>
                      <p className="text-xs text-muted-foreground">media de trabajadores computables</p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <p className="text-4xl font-semibold leading-none tabular-nums">{formatoEntero(kgPersonaLista)}</p>
                    <p className="pb-1 text-xs text-muted-foreground">{presentesComputables} personas kg/p</p>
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="panel-kicker">Kg produccion</p>
                      <p className="text-xs text-muted-foreground">kg reales del parte</p>
                    </div>
                    <PackageCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <p className="text-4xl font-semibold leading-none tabular-nums">{formatoEntero(kgProduccionDia)}</p>
                    <p className="pb-1 text-xs text-muted-foreground">total dia</p>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Kg/persona por zona</p>
                  <p className="text-xs text-muted-foreground">segun informe producto</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                {kgPorConfeccion.map((item) => (
                    <div key={item.label} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{item.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.objetivo ? `${item.personas}/${item.objetivo} presentes` : "kg del informe"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums text-primary">{formatoEntero(item.kg)} kg</p>
                          <p className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                            {formatoPorcentaje(item.porcentajeKg)}
                          </p>
                        </div>
                      </div>
                      {item.objetivo ? (
                        <div className="mt-3">
                          <p className="text-2xl font-semibold leading-none tabular-nums">{formatoEntero(item.kgPersona)}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">kg/persona zona</p>
                        </div>
                      ) : (
                        <p className="mt-3 rounded-lg border border-[var(--glass-border)] bg-background/45 px-2 py-1.5 text-xs text-muted-foreground">
                          Sin dotacion propia de zona
                        </p>
                      )}
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(5, item.pct * 100)}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatoPorcentaje(item.porcentajeKg)} de los kg clasificados
                      </p>
                    </div>
                ))}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                <div className="flex flex-col gap-2 border-b border-[var(--glass-border)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">Productos clasificados</p>
                    <p className="text-xs text-muted-foreground">lineas del informe producto agrupadas por zona</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="rounded-full tabular-nums">
                      {productosInformeClasificados.length} lineas
                    </Badge>
                    <Badge variant="outline" className="rounded-full tabular-nums">
                      {formatoEntero(productosInformeKgComputable)} kg computables
                    </Badge>
                  </div>
                </div>
                {productosInformeClasificados.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">Sin lineas de producto cargadas.</p>
                ) : (
                  <div className="max-h-[280px] overflow-y-auto">
                    {productosInformeClasificados.map((item, index) => (
                      <div
                        key={`${item.producto}-${item.empaque}-${index}`}
                        className="grid gap-2 border-b border-[var(--glass-border)] px-3 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_160px_110px]"
                      >
                        <div className="min-w-0">
                          <p className="line-clamp-1 text-sm font-semibold">{item.producto}</p>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.empaque}</p>
                        </div>
                        <div className="flex items-center gap-2 md:justify-start">
                          <Badge variant="outline" className={cn("rounded-full", zonaProductoBadgeClass(item.zona))}>
                            {item.zona}
                          </Badge>
                          {!item.computa ? (
                            <span className="text-xs text-muted-foreground">fuera kg/zona</span>
                          ) : null}
                        </div>
                        <p className="text-sm font-semibold tabular-nums text-primary md:text-right">
                          {formatoEntero(item.kg)} kg
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Main Grid ───────────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Left: Attendance */}
        <div className="space-y-6">
          <Card className="glass-accented overflow-hidden">
            <CardHeader className="border-b border-[var(--glass-border)] pb-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <CardTitle className="text-lg">Control diario</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Marca asistencia, revisa quien entra en kg/persona e importa partes diarios o semanales.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={!user} onClick={marcarTodosPresentes} className="glass glass-hover">
                    <UserCheck className="h-4 w-4 mr-1.5" /> Todos presentes
                  </Button>
                  <Button variant="outline" size="sm" disabled={!user || sinRegistro === totalActivos} onClick={limpiarAsistenciaDia} className="glass glass-hover">
                    <Eraser className="h-4 w-4 mr-1.5" /> Limpiar dia
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 sm:p-6">
              {/* Search + actions bar */}
              <div className="mb-4 grid gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 xl:grid-cols-[minmax(240px,1fr)_auto] xl:items-center">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar trabajador o grupo..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 pl-9 text-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="relative">
                    <input type="file" accept=".xlsx,.xls" className="absolute inset-0 opacity-0 cursor-pointer peer" onChange={handleDailyImportXLSX} disabled={importing} />
                    <Button variant="outline" size="sm" disabled={importing} asChild className="glass transition-shadow duration-300 peer-hover:shadow-[var(--glass-shadow),var(--glass-glow)]">
                      <span className="cursor-pointer">
                        <Upload className="h-4 w-4 mr-1.5" />
                        {importingMode === "daily" ? "Importando..." : "Importar diario"}
                      </span>
                    </Button>
                  </label>
                  <label className="relative">
                    <input type="file" accept=".xlsx,.xls" className="absolute inset-0 opacity-0 cursor-pointer peer" onChange={handleWeeklyImportXLSX} disabled={importing} />
                    <Button variant="outline" size="sm" disabled={importing} asChild className="glass transition-shadow duration-300 peer-hover:shadow-[var(--glass-shadow),var(--glass-glow)]">
                      <span className="cursor-pointer">
                        <CalendarDays className="h-4 w-4 mr-1.5" />
                        {importingMode === "weekly" ? "Importando..." : "Importar semanal"}
                      </span>
                    </Button>
                  </label>
                </div>
              </div>

              <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
                {filterOptions.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant={workerFilter === option.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setWorkerFilter(option.id)}
                    className={cn("h-9 shrink-0 rounded-full px-3", workerFilter !== option.id && "glass glass-hover")}
                  >
                    {option.label}
                    <span className="ml-2 rounded-full bg-background/60 px-1.5 text-xs tabular-nums">{option.count}</span>
                  </Button>
                ))}
              </div>

              <div className="mb-6 rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg)] p-3 shadow-[var(--glass-shadow)] backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Grupos de trabajo</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedGroup === "todos" ? "Mostrando todos los grupos" : `Mostrando ${selectedGroup}`}
                    </p>
                  </div>
                  {selectedGroup !== "todos" && (
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setSelectedGroup("todos")}>
                      Ver todos
                    </Button>
                  )}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setSelectedGroup("todos")}
                    className={cn(
                      "min-w-[116px] rounded-lg border px-3 py-2 text-left transition",
                      selectedGroup === "todos"
                        ? "border-primary/50 bg-primary/10"
                        : "border-[var(--glass-border)] bg-background/40 hover:bg-background/70"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">Todos</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{presentesCount}/{totalActivos}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                      <div className="h-full rounded-full bg-success" style={{ width: `${asistenciaPct}%` }} />
                    </div>
                  </button>
                  {gruposResumen.map((grupo) => (
                    <button
                      key={grupo.grupo}
                      type="button"
                      onClick={() => setSelectedGroup(grupo.grupo)}
                      className={cn(
                        "min-w-[158px] rounded-lg border px-3 py-2 text-left transition",
                        selectedGroup === grupo.grupo
                          ? "border-primary/50 bg-primary/10"
                          : "border-[var(--glass-border)] bg-background/40 hover:bg-background/70"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{grupo.grupo}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{grupo.presentes}/{grupo.total}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                        <div className="h-full rounded-full bg-success" style={{ width: `${grupo.pct}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {grupo.pendientes > 0 ? `${grupo.pendientes} sin marcar` : grupo.ausentes > 0 ? `${grupo.ausentes} ausentes` : "Completo"}
                      </p>
                    </button>
                  ))}
                </div>
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
                if (trabajadoresVisibles.length === 0) return (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Search className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm font-medium">Sin resultados con el filtro actual</p>
                    <p className="mt-1 text-xs">Prueba otro estado, grupo o busqueda.</p>
                  </div>
                );
                return (
                  <div className="space-y-5">
                    {gruposVisibles.map(({ grupo, workers }) => {
                      const presentes = workers.filter((w) => asistencia[w.id] === true).length;
                      const todosPresentes = presentes === workers.length;
                      return (
                        <div key={grupo} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 shadow-[var(--glass-shadow)] backdrop-blur-xl">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-bold uppercase tracking-wide text-muted-foreground">
                                {grupo}
                              </h3>
                              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="tabular-nums">{presentes}/{workers.length} presentes</span>
                                <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                                <span>{workers.length - presentes} por revisar</span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 shrink-0 rounded-lg px-3 text-xs"
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
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                            {workers.map((t) => {
                              const presente = asistencia[t.id];
                              const metric = listaKgPersonaById.get(t.id);
                              const bajaLaboral = asistenciaMotivos[t.id] === BAJA_LABORAL_MOTIVO;
                              const estadoLabel = presente === true ? "Presente" : presente === false ? "Ausente" : "Pendiente";
                              return (
                                <div
                                  key={t.id}
                                  className={cn(
                                    "relative flex min-h-[96px] items-start justify-between gap-3 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-3 py-3 shadow-[var(--glass-shadow)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:shadow-[var(--glass-shadow-lg)]",
                                    presente === true && "border-success/30 bg-success/10",
                                    presente === false && "border-destructive/30 bg-destructive/10",
                                    presente === undefined && "border-amber-300/35 bg-amber-50/35",
                                  )}
                                >
                                  <div
                                    className={cn(
                                      "absolute inset-y-3 left-0 w-1 rounded-r-full",
                                      presente === true && "bg-success",
                                      presente === false && "bg-destructive",
                                      presente === undefined && "bg-amber-500"
                                    )}
                                  />
                                  <div className="flex min-w-0 flex-1 gap-3 pl-1">
                                    <div
                                      className={cn(
                                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-sm font-semibold shadow-[var(--glass-shadow)]",
                                        presente === true && "border-success/25 bg-success/10 text-success",
                                        presente === false && "border-destructive/25 bg-destructive/10 text-destructive",
                                        presente === undefined && "border-amber-300/50 bg-amber-100/70 text-amber-800"
                                      )}
                                    >
                                      {inicialesTrabajador(t.nombre)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{t.nombre}</p>
                                      {t.zona && (
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.zona}</p>
                                      )}
                                      {presente === true && metric?.kgRef !== null && metric?.kgRef !== undefined && (
                                        <p className="mt-2 inline-flex rounded-lg border border-primary/15 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                                          {formatoEntero(metric.kgRef)} kg/p
                                        </p>
                                      )}
                                      {presente === false && bajaLaboral ? (
                                        <p className="mt-2 inline-flex rounded-lg border border-destructive/15 bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">
                                          Baja laboral
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 flex-col items-end gap-2">
                                    <Badge
                                      variant="secondary"
                                      className={cn(
                                        "rounded-full px-2 py-0.5 text-[10px]",
                                        presente === true && "bg-success/15 text-success hover:bg-success/15",
                                        presente === false && "bg-destructive/15 text-destructive hover:bg-destructive/15",
                                        presente === undefined && "bg-amber-100 text-amber-800 hover:bg-amber-100"
                                      )}
                                    >
                                      {estadoLabel}
                                    </Badge>
                                    <Switch
                                      checked={presente === true}
                                      onCheckedChange={(checked) => toggleAsistencia(t.id, checked)}
                                    />
                                  </div>
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

      </div></>
      )}
    </div>
  );
}
