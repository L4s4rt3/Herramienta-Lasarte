// src/pages/EconomicoFruta.tsx
// Sección "Económico → Compra de fruta": detalle explotable de las entradas de
// báscula del periodo elegido. useCosteFruta (useEconomico.ts) ya da el
// agregado + serie semanal que usan EconomicoPanel/EconomicoCostes para el
// KPI "Compra de fruta" — aquí se REUTILIZA tal cual (no se duplica la
// fórmula importeEntradaFruta/agregarCosteFruta) y se añade el desglose por
// lote/agricultor/variedad que esos paneles no muestran, a partir de las
// filas crudas de useEntradasBascula (hook ya existente, solo se importa).
//
// Identidad de productor: mismo criterio que EconomicoCostes (pérdida por
// agricultor) y Productores.tsx — resolveProductorGroupKey con productor_id
// directo (si existe) o alias aprendido, con fallback al texto crudo.
import { useMemo, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  AlertTriangle, Calculator, Citrus, Download, Euro, Hash, Info, Package, Scale, Sprout, Tag, Trash2, TrendingDown, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { InfoTooltip } from "@/components/InfoTooltip";
import { KPICard } from "@/components/KPICard";
import { EconomicoSubnav } from "@/components/economico/EconomicoSubnav";
import { ConsumoPeriodoSelector } from "@/components/consumos/ConsumoPeriodoSelector";
import { SortableTableHead, toggleSort, type SortDir } from "@/components/SortableColumn";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useCosteFruta } from "@/hooks/useEconomico";
import { useEntradasBascula, type EntradaBasculaRow } from "@/hooks/useEntradasBascula";
import { useMermaLotes } from "@/hooks/useMermaLote";
import { useProductoresCatalogo } from "@/hooks/useProductoresCatalogo";
import { useCalidadReferencias } from "@/hooks/useCalidadReferencias";
import { resolveProductorGroupKey } from "@/lib/productoresCanonicos";
import { importeEntradaFruta } from "@/lib/economico";
import { mermaLotesEnPeriodo, TASA_MERMA_NATURAL_DIA, type MermaLote } from "@/lib/mermaLote";
import {
  agruparForfait, forfaitProyectado, PCT_PODRIDO_NO_PESADO_DEFECTO, perdidaSimulada, precioMaxCompra,
  type ForfaitGrupo, type ItemForfaitAgrupable,
} from "@/lib/forfait";
import { parseInformeTamanosClases, pctPodridoVariedad, type InformeTamanosClases } from "@/lib/calidadReferencias";
import {
  buildPeriodoRange,
  type ConsumoPeriodoTipo,
  type PeriodoRange,
} from "@/lib/consumoPeriodoView";
import {
  C, GRID, GlassTooltip, MARGIN, XAXIS, YAXIS, barFill, CHART_PANEL_CLASS, CHART_CURSOR,
} from "@/lib/chartTheme";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKg, formatNumber, formatPct, today } from "@/lib/format";
import {
  añadirHojaTabla, crearLibroLasarte, descargarLibro, FMT_EUR, FMT_EUR_KG, FMT_INT, FMT_KG, FMT_PCT,
  type ColumnaTabla,
} from "@/lib/exportKit";
import { buildLasarteFilename } from "@/lib/reportKit";

function formatEuro(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, digits)} €`;
}

// Fecha "YYYY-MM-DD" anclada al mediodía local, igual que el resto de exports
// Lasarte (ver EconomicoPrecios.tsx) — evita el desplazamiento de zona horaria
// de `new Date("YYYY-MM-DD")`.
function parseFechaISO(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return null;
}

// ─── Import del informe "Tamaños, Clase y Calidad" del calibrador ──────────
// Lee el Excel en cliente (misma técnica que MercadonaImportar.tsx) y delega
// todo el parseo real a parseInformeTamanosClases (puro, testeado contra los
// 2 archivos reales del dueño — ver src/lib/calidadReferencias.ts).
async function parseInformeArchivo(file: File): Promise<InformeTamanosClases> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  return parseInformeTamanosClases(rows);
}

// ─── Agregaciones locales a partir de las filas de useEntradasBascula ───────
// Solo cuentan las entradas reales (origen !== "stock_inicial") del periodo:
// las de stock_inicial no traen importe real (ver useCosteFruta) y se
// muestran aparte como contador informativo.

function productorIdDirectoDe(entrada: EntradaBasculaRow): string | null {
  // entradas_bascula.productor_id existe en BD (migración
  // 20260714090000_productores_canonicos.sql) pero aún no está en los tipos
  // generados de Supabase; mismo cast puntual que useTrazabilidadLote.ts /
  // EconomicoCostes.tsx (topAgricultorEur).
  return (entrada as unknown as { productor_id?: string | null }).productor_id ?? null;
}

interface AgricultorRankingRow {
  key: string;
  label: string;
  kg: number;
  eur: number;
  eurKg: number | null;
  nLotes: number;
}

function buildRankingAgricultor(
  entradas: EntradaBasculaRow[],
  aliasPorNombreNormalizado: Map<string, string>,
  nombrePorProductorId: Map<string, string>,
): AgricultorRankingRow[] {
  const map = new Map<string, { label: string; kg: number; eur: number; nLotes: number }>();
  for (const entrada of entradas) {
    const { key, productorId } = resolveProductorGroupKey(
      entrada.agricultor ?? "",
      productorIdDirectoDe(entrada),
      aliasPorNombreNormalizado,
    );
    const label = (productorId ? nombrePorProductorId.get(productorId) : null) ?? entrada.agricultor ?? "Sin agricultor";
    const acc = map.get(key) ?? { label, kg: 0, eur: 0, nLotes: 0 };
    acc.kg += Number(entrada.kg_entrada) || 0;
    acc.eur += importeEntradaFruta(entrada);
    acc.nLotes += 1;
    map.set(key, acc);
  }
  return Array.from(map.entries()).map(([key, v]) => ({
    key,
    label: v.label,
    kg: v.kg,
    eur: v.eur,
    eurKg: v.kg > 0 ? v.eur / v.kg : null,
    nLotes: v.nLotes,
  }));
}

interface VariedadRow {
  articulo: string;
  kg: number;
  eur: number;
  eurKg: number | null;
}

function buildDesgloseVariedad(entradas: EntradaBasculaRow[]): VariedadRow[] {
  const map = new Map<string, { kg: number; eur: number }>();
  for (const entrada of entradas) {
    const key = entrada.articulo?.trim() || "Sin variedad";
    const acc = map.get(key) ?? { kg: 0, eur: 0 };
    acc.kg += Number(entrada.kg_entrada) || 0;
    acc.eur += importeEntradaFruta(entrada);
    map.set(key, acc);
  }
  return Array.from(map.entries()).map(([articulo, v]) => ({
    articulo,
    kg: v.kg,
    eur: v.eur,
    eurKg: v.kg > 0 ? v.eur / v.kg : null,
  }));
}

interface LoteDetalleRow {
  id: string;
  fecha: string;
  lote: string;
  agricultor: string;
  finca: string;
  articulo: string;
  kg: number;
  eurKg: number | null;
  compra: number;
  recoleccion: number;
  transporte: number;
  comision: number;
  total: number;
}

function buildDetalleLotes(
  entradas: EntradaBasculaRow[],
  aliasPorNombreNormalizado: Map<string, string>,
  nombrePorProductorId: Map<string, string>,
): LoteDetalleRow[] {
  return entradas.map((entrada) => {
    const { productorId } = resolveProductorGroupKey(
      entrada.agricultor ?? "",
      productorIdDirectoDe(entrada),
      aliasPorNombreNormalizado,
    );
    const label = (productorId ? nombrePorProductorId.get(productorId) : null) ?? entrada.agricultor ?? "Sin agricultor";
    const kg = Number(entrada.kg_entrada) || 0;
    const total = importeEntradaFruta(entrada);
    return {
      id: entrada.id,
      fecha: entrada.fecha,
      lote: entrada.lote,
      agricultor: label,
      finca: entrada.finca ?? "—",
      articulo: entrada.articulo ?? "—",
      kg,
      eurKg: kg > 0 ? total / kg : null,
      compra: entrada.importe_compra ?? 0,
      recoleccion: entrada.coste_recoleccion ?? 0,
      transporte: entrada.importe_transporte ?? 0,
      comision: entrada.importe_comision ?? 0,
      total,
    };
  });
}

// ─── Forfait (coste real por kg aprovechable) — por productor y por finca ───
// forfait.ts (puro) hace la cuenta; aquí solo se resuelve la CLAVE de
// agrupación a partir de la fila cruda de báscula (mismo criterio que
// buildRankingAgricultor de arriba para productor; para finca no existe un
// catálogo canónico — se agrupa por el texto de `finca` tal cual, igual que
// buildDesgloseVariedad agrupa `articulo`).

function buildItemsForfaitPorProductor(
  lotes: MermaLote[],
  entradaPorLote: Map<string, EntradaBasculaRow>,
  aliasPorNombreNormalizado: Map<string, string>,
  nombrePorProductorId: Map<string, string>,
): ItemForfaitAgrupable[] {
  return lotes.map((lote) => {
    const fila = entradaPorLote.get(lote.lote);
    const agricultor = fila?.agricultor ?? null;
    const productorIdDirecto = fila ? productorIdDirectoDe(fila) : null;
    const { key, productorId } = resolveProductorGroupKey(agricultor ?? "", productorIdDirecto, aliasPorNombreNormalizado);
    const label = (productorId ? nombrePorProductorId.get(productorId) : null) ?? agricultor ?? "Sin agricultor";
    return { lote, groupKey: key, groupLabel: label };
  });
}

function buildItemsForfaitPorFinca(
  lotes: MermaLote[],
  entradaPorLote: Map<string, EntradaBasculaRow>,
): ItemForfaitAgrupable[] {
  return lotes.map((lote) => {
    const finca = entradaPorLote.get(lote.lote)?.finca?.trim() || "Sin finca";
    return { lote, groupKey: finca, groupLabel: finca };
  });
}

type ForfaitSortKey = "label" | "nLotes" | "kgEntrada" | "pctPerdidaTotal" | "eurKgNominal" | "forfaitEurKg" | "sobrecosteEurKg" | "pctPodridoReal";

// Sentinel para columnas nullable (forfaitEurKg/eurKgNominal/pctPerdidaTotal/
// sobrecosteEurKg pueden ser null si Σaprovechable o ΣkgEntrada del grupo son
// <= 0): +Infinity los manda siempre al fondo en ascendente (que es el orden
// por defecto, "los más rentables arriba") y al principio en descendente
// (donde igualmente conviene que salten a la vista como dato a revisar).
function ordenarForfait(filas: ForfaitGrupo[], sortKey: ForfaitSortKey, sortDir: SortDir): ForfaitGrupo[] {
  const factor = sortDir === "asc" ? 1 : -1;
  const nullableAlInfinito = (v: number | null) => (v == null ? Number.POSITIVE_INFINITY : v);
  return [...filas].sort((a, b) => {
    if (sortKey === "label") return factor * a.label.localeCompare(b.label, "es");
    if (sortKey === "nLotes" || sortKey === "kgEntrada" || sortKey === "pctPodridoReal") {
      return factor * (a[sortKey] - b[sortKey]);
    }
    return factor * (nullableAlInfinito(a[sortKey]) - nullableAlInfinito(b[sortKey]));
  });
}

// ─── Orden de las tablas (patrón ColHead/SortIcon de EconomicoCostes) ───────

type AgricultorSortKey = "label" | "kg" | "eur" | "eurKg" | "nLotes";

function ordenarAgricultores(filas: AgricultorRankingRow[], sortKey: AgricultorSortKey, sortDir: SortDir): AgricultorRankingRow[] {
  const factor = sortDir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    if (sortKey === "label") return factor * a.label.localeCompare(b.label, "es");
    const av = sortKey === "eurKg" ? (a.eurKg ?? -1) : a[sortKey];
    const bv = sortKey === "eurKg" ? (b.eurKg ?? -1) : b[sortKey];
    return factor * (av - bv);
  });
}

type LoteSortKey = "fecha" | "lote" | "agricultor" | "finca" | "articulo" | "kg" | "eurKg" | "compra" | "recoleccion" | "transporte" | "comision" | "total";

function ordenarLotes(filas: LoteDetalleRow[], sortKey: LoteSortKey, sortDir: SortDir): LoteDetalleRow[] {
  const factor = sortDir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    if (sortKey === "fecha" || sortKey === "lote" || sortKey === "agricultor" || sortKey === "finca" || sortKey === "articulo") {
      return factor * a[sortKey].localeCompare(b[sortKey], "es");
    }
    const av = sortKey === "eurKg" ? (a.eurKg ?? -1) : a[sortKey];
    const bv = sortKey === "eurKg" ? (b.eurKg ?? -1) : b[sortKey];
    return factor * (av - bv);
  });
}

// ─── Export Excel (marca Lasarte, clasificación Dirección) ──────────────────

const DETALLE_COLUMNAS: ColumnaTabla[] = [
  { header: "Fecha", key: "fecha", tipo: "fecha", width: 14 },
  { header: "Lote", key: "lote", width: 14 },
  { header: "Agricultor", key: "agricultor", width: 26 },
  { header: "Finca", key: "finca", width: 20 },
  { header: "Variedad", key: "articulo", width: 16 },
  { header: "Kg", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 14 },
  { header: "€/kg", key: "eurKg", tipo: "numero", numFmt: FMT_EUR_KG, width: 14 },
  { header: "Compra", key: "compra", tipo: "numero", numFmt: FMT_EUR, width: 14 },
  { header: "Recolección", key: "recoleccion", tipo: "numero", numFmt: FMT_EUR, width: 14 },
  { header: "Transporte", key: "transporte", tipo: "numero", numFmt: FMT_EUR, width: 14 },
  { header: "Comisión", key: "comision", tipo: "numero", numFmt: FMT_EUR, width: 14 },
  { header: "Total", key: "total", tipo: "numero", numFmt: FMT_EUR, width: 14 },
];

const AGRICULTOR_COLUMNAS: ColumnaTabla[] = [
  { header: "Agricultor", key: "label", width: 26 },
  { header: "Kg", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 16 },
  { header: "€ total", key: "eur", tipo: "numero", numFmt: FMT_EUR, width: 16 },
  { header: "€/kg medio", key: "eurKg", tipo: "numero", numFmt: FMT_EUR_KG, width: 16 },
  { header: "Lotes", key: "nLotes", tipo: "numero", numFmt: FMT_INT, width: 12 },
];

const VARIEDAD_COLUMNAS: ColumnaTabla[] = [
  { header: "Variedad", key: "articulo", width: 22 },
  { header: "Kg", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 16 },
  { header: "€", key: "eur", tipo: "numero", numFmt: FMT_EUR, width: 16 },
  { header: "€/kg medio", key: "eurKg", tipo: "numero", numFmt: FMT_EUR_KG, width: 16 },
];

const FORFAIT_COLUMNAS: ColumnaTabla[] = [
  { header: "Productor", key: "label", width: 26 },
  { header: "Lotes", key: "nLotes", tipo: "numero", numFmt: FMT_INT, width: 10 },
  { header: "Kg entrada", key: "kgEntrada", tipo: "numero", numFmt: FMT_KG, width: 16 },
  { header: "% pérdida total", key: "pctPerdidaTotalPct", tipo: "numero", numFmt: FMT_PCT, width: 16 },
  { header: "€/kg nominal", key: "eurKgNominal", tipo: "numero", numFmt: FMT_EUR_KG, width: 16 },
  { header: "Forfait €/kg", key: "forfaitEurKg", tipo: "numero", numFmt: FMT_EUR_KG, width: 16 },
  { header: "Sobrecoste €/kg", key: "sobrecosteEurKg", tipo: "numero", numFmt: FMT_EUR_KG, width: 16 },
  { header: "% podrido real", key: "pctPodridoReal", tipo: "numero", numFmt: FMT_PCT, width: 16 },
];

const COMPONENTE_COLUMNAS: ColumnaTabla[] = [
  { header: "Componente", key: "label", width: 20 },
  { header: "Importe", key: "valor", tipo: "numero", numFmt: FMT_EUR, width: 16 },
  { header: "% del total", key: "pct", tipo: "numero", numFmt: FMT_PCT, width: 14 },
];

interface ExportarFrutaInput {
  periodoRange: PeriodoRange;
  detalle: LoteDetalleRow[];
  agricultores: AgricultorRankingRow[];
  variedades: VariedadRow[];
  forfaitProductor: ForfaitGrupo[];
  desglose: { compra: number; recoleccion: number; transporte: number; comision: number };
  totalImporte: number;
  kgTotales: number;
  usuario: string | undefined;
}

async function exportarFruta(input: ExportarFrutaInput) {
  const {
    periodoRange, detalle, agricultores, variedades, forfaitProductor, desglose, totalImporte, kgTotales, usuario,
  } = input;

  try {
    const ctx = crearLibroLasarte({
      titulo: "Compra de fruta",
      periodo: `${periodoRange.label} (${periodoRange.detail})`,
      usuario,
      clasificacion: "Dirección",
    });

    const detalleOrdenado = [...detalle].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.lote.localeCompare(b.lote));
    añadirHojaTabla(ctx, {
      nombreHoja: "Detalle por lote",
      columnas: DETALLE_COLUMNAS,
      filas: detalleOrdenado.map((fila) => ({ ...fila, fecha: parseFechaISO(fila.fecha) })),
      totales: {
        fecha: "TOTAL",
        lote: "",
        agricultor: "",
        finca: "",
        articulo: "",
        kg: kgTotales,
        eurKg: kgTotales > 0 ? totalImporte / kgTotales : null,
        compra: desglose.compra,
        recoleccion: desglose.recoleccion,
        transporte: desglose.transporte,
        comision: desglose.comision,
        total: totalImporte,
      },
    });

    const agricultoresOrdenados = [...agricultores].sort((a, b) => b.eur - a.eur);
    añadirHojaTabla(ctx, {
      nombreHoja: "Por agricultor",
      columnas: AGRICULTOR_COLUMNAS,
      filas: agricultoresOrdenados.map((fila) => ({ ...fila })),
      totales: {
        label: "TOTAL",
        kg: kgTotales,
        eur: totalImporte,
        eurKg: kgTotales > 0 ? totalImporte / kgTotales : null,
        nLotes: agricultoresOrdenados.reduce((s, f) => s + f.nLotes, 0),
      },
    });

    const variedadesOrdenadas = [...variedades].sort((a, b) => b.eur - a.eur);
    añadirHojaTabla(ctx, {
      nombreHoja: "Por variedad",
      columnas: VARIEDAD_COLUMNAS,
      filas: variedadesOrdenadas.map((fila) => ({ ...fila })),
      totales: {
        articulo: "TOTAL",
        kg: kgTotales,
        eur: totalImporte,
        eurKg: kgTotales > 0 ? totalImporte / kgTotales : null,
      },
    });

    // Forfait: TOTAL recalculado igual que agruparForfait (Σcoste/Σaprovechable
    // ponderado, NO media de los forfaits por productor) a partir de las filas
    // ya agregadas — no hace falta reimportar la lógica pura para una simple
    // Σ/Σ de columnas que ya trae cada fila.
    const forfaitOrdenado = [...forfaitProductor].sort(
      (a, b) => (a.forfaitEurKg ?? Number.POSITIVE_INFINITY) - (b.forfaitEurKg ?? Number.POSITIVE_INFINITY),
    );
    const forfaitKgEntradaTotal = forfaitProductor.reduce((s, f) => s + f.kgEntrada, 0);
    const forfaitCosteTotal = forfaitProductor.reduce((s, f) => s + f.costeTotalEur, 0);
    const forfaitAprovechableTotal = forfaitProductor.reduce((s, f) => s + f.kgAprovechable, 0);
    const forfaitNLotesTotal = forfaitProductor.reduce((s, f) => s + f.nLotes, 0);
    const forfaitNLotesPodridoRealTotal = forfaitProductor.reduce((s, f) => s + f.nLotesPodridoReal, 0);
    const forfaitEurKgTotal = forfaitAprovechableTotal > 0 ? forfaitCosteTotal / forfaitAprovechableTotal : null;
    const eurKgNominalTotal = forfaitKgEntradaTotal > 0 ? forfaitCosteTotal / forfaitKgEntradaTotal : null;

    añadirHojaTabla(ctx, {
      nombreHoja: "Forfait por productor",
      columnas: FORFAIT_COLUMNAS,
      filas: forfaitOrdenado.map((fila) => ({
        label: fila.label,
        nLotes: fila.nLotes,
        kgEntrada: fila.kgEntrada,
        pctPerdidaTotalPct: fila.pctPerdidaTotal != null ? fila.pctPerdidaTotal * 100 : null,
        eurKgNominal: fila.eurKgNominal,
        forfaitEurKg: fila.forfaitEurKg,
        sobrecosteEurKg: fila.sobrecosteEurKg,
        pctPodridoReal: fila.pctPodridoReal,
      })),
      totales: {
        label: "TOTAL",
        nLotes: forfaitNLotesTotal,
        kgEntrada: forfaitKgEntradaTotal,
        pctPerdidaTotalPct: forfaitKgEntradaTotal > 0
          ? ((forfaitKgEntradaTotal - forfaitAprovechableTotal) / forfaitKgEntradaTotal) * 100
          : null,
        eurKgNominal: eurKgNominalTotal,
        forfaitEurKg: forfaitEurKgTotal,
        sobrecosteEurKg: forfaitEurKgTotal != null && eurKgNominalTotal != null ? forfaitEurKgTotal - eurKgNominalTotal : null,
        pctPodridoReal: forfaitNLotesTotal > 0 ? (forfaitNLotesPodridoRealTotal / forfaitNLotesTotal) * 100 : 0,
      },
    });

    añadirHojaTabla(ctx, {
      nombreHoja: "Por componente",
      columnas: COMPONENTE_COLUMNAS,
      filas: ([
        { label: "Compra", valor: desglose.compra },
        { label: "Recolección", valor: desglose.recoleccion },
        { label: "Transporte", valor: desglose.transporte },
        { label: "Comisión", valor: desglose.comision },
      ] as const).map((fila) => ({
        label: fila.label,
        valor: fila.valor,
        pct: totalImporte > 0 ? (fila.valor / totalImporte) * 100 : 0,
      })),
      totales: { label: "TOTAL", valor: totalImporte, pct: totalImporte > 0 ? 100 : 0 },
      autofilter: false,
    });

    await descargarLibro(ctx, buildLasarteFilename("Compra_Fruta", "xlsx", { from: periodoRange.start, to: periodoRange.end }));
    toast({ title: "Compra de fruta exportada" });
  } catch (err) {
    toast({ title: "Error al exportar la compra de fruta", description: errorMessage(err), variant: "destructive" });
  }
}

export default function EconomicoFruta() {
  const { user } = useAuth();
  const [periodoTipo, setPeriodoTipo] = useState<ConsumoPeriodoTipo>("semana");
  const [periodoOffset, setPeriodoOffset] = useState(0);

  const periodoRange = useMemo(() => buildPeriodoRange(periodoTipo, periodoOffset), [periodoTipo, periodoOffset]);
  const isPeriodoActual = periodoOffset === 0;
  const puedeAvanzarPeriodo = periodoRange.start <= today();

  const {
    totalImporte, desglose, kgTotales, serieSemanal, campoCit, isLoading: isLoadingCoste,
  } = useCosteFruta(periodoRange.start, periodoRange.end);

  const { entradas, isLoading: isLoadingEntradas } = useEntradasBascula();
  const { aliasPorNombreNormalizado, nombrePorProductorId, isLoading: isLoadingCatalogo } = useProductoresCatalogo();
  const {
    referencias: referenciasCalidad,
    migracionPendiente: migracionReferenciasPendiente,
    isLoading: isLoadingReferencias,
    guardarReferencias,
    eliminarReferencia,
  } = useCalidadReferencias();

  const entradasEnPeriodo = useMemo(
    () => entradas.filter((e) => e.fecha >= periodoRange.start && e.fecha <= periodoRange.end),
    [entradas, periodoRange],
  );
  const entradasReales = useMemo(
    () => entradasEnPeriodo.filter((e) => e.origen !== "stock_inicial"),
    [entradasEnPeriodo],
  );
  const nEntradasStockInicial = entradasEnPeriodo.length - entradasReales.length;

  const lotesPendientesFactura = useMemo(
    () => entradasReales.filter((e) => (Number(e.kg_entrada) || 0) > 0 && importeEntradaFruta(e) === 0),
    [entradasReales],
  );

  const rankingAgricultores = useMemo(
    () => buildRankingAgricultor(entradasReales, aliasPorNombreNormalizado, nombrePorProductorId),
    [entradasReales, aliasPorNombreNormalizado, nombrePorProductorId],
  );
  const desgloseVariedad = useMemo(
    () => buildDesgloseVariedad(entradasReales).sort((a, b) => b.eur - a.eur),
    [entradasReales],
  );
  const detalleLotes = useMemo(
    () => buildDetalleLotes(entradasReales, aliasPorNombreNormalizado, nombrePorProductorId),
    [entradasReales, aliasPorNombreNormalizado, nombrePorProductorId],
  );

  const [agricultorSortKey, setAgricultorSortKey] = useState<AgricultorSortKey>("eur");
  const [agricultorSortDir, setAgricultorSortDir] = useState<SortDir>("desc");
  function toggleAgricultorSort(key: AgricultorSortKey) {
    toggleSort(key, agricultorSortKey, agricultorSortDir, setAgricultorSortKey, setAgricultorSortDir, (k) => (k === "label" ? "asc" : "desc"));
  }
  const rankingAgricultoresOrdenado = useMemo(
    () => ordenarAgricultores(rankingAgricultores, agricultorSortKey, agricultorSortDir),
    [rankingAgricultores, agricultorSortKey, agricultorSortDir],
  );

  const [loteSortKey, setLoteSortKey] = useState<LoteSortKey>("fecha");
  const [loteSortDir, setLoteSortDir] = useState<SortDir>("desc");
  function toggleLoteSort(key: LoteSortKey) {
    toggleSort(key, loteSortKey, loteSortDir, setLoteSortKey, setLoteSortDir, (k) => (
      k === "fecha" || k === "kg" || k === "eurKg" || k === "compra" || k === "recoleccion" || k === "transporte" || k === "comision" || k === "total"
        ? "desc" : "asc"
    ));
  }
  const detalleLotesOrdenado = useMemo(
    () => ordenarLotes(detalleLotes, loteSortKey, loteSortDir),
    [detalleLotes, loteSortKey, loteSortDir],
  );

  // ─── Forfait (coste real por kg aprovechable) — por productor y por finca ─
  // useMermaLotes ya trae merma/podrido/coste por lote (src/lib/mermaLote.ts);
  // forfait.ts (puro) compone esos números. Los "sin coste" (stock inicial
  // reconstruido, sin importe real) quedan fuera solos por el guard interno
  // de computeForfaitLote (sinCoste) — no hace falta filtrarlos aparte aquí.
  const { lotes: mermaLotesTodos, isLoading: isLoadingMerma } = useMermaLotes();
  const entradaPorLote = useMemo(
    () => new Map(entradas.map((e) => [e.lote, e])),
    [entradas],
  );
  const mermaLotesPeriodo = useMemo(
    () => mermaLotesEnPeriodo(mermaLotesTodos, periodoRange.start, periodoRange.end),
    [mermaLotesTodos, periodoRange],
  );

  const itemsForfaitProductor = useMemo(
    () => buildItemsForfaitPorProductor(mermaLotesPeriodo, entradaPorLote, aliasPorNombreNormalizado, nombrePorProductorId),
    [mermaLotesPeriodo, entradaPorLote, aliasPorNombreNormalizado, nombrePorProductorId],
  );
  const itemsForfaitFinca = useMemo(
    () => buildItemsForfaitPorFinca(mermaLotesPeriodo, entradaPorLote),
    [mermaLotesPeriodo, entradaPorLote],
  );
  const forfaitProductorAgregado = useMemo(() => agruparForfait(itemsForfaitProductor), [itemsForfaitProductor]);
  const forfaitFincaAgregado = useMemo(() => agruparForfait(itemsForfaitFinca), [itemsForfaitFinca]);

  // ─── Referencias de podrido real por productor (calidad_referencias_productor) ─
  // Agregadas por la MISMA clave que forfaitProductorAgregado (id del catálogo
  // vía alias, o texto crudo si no se resolvió) para poder cruzarlas con el
  // productor elegido en el simulador sin reimplementar la resolución.
  const referenciasPorProductorKey = useMemo(() => {
    const map = new Map<string, { kgTotal: number; kgPodrido: number }>();
    for (const r of referenciasCalidad) {
      const { key } = resolveProductorGroupKey(r.productor_nombre, r.productor_id, aliasPorNombreNormalizado);
      const acc = map.get(key) ?? { kgTotal: 0, kgPodrido: 0 };
      acc.kgTotal += Number(r.kg_total) || 0;
      acc.kgPodrido += Number(r.kg_podrido) || 0;
      map.set(key, acc);
    }
    return map;
  }, [referenciasCalidad, aliasPorNombreNormalizado]);

  const [forfaitVista, setForfaitVista] = useState<"productor" | "finca">("productor");
  const forfaitGruposVista = forfaitVista === "productor" ? forfaitProductorAgregado.grupos : forfaitFincaAgregado.grupos;
  const forfaitNLotesExcluidos = forfaitVista === "productor" ? forfaitProductorAgregado.nLotesExcluidos : forfaitFincaAgregado.nLotesExcluidos;
  // Total de lotes INCLUIDOS (no excluidos) cuyo podrido es desconocido (histórico
  // importado sin ese dato, ver forfait.ts nLotesPodridoDesconocido): su forfait
  // sale artificialmente bajo porque no se resta el podrido que falta — se suma
  // aquí para el aviso al pie de la tabla (además de la badge por grupo).
  const forfaitNLotesPodridoDesconocidoTotal = useMemo(
    () => forfaitGruposVista.reduce((s, g) => s + g.nLotesPodridoDesconocido, 0),
    [forfaitGruposVista],
  );

  const [forfaitSortKey, setForfaitSortKey] = useState<ForfaitSortKey>("forfaitEurKg");
  const [forfaitSortDir, setForfaitSortDir] = useState<SortDir>("asc");
  function toggleForfaitSort(key: ForfaitSortKey) {
    toggleSort(key, forfaitSortKey, forfaitSortDir, setForfaitSortKey, setForfaitSortDir, (k) => (
      k === "label" ? "asc" : k === "forfaitEurKg" || k === "sobrecosteEurKg" || k === "pctPerdidaTotal" ? "asc" : "desc"
    ));
  }
  const forfaitGruposOrdenados = useMemo(
    () => ordenarForfait(forfaitGruposVista, forfaitSortKey, forfaitSortDir),
    [forfaitGruposVista, forfaitSortKey, forfaitSortDir],
  );

  // ─── Simulador: ¿le ganaríamos dinero? (puro, no guarda nada en BD) ───────
  // Dos métodos para llegar al % de pérdida que alimenta forfaitProyectado:
  //  - "manual": % a pelo (comportamiento original, sin cambios).
  //  - "productor": compone el % a partir de los datos disponibles del
  //    productor elegido, con prioridad y etiqueta (ver perdidaSimulada en
  //    src/lib/forfait.ts): (1) % medido de sus lotes reales si existe
  //    (forfaitProductorAgregado), si no (2)+(3) podrido real de referencia
  //    (calidad_referencias_productor) + merma natural estimada (días de
  //    cámara) + podrido no pesado ASUMIDO (editable, precargado al 3%).
  const [simMetodo, setSimMetodo] = useState<"manual" | "productor">("manual");
  const [simProductorKey, setSimProductorKey] = useState<string>("");
  const [simPctPerdida, setSimPctPerdida] = useState<string>("10");
  const [simDiasCamara, setSimDiasCamara] = useState<string>("24"); // media real del registro manual de mermas (ver TASA_MERMA_NATURAL_DIA)
  const [simPctPodridoNoPesado, setSimPctPodridoNoPesado] = useState<string>(
    formatNumber(PCT_PODRIDO_NO_PESADO_DEFECTO * 100, 0),
  );
  const [simPrecioCompra, setSimPrecioCompra] = useState<string>("");
  const [simForfaitObjetivo, setSimForfaitObjetivo] = useState<string>("");

  const opcionesSimulador = useMemo(
    () => [...forfaitProductorAgregado.grupos].sort((a, b) => a.label.localeCompare(b.label, "es")),
    [forfaitProductorAgregado.grupos],
  );
  const productorSimuladorSeleccionado = simProductorKey !== ""
    ? opcionesSimulador.find((g) => g.key === simProductorKey) ?? null
    : null;

  // Datos disponibles del productor elegido, con la prioridad del dueño.
  const simTieneForfaitReal = productorSimuladorSeleccionado?.pctPerdidaTotal != null;
  const simReferenciaProductor = productorSimuladorSeleccionado
    ? referenciasPorProductorKey.get(productorSimuladorSeleccionado.key) ?? null
    : null;
  const simPctPodridoReferenciaFraccion = simReferenciaProductor && simReferenciaProductor.kgTotal > 0
    ? simReferenciaProductor.kgPodrido / simReferenciaProductor.kgTotal
    : null;

  const simDiasCamaraNum = Number(simDiasCamara.replace(",", ".")) || 0;
  const simPctMermaNaturalFraccion = TASA_MERMA_NATURAL_DIA * simDiasCamaraNum;
  const simPctPodridoNoPesadoFraccion = (Number(simPctPodridoNoPesado.replace(",", ".")) || 0) / 100;

  const simPctPerdidaCompuesta = perdidaSimulada({
    pctPodridoReferencia: simPctPodridoReferenciaFraccion,
    pctMermaNatural: simPctMermaNaturalFraccion,
    pctPodridoNoPesado: simPctPodridoNoPesadoFraccion,
  });

  // pctPerdida efectivo según el método elegido: en "productor", usa el
  // medido real si existe, si no la composición de arriba.
  const simPctPerdidaFraccion = simMetodo === "manual"
    ? (Number(simPctPerdida.replace(",", ".")) || 0) / 100
    : simTieneForfaitReal
      ? productorSimuladorSeleccionado!.pctPerdidaTotal!
      : simPctPerdidaCompuesta;

  const simPrecioNum = simPrecioCompra.trim() === "" ? null : Number(simPrecioCompra.replace(",", ".")) || 0;
  const simForfaitObjetivoNum = simForfaitObjetivo.trim() === "" ? null : Number(simForfaitObjetivo.replace(",", ".")) || 0;
  const simForfaitProyectado = simPrecioNum != null ? forfaitProyectado(simPrecioNum, simPctPerdidaFraccion) : null;
  const simPrecioMaxCompra = simForfaitObjetivoNum != null ? precioMaxCompra(simForfaitObjetivoNum, simPctPerdidaFraccion) : null;

  // ─── Importador del informe "Tamaños, Clase y Calidad" del calibrador ────
  const [importandoInforme, setImportandoInforme] = useState(false);
  const [informeImportado, setInformeImportado] = useState<InformeTamanosClases | null>(null);

  const productorInformeResuelto = informeImportado?.productor
    ? resolveProductorGroupKey(informeImportado.productor, null, aliasPorNombreNormalizado)
    : null;
  const productorInformeLabel = productorInformeResuelto?.productorId
    ? nombrePorProductorId.get(productorInformeResuelto.productorId) ?? informeImportado?.productor ?? null
    : informeImportado?.productor ?? null;

  async function handleFileInforme(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setImportandoInforme(true);
    try {
      const resultado = await parseInformeArchivo(file);
      setInformeImportado(resultado);
      if (!resultado.productor || resultado.variedades.length === 0) {
        toast({
          title: "No se reconoció el informe",
          description: "Revisa que sea el Excel \"Totales de Tamaños, Clase y Calidad por Variedad\" filtrado por productor.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Informe analizado", description: `${resultado.productor} — ${resultado.variedades.length} variedad(es).` });
      }
    } catch (err) {
      toast({ title: "No se pudo leer el Excel", description: errorMessage(err), variant: "destructive" });
    } finally {
      setImportandoInforme(false);
    }
  }

  async function handleConfirmarInforme() {
    if (!informeImportado?.productor || informeImportado.variedades.length === 0) return;
    try {
      await guardarReferencias.mutateAsync(
        informeImportado.variedades.map((v) => ({
          productorId: productorInformeResuelto?.productorId ?? null,
          productorNombre: informeImportado.productor!,
          variedad: v.variedad,
          kgTotal: v.kgTotal,
          kgPodrido: v.kgPodrido,
        })),
      );
      toast({
        title: "Referencias guardadas",
        description: `${informeImportado.variedades.length} variedad(es) de ${informeImportado.productor}.`,
      });
      setInformeImportado(null);
    } catch (err) {
      toast({ title: "Error al guardar las referencias", description: errorMessage(err), variant: "destructive" });
    }
  }

  const eurKgMedio = kgTotales > 0 ? totalImporte / kgTotales : null;
  const mostrarSerieSemanal = serieSemanal.length >= 2;
  const maxCosteSemanal = Math.max(...serieSemanal.map((s) => s.coste), 0);

  const isLoadingKpis = isLoadingCoste;
  const isLoadingDetalle = isLoadingEntradas || isLoadingCatalogo;
  const isLoadingForfait = isLoadingDetalle || isLoadingMerma;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker text-seccion-texto">Económico</p>
          <h1 className="page-title">Compra de fruta</h1>
          <p className="page-subtitle">
            Detalle de las entradas de báscula del periodo: por lote, por agricultor y por variedad.
          </p>
        </div>
        <Button
          variant="outline"
          className="glass glass-hover gap-1.5"
          disabled={detalleLotes.length === 0}
          onClick={() => exportarFruta({
            periodoRange,
            detalle: detalleLotes,
            agricultores: rankingAgricultores,
            variedades: desgloseVariedad,
            forfaitProductor: forfaitProductorAgregado.grupos,
            desglose,
            totalImporte,
            kgTotales,
            usuario: user?.email ?? undefined,
          })}
        >
          <Download className="h-4 w-4" /> Descargar Excel
        </Button>
      </header>

      <EconomicoSubnav />

      <ConsumoPeriodoSelector
        tipo={periodoTipo}
        onTipoChange={setPeriodoTipo}
        range={periodoRange}
        onNavigate={(direction) => setPeriodoOffset((prev) => prev + direction)}
        onToday={() => setPeriodoOffset(0)}
        isCurrent={isPeriodoActual}
        canNavigateNext={puedeAvanzarPeriodo}
      />

      {nEntradasStockInicial > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          {nEntradasStockInicial} lote(s) de stock inicial en este rango, excluidos del análisis (sin importe real —
          reconstruidos desde el informe de stock).
        </div>
      )}

      {lotesPendientesFactura.length > 0 && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">{lotesPendientesFactura.length} lote(s)</span> con fruta entrada pero sin
              importe cargado en el export de báscula (dato de factura pendiente): su coste sale a 0 en el detalle.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoadingKpis ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KPICard
            label="Kg comprados"
            value={formatKg(kgTotales)}
            icon={Package}
            hint={`${entradasReales.length} lote(s) en el periodo`}
          />
          <KPICard
            label="Importe total"
            value={formatEuro(totalImporte)}
            icon={Euro}
            accent="success"
          />
          <KPICard
            label="€/kg medio"
            value={eurKgMedio != null ? `${formatNumber(eurKgMedio, 4)} €/kg` : "—"}
            icon={Scale}
            hint={kgTotales > 0 ? undefined : "Sin kg comprados en el periodo"}
          />
          <KPICard
            label="Nº de lotes"
            value={String(entradasReales.length)}
            icon={Hash}
          />
        </section>
      )}

      {!isLoadingKpis && campoCit.lotes > 0 && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard
            className="glass-accented"
            label="De ello, derivado a Cítrica"
            value={formatKg(campoCit.kg)}
            hint={`${formatEuro(campoCit.importe)} · ${campoCit.lotes} lote(s) — no se procesa en la central`}
            icon={Citrus}
            accent="warning"
            labelInfo="Lotes cuyo artículo de báscula lleva CAMPO/CIT (decisión del dueño, 2026-07-16): fruta comprada que se deriva a Cítrica sin pasar por el calibrador de la central. Su coste ya está incluido en 'Kg comprados'/'Importe total' de arriba (el gasto es real), pero no cuenta como stock ni como merma/forfait porque no es una pérdida: se vendió por otro canal. No aparece en el detalle por lote de esta página (que sale de las entradas de báscula ya sin campo/cit); su detalle está en Entradas de fruta → Derivado a Cítrica."
          />
        </section>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardHeader>
          <p className="panel-kicker">Desglose</p>
          <CardTitle>Compra de fruta por componente — {periodoRange.label}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingKpis ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : totalImporte === 0 && kgTotales === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              Sin entradas de báscula en este periodo.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead className="w-[40%]">% del total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {([
                  { label: "Compra", valor: desglose.compra },
                  { label: "Recolección", valor: desglose.recoleccion },
                  { label: "Transporte", valor: desglose.transporte },
                  { label: "Comisión", valor: desglose.comision },
                ] as const).map((fila) => {
                  const pct = totalImporte > 0 ? (fila.valor / totalImporte) * 100 : 0;
                  return (
                    <TableRow key={fila.label}>
                      <TableCell className="font-medium">{fila.label}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatEuro(fila.valor)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, pct)}%` }} />
                          </div>
                          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                            {formatNumber(pct, 1)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {mostrarSerieSemanal && (
        <Card className="glass-accented overflow-hidden">
          <CardHeader>
            <p className="panel-kicker">Evolución</p>
            <CardTitle>Gasto de compra de fruta por semana</CardTitle>
          </CardHeader>
          <CardContent className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={serieSemanal} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis {...XAXIS} dataKey="semanaInicio" tickFormatter={(value: string) => formatDate(value)} />
                <YAxis {...YAXIS} domain={[0, Math.max(maxCosteSemanal * 1.15, 1)]} />
                <Tooltip
                  cursor={CHART_CURSOR}
                  content={({ active, payload, label }) => (
                    <GlassTooltip
                      active={active}
                      payload={payload as { name: string; value: number | string; color?: string; fill?: string; stroke?: string }[] | undefined}
                      label={label ? `Semana del ${formatDate(String(label))}` : undefined}
                      formatter={(value) => formatEuro(Number(value))}
                    />
                  )}
                />
                <Bar
                  dataKey="coste"
                  name="Gasto"
                  fill={barFill(C.primary, 0.4)}
                  stroke={C.primary}
                  strokeWidth={1.5}
                  radius={[6, 6, 2, 2]}
                  maxBarSize={34}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardHeader>
          <p className="panel-kicker">Ranking</p>
          <CardTitle className="flex items-center gap-1.5">
            <Sprout className="h-4 w-4 text-muted-foreground" /> Por agricultor — {periodoRange.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingDetalle ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rankingAgricultoresOrdenado.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              Sin entradas de báscula en este periodo.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead label="Agricultor" sk="label" sortKey={agricultorSortKey} sortDir={agricultorSortDir} onToggle={toggleAgricultorSort} />
                    <SortableTableHead label="Kg" sk="kg" right sortKey={agricultorSortKey} sortDir={agricultorSortDir} onToggle={toggleAgricultorSort} />
                    <SortableTableHead label="€ total" sk="eur" right sortKey={agricultorSortKey} sortDir={agricultorSortDir} onToggle={toggleAgricultorSort} />
                    <SortableTableHead label="€/kg medio" sk="eurKg" right sortKey={agricultorSortKey} sortDir={agricultorSortDir} onToggle={toggleAgricultorSort} />
                    <SortableTableHead label="Lotes" sk="nLotes" right sortKey={agricultorSortKey} sortDir={agricultorSortDir} onToggle={toggleAgricultorSort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rankingAgricultoresOrdenado.map((fila) => (
                    <TableRow key={fila.key}>
                      <TableCell className="font-medium">{fila.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(fila.kg)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatEuro(fila.eur)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fila.eurKg != null ? `${formatNumber(fila.eurKg, 4)} €/kg` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fila.nLotes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <p className="panel-kicker">Rentabilidad</p>
            <CardTitle className="flex items-center gap-1.5">
              <TrendingDown className="h-4 w-4 text-muted-foreground" /> Forfait por {forfaitVista === "productor" ? "productor" : "finca"} — {periodoRange.label}
            </CardTitle>
          </div>
          <Tabs value={forfaitVista} onValueChange={(v) => setForfaitVista(v as "productor" | "finca")}>
            <TabsList>
              <TabsTrigger value="productor">Por productor</TabsTrigger>
              <TabsTrigger value="finca">Por finca</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingForfait ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : forfaitGruposOrdenados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              Sin lotes procesados con coste conocido en este periodo.
            </div>
          ) : (
            <>
              <div className="max-h-[420px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead
                        label={forfaitVista === "productor" ? "Productor" : "Finca"}
                        sk="label"
                        sortKey={forfaitSortKey}
                        sortDir={forfaitSortDir}
                        onToggle={toggleForfaitSort}
                      />
                      <SortableTableHead label="Lotes" sk="nLotes" right sortKey={forfaitSortKey} sortDir={forfaitSortDir} onToggle={toggleForfaitSort} />
                      <SortableTableHead label="Kg entrada" sk="kgEntrada" right sortKey={forfaitSortKey} sortDir={forfaitSortDir} onToggle={toggleForfaitSort} />
                      <SortableTableHead label="% pérdida total" sk="pctPerdidaTotal" right sortKey={forfaitSortKey} sortDir={forfaitSortDir} onToggle={toggleForfaitSort} />
                      <SortableTableHead label="€/kg nominal" sk="eurKgNominal" right sortKey={forfaitSortKey} sortDir={forfaitSortDir} onToggle={toggleForfaitSort} />
                      <SortableTableHead
                        label="FORFAIT €/kg"
                        sk="forfaitEurKg"
                        right
                        sortKey={forfaitSortKey}
                        sortDir={forfaitSortDir}
                        onToggle={toggleForfaitSort}
                        info="Coste real por kg APROVECHABLE (kg de calibrador menos podrido de calibrador y manual). Es el número que hay que mirar para saber si compensa comprarle a este productor/finca."
                      />
                      <SortableTableHead label="Sobrecoste €/kg" sk="sobrecosteEurKg" right sortKey={forfaitSortKey} sortDir={forfaitSortDir} onToggle={toggleForfaitSort} />
                      <SortableTableHead label="Dato" sk="pctPodridoReal" right sortKey={forfaitSortKey} sortDir={forfaitSortDir} onToggle={toggleForfaitSort} info="% de los lotes de este grupo cuyo podrido de calibrador viene de un Informe LOTE real (no prorrateo estimado)." />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {forfaitGruposOrdenados.map((fila) => (
                      <TableRow key={fila.key}>
                        <TableCell className="max-w-[180px] truncate font-medium" title={fila.label}>{fila.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{fila.nLotes}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(fila.kgEntrada)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fila.pctPerdidaTotal != null ? formatPct(fila.pctPerdidaTotal * 100) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fila.eurKgNominal != null ? `${formatNumber(fila.eurKgNominal, 4)} €/kg` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-primary">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            {fila.forfaitEurKg != null ? `${formatNumber(fila.forfaitEurKg, 4)} €/kg` : "Sin aprovechable"}
                            {fila.nLotesPodridoDesconocido > 0 && (
                              <Badge
                                variant="outline"
                                className="border-[var(--glass-border)] px-1 py-0 text-[10px] font-normal text-muted-foreground/70"
                                title={`${fila.nLotesPodridoDesconocido} lote(s) de este grupo son del histórico importado sin dato de podrido (ver mermaLote.ts): su kg aprovechable se calcula solo con lo conocido, sin restar el podrido desconocido, así que el forfait real de este grupo será algo MAYOR que el mostrado.`}
                              >
                                {fila.nLotesPodridoDesconocido} sin dato podrido
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fila.sobrecosteEurKg != null ? `+${formatNumber(fila.sobrecosteEurKg, 4)} €/kg` : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="tabular-nums">
                            {formatNumber(fila.pctPodridoReal, 0)}% real
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="border-t border-[var(--glass-border)] px-4 py-3 text-xs text-muted-foreground">
                <strong className="text-foreground">Definición V1:</strong> kg aprovechable = kg de calibrador − podrido de
                calibrador − podrido manual (el podrido pre-calibrador y la merma natural ya quedan fuera del kg de
                calibrador, no se restan dos veces). Forfait = coste total del lote / kg aprovechable, medido en Σcoste/Σkg
                (media ponderada, no media simple de los forfaits por lote). No distingue destino comercial de la fruta
                (Exportación vs Industria tienen distinto valor) — pendiente para una V2.
                {forfaitNLotesExcluidos > 0 && (
                  <> {forfaitNLotesExcluidos} lote(s) del periodo quedan fuera (sin coste conocido o aún no procesados).</>
                )}
                {forfaitNLotesPodridoDesconocidoTotal > 0 && (
                  <>
                    {" "}
                    {forfaitNLotesPodridoDesconocidoTotal} lote(s) incluidos arriba (badge <strong className="text-foreground">"sin dato podrido"</strong>)
                    son del histórico importado sin dato de podrido: su kg aprovechable no resta ese podrido desconocido, así
                    que su forfait sale artificialmente bajo — el real es algo mayor. NO afecta el orden por defecto de la
                    tabla.
                  </>
                )}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader>
          <p className="panel-kicker">Calidad</p>
          <CardTitle className="flex items-center gap-1.5">
            <Upload className="h-4 w-4 text-muted-foreground" /> Importar informe de productor (clase y calidad)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {migracionReferenciasPendiente && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/6 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              La tabla calidad_referencias_productor todavía no existe: pendiente de aplicar la migración 20260715120000.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="informe-clase-calidad">
                Excel "Totales de Tamaños, Clase y Calidad por Variedad" (filtrado por productor)
              </Label>
              <Input
                id="informe-clase-calidad"
                type="file"
                accept=".xlsx,.xls"
                disabled={importandoInforme}
                onChange={handleFileInforme}
                className="max-w-md"
              />
            </div>
            {importandoInforme && <span className="text-xs text-muted-foreground">Analizando…</span>}
          </div>

          {informeImportado && (
            <div className="space-y-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{informeImportado.productor ?? "Productor no detectado"}</p>
                  {informeImportado.productor && (
                    productorInformeResuelto?.productorId ? (
                      <p className="text-xs text-muted-foreground">
                        Casa con el catálogo: <span className="font-medium text-foreground">{productorInformeLabel}</span>
                      </p>
                    ) : (
                      <p className="flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="h-3 w-3 shrink-0" /> No casa con ningún productor del catálogo: se guardará
                        solo el nombre de texto ({informeImportado.productor}).
                      </p>
                    )
                  )}
                </div>
                <Button
                  size="sm"
                  disabled={!informeImportado.productor || informeImportado.variedades.length === 0 || guardarReferencias.isPending}
                  onClick={handleConfirmarInforme}
                >
                  Confirmar e importar
                </Button>
              </div>

              {informeImportado.variedades.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variedad</TableHead>
                      <TableHead className="text-right">Kg total</TableHead>
                      <TableHead className="text-right">Kg podrido</TableHead>
                      <TableHead className="text-right">% podrido</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {informeImportado.variedades.map((v) => (
                      <TableRow key={v.variedad}>
                        <TableCell className="font-medium">{v.variedad}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(v.kgTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(v.kgPodrido)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPct(pctPodridoVariedad(v))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {informeImportado.descartadas.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {informeImportado.descartadas.length} aviso(s) al leer el Excel (estructura parcialmente no reconocida):{" "}
                  {informeImportado.descartadas.join(" · ")}
                </p>
              )}
            </div>
          )}

          {!isLoadingReferencias && referenciasCalidad.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Referencias ya cargadas</p>
              <div className="max-h-[260px] overflow-y-auto rounded-lg border border-[var(--glass-border)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Productor</TableHead>
                      <TableHead>Variedad</TableHead>
                      <TableHead className="text-right">Kg total</TableHead>
                      <TableHead className="text-right">% podrido real</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referenciasCalidad.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="max-w-[160px] truncate" title={r.productor_nombre}>
                          {(r.productor_id ? nombrePorProductorId.get(r.productor_id) : null) ?? r.productor_nombre}
                        </TableCell>
                        <TableCell>{r.variedad ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(r.kg_total)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPct(r.kg_total > 0 ? (r.kg_podrido / r.kg_total) * 100 : 0)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={eliminarReferencia.isPending}
                            onClick={() => eliminarReferencia.mutate(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <p className="panel-kicker">Simulador</p>
            <CardTitle className="flex items-center gap-1.5">
              <Calculator className="h-4 w-4 text-muted-foreground" /> ¿Le ganaríamos dinero?
            </CardTitle>
          </div>
          <Tabs value={simMetodo} onValueChange={(v) => setSimMetodo(v as "manual" | "productor")}>
            <TabsList>
              <TabsTrigger value="manual">% manual</TabsTrigger>
              <TabsTrigger value="productor">Por productor</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            {simMetodo === "manual" ? (
              <div className="space-y-1.5">
                <Label htmlFor="sim-pct-perdida">% pérdida a usar en la simulación</Label>
                <div className="relative">
                  <Input
                    id="sim-pct-perdida"
                    inputMode="decimal"
                    value={simPctPerdida}
                    onChange={(e) => setSimPctPerdida(e.target.value)}
                    className="pr-8"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sim-productor">Productor</Label>
                  <Select value={simProductorKey} onValueChange={setSimProductorKey}>
                    <SelectTrigger id="sim-productor">
                      <SelectValue placeholder="Elige un productor…" />
                    </SelectTrigger>
                    <SelectContent>
                      {opcionesSimulador.map((g) => (
                        <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {productorSimuladorSeleccionado && (
                  <div className="space-y-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-xs">
                    {simTieneForfaitReal ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <Badge variant="secondary">medido real</Badge>
                          % pérdida de sus lotes procesados (forfait real)
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatPct(productorSimuladorSeleccionado.pctPerdidaTotal! * 100)}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5">
                            {simPctPodridoReferenciaFraccion != null
                              ? <Badge variant="secondary">informe calibrador</Badge>
                              : <Badge variant="outline">sin dato</Badge>}
                            Podrido real de referencia
                            <InfoTooltip>
                              Este % es podrido / kg CALIBRADO (lo que ya pasó el pre-calibrador), no podrido / kg
                              entrada. Al sumarlo con la merma natural y el podrido no pesado (que sí son fracción de
                              kg entrada) para el total compuesto, el resultado sale ligeramente sobreestimado —
                              decisión aceptada por ser conservadora (ver comentario de <code>perdidaSimulada</code> en
                              src/lib/forfait.ts).
                            </InfoTooltip>
                          </span>
                          <span className="font-semibold tabular-nums">
                            {simPctPodridoReferenciaFraccion != null ? formatPct(simPctPodridoReferenciaFraccion * 100) : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex-1">Merma natural — días de cámara estimados</span>
                          <Input
                            aria-label="Días de cámara estimados"
                            inputMode="decimal"
                            value={simDiasCamara}
                            onChange={(e) => setSimDiasCamara(e.target.value)}
                            className="h-7 w-16 text-right tabular-nums"
                          />
                          <span className="w-14 text-right font-semibold tabular-nums">
                            {formatPct(simPctMermaNaturalFraccion * 100)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex flex-1 items-center gap-1.5">
                            <Badge variant="outline">asumido</Badge> Podrido no pesado
                          </span>
                          <Input
                            aria-label="Podrido no pesado asumido (%)"
                            inputMode="decimal"
                            value={simPctPodridoNoPesado}
                            onChange={(e) => setSimPctPodridoNoPesado(e.target.value)}
                            className="h-7 w-16 text-right tabular-nums"
                          />
                          <span className="w-14 text-right font-semibold tabular-nums">%</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-[var(--glass-border)] pt-2 font-semibold">
                          <span>Total compuesto</span>
                          <span className="tabular-nums text-primary">{formatPct(simPctPerdidaCompuesta * 100)}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5 border-t border-[var(--glass-border)] pt-4">
              <Label htmlFor="sim-precio">Precio de compra todo incluido (€/kg)</Label>
              <Input
                id="sim-precio"
                inputMode="decimal"
                placeholder="p. ej. 0,45"
                value={simPrecioCompra}
                onChange={(e) => setSimPrecioCompra(e.target.value)}
              />
              <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 text-center">
                <p className="text-xs text-muted-foreground">
                  Forfait proyectado <span className="tabular-nums">({formatPct(simPctPerdidaFraccion * 100)} de pérdida usada)</span>
                </p>
                <p className="text-2xl font-bold tabular-nums text-primary">
                  {simForfaitProyectado != null
                    ? `${formatNumber(simForfaitProyectado, 4)} €/kg`
                    : simPrecioNum != null ? "Pérdida ≥ 100%" : "—"}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 md:border-l md:border-[var(--glass-border)] md:pl-6">
            <Label htmlFor="sim-objetivo">Forfait objetivo (€/kg) — inverso</Label>
            <Input
              id="sim-objetivo"
              inputMode="decimal"
              placeholder="p. ej. 0,50"
              value={simForfaitObjetivo}
              onChange={(e) => setSimForfaitObjetivo(e.target.value)}
            />
            <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 text-center">
              <p className="text-xs text-muted-foreground">Precio máximo de compra</p>
              <p className="text-2xl font-bold tabular-nums text-primary">
                {simPrecioMaxCompra != null ? `${formatNumber(simPrecioMaxCompra, 4)} €/kg` : "—"}
              </p>
              {simPrecioMaxCompra != null && simPrecioMaxCompra <= 0 && (
                <p className="mt-1 text-xs text-warning">Con esta pérdida, ningún precio de compra sería rentable.</p>
              )}
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              Simulación pura, no guarda nada: elige el método (% a pelo o por productor) y compara precios de compra sin
              tener que registrar ninguna entrada de báscula.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader>
          <p className="panel-kicker">Desglose</p>
          <CardTitle className="flex items-center gap-1.5">
            <Tag className="h-4 w-4 text-muted-foreground" /> Por variedad — {periodoRange.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingDetalle ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : desgloseVariedad.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              Sin entradas de báscula en este periodo.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variedad</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">€</TableHead>
                  <TableHead className="text-right">€/kg medio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {desgloseVariedad.map((fila) => (
                  <TableRow key={fila.articulo}>
                    <TableCell className="font-medium">{fila.articulo}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKg(fila.kg)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatEuro(fila.eur)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fila.eurKg != null ? `${formatNumber(fila.eurKg, 4)} €/kg` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader>
          <p className="panel-kicker">Detalle</p>
          <CardTitle className="flex items-center gap-1.5">
            <Citrus className="h-4 w-4 text-muted-foreground" /> Por lote — {periodoRange.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingDetalle ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : detalleLotesOrdenado.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              Sin entradas de báscula en este periodo.
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead label="Fecha" sk="fecha" sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Lote" sk="lote" sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Agricultor" sk="agricultor" sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Finca" sk="finca" sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Variedad" sk="articulo" sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Kg" sk="kg" right sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="€/kg" sk="eurKg" right sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Compra" sk="compra" right sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Recolec." sk="recoleccion" right sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Transp." sk="transporte" right sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Comisión" sk="comision" right sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                    <SortableTableHead label="Total" sk="total" right sortKey={loteSortKey} sortDir={loteSortDir} onToggle={toggleLoteSort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detalleLotesOrdenado.map((fila) => (
                    <TableRow key={fila.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(fila.fecha)}</TableCell>
                      <TableCell className="font-medium">
                        <Link
                          to={`/trazabilidad?lote=${encodeURIComponent(fila.lote)}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {fila.lote}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate" title={fila.agricultor}>{fila.agricultor}</TableCell>
                      <TableCell className="max-w-[140px] truncate" title={fila.finca}>{fila.finca}</TableCell>
                      <TableCell>{fila.articulo}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(fila.kg)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fila.eurKg != null ? formatNumber(fila.eurKg, 4) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(fila.compra)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(fila.recoleccion)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(fila.transporte)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(fila.comision)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatEuro(fila.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Este gasto ya está integrado en el margen del{" "}
        <Link to="/economico" className="font-semibold underline underline-offset-2">Panel económico</Link>
        {" "}(KPI "Compra de fruta"): esta página es su detalle. Las pérdidas por merma y podrido de esta fruta se
        analizan en{" "}
        <Link to="/economico/costes" className="font-semibold underline underline-offset-2">
          Económico → Costes, sección "Pérdidas de fruta"
        </Link>. No incluye el stock inicial reconstruido desde el informe de stock (sin importe real).
      </p>
    </div>
  );
}
