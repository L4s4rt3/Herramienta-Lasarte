import { useMemo, useState, type ChangeEvent } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Database, FileSpreadsheet, Save, Search, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useVentasCategoria, useVentasCategoriaDetalle, type VentasCategoriaAjusteInput } from "@/hooks/useVentasCategoria";
import { parseVentasCategoriaExcelFile } from "@/lib/ventasCategoriaExcel";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKg, formatNumber } from "@/lib/format";
import {
  BAR_STYLE, C, CHART_LINE_CURSOR, CHART_PANEL_CLASS, GlassTooltip, GRID, legendStyle, lineStyle, MARGIN, SERIES_PALETTE, XAXIS, YAXIS,
} from "@/lib/chartTheme";
import type { ParseVentasCategoriaWorkbookResult } from "@/lib/ventasCategoria";

const PAGE_SIZE = 100;
const EMPTY_ROWS: never[] = [];
const ALL_FILTER_VALUE = "__all__";
const EMPTY_FILTER_OPTIONS = { lineas: 0, campanas: [], meses: [], clientes: [], metodos: [] };

export default function VentasCategoriaSegunda() {
  const ventas = useVentasCategoria();
  const [tab, setTab] = useState("dashboard");
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ campana: "", mes: "", cliente: "", metodo: "", articulo: "" });
  const [parsedImport, setParsedImport] = useState<ParseVentasCategoriaWorkbookResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const detalle = useVentasCategoriaDetalle(ventas.categoriaId, {
    filters,
    page,
    pageSize: PAGE_SIZE,
    enabled: tab === "base",
  });

  const resumen = ventas.resumenQuery.data;
  const rankingClientes = ventas.rankingClientesQuery.data ?? EMPTY_ROWS;
  const mensualCliente = ventas.mensualClienteQuery.data ?? EMPTY_ROWS;
  const mensualProducto = ventas.mensualProductoQuery.data ?? EMPTY_ROWS;
  const articulos = ventas.articulosQuery.data ?? EMPTY_ROWS;
  const catalogo = ventas.catalogoQuery.data ?? EMPTY_ROWS;
  const ajustes = ventas.ajustesQuery.data ?? EMPTY_ROWS;
  const validacion = ventas.validacionQuery.data ?? EMPTY_ROWS;
  const filterOptions = ventas.filterOptionsQuery.data ?? EMPTY_FILTER_OPTIONS;

  const monthlyTotals = useMemo(() => {
    const map = new Map<string, { mes: string; kilos: number; base: number; pm: number }>();
    mensualProducto.forEach((row) => {
      const mes = String(row.mes ?? "");
      if (!mes) return;
      const current = map.get(mes) ?? { mes, kilos: 0, base: 0, pm: 0 };
      current.kilos += Number(row.kilos ?? 0);
      current.base += Number(row.base_iva ?? 0);
      current.pm = current.kilos > 0 ? current.base / current.kilos : 0;
      map.set(mes, current);
    });
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [mensualProducto]);

  const topClientes = rankingClientes.slice(0, 10);
  const topArticulos = articulos.slice(0, 25);
  const productMonthlyChart = useMemo(() => pivotMonthlyProducts(mensualProducto, catalogo.map((row) => row.metodo)), [catalogo, mensualProducto]);
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const hasImportedData = Number(resumen?.kilos ?? 0) > 0;
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
            <Kpi title="Kilos total" value={formatKg(resumen?.kilos)} />
            <Kpi title="Base IVA" value={`${formatNumber(resumen?.base_iva, 2)} EUR`} />
            <Kpi title="PM bruto" value={`${formatNumber(resumen?.pm_bruto, 3)} EUR/kg`} />
            <Kpi title="PM real" value={`${formatNumber(resumen?.pm_real, 3)} EUR/kg`} />
            <Kpi title="Clientes" value={formatNumber(resumen?.clientes)} />
            <Kpi title="Productos" value={formatNumber(resumen?.productos)} />
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
          <section className="grid gap-5 xl:grid-cols-2">
            <RankingTable title="Ranking por kilos" rows={rankingClientes.slice(0, 20)} valueKey="kilos" valueLabel="Kilos" formatter={(v) => formatKg(v)} />
            <RankingTable title="Ranking por PM real" rows={[...rankingClientes].sort((a, b) => Number(b.pm_real ?? 0) - Number(a.pm_real ?? 0)).slice(0, 20)} valueKey="pm_real" valueLabel="PM real" formatter={(v) => `${formatNumber(v, 3)} EUR/kg`} />
          </section>

          <Card className="glass-accented overflow-hidden">
            <CardHeader>
              <CardTitle>Ajustes de comision y transporte</CardTitle>
            </CardHeader>
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
                    {rankingClientes.slice(0, 80).map((cliente) => (
                      <AjusteTableRow
                        key={cliente.cliente_codigo}
                        cliente={cliente}
                        ajuste={ajustes.find((row) => row.cliente_codigo === cliente.cliente_codigo)}
                        onSave={(input) => ventas.updateAjuste.mutate(input)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="productos" className="space-y-5">
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
            <DataTable title="Productos catalogo" headers={["Metodo", "Descripcion", "Kilos", "PM", "Base IVA"]}>
              {catalogo.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-semibold">{row.metodo}</TableCell>
                  <TableCell>{row.descripcion}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKg(row.kilos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.base_iva / Math.max(row.kilos, 1), 3)} EUR/kg</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.base_iva, 2)} EUR</TableCell>
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
        </TabsContent>

        <TabsContent value="articulos" className="space-y-5">
          <ChartCard title="Top 25 articulos exactos por kg">
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={topArticulos.map((row) => ({ ...row, nombre: shortName(row.articulo ?? "", 34) }))} layout="vertical" margin={{ ...MARGIN, left: 150 }}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" {...XAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <YAxis type="category" dataKey="nombre" width={160} {...YAXIS} />
                <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                <Bar dataKey="kilos" name="Kilos" fill={C.warning} stroke={C.warning} {...BAR_STYLE} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <DataTable title={`Todos los articulos exactos (${formatNumber(articulos.length)})`} headers={["Referencia", "Articulo", "Kilos", "PM bruto", "Lineas"]}>
            {articulos.map((row) => (
              <TableRow key={`${row.referencia}-${row.articulo}`}>
                <TableCell>{row.referencia}</TableCell>
                <TableCell className="min-w-[360px] font-medium">{row.articulo}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKg(row.kilos)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.pm_bruto, 3)} EUR/kg</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.lineas)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </TabsContent>

        <TabsContent value="base" className="space-y-5">
          <Card className="glass-accented">
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-lg">Filtros de base diaria</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {activeFilters > 0
                      ? `${activeFilters} filtro${activeFilters === 1 ? "" : "s"} activo${activeFilters === 1 ? "" : "s"}`
                      : "Vista completa paginada, sin cargar todo el detalle en pantalla."}
                  </p>
                </div>
                <Button variant="outline" className="gap-2" disabled={activeFilters === 0} onClick={clearFilters}>
                  <Search className="h-4 w-4" />
                  Limpiar filtros
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 pt-2 md:grid-cols-2 xl:grid-cols-5">
              <SelectFilter
                label="Campana"
                value={filters.campana}
                options={filterOptions.campanas.map((value) => ({ value, label: value }))}
                placeholder="Todas"
                onChange={(value) => setFilter("campana", value)}
              />
              <SelectFilter
                label="Mes"
                value={filters.mes}
                options={filterOptions.meses.map((value) => ({ value, label: value }))}
                placeholder="Todos"
                onChange={(value) => setFilter("mes", value)}
              />
              <SelectFilter
                label="Cliente"
                value={filters.cliente}
                options={filterOptions.clientes.map((cliente) => ({
                  value: cliente.codigo,
                  label: `${cliente.nombre} - ${cliente.codigo}`,
                }))}
                placeholder="Todos"
                onChange={(value) => setFilter("cliente", value)}
              />
              <SelectFilter
                label="Metodo"
                value={filters.metodo}
                options={filterOptions.metodos.map((value) => ({ value, label: value }))}
                placeholder="Todos"
                onChange={(value) => setFilter("metodo", value)}
              />
              <FilterInput
                label="Articulo"
                value={filters.articulo}
                onChange={(value) => setFilter("articulo", value)}
                placeholder="Buscar texto"
              />
            </CardContent>
          </Card>

          <DataTable
            title={`Base diaria (${formatNumber(detalle.data?.count ?? 0)} lineas filtradas)`}
            description={`Pagina ${page + 1} - ${formatNumber(detalle.data?.rows.length ?? 0)} lineas visibles`}
            headers={["Fecha", "Campana", "Cliente", "Articulo", "Metodo", "Kilos", "PM", "Base"]}
          >
            {(detalle.data?.rows ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">{formatDate(`${row.fecha}T12:00:00`)}</TableCell>
                <TableCell>{row.campana}</TableCell>
                <TableCell className="min-w-[220px]">
                  <div className="font-medium">{row.cliente_nombre}</div>
                  <div className="text-xs text-muted-foreground">{row.cliente_codigo}</div>
                </TableCell>
                <TableCell className="min-w-[320px]">{row.articulo}</TableCell>
                <TableCell>{row.metodo_producto ?? "Sin clasificar"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKg(row.kilos)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.pm_venta, 3)} EUR/kg</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.base_iva, 2)} EUR</TableCell>
              </TableRow>
            ))}
            {!detalle.isLoading && (detalle.data?.rows.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-28 text-center text-sm text-muted-foreground">
                  No hay lineas con estos filtros.
                </TableCell>
              </TableRow>
            ) : null}
          </DataTable>
          <div className="flex items-center justify-between rounded-lg border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
            <span className="text-sm text-muted-foreground">Pagina {page + 1}</span>
            <Button variant="outline" disabled={(detalle.data?.rows.length ?? 0) < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
          </div>
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
          <TableCell className="text-right tabular-nums">{formatNumber(Number(row.pm_bruto ?? 0), 3)} EUR/kg</TableCell>
          <TableCell className="text-right tabular-nums">{formatNumber(Number(row.pm_real ?? 0), 3)} EUR/kg</TableCell>
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

function FilterInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

function SelectFilter({ label, value, options, placeholder, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Select value={value || ALL_FILTER_VALUE} onValueChange={(nextValue) => onChange(nextValue === ALL_FILTER_VALUE ? "" : nextValue)}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FILTER_VALUE}>{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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
