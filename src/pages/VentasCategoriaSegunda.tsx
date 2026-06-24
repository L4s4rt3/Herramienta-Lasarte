import { useMemo, useState, type ChangeEvent } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Database, FileSpreadsheet, Save, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useVentasCategoria, type VentasCategoriaAjusteInput } from "@/hooks/useVentasCategoria";
import { parseVentasCategoriaExcelFile } from "@/lib/ventasCategoriaExcel";
import { VentasCategoriaFilterBar } from "@/components/VentasCategoriaFilterBar";
import { applyVentasCategoriaFilters, aggregateVentasCategoria } from "@/lib/ventasCategoria";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKg, formatNumber } from "@/lib/format";
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
  const [rankingTab, setRankingTab] = useState("kilos");

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
    <div className="container mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
      <header className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 shadow-[var(--glass-shadow)] backdrop-blur-xl md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="panel-kicker">Comercial</p>
              <Badge variant={hasImportedData ? "outline" : "destructive"} className="rounded-md">
                {hasImportedData ? "Base cargada" : "Sin datos"}
              </Badge>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">Categoria segunda</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Ventas por cliente, producto, articulo, precio medio y ajustes reales de comision/transporte.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex">
              <Input className="hidden" type="file" accept=".xlsx,.xls" onChange={handleImportFile} />
              <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent">
                <Upload className="h-4 w-4" />
                {parsing ? "Leyendo..." : "Importar Excel"}
              </span>
            </label>
            <Badge variant="outline" className="h-10 rounded-md px-3">
              {ventas.categoria?.nombre ?? "Sin categoria"}
            </Badge>
          </div>
        </div>
        <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatusItem label="Lineas base" value={formatNumber(filterOptions.lineas)} loading={ventas.filterOptionsQuery.isLoading} />
          <StatusItem label="Campanas" value={formatNumber(filterOptions.campanas.length)} loading={ventas.filterOptionsQuery.isLoading} />
          <StatusItem label="Clientes" value={formatNumber(filterOptions.clientes.length || resumen?.clientes)} loading={ventas.filterOptionsQuery.isLoading} />
          <StatusItem label="Metodos" value={formatNumber(filterOptions.metodos.length || resumen?.productos)} loading={ventas.filterOptionsQuery.isLoading} />
          <StatusItem label="Total categoria" value={catalogoIsValid(validacion) ? "Cuadra" : "Revisar"} tone={catalogoIsValid(validacion) ? "ok" : "warn"} />
        </section>
      </header>

      <VentasCategoriaFilterBar
        filters={filters}
        filterOptions={filterOptions}
        onChange={setFilter}
        onClear={clearFilters}
        activeCount={activeFilters}
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg p-1 sm:grid-cols-3 xl:w-auto xl:grid-cols-6">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="productos">Productos</TabsTrigger>
          <TabsTrigger value="articulos">Articulos</TabsTrigger>
          <TabsTrigger value="base">Base diaria</TabsTrigger>
          <TabsTrigger value="importar">Importar</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-5">
          <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Kpi title="Kilos total" value={formatKg(displayResumen?.kilos)} />
            <Kpi title="Base IVA" value={`${formatNumber(displayResumen?.base_iva, 2)} EUR`} />
            <Kpi title="PM bruto" value={`${formatNumber(displayResumen?.pm_venta ?? displayResumen?.pm_bruto, 3)} EUR/kg`} />
            <Kpi title="PM real" value={`${formatNumber(displayResumen?.pm_real ?? displayResumen?.pm_venta, 3)} EUR/kg`} />
            <Kpi title="Clientes" value={formatNumber(displayResumen?.clientes)} />
            <Kpi title="Productos" value={formatNumber(displayResumen?.productos)} />
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
              <Card className="glass-accented overflow-hidden">
                <CardHeader className="pb-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Ranking de clientes</CardTitle>
                    <div className="flex rounded-lg border border-[var(--glass-border)] p-0.5">
                      <button
                        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${rankingTab === "kilos" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => setRankingTab("kilos")}
                      >
                        Ranking por kilos
                      </button>
                      <button
                        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${rankingTab === "pm" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => setRankingTab("pm")}
                      >
                        Ranking por PM real
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="text-right">{rankingTab === "kilos" ? "Kilos" : "PM real"}</TableHead>
                          <TableHead className="text-right">{rankingTab === "kilos" ? "PM" : "Kilos"}</TableHead>
                          <TableHead className="text-right">Evolucion</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(rankingTab === "kilos" ? displayRanking : [...displayRanking].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
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
                                {rankingTab === "kilos" ? formatKg(Number(row.kilos ?? 0)) : `${formatNumber(Number(row.pm_real ?? row.pm_venta ?? 0), 3)} EUR/kg`}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {rankingTab === "kilos" ? `${formatNumber(Number(row.pm_real ?? row.pm_venta ?? 0), 3)} EUR/kg` : formatKg(Number(row.kilos ?? 0))}
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
              <Card className="glass-accented overflow-hidden">
                <CardHeader><CardTitle>Ajustes de comision y transporte</CardTitle></CardHeader>
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
              const grouped = new Map<string, { referencia: string; articulos: Array<Record<string, unknown>>; totalKilos: number }>();
              displayArticulos.forEach((row: Record<string, unknown>) => {
                const ref = String(row.referencia ?? "SIN REF");
                if (!grouped.has(ref)) grouped.set(ref, { referencia: ref, articulos: [], totalKilos: 0 });
                const group = grouped.get(ref)!;
                group.articulos.push(row);
                group.totalKilos += Number(row.kilos ?? 0);
              });
              return (
                <div className="space-y-3">
                  {Array.from(grouped.values()).sort((a, b) => b.totalKilos - a.totalKilos).map((group) => (
                    <Card key={group.referencia} className="glass-accented overflow-hidden">
                      <CardHeader className="py-3 px-4">
                        <CardTitle className="text-sm font-semibold">
                          {group.referencia} ({group.articulos.length} articulos | {formatKg(group.totalKilos)})
                        </CardTitle>
                      </CardHeader>
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
                    </Card>
                  ))}
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
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function StatusItem({ label, value, loading = false, tone = "neutral" }: { label: string; value: string; loading?: boolean; tone?: "neutral" | "ok" | "warn" }) {
  const toneClass = tone === "ok"
    ? "text-success"
    : tone === "warn"
      ? "text-warning"
      : "text-foreground";

  return (
    <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${toneClass}`}>{loading ? "..." : value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="glass-accented">
      <CardHeader className="pb-2"><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent><div className={CHART_PANEL_CLASS}>{children}</div></CardContent>
    </Card>
  );
}

function DataTable({ title, description, headers, children }: { title: string; description?: string; headers: string[]; children: React.ReactNode }) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[620px] overflow-auto">
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

function catalogoIsValid(rows: Array<Record<string, unknown>>) {
  const diferenciaTotal = rows.reduce((total, row) => total + Number(row.diferencia_kilos ?? 0), 0);
  return rows.length > 0 && Math.abs(diferenciaTotal) < 0.01;
}

function shortName(value: string, max = 22) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
