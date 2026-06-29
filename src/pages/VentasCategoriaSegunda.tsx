import { useMemo, useState, type ChangeEvent } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, BarChart3, CheckCircle2, ChevronDown, ChevronRight, Database, Euro, FileSpreadsheet, Gauge, Package, Save, Search, Trophy, Upload, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KPICard } from "@/components/KPICard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useVentasCategoria, type VentasCategoriaAjusteInput } from "@/hooks/useVentasCategoria";
import { parseVentasCategoriaExcelFile } from "@/lib/ventasCategoriaExcel";
import { VentasCategoriaFilterBar } from "@/components/VentasCategoriaFilterBar";
import {
  applyVentasCategoriaFilters,
  aggregateVentasCategoria,
  buildVentasCategoriaCampanaComparison,
  buildVentasCategoriaDashboardKpis,
} from "@/lib/ventasCategoria";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber, formatPct } from "@/lib/format";
import {
  BAR_STYLE, C, CHART_LINE_CURSOR, CHART_PANEL_CLASS, GlassTooltip, GRID, legendStyle, lineStyle, MARGIN, SERIES_PALETTE, XAXIS, YAXIS,
} from "@/lib/chartTheme";
import type { ParseVentasCategoriaWorkbookResult } from "@/lib/ventasCategoria";
import { SparklineCell } from "@/components/SparklineCell";
import { DailyGroupTable } from "@/components/DailyGroupTable";
import { VentasCategoriaClienteDetail } from "@/components/VentasCategoriaClienteDetail";
import { VentasCategoriaProductoDetail } from "@/components/VentasCategoriaProductoDetail";
import { VentasCategoriaArticuloDetail } from "@/components/VentasCategoriaArticuloDetail";

const EMPTY_ROWS: never[] = [];
const EMPTY_FILTER_OPTIONS = { lineas: 0, campanas: [], meses: [], clientes: [], metodos: [] };

export default function VentasCategoriaSegunda() {
  const ventas = useVentasCategoria();
  const [tab, setTab] = useState("dashboard");
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ campana: "", mes: "", cliente: "", metodo: "", articulo: "" });
  const [parsedImport, setParsedImport] = useState<ParseVentasCategoriaWorkbookResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [selectedCliente, setSelectedCliente] = useState<string | null>(null);
  const [selectedClienteNombre, setSelectedClienteNombre] = useState<string>("");
  const [selectedProducto, setSelectedProducto] = useState<string | null>(null);
  const [selectedProductoDesc, setSelectedProductoDesc] = useState<string>("");
  const [selectedArticulo, setSelectedArticulo] = useState<string | null>(null);
  const [selectedArticuloRef, setSelectedArticuloRef] = useState<string | null>(null);
  const [clientesView, setClientesView] = useState("kilos");
  const [clienteSearch, setClienteSearch] = useState("");
  const [articuloSearch, setArticuloSearch] = useState("");
  const [articuloLimit, setArticuloLimit] = useState(10);
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());
  const [compareCampanas, setCompareCampanas] = useState<string[]>([]);

  const resumen = ventas.resumenQuery.data;
  const rankingClientes = ventas.rankingClientesQuery.data ?? EMPTY_ROWS;
  const mensualCliente = ventas.mensualClienteQuery.data ?? EMPTY_ROWS;
  const mensualProducto = ventas.mensualProductoQuery.data ?? EMPTY_ROWS;
  const articulos = ventas.articulosQuery.data ?? EMPTY_ROWS;
  const catalogo = ventas.catalogoQuery.data ?? EMPTY_ROWS;
  const ajustes = ventas.ajustesQuery.data ?? EMPTY_ROWS;
  const validacion = ventas.validacionQuery.data ?? EMPTY_ROWS;
  const filterOptions = ventas.filterOptionsQuery.data ?? EMPTY_FILTER_OPTIONS;

  // Client-side filtered data
  const allLines = ventas.allLinesQuery.data ?? EMPTY_ROWS;
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const hasActiveFilters = activeFilters > 0;
  const hasImportedData = Number(resumen?.kilos ?? 0) > 0;

  const filteredLines = useMemo(
    () => applyVentasCategoriaFilters(allLines, filters),
    [allLines, filters]
  );

  const filteredAggregation = useMemo(
    () => aggregateVentasCategoria(filteredLines),
    [filteredLines]
  );

  // Use filtered aggregation when filters active, otherwise use view queries
  const displayResumen = hasActiveFilters ? filteredAggregation.resumen : resumen;
  const displayRanking = hasActiveFilters ? filteredAggregation.clientes : rankingClientes;
  const displayMensualProducto = hasActiveFilters ? filteredAggregation.mensualProducto : mensualProducto;
  const displayMensualCliente = hasActiveFilters ? filteredAggregation.mensualCliente : mensualCliente;
  const displayArticulos = hasActiveFilters ? filteredAggregation.articulos : articulos;

  const monthlyTotals = useMemo(() => {
    const source = hasActiveFilters ? displayMensualProducto : mensualProducto;
    const map = new Map<string, { mes: string; kilos: number; base: number; pm: number }>();
    source.forEach((row) => {
      const mes = String(row.mes ?? "");
      if (!mes) return;
      const current = map.get(mes) ?? { mes, kilos: 0, base: 0, pm: 0 };
      current.kilos += Number(row.kilos ?? 0);
      current.base += Number(row.base_iva ?? 0);
      current.pm = current.kilos > 0 ? current.base / current.kilos : 0;
      map.set(mes, current);
    });
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [hasActiveFilters, displayMensualProducto, mensualProducto]);

  const dashboardKpis = useMemo(
    () => buildVentasCategoriaDashboardKpis({
      resumen: displayResumen,
      clientes: displayRanking,
      monthlyTotals,
    }),
    [displayResumen, displayRanking, monthlyTotals],
  );

  const defaultCompareCampanas = useMemo(
    () => filterOptions.campanas.slice(0, Math.min(3, filterOptions.campanas.length)),
    [filterOptions.campanas],
  );
  const activeCompareCampanas = compareCampanas.length > 0 ? compareCampanas : defaultCompareCampanas;
  const comparisonSourceLines = useMemo(
    () => applyVentasCategoriaFilters(allLines, {
      mes: filters.mes,
      cliente: filters.cliente,
      metodo: filters.metodo,
      articulo: filters.articulo,
    }),
    [allLines, filters.mes, filters.cliente, filters.metodo, filters.articulo],
  );
  const campaignComparison = useMemo(
    () => buildVentasCategoriaCampanaComparison(comparisonSourceLines, activeCompareCampanas),
    [comparisonSourceLines, activeCompareCampanas],
  );
  const comparisonStats = useMemo(() => {
    const totalKilos = campaignComparison.reduce((sum, row) => sum + row.kilos, 0);
    const totalBase = campaignComparison.reduce((sum, row) => sum + row.base_iva, 0);
    const bestVolume = campaignComparison.reduce<typeof campaignComparison[number] | null>(
      (best, row) => (!best || row.kilos > best.kilos ? row : best),
      null,
    );
    const bestPrice = campaignComparison.reduce<typeof campaignComparison[number] | null>(
      (best, row) => (!best || row.pm_venta > best.pm_venta ? row : best),
      null,
    );
    return {
      totalKilos,
      totalBase,
      avgPm: totalKilos > 0 ? totalBase / totalKilos : 0,
      bestVolume,
      bestPrice,
    };
  }, [campaignComparison]);

  const topClientes = (hasActiveFilters ? displayRanking : rankingClientes).slice(0, 10);
  const topArticulos = (hasActiveFilters ? displayArticulos : articulos).slice(0, 25);
  const productMonthlyChart = useMemo(() => pivotMonthlyProducts(
    hasActiveFilters ? displayMensualProducto : mensualProducto,
    catalogo.map((row) => row.metodo)
  ), [catalogo, hasActiveFilters, displayMensualProducto, mensualProducto]);

  // Monthly evolution data for sparklines
  const monthlyEvolution = useMemo(() => {
    const byCliente = new Map<string, Map<string, number>>();
    const source = hasActiveFilters ? displayMensualCliente : mensualCliente;
    source.forEach((row: Record<string, unknown>) => {
      const codigo = String(row.cliente_codigo ?? "");
      const mes = String(row.mes ?? "");
      const kilos = Number(row.kilos ?? 0);
      if (!codigo || !mes) return;
      if (!byCliente.has(codigo)) byCliente.set(codigo, new Map());
      byCliente.get(codigo)!.set(mes, kilos);
    });
    return byCliente;
  }, [hasActiveFilters, displayMensualCliente, mensualCliente]);

  const getSparklineData = (codigo: string) => {
    const clientData = monthlyEvolution.get(codigo);
    if (!clientData) return { points: [], maxKilos: 0 };
    const allMonths = hasActiveFilters
      ? displayMensualCliente.map((r: Record<string, unknown>) => String(r.mes ?? "")).filter(Boolean)
      : mensualCliente.map((r: Record<string, unknown>) => String(r.mes ?? "")).filter(Boolean);
    const uniqueMonths = [...new Set(allMonths)].sort();
    const last6 = uniqueMonths.slice(-6);
    const max = Math.max(...last6.map((m) => clientData.get(m) ?? 0), 1);
    return {
      points: last6.map((mes) => ({ mes, kilos: clientData.get(mes) ?? 0 })),
      maxKilos: max,
    };
  };

  const setFilter = (key: keyof typeof filters, value: string) => {
    setPage(0);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const clearFilters = () => {
    setPage(0);
    setFilters({ campana: "", mes: "", cliente: "", metodo: "", articulo: "" });
  };
  const toggleCompareCampana = (campana: string) => {
    setCompareCampanas((current) => {
      const base = current.length > 0 ? current : defaultCompareCampanas;
      return base.includes(campana)
        ? base.filter((value) => value !== campana)
        : [...base, campana];
    });
  };

  if (!ventas.accessQuery.isLoading && !ventas.hasAccess) {
    return (
      <div className="container mx-auto max-w-3xl p-4 md:p-6">
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-10 w-10 text-warning" />
            <div>
              <h1 className="text-2xl font-bold">Acceso restringido</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Tu correo no esta autorizado para ver Categoria segunda.
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
      toast({ title: "Categoria segunda actualizada", description: "Datos diarios, catalogo y clientes preparados." });
      setParsedImport(null);
      setTab("dashboard");
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-0 sm:space-y-5 md:p-6">
      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
      <header className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 shadow-[var(--glass-shadow)] backdrop-blur-xl md:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <p className="panel-kicker text-xs">Comercial</p>
              <Badge variant={hasImportedData ? "outline" : "destructive"} className="rounded-md text-xs px-2 py-0">
                {hasImportedData ? "Base cargada" : "Sin datos"}
              </Badge>
            </div>
            <h1 className="min-w-0 text-lg font-bold leading-tight md:text-xl">Categoria segunda</h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9 flex-1 cursor-pointer rounded-md px-3 text-xs sm:h-8 sm:flex-none">
              <label>
                <Input className="hidden" type="file" accept=".xlsx,.xls" onChange={handleImportFile} />
                <Upload className="h-3.5 w-3.5" />
                {parsing ? "Leyendo..." : "Importar Excel"}
              </label>
            </Button>
            <Badge variant="outline" className="h-9 min-w-0 rounded-md px-2 text-xs sm:h-8">
              {ventas.categoria?.nombre ?? "Sin categoria"}
            </Badge>
          </div>
        </div>
        <div className="mt-3">
          <TabsList className="flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto rounded-xl bg-[var(--glass-bg-strong)] p-1 sm:inline-flex sm:w-auto sm:flex-wrap">
            <TabsTrigger value="dashboard" className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground sm:px-4 sm:py-1.5">Dashboard</TabsTrigger>
            <TabsTrigger value="comparar" className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground sm:px-4 sm:py-1.5">Comparar</TabsTrigger>
            <TabsTrigger value="clientes" className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground sm:px-4 sm:py-1.5">Clientes</TabsTrigger>
            <TabsTrigger value="productos" className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground sm:px-4 sm:py-1.5">Productos</TabsTrigger>
            <TabsTrigger value="articulos" className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground sm:px-4 sm:py-1.5">Articulos</TabsTrigger>
            <TabsTrigger value="base" className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground sm:px-4 sm:py-1.5">Base diaria</TabsTrigger>
            <TabsTrigger value="importar" className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground sm:px-4 sm:py-1.5">Importar</TabsTrigger>
          </TabsList>
        </div>
      </header>

      <VentasCategoriaFilterBar
        filters={filters}
        filterOptions={filterOptions}
        onChange={setFilter}
        onClear={clearFilters}
        activeCount={activeFilters}
      />

        <TabsContent value="dashboard" className="space-y-5">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <KPICard
              className="glass-accented"
              label="Volumen vendido"
              value={formatKg(dashboardKpis.totalKilos)}
              hint={`${formatNumber(dashboardKpis.totalLineas)} lineas · ${formatKg(dashboardKpis.kilosPorCliente)} / cliente`}
              icon={Package}
            />
            <KPICard
              className="glass-accented"
              label="Facturacion base"
              value={`${formatNumber(dashboardKpis.totalBaseIva, 2)} EUR`}
              hint={`${formatNumber(dashboardKpis.eurosPorLinea, 2)} EUR / linea`}
              icon={Euro}
            />
            <KPICard
              className="glass-accented"
              label="Precio medio real"
              value={`${formatNumber(dashboardKpis.pmReal, 3)} EUR/kg`}
              hint={`Bruto ${formatNumber(dashboardKpis.pmVenta, 3)} EUR/kg`}
              icon={Gauge}
              trend={dashboardKpis.pmReal < dashboardKpis.pmVenta ? "down" : "neutral"}
            />
            <KPICard
              className="glass-accented"
              label="Actividad comercial"
              value={`${formatNumber(dashboardKpis.clientes)} clientes`}
              hint={`${formatNumber(dashboardKpis.productos)} productos · ${formatNumber(dashboardKpis.articulos)} articulos`}
              icon={BarChart3}
            />
            <KPICard
              className="glass-accented"
              label="Cliente principal"
              value={dashboardKpis.topCliente ? shortName(dashboardKpis.topCliente.nombre, 18) : "Sin datos"}
              hint={dashboardKpis.topCliente ? `${formatPct(dashboardKpis.topCliente.cuotaPct)} del volumen · ${formatKg(dashboardKpis.topCliente.kilos)}` : "Sin ventas"}
              icon={Users}
            />
            <KPICard
              className="glass-accented"
              label="Mes mas fuerte"
              value={dashboardKpis.mejorMes ? formatMonthLabel(dashboardKpis.mejorMes.mes) : "Sin datos"}
              hint={dashboardKpis.mejorMes ? `${formatKg(dashboardKpis.mejorMes.kilos)} · ${formatNumber(dashboardKpis.mejorMes.pm, 3)} EUR/kg` : `${formatNumber(dashboardKpis.mesesActivos)} meses activos`}
              icon={Trophy}
            />
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <Kpi title="Meses con venta" value={formatNumber(dashboardKpis.mesesActivos)} />
            <Kpi title="Articulos / producto" value={formatNumber(dashboardKpis.articulosPorProducto, 2)} />
            <Kpi title="Ultima lectura" value={dashboardKpis.mejorMes ? `${formatMonthLabel(monthlyTotals.at(-1)?.mes ?? "")}` : "Sin datos"} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <ChartCard title="Evolucion mensual total">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={monthlyTotals} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="mes" {...XAXIS} />
                  <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                  <Bar dataKey="kilos" name="Kilos" fill={C.primary} stroke={C.primary} {...BAR_STYLE} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top clientes por volumen">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topClientes.map((row) => ({ ...row, nombre: shortName(row.cliente_nombre ?? "") }))} layout="vertical" margin={{ ...MARGIN, left: 80 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" {...XAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                  <YAxis type="category" dataKey="nombre" width={90} {...YAXIS} />
                  <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                  <Bar dataKey="kilos" name="Kilos" fill={C.success} stroke={C.success} {...BAR_STYLE} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <ChartCard title="Evolucion mensual de precio medio">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyTotals} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="mes" {...XAXIS} />
                <YAxis {...YAXIS} tickFormatter={(v) => `${formatNumber(Number(v), 2)} EUR`} />
                <Tooltip cursor={CHART_LINE_CURSOR} content={<GlassTooltip formatter={(v) => `${formatNumber(Number(v), 3)} EUR/kg`} />} />
                <Line dataKey="pm" name="PM bruto" {...lineStyle(C.info)} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </TabsContent>

        <TabsContent value="comparar" className="space-y-5">
          <Card className="glass-accented">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-base">Comparativa entre campanas</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Volumen, facturacion y precio medio con los filtros actuales de cliente, producto, mes y articulo.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-md px-3 text-xs"
                    onClick={() => setCompareCampanas(defaultCompareCampanas)}
                  >
                    Ultimas 3
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-md px-3 text-xs"
                    onClick={() => setCompareCampanas(filterOptions.campanas)}
                  >
                    Todas
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {filterOptions.campanas.map((campana) => {
                  const active = activeCompareCampanas.includes(campana);
                  return (
                    <Button
                      key={campana}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      className="h-8 rounded-md px-3 text-xs"
                      onClick={() => toggleCompareCampana(campana)}
                    >
                      {campana}
                    </Button>
                  );
                })}
                {filterOptions.campanas.length === 0 ? (
                  <span className="text-sm text-muted-foreground">No hay campanas disponibles.</span>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Kpi title="Campanas" value={formatNumber(campaignComparison.length)} />
            <Kpi title="Volumen comparado" value={formatKg(comparisonStats.totalKilos)} />
            <Kpi title="PM conjunto" value={`${formatNumber(comparisonStats.avgPm, 3)} EUR/kg`} />
            <Kpi
              title="Mayor volumen"
              value={comparisonStats.bestVolume ? `${comparisonStats.bestVolume.campana} - ${formatKg(comparisonStats.bestVolume.kilos)}` : "Sin datos"}
            />
            <Kpi
              title="Mejor precio"
              value={comparisonStats.bestPrice ? `${comparisonStats.bestPrice.campana} - ${formatNumber(comparisonStats.bestPrice.pm_venta, 3)}` : "Sin datos"}
            />
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <ChartCard title="Volumen por campana">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={campaignComparison} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="campana" {...XAXIS} />
                  <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                  <Bar dataKey="kilos" name="Kilos" fill={C.primary} stroke={C.primary} {...BAR_STYLE} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Precio medio por campana">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={campaignComparison} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="campana" {...XAXIS} />
                  <YAxis {...YAXIS} tickFormatter={(v) => `${formatNumber(Number(v), 2)} EUR`} />
                  <Tooltip cursor={CHART_LINE_CURSOR} content={<GlassTooltip formatter={(v) => `${formatNumber(Number(v), 3)} EUR/kg`} />} />
                  <Line dataKey="pm_venta" name="PM venta" {...lineStyle(C.info)} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <Card className="glass-accented overflow-hidden">
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Detalle comparado</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campana</TableHead>
                      <TableHead className="text-right">Kilos</TableHead>
                      <TableHead className="text-right">Base IVA</TableHead>
                      <TableHead className="text-right">PM venta</TableHead>
                      <TableHead className="text-right">Cuota kg</TableHead>
                      <TableHead className="text-right">Clientes</TableHead>
                      <TableHead className="text-right">Productos</TableHead>
                      <TableHead className="text-right">Delta kg</TableHead>
                      <TableHead className="text-right">Delta PM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaignComparison.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                          Sin datos para la seleccion actual.
                        </TableCell>
                      </TableRow>
                    ) : campaignComparison.map((row) => (
                      <TableRow key={row.campana}>
                        <TableCell className="font-semibold">{row.campana}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(row.kilos)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.base_iva, 2)} EUR</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.pm_venta, 3)} EUR/kg</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPct(row.cuota_kilos_pct)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.clientes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.productos)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <DeltaBadge
                            value={row.delta_kilos}
                            formatter={(value) => row.delta_kilos_pct == null
                              ? formatKg(value)
                              : `${formatKg(value)} / ${formatPct(row.delta_kilos_pct)}`}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <DeltaBadge value={row.delta_pm} formatter={(value) => `${formatNumber(value, 3)} EUR/kg`} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clientes" className="space-y-5">
          {selectedCliente ? (
            <div className="space-y-4">
              <Button variant="outline" size="sm" onClick={() => setSelectedCliente(null)}>
                ← Volver al ranking
              </Button>
              <VentasCategoriaClienteDetail
                clienteCodigo={selectedCliente}
                clienteNombre={selectedClienteNombre}
                allLines={allLines}
                ajuste={ajustes.find((a: Record<string, unknown>) => a.cliente_codigo === selectedCliente) as never}
                onSaveAjuste={(input) => ventas.updateAjuste.mutate(input)}
              />
            </div>
          ) : (
            <>
              <div className="flex w-fit rounded-lg border border-[var(--glass-border)] p-0.5">
                <Button
                  type="button"
                  variant={clientesView === "kilos" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 rounded-md px-3 text-xs"
                  onClick={() => setClientesView("kilos")}
                >
                  Ranking por kilos
                </Button>
                <Button
                  type="button"
                  variant={clientesView === "pm" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 rounded-md px-3 text-xs"
                  onClick={() => setClientesView("pm")}
                >
                  Ranking por PM real
                </Button>
                <Button
                  type="button"
                  variant={clientesView === "ajustes" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 rounded-md px-3 text-xs"
                  onClick={() => setClientesView("ajustes")}
                >
                  Ajustes
                </Button>
                <Button
                  type="button"
                  variant={clientesView === "todos" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 rounded-md px-3 text-xs"
                  onClick={() => setClientesView("todos")}
                >
                  Todos
                </Button>
              </div>
              {clientesView === "ajustes" ? (
                <Card className="glass-accented overflow-hidden">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Cliente</TableHead>
                            <TableHead className="text-right">Kilos</TableHead>
                            <TableHead className="w-28">Comision %</TableHead>
                            <TableHead className="w-32">Comision cent/kg</TableHead>
                            <TableHead className="w-30">Transporte %</TableHead>
                            <TableHead className="w-36">Transporte cent/kg</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {displayRanking.slice(0, 80).map((cliente: Record<string, unknown>) => (
                            <AjusteTableRow
                              key={String(cliente.cliente_codigo)}
                              cliente={cliente}
                              ajuste={ajustes.find((a: Record<string, unknown>) => a.cliente_codigo === cliente.cliente_codigo)}
                              onSave={(input) => ventas.updateAjuste.mutate(input)}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ) : clientesView === "todos" ? (
                <Card className="glass-accented overflow-hidden">
                  <CardHeader className="pb-0">
                    <CardTitle className="text-base">Todos los clientes</CardTitle>
                    <div className="mt-2">
                      <Input
                        placeholder="Buscar por nombre de cliente..."
                        value={clienteSearch}
                        onChange={(e) => setClienteSearch(e.target.value)}
                        className="max-w-sm"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-[800px] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Cliente</TableHead>
                            <TableHead className="text-right">Kilos</TableHead>
                            <TableHead className="text-right">PM</TableHead>
                            <TableHead className="text-right">Base IVA</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...displayRanking].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
                            Number(b.kilos ?? 0) - Number(a.kilos ?? 0)
                          ).filter((row) => {
                            const nombre = String(row.cliente_nombre ?? "").toLowerCase();
                            const codigo = String(row.cliente_codigo ?? "").toLowerCase();
                            const q = clienteSearch.toLowerCase();
                            return !q || nombre.includes(q) || codigo.includes(q);
                          }).map((row) => (
                            <TableRow
                              key={String(row.cliente_codigo)}
                              className="cursor-pointer hover:bg-[var(--glass-bg-strong)]"
                              onClick={() => { setSelectedCliente(String(row.cliente_codigo)); setSelectedClienteNombre(String(row.cliente_nombre ?? "")); }}
                            >
                              <TableCell className="min-w-[240px]">
                                <div className="font-medium">{String(row.cliente_nombre ?? "")}</div>
                                <div className="text-xs text-muted-foreground">{String(row.cliente_codigo ?? "")}</div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatKg(Number(row.kilos ?? 0))}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(Number(row.pm_real ?? row.pm_venta ?? 0), 3)} EUR/kg</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(Number(row.base_iva ?? 0), 2)} EUR</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="glass-accented overflow-hidden">
                  <CardHeader className="pb-0">
                    <CardTitle className="text-base">Ranking de clientes</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8">#</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead className="text-right">{clientesView === "kilos" ? "Kilos" : "PM real"}</TableHead>
                            <TableHead className="text-right">{clientesView === "kilos" ? "PM" : "Kilos"}</TableHead>
                            <TableHead className="text-right">Evolucion</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(clientesView === "kilos" ? displayRanking : [...displayRanking].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
                            Number(b.pm_real ?? b.pm_venta ?? 0) - Number(a.pm_real ?? a.pm_venta ?? 0)
                          )).slice(0, 30).map((row, i) => {
                            const spark = getSparklineData(String(row.cliente_codigo ?? ""));
                            return (
                              <TableRow
                                key={String(row.cliente_codigo)}
                                className="cursor-pointer hover:bg-[var(--glass-bg-strong)]"
                                onClick={() => { setSelectedCliente(String(row.cliente_codigo)); setSelectedClienteNombre(String(row.cliente_nombre ?? "")); }}
                              >
                                <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                                <TableCell className="min-w-[240px]">
                                  <div className="font-medium">{String(row.cliente_nombre ?? "")}</div>
                                  <div className="text-xs text-muted-foreground">{String(row.cliente_codigo ?? "")}</div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {clientesView === "kilos" ? formatKg(Number(row.kilos ?? 0)) : `${formatNumber(Number(row.pm_real ?? row.pm_venta ?? 0), 3)} EUR/kg`}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {clientesView === "kilos" ? `${formatNumber(Number(row.pm_real ?? row.pm_venta ?? 0), 3)} EUR/kg` : formatKg(Number(row.kilos ?? 0))}
                                </TableCell>
                                <TableCell><SparklineCell data={spark.points} maxKilos={spark.maxKilos} /></TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="productos" className="space-y-5">
          {selectedProducto ? (
            <div className="space-y-4">
              <Button variant="outline" size="sm" onClick={() => setSelectedProducto(null)}>
                ← Volver al ranking
              </Button>
              <VentasCategoriaProductoDetail
                metodo={selectedProducto}
                descripcion={selectedProductoDesc}
                allLines={allLines}
              />
            </div>
          ) : (
            <>
              <ChartCard title="Productos catalogo por mes">
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={productMonthlyChart} margin={MARGIN}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="mes" {...XAXIS} />
                    <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                    <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                    <Legend wrapperStyle={legendStyle} />
                    {catalogo.map((producto, index) => (
                      <Bar key={producto.metodo} dataKey={producto.metodo} stackId="kg" name={producto.metodo} fill={SERIES_PALETTE[index % SERIES_PALETTE.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <section className="grid gap-5 xl:grid-cols-2">
                <DataTable title="Productos catalogo" headers={["Metodo", "Descripcion", "Kilos", "PM", "Clientes"]}>
                  {catalogo.map((row) => (
                    <TableRow
                      key={String(row.id)}
                      className="cursor-pointer hover:bg-[var(--glass-bg-strong)]"
                      onClick={() => { setSelectedProducto(String(row.metodo)); setSelectedProductoDesc(String(row.descripcion ?? "")); }}
                    >
                      <TableCell className="font-semibold">{String(row.metodo)}</TableCell>
                      <TableCell>{String(row.descripcion ?? "")}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(Number(row.kilos))}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(Number(row.base_iva) / Math.max(Number(row.kilos), 1), 3)} EUR/kg</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(filterOptions.metodos.length)}</TableCell>
                    </TableRow>
                  ))}
                </DataTable>
                <DataTable title="Validacion catalogo vs lineas" headers={["Metodo", "Kg catalogo", "Kg lineas", "Dif.", "Estado"]}>
                  {validacion.map((row) => {
                    const diff = Number(row.diferencia_kilos ?? 0);
                    return (
                      <TableRow key={row.metodo ?? "sin"}>
                        <TableCell className="font-semibold">{row.metodo}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(row.kilos_catalogo)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(row.kilos_lineas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(diff)}</TableCell>
                        <TableCell>{Math.abs(diff) < 0.01 ? <OkBadge /> : <WarnBadge />}</TableCell>
                      </TableRow>
                    );
                  })}
                </DataTable>
              </section>
              <ChartCard title="Comparativa de precio medio por producto">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={productMonthlyChart} margin={MARGIN}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="mes" {...XAXIS} />
                    <YAxis {...YAXIS} tickFormatter={(v) => `${formatNumber(Number(v), 2)} EUR`} />
                    <Tooltip cursor={CHART_LINE_CURSOR} content={<GlassTooltip formatter={(v) => `${formatNumber(Number(v), 3)} EUR/kg`} />} />
                    <Legend wrapperStyle={legendStyle} />
                    {catalogo.map((producto, index) => (
                      <Line key={String(producto.metodo)} type="monotone" dataKey={String(producto.metodo)} name={String(producto.metodo)} stroke={SERIES_PALETTE[index % SERIES_PALETTE.length]} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </>
          )}
        </TabsContent>

        <TabsContent value="articulos" className="space-y-5">
          {selectedArticulo ? (
            <div className="space-y-4">
              <Button variant="outline" size="sm" onClick={() => setSelectedArticulo(null)}>
                ← Volver al listado
              </Button>
              <VentasCategoriaArticuloDetail
                articulo={selectedArticulo}
                referencia={selectedArticuloRef}
                allLines={allLines}
              />
            </div>
          ) : (
            (() => {
              const searchTerm = articuloSearch.toLowerCase();
              const filtered = searchTerm
                ? displayArticulos.filter((row: Record<string, unknown>) =>
                    String(row.articulo ?? "").toLowerCase().includes(searchTerm)
                  )
                : displayArticulos;
              const grouped = new Map<string, { referencia: string; articulos: Array<Record<string, unknown>>; totalKilos: number; totalPm: number }>();
              filtered.forEach((row: Record<string, unknown>) => {
                const ref = String(row.referencia ?? "SIN REF");
                if (!grouped.has(ref)) grouped.set(ref, { referencia: ref, articulos: [], totalKilos: 0, totalPm: 0 });
                const group = grouped.get(ref)!;
                group.articulos.push(row);
                group.totalKilos += Number(row.kilos ?? 0);
                group.totalPm += Number(row.base_iva ?? 0);
              });
              const sortedGroups = Array.from(grouped.values()).sort((a, b) => b.totalKilos - a.totalKilos);
              const totalArticulos = filtered.length;
              const totalRefs = sortedGroups.length;
              const totalKilos = sortedGroups.reduce((s, g) => s + g.totalKilos, 0);
              const totalBase = sortedGroups.reduce((s, g) => s + g.totalPm, 0);
              const pmMedio = totalKilos > 0 ? totalBase / totalKilos : 0;
              const limited = sortedGroups.slice(0, articuloLimit);
              const hasMore = sortedGroups.length > articuloLimit;
              return (
                <div className="space-y-4">
                  <section className="grid gap-3 md:grid-cols-4">
                    <Kpi title="Articulos" value={formatNumber(totalArticulos)} />
                    <Kpi title="Referencias" value={formatNumber(totalRefs)} />
                    <Kpi title="Kilos total" value={formatKg(totalKilos)} />
                    <Kpi title="PM medio" value={`${formatNumber(pmMedio, 3)} EUR/kg`} />
                  </section>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Buscar articulo..."
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
                            className="cursor-pointer py-3 px-4 hover:bg-[var(--glass-bg-strong)]"
                            onClick={() => {
                              const next = new Set(expandedRefs);
                              if (expanded) next.delete(group.referencia);
                              else next.add(group.referencia);
                              setExpandedRefs(next);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                {group.referencia}
                              </CardTitle>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                                <span>{group.articulos.length} articulos</span>
                                <span>{formatKg(group.totalKilos)}</span>
                              </div>
                            </div>
                          </CardHeader>
                          {expanded && (
                            <CardContent className="p-0">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Articulo</TableHead>
                                    <TableHead className="text-right">Kilos</TableHead>
                                    <TableHead className="text-right">PM</TableHead>
                                    <TableHead className="text-right">Lineas</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {group.articulos.sort((a, b) => Number(b.kilos ?? 0) - Number(a.kilos ?? 0)).map((row) => (
                                    <TableRow
                                      key={`${row.referencia}-${row.articulo}`}
                                      className="cursor-pointer hover:bg-[var(--glass-bg-strong)]"
                                      onClick={() => { setSelectedArticulo(String(row.articulo)); setSelectedArticuloRef(String(row.referencia ?? "")); }}
                                    >
                                      <TableCell className="min-w-[320px] font-medium">{String(row.articulo)}</TableCell>
                                      <TableCell className="text-right tabular-nums">{formatKg(Number(row.kilos))}</TableCell>
                                      <TableCell className="text-right tabular-nums">{formatNumber(Number(row.pm_bruto ?? row.pm_venta ?? 0), 3)} EUR/kg</TableCell>
                                      <TableCell className="text-right tabular-nums">{formatNumber(Number(row.lineas))}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
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
            })()
          )}
        </TabsContent>

        <TabsContent value="base" className="space-y-5">
          <DailyGroupTable lines={filteredLines} pageSize={5} />
        </TabsContent>

        <TabsContent value="importar" className="space-y-5">
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
                  <Kpi title="Kilos catalogo" value={formatKg(parsedImport.validation.kilosCatalogo)} />
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

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <Card className="glass-accented">
      <CardContent className="p-3 sm:p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="mt-1 break-words text-xl font-bold leading-tight tabular-nums sm:text-2xl">{value}</p>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="px-4 pb-2 pt-4 sm:px-6"><CardTitle className="text-base sm:text-lg">{title}</CardTitle></CardHeader>
      <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6"><div className={CHART_PANEL_CLASS}>{children}</div></CardContent>
    </Card>
  );
}

function DeltaBadge({ value, formatter }: { value: number | null; formatter: (value: number) => string }) {
  if (value == null) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  const positive = value > 0;
  const negative = value < 0;
  const tone = positive
    ? "bg-success/10 text-success"
    : negative
      ? "bg-destructive/10 text-destructive"
      : "bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex justify-end rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>
      {positive ? "+" : ""}
      {formatter(value)}
    </span>
  );
}

function DataTable({ title, description, headers, children }: { title: string; description?: string; headers: string[]; children: React.ReactNode }) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="px-4 py-4 sm:px-6">
        <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[620px] overflow-auto px-1 pb-1">
          <Table>
            <TableHeader>
              <TableRow>{headers.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>{children}</TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function RankingTable({ title, rows, valueKey, valueLabel, formatter }: {
  title: string;
  rows: Array<Record<string, unknown>>;
  valueKey: string;
  valueLabel: string;
  formatter: (value: number) => string;
}) {
  return (
    <DataTable title={title} headers={["Cliente", valueLabel, "PM bruto", "PM real"]}>
      {rows.map((row) => (
        <TableRow key={String(row.cliente_codigo)}>
          <TableCell className="min-w-[260px]">
            <div className="font-medium">{String(row.cliente_nombre ?? "")}</div>
            <div className="text-xs text-muted-foreground">{String(row.cliente_codigo ?? "")}</div>
          </TableCell>
          <TableCell className="text-right tabular-nums">{formatter(Number(row[valueKey] ?? 0))}</TableCell>
          <TableCell className="text-right tabular-nums">{formatNumber(Number(row.pm_bruto ?? row.pm_venta ?? 0), 3)} EUR/kg</TableCell>
          <TableCell className="text-right tabular-nums">{formatNumber(Number(row.pm_real ?? row.pm_venta ?? 0), 3)} EUR/kg</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function AjusteTableRow({ cliente, ajuste, onSave }: {
  cliente: Record<string, unknown>;
  ajuste?: Record<string, unknown>;
  onSave: (input: VentasCategoriaAjusteInput) => void;
}) {
  const [values, setValues] = useState({
    comision_pct: Number(ajuste?.comision_pct ?? 0),
    comision_cent_kg: Number(ajuste?.comision_cent_kg ?? 0),
    transporte_pct: Number(ajuste?.transporte_pct ?? 0),
    transporte_cent_kg: Number(ajuste?.transporte_cent_kg ?? 0),
  });

  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: Number(value) || 0 }));

  return (
    <TableRow>
      <TableCell className="min-w-[260px]">
        <div className="font-medium">{String(cliente.cliente_nombre ?? "")}</div>
        <div className="text-xs text-muted-foreground">{String(cliente.cliente_codigo ?? "")}</div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatKg(Number(cliente.kilos ?? 0))}</TableCell>
      <TableCell><Input type="number" value={values.comision_pct} onChange={(e) => set("comision_pct", e.target.value)} /></TableCell>
      <TableCell><Input type="number" value={values.comision_cent_kg} onChange={(e) => set("comision_cent_kg", e.target.value)} /></TableCell>
      <TableCell><Input type="number" value={values.transporte_pct} onChange={(e) => set("transporte_pct", e.target.value)} /></TableCell>
      <TableCell><Input type="number" value={values.transporte_cent_kg} onChange={(e) => set("transporte_cent_kg", e.target.value)} /></TableCell>
      <TableCell>
        <Button size="icon" variant="outline" onClick={() => onSave({
          cliente_codigo: String(cliente.cliente_codigo ?? ""),
          cliente_nombre: String(cliente.cliente_nombre ?? ""),
          ...values,
        })}>
          <Save className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function OkBadge() {
  return <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success"><CheckCircle2 className="h-3 w-3" /> OK</Badge>;
}

function WarnBadge() {
  return <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-warning"><AlertTriangle className="h-3 w-3" /> Revisar</Badge>;
}

function pivotMonthlyProducts(rows: Array<Record<string, unknown>>, methods: string[]) {
  const map = new Map<string, Record<string, number | string>>();
  rows.forEach((row) => {
    const mes = String(row.mes ?? "");
    const metodo = String(row.metodo_producto ?? "Sin clasificar");
    if (!mes) return;
    const current = map.get(mes) ?? { mes };
    if (methods.includes(metodo)) current[metodo] = Number(row.kilos ?? 0);
    map.set(mes, current);
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
