/**
 * HistoricoImport — "Importar histórico": carga el histórico de campaña
 * completa en tres pestañas:
 *   - Producción: export "Informe PRODUCCION" del calibrador (ver
 *     src/lib/historicoProduccion.ts / src/hooks/useHistoricoImport.ts,
 *     import a partes_diarios/lotes_dia).
 *   - Palets: export del programa de gestión de palets (ver
 *     src/lib/historicoPalets.ts / src/hooks/useHistoricoImport.ts, import a
 *     partes_diarios/palets_dia con dedup a dos niveles: insert en fechas sin
 *     palets previos, backfill de lote_codigo en fechas que ya los tienen).
 *   - Informes de lote: "Informe LOTE" del calibrador, UN archivo por pasada
 *     de lote, subidos por tandas de 50+ (ver src/lib/informeLote.ts /
 *     useInformesLoteImport en useHistoricoImport.ts): clasificación real a
 *     lote_clasificacion + reparación de lotes expedidos-sin-procesado en
 *     lotes_dia.
 *
 * Gate interno de admin (no en RoleRoute): el espacio de producción ya
 * permite admin+operario, pero este import de campaña completa es una
 * operación delicada (crea partes/palets históricos) — solo administración.
 */
import { useRef, useState, type DragEvent } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileStack, History, Loader2, PackageSearch, ShieldAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FuenteBadge } from "@/components/FuenteBadge";
import { MiniKpi } from "@/components/MiniKpi";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import {
  agruparFilasProduccionPorFechaLote,
  planImportInformesLote,
  useHistoricoImport,
  useHistoricoImportPalets,
  useInformesLoteImport,
  type ArchivoInformeLote,
  type ImportarHistoricoPaletsResumen,
  type ImportarHistoricoResumen,
  type ImportarInformesLoteResumen,
  type PlanImportInformesLote,
} from "@/hooks/useHistoricoImport";
import { parseInformeLoteRows } from "@/lib/informeLote";
import {
  extraerResumenDeclaradoInforme,
  parseInformeProduccionRows,
  resumirInformeProduccion,
  type FilaInformeProduccion,
  type ResumenDeclaradoInforme,
  type ResumenInformeProduccion,
} from "@/lib/historicoProduccion";
import {
  parseInformePaletsRows,
  resumirInformePalets,
  type FilaInformePalets,
  type ResumenInformePalets,
} from "@/lib/historicoPalets";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKgCompact as formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PreviewInforme {
  fileName: string;
  filas: FilaInformeProduccion[];
  resumen: ResumenInformeProduccion;
  declarado: ResumenDeclaradoInforme;
  /** Filas agregadas por (fecha, lote) — ver agruparFilasProduccionPorFechaLote — que NO existen todavía en lotes_dia: se insertarán. */
  filasAInsertar: number;
  /** Filas agregadas por (fecha, lote) que YA existen en lotes_dia (dedup por fila, no por día): se saltarán. */
  filasExistentes: number;
  /** Fechas con al menos una fila a insertar. */
  diasNuevos: number;
  /** Fechas cuyas filas ya existían TODAS: nada que insertar para ellas. */
  diasSinNuevas: number;
}

interface PreviewPalets {
  fileName: string;
  filas: FilaInformePalets[];
  resumen: ResumenInformePalets;
  /** Estimación con los datos cargados (antes de confirmar): fechas del archivo con o sin palets_dia ya existentes. */
  diasAInsertar: number;
  diasABackfill: number;
  paletsAInsertar: number;
  paletsABackfillEstimados: number;
}

interface PreviewInformesLote {
  /** Informes reconocidos (con lote y filas), en el orden de subida. */
  archivos: ArchivoInformeLote[];
  /** Archivos que ni siquiera se reconocieron como Informe LOTE (o no se pudieron leer), con motivo. */
  descartadosParse: Array<{ fileName: string; motivo: string }>;
  /** Avisos de estructura no reconocida en archivos que SÍ se parsearon (nunca se ocultan). */
  avisos: string[];
  /** Decisión por informe contra el estado actual de BD (misma función pura que usará la mutación). */
  plan: PlanImportInformesLote;
}

export default function HistoricoImport() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  if (!isAdmin) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Producción</p>
            <h1 className="page-title">Importar histórico</h1>
            <p className="page-subtitle">Carga del histórico de campaña desde el export del calibrador.</p>
          </div>
        </header>
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Acceso restringido</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Solo administración puede importar el histórico de campaña.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <HistoricoImportAdmin />;
}

function HistoricoImportAdmin() {
  const [activeTab, setActiveTab] = useState<"produccion" | "palets" | "informes">("produccion");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parseando, setParseando] = useState(false);
  const [preview, setPreview] = useState<PreviewInforme | null>(null);
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null);
  const [resumenFinal, setResumenFinal] = useState<ImportarHistoricoResumen | null>(null);
  const { clavesCubiertas, isLoadingClavesCubiertas, importar } = useHistoricoImport();

  const fileInputRefPalets = useRef<HTMLInputElement>(null);
  const [parseandoPalets, setParseandoPalets] = useState(false);
  const [previewPalets, setPreviewPalets] = useState<PreviewPalets | null>(null);
  const [progresoPalets, setProgresoPalets] = useState<{ hechos: number; total: number } | null>(null);
  const [resumenFinalPalets, setResumenFinalPalets] = useState<ImportarHistoricoPaletsResumen | null>(null);
  const { fechasCubiertas, isLoadingFechasCubiertas, importar: importarPalets } = useHistoricoImportPalets();

  const fileInputRefInformes = useRef<HTMLInputElement>(null);
  const [parseandoInformes, setParseandoInformes] = useState<{ hechos: number; total: number } | null>(null);
  const [previewInformes, setPreviewInformes] = useState<PreviewInformesLote | null>(null);
  const [progresoInformes, setProgresoInformes] = useState<{ hechos: number; total: number } | null>(null);
  const [resumenFinalInformes, setResumenFinalInformes] = useState<ImportarInformesLoteResumen | null>(null);
  const {
    clasificacionCubierta,
    isLoadingClasificacionCubierta,
    lotesCubiertos,
    isLoadingLotesCubiertos,
    importar: importarInformes,
  } = useInformesLoteImport();

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setParseando(true);
    setResumenFinal(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

      const resultado = parseInformeProduccionRows(rows);
      if (resultado.filas.length === 0) {
        toast({
          title: "Archivo no reconocido",
          description: "No parece un 'Informe PRODUCCION' del calibrador (no se encontró la cabecera de la tabla: Nombre del Lote / Peso (kg) / Tiempo de Inicio).",
          variant: "destructive",
        });
        return;
      }

      const resumen = resumirInformeProduccion(resultado);
      const declarado = extraerResumenDeclaradoInforme(rows);

      // Dedup por FILA (fecha + lote), no por día (ver useHistoricoImport.ts):
      // se agregan las filas del Excel por (fecha, lote) sumando kg y se
      // compara cada grupo contra lo que YA existe en lotes_dia para esa
      // fecha+lote — la misma unidad que usará la mutación al confirmar.
      const clavesPorFecha = clavesCubiertas?.clavesPorFecha ?? new Map<string, Set<string>>();
      const agregadas = agruparFilasProduccionPorFechaLote(resultado.filas);
      let filasAInsertar = 0;
      let filasExistentes = 0;
      const fechasConNueva = new Set<string>();
      const fechasSinNueva = new Set<string>();
      for (const fila of agregadas) {
        const yaExiste = clavesPorFecha.get(fila.fecha)?.has(fila.clave) ?? false;
        if (yaExiste) {
          filasExistentes += 1;
        } else {
          filasAInsertar += 1;
          fechasConNueva.add(fila.fecha);
        }
      }
      for (const fila of agregadas) {
        if (!fechasConNueva.has(fila.fecha)) fechasSinNueva.add(fila.fecha);
      }

      setPreview({
        fileName: file.name,
        filas: resultado.filas,
        resumen,
        declarado,
        filasAInsertar,
        filasExistentes,
        diasNuevos: fechasConNueva.size,
        diasSinNuevas: fechasSinNueva.size,
      });
    } catch (e) {
      toast({ title: "No se pudo leer el archivo", description: errorMessage(e), variant: "destructive" });
    } finally {
      setParseando(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmarImport = () => {
    if (!preview) return;
    setProgreso({ hechos: 0, total: 0 });
    importar.mutate(
      {
        filas: preview.filas,
        onProgress: (hechos, total) => setProgreso({ hechos, total }),
      },
      {
        onSuccess: (resumen) => {
          setResumenFinal(resumen);
          setPreview(null);
          setProgreso(null);
          toast({
            title: "Histórico importado",
            description: `${resumen.filasInsertadas} fila(s) insertada(s) en ${resumen.diasNuevos} día(s), ${resumen.filasExistentes} ya existente(s) (fecha+lote), ${resumen.diasSinNuevas} día(s) sin filas nuevas.`,
          });
        },
        onError: (e) => {
          setProgreso(null);
          toast({ title: "Error al importar", description: errorMessage(e), variant: "destructive" });
        },
      },
    );
  };

  const handleFilePalets = async (file: File | null) => {
    if (!file) return;
    setParseandoPalets(true);
    setResumenFinalPalets(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

      const resultado = parseInformePaletsRows(rows);
      if (resultado.filas.length === 0) {
        toast({
          title: "Archivo no reconocido",
          description: "No parece un export del programa de palets (no se encontró la cabecera de la tabla: Lote / Netos / Cajas / Fecha).",
          variant: "destructive",
        });
        return;
      }

      const resumen = resumirInformePalets(resultado);
      const cubiertas = fechasCubiertas ?? new Set<string>();

      const fechasDelArchivo = new Set(resultado.filas.map((f) => f.fecha));
      let diasAInsertar = 0;
      let diasABackfill = 0;
      for (const fecha of fechasDelArchivo) {
        if (cubiertas.has(fecha)) diasABackfill += 1;
        else diasAInsertar += 1;
      }
      let paletsAInsertar = 0;
      let paletsABackfillEstimados = 0;
      for (const fila of resultado.filas) {
        if (cubiertas.has(fila.fecha)) paletsABackfillEstimados += 1;
        else paletsAInsertar += 1;
      }

      setPreviewPalets({
        fileName: file.name,
        filas: resultado.filas,
        resumen,
        diasAInsertar,
        diasABackfill,
        paletsAInsertar,
        paletsABackfillEstimados,
      });
    } catch (e) {
      toast({ title: "No se pudo leer el archivo", description: errorMessage(e), variant: "destructive" });
    } finally {
      setParseandoPalets(false);
      if (fileInputRefPalets.current) fileInputRefPalets.current.value = "";
    }
  };

  const confirmarImportPalets = () => {
    if (!previewPalets) return;
    setProgresoPalets({ hechos: 0, total: 0 });
    importarPalets.mutate(
      {
        filas: previewPalets.filas,
        onProgress: (hechos, total) => setProgresoPalets({ hechos, total }),
      },
      {
        onSuccess: (resumen) => {
          setResumenFinalPalets(resumen);
          setPreviewPalets(null);
          setProgresoPalets(null);
          toast({
            title: "Histórico de palets importado",
            description: `${resumen.diasNuevos} día(s) nuevo(s) (${resumen.paletsInsertados} palet(s) creado(s)), ${resumen.diasBackfill} día(s) de backfill (${resumen.paletsBackfilled} lote(s) rellenado(s), ${resumen.paletsSinCasar} sin casar).`,
          });
        },
        onError: (e) => {
          setProgresoPalets(null);
          toast({ title: "Error al importar", description: errorMessage(e), variant: "destructive" });
        },
      },
    );
  };

  // ─── Informes de lote: multi-archivo (tandas de 50+), parse secuencial ─────
  const handleFilesInformes = async (files: FileList | File[] | null) => {
    const lista = Array.from(files ?? []).filter((f) => /\.xlsx?$/i.test(f.name));
    if (lista.length === 0) return;
    setResumenFinalInformes(null);
    setParseandoInformes({ hechos: 0, total: lista.length });
    try {
      const archivos: ArchivoInformeLote[] = [];
      const descartadosParse: Array<{ fileName: string; motivo: string }> = [];
      const avisos: string[] = [];

      for (let i = 0; i < lista.length; i++) {
        const file = lista[i];
        setParseandoInformes({ hechos: i, total: lista.length });
        try {
          const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
          const { informe, descartadas } = parseInformeLoteRows(rows);
          if (!informe) {
            descartadosParse.push({ fileName: file.name, motivo: descartadas[0] ?? "Archivo no reconocido." });
            continue;
          }
          for (const d of descartadas) avisos.push(`${file.name}: ${d}`);
          archivos.push({ fileName: file.name, informe });
        } catch (e) {
          descartadosParse.push({ fileName: file.name, motivo: `No se pudo leer: ${errorMessage(e)}` });
        }
      }

      // MISMA función pura que ejecutará la mutación (con datos frescos):
      // preview y import ven exactamente las mismas decisiones por informe.
      const plan = planImportInformesLote(
        archivos,
        clasificacionCubierta?.clasificacionPorFecha ?? new Map(),
        lotesCubiertos?.clavesPorFecha ?? new Map(),
      );
      setPreviewInformes({ archivos, descartadosParse, avisos, plan });
    } finally {
      setParseandoInformes(null);
      if (fileInputRefInformes.current) fileInputRefInformes.current.value = "";
    }
  };

  const onDropInformes = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (parseandoInformes || importarInformes.isPending) return;
    void handleFilesInformes(e.dataTransfer.files);
  };

  const confirmarImportInformes = () => {
    if (!previewInformes) return;
    setProgresoInformes({ hechos: 0, total: 0 });
    importarInformes.mutate(
      {
        archivos: previewInformes.archivos,
        onProgress: (hechos, total) => setProgresoInformes({ hechos, total }),
      },
      {
        onSuccess: (resumen) => {
          setResumenFinalInformes(resumen);
          setPreviewInformes(null);
          setProgresoInformes(null);
          toast({
            title: "Informes de lote importados",
            description: `${resumen.clasificacionesInsertadas} clasificación(es) nueva(s) (${resumen.filasClasificacion} fila(s)), ${resumen.yaTenianInforme} ya existente(s), ${resumen.lotesDiaReparados} lote(s) reparado(s) (${formatKg(resumen.kgReparados)}).`,
          });
        },
        onError: (e) => {
          setProgresoInformes(null);
          toast({ title: "Error al importar", description: errorMessage(e), variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="page-shell space-y-4">
      <header className="page-header">
        <div>
          {/* Acento de Producción (--seccion-acento-texto, FASE 2 del rediseño). */}
          <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Producción</p>
          <h1 className="page-title">Importar histórico</h1>
          <p className="page-subtitle">
            Carga el histórico de PRODUCCIÓN de toda la campaña desde el export del calibrador ("Informe PRODUCCION").
          </p>
        </div>
        {activeTab === "produccion" && (
          <Button
            className="glass glass-hover"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={parseando || importar.isPending || isLoadingClavesCubiertas}
            title="Export completo de campaña del calibrador (Informe PRODUCCION), no el parte del día"
          >
            {parseando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar Excel
          </Button>
        )}
        {activeTab === "palets" && (
          <Button
            className="glass glass-hover"
            variant="outline"
            size="sm"
            onClick={() => fileInputRefPalets.current?.click()}
            disabled={parseandoPalets || importarPalets.isPending || isLoadingFechasCubiertas}
            title="Export del programa de palets de toda la campaña"
          >
            {parseandoPalets ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar Excel
          </Button>
        )}
        {activeTab === "informes" && (
          <Button
            className="glass glass-hover"
            variant="outline"
            size="sm"
            onClick={() => fileInputRefInformes.current?.click()}
            disabled={Boolean(parseandoInformes) || importarInformes.isPending || isLoadingClasificacionCubierta || isLoadingLotesCubiertos}
            title="Informes LOTE del calibrador: puedes seleccionar 50+ archivos de golpe"
          >
            {parseandoInformes ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar Excel(s)
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={fileInputRefPalets}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => void handleFilePalets(e.target.files?.[0] ?? null)}
        />
        <input
          ref={fileInputRefInformes}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => void handleFilesInformes(e.target.files)}
        />
      </header>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "produccion" | "palets" | "informes")}>
        <TabsList>
          <TabsTrigger value="produccion">Producción</TabsTrigger>
          <TabsTrigger value="palets">Palets</TabsTrigger>
          <TabsTrigger value="informes">Informes de lote</TabsTrigger>
        </TabsList>

        <TabsContent value="produccion" className="space-y-4">
          {preview && (
            <Card className="glass-accented border-info/30">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileSpreadsheet className="h-4 w-4 text-info" />
                  {preview.fileName}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <MiniKpi variant="card" label="Filas válidas" value={formatNumber(preview.resumen.filasValidas)} />
                  <MiniKpi variant="card" label="Lotes distintos" value={formatNumber(preview.resumen.lotesDistintos)} />
                  <MiniKpi variant="card" label="Kg totales" value={formatKg(preview.resumen.kgTotal)} />
                  <MiniKpi variant="card"
                    label="Rango de fechas"
                    value={
                      preview.resumen.fechaDesde && preview.resumen.fechaHasta
                        ? `${formatDate(preview.resumen.fechaDesde)} – ${formatDate(preview.resumen.fechaHasta)}`
                        : "—"
                    }
                  />
                  <MiniKpi variant="card" label="Filas a insertar (fecha+lote)" value={formatNumber(preview.filasAInsertar)} />
                  <MiniKpi variant="card" label="Filas ya existentes (se saltan)" value={formatNumber(preview.filasExistentes)} />
                  <MiniKpi variant="card" label="Días con filas nuevas" value={formatNumber(preview.diasNuevos)} />
                  <MiniKpi variant="card" label="Días sin filas nuevas" value={formatNumber(preview.diasSinNuevas)} />
                </div>

                {(preview.declarado.lotesDeclarados != null || preview.declarado.kgDeclarados != null) && (
                  <p className="text-xs text-muted-foreground">
                    El propio informe declara{" "}
                    {preview.declarado.lotesDeclarados != null && (
                      <>
                        <span className={preview.resumen.filasValidas === preview.declarado.lotesDeclarados ? "font-medium text-foreground" : "font-medium text-warning"}>
                          {formatNumber(preview.declarado.lotesDeclarados)}
                        </span>{" "}
                        fila(s){" "}
                      </>
                    )}
                    {preview.declarado.kgDeclarados != null && (
                      <>
                        y{" "}
                        <span className={Math.abs(preview.resumen.kgTotal - preview.declarado.kgDeclarados) < 1 ? "font-medium text-foreground" : "font-medium text-warning"}>
                          {formatKg(preview.declarado.kgDeclarados)}
                        </span>{" "}
                      </>
                    )}
                    — compáralo con los datos parseados arriba.
                  </p>
                )}

                {preview.resumen.filasDescartadas > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {preview.resumen.filasDescartadas} fila(s) descartada(s):{" "}
                    {Object.entries(preview.resumen.descartadasPorMotivo)
                      .map(([motivo, n]) => `${n} (${motivo})`)
                      .join(", ")}
                  </p>
                )}

                {progreso && (
                  <div className="space-y-1">
                    <Progress value={progreso.total > 0 ? (progreso.hechos / progreso.total) * 100 : 0} />
                    <p className="text-xs text-muted-foreground">
                      Importando día {progreso.hechos} de {progreso.total}…
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={confirmarImport} disabled={importar.isPending || preview.filasAInsertar === 0}>
                    {importar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Confirmar import
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={importar.isPending}>
                    Cancelar
                  </Button>
                </div>
                {preview.filasAInsertar === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Todas las filas de este archivo (por fecha+lote) ya están importadas: no hay nada nuevo que hacer.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {resumenFinal && !preview && (
            <Card className="glass-accented border-success/30">
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">{resumenFinal.filasInsertadas}</span> fila(s) insertada(s) en{" "}
                  <span className="font-semibold tabular-nums">{resumenFinal.diasNuevos}</span> día(s),{" "}
                  <span className="font-semibold tabular-nums">{resumenFinal.filasExistentes}</span> ya existente(s) (fecha+lote),{" "}
                  <span className="font-semibold tabular-nums">{resumenFinal.diasSinNuevas}</span> día(s) sin filas nuevas.
                </p>
              </CardContent>
            </Card>
          )}

          {!preview && !resumenFinal && (
            <Card className="glass-accented">
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <History className="h-10 w-10 text-muted-foreground/30" />
                <div>
                  <p className="font-semibold">Importa el histórico de producción</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    Sube el export "Informe PRODUCCION" del calibrador (toda la campaña, no el parte del día). Las
                    filas que ya existan (misma fecha y lote) se saltan automáticamente, fila a fila: reimportar el
                    mismo archivo no duplica nada, y sí añade las filas de días ya cubiertos que faltaran.
                  </p>
                </div>
                <Button className="glass glass-hover mt-2" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Importar Excel
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="palets" className="space-y-4">
          {previewPalets && (
            <Card className="glass-accented border-info/30">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileSpreadsheet className="h-4 w-4 text-info" />
                  {previewPalets.fileName}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  <MiniKpi variant="card" label="Filas válidas" value={formatNumber(previewPalets.resumen.filasValidas)} />
                  <MiniKpi variant="card" label="Palets únicos" value={formatNumber(previewPalets.resumen.paletsUnicos)} />
                  <MiniKpi variant="card" label="Con lote / sin lote" value={`${formatNumber(previewPalets.resumen.paletsConLote)} / ${formatNumber(previewPalets.resumen.paletsSinLote)}`} />
                  <MiniKpi variant="card" label="Kg netos totales" value={formatKg(previewPalets.resumen.kgNetoTotal)} />
                  <MiniKpi variant="card" label="Clientes distintos" value={formatNumber(previewPalets.resumen.clientesDistintos)} />
                  <MiniKpi variant="card"
                    label="Rango de fechas"
                    value={
                      previewPalets.resumen.fechaDesde && previewPalets.resumen.fechaHasta
                        ? `${formatDate(previewPalets.resumen.fechaDesde)} – ${formatDate(previewPalets.resumen.fechaHasta)}`
                        : "—"
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-2">
                  <MiniKpi variant="card"
                    label="Días nuevos → se insertan"
                    value={`${formatNumber(previewPalets.diasAInsertar)} día(s) · ${formatNumber(previewPalets.paletsAInsertar)} palet(s)`}
                  />
                  <MiniKpi variant="card"
                    label="Días ya cubiertos → solo backfill de lote"
                    value={`${formatNumber(previewPalets.diasABackfill)} día(s) · ${formatNumber(previewPalets.paletsABackfillEstimados)} palet(s) a casar`}
                  />
                </div>

                {previewPalets.resumen.filasDescartadas > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {previewPalets.resumen.filasDescartadas} fila(s) descartada(s):{" "}
                    {Object.entries(previewPalets.resumen.descartadasPorMotivo)
                      .map(([motivo, n]) => `${n} (${motivo})`)
                      .join(", ")}
                  </p>
                )}

                {progresoPalets && (
                  <div className="space-y-1">
                    <Progress value={progresoPalets.total > 0 ? (progresoPalets.hechos / progresoPalets.total) * 100 : 0} />
                    <p className="text-xs text-muted-foreground">
                      Procesando día {progresoPalets.hechos} de {progresoPalets.total}…
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={confirmarImportPalets} disabled={importarPalets.isPending}>
                    {importarPalets.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Confirmar import
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPreviewPalets(null)} disabled={importarPalets.isPending}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {resumenFinalPalets && !previewPalets && (
            <Card className="glass-accented border-success/30">
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">{resumenFinalPalets.diasNuevos}</span> día(s) nuevo(s){" "}
                  (<span className="font-semibold tabular-nums">{resumenFinalPalets.paletsInsertados}</span> palet(s) creado(s)),{" "}
                  <span className="font-semibold tabular-nums">{resumenFinalPalets.diasBackfill}</span> día(s) de backfill{" "}
                  (<span className="font-semibold tabular-nums">{resumenFinalPalets.paletsBackfilled}</span> lote(s) rellenado(s),{" "}
                  <span className={cn("font-semibold tabular-nums", resumenFinalPalets.paletsSinCasar > 0 && "text-warning")}>
                    {resumenFinalPalets.paletsSinCasar}
                  </span>{" "}
                  sin casar).
                </p>
              </CardContent>
            </Card>
          )}

          {!previewPalets && !resumenFinalPalets && (
            <Card className="glass-accented">
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <PackageSearch className="h-10 w-10 text-muted-foreground/30" />
                <div>
                  <p className="font-semibold">Importa el histórico de palets</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    Sube el export del programa de palets (toda la campaña). Las fechas que ya tengan palets
                    importados (desde abril 2026, junto a los partes diarios) NO se duplican: solo se rellena el
                    código de lote de los palets que ya existían. Las fechas anteriores, sin palets todavía, se crean
                    de nuevo.
                  </p>
                </div>
                <Button className="glass glass-hover mt-2" variant="outline" onClick={() => fileInputRefPalets.current?.click()}>
                  <Upload className="h-4 w-4" /> Importar Excel
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="informes" className="space-y-4">
          {parseandoInformes && (
            <Card className="glass-accented border-info/30">
              <CardContent className="space-y-1 p-4">
                <Progress value={parseandoInformes.total > 0 ? (parseandoInformes.hechos / parseandoInformes.total) * 100 : 0} />
                <p className="text-xs text-muted-foreground">
                  Leyendo archivo {parseandoInformes.hechos + 1} de {parseandoInformes.total}…
                </p>
              </CardContent>
            </Card>
          )}

          {previewInformes && !parseandoInformes && (
            <Card className="glass-accented border-info/30">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileStack className="h-4 w-4 text-info" />
                  {formatNumber(previewInformes.archivos.length + previewInformes.descartadosParse.length)} archivo(s) leído(s)
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <MiniKpi variant="card" label="Informes válidos" value={formatNumber(previewInformes.plan.items.length)} />
                  <MiniKpi
                    variant="card"
                    label="Descartados"
                    value={formatNumber(previewInformes.descartadosParse.length + previewInformes.plan.descartados.length)}
                    tone={previewInformes.descartadosParse.length + previewInformes.plan.descartados.length > 0 ? "warning" : "neutral"}
                  />
                  <MiniKpi
                    variant="card"
                    label="Clasificación nueva (fecha+lote)"
                    value={formatNumber(previewInformes.plan.nClasificacionesNuevas)}
                    labelInfo="Informes cuya combinación fecha+lote todavía no tiene filas en lote_clasificacion: se insertan."
                  />
                  <MiniKpi
                    variant="card"
                    label="Ya tenían informe (se saltan)"
                    value={formatNumber(previewInformes.plan.nYaTenianInforme)}
                    labelInfo="La misma fecha+lote ya tiene clasificación (de la edge function o de una tanda anterior): reimportar no duplica nada."
                  />
                  <MiniKpi
                    variant="card"
                    label="Reparan procesado faltante"
                    value={formatNumber(previewInformes.plan.nReparaciones)}
                    sub={formatKg(previewInformes.plan.kgReparados)}
                    tone={previewInformes.plan.nReparaciones > 0 ? "success" : "neutral"}
                    labelInfo="Lotes SIN ninguna fila de procesado para esa fecha: se crea una fila de lotes_dia con el kg del informe — esos kg salen del stock fantasma."
                  />
                  <MiniKpi
                    variant="card"
                    label="Podrido real de los informes nuevos"
                    value={formatKg(previewInformes.plan.kgPodridoRealNuevo)}
                    labelInfo="Suma de las clases 'Podrido' de los informes con clasificación nueva: entra como dato real (no prorrateo) en el análisis de mermas."
                  />
                </div>

                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  El podrido de estos informes pasa a contar como
                  <FuenteBadge fuente="real" size="sm" />
                  en mermas y costes (sustituye al prorrateo para esos lotes).
                </p>

                {(previewInformes.descartadosParse.length > 0 || previewInformes.plan.descartados.length > 0) && (
                  <div className="space-y-0.5 text-xs text-warning">
                    {[...previewInformes.descartadosParse, ...previewInformes.plan.descartados].map((d, i) => (
                      <p key={i} className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span><span className="font-medium">{d.fileName}</span>: {d.motivo}</span>
                      </p>
                    ))}
                  </div>
                )}

                {previewInformes.avisos.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      {previewInformes.avisos.length} aviso(s) de estructura no reconocida (los archivos se importan igualmente)
                    </summary>
                    <div className="mt-1 space-y-0.5">
                      {previewInformes.avisos.map((a, i) => (
                        <p key={i}>{a}</p>
                      ))}
                    </div>
                  </details>
                )}

                {progresoInformes && (
                  <div className="space-y-1">
                    <Progress value={progresoInformes.total > 0 ? (progresoInformes.hechos / progresoInformes.total) * 100 : 0} />
                    <p className="text-xs text-muted-foreground">
                      Importando informe {progresoInformes.hechos} de {progresoInformes.total}…
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={confirmarImportInformes}
                    disabled={importarInformes.isPending || (previewInformes.plan.nClasificacionesNuevas === 0 && previewInformes.plan.nReparaciones === 0)}
                  >
                    {importarInformes.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Confirmar import
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPreviewInformes(null)} disabled={importarInformes.isPending}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => fileInputRefInformes.current?.click()}
                    disabled={importarInformes.isPending}
                    title="Sustituye la tanda cargada por otra selección de archivos"
                  >
                    Elegir otros archivos
                  </Button>
                </div>
                {previewInformes.plan.nClasificacionesNuevas === 0 && previewInformes.plan.nReparaciones === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Todos los informes de esta tanda (por fecha+lote) ya están importados: no hay nada nuevo que hacer.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {resumenFinalInformes && !previewInformes && !parseandoInformes && (
            <Card className="glass-accented border-success/30">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                  <p className="text-sm">
                    <span className="font-semibold tabular-nums">{resumenFinalInformes.clasificacionesInsertadas}</span> informe(s) con clasificación nueva{" "}
                    (<span className="font-semibold tabular-nums">{resumenFinalInformes.filasClasificacion}</span> fila(s)),{" "}
                    <span className="font-semibold tabular-nums">{resumenFinalInformes.yaTenianInforme}</span> ya existente(s) (fecha+lote),{" "}
                    <span className={cn("font-semibold tabular-nums", resumenFinalInformes.lotesDiaReparados > 0 && "text-success")}>
                      {resumenFinalInformes.lotesDiaReparados}
                    </span>{" "}
                    lote(s) con procesado reparado ({formatKg(resumenFinalInformes.kgReparados)}).
                  </p>
                </div>
                <p className="flex items-center gap-1.5 pl-8 text-xs text-muted-foreground">
                  Podrido real incorporado: <span className="font-medium tabular-nums text-foreground">{formatKg(resumenFinalInformes.kgPodridoReal)}</span>
                  <FuenteBadge fuente="real" size="sm" />
                </p>
                {resumenFinalInformes.descartados.length > 0 && (
                  <div className="space-y-0.5 pl-8 text-xs text-warning">
                    {resumenFinalInformes.descartados.map((d, i) => (
                      <p key={i}>{d.fileName}: {d.motivo}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!previewInformes && !resumenFinalInformes && !parseandoInformes && (
            <Card
              className="glass-accented"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDropInformes}
            >
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <FileStack className="h-10 w-10 text-muted-foreground/30" />
                <div>
                  <p className="font-semibold">Importa los informes de lote</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    Arrastra aquí (o selecciona) los "Informe LOTE" del calibrador — un Excel por pasada de lote,
                    50 o más de golpe. Cada informe aporta la clasificación real (podrido incluido) de su lote y,
                    si el lote no tenía registro de procesado para esa fecha, lo repara con los kg del informe.
                    Reimportar la misma tanda no duplica nada (dedup por fecha+lote).
                  </p>
                </div>
                <Button className="glass glass-hover mt-2" variant="outline" onClick={() => fileInputRefInformes.current?.click()}>
                  <Upload className="h-4 w-4" /> Seleccionar archivos
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

