/**
 * HistoricoImport — "Importar histórico": carga el histórico de campaña
 * completa en dos pestañas:
 *   - Producción: export "Informe PRODUCCION" del calibrador (ver
 *     src/lib/historicoProduccion.ts / src/hooks/useHistoricoImport.ts,
 *     import a partes_diarios/lotes_dia).
 *   - Palets: export del programa de gestión de palets (ver
 *     src/lib/historicoPalets.ts / src/hooks/useHistoricoImport.ts, import a
 *     partes_diarios/palets_dia con dedup a dos niveles: insert en fechas sin
 *     palets previos, backfill de lote_codigo en fechas que ya los tienen).
 *
 * Gate interno de admin (no en RoleRoute): el espacio de producción ya
 * permite admin+operario, pero este import de campaña completa es una
 * operación delicada (crea partes/palets históricos) — solo administración.
 */
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, History, Loader2, PackageSearch, ShieldAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import {
  agruparFilasProduccionPorFechaLote,
  useHistoricoImport,
  useHistoricoImportPalets,
  type ImportarHistoricoPaletsResumen,
  type ImportarHistoricoResumen,
} from "@/hooks/useHistoricoImport";
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

export default function HistoricoImport() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  if (!isAdmin) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker">Producción</p>
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
  const [activeTab, setActiveTab] = useState<"produccion" | "palets">("produccion");

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

  return (
    <div className="page-shell space-y-4">
      <header className="page-header">
        <div>
          <p className="panel-kicker">Producción</p>
          <h1 className="page-title">Importar histórico</h1>
          <p className="page-subtitle">
            Carga el histórico de PRODUCCIÓN de toda la campaña desde el export del calibrador ("Informe PRODUCCION").
          </p>
        </div>
        {activeTab === "produccion" ? (
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
        ) : (
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
      </header>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "produccion" | "palets")}>
        <TabsList>
          <TabsTrigger value="produccion">Producción</TabsTrigger>
          <TabsTrigger value="palets">Palets</TabsTrigger>
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
                  <Stat label="Filas válidas" value={formatNumber(preview.resumen.filasValidas)} />
                  <Stat label="Lotes distintos" value={formatNumber(preview.resumen.lotesDistintos)} />
                  <Stat label="Kg totales" value={formatKg(preview.resumen.kgTotal)} />
                  <Stat
                    label="Rango de fechas"
                    value={
                      preview.resumen.fechaDesde && preview.resumen.fechaHasta
                        ? `${formatDate(preview.resumen.fechaDesde)} – ${formatDate(preview.resumen.fechaHasta)}`
                        : "—"
                    }
                  />
                  <Stat label="Filas a insertar (fecha+lote)" value={formatNumber(preview.filasAInsertar)} />
                  <Stat label="Filas ya existentes (se saltan)" value={formatNumber(preview.filasExistentes)} />
                  <Stat label="Días con filas nuevas" value={formatNumber(preview.diasNuevos)} />
                  <Stat label="Días sin filas nuevas" value={formatNumber(preview.diasSinNuevas)} />
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
                  <Stat label="Filas válidas" value={formatNumber(previewPalets.resumen.filasValidas)} />
                  <Stat label="Palets únicos" value={formatNumber(previewPalets.resumen.paletsUnicos)} />
                  <Stat label="Con lote / sin lote" value={`${formatNumber(previewPalets.resumen.paletsConLote)} / ${formatNumber(previewPalets.resumen.paletsSinLote)}`} />
                  <Stat label="Kg netos totales" value={formatKg(previewPalets.resumen.kgNetoTotal)} />
                  <Stat label="Clientes distintos" value={formatNumber(previewPalets.resumen.clientesDistintos)} />
                  <Stat
                    label="Rango de fechas"
                    value={
                      previewPalets.resumen.fechaDesde && previewPalets.resumen.fechaHasta
                        ? `${formatDate(previewPalets.resumen.fechaDesde)} – ${formatDate(previewPalets.resumen.fechaHasta)}`
                        : "—"
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-2">
                  <Stat
                    label="Días nuevos → se insertan"
                    value={`${formatNumber(previewPalets.diasAInsertar)} día(s) · ${formatNumber(previewPalets.paletsAInsertar)} palet(s)`}
                  />
                  <Stat
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
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
