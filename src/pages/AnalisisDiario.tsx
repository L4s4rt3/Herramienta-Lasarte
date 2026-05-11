/**
 * AnalisisDiario.tsx — Página /analisis/diario
 *
 * Muestra datos detallados de las tablas lotes_dia, palets_dia, producto_dia
 * con contexto temporal claro (fecha por fila, días activos, etc.)
 */
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Users, Package, Boxes, UserCheck, Calendar, AlertTriangle } from "lucide-react";
import { useAnalisisDiario } from "@/hooks/useAnalisisDiario";
import type {
  ProveedorResumen,
  LoteResumen,
  ProductoResumen,
  ClienteResumen,
} from "@/hooks/useAnalisisDiario";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatKg(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + " t";
  return v.toFixed(0) + " kg";
}

function formatFecha(iso: string): string {
  if (!iso || iso === "—") return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function formatFechaLarga(iso: string): string {
  if (!iso || iso === "—") return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

type Periodo = "7d" | "30d" | "90d" | "custom";

// ─── Componente principal ───────────────────────────────────────────────────

export default function AnalisisDiario() {
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [customDesde, setCustomDesde] = useState(daysAgo(30));
  const [customHasta, setCustomHasta] = useState(today());

  const desde = useMemo(() => {
    if (periodo === "7d") return daysAgo(7);
    if (periodo === "30d") return daysAgo(30);
    if (periodo === "90d") return daysAgo(90);
    return customDesde;
  }, [periodo, customDesde]);

  const hasta = useMemo(() => {
    if (periodo === "custom") return customHasta;
    return today();
  }, [periodo, customHasta]);

  const { data, loading } = useAnalisisDiario(desde, hasta);

  const hayDatos = data.totals.n_lotes > 0 || data.totals.n_palets > 0 || data.totals.kg_producto > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Análisis Diario</h1>
          <p className="text-muted-foreground text-sm">
            Datos extraídos de los partes analizados ({formatFechaLarga(desde)} — {formatFechaLarga(hasta)})
          </p>
        </div>

        {/* Filtro de periodo */}
        <div className="flex items-center gap-2 flex-wrap">
          {(["7d", "30d", "90d", "custom"] as Periodo[]).map((p) => (
            <Button
              key={p}
              variant={periodo === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriodo(p)}
            >
              {p === "7d" ? "7 días" : p === "30d" ? "30 días" : p === "90d" ? "90 días" : "Rango"}
            </Button>
          ))}
        </div>
      </div>

      {/* Custom date inputs */}
      {periodo === "custom" && (
        <div className="flex gap-3 items-center">
          <Input
            type="date"
            value={customDesde}
            onChange={(e) => setCustomDesde(e.target.value)}
            className="w-40"
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="date"
            value={customHasta}
            onChange={(e) => setCustomHasta(e.target.value)}
            className="w-40"
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando datos…</span>
        </div>
      )}

      {/* KPI summary cards */}
      {!loading && hayDatos && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KpiMini icon={<Calendar className="size-4" />} label="Días con datos" value={data.totals.n_dias} />
          <KpiMini icon={<Users className="size-4" />} label="Proveedores" value={data.totals.n_proveedores} sub={formatKg(data.totals.kg_lotes)} />
          <KpiMini icon={<Boxes className="size-4" />} label="Lotes" value={data.totals.n_lotes} />
          <KpiMini icon={<Package className="size-4" />} label="Palets" value={data.totals.n_palets} sub={formatKg(data.totals.kg_palets)} />
          <KpiMini icon={<UserCheck className="size-4" />} label="Clientes" value={data.totals.n_clientes} />
        </div>
      )}

      {/* Empty state */}
      {!loading && !hayDatos && (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="size-8 mx-auto text-amber-500 mb-3" />
            <p className="font-medium">No hay datos de detalle para este periodo</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              Los datos aparecen cuando analizas un parte con archivos Excel.
              El modelo IA extrae lotes, palets y productos automáticamente.
              Prueba a analizar un parte reciente desde la lista de Partes.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      {!loading && hayDatos && (
        <Tabs defaultValue="proveedores" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="proveedores">
              Proveedores {data.proveedores.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{data.proveedores.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="lotes">
              Lotes {data.lotes.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{data.lotes.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="productos">
              Productos {data.productos.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{data.productos.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="clientes">
              Clientes {data.clientes.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{data.clientes.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proveedores">
            <TabProveedores data={data.proveedores} />
          </TabsContent>

          <TabsContent value="lotes">
            <TabLotes data={data.lotes} />
          </TabsContent>

          <TabsContent value="productos">
            <TabProductos data={data.productos} />
          </TabsContent>

          <TabsContent value="clientes">
            <TabClientes data={data.clientes} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─── KPI mini card ──────────────────────────────────────────────────────────

function KpiMini({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4 px-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary">{icon}</div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}{sub ? ` · ${sub}` : ""}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Proveedores ───────────────────────────────────────────────────────

function TabProveedores({ data }: { data: ProveedorResumen[] }) {
  if (data.length === 0) return <EmptyTab msg="Sin datos de proveedores — se extraen del informe de producción" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Proveedores ({data.length})</CardTitle>
        <CardDescription>Agrupado desde lotes de producción. Fuente: informe_produccion.xlsx</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Productor</TableHead>
              <TableHead className="text-right">Kg total</TableHead>
              <TableHead className="text-right">Lotes</TableHead>
              <TableHead className="text-right">Días</TableHead>
              <TableHead className="text-right">T/h avg</TableHead>
              <TableHead className="text-right">Peso fruta</TableHead>
              <TableHead>Últimas fechas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((p) => (
              <TableRow key={p.productor}>
                <TableCell className="font-medium">{p.productor}</TableCell>
                <TableCell className="text-right font-mono">{formatKg(p.kg_total)}</TableCell>
                <TableCell className="text-right">{p.n_lotes}</TableCell>
                <TableCell className="text-right">{p.n_dias}</TableCell>
                <TableCell className="text-right">
                  {p.tph_avg !== null ? p.tph_avg.toFixed(1) + " T/h" : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {p.peso_fruta_avg_g !== null ? p.peso_fruta_avg_g.toFixed(0) + " g" : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {p.fechas.slice(-3).map(formatFecha).join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Lotes ─────────────────────────────────────────────────────────────

function TabLotes({ data }: { data: LoteResumen[] }) {
  if (data.length === 0) return <EmptyTab msg="Sin datos de lotes — se extraen del informe de producción" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lotes ({data.length})</CardTitle>
        <CardDescription>Detalle por lote individual. Ordenados por fecha (más reciente primero)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Productor</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Kg</TableHead>
                <TableHead className="text-right">T/h</TableHead>
                <TableHead className="text-right">Duración</TableHead>
                <TableHead className="text-right">Peso fruta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((l, i) => (
                <TableRow key={`${l.fecha}-${l.lote_codigo}-${i}`}>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-mono">{formatFecha(l.fecha)}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.lote_codigo}</TableCell>
                  <TableCell className="font-medium">{l.productor}</TableCell>
                  <TableCell>{l.producto}</TableCell>
                  <TableCell className="text-right font-mono">{formatKg(l.kg_peso_total)}</TableCell>
                  <TableCell className="text-right">
                    {l.toneladas_hora !== null ? l.toneladas_hora.toFixed(1) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {l.duracion_min !== null ? `${l.duracion_min}'` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {l.peso_fruta_promedio_g !== null ? `${l.peso_fruta_promedio_g.toFixed(0)}g` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Productos ─────────────────────────────────────────────────────────

function TabProductos({ data }: { data: ProductoResumen[] }) {
  if (data.length === 0) return <EmptyTab msg="Sin datos de productos — se extraen del informe de producto/tamaños" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Productos ({data.length})</CardTitle>
        <CardDescription>Agrupado por producto. Fuente: informe_producto.xlsx / informe_tamanos.xlsx</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Kg total</TableHead>
              <TableHead className="text-right">Líneas</TableHead>
              <TableHead className="text-right">Días</TableHead>
              <TableHead>Destino</TableHead>
              <TableHead>Formatos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((p) => (
              <TableRow key={p.producto}>
                <TableCell className="font-medium">{p.producto}</TableCell>
                <TableCell className="text-right font-mono">{formatKg(p.kg_total)}</TableCell>
                <TableCell className="text-right">{p.n_lineas}</TableCell>
                <TableCell className="text-right">{p.n_dias}</TableCell>
                <TableCell>
                  {p.grupo_destino ? (
                    <Badge variant="secondary" className="text-xs">{p.grupo_destino}</Badge>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {p.formatos.length > 0 ? p.formatos.join(", ") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Clientes ──────────────────────────────────────────────────────────

function TabClientes({ data }: { data: ClienteResumen[] }) {
  if (data.length === 0) return <EmptyTab msg="Sin datos de clientes — se extraen del informe de palets/GStock" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Clientes ({data.length})</CardTitle>
        <CardDescription>Agrupado por cliente. Fuente: palets.xlsx / GSTOCK.xlsx</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead className="text-right">Palets</TableHead>
              <TableHead className="text-right">Kg total</TableHead>
              <TableHead className="text-right">Días</TableHead>
              <TableHead>Productos</TableHead>
              <TableHead>Destinos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c) => (
              <TableRow key={c.cliente}>
                <TableCell className="font-medium">{c.cliente}</TableCell>
                <TableCell className="text-right">{c.n_palets}</TableCell>
                <TableCell className="text-right font-mono">{formatKg(c.kg_total)}</TableCell>
                <TableCell className="text-right">{c.n_dias}</TableCell>
                <TableCell className="text-xs">
                  {c.productos.length > 0 ? c.productos.slice(0, 3).join(", ") + (c.productos.length > 3 ? ` (+${c.productos.length - 3})` : "") : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {c.destinos.length > 0 ? c.destinos.join(", ") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyTab({ msg }: { msg: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground">
        <p>{msg}</p>
        <p className="text-xs mt-1">Analiza partes con los Excel correspondientes para que aparezcan aquí.</p>
      </CardContent>
    </Card>
  );
}
