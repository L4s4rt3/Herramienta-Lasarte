// src/pages/VentasCategoriaSegunda.tsx
// Ventas de categoria segunda: resumen ejecutivo del periodo filtrado +
// detalle denso y ordenable por cliente/producto/articulo. Mismo lenguaje
// visual que Productores.tsx (tablas compactas, tira de mini-metricas,
// drill-down con cabecera + metricas + tabla).
import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, BarChart3, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown,
  Database, Euro, FileSpreadsheet, Gauge, Package, Save, Search, Trophy, Upload, Users, ArrowRight, ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KPICard } from "@/components/KPICard";
import { InfoTooltip } from "@/components/InfoTooltip";
import { MiniKpi } from "@/components/MiniKpi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { useVentasCategoria, type VentasCategoriaAjusteInput } from "@/hooks/useVentasCategoria";
import type {
  VentasCategoriaResumenRow, VentasCategoriaRankingClienteRow, VentasCategoriaResumenArticuloRow,
  VentasCategoriaMensualProductoRow as VCMensualProductoViewRow,
} from "@/hooks/useVentasCategoria";
import { parseVentasCategoriaExcelFile } from "@/lib/ventasCategoriaExcel";
import { VentasCategoriaFilterBar } from "@/components/VentasCategoriaFilterBar";
import {
  applyVentasCategoriaFilters,
  aggregateVentasCategoria,
  buildVentasCategoriaDashboardKpis,
} from "@/lib/ventasCategoria";
import type {
  VentasCategoriaArticuloRow as VCArticuloAggRow, VentasCategoriaClienteRow as VCClienteAggRow,
  VentasCategoriaResumen as VCResumenAgg, VentasCategoriaMensualProductoRow as VCMensualProductoAggRow,
} from "@/lib/ventasCategoria";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber } from "@/lib/format";
import {
  BAR_STYLE, C, CHART_LINE_CURSOR, CHART_PANEL_CLASS, GlassTooltip, GRID, legendStyle, lineStyle, MARGIN, XAXIS, YAXIS,
} from "@/lib/chartTheme";
import type { ParseVentasCategoriaWorkbookResult } from "@/lib/ventasCategoria";
import { DailyGroupTable } from "@/components/DailyGroupTable";
import { VentasCategoriaClienteDetail } from "@/components/VentasCategoriaClienteDetail";
import { VentasCategoriaProductoDetail } from "@/components/VentasCategoriaProductoDetail";
import { VentasCategoriaArticuloDetail } from "@/components/VentasCategoriaArticuloDetail";
import type { VentasCategoriaClienteAjusteRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const EMPTY_ROWS: never[] = [];
const EMPTY_FILTER_OPTIONS = { lineas: 0, campanas: [], meses: [], clientes: [], metodos: [] };

type FilterState = { campana: string; mes: string; cliente: string; metodo: string; articulo: string };

const TOP_TABS = ["resumen", "clientes", "productos", "articulos", "base", "importar"] as const;
type TopTab = typeof TOP_TABS[number];

export interface VentasCategoriaPageProps {
  categoriaNombre: string;
  titulo: string;
  subtitulo: string;
}

export default function VentasCategoriaSegunda() {
  return (
    <VentasCategoriaPage
      categoriaNombre="Categoria segunda"
      titulo="Categoría segunda"
      subtitulo="Sin categoría"
    />
  );
}

export function VentasCategoriaPage({ categoriaNombre, titulo, subtitulo }: VentasCategoriaPageProps) {
  const ventas = useVentasCategoria(categoriaNombre);
  const [tab, setTab] = useState<TopTab>("resumen");
  const [filters, setFilters] = useState<FilterState>({ campana: "", mes: "", cliente: "", metodo: "", articulo: "" });
  const [parsedImport, setParsedImport] = useState<ParseVentasCategoriaWorkbookResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [selectedCliente, setSelectedCliente] = useState<string | null>(null);
  const [selectedClienteNombre, setSelectedClienteNombre] = useState<string>("");
  const [selectedProducto, setSelectedProducto] = useState<string | null>(null);
  const [selectedProductoDesc, setSelectedProductoDesc] = useState<string>("");
  const [selectedArticulo, setSelectedArticulo] = useState<string | null>(null);
  const [selectedArticuloRef, setSelectedArticuloRef] = useState<string | null>(null);
  const [clienteSort, setClienteSort] = useState<{ key: "kilos" | "pm" | "base"; dir: "asc" | "desc" }>({ key: "kilos", dir: "desc" });
  const [clienteSearch, setClienteSearch] = useState("");
  const [productoSort, setProductoSort] = useState<{ key: "kilos" | "pm" | "base"; dir: "asc" | "desc" }>({ key: "kilos", dir: "desc" });
  const [articuloSearch, setArticuloSearch] = useState("");
  const [articuloLimit, setArticuloLimit] = useState(10);
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());

  const resumen = ventas.resumenQuery.data;
  const rankingClientes = ventas.rankingClientesQuery.data ?? EMPTY_ROWS;
  const mensualProducto = ventas.mensualProductoQuery.data ?? EMPTY_ROWS;
  const articulos = ventas.articulosQuery.data ?? EMPTY_ROWS;
  const catalogo = ventas.catalogoQuery.data ?? EMPTY_ROWS;
  const ajustes = ventas.ajustesQuery.data ?? EMPTY_ROWS;
  const validacion = ventas.validacionQuery.data ?? EMPTY_ROWS;
  const filterOptions = ventas.filterOptionsQuery.data ?? EMPTY_FILTER_OPTIONS;

  const allLines = ventas.allLinesQuery.data ?? EMPTY_ROWS;
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const hasActiveFilters = activeFilters > 0;
  const hasImportedData = Number(resumen?.kilos ?? 0) > 0;
  const isLoading = ventas.resumenQuery.isLoading || ventas.allLinesQuery.isLoading;

  const filteredLines = useMemo(
    () => applyVentasCategoriaFilters(allLines, filters) as typeof allLines,
    [allLines, filters]
  );

  const filteredAggregation = useMemo(
    () => aggregateVentasCategoria(filteredLines),
    [filteredLines]
  );

  const displayResumen: NormalizedResumen = useMemo(
    () => hasActiveFilters ? normalizeResumenAgg(filteredAggregation.resumen) : normalizeResumenView(resumen),
    [hasActiveFilters, filteredAggregation.resumen, resumen],
  );
  const displayRanking: DisplayClienteRow[] = useMemo(
    () => hasActiveFilters ? filteredAggregation.clientes.map(normalizeClienteAgg) : rankingClientes.map(normalizeClienteView),
    [hasActiveFilters, filteredAggregation.clientes, rankingClientes],
  );
  const displayMensualProducto: DisplayMensualProductoRow[] = useMemo(
    () => hasActiveFilters ? filteredAggregation.mensualProducto.map(normalizeMensualProductoAgg) : mensualProducto.map(normalizeMensualProductoView),
    [hasActiveFilters, filteredAggregation.mensualProducto, mensualProducto],
  );
  const displayArticulos: DisplayArticuloRow[] = useMemo(
    () => hasActiveFilters ? filteredAggregation.articulos.map(normalizeArticuloAgg) : articulos.map(normalizeArticuloView),
    [hasActiveFilters, filteredAggregation.articulos, articulos],
  );

  const monthlyTotals = useMemo(() => {
    const map = new Map<string, { mes: string; kilos: number; base: number; pm: number }>();
    displayMensualProducto.forEach((row) => {
      const mes = row.mes;
      if (!mes) return;
      const current = map.get(mes) ?? { mes, kilos: 0, base: 0, pm: 0 };
      current.kilos += row.kilos;
      current.base += row.base_iva;
      current.pm = current.kilos > 0 ? current.base / current.kilos : 0;
      map.set(mes, current);
    });
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [displayMensualProducto]);

  const dashboardKpis = useMemo(
    () => buildVentasCategoriaDashboardKpis({
      resumen: displayResumen,
      clientes: displayRanking,
      monthlyTotals,
    }),
    [displayResumen, displayRanking, monthlyTotals],
  );

  // Ajuste medio ponderado por kilos, para mostrar el impacto de comision + transporte.
  const ajusteImpacto = useMemo(() => {
    if (ajustes.length === 0 || displayRanking.length === 0) return null;
    const ajusteByCodigo = new Map(ajustes.map((a) => [a.cliente_codigo, a]));
    let kilos = 0;
    let brutoTotal = 0;
    let realTotal = 0;
    displayRanking.forEach((row) => {
      const codigo = row.cliente_codigo;
      const kg = row.kilos;
      const pmBruto = row.pm_bruto;
      const ajuste = ajusteByCodigo.get(codigo);
      const descuentoPct = ajuste ? (ajuste.comision_pct + ajuste.transporte_pct) / 100 : 0;
      const descuentoCentKg = ajuste ? (ajuste.comision_cent_kg + ajuste.transporte_cent_kg) / 100 : 0;
      const pmReal = Math.max(0, pmBruto * (1 - descuentoPct) - descuentoCentKg);
      kilos += kg;
      brutoTotal += pmBruto * kg;
      realTotal += pmReal * kg;
    });
    if (kilos <= 0) return null;
    const pmBrutoMedio = brutoTotal / kilos;
    const pmRealMedio = realTotal / kilos;
    return {
      pmBrutoMedio,
      pmRealMedio,
      impactoPct: pmBrutoMedio > 0 ? ((pmBrutoMedio - pmRealMedio) / pmBrutoMedio) * 100 : 0,
      clientesConAjuste: ajustes.filter((a) => a.comision_pct || a.comision_cent_kg || a.transporte_pct || a.transporte_cent_kg).length,
    };
  }, [ajustes, displayRanking]);

  const topClientesKg = useMemo(
    () => [...displayRanking].sort((a, b) => b.kilos - a.kilos).slice(0, 8),
    [displayRanking],
  );
  const topArticulosKg = useMemo(
    () => [...displayArticulos].sort((a, b) => b.kilos - a.kilos).slice(0, 8),
    [displayArticulos],
  );

  const sortedClientes = useMemo(() => {
    const rows = [...displayRanking];
    const searchTerm = clienteSearch.toLowerCase();
    const filtered = searchTerm
      ? rows.filter((row) =>
          row.cliente_nombre.toLowerCase().includes(searchTerm) ||
          row.cliente_codigo.toLowerCase().includes(searchTerm))
      : rows;
    const dir = clienteSort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const va = clienteSort.key === "kilos" ? a.kilos : clienteSort.key === "base" ? a.base_iva : a.pm_real;
      const vb = clienteSort.key === "kilos" ? b.kilos : clienteSort.key === "base" ? b.base_iva : b.pm_real;
      return (va - vb) * dir;
    });
  }, [displayRanking, clienteSearch, clienteSort]);

  const catalogoSorted = useMemo(() => {
    const rows = [...catalogo];
    const dir = productoSort.dir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      const va = productoSort.key === "kilos" ? Number(a.kilos ?? 0)
        : productoSort.key === "base" ? Number(a.base_iva ?? 0)
        : Number(a.kilos ?? 0) > 0 ? Number(a.base_iva ?? 0) / Number(a.kilos ?? 0) : 0;
      const vb = productoSort.key === "kilos" ? Number(b.kilos ?? 0)
        : productoSort.key === "base" ? Number(b.base_iva ?? 0)
        : Number(b.kilos ?? 0) > 0 ? Number(b.base_iva ?? 0) / Number(b.kilos ?? 0) : 0;
      return (va - vb) * dir;
    });
  }, [catalogo, productoSort]);

  const productMonthlyChart = useMemo(() => pivotMonthlyProducts(
    displayMensualProducto,
    catalogo.map((row) => row.metodo)
  ), [catalogo, displayMensualProducto]);

  const setFilter = (key: keyof FilterState, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const clearFilters = () => {
    setFilters({ campana: "", mes: "", cliente: "", metodo: "", articulo: "" });
  };
  const toggleClienteSort = (key: "kilos" | "pm" | "base") => {
    setClienteSort((current) => current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  };
  const toggleProductoSort = (key: "kilos" | "pm" | "base") => {
    setProductoSort((current) => current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  };

  const goToTab = (target: TopTab) => setTab(target);

  if (!ventas.accessQuery.isLoading && !ventas.hasAccess) {
    return (
      <div className="container mx-auto max-w-3xl p-4 md:p-6">
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-10 w-10 text-warning" />
            <div>
              <h1 className="text-2xl font-bold">Acceso restringido</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Tu correo no esta autorizado para ver {titulo}.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setParsing(true);
    try {
      const parsed = await parseVentasCategoriaExcelFile(file);
      setParsedImport(parsed);
      setTab("importar");
      toast({
        title: "Excel analizado",
        description: `${formatNumber(parsed.validation.lineasDetectadas)} lineas y ${parsed.validation.productosCatalogo} productos detectados.`,
      });
    } catch (error) {
      toast({ title: "No se pudo leer el Excel", description: errorMessage(error), variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const saveImport = async () => {
    if (!parsedImport) return;
    try {
      await ventas.importWorkbook.mutateAsync(parsedImport);
      toast({ title: `${titulo} actualizada`, description: "Datos diarios, catalogo y clientes preparados." });
      setParsedImport(null);
      setTab("resumen");
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <div className="page-shell">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TopTab)} className="space-y-4">
        <header className="page-header">
          <div>
            <div className="flex items-center gap-2">
              <p className="panel-kicker">Comercial</p>
              <Badge variant={hasImportedData ? "outline" : "destructive"} className="rounded-md px-2 py-0 text-xs">
                {hasImportedData ? "Base cargada" : "Sin datos"}
              </Badge>
            </div>
            <h1 className="page-title">{titulo}</h1>
            <p className="page-subtitle">
              {ventas.categoria?.nombre ?? subtitulo}
              {hasImportedData && !isLoading ? ` · ${formatKg(dashboardKpis.totalKilos)} · ${formatNumber(dashboardKpis.clientes)} clientes` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9 flex-1 cursor-pointer gap-1.5 rounded-md px-3 text-xs sm:flex-none">
              <label>
                <Input className="hidden" type="file" accept=".xlsx,.xls" onChange={handleImportFile} />
                <Upload className="h-3.5 w-3.5" />
                {parsing ? "Leyendo..." : "Importar Excel"}
              </label>
            </Button>
          </div>
        </header>

        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="productos">Productos</TabsTrigger>
          <TabsTrigger value="articulos">Articulos</TabsTrigger>
          <TabsTrigger value="base">Base diaria</TabsTrigger>
          <TabsTrigger value="importar">Importar</TabsTrigger>
        </TabsList>

        <VentasCategoriaFilterBar
          filters={filters}
          filterOptions={filterOptions}
          onChange={setFilter}
          onClear={clearFilters}
          activeCount={activeFilters}
        />

        {/* ─── Resumen ─────────────────────────────────────────────── */}
        <TabsContent value="resumen" className="space-y-4">
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KPICard
              className="glass-accented"
              label="Kg vendidos"
              value={formatKg(dashboardKpis.totalKilos)}
              hint={`${formatNumber(dashboardKpis.totalLineas)} lineas`}
              icon={Package}
            />
            <KPICard
              className="glass-accented"
              label="Facturacion base"
              value={`${formatNumber(dashboardKpis.totalBaseIva, 2)} €`}
              hint={`${formatNumber(dashboardKpis.eurosPorLinea, 2)} € / linea`}
              icon={Euro}
            />
            <KPICard
              className="glass-accented"
              label="Precio medio bruto"
              value={`${formatNumber(ajusteImpacto?.pmBrutoMedio ?? dashboardKpis.pmVenta, 3)} €/kg`}
              hint="Antes de comision y transporte"
              icon={Gauge}
            />
            <KPICard
              className="glass-accented"
              label="Precio medio real"
              value={`${formatNumber(ajusteImpacto?.pmRealMedio ?? dashboardKpis.pmReal, 3)} €/kg`}
              hint={ajusteImpacto ? `-${formatNumber(ajusteImpacto.impactoPct, 1)}% por ajustes` : "Sin ajustes registrados"}
              icon={Gauge}
              trend={ajusteImpacto && ajusteImpacto.impactoPct > 0 ? "down" : "neutral"}
            />
            <KPICard
              className="glass-accented"
              label="Clientes"
              value={formatNumber(dashboardKpis.clientes)}
              hint={dashboardKpis.topCliente ? `Top: ${shortName(dashboardKpis.topCliente.nombre, 20)}` : "Sin ventas"}
              icon={Users}
            />
            <KPICard
              className="glass-accented"
              label="Artículos"
              value={formatNumber(dashboardKpis.articulos)}
              hint={`${formatNumber(dashboardKpis.productos)} productos catálogo`}
              icon={BarChart3}
            />
            <KPICard
              className="glass-accented"
              label="Mes mas fuerte"
              value={dashboardKpis.mejorMes ? formatMonthLabel(dashboardKpis.mejorMes.mes) : "Sin datos"}
              hint={dashboardKpis.mejorMes ? `${formatKg(dashboardKpis.mejorMes.kilos)}` : `${formatNumber(dashboardKpis.mesesActivos)} meses activos`}
              icon={Trophy}
            />
            <KPICard
              className="glass-accented"
              label="Kg / cliente"
              value={formatKg(dashboardKpis.kilosPorCliente)}
              hint={`${formatNumber(dashboardKpis.articulosPorProducto, 2)} articulos / producto`}
              icon={Gauge}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <ChartCard title="Evolucion mensual" subtitle="Kilos vendidos por mes">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyTotals} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="mes" {...XAXIS} />
                  <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                  <Bar dataKey="kilos" name="Kilos" fill={C.primary} stroke={C.primary} {...BAR_STYLE} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <SummaryCard title="Top clientes por kg" onSeeAll={() => goToTab("clientes")}>
              <RankBars
                rows={topClientesKg.map((row) => ({
                  key: String(row.cliente_codigo),
                  label: shortName(String(row.cliente_nombre ?? ""), 26),
                  value: Number(row.kilos ?? 0),
                  formatted: formatKg(Number(row.kilos ?? 0)),
                }))}
                onSelect={(key) => {
                  const row = topClientesKg.find((r) => String(r.cliente_codigo) === key);
                  if (row) {
                    setSelectedCliente(key);
                    setSelectedClienteNombre(String(row.cliente_nombre ?? ""));
                    setTab("clientes");
                  }
                }}
              />
            </SummaryCard>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Evolucion del precio medio" subtitle="€/kg bruto por mes">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={monthlyTotals} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="mes" {...XAXIS} />
                  <YAxis {...YAXIS} tickFormatter={(v) => `${formatNumber(Number(v), 2)} €`} />
                  <Tooltip cursor={CHART_LINE_CURSOR} content={<GlassTooltip formatter={(v) => `${formatNumber(Number(v), 3)} €/kg`} />} />
                  <Line dataKey="pm" name="PM bruto" {...lineStyle(C.info)} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <SummaryCard title="Top artículos por kg" onSeeAll={() => goToTab("articulos")}>
              <RankBars
                rows={topArticulosKg.map((row) => ({
                  key: `${row.referencia ?? ""}|${row.articulo}`,
                  label: shortName(String(row.articulo ?? ""), 30),
                  value: Number(row.kilos ?? 0),
                  formatted: formatKg(Number(row.kilos ?? 0)),
                }))}
                onSelect={(key) => {
                  const row = topArticulosKg.find((r) => `${r.referencia ?? ""}|${r.articulo}` === key);
                  if (row) {
                    setSelectedArticulo(String(row.articulo));
                    setSelectedArticuloRef(row.referencia ?? null);
                    setTab("articulos");
                  }
                }}
              />
            </SummaryCard>
          </section>

          {ajusteImpacto && ajusteImpacto.clientesConAjuste > 0 ? (
            <Card className="glass-accented">
              <CardContent className="space-y-2 p-3 sm:p-4">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-1 rounded-full bg-primary" />
                  <p className="text-sm font-semibold">Impacto de comision y transporte</p>
                  <InfoTooltip iconClassName="h-3 w-3">
                    Diferencia entre el precio medio bruto y el precio medio real tras aplicar los ajustes de
                    comision y transporte configurados por cliente (pestana Clientes → Ajustes).
                  </InfoTooltip>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-2 sm:flex sm:flex-nowrap sm:items-stretch sm:gap-0">
                  <MiniKpi size="lg" label="PM bruto" value={`${formatNumber(ajusteImpacto.pmBrutoMedio, 3)} €/kg`} />
                  <MiniKpi size="lg" label="PM real" value={`${formatNumber(ajusteImpacto.pmRealMedio, 3)} €/kg`} />
                  <MiniKpi size="lg" label="Impacto" value={`-${formatNumber(ajusteImpacto.impactoPct, 1)}%`} />
                  <MiniKpi size="lg" label="Clientes con ajuste" value={formatNumber(ajusteImpacto.clientesConAjuste)} last />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {/* ─── Clientes ────────────────────────────────────────────── */}
        <TabsContent value="clientes" className="space-y-4">
          {selectedCliente ? (
            <div className="space-y-3">
              <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={() => setSelectedCliente(null)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Ranking de clientes
              </Button>
              <VentasCategoriaClienteDetail
                clienteCodigo={selectedCliente}
                clienteNombre={selectedClienteNombre}
                allLines={allLines}
                ajuste={ajustes.find((a: VentasCategoriaClienteAjusteRow) => a.cliente_codigo === selectedCliente)}
                onSaveAjuste={(input) => ventas.updateAjuste.mutate(input)}
              />
            </div>
          ) : (
            <Card className="glass-accented overflow-hidden">
              <CardHeader className="flex-col items-stretch gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base">Clientes ({formatNumber(sortedClientes.length)})</CardTitle>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 text-xs"
                    placeholder="Buscar cliente..."
                    value={clienteSearch}
                    onChange={(e) => setClienteSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 z-10 bg-[var(--glass-bg-solid)] backdrop-blur-xl">
                      <tr className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                        <th className="w-8 whitespace-nowrap">#</th>
                        <th className="whitespace-nowrap">Cliente</th>
                        <ColHead label="Kilos" sk="kilos" sortState={clienteSort} onToggle={toggleClienteSort} right />
                        <ColHead label="PM bruto" sk="pm" sortState={clienteSort} onToggle={toggleClienteSort} right />
                        <th className="text-right whitespace-nowrap">PM real</th>
                        <ColHead label="Base IVA" sk="base" sortState={clienteSort} onToggle={toggleClienteSort} right />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedClientes.length === 0 ? (
                        <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Sin clientes para esta seleccion.</td></tr>
                      ) : sortedClientes.slice(0, 200).map((row, i) => {
                        const ajuste = ajustes.find((a: VentasCategoriaClienteAjusteRow) => a.cliente_codigo === row.cliente_codigo);
                        const pmReal = ajuste
                          ? Math.max(0, row.pm_bruto * (1 - (ajuste.comision_pct + ajuste.transporte_pct) / 100) - (ajuste.comision_cent_kg + ajuste.transporte_cent_kg) / 100)
                          : row.pm_real;
                        return (
                          <tr
                            key={row.cliente_codigo}
                            className={cn(
                              "cursor-pointer border-b border-[var(--glass-border)] last:border-b-0 transition-colors hover:bg-[var(--glass-bg-strong)]",
                              i % 2 === 1 && "bg-[var(--glass-bg)]/40"
                            )}
                            onClick={() => { setSelectedCliente(row.cliente_codigo); setSelectedClienteNombre(row.cliente_nombre); }}
                          >
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                            <td className="px-3 py-1.5">
                              <div className="min-w-[200px] font-medium">{row.cliente_nombre}</div>
                              <div className="text-[11px] text-muted-foreground">{row.cliente_codigo}</div>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(row.kilos)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(row.pm_bruto, 3)} €/kg</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatNumber(pmReal, 3)} €/kg</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(row.base_iva, 2)} €</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Movil: tarjetas */}
                <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 md:hidden">
                  {sortedClientes.slice(0, 60).map((row) => (
                    <div
                      key={row.cliente_codigo}
                      onClick={() => { setSelectedCliente(row.cliente_codigo); setSelectedClienteNombre(row.cliente_nombre); }}
                      className="cursor-pointer rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 transition-colors hover:bg-[var(--glass-bg-strong)]"
                    >
                      <p className="truncate text-sm font-semibold">{row.cliente_nombre}</p>
                      <p className="text-[11px] text-muted-foreground">{row.cliente_codigo}</p>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                        <MobileField label="Kilos" value={formatKg(row.kilos)} />
                        <MobileField label="PM bruto" value={`${formatNumber(row.pm_bruto, 3)} €/kg`} muted />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!selectedCliente ? (
            <Card className="glass-accented overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Ajustes de comision y transporte</CardTitle>
                  <InfoTooltip iconClassName="h-3 w-3">
                    Se aplican por cliente para calcular el precio medio real a partir del precio medio bruto.
                  </InfoTooltip>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                      <tr>
                        <th className="whitespace-nowrap">Cliente</th>
                        <th className="whitespace-nowrap text-right">Kilos</th>
                        <th className="w-28 whitespace-nowrap">Comision %</th>
                        <th className="w-32 whitespace-nowrap">Comision cent/kg</th>
                        <th className="w-28 whitespace-nowrap">Transporte %</th>
                        <th className="w-36 whitespace-nowrap">Transporte cent/kg</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRanking.slice(0, 80).map((cliente, i) => (
                        <AjusteTableRow
                          key={String(cliente.cliente_codigo)}
                          zebra={i % 2 === 1}
                          cliente={cliente}
                          ajuste={ajustes.find((a: VentasCategoriaClienteAjusteRow) => a.cliente_codigo === cliente.cliente_codigo)}
                          onSave={(input) => ventas.updateAjuste.mutate(input)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {/* ─── Productos ───────────────────────────────────────────── */}
        <TabsContent value="productos" className="space-y-4">
          {selectedProducto ? (
            <div className="space-y-3">
              <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={() => setSelectedProducto(null)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Catalogo de productos
              </Button>
              <VentasCategoriaProductoDetail
                metodo={selectedProducto}
                descripcion={selectedProductoDesc}
                allLines={allLines}
              />
            </div>
          ) : (
            <>
              <ChartCard title="Productos catálogo por mes" subtitle="Kilos apilados por método">
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={productMonthlyChart} margin={MARGIN}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="mes" {...XAXIS} />
                    <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                    <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                    <Legend wrapperStyle={legendStyle} />
                    {catalogo.map((producto, index) => (
                      <Bar key={producto.metodo} dataKey={producto.metodo} stackId="kg" name={producto.metodo} fill={SERIES[index % SERIES.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <Card className="glass-accented overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Catálogo de productos</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 z-10 bg-[var(--glass-bg-solid)] backdrop-blur-xl text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                        <tr className="border-b border-[var(--glass-border)]">
                          <th className="whitespace-nowrap">Método</th>
                          <th className="whitespace-nowrap">Descripción</th>
                          <ColHead label="Kilos" sk="kilos" sortState={productoSort} onToggle={toggleProductoSort} right />
                          <ColHead label="PM" sk="pm" sortState={productoSort} onToggle={toggleProductoSort} right />
                          <ColHead label="Base IVA" sk="base" sortState={productoSort} onToggle={toggleProductoSort} right />
                        </tr>
                      </thead>
                      <tbody>
                        {catalogoSorted.map((row, i) => (
                          <tr
                            key={String(row.id)}
                            className={cn(
                              "cursor-pointer border-b border-[var(--glass-border)] last:border-b-0 transition-colors hover:bg-[var(--glass-bg-strong)]",
                              i % 2 === 1 && "bg-[var(--glass-bg)]/40"
                            )}
                            onClick={() => { setSelectedProducto(String(row.metodo)); setSelectedProductoDesc(String(row.descripcion ?? "")); }}
                          >
                            <td className="px-3 py-1.5 font-semibold">{String(row.metodo)}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{String(row.descripcion ?? "")}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(Number(row.kilos))}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(Number(row.kilos) > 0 ? Number(row.base_iva) / Number(row.kilos) : 0, 3)} €/kg</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(Number(row.base_iva), 2)} €</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <ChartCard title="Precio medio por producto" subtitle="€/kg por mes y método">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={productMonthlyChart} margin={MARGIN}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="mes" {...XAXIS} />
                    <YAxis {...YAXIS} tickFormatter={(v) => `${formatNumber(Number(v), 2)} €`} />
                    <Tooltip cursor={CHART_LINE_CURSOR} content={<GlassTooltip formatter={(v) => `${formatNumber(Number(v), 3)} €/kg`} />} />
                    <Legend wrapperStyle={legendStyle} />
                    {catalogo.map((producto, index) => (
                      <Line key={String(producto.metodo)} type="monotone" dataKey={String(producto.metodo)} name={String(producto.metodo)} stroke={SERIES[index % SERIES.length]} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <Card className="glass-accented overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Validación catálogo vs líneas</CardTitle>
                  <p className="text-xs text-muted-foreground">Diferencia entre el catálogo importado y la suma de líneas diarias.</p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                        <tr>
                          <th>Método</th>
                          <th className="text-right">Kg catálogo</th>
                          <th className="text-right">Kg líneas</th>
                          <th className="text-right">Dif.</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validacion.map((row, i) => {
                          const diff = Number(row.diferencia_kilos ?? 0);
                          return (
                            <tr key={row.metodo ?? "sin"} className={cn("border-b border-[var(--glass-border)] last:border-b-0", i % 2 === 1 && "bg-[var(--glass-bg)]/40")}>
                              <td className="px-3 py-1.5 font-semibold">{row.metodo}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(row.kilos_catalogo)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(row.kilos_lineas)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(diff)}</td>
                              <td className="px-3 py-1.5">{Math.abs(diff) < 0.01 ? <OkBadge /> : <WarnBadge />}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ─── Articulos ───────────────────────────────────────────── */}
        <TabsContent value="articulos" className="space-y-4">
          {selectedArticulo ? (
            <div className="space-y-3">
              <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={() => setSelectedArticulo(null)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Listado de articulos
              </Button>
              <VentasCategoriaArticuloDetail
                articulo={selectedArticulo}
                referencia={selectedArticuloRef}
                allLines={allLines}
              />
            </div>
          ) : (
            <ArticulosTab
              displayArticulos={displayArticulos}
              articuloSearch={articuloSearch}
              setArticuloSearch={setArticuloSearch}
              articuloLimit={articuloLimit}
              setArticuloLimit={setArticuloLimit}
              expandedRefs={expandedRefs}
              setExpandedRefs={setExpandedRefs}
              onSelect={(articulo, referencia) => { setSelectedArticulo(articulo); setSelectedArticuloRef(referencia); }}
            />
          )}
        </TabsContent>

        {/* ─── Base diaria ─────────────────────────────────────────── */}
        <TabsContent value="base" className="space-y-4">
          <DailyGroupTable lines={filteredLines} pageSize={5} />
        </TabsContent>

        {/* ─── Importar ────────────────────────────────────────────── */}
        <TabsContent value="importar" className="space-y-4">
          <Card className="glass-accented">
            <CardHeader>
              <CardTitle>Importar analisis consolidado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Usa el libro `Analisis Segunda 21-26.xlsx` con las hojas `Base diaria` y `Productos catalogo`.
              </p>
              {parsedImport ? (
                <div className="grid gap-3 md:grid-cols-5">
                  <Kpi title="Lineas" value={formatNumber(parsedImport.validation.lineasDetectadas)} />
                  <Kpi title="Kilos lineas" value={formatKg(parsedImport.validation.kilosLineas)} />
                  <Kpi title="Kilos catálogo" value={formatKg(parsedImport.validation.kilosCatalogo)} />
                  <Kpi title="Clientes" value={formatNumber(parsedImport.validation.clientesUnicos)} />
                  <Kpi title="Estado" value={parsedImport.validation.status === "ok" ? "OK" : "Revisar"} />
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  <FileSpreadsheet className="mx-auto mb-3 h-8 w-8 opacity-50" />
                  Selecciona un Excel desde el boton de importacion.
                </div>
              )}
              {parsedImport?.validation.issues.length ? (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  {parsedImport.validation.issues.map((issue) => <div key={issue}>{issue}</div>)}
                </div>
              ) : null}
              <Button className="gap-2" disabled={!parsedImport || ventas.importWorkbook.isPending || !ventas.hasAccess} onClick={saveImport}>
                <Database className="h-4 w-4" />
                {ventas.hasAccess ? "Guardar en Supabase" : "Solo correos autorizados"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Tipos y normalizadores de fila ──────────────────────────────────────
// Las tablas de resumen (vistas Supabase, con pm_bruto/pm_real y campos
// nullable) y la agregacion en cliente (filtros activos, con pm_venta y
// campos siempre presentes) tienen formas distintas. Se normalizan a un
// unico shape de "display" para que el resto del componente no tenga que
// preocuparse por el origen del dato.

interface NormalizedResumen {
  kilos: number;
  base_iva: number;
  pm_venta: number;
  pm_real: number;
  clientes: number;
  productos: number;
  articulos: number;
}

interface DisplayClienteRow {
  cliente_codigo: string;
  cliente_nombre: string;
  kilos: number;
  base_iva: number;
  pm_bruto: number;
  pm_real: number;
  lineas: number;
}

interface DisplayArticuloRow {
  articulo: string;
  referencia: string | null;
  kilos: number;
  base_iva: number;
  pm_bruto: number;
  lineas: number;
}

interface DisplayMensualProductoRow {
  mes: string;
  metodo_producto: string;
  kilos: number;
  base_iva: number;
}

function normalizeResumenView(resumen: VentasCategoriaResumenRow | null | undefined): NormalizedResumen {
  const kilos = Number(resumen?.kilos ?? 0);
  const base_iva = Number(resumen?.base_iva ?? 0);
  const pmBruto = Number(resumen?.pm_bruto ?? (kilos > 0 ? base_iva / kilos : 0));
  return {
    kilos,
    base_iva,
    pm_venta: pmBruto,
    pm_real: Number(resumen?.pm_real ?? pmBruto),
    clientes: Number(resumen?.clientes ?? 0),
    productos: Number(resumen?.productos ?? 0),
    articulos: Number(resumen?.articulos ?? 0),
  };
}

function normalizeResumenAgg(resumen: VCResumenAgg): NormalizedResumen {
  return {
    kilos: resumen.kilos,
    base_iva: resumen.base_iva,
    pm_venta: resumen.pm_venta,
    pm_real: resumen.pm_venta,
    clientes: resumen.clientes,
    productos: resumen.productos,
    articulos: resumen.articulos,
  };
}

function normalizeClienteView(row: VentasCategoriaRankingClienteRow): DisplayClienteRow {
  const kilos = Number(row.kilos ?? 0);
  const pmBruto = Number(row.pm_bruto ?? 0);
  return {
    cliente_codigo: row.cliente_codigo ?? "",
    cliente_nombre: row.cliente_nombre ?? "",
    kilos,
    base_iva: Number(row.base_iva ?? 0),
    pm_bruto: pmBruto,
    pm_real: Number(row.pm_real ?? pmBruto),
    lineas: Number(row.lineas ?? 0),
  };
}

function normalizeClienteAgg(row: VCClienteAggRow): DisplayClienteRow {
  return {
    cliente_codigo: row.cliente_codigo,
    cliente_nombre: row.cliente_nombre,
    kilos: row.kilos,
    base_iva: row.base_iva,
    pm_bruto: row.pm_venta,
    pm_real: row.pm_venta,
    lineas: row.lineas,
  };
}

function normalizeArticuloView(row: VentasCategoriaResumenArticuloRow): DisplayArticuloRow {
  return {
    articulo: row.articulo ?? "",
    referencia: row.referencia,
    kilos: Number(row.kilos ?? 0),
    base_iva: Number(row.base_iva ?? 0),
    pm_bruto: Number(row.pm_bruto ?? 0),
    lineas: Number(row.lineas ?? 0),
  };
}

function normalizeArticuloAgg(row: VCArticuloAggRow): DisplayArticuloRow {
  return {
    articulo: row.articulo,
    referencia: row.referencia,
    kilos: row.kilos,
    base_iva: row.base_iva,
    pm_bruto: row.pm_venta,
    lineas: row.lineas,
  };
}

function normalizeMensualProductoView(row: VCMensualProductoViewRow): DisplayMensualProductoRow {
  return {
    mes: row.mes ?? "",
    metodo_producto: row.metodo_producto ?? "Sin clasificar",
    kilos: Number(row.kilos ?? 0),
    base_iva: Number(row.base_iva ?? 0),
  };
}

function normalizeMensualProductoAgg(row: VCMensualProductoAggRow): DisplayMensualProductoRow {
  return {
    mes: row.mes,
    metodo_producto: row.metodo_producto,
    kilos: row.kilos,
    base_iva: row.base_iva,
  };
}

// ─── Sub-componentes ─────────────────────────────────────────────────────

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <Card className="glass-accented">
      <CardContent className="p-3 sm:p-4">
        <p className="panel-kicker">{title}</p>
        <p className="mt-1 break-words text-xl font-bold leading-tight tabular-nums sm:text-2xl">{value}</p>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="px-4 pb-2 pt-4 sm:px-6">
        <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </CardHeader>
      <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6"><div className={CHART_PANEL_CLASS}>{children}</div></CardContent>
    </Card>
  );
}

function SummaryCard({ title, onSeeAll, children }: { title: string; onSeeAll: () => void; children: ReactNode }) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="flex-row items-center justify-between px-4 pb-2 pt-4 sm:px-6">
        <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-primary" onClick={onSeeAll}>
          Ver detalle <ArrowRight className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent className="px-3 pb-3 sm:px-6 sm:pb-5">{children}</CardContent>
    </Card>
  );
}

function RankBars({ rows, onSelect }: {
  rows: Array<{ key: string; label: string; value: number; formatted: string }>;
  onSelect: (key: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Sin datos para esta seleccion.</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={() => onSelect(row.key)}
          className="block w-full space-y-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[var(--glass-bg-strong)]"
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
            <span className="tabular-nums font-semibold">{row.formatted}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </button>
      ))}
    </div>
  );
}

function MobileField({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-medium tabular-nums", muted && "text-muted-foreground")}>{value}</span>
    </div>
  );
}

type SortState<K extends string> = { key: K; dir: "asc" | "desc" };

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return dir === "asc" ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />;
}

function ColHead<K extends string>({ label, sk, sortState, onToggle, right }: {
  label: string; sk: K; sortState: SortState<K>; onToggle: (k: K) => void; right?: boolean;
}) {
  return (
    <th
      className={cn("cursor-pointer select-none whitespace-nowrap transition-colors hover:text-foreground", right && "text-right")}
      onClick={() => onToggle(sk)}
    >
      <span className={cn("inline-flex items-center gap-1", right && "flex-row-reverse")}>
        {label}<SortIcon active={sortState.key === sk} dir={sortState.dir} />
      </span>
    </th>
  );
}

function AjusteTableRow({ cliente, ajuste, onSave, zebra }: {
  cliente: DisplayClienteRow;
  ajuste?: VentasCategoriaClienteAjusteRow;
  onSave: (input: VentasCategoriaAjusteInput) => void;
  zebra?: boolean;
}) {
  const [values, setValues] = useState({
    comision_pct: Number(ajuste?.comision_pct ?? 0),
    comision_cent_kg: Number(ajuste?.comision_cent_kg ?? 0),
    transporte_pct: Number(ajuste?.transporte_pct ?? 0),
    transporte_cent_kg: Number(ajuste?.transporte_cent_kg ?? 0),
  });

  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: Number(value) || 0 }));

  return (
    <tr className={cn("border-b border-[var(--glass-border)] last:border-b-0", zebra && "bg-[var(--glass-bg)]/40")}>
      <td className="px-3 py-1.5">
        <div className="min-w-[200px] font-medium">{String(cliente.cliente_nombre ?? "")}</div>
        <div className="text-[11px] text-muted-foreground">{String(cliente.cliente_codigo ?? "")}</div>
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(Number(cliente.kilos ?? 0))}</td>
      <td className="px-2 py-1"><Input type="number" className="h-8 text-xs" value={values.comision_pct} onChange={(e) => set("comision_pct", e.target.value)} /></td>
      <td className="px-2 py-1"><Input type="number" className="h-8 text-xs" value={values.comision_cent_kg} onChange={(e) => set("comision_cent_kg", e.target.value)} /></td>
      <td className="px-2 py-1"><Input type="number" className="h-8 text-xs" value={values.transporte_pct} onChange={(e) => set("transporte_pct", e.target.value)} /></td>
      <td className="px-2 py-1"><Input type="number" className="h-8 text-xs" value={values.transporte_cent_kg} onChange={(e) => set("transporte_cent_kg", e.target.value)} /></td>
      <td className="px-2 py-1">
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onSave({
          cliente_codigo: String(cliente.cliente_codigo ?? ""),
          cliente_nombre: String(cliente.cliente_nombre ?? ""),
          ...values,
        })}>
          <Save className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

function OkBadge() {
  return <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success"><CheckCircle2 className="h-3 w-3" /> OK</Badge>;
}

function WarnBadge() {
  return <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-warning"><AlertTriangle className="h-3 w-3" /> Revisar</Badge>;
}

function ArticulosTab({
  displayArticulos, articuloSearch, setArticuloSearch, articuloLimit, setArticuloLimit, expandedRefs, setExpandedRefs, onSelect,
}: {
  displayArticulos: DisplayArticuloRow[];
  articuloSearch: string;
  setArticuloSearch: (v: string) => void;
  articuloLimit: number;
  setArticuloLimit: (v: number) => void;
  expandedRefs: Set<string>;
  setExpandedRefs: (v: Set<string>) => void;
  onSelect: (articulo: string, referencia: string | null) => void;
}) {
  const searchTerm = articuloSearch.toLowerCase();
  const filtered = searchTerm
    ? displayArticulos.filter((row) => String(row.articulo ?? "").toLowerCase().includes(searchTerm))
    : displayArticulos;
  const grouped = new Map<string, { referencia: string; articulos: DisplayArticuloRow[]; totalKilos: number; totalBase: number }>();
  filtered.forEach((row) => {
    const ref = String(row.referencia ?? "SIN REF");
    if (!grouped.has(ref)) grouped.set(ref, { referencia: ref, articulos: [], totalKilos: 0, totalBase: 0 });
    const group = grouped.get(ref)!;
    group.articulos.push(row);
    group.totalKilos += Number(row.kilos ?? 0);
    group.totalBase += Number(row.base_iva ?? 0);
  });
  const sortedGroups = Array.from(grouped.values()).sort((a, b) => b.totalKilos - a.totalKilos);
  const totalArticulos = filtered.length;
  const totalRefs = sortedGroups.length;
  const totalKilos = sortedGroups.reduce((s, g) => s + g.totalKilos, 0);
  const totalBase = sortedGroups.reduce((s, g) => s + g.totalBase, 0);
  const pmMedio = totalKilos > 0 ? totalBase / totalKilos : 0;
  const limited = sortedGroups.slice(0, articuloLimit);
  const hasMore = sortedGroups.length > articuloLimit;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi title="Artículos" value={formatNumber(totalArticulos)} />
        <Kpi title="Referencias" value={formatNumber(totalRefs)} />
        <Kpi title="Kilos total" value={formatKg(totalKilos)} />
        <Kpi title="PM medio" value={`${formatNumber(pmMedio, 3)} €/kg`} />
      </section>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar artículo..."
          value={articuloSearch}
          onChange={(e) => { setArticuloSearch(e.target.value); setArticuloLimit(10); }}
        />
      </div>
      <div className="space-y-2">
        {limited.map((group) => {
          const expanded = expandedRefs.has(group.referencia);
          return (
            <Card key={group.referencia} className="glass-accented overflow-hidden">
              <CardHeader
                className="cursor-pointer px-4 py-3 hover:bg-[var(--glass-bg-strong)]"
                onClick={() => {
                  const next = new Set(expandedRefs);
                  if (expanded) next.delete(group.referencia); else next.add(group.referencia);
                  setExpandedRefs(next);
                }}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {group.referencia}
                  </CardTitle>
                  <div className="flex items-center gap-4 text-xs tabular-nums text-muted-foreground">
                    <span>{group.articulos.length} articulos</span>
                    <span>{formatKg(group.totalKilos)}</span>
                  </div>
                </div>
              </CardHeader>
              {expanded && (
                <CardContent className="p-0">
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                      <tr>
                        <th>Artículo</th>
                        <th className="text-right">Kilos</th>
                        <th className="text-right">PM</th>
                        <th className="text-right">Líneas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...group.articulos].sort((a, b) => Number(b.kilos ?? 0) - Number(a.kilos ?? 0)).map((row, i) => (
                        <tr
                          key={`${row.referencia}-${row.articulo}`}
                          className={cn(
                            "cursor-pointer border-b border-[var(--glass-border)] last:border-b-0 transition-colors hover:bg-[var(--glass-bg-strong)]",
                            i % 2 === 1 && "bg-[var(--glass-bg)]/40"
                          )}
                          onClick={() => onSelect(String(row.articulo), row.referencia ?? null)}
                        >
                          <td className="min-w-[280px] px-3 py-1.5 font-medium">{row.articulo}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(row.kilos)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(row.pm_bruto, 3)} €/kg</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(row.lineas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
      {hasMore && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => setArticuloLimit(9999)}>
            Mostrar todos ({sortedGroups.length} referencias)
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const SERIES = [C.primary, C.info, C.success, C.warning, C.destructive];

function pivotMonthlyProducts(rows: DisplayMensualProductoRow[], methods: string[]) {
  const map = new Map<string, Record<string, number | string>>();
  rows.forEach((row) => {
    if (!row.mes) return;
    const current = map.get(row.mes) ?? { mes: row.mes };
    if (methods.includes(row.metodo_producto)) current[row.metodo_producto] = row.kilos;
    map.set(row.mes, current);
  });
  return Array.from(map.values()).sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
}

function shortName(value: string, max = 22) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function formatMonthLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return value || "Sin datos";
  const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const month = Number(match[2]);
  if (month < 1 || month > 12) return value;
  return `${monthNames[month - 1]} ${match[1]}`;
}
