import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { today } from "@/lib/format";
import { useAuth } from "@/contexts/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SelectorPeriodo } from "@/components/SelectorPeriodo";
import {
  Plus, Upload, UserCheck, UserX,
  Users, Calendar as CalendarIcon, CalendarDays, Search, Eraser,
  PackageCheck, FileText, Download, ChevronDown, X, CalendarRange,
  ShieldOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { appendRowsSheet, createWorkbook, saveWorkbook } from "@/lib/exportWorkbook";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_INT,
  FMT_KG,
  FMT_PCT,
  type ColumnaTabla,
} from "@/lib/exportKit";
import type { TrabajadorRow } from "@/lib/types";
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
import { exportEficienciaToExcel, exportEficienciaToPDF } from "@/lib/exportEficiencia";
import {
  ASISTENCIA_GROUPS_STORAGE_KEY,
  DEFAULT_ASISTENCIA_GRUPOS,
  sanitizeAsistenciaGroups,
  SIN_GRUPO_LABEL,
} from "@/lib/asistenciaGrupos";
import {
  resolveTrabajadoresPorLista,
  type TrabajadorNoResuelto,
} from "@/lib/asistenciaTrabajadores";
import { useTrabajadoresAlias } from "@/hooks/useTrabajadoresAlias";
import { useLimpiezaJornadaFueraLinea } from "@/hooks/useLimpiezaJornadaFueraLinea";
import {
  BAJA_LABORAL_MOTIVO,
  cargarAsistenciaPeriodo,
  cargarProduccionPeriodo,
  cargarSemanasAsistenciaExportables,
  useAsistenciaCobertura,
  useAsistenciaDia,
  useAsistenciaEficiencia,
  useAsistenciaPeriodo,
  useAsistenciaTrabajadores,
  useParteDelDia,
  useUpsertAsistenciaRegistros,
  type ProductoConfeccionDia,
} from "@/hooks/useAsistencia";
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
import {
  type PeriodoAsistenciaRaw,
  getDiasLaborables,
  buildFaltasSemanales as buildFaltasSemanalesFnc,
  calcularKgPersonaSemanal,
  calcularRendimientoGrupoSemanal,
  calcularKgSeccionSemanal,
  productosClasificadosSemanales,
  INCLUIR_SABADO_STORAGE_KEY,
} from "@/lib/asistenciaSemanal";
import {
  coberturaDelPeriodo,
  contarDias,
  contarMarcasPorDia,
  enumerarDias,
  formatFechaLarga,
  mesesDeCobertura,
  resumirTrabajadoresPeriodo,
  totalesPeriodo,
  type CoberturaAsistencia,
} from "@/lib/asistenciaPeriodo";
import {
  formatPeriodoLabel,
  hoyPeriodo,
  periodoDeFecha,
  rangoPersonalizado,
  type PeriodoValue,
} from "@/lib/selectorPeriodo";

type WorkerFilter = "todos" | "presentes" | "ausentes" | "bajaLaboral" | "sinRegistro" | "conKg" | "fueraKg";

const RENDIMIENTO_GROUP_LABELS: Record<string, string> = {
  Envasadoras: "Mesas",
  Industria: "Industria",
  Mallas: "Mallas",
  Graneleras: "Graneleras",
};
function formatoEntero(value: number) {
  return new Intl.NumberFormat("es-ES").format(Math.round(value));
}

function kgProductoInforme(item: ProductoConfeccionDia) {
  return Number(item.kg ?? item.kg_neto) || 0;
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

// ─── Columnas Lasarte (RRHH · Asistencia diaria/semanal, spec §10/§11 de
// docs/EXPORT_TEMPLATES_SPEC.md) para exportarParteDiarioAsistencia y
// exportarSemanaExcel. Tabla genérica Campo/Valor para las hojas "Resumen".
const RESUMEN_ASISTENCIA_COLUMNAS: ColumnaTabla[] = [
  { header: "Campo", key: "Campo", width: 28 },
  { header: "Valor", key: "Valor", width: 20, align: "right" },
];

const RENDIMIENTO_ZONAS_DIA_COLUMNAS: ColumnaTabla[] = [
  { header: "Zona", key: "Zona", width: 20 },
  { header: "Kg", key: "Kg", numFmt: FMT_KG, align: "right", width: 16 },
  { header: "Porcentaje kg", key: "Porcentaje kg", numFmt: FMT_PCT, align: "right", width: 14 },
  { header: "Personas presentes", key: "Personas presentes", numFmt: FMT_INT, align: "right", width: 16 },
  { header: "Personas plantilla", key: "Personas plantilla", numFmt: FMT_INT, align: "right", width: 16 },
  { header: "Kg/persona", key: "Kg/persona", numFmt: FMT_KG, align: "right", width: 14 },
];

const FALTAS_DIA_COLUMNAS: ColumnaTabla[] = [
  { header: "Tipo", key: "Tipo", width: 14 },
  { header: "Trabajador", key: "Nombre", width: 26 },
  { header: "Puesto/Zona", key: "Zona", width: 18 },
];

// Spec §10: Fecha, Trabajador, Puesto/Zona, Estado asistencia, Motivo ausencia
// (DNI y hora entrada/salida no se incluyen: el modelo de datos de esta vista
// no los recoge; ver src/lib/types.ts TrabajadorRow).
const TRABAJADORES_DIA_COLUMNAS: ColumnaTabla[] = [
  { header: "Fecha", key: "Fecha", width: 13, align: "center" },
  { header: "Trabajador", key: "Nombre", width: 26 },
  { header: "Puesto/Zona", key: "Zona", width: 18 },
  { header: "Estado asistencia", key: "Estado", width: 18 },
  { header: "Motivo ausencia", key: "Motivo ausencia", width: 22 },
  { header: "Coste", key: "Coste", width: 16 },
  { header: "Cálculo", key: "Calculo", width: 26 },
  { header: "Kg/persona general", key: "Kg/persona general", numFmt: FMT_KG, align: "right", width: 18 },
];

const PRODUCTOS_CLASIFICADOS_DIA_COLUMNAS: ColumnaTabla[] = [
  { header: "Producto", key: "Producto", width: 28 },
  { header: "Empaque", key: "Empaque", width: 16 },
  { header: "Zona", key: "Zona", width: 16 },
  { header: "Computa kg zona", key: "Computa kg zona", width: 16, align: "center" },
  { header: "Kg", key: "Kg", numFmt: FMT_KG, align: "right", width: 14 },
];

const RENDIMIENTO_ZONAS_SEMANA_COLUMNAS: ColumnaTabla[] = [
  { header: "Zona", key: "Zona", width: 20 },
  { header: "Kg totales", key: "Kg totales", numFmt: FMT_KG, align: "right", width: 16 },
  { header: "Personas-día", key: "Personas-dia", numFmt: FMT_INT, align: "right", width: 14 },
  { header: "Media pers/día", key: "Media pers/dia", numFmt: "0.0", align: "right", width: 14 },
  { header: "Kg/persona", key: "Kg/persona", numFmt: FMT_KG, align: "right", width: 14 },
  { header: "%", key: "%", numFmt: FMT_PCT, align: "right", width: 10 },
];

const KG_SECCION_SEMANA_COLUMNAS: ColumnaTabla[] = [
  { header: "Sección", key: "Seccion", width: 20 },
  { header: "Kg", key: "Kg", numFmt: FMT_KG, align: "right", width: 14 },
  { header: "Computa", key: "Computa", width: 12, align: "center" },
];


// ─── Columnas nuevas del informe por periodo (17-09-2026) ──────────────────
// La hoja de cobertura es la que contesta en papel "¿de qué días tengo
// información?": un renglón por día natural, diga lo que diga (con datos, sin
// volcar, o no laborable).
const COBERTURA_DIA_COLUMNAS: ColumnaTabla[] = [
  { header: "Fecha", key: "Fecha", width: 13, align: "center" },
  { header: "Día", key: "Dia", width: 8, align: "center" },
  { header: "Laborable", key: "Laborable", width: 11, align: "center" },
  { header: "Registros", key: "Registros", numFmt: FMT_INT, align: "right", width: 11 },
  { header: "Presentes", key: "Presentes", numFmt: FMT_INT, align: "right", width: 11 },
  { header: "Ausentes", key: "Ausentes", numFmt: FMT_INT, align: "right", width: 11 },
  { header: "Kg producidos", key: "Kg", numFmt: FMT_KG, align: "right", width: 16 },
  { header: "Estado", key: "Estado", width: 20 },
];

const ASISTENCIA_TRABAJADOR_PERIODO_COLUMNAS: ColumnaTabla[] = [
  { header: "Trabajador", key: "Trabajador", width: 26 },
  { header: "Puesto/Zona", key: "Zona", width: 18 },
  { header: "Presentes", key: "Presentes", numFmt: FMT_INT, align: "right", width: 11 },
  { header: "Faltas", key: "Faltas", numFmt: FMT_INT, align: "right", width: 10 },
  { header: "Días de baja", key: "Días de baja", numFmt: FMT_INT, align: "right", width: 12 },
  { header: "Sin marcar", key: "Sin marcar", numFmt: FMT_INT, align: "right", width: 12 },
  { header: "% asistencia", key: "% asistencia", numFmt: FMT_PCT, align: "right", width: 13 },
];

const DETALLE_DIA_PERIODO_COLUMNAS: ColumnaTabla[] = [
  { header: "Fecha", key: "Fecha", width: 13, align: "center" },
  { header: "Trabajador", key: "Trabajador", width: 26 },
  { header: "Puesto/Zona", key: "Zona", width: 18 },
  { header: "Estado", key: "Estado", width: 16 },
];

const ESTADO_DIA_ETIQUETA: Record<string, string> = {
  presente: "Presente",
  ausente: "Ausente",
  baja: "Baja laboral",
  sinRegistrar: "Sin marcar",
};

const PRODUCTOS_CLASIFICADOS_SEMANA_COLUMNAS: ColumnaTabla[] = [
  { header: "Producto", key: "Producto", width: 28 },
  { header: "Empaque", key: "Empaque", width: 16 },
  { header: "Kg", key: "Kg", numFmt: FMT_KG, align: "right", width: 14 },
  { header: "Zona", key: "Zona", width: 16 },
  { header: "Computa", key: "Computa", width: 12, align: "center" },
];

function inicialesTrabajador(nombre: string) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return partes.slice(0, 2).map((parte) => parte[0]?.toLocaleUpperCase("es")).join("");
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const DIA_ABBR = ["dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];

function weeklyEstadoClass(status: string) {
  if (status === "presente") return "bg-success text-success-foreground";
  if (status === "ausente") return "bg-destructive text-destructive-foreground";
  if (status === "baja") return "bg-info text-info-foreground";
  return "bg-warning text-warning-foreground";
}

// ─── Cobertura: desde cuándo hasta cuándo hay información ─────────────────
// La pregunta que antes obligaba a ir pasando semana a semana hacia atrás.
// Tres cosas de un vistazo: el tramo completo con datos, cómo va el periodo
// que estás mirando, y un mapa de meses desde el que saltar a cualquiera.
function CoberturaAsistenciaPanel({
  cobertura,
  dias,
  incluirSabado,
  onIrAMes,
  onVerTodo,
}: {
  cobertura: CoberturaAsistencia | null;
  dias: string[];
  incluirSabado: boolean;
  /** Saltar al mes completo que empieza en esa fecha (chips del mapa de meses). */
  onIrAMes: (primerDiaDelMes: string) => void;
  onVerTodo: (desde: string, hasta: string) => void;
}) {
  const delPeriodo = useMemo(
    () => (cobertura ? coberturaDelPeriodo(cobertura, dias, incluirSabado) : null),
    [cobertura, dias, incluirSabado],
  );
  const meses = useMemo(
    () => (cobertura ? mesesDeCobertura(cobertura, incluirSabado) : []),
    [cobertura, incluirSabado],
  );

  if (!cobertura) {
    return <Skeleton className="h-20" />;
  }

  if (!cobertura.primera || !cobertura.ultima) {
    return (
      <div className="rounded-xl glass-accented p-4 text-sm text-muted-foreground">
        Todavía no hay ningún día de asistencia registrado.
      </div>
    );
  }

  const faltan = delPeriodo?.sinDatos ?? [];
  const faltanMuestra = faltan.slice(0, 6);

  return (
    <div className="rounded-xl glass-accented p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">Hay asistencia registrada del</span>
        <span className="font-semibold tabular-nums">{formatFechaLarga(cobertura.primera)}</span>
        <span className="text-muted-foreground">al</span>
        <span className="font-semibold tabular-nums">{formatFechaLarga(cobertura.ultima)}</span>
        <span className="text-muted-foreground">
          · {formatoEntero(cobertura.diasConRegistros)} días volcados, {formatoEntero(cobertura.diasConPresencia)} con gente trabajando
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 glass glass-hover text-xs"
          onClick={() => onVerTodo(cobertura.primera!, cobertura.ultima!)}
        >
          Ver todo
        </Button>
      </div>

      {delPeriodo && delPeriodo.laborables === 0 ? (
        <div className="text-sm text-muted-foreground">
          En el periodo que estás viendo no hay ningún día laborable del que pudiera haber datos:
          o cae antes de que arrancara el registro, o todavía no ha pasado.
        </div>
      ) : delPeriodo ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">En el periodo que estás viendo:</span>
          <span className="font-semibold tabular-nums">
            {formatoEntero(delPeriodo.conRegistros)} de {formatoEntero(delPeriodo.laborables)}
          </span>
          <span className="text-muted-foreground">
            días laborables con datos volcados
            {/* Se dice EN QUÉ TRAMO se cuenta cuando no es el periodo entero:
                antes del arranque del registro no falta nada (no había
                sistema) y después de hoy tampoco (no ha pasado). */}
            {delPeriodo.recortada && delPeriodo.ventanaDesde && delPeriodo.ventanaHasta
              ? ` (contando del ${formatFechaLarga(delPeriodo.ventanaDesde)} al ${formatFechaLarga(delPeriodo.ventanaHasta)})`
              : ""}
          </span>
          {faltan.length > 0 && (
            <span className="text-warning">
              · falta{faltan.length === 1 ? "" : "n"} por volcar {faltanMuestra.map(formatFechaLarga).join(", ")}
              {faltan.length > faltanMuestra.length ? ` y ${faltan.length - faltanMuestra.length} más` : ""}
            </span>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {meses.map((mes) => {
          const completo = mes.diasConRegistros >= mes.laborables;
          const vacio = mes.diasConRegistros === 0;
          return (
            <Button
              key={mes.mes}
              variant="ghost"
              size="sm"
              onClick={() => onIrAMes(mes.primerDia)}
              className={cn(
                "h-7 rounded-lg border px-2.5 text-xs tabular-nums",
                vacio
                  ? "border-[var(--glass-border)] text-muted-foreground/60"
                  : completo
                    ? "border-success/30 bg-success/10 text-success hover:bg-success/20"
                    : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20",
              )}
              title={`${mes.diasConRegistros} de ${mes.laborables} días laborables con datos`}
            >
              {mes.label} · {mes.diasConRegistros}/{mes.laborables}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Vista de periodo: solo asistencia/ausencias ───────────────────────────
// El dueño pidió que esta vista se centre exclusivamente en asistencia
// (presentes/ausentes/bajas/sin marcar): sin kg/persona, rendimiento por
// zona, kg por sección ni productos clasificados (eso queda solo en el
// informe Excel, que sigue llevándolo todo). buildFaltasSemanalesFnc no toca
// producción: solo asistencia_detalle + bajas laborales.
//
// Desde el 17-09-2026 el periodo ya no es forzosamente una semana, así que la
// rejilla de un cuadradito por día solo se pinta cuando CABE (hasta 31 días,
// o sea hasta un mes). Para un trimestre o una campaña se enseña el resumen
// por trabajador con su porcentaje de asistencia: 250 columnas no las lee
// nadie, y el detalle día a día está en el Excel.
const DIAS_MAX_REJILLA = 31;

function AsistenciaPeriodoView({
  periodo,
  loading,
  dias,
  incluirSabado,
  onToggleSabado,
}: {
  periodo: PeriodoAsistenciaRaw | null;
  loading: boolean;
  dias: string[];
  incluirSabado: boolean;
  onToggleSabado: () => void;
}) {
  const faltas = useMemo(() => {
    if (!periodo) return [];
    return resumirTrabajadoresPeriodo(buildFaltasSemanalesFnc(periodo, incluirSabado));
  }, [periodo, incluirSabado]);

  const totales = useMemo(() => totalesPeriodo(faltas), [faltas]);
  const conRejilla = dias.length <= DIAS_MAX_REJILLA;
  const diasLaborables = useMemo(() => getDiasLaborables(dias, incluirSabado), [dias, incluirSabado]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="panel-kicker mb-2">KPIs del periodo</p>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] p-2 shadow-[var(--glass-shadow)] sm:grid-cols-4">
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-success/25 bg-success/10 text-success">
              <UserCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-none tabular-nums text-success">{formatoEntero(totales.presentes)}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">presentes-día</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10 text-destructive">
              <UserX className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-none tabular-nums">{formatoEntero(totales.faltas)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">ausencias</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-info/25 bg-info/10 text-info">
              <ShieldOff className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-none tabular-nums">{formatoEntero(totales.conBaja)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">con baja laboral</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-warning/25 bg-warning/10 text-warning">
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-none tabular-nums">{formatoEntero(totales.sinRegistrar)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">sin marcar</p>
            </div>
          </div>
        </div>
      </div>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="border-b border-[var(--glass-border)] pb-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle className="text-lg">Asistencia por trabajador</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatoEntero(diasLaborables.length)} días laborables ({incluirSabado ? "Lun a Sáb" : "Lun a Vie"}) &middot; Domingo no laborable
                {conRejilla ? "" : " · periodo largo: el día a día está en el Excel"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={incluirSabado}
                  onChange={onToggleSabado}
                  className="h-3.5 w-3.5 rounded border-[var(--glass-border)]"
                />
                Incluir sábado
              </label>
              {conRejilla && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> Presente</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-destructive" /> Ausente</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-info" /> Baja</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-warning" /> Sin reg.</span>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                  <th className="sticky left-0 z-20 bg-[var(--glass-bg-solid)] px-3 py-3 text-left text-xs font-bold uppercase text-muted-foreground">Trabajador</th>
                  <th className="px-3 py-3 text-left text-xs font-bold uppercase text-muted-foreground">Zona</th>
                  {conRejilla && dias.map((date) => {
                    const d = new Date(date + "T12:00:00");
                    const esDomingo = d.getDay() === 0;
                    const esSabado = d.getDay() === 6;
                    const noLaborable = esDomingo || (esSabado && !incluirSabado);
                    return (
                      <th key={date} className={cn("text-center px-2 py-3 text-xs font-bold uppercase", noLaborable ? "text-muted-foreground/40" : "text-muted-foreground")}>
                        <div>{DIA_ABBR[d.getDay()]}</div>
                        <div className="text-[10px] font-normal">{d.getDate()}</div>
                        {noLaborable && <div className="text-[8px] font-normal mt-0.5">festivo</div>}
                      </th>
                    );
                  })}
                  <th className="text-center px-2 py-3 text-xs font-bold uppercase text-muted-foreground">Faltas</th>
                  <th className="text-center px-2 py-3 text-xs font-bold uppercase text-muted-foreground">Bajas</th>
                  <th className="text-center px-2 py-3 text-xs font-bold uppercase text-muted-foreground">Pres.</th>
                  <th className="text-center px-2 py-3 text-xs font-bold uppercase text-muted-foreground">Sin marcar</th>
                  <th className="text-center px-2 py-3 text-xs font-bold uppercase text-muted-foreground">% asist.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--glass-border)]">
                {faltas.length === 0 ? (
                  <tr>
                    <td colSpan={conRejilla ? dias.length + 6 : 6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Sin datos de asistencia en este periodo.
                    </td>
                  </tr>
                ) : (
                  faltas.map((row, index) => {
                    const zebraClass = index % 2 === 1 ? "bg-[var(--glass-bg)]" : "bg-[var(--glass-bg-strong)]";
                    return (
                      <tr key={row.trabajadorId} className={cn("hover:bg-[var(--color-surface-hover)]", zebraClass)}>
                        <td className="sticky left-0 z-10 bg-[var(--glass-bg-solid)] px-3 py-2 text-sm font-semibold">{row.nombre}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{row.zona ?? "—"}</td>
                        {conRejilla && dias.map((date) => {
                          const status = row.days[date] ?? "sinRegistrar";
                          return (
                            <td key={date} className="px-2 py-2 text-center">
                              <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold", weeklyEstadoClass(status))}>
                                {status === "presente" ? "P" : status === "ausente" ? "A" : status === "baja" ? "B" : "?"}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-center text-sm font-semibold text-destructive">{row.totalFaltas || "—"}</td>
                        <td className="px-2 py-2 text-center text-sm font-semibold text-info">{row.totalBajas || "—"}</td>
                        <td className="px-2 py-2 text-center text-sm font-semibold text-success">{row.totalPresentes || "—"}</td>
                        <td className="px-2 py-2 text-center text-sm text-warning">{row.totalSinRegistrar || "—"}</td>
                        <td className="px-2 py-2 text-center text-sm font-semibold tabular-nums">
                          {row.diasComputados > 0 ? `${Math.round(row.pctAsistencia)} %` : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
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

interface ImportacionPendiente {
  mode: "daily" | "weekly";
  /** Fechas afectadas por esta importacion (una para diario, N para semanal). */
  dates: string[];
  noResueltos: TrabajadorNoResuelto<TrabajadorRow>[];
  resueltosCount: number;
  /** Nombre -> fechas en las que ese nombre concreto figuraba como presente en el Excel. */
  fechasPorNombre: Map<string, string[]>;
}

export default function Asistencia() {
  const { user } = useAuth();
  const { aliasPorNombre, guardarAlias } = useTrabajadoresAlias();
  const { trabajadores, crearTrabajador } = useAsistenciaTrabajadores();
  const [importacionPendiente, setImportacionPendiente] = useState<ImportacionPendiente | null>(null);
  const [nuevoTrabajadorZonaPorNombre, setNuevoTrabajadorZonaPorNombre] = useState<Record<string, string>>({});
  const [vinculandoNombre, setVinculandoNombre] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(today());
  const {
    data: asistenciaDiaData,
    isFetching: loadingAsistencia,
    toggleAsistencia: toggleAsistenciaMutation,
    limpiarAsistenciaDia: limpiarAsistenciaDiaMutation,
    marcarTodosPresentes: marcarTodosPresentesMutation,
  } = useAsistenciaDia(selectedDate);
  const asistencia = asistenciaDiaData?.asistencia ?? {};
  const asistenciaMotivos = asistenciaDiaData?.asistenciaMotivos ?? {};
  const upsertRegistros = useUpsertAsistenciaRegistros();
  // Horas de limpieza de box del día → fracción de jornada fuera de línea,
  // descontada del rendimiento por zonas (igual que en el detalle del parte).
  const { data: jornadaFueraLineaDia } = useLimpiezaJornadaFueraLinea(selectedDate);
  const [grupos] = useState<string[]>(loadStoredGrupos);
  const [importingMode, setImportingMode] = useState<"daily" | "weekly" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [workerFilter, setWorkerFilter] = useState<WorkerFilter>("todos");
  const [selectedGroup, setSelectedGroup] = useState("todos");
  const { parteDelDia } = useParteDelDia(selectedDate);
  const [exportingAsistencia, setExportingAsistencia] = useState<"excel" | "pdf" | "lista" | "parte" | null>(null);
  const [viewMode, setViewMode] = useState<"daily" | "periodo">("daily");
  // El periodo arranca en la semana de hoy (lo de siempre), pero ya puede ser
  // un mes, una campaña o un rango a mano: el selector manda y todo lo demás
  // (carga, tabla y Excel) se calcula de `periodo.desde`/`periodo.hasta`.
  const [periodo, setPeriodo] = useState<PeriodoValue>(() => hoyPeriodo("semana"));
  const diasPeriodo = useMemo(() => enumerarDias(periodo.desde, periodo.hasta), [periodo.desde, periodo.hasta]);
  const { periodoData, isFetching: loadingPeriodo } = useAsistenciaPeriodo(periodo.desde, periodo.hasta, viewMode === "periodo");
  const { cobertura } = useAsistenciaCobertura();
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

  async function exportarAsistencia(tipo: "excel" | "pdf") {
    setExportingAsistencia(tipo);

    try {
      const semanas = await cargarSemanasAsistenciaExportables();
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
        await exportEficienciaToExcel(semanas, resumen);
      } else {
        await exportEficienciaToPDF(semanas, resumen);
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
      const workbook = createWorkbook("Lasarte Cítricos S.L. - Lista de trabajadores", "Plantilla operativa de trabajadores");
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

  async function exportarParteDiarioAsistencia() {
    setExportingAsistencia("parte");
    try {
      const ctx = crearLibroLasarte({
        titulo: "Parte diario de asistencia",
        periodo: selectedDate,
        clasificacion: "RRHH",
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Resumen",
        columnas: RESUMEN_ASISTENCIA_COLUMNAS,
        filas: [
          { Campo: "Fecha", Valor: selectedDate },
          { Campo: "Trabajadores activos", Valor: totalActivos },
          { Campo: "Presentes", Valor: presentesCount },
          { Campo: "Ausentes", Valor: ausentesSinBajaTrabajadores.length },
          { Campo: "Baja laboral", Valor: bajaLaboralTrabajadores.length },
          { Campo: "Sin marcar", Valor: sinRegistro },
          { Campo: "Presentes kg/persona", Valor: presentesComputables },
          { Campo: "Kg produccion", Valor: Math.round(kgProduccionDia) },
          { Campo: "Kg/persona general", Valor: Math.round(kgPersonaLista) },
        ],
        freeze: false,
        autofilter: false,
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Rendimiento zonas",
        columnas: RENDIMIENTO_ZONAS_DIA_COLUMNAS,
        filas: kgPorConfeccion.map((zona) => ({
          ...buildRendimientoZonaExportRow(zona, ""),
          "Porcentaje kg": zona.porcentajeKg,
        })),
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Faltas",
        columnas: FALTAS_DIA_COLUMNAS,
        filas: [
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
        ],
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Trabajadores dia",
        columnas: TRABAJADORES_DIA_COLUMNAS,
        filas: activos
          .slice()
          .sort((a, b) => (a.zona ?? "").localeCompare(b.zona ?? "", "es") || a.nombre.localeCompare(b.nombre, "es"))
          .map((trabajador) => {
            const metric = listaKgPersonaById.get(trabajador.id);
            const estado = estadoTrabajadorExport(trabajador);
            const base = buildTrabajadorDiaExportRow({
              nombre: trabajador.nombre,
              zona: trabajador.zona,
              estado,
              coste: metric?.coste ?? "",
              calculo: metric?.calculo ?? "",
              kgRef: metric?.kgRef,
            });
            return {
              Fecha: selectedDate,
              ...base,
              "Motivo ausencia": estado === "Ausente" ? asistenciaMotivos[trabajador.id] ?? "" : "",
            };
          }),
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Productos clasificados",
        columnas: PRODUCTOS_CLASIFICADOS_DIA_COLUMNAS,
        filas: productosInformeClasificados.map(buildProductoClasificadoExportRow),
      });

      await descargarLibro(ctx, `parte_asistencia_${selectedDate}.xlsx`);
      toast({ title: "Parte diario descargado", description: selectedDate });
    } catch (err) {
      toast({ title: "Error al exportar parte diario", description: errorMessage(err), variant: "destructive" });
    } finally {
      setExportingAsistencia(null);
    }
  }

  /**
   * El informe de un periodo cualquiera (la semana que estás viendo, un mes,
   * una campaña entera o un rango a mano). Antes solo sabía exportar la
   * semana cargada en pantalla; ahora recarga el rango que se le pide, así
   * que "toda la campaña" sale igual de bien sin tener que ir semana a semana.
   *
   * Los datos se piden de nuevo a propósito (no se reaprovecha lo que hay en
   * pantalla): la vista de pantalla es solo asistencia y no trae la
   * producción, que este Excel sí lleva.
   */
  async function exportarInformePeriodo(desde: string, hasta: string, etiqueta: string, nombreFichero: string) {
    setExportingAsistencia("excel");
    try {
      // El futuro no se exporta: "Campaña entera" del 1 de septiembre llega
      // hasta el 31 de agosto siguiente, y sacar 250 días de "sin marcar" que
      // aún no han pasado no es un informe, es ruido. Se corta en hoy y se
      // dice en la hoja Resumen.
      const hoy = today();
      const hastaReal = hasta < hoy ? hasta : hoy;
      const recortadoAHoy = hastaReal !== hasta;
      const dias = enumerarDias(desde, hastaReal);
      if (dias.length === 0) {
        toast({
          title: "Nada que exportar",
          description: "Ese periodo no tiene ningún día pasado: empieza más adelante de hoy.",
          variant: "destructive",
        });
        return;
      }

      const [datos, partes] = await Promise.all([
        cargarAsistenciaPeriodo(desde, hastaReal),
        cargarProduccionPeriodo(desde, hastaReal),
      ]);
      const periodoConProduccion: PeriodoAsistenciaRaw = { ...datos, partes };

      const faltas = buildFaltasSemanalesFnc(periodoConProduccion, incluirSabado);
      const resumenTrabajadores = resumirTrabajadoresPeriodo(faltas);
      const totales = totalesPeriodo(faltas);
      const kgP = calcularKgPersonaSemanal(periodoConProduccion, incluirSabado);
      const grupos = calcularRendimientoGrupoSemanal(periodoConProduccion, incluirSabado);
      const secciones = calcularKgSeccionSemanal(periodoConProduccion, incluirSabado);
      const productos = productosClasificadosSemanales(periodoConProduccion, incluirSabado);
      const laborables = getDiasLaborables(dias, incluirSabado);
      const laborablesSet = new Set(laborables);
      const marcasPorDia = contarMarcasPorDia(periodoConProduccion.asistencia);
      const laborablesSinDatos = laborables.filter((dia) => !marcasPorDia.has(dia));

      const ctx = crearLibroLasarte({
        titulo: `Informe de asistencia · ${etiqueta}`,
        periodo: `${desde} a ${hastaReal}`,
        clasificacion: "RRHH",
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Resumen",
        columnas: RESUMEN_ASISTENCIA_COLUMNAS,
        filas: [
          { Campo: "Periodo", Valor: etiqueta },
          { Campo: "Desde", Valor: desde },
          { Campo: "Hasta", Valor: hastaReal },
          ...(recortadoAHoy ? [{ Campo: "Nota", Valor: `El periodo llega al ${hasta}; se corta hoy porque el resto no ha pasado` }] : []),
          { Campo: "Días laborables", Valor: incluirSabado ? "Lun a Sáb" : "Lun a Vie" },
          { Campo: "Días laborables del periodo", Valor: laborables.length },
          { Campo: "Días laborables sin datos volcados", Valor: laborablesSinDatos.length },
          { Campo: "Días con producción", Valor: kgP.diasConDatos },
          { Campo: "Kg totales", Valor: Math.round(kgP.totalKg) },
          { Campo: "Media personas/dia total", Valor: +kgP.mediaPersonasTotales.toFixed(1) },
          { Campo: "Media personas/dia computables", Valor: +kgP.mediaPersonasComputables.toFixed(1) },
          { Campo: "Kg/persona del periodo", Valor: Math.round(kgP.kgPersona) },
          { Campo: "Presentes-día", Valor: totales.presentes },
          { Campo: "Total ausencias", Valor: totales.faltas },
          { Campo: "Días de baja laboral", Valor: totales.bajas },
          { Campo: "Trabajadores con baja laboral", Valor: totales.conBaja },
          { Campo: "Marcas sin registrar", Valor: totales.sinRegistrar },
        ],
        freeze: false,
        autofilter: false,
      });

      // Hoja de cobertura: día a día, qué hay volcado y qué no. Es la que
      // contesta en papel "¿de qué días tengo información?".
      añadirHojaTabla(ctx, {
        nombreHoja: "Cobertura por dia",
        columnas: COBERTURA_DIA_COLUMNAS,
        filas: dias.map((dia) => {
          const d = new Date(dia + "T12:00:00");
          const esLaborable = laborablesSet.has(dia);
          const marcas = marcasPorDia.get(dia);
          const parte = periodoConProduccion.partes[dia];
          const kg = parte ? produccionRealParte(parte) || Number(parte.kg_produccion_calibrador) || 0 : 0;
          return {
            Fecha: dia,
            Dia: DIA_ABBR[d.getDay()],
            Laborable: esLaborable ? "Sí" : "No",
            Registros: marcas?.registros ?? 0,
            Presentes: marcas?.presentes ?? 0,
            Ausentes: (marcas?.registros ?? 0) - (marcas?.presentes ?? 0),
            Kg: Math.round(kg),
            Estado: marcas ? "Con datos" : esLaborable ? "Sin datos volcados" : "No laborable",
          };
        }),
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Asistencia por trabajador",
        columnas: ASISTENCIA_TRABAJADOR_PERIODO_COLUMNAS,
        filas: resumenTrabajadores.map((r) => ({
          Trabajador: r.nombre,
          Zona: normalizeAsistenciaExportZona(r.zona),
          Presentes: r.totalPresentes,
          Faltas: r.totalFaltas,
          "Días de baja": r.totalBajas,
          "Sin marcar": r.totalSinRegistrar,
          "% asistencia": r.diasComputados > 0 ? +r.pctAsistencia.toFixed(2) : "",
        })),
      });

      // Detalle crudo trabajador × día laborable: lo que RRHH necesita para
      // cuadrar nóminas o revisar una campaña entera fuera de la herramienta.
      añadirHojaTabla(ctx, {
        nombreHoja: "Detalle por dia",
        columnas: DETALLE_DIA_PERIODO_COLUMNAS,
        filas: resumenTrabajadores.flatMap((r) =>
          laborables.map((dia) => ({
            Fecha: dia,
            Trabajador: r.nombre,
            Zona: normalizeAsistenciaExportZona(r.zona),
            Estado: ESTADO_DIA_ETIQUETA[r.days[dia] ?? "sinRegistrar"],
          })),
        ),
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Rendimiento zonas",
        columnas: RENDIMIENTO_ZONAS_SEMANA_COLUMNAS,
        filas: grupos.map((g: { label: string; totalKg: number; totalPersonasDia: number; mediaPersonasDia: number; kgPersona: number; porcentajeKg: number }) => ({
          Zona: normalizeAsistenciaExportZona(g.label),
          "Kg totales": Math.round(g.totalKg),
          "Personas-dia": g.totalPersonasDia,
          "Media pers/dia": +g.mediaPersonasDia.toFixed(1),
          "Kg/persona": Math.round(g.kgPersona),
          "%": g.porcentajeKg,
        })),
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Kg por seccion",
        columnas: KG_SECCION_SEMANA_COLUMNAS,
        filas: secciones.map((s: { zona: string; kg: number; computa: boolean }) => ({
          Seccion: s.zona,
          Kg: Math.round(s.kg),
          Computa: s.computa ? "Si" : "No",
        })),
      });

      añadirHojaTabla(ctx, {
        nombreHoja: "Productos clasificados",
        columnas: PRODUCTOS_CLASIFICADOS_SEMANA_COLUMNAS,
        filas: productos.map((p: { producto: string; empaque: string; kg: number; zona: string; computa: boolean }) => ({
          Producto: p.producto,
          Empaque: p.empaque,
          Kg: Math.round(p.kg),
          Zona: p.zona,
          Computa: p.computa ? "Si" : "No",
        })),
      });

      await descargarLibro(ctx, nombreFichero);
      toast({
        title: "Informe descargado",
        description: recortadoAHoy ? `${etiqueta} (hasta hoy, ${hastaReal})` : etiqueta,
      });
    } catch (err) {
      toast({ title: "Error al exportar", description: errorMessage(err), variant: "destructive" });
    } finally {
      setExportingAsistencia(null);
    }
  }

  /** El periodo que hay elegido en el selector, tal cual. */
  function exportarPeriodoExcel() {
    return exportarInformePeriodo(
      periodo.desde,
      periodo.hasta,
      formatPeriodoLabel(periodo),
      `asistencia_${periodo.desde}_${periodo.hasta}.xlsx`,
    );
  }

  /**
   * La campaña cítricola (1 sep – 31 ago) que contiene el periodo elegido,
   * entera, sin tener que cambiar antes el selector.
   */
  function exportarCampanaExcel() {
    const campana = periodoDeFecha("campana", periodo.desde);
    return exportarInformePeriodo(
      campana.desde,
      campana.hasta,
      campana.label,
      `asistencia_campana_${campana.desde}_${campana.hasta}.xlsx`,
    );
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ASISTENCIA_GROUPS_STORAGE_KEY, JSON.stringify(grupos));
    }
  }, [grupos]);

  // ─── Nombres sin asignar (importaciones Excel) ─────────────────────────
  // Principio: ningun nombre se pierde en silencio. Vincular guarda el alias
  // para siempre (proximas importaciones ya lo resuelven solas) y aplica la
  // asistencia de ese nombre retroactivamente en las fechas de ESTA
  // importacion, sin tocar el upsert ya realizado para los nombres resueltos.
  function quitarNombrePendiente(nombre: string) {
    setImportacionPendiente((prev) => {
      if (!prev) return prev;
      const noResueltos = prev.noResueltos.filter((item) => item.nombre !== nombre);
      if (noResueltos.length === 0) return null;
      return { ...prev, noResueltos };
    });
  }

  async function vincularNombrePendiente(nombre: string, trabajadorId: string) {
    if (!user || !importacionPendiente) return;
    setVinculandoNombre(nombre);
    try {
      await guardarAlias.mutateAsync({ trabajadorId, alias: nombre });

      const fechas = importacionPendiente.fechasPorNombre.get(nombre) ?? [];
      if (fechas.length > 0) {
        const records = fechas.map((date) => ({
          user_id: user.id,
          date,
          trabajador_id: trabajadorId,
          presente: true,
          motivo_ausencia: null,
        }));
        await upsertRegistros.mutateAsync(records);
      }

      quitarNombrePendiente(nombre);
      toast({ title: `"${nombre}" vinculado`, description: "El alias se recordará en futuras importaciones." });
    } catch (err: unknown) {
      toast({ title: "Error al vincular", description: errorMessage(err), variant: "destructive" });
    } finally {
      setVinculandoNombre(null);
    }
  }

  async function crearTrabajadorYVincular(nombre: string) {
    if (!user) return;
    setVinculandoNombre(nombre);
    try {
      const zona = nuevoTrabajadorZonaPorNombre[nombre] || null;
      const data = await crearTrabajador.mutateAsync({ userId: user.id, nombre, zona });
      await vincularNombrePendiente(nombre, data.id as string);
    } catch (err: unknown) {
      toast({ title: "Error al crear trabajador", description: errorMessage(err), variant: "destructive" });
    } finally {
      setVinculandoNombre(null);
    }
  }

  // ─── Asistencia CRUD ──────────────────────────────────────────────────

  async function toggleAsistencia(trabajadorId: string, presente: boolean, motivoAusencia: string | null = null) {
    if (!user) return;
    toggleAsistenciaMutation.mutate({ trabajadorId, presente, motivoAusencia, userId: user.id });
  }

  async function limpiarAsistenciaDia() {
    if (!user) return;
    limpiarAsistenciaDiaMutation.mutate();
  }

  async function marcarTodosPresentes() {
    if (!user) return;
    const activos = trabajadores.filter((t) => t.activo);
    marcarTodosPresentesMutation.mutate({ activos, userId: user.id });
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

      const records = buildAttendanceRecords(nombresImport, activos, user.id, selectedDate, aliasPorNombre)
        .map((record) => ({ ...record, motivo_ausencia: null }));

      await upsertRegistros.mutateAsync(records);

      // Nunca se pierde un nombre en silencio: cualquier nombre del Excel que
      // no case con ningun trabajador activo (ni por nombre ni por alias) se
      // muestra en el panel "Nombres sin asignar" con sugerencias.
      const resolucion = resolveTrabajadoresPorLista(activos, nombresImport, aliasPorNombre);
      const fechasPorNombre = new Map<string, string[]>(
        resolucion.noResueltos.map((item) => [item.nombre, [selectedDate]]),
      );

      const presentes = records.filter((r) => r.presente).length;
      if (resolucion.noResueltos.length > 0) {
        setImportacionPendiente({
          mode: "daily",
          dates: [selectedDate],
          noResueltos: resolucion.noResueltos,
          resueltosCount: resolucion.matches.length + resolucion.inactive.length,
          fechasPorNombre,
        });
      }

      toast({
        title: `Diario importado — ${presentes} presentes de ${records.length} trabajadores`,
        description: resolucion.noResueltos.length > 0
          ? `${resolucion.noResueltos.length} nombre(s) del Excel sin asignar — revisa el panel.`
          : "Todos los nombres del Excel se resolvieron correctamente.",
        variant: resolucion.noResueltos.length > 0 ? "destructive" : undefined,
      });
    } catch (err: unknown) {
      toast({ title: "Error al importar", description: errorMessage(err), variant: "destructive" });
    }

    setImportingMode(null);
    e.target.value = "";
  }, [trabajadores, selectedDate, user, aliasPorNombre, upsertRegistros]);

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
        .flatMap((day) => buildAttendanceRecords(day.names, activos, user.id, day.date, aliasPorNombre))
        .map((record) => ({ ...record, motivo_ausencia: null }));
      if (records.length === 0) {
        toast({ title: "No hay registros para importar", variant: "destructive" });
        setImportingMode(null);
        e.target.value = "";
        return;
      }

      await upsertRegistros.mutateAsync(records);

      // Igual que en la importacion diaria: ningun nombre del Excel se
      // descarta en silencio. Se agrega por nombre normalizado a traves de
      // todos los dias de la semana para poder aplicar la asistencia
      // retroactivamente en cuanto el dueño vincule el nombre.
      const noResueltosPorNombre = new Map<string, TrabajadorNoResuelto<TrabajadorRow>>();
      const fechasPorNombre = new Map<string, string[]>();
      let totalResueltos = 0;
      for (const day of days) {
        const resolucionDia = resolveTrabajadoresPorLista(activos, day.names, aliasPorNombre);
        totalResueltos += resolucionDia.matches.length + resolucionDia.inactive.length;
        for (const item of resolucionDia.noResueltos) {
          if (!noResueltosPorNombre.has(item.nombre)) noResueltosPorNombre.set(item.nombre, item);
          fechasPorNombre.set(item.nombre, [...(fechasPorNombre.get(item.nombre) ?? []), day.date]);
        }
      }
      const noResueltos = Array.from(noResueltosPorNombre.values());

      const presentes = records.filter((record) => record.presente).length;
      if (noResueltos.length > 0) {
        setImportacionPendiente({
          mode: "weekly",
          dates: days.map((day) => day.date),
          noResueltos,
          resueltosCount: totalResueltos,
          fechasPorNombre,
        });
      }

      toast({
        title: `Semanal importado — ${days.length} día(s) detectado(s)`,
        description: noResueltos.length > 0
          ? `${presentes} presentes guardados. ${noResueltos.length} nombre(s) sin asignar — revisa el panel.`
          : `${presentes} presentes guardados sobre ${records.length} registros.`,
        variant: noResueltos.length > 0 ? "destructive" : undefined,
      });
    } catch (err: unknown) {
      toast({ title: "Error al importar semanal", description: errorMessage(err), variant: "destructive" });
    }

    setImportingMode(null);
    e.target.value = "";
  }, [trabajadores, selectedDate, user, aliasPorNombre, upsertRegistros]);

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
    jornadaFueraLinea: jornadaFueraLineaDia ?? {},
  }), [activos, asistencia, rendimientoConfeccion, jornadaFueraLineaDia]);
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

  // ─── Eficiencia histórica ──────────────────────────────────────────────
  // Datos históricos calculados para uso futuro (aún sin panel de visualización dedicado).
  const { eficiencia, isLoading: loadingEficiencia } = useAsistenciaEficiencia();
  void eficiencia;
  void loadingEficiencia;

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
              <span className="font-semibold">
                {formatPeriodoLabel(periodo)} · {formatoEntero(contarDias(periodo.desde, periodo.hasta))} días
              </span>
            )}
          </p>
          <Link
            to="/costes/asistencia/comparativa"
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Comparativa semanal →
          </Link>
        </div>
        <div className="flex rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0.5">
          <Button
            variant={viewMode === "daily" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("daily")}
            className={cn("h-8 rounded-lg px-3 text-xs", viewMode !== "daily" && "text-muted-foreground")}
          >
            <CalendarDays className="h-3.5 w-3.5 mr-1" /> Día
          </Button>
          <Button
            variant={viewMode === "periodo" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("periodo")}
            className={cn("h-8 rounded-lg px-3 text-xs", viewMode !== "periodo" && "text-muted-foreground")}
          >
            <CalendarRange className="h-3.5 w-3.5 mr-1" /> Periodo
          </Button>
        </div>
      </header>

      <Dialog
        open={importacionPendiente !== null}
        onOpenChange={(open) => { if (!open) setImportacionPendiente(null); }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nombres sin asignar</DialogTitle>
          </DialogHeader>
          {importacionPendiente ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {importacionPendiente.resueltosCount} nombre(s) se importaron correctamente.{" "}
                {importacionPendiente.noResueltos.length} no se pudieron emparejar con ningún trabajador.
                Vincula cada uno a un trabajador (se recordará para siempre) o crea uno nuevo.
              </p>
              <div className="space-y-3">
                {importacionPendiente.noResueltos.map((item) => (
                  <div key={item.nombre} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm">{item.nombre}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        disabled={vinculandoNombre === item.nombre}
                        onClick={() => quitarNombrePendiente(item.nombre)}
                      >
                        <X className="h-3.5 w-3.5 mr-1" /> Omitir
                      </Button>
                    </div>

                    {item.sugerencias.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {item.sugerencias.map((sugerencia) => (
                          <Button
                            key={sugerencia.trabajadorId}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs glass glass-hover"
                            disabled={vinculandoNombre === item.nombre}
                            onClick={() => void vincularNombrePendiente(item.nombre, sugerencia.trabajadorId)}
                          >
                            Vincular a {sugerencia.nombre}
                            <Badge variant="secondary" className="ml-1.5 rounded-full text-[10px]">
                              {Math.round(sugerencia.score * 100)}%
                            </Badge>
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Sin sugerencias razonables.</p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Select
                        disabled={vinculandoNombre === item.nombre}
                        onValueChange={(value) => void vincularNombrePendiente(item.nombre, value)}
                      >
                        <SelectTrigger className="h-8 min-w-[200px] flex-1 text-xs">
                          <SelectValue placeholder="Vincular a otro trabajador..." />
                        </SelectTrigger>
                        <SelectContent>
                          {trabajadores.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.nombre}{!t.activo ? " (inactivo)" : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={nuevoTrabajadorZonaPorNombre[item.nombre] || "__none__"}
                        onValueChange={(value) => setNuevoTrabajadorZonaPorNombre((prev) => ({ ...prev, [item.nombre]: value === "__none__" ? "" : value }))}
                      >
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                          <SelectValue placeholder="Zona (nuevo)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin grupo</SelectItem>
                          {gruposDisponibles.map((z) => (
                            <SelectItem key={z} value={z}>{z}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs glass glass-hover"
                        disabled={vinculandoNombre === item.nombre}
                        onClick={() => void crearTrabajadorYVincular(item.nombre)}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Crear trabajador nuevo
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Toolbar única: navegación + acciones ────────────────── */}
      <div className="section-toolbar glass-overlay sticky top-14 z-10 flex flex-wrap items-center gap-2 sm:top-16">
        <div className="flex flex-wrap items-center gap-2">
          {viewMode === "daily" ? (
            <SelectorPeriodo
              bare
              value={{ modo: "dia", desde: selectedDate, hasta: selectedDate }}
              onChange={(next) => setSelectedDate(next.desde)}
            />
          ) : (
            // Semana / Mes / Campaña / Rango: el mismo selector de toda la
            // herramienta, ahora con todas sus granularidades — antes esta
            // página solo dejaba pasar de semana en semana.
            <SelectorPeriodo
              bare
              modos={["semana", "mes", "campana", "rango"]}
              value={periodo}
              onChange={setPeriodo}
            />
          )}
        </div>

        <div className="mx-1 hidden h-6 w-px bg-[var(--glass-border)] sm:block" />

        <div className="flex flex-wrap items-center gap-2">
          {viewMode === "daily" && (
            <>
              <label className="relative">
                <input type="file" accept=".xlsx,.xls" className="absolute inset-0 opacity-0 cursor-pointer peer" onChange={handleDailyImportXLSX} disabled={importing} />
                <Button variant="outline" size="sm" disabled={importing} asChild className="glass transition-shadow duration-300 peer-hover:shadow-[var(--glass-shadow),var(--glass-glow)]">
                  <span className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-1.5" />
                    {importingMode === "daily" ? "Importando..." : "Importar día"}
                  </span>
                </Button>
              </label>
              <label className="relative">
                <input type="file" accept=".xlsx,.xls" className="absolute inset-0 opacity-0 cursor-pointer peer" onChange={handleWeeklyImportXLSX} disabled={importing} />
                <Button variant="outline" size="sm" disabled={importing} asChild className="glass transition-shadow duration-300 peer-hover:shadow-[var(--glass-shadow),var(--glass-glow)]">
                  <span className="cursor-pointer">
                    <CalendarDays className="h-4 w-4 mr-1.5" />
                    {importingMode === "weekly" ? "Importando..." : "Importar semana"}
                  </span>
                </Button>
              </label>
            </>
          )}
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
                  <DropdownMenuItem disabled={exportingAsistencia !== null} onSelect={() => void exportarParteDiarioAsistencia()}>
                    <FileText className="mr-2 h-4 w-4" />
                    Parte diario Excel
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem disabled={exportingAsistencia !== null} onSelect={() => void exportarPeriodoExcel()}>
                    <FileText className="mr-2 h-4 w-4" />
                    Periodo elegido Excel
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={exportingAsistencia !== null} onSelect={() => void exportarCampanaExcel()}>
                    <CalendarRange className="mr-2 h-4 w-4" />
                    Campaña entera Excel
                  </DropdownMenuItem>
                </>
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
        </div>
      </div>

      {viewMode === "periodo" ? (
        <div className="space-y-6">
          <CoberturaAsistenciaPanel
            cobertura={cobertura}
            dias={diasPeriodo}
            incluirSabado={incluirSabado}
            onIrAMes={(primerDiaDelMes) => setPeriodo(periodoDeFecha("mes", primerDiaDelMes))}
            onVerTodo={(desde, hasta) => setPeriodo(rangoPersonalizado(desde, hasta))}
          />
          <AsistenciaPeriodoView
            periodo={periodoData}
            loading={loadingPeriodo}
            dias={diasPeriodo}
            incluirSabado={incluirSabado}
            onToggleSabado={toggleIncluirSabado}
          />
        </div>
      ) : (
      <div className="space-y-6">
      <div>
        <p className="panel-kicker mb-2">KPIs del día</p>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] p-2 shadow-[var(--glass-shadow)] sm:grid-cols-4">
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-success/25 bg-success/10 text-success">
              <UserCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-none tabular-nums text-success">{asistenciaPct}%</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{presentesCount}/{totalActivos} presentes</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10 text-destructive">
              <UserX className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-none tabular-nums">{ausentesSinBajaTrabajadores.length}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">ausentes</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-warning/25 bg-warning/10 text-warning">
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-none tabular-nums">{sinRegistro}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">sin marcar</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
              <PackageCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-none tabular-nums">{presentesComputables}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">entran en kg/p</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Detalle: control diario ─────────────────────────────── */}
      <div>
        <p className="panel-kicker mb-2">Detalle por trabajador</p>
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
              {/* Search bar */}
              <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar trabajador o grupo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 pl-9 text-sm"
                />
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
                  <p className="text-xs mt-1">Gestiona la plantilla desde RRHH → Plantilla</p>
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
                          <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Trabajador</th>
                                  <th className="hidden sm:table-cell">Zona</th>
                                  <th className="text-right">Kg/p</th>
                                  <th className="text-center">Estado</th>
                                  <th className="text-right">Presente</th>
                                </tr>
                              </thead>
                              <tbody>
                                {workers.map((t, index) => {
                                  const presente = asistencia[t.id];
                                  const metric = listaKgPersonaById.get(t.id);
                                  const bajaLaboral = asistenciaMotivos[t.id] === BAJA_LABORAL_MOTIVO;
                                  const estadoLabel = presente === true ? "Presente" : presente === false ? (bajaLaboral ? "Baja laboral" : "Ausente") : "Pendiente";
                                  const estadoClass =
                                    presente === true
                                      ? "border-success/40 bg-success/10 text-success"
                                      : presente === false
                                        ? bajaLaboral
                                          ? "border-info/40 bg-info/10 text-info"
                                          : "border-destructive/40 bg-destructive/10 text-destructive"
                                        : "border-warning/40 bg-warning/10 text-warning";
                                  return (
                                    <tr
                                      key={t.id}
                                      className={cn(index % 2 === 1 && "bg-[var(--glass-bg)]")}
                                    >
                                      <td>
                                        <div className="flex items-center gap-2.5">
                                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-xs font-semibold">
                                            {inicialesTrabajador(t.nombre)}
                                          </div>
                                          <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold leading-tight">{t.nombre}</p>
                                            <p className="truncate text-xs text-muted-foreground sm:hidden">{t.zona ?? "Sin grupo"}</p>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="hidden text-sm text-muted-foreground sm:table-cell">{t.zona ?? "—"}</td>
                                      <td className="text-right text-sm font-semibold tabular-nums">
                                        {presente === true && metric?.kgRef !== null && metric?.kgRef !== undefined
                                          ? formatoEntero(metric.kgRef)
                                          : "—"}
                                      </td>
                                      <td className="text-center">
                                        <Badge variant="outline" className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", estadoClass)}>
                                          {estadoLabel}
                                        </Badge>
                                      </td>
                                      <td className="text-right">
                                        <Switch
                                          checked={presente === true}
                                          onCheckedChange={(checked) => toggleAsistencia(t.id, checked)}
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
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
      </div>
      )}
    </div>
  );
}
