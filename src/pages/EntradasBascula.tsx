// src/pages/EntradasBascula.tsx
// Entradas de fruta por báscula + stock de fruta sin procesar.
//
// Cada día se importa el export del programa de báscula (Excel); el código de
// lote (AAMMDD+NN) es el mismo que llega al calibrador, así que el cruce con
// lotes_dia da el stock en cámara por lote/finca/variedad y la trazabilidad
// completa: finca → entrada → lote → procesado → clasificación → destino.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  AlertTriangle, ArrowRight, CalendarDays, ChevronDown, ClipboardCheck, Download, FileSpreadsheet, GitCompare, HelpCircle, Loader2, Lock, LockOpen, Package, Percent, Route, Search, Trash2, Truck, Upload, Users, Warehouse, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CamarasExternasCard } from "@/components/CamarasExternasCard";
import { StockPrecalibradoCard } from "@/components/StockPrecalibradoCard";
import { columnasComunesLotes, TablaLotesStock } from "@/components/TablaLotesStock";
import { CerrarLoteDialog } from "@/components/CerrarLoteDialog";
import { CerrarLotesEnBloqueDialog } from "@/components/CerrarLotesEnBloqueDialog";
import { ConciliacionKgPanel } from "@/components/ConciliacionKgPanel";
import { ConciliarInformeCamaraDialog } from "@/components/ConciliarInformeCamaraDialog";
import { ConfirmarLotesEnCamaraDialog } from "@/components/ConfirmarLotesEnCamaraDialog";
import { FuenteBadge, fuentePodridoAVariant } from "@/components/FuenteBadge";
import { KPICard } from "@/components/KPICard";
import { ProgressBarRow } from "@/components/ProgressBarRow";
import { SortableTableHead, toggleSort, type SortDir } from "@/components/SortableColumn";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { useMermaLotes } from "@/hooks/useMermaLote";
import { useProductoresCatalogo } from "@/hooks/useProductoresCatalogo";
import {
  buildEntradasDesdeStock,
  DIAS_SIN_ACTIVIDAD_AUTOCIERRE,
  DIAS_SIN_ACTIVIDAD_TERMINADO,
  normalizarLoteCodigo,
  parseEntradasBasculaRows,
  parseStockLotesRows,
  UMBRAL_PROBABLE_TERMINADO,
  type EntradaBasculaParsed,
  type StockEstado,
  type StockLoteRow,
} from "@/lib/entradasBascula";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKgCompact as formatKg, formatNumber, formatPct, normalizarTexto, today } from "@/lib/format";
import { buildStockPrecalibrado } from "@/lib/stockPrecalibrado";
import { INFO_PODRIDO_PRE_CALIBRADOR, TASA_MERMA_NATURAL_DIA, type MermaLote } from "@/lib/mermaLote";
import { exportarMermasProductores, type FilaMermaExport } from "@/lib/exportMermasProductores";
import { casarMermaCamara, parseMermaCamaraRows } from "@/lib/mermaCamaraImport";
import type { SenalesRecepcion } from "@/lib/camarasExternas";
import { esEntradaPrecalibrado, resolveProductorGroupKey } from "@/lib/productoresCanonicos";
import { MOTIVO_BADGE, MOTIVO_LABEL } from "@/components/ConciliacionKgPanel";
import type { MovimientoKg } from "@/lib/conciliacionKg";
import { cn } from "@/lib/utils";
import { compararConMotorViejo } from "@/lib/cicloVidaLoteAdapter";
import { ESTADO_LOTE_BADGE, ESTADO_LOTE_LABEL } from "@/components/CicloVidaEvidenciaSection";

const ESTADO_BADGE: Record<StockEstado, { label: string; className: string }> = {
  pendiente: { label: "En cámara", className: "border-info/40 bg-info/10 text-info" },
  parcial: { label: "Parcial", className: "border-warning/40 bg-warning/10 text-warning" },
  procesado: { label: "Procesado", className: "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground" },
};

function diasClass(dias: number, estado: StockEstado): string {
  if (estado === "procesado") return "text-muted-foreground";
  if (dias > 14) return "text-destructive font-semibold";
  if (dias > 7) return "text-warning font-semibold";
  return "text-foreground";
}

/** Puntito de semáforo junto al nº de días, misma lógica que diasClass. */
function diasDotClass(dias: number, estado: StockEstado): string {
  if (estado === "procesado") return "bg-muted-foreground/40";
  if (dias > 14) return "bg-destructive";
  if (dias > 7) return "bg-warning";
  return "bg-success";
}

type StockSortKey = "lote" | "fecha_entrada" | "finca" | "articulo" | "kg_entrada" | "kg_procesado" | "kg_en_camara" | "dias_en_camara" | "estado";

function compareStockRows(a: StockLoteRow, b: StockLoteRow, key: StockSortKey): number {
  switch (key) {
    case "lote": return a.lote.localeCompare(b.lote);
    case "fecha_entrada": return a.fecha_entrada.localeCompare(b.fecha_entrada);
    case "finca": return (a.finca ?? "").localeCompare(b.finca ?? "");
    case "articulo": return (a.articulo ?? "").localeCompare(b.articulo ?? "");
    case "kg_entrada": return a.kg_entrada - b.kg_entrada;
    case "kg_procesado": return a.kg_procesado - b.kg_procesado;
    case "kg_en_camara": return a.kg_en_camara - b.kg_en_camara;
    case "dias_en_camara": return a.dias_en_camara - b.dias_en_camara;
    case "estado": return a.estado.localeCompare(b.estado);
    default: return 0;
  }
}

/** Nº de variedades que se muestran directamente en "Stock por variedad" antes de "ver todas". */
const STOCK_VARIEDAD_LIMIT = 8;

function VariedadRow({ variedad, totalKg }: { variedad: { variedad: string; kg: number; lotes: number }; totalKg: number }) {
  const pct = totalKg > 0 ? (variedad.kg / totalKg) * 100 : 0;
  return (
    <ProgressBarRow
      label={variedad.variedad}
      pct={pct}
      value={formatKg(variedad.kg)}
      pctLabel={formatPct(pct)}
      extra={(
        <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">
          {variedad.lotes} lote{variedad.lotes === 1 ? "" : "s"}
        </span>
      )}
    />
  );
}

// ─── Pestaña "Mermas y coste" ────────────────────────────────────────────────
// Tabla de lotes PROCESADOS con merma natural (medida + desglose natural
// estimada/sin justificar), podrido (real/≈estimado) y días en cámara — todo
// en kg y %, sin €: el desglose económico vive en Económico → Costes (sección
// "Pérdidas de fruta"), que sí puede mostrar € porque esa zona es solo admin.
// Ver src/lib/mermaLote.ts para las fórmulas y src/hooks/useMermaLote.ts para
// la carga de datos.

type MermaSortKey =
  | "lote" | "kg_entrada" | "kg_calibrador" | "merma_kg" | "merma_pct" | "dias" | "podrido_pre"
  | "podrido_cal" | "podrido_man";

function compareMermaRows(a: MermaLote, b: MermaLote, key: MermaSortKey): number {
  switch (key) {
    case "lote": return a.lote.localeCompare(b.lote);
    case "kg_entrada": return a.kgEntrada - b.kgEntrada;
    case "kg_calibrador": return a.kgCalibrador - b.kgCalibrador;
    case "merma_kg": return (a.mermaNaturalKg ?? 0) - (b.mermaNaturalKg ?? 0);
    case "merma_pct": return (a.pctMermaSobreEntrada ?? 0) - (b.pctMermaSobreEntrada ?? 0);
    case "dias": return (a.diasEnCamara ?? -1) - (b.diasEnCamara ?? -1);
    case "podrido_pre": return (a.podridoPreCalibradorKg ?? -1) - (b.podridoPreCalibradorKg ?? -1);
    case "podrido_cal": return (a.podridoCalibradorKg ?? 0) - (b.podridoCalibradorKg ?? 0);
    case "podrido_man": return (a.podridoManualKg ?? 0) - (b.podridoManualKg ?? 0);
    default: return 0;
  }
}

/** Umbral VISUAL (no de negocio) para destacar "Podrido pre-calib." en la tabla: > 40% de la merma medida o > 500 kg. Mismo criterio que TrazabilidadLote.tsx. */
function podridoPreCalibradorDestacado(l: MermaLote): boolean {
  const medida = Math.max(0, l.mermaNaturalKg ?? 0);
  const preCalibrador = l.podridoPreCalibradorKg ?? 0;
  if (preCalibrador > 500) return true;
  return medida > 0 && preCalibrador / medida > 0.4;
}

/** % de merma natural esperada por días en cámara (TASA_MERMA_NATURAL_DIA × días), en fracción 0–100. `null` si no hay días conocidos. */
function mermaEsperadaPct(l: MermaLote): number | null {
  if (l.diasEnCamara == null) return null;
  return TASA_MERMA_NATURAL_DIA * 100 * l.diasEnCamara;
}

/** Umbral VISUAL (no de negocio, FASE 5 jul 2026): la merma medida del lote supera el DOBLE de la esperada por días en cámara — matiz de aviso en la columna "% merma", no cambia ningún cálculo. */
function mermaSuperaEsperadaDoble(l: MermaLote): boolean {
  const esperada = mermaEsperadaPct(l);
  return l.pctMermaSobreEntrada != null && esperada != null && esperada > 0 && l.pctMermaSobreEntrada > esperada * 2;
}

/** Fila de un mini-ranking: enlaza al lote, con una badge de "atención" (rojo). */
function RankingLoteRow({ lote, valorLabel }: { lote: string; valorLabel: string }) {
  return (
    <Link
      to={`/trazabilidad?lote=${encodeURIComponent(lote)}`}
      className="flex items-center justify-between gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-sm transition-colors hover:bg-[var(--glass-bg-strong)]"
    >
      <span className="inline-flex items-center gap-1 font-medium tabular-nums">
        {lote} <ArrowRight className="h-3 w-3 opacity-40" />
      </span>
      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[11px] font-semibold text-destructive">
        {valorLabel}
      </Badge>
    </Link>
  );
}

function RankingCard({ titulo, icon: Icon, vacio, children }: {
  titulo: string;
  icon: typeof AlertTriangle;
  vacio: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="glass-accented">
      <CardContent className="space-y-2 p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {titulo}
        </div>
        {vacio ? (
          <p className="py-3 text-center text-xs text-muted-foreground">Sin datos.</p>
        ) : (
          <div className="space-y-1.5">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function MermasCosteTab() {
  const { lotes, agregado, isLoading, error } = useMermaLotes();
  const { entradas, calidadLotes } = useEntradasBascula();
  const { user } = useAuth();
  const { aliasPorNombreNormalizado, nombrePorProductorId } = useProductoresCatalogo();
  const [sortKey, setSortKey] = useState<MermaSortKey>("merma_pct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [exportando, setExportando] = useState(false);
  const [importandoCamara, setImportandoCamara] = useState(false);
  const camaraInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Excluye los cerrados sin registro (ver mermaLote.ts): su estado es
  // "procesado" para el stock, pero no tienen merma/podrido calculable y no
  // deben aparecer en esta tabla (el contador del pie los informa aparte).
  const procesados = useMemo(() => lotes.filter((l) => l.estado === "procesado" && !l.cerradoSinRegistro), [lotes]);
  const filasOrdenadas = useMemo(() => {
    const ordenadas = [...procesados].sort((a, b) => compareMermaRows(a, b, sortKey));
    if (sortDir === "desc") ordenadas.reverse();
    return ordenadas;
  }, [procesados, sortKey, sortDir]);

  const handleToggleSort = (key: MermaSortKey) => toggleSort(key, sortKey, sortDir, setSortKey, setSortDir, "desc");

  // ─── Atención especial: 2 rankings de lotes + 1 por agricultor (kg, no €) ──
  // Total podrido del lote = calibrador + pre-calibrador. El podrido MANUAL no
  // se suma: sale ANTES del calibrador y ya está dentro de la merma medida —
  // el componente pre-calibrador ES su reflejo por lote (modelo del dueño,
  // 21-jul-2026); sumar ambos contaría la misma fruta dos veces.
  const topPodridoKg = useMemo(
    () => procesados
      .map((l) => ({ lote: l.lote, kg: (l.podridoCalibradorKg ?? 0) + (l.podridoPreCalibradorKg ?? 0) }))
      .filter((r) => r.kg > 0)
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 5),
    [procesados],
  );

  const topMermaPct = useMemo(
    () => procesados
      .filter((l) => l.pctMermaSobreEntrada != null)
      .map((l) => ({ lote: l.lote, pct: l.pctMermaSobreEntrada! }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5),
    [procesados],
  );

  const entradaPorLote = useMemo(() => new Map(entradas.map((e) => [e.lote, e])), [entradas]);

  // ─── Export "Podrido y mermas por productor, finca y lote" (informe de
  // decisión de agosto): kg conciliados, podrido con su fuente, % industria y
  // notas del operario, agregado productor → finca → lote. ─────────────────
  const handleExportProductores = async () => {
    setExportando(true);
    try {
      const filas: FilaMermaExport[] = procesados.map((l) => {
        const e = entradaPorLote.get(l.lote);
        const agricultor = e?.agricultor ?? null;
        const productorIdDirecto = (e as { productor_id?: string | null } | undefined)?.productor_id ?? null;
        const { productorId } = resolveProductorGroupKey(agricultor ?? "", productorIdDirecto, aliasPorNombreNormalizado);
        const label = (productorId ? nombrePorProductorId.get(productorId) : null) ?? agricultor ?? "Sin agricultor";
        return {
          productor: label,
          finca: e?.finca?.trim() || "Sin finca",
          articulo: e?.articulo ?? null,
          lote: l.lote,
          fechaEntrada: e?.fecha ?? "",
          diasEnCamara: l.diasEnCamara,
          kgEntrada: l.kgEntrada,
          kgCalibrador: l.kgCalibrador,
          mermaNaturalKg: l.mermaNaturalKg,
          mermaNaturalEstimadaKg: l.mermaNaturalEstimadaKg,
          podridoPreCalibradorKg: l.podridoPreCalibradorKg,
          podridoCalibradorKg: l.podridoCalibradorKg,
          podridoCalibradorFuente: l.podridoCalibradorFuente,
          podridoManualKg: l.podridoManualKg,
          pctIndustria: calidadLotes.pctIndustriaPorLote.get(l.lote) ?? null,
          notas: calidadLotes.notasPorLote.get(l.lote) ?? null,
        };
      });
      await exportarMermasProductores(filas, user?.email ?? null);
      toast({ title: "Excel generado", description: `${filas.length} lote(s) en 3 hojas: Productores, Por finca y Detalle.` });
    } catch (e) {
      toast({ title: "No se pudo exportar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setExportando(false);
    }
  };

  // ─── Import del registro de mermas de cámara (Excel manual de Guadex/
  // Espalmex): casa cada camión por (fecha, kg exactos) con su entrada —o de
  // forma aproximada con aviso si el papel trae la finca o los kg ligeramente
  // distintos de báscula— y guarda merma_camara_kg + fecha_salida_camara. Es
  // el dato MEDIDO que acota la conciliación y sustituye a la estimación por
  // tasa (regla 21-jul-2026). ─
  const handleImportarMermaCamara = async (file: File | null) => {
    if (!file) return;
    setImportandoCamara(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }) as unknown[][];
      const { registros, descartadas } = parseMermaCamaraRows(rows);
      if (registros.length === 0) {
        toast({ title: "Archivo no reconocido", description: "No parece el registro de mermas de cámara (Fecha almacenamiento / Peso inicial / Peso final).", variant: "destructive" });
        return;
      }
      const { casados, sinCasar, ambiguos } = casarMermaCamara(
        registros,
        entradas.map((e) => ({ id: e.id, lote: e.lote, fecha: e.fecha, kg_entrada: Number(e.kg_entrada) || 0, finca: e.finca })),
      );
      // merma_camara_kg / fecha_salida_camara: columnas de la migración
      // 20260721150000, aún no reflejadas en los tipos generados (types.ts).
      // Cliente sin esquema tipado (Database=any) hasta regenerar los tipos.
      const SUPA_LOCAL = supabase as unknown as SupabaseClient;
      for (const c of casados) {
        const { error } = await SUPA_LOCAL
          .from("entradas_bascula")
          .update({ merma_camara_kg: c.registro.mermaKg, fecha_salida_camara: c.registro.fechaSalida })
          .eq("id", c.id);
        if (error) throw new Error(errorMessage(error));
      }
      queryClient.invalidateQueries({ queryKey: ["entradas_bascula"] });
      queryClient.invalidateQueries({ queryKey: ["merma-lote"] });
      const aproximados = casados.filter((c) => c.aviso);
      toast({
        title: "Mermas de cámara importadas",
        description: `${casados.length} camión(es) casados con su lote${aproximados.length ? ` (${aproximados.length} aproximado(s): ${aproximados.map((c) => `${c.lote} — ${c.aviso}`).join("; ")})` : ""}${sinCasar.length ? `, ${sinCasar.length} sin casar (sin entrada con esa fecha y kg)` : ""}${ambiguos.length ? `, ${ambiguos.length} ambiguo(s)` : ""}${descartadas.length ? `, ${descartadas.length} fila(s) descartada(s)` : ""}.`,
      });
    } catch (e) {
      toast({ title: "No se pudo importar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setImportandoCamara(false);
      if (camaraInputRef.current) camaraInputRef.current.value = "";
    }
  };

  // El ranking "Pérdida por agricultor" que vivía aquí se MUDÓ a /productores
  // como columna "% Pérdida" del ranking (reordenación 2026-07-28: esta página
  // es eje fruta/lote; el eje QUIÉN vive en Productores). Queda el enlace en
  // la sección "Atención especial".

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <Card className="glass-accented border-destructive/30">
        <CardContent className="flex items-center gap-3 py-6 text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{errorMessage(error)}</p>
        </CardContent>
      </Card>
    );
  }

  const totales = {
    kgEntrada: procesados.reduce((s, l) => s + l.kgEntrada, 0),
    kgCalibrador: procesados.reduce((s, l) => s + l.kgCalibrador, 0),
    merma: procesados.reduce((s, l) => s + (l.mermaNaturalKg ?? 0), 0),
    podridoPreCalibrador: procesados.reduce((s, l) => s + (l.podridoPreCalibradorKg ?? 0), 0),
    podridoCal: procesados.reduce((s, l) => s + (l.podridoCalibradorKg ?? 0), 0),
    podridoMan: procesados.reduce((s, l) => s + (l.podridoManualKg ?? 0), 0),
  };

  return (
    <div className="space-y-4">
      {agregado.nConDatoARevisar > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {agregado.nConDatoARevisar} lote{agregado.nConDatoARevisar === 1 ? "" : "s"} con calibrador &gt; báscula — revisar pesajes
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <KPICard
          className="glass-accented"
          label="Merma media ponderada"
          value={agregado.mermaMediaPonderadaPct != null ? formatPct(agregado.mermaMediaPonderadaPct) : "—"}
          hint={`Sobre ${formatKg(agregado.kgEntradaProcesados)} de lotes procesados`}
          icon={Warehouse}
          labelInfo="Σ merma natural (con signo) del conjunto de lotes procesados / Σ de sus kg de entrada."
        />
        <KPICard
          className="glass-accented"
          label="Podrido calibrador"
          value={formatKg(agregado.kgPodridoCalibradorReal + agregado.kgPodridoCalibradorEstimado)}
          hint={`${formatKg(agregado.kgPodridoCalibradorReal)} real · ${formatKg(agregado.kgPodridoCalibradorEstimado)} ≈ estimado`}
          icon={Package}
          labelInfo="Kg descartados en el calibrador. Real = suma del Informe LOTE cuando existe (28 de 398 lotes); estimado = prorrateo del podrido del parte por el peso de cada lote."
        />
        <KPICard
          className="glass-accented"
          label="Podrido manual"
          value={formatKg(agregado.kgPodridoManualEstimado)}
          hint="≈ estimado (prorrateo; no se registra por lote)"
          icon={Package}
        />
      </section>

      {/* Cobertura del podrido REAL (el usuario está extrayendo el Informe LOTE
          de toda la campaña, ~50/día) + export del informe de decisión. */}
      <div className="glass flex flex-wrap items-center gap-3 rounded-xl p-2.5">
        <span
          className="text-xs text-muted-foreground"
          title="Prorrateo: se reparte el podrido total del parte del día entre los lotes procesados según su peso — una estimación, no un peso medido lote a lote como el Informe LOTE."
        >
          Podrido con dato REAL (Informe LOTE):{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {procesados.filter((l) => l.podridoCalibradorFuente === "real").length}
          </span>{" "}
          de <span className="font-semibold tabular-nums text-foreground">{procesados.length}</span> lotes procesados —
          el resto es prorrateo. Cuantos más informes se importen, más fiable el % por productor.
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            ref={camaraInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => handleImportarMermaCamara(e.target.files?.[0] ?? null)}
          />
          <Button
            size="sm"
            variant="outline"
            className="glass glass-hover h-8"
            onClick={() => camaraInputRef.current?.click()}
            disabled={importandoCamara}
            title="Sube el Excel 'Merma fruta camaras' (Guadex/Espalmex): peso inicial − peso final por camión. Casa por fecha y kg exactos con la entrada y convierte la merma estimada en MEDIDA."
          >
            {importandoCamara ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Importar mermas de cámara
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="glass glass-hover h-8"
            onClick={handleExportProductores}
            disabled={exportando || procesados.length === 0}
          >
            {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Exportar por productor y finca (Excel)
          </Button>
        </div>
      </div>

      {agregado.nPendientesOParciales > 0 && (
        <p className="text-xs text-muted-foreground">
          {agregado.nPendientesOParciales} lote{agregado.nPendientesOParciales === 1 ? "" : "s"} aún en cámara/parcial
          {agregado.nPendientesOParciales === 1 ? "" : "es"} sin merma calculable (no aparecen en esta tabla).
        </p>
      )}

      {agregado.nLotesCerradosSinRegistro > 0 && (
        <p className="text-xs text-muted-foreground">
          {agregado.nLotesCerradosSinRegistro} lote{agregado.nLotesCerradosSinRegistro === 1 ? "" : "s"} cerrado
          {agregado.nLotesCerradosSinRegistro === 1 ? "" : "s"} sin análisis ({formatKg(agregado.kgCerradosSinRegistro)}) — su
          procesado no consta bajo su código, excluidos de mermas y forfait (sin inventar una pérdida).
        </p>
      )}

      {/* ─── Atención especial ──────────────────────────────────────────── */}
      <div>
        <p className="panel-kicker mb-2">Atención especial</p>
        <div className="grid gap-3 md:grid-cols-3">
          <RankingCard titulo="Más kg en podrido" icon={Package} vacio={topPodridoKg.length === 0}>
            {topPodridoKg.map((r) => <RankingLoteRow key={r.lote} lote={r.lote} valorLabel={formatKg(r.kg)} />)}
          </RankingCard>
          <RankingCard titulo="Más % merma" icon={Percent} vacio={topMermaPct.length === 0}>
            {topMermaPct.map((r) => <RankingLoteRow key={r.lote} lote={r.lote} valorLabel={formatPct(r.pct)} />)}
          </RankingCard>
          {/* La pérdida POR PRODUCTOR vive en /productores (columna "% Pérdida"
              del ranking, mudada allí el 2026-07-28): esta página es eje
              fruta/lote y solo enlaza. */}
          <Card className="glass-accented">
            <CardContent className="flex h-full flex-col justify-between gap-2 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Pérdida por productor
              </div>
              <p className="text-xs text-muted-foreground">
                El ranking por productor (merma + podrido del periodo, ordenable) está en su sección.
              </p>
              <Link
                to="/productores"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Ver en Productores <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="glass-accented">
        <CardContent className="max-h-[65vh] overflow-auto p-0">
          {filasOrdenadas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Ningún lote procesado todavía.</p>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-[var(--glass-bg-solid)] backdrop-blur-xl">
                <TableRow>
                  <SortableTableHead label="Lote" sk="lote" sortKey={sortKey} sortDir={sortDir} onToggle={handleToggleSort} />
                  <SortableTableHead label="Entrada" sk="kg_entrada" right sortKey={sortKey} sortDir={sortDir} onToggle={handleToggleSort} />
                  <SortableTableHead label="Calibrador" sk="kg_calibrador" right sortKey={sortKey} sortDir={sortDir} onToggle={handleToggleSort} />
                  <SortableTableHead label="Días" sk="dias" right sortKey={sortKey} sortDir={sortDir} onToggle={handleToggleSort} />
                  <SortableTableHead label="Merma" sk="merma_kg" right sortKey={sortKey} sortDir={sortDir} onToggle={handleToggleSort} />
                  <SortableTableHead label="Merma %" sk="merma_pct" right sortKey={sortKey} sortDir={sortDir} onToggle={handleToggleSort} />
                  <SortableTableHead label="Podrido pre-calib." sk="podrido_pre" right sortKey={sortKey} sortDir={sortDir} onToggle={handleToggleSort} info={INFO_PODRIDO_PRE_CALIBRADOR} />
                  <SortableTableHead label="Podrido cal." sk="podrido_cal" right sortKey={sortKey} sortDir={sortDir} onToggle={handleToggleSort} />
                  <SortableTableHead label="Podrido man." sk="podrido_man" right sortKey={sortKey} sortDir={sortDir} onToggle={handleToggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filasOrdenadas.map((l, i) => (
                  <TableRow key={l.lote} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link to={`/trazabilidad?lote=${encodeURIComponent(l.lote)}`} className="inline-flex items-center gap-1 hover:text-primary hover:underline">
                        {l.lote} <ArrowRight className="h-3 w-3 opacity-50" />
                      </Link>
                      {l.cerradoManualmente && (
                        <Badge variant="outline" className="ml-1.5 border-[var(--glass-border)] px-1 py-0 align-middle text-[9px] font-normal text-muted-foreground">
                          <Lock className="mr-0.5 h-2.5 w-2.5" /> cerrado
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatKg(l.kgEntrada)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatKg(l.kgCalibrador)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{l.diasEnCamara ?? "—"}</TableCell>
                    <TableCell className={cn("text-right tabular-nums font-medium", l.calibradorSuperaEntrada && "text-warning")}>
                      {l.mermaNaturalKg != null ? formatKg(l.mermaNaturalKg) : "—"}
                      {l.calibradorSuperaEntrada && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        mermaSuperaEsperadaDoble(l) ? "font-semibold text-warning" : "text-muted-foreground",
                      )}
                      title={
                        mermaSuperaEsperadaDoble(l)
                          ? `Supera el doble de la merma natural esperada por ${l.diasEnCamara} día(s) en cámara (≈${formatPct(mermaEsperadaPct(l)!)} esperado)`
                          : undefined
                      }
                    >
                      {l.pctMermaSobreEntrada != null ? formatPct(l.pctMermaSobreEntrada) : "—"}
                      {mermaSuperaEsperadaDoble(l) && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.podridoPreCalibradorKg != null ? (
                        <span className="inline-flex items-center justify-end gap-1">
                          <Badge
                            variant="outline"
                            className={cn(
                              "px-1.5 py-0 text-[11px] font-semibold tabular-nums",
                              podridoPreCalibradorDestacado(l)
                                ? "border-warning/40 bg-warning/10 text-warning"
                                : "border-[var(--glass-border)] text-muted-foreground",
                            )}
                          >
                            {formatKg(l.podridoPreCalibradorKg)}
                          </Badge>
                          <FuenteBadge fuente="asumido" size="sm" />
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1">
                        {l.podridoCalibradorKg == null ? <span className="text-muted-foreground/70">sin dato</span> : formatKg(l.podridoCalibradorKg)}{" "}
                        <FuenteBadge fuente={fuentePodridoAVariant(l.podridoCalibradorFuente)} size="sm" />
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1">
                        {l.podridoManualKg == null ? <span className="text-muted-foreground/70">sin dato</span> : formatKg(l.podridoManualKg)}{" "}
                        <FuenteBadge fuente={fuentePodridoAVariant(l.podridoManualKg == null ? "desconocido" : "prorrateo")} size="sm" />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total ({filasOrdenadas.length})</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKg(totales.kgEntrada)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKg(totales.kgCalibrador)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{formatKg(totales.merma)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {totales.kgEntrada > 0 ? formatPct((totales.merma / totales.kgEntrada) * 100) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatKg(totales.podridoPreCalibrador)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKg(totales.podridoCal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKg(totales.podridoMan)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface ImportPreview {
  fileName: string;
  /** "bascula" = export de entradas; "stock" = informe de stock (sembrado inicial). */
  tipo: "bascula" | "stock";
  entradas: EntradaBasculaParsed[];
  descartadas: Array<{ fila: number; motivo: string }>;
}

export default function EntradasBascula() {
  const {
    entradas, entradasPrecalibrado, stock, procesados, conciliacionKg, movimientosPrecalibrado, derivadosCampoCit, isLoading, error,
    candidatosCierreAutomatico, candidatosCierreCompuesto, lotesEnPasadaCompuesta, camaraConfirmadaPorLote,
    pasadasPorLoteDonante, anotacionesPorLoteDia, codigosBascula, discrepanciasCierre, cicloPorLote,
    importar, importarStock, eliminar, cerrarLote, reabrirLote, cerrarLotesEnBloque, reabrirLotesEnBloque, actualizarCamaraConfirmada,
    agregarAnotacion, quitarAnotacion,
  } = useEntradasBascula();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parseando, setParseando] = useState(false);
  const [search, setSearch] = useState("");
  const [soloActivos, setSoloActivos] = useState(true);
  const [soloProbablesTerminados, setSoloProbablesTerminados] = useState(false);
  const [sortKey, setSortKey] = useState<StockSortKey>("fecha_entrada");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Estado inicial de la pestaña desde ?tab= (p.ej. el enlace "Ver mermas y
  // coste" del dashboard de producción a /entradas?tab=mermas): solo lee el
  // valor al montar, igual que el resto de parámetros de conectividad de más
  // abajo (?lote=) — no hace falta sincronizar en cada cambio de URL.
  const [activeTab, setActiveTab] = useState<"stock" | "dias" | "mermas" | "conciliacion">(() => {
    const tab = searchParams.get("tab");
    return tab === "mermas" || tab === "dias" || tab === "conciliacion" ? tab : "stock";
  });
  const [highlightLote, setHighlightLote] = useState<string | null>(null);
  const [bloqueDialogOpen, setBloqueDialogOpen] = useState(false);
  const [bloqueTerminadosDialogOpen, setBloqueTerminadosDialogOpen] = useState(false);
  const [confirmarCamaraDialogOpen, setConfirmarCamaraDialogOpen] = useState(false);

  // ─── Señales para las cámaras externas (Guadex/Zamexfruit) ─────────────────
  // El estado de cada camión externo se DERIVA de datos que ya fluyen a diario
  // (ver src/lib/camarasExternas.ts): lotes con salida de cámara medida (Excel
  // de mermas → entradas_bascula.fecha_salida_camara/merma_camara_kg) y lotes
  // con alguna pasada de calibrador (partes diarios). Nada se mueve a mano.
  const senalesCamaraExterna = useMemo((): SenalesRecepcion => {
    const salidaPorLote = new Map<string, string | null>();
    for (const e of entradas) {
      const salida = (e as { fecha_salida_camara?: string | null }).fecha_salida_camara ?? null;
      const merma = (e as { merma_camara_kg?: number | null }).merma_camara_kg ?? null;
      if (salida == null && merma == null) continue;
      const lote8 = normalizarLoteCodigo(e.lote);
      if (lote8) salidaPorLote.set(lote8, salida);
    }
    const lotesProcesados = new Set<string>();
    for (const p of procesados) {
      const lote8 = normalizarLoteCodigo(p.lote_codigo);
      if (lote8) lotesProcesados.add(lote8);
    }
    return { salidaPorLote, lotesProcesados };
  }, [entradas, procesados]);
  const [conciliarDialogOpen, setConciliarDialogOpen] = useState(false);

  // ─── Cesiones de kg por lote (refuerzo 2026-08-03): "restante nunca
  // negativo, con el exceso expuesto" ─────────────────────────────────────
  // Un lote cuyas pasadas crudas superan lo que le cabe cede el exceso a
  // otro lote (conciliarKgProcesados, fase de derrame) — su propio
  // kg_en_camara ya sale en 0 (Math.max(0, …) de buildStockEntradas), pero
  // sin esto la fila no explica POR QUÉ: parece simplemente "procesado del
  // todo" cuando en realidad prestó kg a un vecino. Se agrupa por motivo
  // (misma taxonomía que la pestaña "Conciliación kg", MOTIVO_LABEL) para
  // mostrar un badge compacto en la fila de Stock sin duplicar esa pantalla.
  const cesionesPorLote = useMemo(() => {
    const map = new Map<string, Map<MovimientoKg["motivo"], number>>();
    for (const m of conciliacionKg.movimientos) {
      const porMotivo = map.get(m.de) ?? new Map<MovimientoKg["motivo"], number>();
      porMotivo.set(m.motivo, (porMotivo.get(m.motivo) ?? 0) + m.kg);
      map.set(m.de, porMotivo);
    }
    return map;
  }, [conciliacionKg.movimientos]);

  // ─── Stock de precalibrado (refuerzo 04-08-2026) ───────────────────────────
  // Se calcula UNA vez aquí (antes solo vivía dentro de la card) para que el
  // efecto de cierre automático de más abajo pueda leer `candidatosCierre`
  // sin duplicar la llamada a buildStockPrecalibrado. `lotesEnPasadaCompuesta`
  // es la MISMA evidencia textual que resuelve los huérfanos reales de más
  // abajo — el dueño confirmó contra la BD que 37 de las 304 entradas PREC
  // activas están en ese mismo caso (nombradas en una pasada compuesta, 0 kg
  // bajo su propio código).
  const stockPrecalibrado = useMemo(
    () => buildStockPrecalibrado(
      entradasPrecalibrado.map((e) => ({
        lote: e.lote,
        fecha: e.fecha,
        finca: e.finca,
        kg_entrada: Number(e.kg_entrada) || 0,
        id: e.id,
        cerrado_at: e.cerrado_at ?? null,
      })),
      conciliacionKg.procesados,
      today(),
      lotesEnPasadaCompuesta,
    ),
    [entradasPrecalibrado, conciliacionKg.procesados, lotesEnPasadaCompuesta],
  );

  // ─── Cierre automático PERSISTIDO de lotes COMPLETOS (refuerzo 2026-08-03) ──
  // Encargo del dueño: "cuando pasa todo, se debe cerrar el lote... refuerza
  // esa parte". El cálculo derivado (buildStockEntradas) YA trata un lote
  // ≥97% procesado como "procesado" en stock/mermas/KPIs, pero la fila de
  // entradas_bascula se queda con cerrado_at=null para siempre si nadie pulsa
  // "cerrar" a mano (backlog real de 819 lotes/17.364 t detectado el
  // 03-08-2026). En vez de esperar al clic, la pestaña de Stock cierra sola
  // los candidatos (ver esCandidatoCierreAutomatico/candidatosCierreAutomatico)
  // al cargar, reutilizando la MISMA mutación de cierre en bloque que el
  // botón manual (modo "con_analisis" fijo: a ese % el hueco siempre es
  // plausible como merma real, ver criterioCierreModo). Solo admin (mismo
  // criterio que el resto de acciones de cierre en bloque de esta página) y
  // como mucho una vez por carga de página — el ref evita reintentar en cada
  // re-render mientras la mutación está en vuelo o si ya se disparó.
  // Refuerzo 04-08-2026: además de los COMPLETOS de siempre (con_analisis),
  // en la MISMA pasada se cierran solos los huérfanos de pasada COMPUESTA
  // (lotes reales Y entradas internas PREC, ver candidatosCierreCompuesto /
  // stockPrecalibrado.candidatosCierre) — siempre con cierre_modo
  // "sin_registro", nunca "con_analisis": su kg no consta bajo su propio
  // código, así que el hueco NO es una pérdida real (no se le inventa merma).
  // Los tres orígenes comparten la misma mutación en bloque (ya agrupa por
  // modo internamente) para no disparar 3 escrituras separadas al cargar.
  const autoCierreDisparado = useRef(false);
  useEffect(() => {
    if (!isAdmin || isLoading || autoCierreDisparado.current) return;
    const itemsCompletos = candidatosCierreAutomatico.map((c) => ({ id: c.id, cierreModo: "con_analisis" as const }));
    const itemsCompuestoReal = candidatosCierreCompuesto.map((c) => ({ id: c.id, cierreModo: "sin_registro" as const }));
    const itemsCompuestoPrec = stockPrecalibrado.candidatosCierre.map((c) => ({ id: c.id, cierreModo: "sin_registro" as const }));
    const items = [...itemsCompletos, ...itemsCompuestoReal, ...itemsCompuestoPrec];
    if (items.length === 0) return;
    autoCierreDisparado.current = true;
    cerrarLotesEnBloque.mutate(
      { items },
      {
        onSuccess: (r) => {
          if (r.cerrados > 0) {
            const partes: string[] = [];
            if (itemsCompletos.length > 0) partes.push(`${itemsCompletos.length} completo${itemsCompletos.length === 1 ? "" : "s"} (≥97%)`);
            const compuestos = itemsCompuestoReal.length + itemsCompuestoPrec.length;
            if (compuestos > 0) partes.push(`${compuestos} por pasada compuesta (incluido precalibrado)`);
            toast({
              title: "La herramienta ha cerrado lotes solos",
              description: `${r.cerrados} lote${r.cerrados === 1 ? "" : "s"} sin actividad en ${DIAS_SIN_ACTIVIDAD_AUTOCIERRE} días o más: ${partes.join(" · ")}. Dejan de contar como pendientes.`,
            });
          }
        },
        onError: (e) => toast({ title: "No se pudo cerrar automáticamente", description: errorMessage(e), variant: "destructive" }),
      },
    );
  }, [isAdmin, isLoading, candidatosCierreAutomatico, candidatosCierreCompuesto, stockPrecalibrado.candidatosCierre, cerrarLotesEnBloque]);

  // ─── Conectividad: llegada desde Trazabilidad con ?lote= ────────────────
  // Prefiltra el buscador, se asegura de que la fila sea visible (aunque esté
  // procesada) y limpia el parámetro de la URL para que el buscador quede
  // editable con normalidad.
  const loteParamAplicado = useRef(false);
  useEffect(() => {
    if (loteParamAplicado.current || isLoading) return;
    const loteParam = normalizarLoteCodigo(searchParams.get("lote"));
    loteParamAplicado.current = true;
    if (!loteParam) return;
    setSearch(loteParam);
    setActiveTab("stock");
    const fila = stock.filas.find((f) => f.lote === loteParam);
    if (fila?.estado === "procesado") setSoloActivos(false);
    setHighlightLote(loteParam);
    const next = new URLSearchParams(searchParams);
    next.delete("lote");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, stock.filas]);

  // El resaltado de la fila se desvanece solo tras un momento.
  useEffect(() => {
    if (!highlightLote) return;
    const t = setTimeout(() => setHighlightLote(null), 2200);
    return () => clearTimeout(t);
  }, [highlightLote]);

  // Lleva la fila destacada a la vista una vez filtrada/renderizada.
  useEffect(() => {
    if (!highlightLote) return;
    const el = document.getElementById(`stock-row-${highlightLote}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightLote]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setParseando(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

      // Detección automática: primero se intenta como export de entradas; si no
      // tiene esa cabecera, como informe de stock ("Kgr.Exist.") para el sembrado.
      const parsed = parseEntradasBasculaRows(rows);
      if (parsed.entradas.length > 0) {
        setPreview({ fileName: file.name, tipo: "bascula", ...parsed });
        return;
      }

      const stockParsed = parseStockLotesRows(rows);
      if (stockParsed.lotes.length > 0) {
        setPreview({
          fileName: file.name,
          tipo: "stock",
          entradas: buildEntradasDesdeStock(stockParsed.lotes, procesados),
          descartadas: stockParsed.descartadas,
        });
        return;
      }

      toast({
        title: "Archivo no reconocido",
        description: "No parece un export de entradas de báscula ni un informe de stock de lotes.",
        variant: "destructive",
      });
      setPreview(null);
    } catch (e) {
      toast({ title: "No se pudo leer el archivo", description: errorMessage(e), variant: "destructive" });
    } finally {
      setParseando(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const lotesExistentes = useMemo(() => new Set(entradas.map((e) => e.lote)), [entradas]);
  const previewStats = useMemo(() => {
    if (!preview) return null;
    const fechas = preview.entradas.map((e) => e.fecha).sort();
    const filasNuevas = preview.entradas.filter((e) => !lotesExistentes.has(e.lote));
    // Cuántas de las nuevas son movimientos internos de precalibrado: se
    // importan pero NO aparecen en stock/listas (regla del dueño) — si no se
    // avisa, el import parece "no hacer nada" (confusión real, 22-jul-2026:
    // un export cuyo único contenido nuevo eran filas PREC).
    const nuevasPrec = filasNuevas.filter((e) => esEntradaPrecalibrado({ finca: e.finca, agricultor: e.agricultor })).length;
    return {
      kg: preview.entradas.reduce((s, e) => s + e.kg_entrada, 0),
      desde: fechas[0],
      hasta: fechas[fechas.length - 1],
      nuevas: filasNuevas.length,
      nuevasPrec,
      actualizadas: preview.entradas.length - filasNuevas.length,
    };
  }, [preview, lotesExistentes]);

  const confirmarImport = () => {
    if (!preview) return;
    const mutation = preview.tipo === "stock" ? importarStock : importar;
    mutation.mutate(preview.entradas, {
      onSuccess: () => {
        toast({
          title: preview.tipo === "stock" ? "Stock inicial sembrado" : "Entradas importadas",
          description: preview.tipo === "stock"
            ? `${previewStats?.nuevas ?? 0} lote(s) nuevo(s) creado(s); los ${previewStats?.actualizadas ?? 0} que ya existían se han respetado.`
            : `${preview.entradas.length} entrada(s) guardada(s) (${previewStats?.nuevas ?? 0} nueva(s)${(previewStats?.nuevasPrec ?? 0) > 0 ? `, de ellas ${previewStats?.nuevasPrec} de precalibrado que NO aparecen en stock` : ""}).`,
        });
        setPreview(null);
      },
      onError: (e) => toast({ title: "Error al importar", description: errorMessage(e), variant: "destructive" }),
    });
  };

  const searchLower = normalizarTexto(search).trim();
  const filasVisibles = useMemo(() => {
    const filtradas = stock.filas.filter((fila) => {
      if (soloActivos && fila.estado === "procesado") return false;
      if (soloProbablesTerminados && !fila.probablementeTerminado) return false;
      if (!searchLower) return true;
      return (
        normalizarTexto(fila.lote).includes(searchLower)
        || normalizarTexto(fila.finca).includes(searchLower)
        || normalizarTexto(fila.articulo).includes(searchLower)
        || normalizarTexto(fila.agricultor).includes(searchLower)
      );
    });
    const ordenadas = [...filtradas].sort((a, b) => compareStockRows(a, b, sortKey));
    if (sortDir === "desc") ordenadas.reverse();
    return ordenadas;
  }, [stock.filas, soloActivos, soloProbablesTerminados, searchLower, sortKey, sortDir]);

  const handleToggleSort = (key: StockSortKey) => toggleSort(key, sortKey, sortDir, setSortKey, setSortDir);

  const entradaPorLote = useMemo(() => new Map(entradas.map((e) => [e.lote, e])), [entradas]);
  const hayEntradas = entradas.length > 0;

  // Lotes activos (pendiente/parcial) con su id real de entradas_bascula, para
  // el diálogo de cierre en bloque (solo admin): StockLoteRow no trae `id`.
  const lotesActivosParaBloque = useMemo(
    () => stock.filas
      .filter((f) => f.estado !== "procesado")
      .map((f) => {
        const row = entradaPorLote.get(f.lote);
        return row ? { id: row.id, lote: f.lote, fecha_entrada: f.fecha_entrada, kg_entrada: f.kg_entrada, kg_procesado: f.kg_procesado } : null;
      })
      .filter((f): f is NonNullable<typeof f> => f != null),
    [stock.filas, entradaPorLote],
  );

  // Mismo mapeo, pero solo los "probablemente terminados" (≥UMBRAL_PROBABLE_TERMINADO
  // procesado y ≥DIAS_SIN_ACTIVIDAD_TERMINADO días sin actividad) para
  // prefiltrar el diálogo de cierre en bloque desde el banner de abajo, en
  // modo con_analisis fijo.
  const lotesProbablesTerminadosParaBloque = useMemo(
    () => lotesActivosParaBloque.filter((f) => stock.filas.find((s) => s.lote === f.lote)?.probablementeTerminado),
    [lotesActivosParaBloque, stock.filas],
  );

  // Lotes cerrados a mano con una pasada del calibrador posterior a su cierre
  // (guardia inversa, pasadasPosterioresAlCierre): la fruta "cerrada" volvió a
  // línea, así que el cierre fue probablemente un error — se avisa aparte,
  // nunca se reabre solo.
  const lotesCerradosConActividadPosteriorIds = useMemo(
    () => stock.lotesCerradosConActividadPosterior
      .map((f) => entradaPorLote.get(f.lote)?.id)
      .filter((id): id is string => Boolean(id)),
    [stock.lotesCerradosConActividadPosterior, entradaPorLote],
  );

  // Stock en cámara agrupado por variedad (solo lotes activos), para ver de un
  // vistazo cuánta fruta de cada tipo queda por procesar.
  const stockPorVariedad = useMemo(() => {
    const map = new Map<string, { kg: number; lotes: number }>();
    for (const f of stock.filas) {
      if (f.estado === "procesado" || f.kg_en_camara <= 0) continue;
      const clave = f.articulo ?? "Sin variedad";
      const acc = map.get(clave) ?? { kg: 0, lotes: 0 };
      acc.kg += f.kg_en_camara;
      acc.lotes += 1;
      map.set(clave, acc);
    }
    return Array.from(map.entries())
      .map(([variedad, v]) => ({ variedad, ...v }))
      .sort((a, b) => b.kg - a.kg);
  }, [stock.filas]);

  // Entradas agrupadas por día (vista "lo que entró cada día"), con el kg del
  // día y el nº de fincas distintas para la jerarquía visual del listado.
  const entradasPorDia = useMemo(() => {
    const map = new Map<string, typeof entradas>();
    for (const e of entradas) {
      const arr = map.get(e.fecha) ?? [];
      arr.push(e);
      map.set(e.fecha, arr);
    }
    const dias = Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fecha, filasDia]) => ({
        fecha,
        filasDia,
        kgDia: filasDia.reduce((s, e) => s + (Number(e.kg_entrada) || 0), 0),
        fincas: new Set(filasDia.map((e) => e.finca).filter((f): f is string => Boolean(f))).size,
      }));
    const maxKgDia = Math.max(1, ...dias.map((d) => d.kgDia));
    return { dias, maxKgDia };
  }, [entradas]);

  // Resumen de una línea bajo el subtítulo: última entrada + fincas activas.
  const resumenHeader = useMemo(() => {
    if (entradas.length === 0) return null;
    const ultimaFecha = entradas.reduce((max, e) => (e.fecha > max ? e.fecha : max), entradas[0].fecha);
    const fincasActivas = new Set(
      stock.filas.filter((f) => f.estado !== "procesado").map((f) => f.finca).filter((f): f is string => Boolean(f)),
    ).size;
    return { ultimaFecha, fincasActivas };
  }, [entradas, stock.filas]);

  return (
    <div className="page-shell">
      <header className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Entradas de fruta</h1>
          <p className="page-subtitle">
            Báscula → stock en cámara → calibrador: trazabilidad por lote desde la finca.
          </p>
          {resumenHeader && (
            <p className="mt-1 text-xs text-muted-foreground">
              Última entrada <span className="font-medium text-foreground">{formatDate(resumenHeader.ultimaFecha)}</span>
              {resumenHeader.fincasActivas > 0 && (
                <> · fruta de <span className="font-medium text-foreground">{resumenHeader.fincasActivas}</span> finca{resumenHeader.fincasActivas === 1 ? "" : "s"} distinta{resumenHeader.fincasActivas === 1 ? "" : "s"} esperando en cámara</>
              )}
            </p>
          )}
        </div>
        <Button
          className="glass glass-hover"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={parseando || importar.isPending || importarStock.isPending}
          title="Acepta el export de entradas de la báscula y el informe de stock de lotes (se detecta solo)"
        >
          {parseando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importar Excel de báscula
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
      </header>

      {/* ─── Cierre masivo (solo admin) ──────────────────────────────────── */}
      {isAdmin && (
        <CerrarLotesEnBloqueDialog
          open={bloqueDialogOpen}
          onOpenChange={setBloqueDialogOpen}
          filas={lotesActivosParaBloque}
          cerrarLotesEnBloque={cerrarLotesEnBloque}
        />
      )}

      {/* ─── Cierre masivo prefiltrado a "probablemente terminados" (banner de abajo, solo admin) ── */}
      {isAdmin && (
        <CerrarLotesEnBloqueDialog
          open={bloqueTerminadosDialogOpen}
          onOpenChange={setBloqueTerminadosDialogOpen}
          filas={lotesActivosParaBloque}
          lotesFijos={lotesProbablesTerminadosParaBloque}
          cerrarLotesEnBloque={cerrarLotesEnBloque}
        />
      )}

      {/* ─── Conciliación con el informe real de cámara (solo admin) ─────── */}
      {isAdmin && (
        <ConciliarInformeCamaraDialog
          open={conciliarDialogOpen}
          onOpenChange={setConciliarDialogOpen}
          stockFilas={stock.filas}
          entradas={entradas}
          cerrarLotesEnBloque={cerrarLotesEnBloque}
          reabrirLotesEnBloque={reabrirLotesEnBloque}
        />
      )}

      {/* ─── Confirmación FÍSICA de lotes en cámara (solo admin, refuerzo 04-08-2026) ── */}
      {isAdmin && (
        <ConfirmarLotesEnCamaraDialog
          open={confirmarCamaraDialogOpen}
          onOpenChange={setConfirmarCamaraDialogOpen}
          entradas={entradas}
          camaraConfirmadaPorLote={camaraConfirmadaPorLote}
          actualizarCamaraConfirmada={actualizarCamaraConfirmada}
        />
      )}

      {/* ─── Previsualización del import ───────────────────────────────── */}
      {preview && previewStats && (
        <Card className="glass-accented border-info/30">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileSpreadsheet className="h-4 w-4 text-info" />
              {preview.fileName}
              {preview.tipo === "stock" && (
                <Badge variant="outline" className="border-info/40 bg-info/10 px-1.5 py-0 text-[11px] text-info">
                  Informe de stock · sembrado inicial
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {preview.entradas.length} {preview.tipo === "stock" ? "lote(s)" : "entrada(s)"} · {formatDate(previewStats.desde)}
              {previewStats.hasta !== previewStats.desde && <> – {formatDate(previewStats.hasta)}</>} ·{" "}
              <span className="font-semibold text-foreground">{formatKg(previewStats.kg)}</span>
              {" "}· {previewStats.nuevas} nueva(s)
              {previewStats.actualizadas > 0 && (
                preview.tipo === "stock"
                  ? <>, {previewStats.actualizadas} ya existente(s) que se respetarán</>
                  : <>, {previewStats.actualizadas} ya existente(s) que se actualizarán</>
              )}
            </p>
            {preview.tipo === "stock" && (
              <p className="w-full text-xs text-muted-foreground">
                El kg de entrada de cada lote se reconstruye como stock actual + lo que el calibrador ya procesó de ese
                lote: así el stock calculado coincide con el informe y el procesado futuro descuenta bien.
              </p>
            )}
            {previewStats.nuevasPrec > 0 && (
              <p className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                {previewStats.nuevasPrec === previewStats.nuevas
                  ? <>Todas las entradas nuevas son movimientos internos de PRECALIBRADO: se guardan, pero no aparecen en el stock ni en las listas (no son fruta nueva).</>
                  : <>{previewStats.nuevasPrec} de las nuevas son movimientos internos de PRECALIBRADO: se guardan pero no aparecen en stock.</>}
              </p>
            )}
            {preview.descartadas.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {preview.descartadas.length} fila(s) descartada(s): {preview.descartadas.slice(0, 3).map((d) => `fila ${d.fila} (${d.motivo})`).join(", ")}{preview.descartadas.length > 3 && "…"}
              </p>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" onClick={confirmarImport} disabled={importar.isPending || importarStock.isPending}>
                {importar.isPending || importarStock.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Guardar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={importar.isPending || importarStock.isPending}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-96 w-full" />
        </>
      ) : error ? (
        <Card className="glass-accented border-destructive/30">
          <CardContent className="flex items-center gap-3 py-6 text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">{errorMessage(error)}</p>
          </CardContent>
        </Card>
      ) : !hayEntradas ? (
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Truck className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="font-semibold">Todavía no hay entradas de báscula</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Para arrancar, importa el <span className="font-medium text-foreground">informe de stock de lotes</span> del
                programa de báscula (siembra el stock actual) y a partir de ahí el export de entradas de cada día.
                El importador detecta solo qué tipo de archivo le das.
              </p>
            </div>
            <Button className="glass glass-hover mt-2" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" /> Importar Excel de báscula
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ─── KPIs de stock ─────────────────────────────────────────── */}
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KPICard
              className="glass-accented"
              label="Stock en cámara"
              value={formatKg(stock.kgEnCamaraFirme)}
              hint="Entradas menos lo procesado por el calibrador"
              icon={Warehouse}
              labelInfo="Kg entrados por báscula que el calibrador aún no ha procesado (cruce por código de lote). Un lote cuenta como procesado cuando el calibrador ha pasado el 97% o más de sus kg (báscula y calibrador nunca pesan exactamente igual). Se excluyen los lotes 'probablemente terminados' (ver abajo), que se muestran aparte."
            >
              {stock.lotesProbablementeTerminados > 0 && (
                <p className="mt-2 text-xs font-medium text-warning">
                  + {formatKg(stock.kgProbablementeTerminados)} en {stock.lotesProbablementeTerminados} lote
                  {stock.lotesProbablementeTerminados === 1 ? "" : "s"} probablemente terminado
                  {stock.lotesProbablementeTerminados === 1 ? "" : "s"}
                </p>
              )}
            </KPICard>
            <KPICard
              className="glass-accented"
              label="Lotes en cámara"
              value={String(stock.lotesPendientes)}
              hint="Sin empezar a procesar"
              icon={Package}
            />
            <KPICard
              className="glass-accented"
              label="Lotes a medias"
              value={String(stock.lotesParciales)}
              hint="Procesados en parte"
              icon={Package}
              accent={stock.lotesParciales > 0 ? "warning" : "primary"}
            />
            <KPICard
              className="glass-accented"
              label="Antigüedad máxima"
              value={`${stock.antiguedadMaxDias} días`}
              hint="Del lote activo más antiguo"
              icon={AlertTriangle}
              accent={stock.antiguedadMaxDias > 14 ? "destructive" : stock.antiguedadMaxDias > 7 ? "warning" : "primary"}
              labelInfo="Días desde la entrada del lote activo (en cámara o parcial) más antiguo. Más de 7 días en ámbar, más de 14 en rojo."
            />
          </section>

          {/* ─── Banner: lotes probablemente terminados (solo admin puede cerrar en bloque) ── */}
          {stock.lotesProbablementeTerminados > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <HelpCircle className="h-4 w-4 shrink-0" />
              <span>
                {stock.lotesProbablementeTerminados} lote{stock.lotesProbablementeTerminados === 1 ? "" : "s"} llevan{" "}
                {DIAS_SIN_ACTIVIDAD_TERMINADO} días o más sin actividad con el {formatPct(UMBRAL_PROBABLE_TERMINADO * 100)} o
                más procesado — probablemente terminados, pero no se cierran solos (el hueco puede ser fruta que vuelva a
                línea).
              </span>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8 border-warning/40 bg-warning/5 text-xs text-warning hover:bg-warning/15"
                  onClick={() => setBloqueTerminadosDialogOpen(true)}
                >
                  <Lock className="h-3.5 w-3.5" /> Cerrar todos con análisis…
                </Button>
              )}
            </div>
          )}

          {/* ─── Aviso: lotes cerrados con una pasada del calibrador posterior al cierre ── */}
          {stock.lotesCerradosConActividadPosterior.length > 0 && (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {stock.lotesCerradosConActividadPosterior.length} lote
                  {stock.lotesCerradosConActividadPosterior.length === 1 ? "" : "s"} cerrado
                  {stock.lotesCerradosConActividadPosterior.length === 1 ? "" : "s"} a mano volvieron a pasar por el
                  calibrador DESPUÉS del cierre: revisar, probablemente hay que reabrirlos.
                </span>
                {isAdmin && lotesCerradosConActividadPosteriorIds.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-8 border-destructive/40 bg-destructive/5 text-xs text-destructive hover:bg-destructive/15"
                    disabled={reabrirLotesEnBloque.isPending}
                    onClick={() => {
                      reabrirLotesEnBloque.mutate({ ids: lotesCerradosConActividadPosteriorIds }, {
                        onSuccess: (r) => toast({ title: "Lotes reabiertos", description: `${r.reabiertos} lote(s) vuelven a estar activos.` }),
                        onError: (err) => toast({ title: "No se pudieron reabrir", description: errorMessage(err), variant: "destructive" }),
                      });
                    }}
                  >
                    {reabrirLotesEnBloque.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />}
                    Reabrir todos
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {stock.lotesCerradosConActividadPosterior.map((f) => (
                  <Link
                    key={f.lote}
                    to={`/trazabilidad?lote=${encodeURIComponent(f.lote)}`}
                    className="rounded-md border border-destructive/30 bg-[var(--glass-bg)] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-destructive hover:underline"
                  >
                    {f.lote}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ─── CINTURÓN Y TIRANTES (fase 3b): discrepancias de cierre entre ──
              motores. Cola de revisión, NO un error: el motor viejo daba estos
              lotes por candidatos a cierre automático, pero el motor de
              evidencia (cicloVidaLote.ts) los veta — no se cierran solos
              mientras estén aquí (ver aplicarCinturonYTirantes,
              cicloVidaLoteAdapter.ts, y useEntradasBascula.ts). ── */}
          {discrepanciasCierre.length > 0 && (
            <Card className="glass-accented border-warning/30">
              <CardContent className="space-y-2.5 p-4 sm:p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-warning">
                  <GitCompare className="h-4 w-4 shrink-0" />
                  Discrepancias de cierre entre motores ({discrepanciasCierre.length})
                </div>
                <p className="text-xs text-muted-foreground">
                  El motor de evidencia (fase 3b, solo lectura) veta el cierre automático de estos lotes aunque el motor
                  anterior los daba por candidatos — no se cierran solos, cola de revisión.
                </p>
                <ul className="space-y-1.5">
                  {discrepanciasCierre.map((d) => (
                    <li
                      key={`${d.tipo}-${d.lote}`}
                      className="flex flex-wrap items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs"
                    >
                      <Link
                        to={`/trazabilidad?lote=${encodeURIComponent(d.lote)}`}
                        className="inline-flex shrink-0 items-center gap-1 font-semibold tabular-nums text-warning hover:underline"
                      >
                        {d.lote} <ArrowRight className="h-3 w-3 opacity-60" />
                      </Link>
                      <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/10 px-1.5 py-0 text-[10px] text-warning">
                        {d.tipo === "compuesto" ? "candidato compuesto" : "candidato completo"}
                        {d.estadoNuevo && <> · {ESTADO_LOTE_LABEL[d.estadoNuevo]}</>}
                      </Badge>
                      <span className="text-muted-foreground">{d.razon}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "stock" | "dias" | "mermas" | "conciliacion")} className="space-y-4">
            <TabsList className="w-full flex-wrap sm:w-auto">
              <TabsTrigger value="stock">Stock en cámara</TabsTrigger>
              <TabsTrigger value="dias">
                Entradas por día <Badge variant="secondary" className="ml-1.5 px-1.5 text-[10px]">{entradasPorDia.dias.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="mermas">Mermas y coste</TabsTrigger>
              <TabsTrigger value="conciliacion">
                Conciliación kg
                {conciliacionKg.excesosSinColocar.length > 0 && (
                  <Badge variant="outline" className="ml-1.5 border-warning/40 bg-warning/10 px-1.5 text-[10px] text-warning">
                    {conciliacionKg.excesosSinColocar.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stock" className="mt-0 space-y-4">
          {/* ─── Stock por variedad (solo activos) ─────────────────────── */}
          {stockPorVariedad.length > 0 && (
            <Card className="glass-accented">
              <CardContent className="space-y-2.5 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
                  <div>
                    <p className="panel-kicker">Stock por variedad</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Fruta sin procesar en cámara, agrupada por artículo</p>
                  </div>
                </div>
                {stockPorVariedad.slice(0, STOCK_VARIEDAD_LIMIT).map((v) => (
                  <VariedadRow key={v.variedad} variedad={v} totalKg={stock.kgEnCamara} />
                ))}
                {stockPorVariedad.length > STOCK_VARIEDAD_LIMIT && (
                  <Collapsible>
                    <CollapsibleContent className="space-y-2.5">
                      {stockPorVariedad.slice(STOCK_VARIEDAD_LIMIT).map((v) => (
                        <VariedadRow key={v.variedad} variedad={v} totalKg={stock.kgEnCamara} />
                      ))}
                    </CollapsibleContent>
                    <CollapsibleTrigger className="group flex items-center gap-1 pt-0.5 text-xs font-medium text-primary hover:underline">
                      <span className="group-data-[state=open]:hidden">Ver todas ({stockPorVariedad.length})</span>
                      <span className="hidden group-data-[state=open]:inline">Ver menos</span>
                      <ChevronDown className="h-3 w-3 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                  </Collapsible>
                )}
                <div className="flex items-center gap-3 border-t border-[var(--glass-border)] pt-2 text-xs font-semibold text-foreground">
                  <span className="w-44 shrink-0 sm:w-56">Total en cámara</span>
                  <div className="min-w-0 flex-1" />
                  <span className="shrink-0 text-right tabular-nums">{formatKg(stock.kgEnCamara)}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ─── Cámaras externas (Guadex/Zamexfruit): dónde está la fruta ──
              entradas + cerrarLotesEnBloque: mínimo prop-drilling para que la
              propia card pueda ofrecer "Conciliar cámara vacía" (solo admin,
              ver ConciliarCamaraVaciaDialog.tsx) sin duplicar el fetch de
              entradas_bascula ni la mutación de cierre en bloque. ── */}
          <CamarasExternasCard senales={senalesCamaraExterna} entradas={entradas} cerrarLotesEnBloque={cerrarLotesEnBloque} />

          {/* ─── Stock de precalibrado: siempre visible (regla del dueño 2026-07-28) ──
              Refuerzo 04-08-2026: `stock` ya viene calculado arriba (useMemo
              compartido con el efecto de cierre automático); `cerrarLote` es
              el cierre manual 1-clic para las re-entradas SIN indicación en
              ningún informe (el dueño fue explícito: eso no se cierra solo). */}
          <StockPrecalibradoCard stock={stockPrecalibrado} cerrarLote={cerrarLote} />

          {(movimientosPrecalibrado.count > 0 || derivadosCampoCit.count > 0) && (
            <div className="space-y-1 px-1">
              {movimientosPrecalibrado.count > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Se excluyen {movimientosPrecalibrado.count} movimientos internos de precalibrado
                  ({formatKg(movimientosPrecalibrado.kg)}) de las entradas — fruta apartada que vuelve a entrar,
                  no es entrada nueva ni suma en el stock por lote (ya se contó en su lote de origen).
                  Su detalle, en la carta "Stock de precalibrado" de arriba.
                </p>
              )}
              {derivadosCampoCit.count > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {derivadosCampoCit.count} lote{derivadosCampoCit.count === 1 ? "" : "s"} derivado{derivadosCampoCit.count === 1 ? "" : "s"} a Cítrica
                  {" "}({formatKg(derivadosCampoCit.kg)}) — fruta comprada que no se procesa en la central, ver detalle abajo.
                </p>
              )}
            </div>
          )}

          {/* ─── Derivado a Cítrica (campo/cit): compra real que no procesa la central ── */}
          {derivadosCampoCit.count > 0 && (
            <Card className="glass-accented border-amber-500/25">
              <CardContent className="space-y-2.5 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-1 shrink-0 rounded-full bg-amber-500" />
                  <div>
                    <p className="panel-kicker">Derivado a Cítrica (campo/cit)</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Fruta comprada que no se procesa en la central; no cuenta como stock ni como merma.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Lote</TableHead>
                        <TableHead>Agricultor</TableHead>
                        <TableHead>Variedad</TableHead>
                        <TableHead className="text-right">Kg</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {derivadosCampoCit.filas.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(f.fecha)}</TableCell>
                          <TableCell className="whitespace-nowrap font-medium">
                            <Link
                              to={`/trazabilidad?lote=${encodeURIComponent(f.lote)}`}
                              className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                            >
                              {f.lote}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate">{f.agricultor ?? "—"}</TableCell>
                          <TableCell className="max-w-[160px] truncate text-muted-foreground">{f.articulo ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatKg(Number(f.kg_entrada) || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4}>Total ({derivadosCampoCit.count})</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(derivadosCampoCit.kg)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ─── Stock / listado por lote ──────────────────────────────── */}
          <Card className="glass-accented">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="panel-kicker">Trazabilidad</p>
                  <CardTitle className="text-base">
                    {soloActivos ? "Fruta sin procesar" : "Todas las entradas"} ({filasVisibles.length})
                  </CardTitle>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isAdmin && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="glass glass-hover h-9 text-xs"
                        onClick={() => setBloqueDialogOpen(true)}
                      >
                        <Lock className="h-3.5 w-3.5" /> Cerrar antiguos en bloque…
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="glass glass-hover h-9 text-xs"
                        onClick={() => setConciliarDialogOpen(true)}
                        title="Compara el stock activo contra el informe real de cámara del programa de báscula"
                      >
                        <GitCompare className="h-3.5 w-3.5" /> Conciliar con informe de cámara…
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="glass glass-hover h-9 text-xs"
                        onClick={() => setConfirmarCamaraDialogOpen(true)}
                        title="Anota la confirmación física de dirección tras inventariar una cámara a pie: esos lotes dejan de recibir derrames y de ser candidatos a cierre automático"
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" /> Confirmar lotes en cámara…
                      </Button>
                    </>
                  )}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Lote, finca, variedad, agricultor..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-9 w-full pl-8 sm:w-72"
                    />
                  </div>
                  {searchLower && (
                    <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => setSearch("")}>
                      <X className="h-3.5 w-3.5" /> Limpiar
                    </Button>
                  )}
                  <div className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0.5">
                    {([true, false] as const).map((valor) => (
                      <button
                        key={String(valor)}
                        type="button"
                        onClick={() => setSoloActivos(valor)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          soloActivos === valor ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {valor ? "Sin procesar" : "Todas"}
                      </button>
                    ))}
                  </div>
                  {stock.lotesProbablementeTerminados > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "glass h-9 text-xs",
                        soloProbablesTerminados ? "border-warning/40 bg-warning/10 text-warning" : "text-muted-foreground",
                      )}
                      onClick={() => setSoloProbablesTerminados((v) => !v)}
                      title={`Filtra a los lotes con ${formatPct(UMBRAL_PROBABLE_TERMINADO * 100)} o más procesado y ${DIAS_SIN_ACTIVIDAD_TERMINADO} días o más sin actividad del calibrador`}
                    >
                      <HelpCircle className="h-3.5 w-3.5" /> ¿Terminados? ({stock.lotesProbablementeTerminados})
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="max-h-[65vh] overflow-auto p-0">
              {/* Tabla compartida con el selector de /trazabilidad
                  (TablaLotesStock, reordenación 2026-07-28): aquí en variante
                  "gestion" — Procesado en kg, semáforo de días, Estado con
                  badges y acciones cerrar/reabrir/borrar. */}
              {filasVisibles.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {soloActivos ? "No queda fruta sin procesar con estos filtros. 🎉" : "Sin entradas que coincidan con la búsqueda."}
                </p>
              ) : (
                <TablaLotesStock<StockSortKey>
                  filas={filasVisibles}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggleSort={handleToggleSort}
                  onRowClick={(fila) => navigate(`/trazabilidad?lote=${encodeURIComponent(fila.lote)}`)}
                  rowId={(fila) => `stock-row-${fila.lote}`}
                  rowClassName={(fila) => cn(
                    "transition-shadow duration-700 hover:bg-primary/5",
                    highlightLote === fila.lote && "ring-1 ring-inset ring-info bg-info/5",
                  )}
                  columnas={[
                    {
                      id: "lote",
                      label: "Lote",
                      sk: "lote",
                      cellClassName: "font-medium",
                      render: (fila) => {
                        const cesiones = cesionesPorLote.get(fila.lote);
                        const compuestoCon = lotesEnPasadaCompuesta.get(fila.lote);
                        return (
                          <div className="flex flex-col items-start gap-1">
                            <Link
                              to={`/trazabilidad?lote=${encodeURIComponent(fila.lote)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 whitespace-nowrap hover:text-primary hover:underline"
                              title="Ver la trazabilidad completa del lote"
                            >
                              {fila.lote} <ArrowRight className="h-3 w-3 opacity-50" />
                            </Link>
                            {cesiones && Array.from(cesiones.entries()).map(([motivo, kg]) => (
                              <Badge
                                key={motivo}
                                variant="outline"
                                className={cn("px-1.5 py-0 text-[9px] font-normal", MOTIVO_BADGE[motivo])}
                                title={
                                  motivo === "reentrada_nombrados"
                                    // Regla del dueño 04-08-2026: esto NO es un derrame real (no infla
                                    // el stock de nadie) — es solo la atribución del sobrante de una
                                    // pasada multi-lote a los demás códigos que nombraba.
                                    ? `Este lote nombró a otros ${formatKg(kg)} de más en una pasada multi-lote (${MOTIVO_LABEL[motivo]}): no infla el stock de nadie, es solo la atribución de a qué lotes del informe pertenece con más probabilidad — ver la pestaña "Conciliación kg".`
                                    : `Este lote cedió ${formatKg(kg)} a otro lote (${MOTIVO_LABEL[motivo]}): sus pasadas crudas superaban lo que le cabía y el exceso se derramó — ver la pestaña "Conciliación kg".`
                                }
                              >
                                cedió {formatKg(kg)}
                              </Badge>
                            ))}
                            {fila.procesadoEnCompuesto ? (
                              // Refuerzo 04-08-2026: 0 kg propios + nombrado en una pasada
                              // compuesta -> ya cuenta como "Procesado" (ver buildStockEntradas)
                              // y se cierra solo a los 2 días de la última mención. Badge en
                              // verde para distinguirlo del "Procesado" normal (calibrador SÍ
                              // pesó bajo su propio código).
                              <Badge
                                variant="outline"
                                className="border-success/40 bg-success/10 px-1.5 py-0 text-[9px] font-normal text-success"
                                title={`0 kg conciliados bajo su propio código, pero el calibrador lo nombró junto a ${fila.procesadoEnCompuesto.primeros.join(", ")} en una pasada COMPUESTA: se da por procesado ahí (sin inventar una merma) y se cierra solo con cierre_modo "sin_registro" a los ${DIAS_SIN_ACTIVIDAD_AUTOCIERRE} días de esa mención.`}
                              >
                                procesado en compuesto (con {fila.procesadoEnCompuesto.primeros[0]}{fila.procesadoEnCompuesto.primeros.length > 1 ? ` +${fila.procesadoEnCompuesto.primeros.length - 1}` : ""})
                              </Badge>
                            ) : compuestoCon && fila.estado !== "procesado" && (
                              <Badge
                                variant="outline"
                                className="border-info/40 bg-info/10 px-1.5 py-0 text-[9px] font-normal text-info"
                                title={`Este lote aparece nombrado junto a ${compuestoCon.primeros.join(", ")} en una pasada COMPUESTA del calibrador: tiene algo de kg propio (por eso no se cierra solo) pero es posible que el resto de su fruta ya se procesara bajo ese código y el reparto no haya podido atribuírsela con fiabilidad (nunca se reparte kg por LIKE/subcadena). Evidencia para cerrarlo a mano si procede.`}
                              >
                                compuesto con {compuestoCon.primeros[0]}{compuestoCon.primeros.length > 1 ? ` +${compuestoCon.primeros.length - 1}` : ""}
                              </Badge>
                            )}
                            {fila.confirmacionCamara && (
                              // Confirmación FÍSICA vigente (refuerzo 04-08-2026, camaraConfirmada.ts):
                              // dirección vio este lote intacto al inventariar la cámara. NO es
                              // candidato a ningún cierre automático mientras esté vigente (mismo
                              // veto que la cámara externa) — se avisa explícitamente en el título.
                              <Badge
                                variant="outline"
                                className="border-info/40 bg-info/10 px-1.5 py-0 text-[9px] font-normal text-info"
                                title={`Confirmación física de dirección: sigue en ${fila.confirmacionCamara.nombre} desde el inventario del ${formatDate(fila.confirmacionCamara.fecha)}. No recibe derrames ni es candidato a ningún cierre automático mientras la señal esté vigente (caduca sola con una pasada propia posterior a esta fecha).`}
                              >
                                En cámara · {fila.confirmacionCamara.nombre} (confirmado {formatDate(fila.confirmacionCamara.fecha)})
                              </Badge>
                            )}
                          </div>
                        );
                      },
                    },
                    ...columnasComunesLotes<StockSortKey>("gestion"),
                    {
                      id: "procesado",
                      label: "Procesado",
                      sk: "kg_procesado",
                      right: true,
                      cellClassName: "text-right tabular-nums text-muted-foreground",
                      render: (fila) => (fila.kg_procesado > 0 ? formatKg(fila.kg_procesado) : "—"),
                    },
                    {
                      id: "en_camara",
                      label: "En cámara",
                      sk: "kg_en_camara",
                      right: true,
                      cellClassName: "text-right tabular-nums font-semibold",
                      render: (fila) => (fila.estado === "procesado" ? "—" : formatKg(fila.kg_en_camara)),
                    },
                    {
                      id: "dias",
                      label: "Días",
                      sk: "dias_en_camara",
                      right: true,
                      cellClassName: (fila) => cn("text-right tabular-nums", diasClass(fila.dias_en_camara, fila.estado)),
                      render: (fila) => (
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", diasDotClass(fila.dias_en_camara, fila.estado))} />
                          {fila.dias_en_camara}
                        </span>
                      ),
                    },
                    {
                      id: "estado",
                      label: "Estado",
                      sk: "estado",
                      render: (fila) => {
                        const badge = ESTADO_BADGE[fila.estado];
                        // FASE 3b: badge del motor de EVIDENCIA solo cuando DIFIERE
                        // de lo que ya dice el motor viejo (compararConMotorViejo
                        // solo informa cuando discrepan en si el lote está resuelto
                        // o no) — si coinciden, no se añade ruido a la fila. Reutiliza
                        // las etiquetas de CicloVidaEvidenciaSection.tsx, no duplica
                        // el mapa de labels/estilos.
                        const ciclo = cicloPorLote.get(fila.lote);
                        const discrepanciaMotor = ciclo ? compararConMotorViejo(fila, ciclo) : null;
                        return (
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className={cn("px-1.5 py-0 text-[11px]", badge.className)}>{badge.label}</Badge>
                            {discrepanciaMotor && ciclo && (
                              <Badge
                                variant="outline"
                                className={cn("px-1.5 py-0 text-[10px]", ESTADO_LOTE_BADGE[ciclo.estado])}
                                title={`Motor de evidencia (fase 3b, solo lectura): ${discrepanciaMotor.nota}`}
                              >
                                <GitCompare className="mr-1 h-2.5 w-2.5" /> evidencia: {ESTADO_LOTE_LABEL[ciclo.estado]}
                              </Badge>
                            )}
                            {fila.probablementeTerminado && (
                              <Badge
                                variant="outline"
                                className="border-warning/40 bg-warning/10 px-1.5 py-0 text-[10px] text-warning"
                                title={`Lleva el ${formatPct(UMBRAL_PROBABLE_TERMINADO * 100)} o más procesado y ${DIAS_SIN_ACTIVIDAD_TERMINADO} días o más sin ninguna pasada del calibrador — probablemente el hueco es merma/podrido, no fruta pendiente. Se desmarca solo en cuanto llegue una pasada nueva.`}
                              >
                                <HelpCircle className="mr-1 h-2.5 w-2.5" /> ¿terminado?
                              </Badge>
                            )}
                            {fila.cerrado_at && (
                              <Badge
                                variant="outline"
                                className="border-[var(--glass-border)] bg-[var(--glass-bg)] px-1.5 py-0 text-[10px] text-muted-foreground"
                                title={fila.cierre_modo === "sin_registro" ? "Su procesado no consta bajo este código: excluido de mermas/podrido/forfait." : "El hueco cuenta como merma natural + podrido pre-calibrador."}
                              >
                                <Lock className="mr-1 h-2.5 w-2.5" /> {fila.cierre_modo === "sin_registro" ? "Cerrado sin análisis" : "Cerrado a mano"}
                              </Badge>
                            )}
                            {fila.cerradoConActividadPosterior && (
                              <Badge
                                variant="outline"
                                className="border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[10px] text-destructive"
                                title="El calibrador registró una pasada DESPUÉS de cerrar este lote: la fruta volvió a línea, el cierre fue probablemente un error. Revisar y reabrir si procede."
                              >
                                <AlertTriangle className="mr-1 h-2.5 w-2.5" /> reanudó tras cerrar
                              </Badge>
                            )}
                          </div>
                        );
                      },
                    },
                    {
                      id: "acciones",
                      label: "Acciones",
                      right: true,
                      cellClassName: "text-right",
                      render: (fila) => {
                        const row = entradaPorLote.get(fila.lote);
                        return (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              title="Ver trazabilidad completa del lote"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/trazabilidad?lote=${encodeURIComponent(fila.lote)}`);
                              }}
                            >
                              <Route className="h-4 w-4" />
                            </Button>
                            {row && fila.cerrado_at && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                title="Reabrir este lote"
                                disabled={reabrirLote.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  reabrirLote.mutate(row.id, {
                                    onSuccess: () => toast({ title: "Lote reabierto", description: `El lote ${fila.lote} vuelve a estar activo.` }),
                                    onError: (err) => toast({ title: "No se pudo reabrir el lote", description: errorMessage(err), variant: "destructive" }),
                                  });
                                }}
                              >
                                <LockOpen className="h-4 w-4" />
                              </Button>
                            )}
                            {row && !fila.cerrado_at && fila.estado !== "procesado" && (
                              <CerrarLoteDialog
                                lote={fila.lote}
                                kgEntrada={fila.kg_entrada}
                                kgProcesado={fila.kg_procesado}
                                isPending={cerrarLote.isPending}
                                onConfirm={(cierreModo) => cerrarLote.mutate({ id: row.id, cierreModo }, {
                                  onSuccess: () => toast({ title: "Lote cerrado", description: `El lote ${fila.lote} se ha dado por terminado.` }),
                                  onError: (err) => toast({ title: "No se pudo cerrar el lote", description: errorMessage(err), variant: "destructive" }),
                                })}
                                trigger={(
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    title="Cerrar este lote"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Lock className="h-4 w-4" />
                                  </Button>
                                )}
                              />
                            )}
                            {row && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Borrar esta entrada"
                                disabled={eliminar.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  eliminar.mutate(row.id, {
                                    onSuccess: () => toast({ title: "Entrada borrada", description: `Lote ${fila.lote} eliminado del registro.` }),
                                    onError: (err) => toast({ title: "Error", description: errorMessage(err), variant: "destructive" }),
                                  });
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        );
                      },
                    },
                  ]}
                />
              )}
            </CardContent>
          </Card>
            </TabsContent>

            {/* ─── Entradas agrupadas por día ────────────────────────────── */}
            <TabsContent value="dias" className="mt-0 space-y-2">
              {entradasPorDia.dias.map(({ fecha, filasDia, kgDia, fincas }, index) => {
                const pctBarraDia = (kgDia / entradasPorDia.maxKgDia) * 100;
                return (
                  <Collapsible key={fecha} defaultOpen={index === 0}>
                    <div className="overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                      <CollapsibleTrigger className="group relative flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--glass-bg-strong)]">
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="shrink-0 text-sm font-semibold capitalize">
                          {new Date(`${fecha}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" })}
                        </span>
                        <span className="truncate text-[12px] text-muted-foreground">
                          {filasDia.length} entrada{filasDia.length === 1 ? "" : "s"} · {formatKg(kgDia)}
                          {fincas > 0 && <> · {fincas} finca{fincas === 1 ? "" : "s"}</>}
                        </span>
                        {/* Barra fina de kg del día relativa al mejor día visible: jerarquía visual de un vistazo. */}
                        <div className="absolute inset-x-3 bottom-0 h-[2px] overflow-hidden rounded-full bg-transparent">
                          <div
                            className="h-full rounded-full bg-primary/40 transition-all duration-500"
                            style={{ width: `${Math.max(2, pctBarraDia)}%` }}
                          />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="divide-y divide-[var(--glass-border)] border-t border-[var(--glass-border)]">
                          {filasDia.map((e) => (
                            <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm transition-colors hover:bg-[var(--glass-bg-strong)]/50">
                              <Link
                                to={`/trazabilidad?lote=${encodeURIComponent(e.lote)}`}
                                className="w-24 shrink-0 font-medium tabular-nums hover:text-primary hover:underline"
                                title="Ver la trazabilidad del lote"
                              >
                                {e.lote}
                              </Link>
                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                {e.finca ?? "—"}{e.articulo ? ` · ${e.articulo}` : ""}
                              </span>
                              <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
                                {e.envases ? `${formatNumber(e.envases)} env.` : ""}
                              </span>
                              <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{formatKg(Number(e.kg_entrada) || 0)}</span>
                              {e.origen === "stock_inicial" && (
                                <Badge variant="outline" className="border-info/40 bg-info/10 px-1.5 py-0 text-[10px] text-info" title="Sembrada desde el informe de stock">
                                  stock inicial
                                </Badge>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                                title="Borrar esta entrada"
                                disabled={eliminar.isPending}
                                onClick={() => {
                                  eliminar.mutate(e.id, {
                                    onSuccess: () => toast({ title: "Entrada borrada", description: `Lote ${e.lote} eliminado del registro.` }),
                                    onError: (err) => toast({ title: "Error", description: errorMessage(err), variant: "destructive" }),
                                  });
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </TabsContent>

            {/* ─── Mermas y coste: lotes procesados, merma natural + podrido, € solo admin ── */}
            <TabsContent value="mermas" className="mt-0">
              <MermasCosteTab />
            </TabsContent>

            {/* ─── Conciliación de kg: dónde ha ido cada kg reasignado ───── */}
            <TabsContent value="conciliacion" className="mt-0">
              <ConciliacionKgPanel
                conciliacion={conciliacionKg}
                filasStock={stock.filas}
                isAdmin={isAdmin}
                pasadasPorLoteDonante={pasadasPorLoteDonante}
                anotacionesPorLoteDia={anotacionesPorLoteDia}
                codigosBascula={codigosBascula}
                agregarAnotacion={agregarAnotacion}
                quitarAnotacion={quitarAnotacion}
              />
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground">
            {entradas.length} entrada(s) registradas · {formatNumber(entradas.reduce((s, e) => s + (Number(e.kg_entrada) || 0), 0))} kg entrados en total ·
            el enlace de cada lote abre su trazabilidad completa.
          </p>
        </>
      )}
    </div>
  );
}
