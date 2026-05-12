/**
 * AnalisisDiario.tsx — Página /analisis/diario
 *
 * Muestra datos detallados de lotes_dia, palets_dia, producto_dia
 * con filtros por periodo, búsqueda por texto, y contexto temporal.
 */
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, Users, Package, Boxes, UserCheck, Calendar,
  AlertTriangle, Search, RefreshCw, FileText,
} from "lucide-react";
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
  const [, m, d] = iso.split("-");
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

const todayStr = () => new Date().toISOString().slice(0, 10);

type Periodo = "7d" | "30d" | "90d" | "custom";

// ─── Componente principal ───────────────────────────────────────────────────

export default function AnalisisDiario() {
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [customDesde, setCustomDesde] = useState(daysAgo(30));
  const [customHasta, setCustomHasta] = useState(todayStr());
  const [search, setSearch] = useState("");

  const desde = useMemo(() => {
    if (periodo === "7d") return daysAgo(7);
    if (periodo === "30d") return daysAgo(30);
    if (periodo === "90d") return daysAgo(90);
    return customDesde;
  }, [periodo, customDesde]);

  const hasta = useMemo(() => {
    if (periodo === "custom") return customHasta;
    return todayStr();
  }, [periodo, customHasta]);

  const { data, loading, refetch } = useAnalisisDiario(desde, hasta);

  const hayDatos = data.totals.n_lotes > 0 || data.totals.n_palets > 0 || data.totals.kg_producto > 0;

  // Filtro de búsqueda global (aplica a todas las tabs)
  const searchLower = search.toLowerCase().trim();

  const filteredProveedores = useMemo(() => {
    if (!searchLower) return data.proveedores;
    return data.proveedores.filter((p) => p.productor.toLowerCase().includes(searchLower));
  }, [data.proveedores, searchLower]);

  const filteredLotes = useMemo(() => {
    if (!searchLower) return data.lotes;
    return data.lotes.filter((l) =>
      l.productor.toLowerCase().includes(searchLower) ||
      l.producto.toLowerCase().includes(searchLower) ||
      l.lote_codigo.toLowerCase().includes(searchLower)
    );
  }, [data.lotes, searchLower]);

  const filteredProductos = useMemo(() => {
    if (!searchLower) return data.productos;
    return data.productos.filter((p) =>
      p.producto.toLowerCase().includes(searchLower) ||
      (p.grupo_destino ?? "").toLowerCase().includes(searchLower)
    );
  }, [data.productos, searchLower]);

  const filteredClientes = useMemo(() => {
    if (!searchLower) return data.clientes;
    return data.clientes.filter((c) =>
      c.cliente.toLowerCase().includes(searchLower) ||
      c.productos.some((p) => p.toLowerCase().includes(searchLower))
    );
  }, [data.clientes, searchLower]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Análisis Diario</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Datos extraídos por IA de los partes analizados · {formatFechaLarga(desde)} — {formatFechaLarga(hasta)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Filtros: periodo + búsqueda */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between flex-wrap">
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
          {periodo === "custom" && (
            <>
              <Input
                type="date"
                value={customDesde}
                onChange={(e) => setCustomDesde(e.target.value)}
                className="w-36 h-8"
              />
              <span className="text-muted-foreground text-xs">—</span>
              <Input
                type="date"
                value={customHasta}
                onChange={(e) => setCustomHasta(e.target.value)}
                className="w-36 h-8"
              />
            </>
          )}
        </div>

        {/* Búsqueda */}
        {hayDatos && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar productor, producto, cliente…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-64 h-8"
            />
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando datos…</span>
        </div>
      )}

      {/* KPI summary */}
      {!loading && hayDatos && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiMini icon={<Calendar className="size-4" />} label="Días" value={data.totals.n_dias} />
          <KpiMini icon={<Users className="size-4" />} label="Proveedores" value={data.totals.n_proveedores} sub={formatKg(data.totals.kg_lotes)} />
          <KpiMini icon={<Boxes className="size-4" />} label="Lotes" value={data.totals.n_lotes} />
          <KpiMini icon={<Package className="size-4" />} label="Palets" value={data.totals.n_palets} sub={formatKg(data.totals.kg_palets)} />
          <KpiMini icon={<UserCheck className="size-4" />} label="Clientes" value={data.totals.n_clientes} />
        </div>
      )}

      {/* Empty state mejorado */}
      {!loading && !hayDatos && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-10 text-center">
            <AlertTriangle className="size-10 mx-auto text-amber-500 mb-4" />
            <p className="font-semibold text-lg">No hay datos de detalle para este periodo</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
              Esta página muestra datos que se extraen automáticamente cuando analizas un parte.
              Para que aparezcan datos aquí necesitas:
            </p>
            <ol className="text-sm text-muted-foreground mt-3 max-w-md mx-auto text-left space-y-1.5 list-decimal list-inside">
              <li>Subir los archivos Excel al parte (producción, palets, tamaños)</li>
              <li>Pulsar <strong>"Analizar"</strong> en el detalle del parte</li>
              <li>La IA extraerá lotes, palets, productos y calibres</li>
            </ol>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button asChild>
                <Link to="/partes"><FileText className="h-4 w-4" /> Ir a Partes</Link>
              </Button>
              <Button variant="outline" onClick={() => setPeriodo("90d")}>
                Ampliar a 90 días
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      {!loading && hayDatos && (
        <Tabs defaultValue="proveedores" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="proveedores">
              Proveedores <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredProveedores.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="lotes">
              Lotes <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredLotes.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="productos">
              Productos <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredProductos.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="clientes">
              Clientes <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredClientes.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proveedores"><TabProveedores data={filteredProveedores} /></TabsContent>
          <TabsContent value="lotes"><TabLotes data={filteredLotes} /></TabsContent>
          <TabsContent value="productos"><TabProductos data={filteredProductos} /></TabsContent>
          <TabsContent value="clientes"><TabClientes data={filteredClientes} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─── KPI mini card ──────────────────────────────────────────────────────────

function KpiMini({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-3 px-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary">{icon}</div>
        <div>
          <p className="text-xl font-bold tabular-nums">{value}</p>
          <p className="text-[11px] text-muted-foreground">{label}{sub ? ` · ${sub}` : ""}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Proveedores ───────────────────────────────────────────────────────

function TabProveedores({ data }: { data: ProveedorResumen[] }) {
  if (data.length === 0) return <EmptyTab msg="Sin resultados" />;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Proveedores ({data.length})</CardTitle>
        <CardDescription>Fuente: informe de producción · Agrupado por nombre de productor</CardDescription>
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
                <TableCell className="text-right">{p.tph_avg !== null ? p.tph_avg.toFixed(1) + " T/h" : "—"}</TableCell>
                <TableCell className="text-right">{p.peso_fruta_avg_g !== null ? p.peso_fruta_avg_g.toFixed(0) + " g" : "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.fechas.slice(-3).map(formatFecha).join(", ")}</TableCell>
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
  if (data.length === 0) return <EmptyTab msg="Sin resultados" />;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Lotes ({data.length})</CardTitle>
        <CardDescription>Ordenados por fecha descendente · Fuente: informe de producción</CardDescription>
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
                <TableHead className="text-right">Min</TableHead>
                <TableHead className="text-right">Peso fruta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((l, i) => (
                <TableRow key={`${l.fecha}-${l.lote_codigo}-${i}`}>
                  <TableCell><Badge variant="outline" className="text-xs font-mono">{formatFecha(l.fecha)}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{l.lote_codigo}</TableCell>
                  <TableCell className="font-medium">{l.productor}</TableCell>
                  <TableCell>{l.producto}</TableCell>
                  <TableCell className="text-right font-mono">{formatKg(l.kg_peso_total)}</TableCell>
                  <TableCell className="text-right">{l.toneladas_hora !== null ? l.toneladas_hora.toFixed(1) : "—"}</TableCell>
                  <TableCell className="text-right">{l.duracion_min !== null ? l.duracion_min : "—"}</TableCell>
                  <TableCell className="text-right">{l.peso_fruta_promedio_g !== null ? `${l.peso_fruta_promedio_g.toFixed(0)}g` : "—"}</TableCell>
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
  if (data.length === 0) return <EmptyTab msg="Sin resultados" />;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Productos ({data.length})</CardTitle>
        <CardDescription>Fuente: informe de producto / tamaños · Agrupado por nombre</CardDescription>
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
                <TableCell>{p.grupo_destino ? <Badge variant="secondary" className="text-xs">{p.grupo_destino}</Badge> : "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.formatos.length > 0 ? p.formatos.join(", ") : "—"}</TableCell>
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
  if (data.length === 0) return <EmptyTab msg="Sin resultados" />;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Clientes ({data.length})</CardTitle>
        <CardDescription>Fuente: palets.xlsx / GSTOCK.xlsx · Agrupado por nombre de cliente</CardDescription>
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
                <TableCell className="text-xs">{c.productos.length > 0 ? c.productos.slice(0, 3).join(", ") + (c.productos.length > 3 ? ` (+${c.productos.length - 3})` : "") : "—"}</TableCell>
                <TableCell className="text-xs">{c.destinos.length > 0 ? c.destinos.join(", ") : "—"}</TableCell>
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
      </CardContent>
    </Card>
  );
}
