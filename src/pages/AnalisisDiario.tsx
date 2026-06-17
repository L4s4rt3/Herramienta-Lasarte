import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, Calendar, Search, RefreshCw, FileText, BarChart3, FilterX,
  Gauge, PackageCheck, Timer, AlertCircle,
} from "lucide-react";
import { useAnalisisDiario } from "@/hooks/useAnalisisDiario";
import type { LoteResumen, ClaseResumen, GrupoClasificacionResumen } from "@/hooks/useAnalisisDiario";
import { shouldShowProductionEvolution } from "@/lib/analisisDiarioView";
import { today } from "@/lib/format";
import { KPICard } from "@/components/KPICard";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  GlassTooltip, C, GRID, XAXIS, YAXIS, MARGIN,
  CHART_CURSOR, CHART_PANEL_CLASS, activeDotStyle, areaStops, dotStyle,
} from "@/lib/chartTheme";

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

function formatHoras(min: number): string {
  if (!min) return "—";
  return `${(min / 60).toFixed(1)} h`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

type Periodo = "7d" | "30d" | "90d" | "custom";

export default function AnalisisDiario() {
  const [searchParams] = useSearchParams();
  const queryDesde = searchParams.get("desde");
  const queryHasta = searchParams.get("hasta");
  const hasQueryRange = Boolean(queryDesde && queryHasta);
  const [periodo, setPeriodo] = useState<Periodo>(() => (hasQueryRange ? "custom" : "30d"));
  const [customDesde, setCustomDesde] = useState(() => queryDesde ?? daysAgo(30));
  const [customHasta, setCustomHasta] = useState(() => queryHasta ?? today());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!queryDesde || !queryHasta) return;
    setPeriodo("custom");
    setCustomDesde(queryDesde);
    setCustomHasta(queryHasta);
  }, [queryDesde, queryHasta]);

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

  const { data, loading, error, refetch } = useAnalisisDiario(desde, hasta);

  const hayDatos = data.totals.n_lotes > 0 || data.totals.kg_calibres > 0;

  const searchLower = normalizeText(search).trim();

  const filteredClases = useMemo(() => {
    if (!searchLower) return data.clases;
    return data.clases.filter((c) =>
      normalizeText(c.clase).includes(searchLower) ||
      Object.keys(c.grupos).some((g) => normalizeText(g).includes(searchLower))
    );
  }, [data.clases, searchLower]);

  const filteredGrupos = useMemo(() => {
    if (!searchLower) return data.grupos;
    return data.grupos.filter((g) =>
      normalizeText(g.grupo).includes(searchLower)
    );
  }, [data.grupos, searchLower]);

  const filteredLotes = useMemo(() => {
    if (!searchLower) return data.lotes;
    return data.lotes.filter((l) =>
      normalizeText(l.productor).includes(searchLower) ||
      normalizeText(l.producto).includes(searchLower) ||
      normalizeText(l.lote_codigo).includes(searchLower) ||
      normalizeText(l.fecha).includes(searchLower)
    );
  }, [data.lotes, searchLower]);

  const searchHits = useMemo(() => {
    if (!searchLower) return null;
    return {
      lotes: filteredLotes,
      clases: filteredClases,
      grupos: filteredGrupos,
      total: filteredLotes.length + filteredClases.length + filteredGrupos.length,
    };
  }, [searchLower, filteredLotes, filteredClases, filteredGrupos]);

  const dailyTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of data.lotes) {
      const day = l.fecha.slice(5);
      map.set(day, (map.get(day) ?? 0) + l.kg_peso_total);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, kg]) => ({ date, kg }));
  }, [data.lotes]);
  const showProductionEvolution = shouldShowProductionEvolution(dailyTrend);
  const singleDayProduction = dailyTrend[0] ?? null;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Análisis Diario</h1>
          <p className="page-subtitle">
            Ritmo de producción, lotes y clasificación · {formatFechaLarga(desde)} — {formatFechaLarga(hasta)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading} className="glass glass-hover">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <div className="section-toolbar glass">
        <div className="flex items-center gap-2 flex-wrap">
          {(["7d", "30d", "90d", "custom"] as Periodo[]).map((p) => (
            <Button
              key={p}
              variant={periodo === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriodo(p)}
              className="glass glass-hover"
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

      {!loading && error && (
        <Card className="glass-accented border-destructive/30">
          <CardContent className="flex items-center gap-3 py-6 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Error al cargar los datos</p>
              <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={refetch} className="ml-auto glass glass-hover">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reintentar
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && hayDatos && searchHits && (
        <SearchResults query={search} hits={searchHits} />
      )}

      {!loading && hayDatos && (
        <>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard label="Días analizados" value={String(data.totals.n_dias)} icon={Calendar} />
          <KPICard
            label="Kg en lotes"
            value={formatKg(data.totals.kg_lotes)}
            hint={`${data.totals.n_lotes} lotes`}
            icon={PackageCheck}
          />
          <KPICard
            label="Velocidad media"
            value={data.totals.avg_tph ? `${data.totals.avg_tph.toFixed(1)} T/h` : "—"}
            icon={Gauge}
            trend={data.totals.avg_tph ? (data.totals.avg_tph >= 16 ? "up" : "down") : "neutral"}
          />
          <KPICard
            label="Lotes lentos"
            value={String(data.totals.n_lotes_lentos)}
            hint={`${formatHoras(data.totals.total_min)} total`}
            icon={Timer}
            trend={data.totals.n_lotes_lentos <= 3 ? "up" : "down"}
          />
        </section>

        {showProductionEvolution && (
          <Card className="glass-accented overflow-hidden">
            <CardHeader className="pb-3 px-5 pt-4">
              <div className="flex items-center gap-3">
                <div className="h-7 w-1 rounded-full bg-primary" />
                <div>
                  <CardTitle className="text-lg font-semibold">Evolución producción</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">Kg totales por día en el período</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-1">
              <div className={CHART_PANEL_CLASS}>
              <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyTrend} margin={MARGIN}>
                {areaStops("analisisTrendFill", C.primary)}
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...XAXIS} />
                <YAxis {...YAXIS} tickFormatter={(v) => `${(v / 1000).toFixed(0)}t`} width={36} />
                  <Tooltip cursor={CHART_CURSOR} content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const items = [{ name: "Producción", value: formatKg(payload[0].value as number), color: "hsl(var(--primary))" }];
                    return <GlassTooltip active label={label} payload={items} />;
                  }} />
                  <Area type="monotone" dataKey="kg" stroke={C.primary} strokeWidth={2.5} fill="url(#analisisTrendFill)" dot={dotStyle(C.primary)} activeDot={activeDotStyle(C.primary)} />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
        {!showProductionEvolution && singleDayProduction && (
          <SingleDayProductionSummary
            point={singleDayProduction}
            nLotes={data.totals.n_lotes}
            avgTph={data.totals.avg_tph}
            kgCalibres={data.totals.kg_calibres}
          />
        )}
      </>
      )}

      {!loading && !hayDatos && (
        <Card className="glass-accented">
          <CardContent className="py-12 text-center">
            <BarChart3 className="size-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-lg">No hay datos de detalle para este periodo</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
              Para ver datos aquí necesitas subir el informe de tamaños/calibres al parte y pulsar "Analizar".
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button asChild className="glass glass-hover">
                <Link to="/partes"><FileText className="h-4 w-4" /> Ir a Partes</Link>
              </Button>
              <Button variant="outline" onClick={() => setPeriodo("90d")} className="glass glass-hover">
                Ampliar a 90 días
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && hayDatos && (
        <Tabs defaultValue="lotes" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="lotes">
              Lotes <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredLotes.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="clase">
              Clase <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredClases.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="grupo">
              Grupo <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredGrupos.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="lotes">
            <TabLotes data={filteredLotes} />
          </TabsContent>
          <TabsContent value="clase">
            <TabClases data={filteredClases} totalKg={data.totals.kg_calibres} />
          </TabsContent>
          <TabsContent value="grupo">
            <TabGrupos data={filteredGrupos} totalKg={data.totals.kg_calibres} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─── Tab: Clase ──────────────────────────────────────────────────────────────

const GRUPO_COLOR: Record<string, string> = {
  Exportación: "text-success",
  Mujeres: "text-info",
  "No exportación": "text-warning",
  "No comercial": "text-destructive",
  Mercado: "text-info",
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

function SingleDayProductionSummary({
  point,
  nLotes,
  avgTph,
  kgCalibres,
}: {
  point: { date: string; kg: number };
  nLotes: number;
  avgTph: number | null;
  kgCalibres: number;
}) {
  return (
    <Card className="glass-accented">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 rounded-full bg-primary" />
          <div>
            <CardTitle className="text-lg font-semibold">Resumen del parte</CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Vista de un solo dia: sin grafica de evolucion
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{point.date}</p>
          </div>
          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Produccion</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatKg(point.kg)}</p>
          </div>
          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lotes</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{nLotes}</p>
          </div>
          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Velocidad</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{avgTph ? `${avgTph.toFixed(1)} T/h` : "—"}</p>
          </div>
        </div>
        {kgCalibres > 0 && (
          <div className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-4 py-3 text-sm">
            <span className="text-muted-foreground">Kg con clasificacion: </span>
            <span className="font-semibold tabular-nums">{formatKg(kgCalibres)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SearchResults({
  query,
  hits,
}: {
  query: string;
  hits: {
    lotes: LoteResumen[];
    clases: ClaseResumen[];
    grupos: GrupoClasificacionResumen[];
    total: number;
  };
}) {
  return (
    <Card className="glass-accented">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="panel-kicker">Resultados de busqueda</p>
            <CardTitle className="text-base">
              {hits.total > 0 ? `${hits.total} coincidencia(s) para "${query}"` : `Sin coincidencias para "${query}"`}
            </CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{hits.lotes.length} lotes</Badge>
            <Badge variant="secondary">{hits.clases.length} clases</Badge>
            <Badge variant="secondary">{hits.grupos.length} grupos</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lotes</p>
          {hits.lotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin lotes coincidentes</p>
          ) : (
            <div className="space-y-2">
              {hits.lotes.slice(0, 6).map((l, i) => (
                <div key={`${l.fecha}-${l.lote_codigo}-${i}`} className="rounded-xl bg-[var(--glass-bg-strong)] px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs">{l.lote_codigo}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">{formatKg(l.kg_peso_total)}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{formatFecha(l.fecha)} · {l.productor} · {l.producto}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Clases</p>
          {hits.clases.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin clases coincidentes</p>
          ) : (
            <div className="space-y-2">
              {hits.clases.slice(0, 6).map((c) => (
                <div key={c.clase} className="rounded-xl bg-[var(--glass-bg-strong)] px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{c.clase}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">{formatKg(c.kg_total)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.n_registros} registros · {c.n_dias} dias</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Grupos</p>
          {hits.grupos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin grupos coincidentes</p>
          ) : (
            <div className="space-y-2">
              {hits.grupos.slice(0, 6).map((g) => (
                <div key={g.grupo} className="rounded-xl bg-[var(--glass-bg-strong)] px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`font-medium ${GRUPO_COLOR[g.grupo] ?? ""}`}>{g.grupo}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">{formatKg(g.kg_total)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{g.n_registros} registros · {g.n_dias} dias</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
