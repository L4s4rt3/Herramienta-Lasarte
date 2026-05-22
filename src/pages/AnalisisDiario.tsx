import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, Calendar, AlertTriangle, Search, RefreshCw, FileText, BarChart3, FilterX,
} from "lucide-react";
import { useAnalisisDiario } from "@/hooks/useAnalisisDiario";
import type { LoteResumen, ClaseResumen, GrupoClasificacionResumen } from "@/hooks/useAnalisisDiario";
import { today } from "@/lib/format";

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

type Periodo = "7d" | "30d" | "90d" | "custom";

export default function AnalisisDiario() {
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [customDesde, setCustomDesde] = useState(daysAgo(30));
  const [customHasta, setCustomHasta] = useState(today());
  const [search, setSearch] = useState("");

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

  const { data, loading, refetch } = useAnalisisDiario(desde, hasta);

  const hayDatos = data.totals.n_lotes > 0 || data.totals.kg_calibres > 0;

  const searchLower = search.toLowerCase().trim();

  const filteredClases = useMemo(() => {
    if (!searchLower) return data.clases;
    return data.clases.filter((c) =>
      c.clase.toLowerCase().includes(searchLower) ||
      Object.keys(c.grupos).some((g) => g.toLowerCase().includes(searchLower))
    );
  }, [data.clases, searchLower]);

  const filteredGrupos = useMemo(() => {
    if (!searchLower) return data.grupos;
    return data.grupos.filter((g) =>
      g.grupo.toLowerCase().includes(searchLower)
    );
  }, [data.grupos, searchLower]);

  const filteredLotes = useMemo(() => {
    if (!searchLower) return data.lotes;
    return data.lotes.filter((l) =>
      l.productor.toLowerCase().includes(searchLower) ||
      l.producto.toLowerCase().includes(searchLower) ||
      l.lote_codigo.toLowerCase().includes(searchLower)
    );
  }, [data.lotes, searchLower]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Análisis Diario</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Clasificación por categoría y grupo de destino · {formatFechaLarga(desde)} — {formatFechaLarga(hasta)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

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

        {hayDatos && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar clase, grupo, productor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-64 h-8"
            />
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando datos…</span>
        </div>
      )}

      {!loading && hayDatos && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiMini icon={<Calendar className="size-4" />} label="Días" value={data.totals.n_dias} />
          <KpiMini icon={<Calendar className="size-4" />} label="Clases" value={data.clases.length} sub={formatKg(data.totals.kg_calibres)} />
          <KpiMini icon={<Calendar className="size-4" />} label="Grupos" value={data.grupos.length} />
          <KpiMini icon={<Calendar className="size-4" />} label="Lotes" value={data.totals.n_lotes} sub={formatKg(data.totals.kg_lotes)} />
        </div>
      )}

      {!loading && !hayDatos && (
        <Card className="border-muted-foreground/20 bg-muted/30">
          <CardContent className="py-12 text-center">
            <BarChart3 className="size-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-lg">No hay datos de detalle para este periodo</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
              Para ver datos aquí necesitas subir el informe de tamaños/calibres al parte y pulsar "Analizar".
            </p>
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

      {!loading && hayDatos && (
        <Tabs defaultValue="clase" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="clase">
              Clase <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredClases.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="grupo">
              Grupo <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredGrupos.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="lotes">
              Lotes <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredLotes.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clase">
            <TabClases data={filteredClases} totalKg={data.totals.kg_calibres} />
          </TabsContent>
          <TabsContent value="grupo">
            <TabGrupos data={filteredGrupos} totalKg={data.totals.kg_calibres} />
          </TabsContent>
          <TabsContent value="lotes">
            <TabLotes data={filteredLotes} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

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

// ─── Tab: Clase ──────────────────────────────────────────────────────────────

const GRUPO_COLOR: Record<string, string> = {
  Exportación: "text-green-600",
  Mujeres: "text-blue-500",
  "No exportación": "text-amber-500",
  "No comercial": "text-red-500",
  Mercado: "text-blue-600",
  Otro: "text-muted-foreground",
};

function TabClases({ data, totalKg }: { data: ClaseResumen[]; totalKg: number }) {
  if (data.length === 0) return <EmptyTab msg="Sin resultados" />;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Clases / Categorías ({data.length})</CardTitle>
        <CardDescription>Agrupado por categoría del informe de calibres · Kg total: {formatKg(totalKg)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clase</TableHead>
                <TableHead className="text-right">Kg total</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Registros</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead>Distribución por grupo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => {
                const pct = totalKg > 0 ? (c.kg_total / totalKg) * 100 : 0;
                const gruposOrdenados = Object.entries(c.grupos).sort((a, b) => b[1] - a[1]);
                return (
                  <TableRow key={c.clase}>
                    <TableCell className="font-medium">{c.clase}</TableCell>
                    <TableCell className="text-right font-mono">{formatKg(c.kg_total)}</TableCell>
                    <TableCell className="text-right font-mono">{pct.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{c.n_registros}</TableCell>
                    <TableCell className="text-right">{c.n_dias}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {gruposOrdenados.map(([g, kg]) => (
                          <Badge key={g} variant="outline" className={`text-xs ${GRUPO_COLOR[g] ?? ""}`}>
                            {g}: {formatKg(kg)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Grupo ──────────────────────────────────────────────────────────────

function TabGrupos({ data, totalKg }: { data: GrupoClasificacionResumen[]; totalKg: number }) {
  if (data.length === 0) return <EmptyTab msg="Sin resultados" />;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Grupos de clasificación ({data.length})</CardTitle>
        <CardDescription>Agrupado por destino/grupo del informe de calibres</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grupo</TableHead>
                <TableHead className="text-right">Kg total</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Registros</TableHead>
                <TableHead className="text-right">Días</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((g) => {
                const pct = totalKg > 0 ? (g.kg_total / totalKg) * 100 : 0;
                return (
                  <TableRow key={g.grupo}>
                    <TableCell className={`font-medium ${GRUPO_COLOR[g.grupo] ?? ""}`}>{g.grupo}</TableCell>
                    <TableCell className="text-right font-mono">{formatKg(g.kg_total)}</TableCell>
                    <TableCell className="text-right font-mono">{pct.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{g.n_registros}</TableCell>
                    <TableCell className="text-right">{g.n_dias}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Lotes ──────────────────────────────────────────────────────────────

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

function EmptyTab({ msg }: { msg: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <FilterX className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{msg}</p>
      </CardContent>
    </Card>
  );
}
