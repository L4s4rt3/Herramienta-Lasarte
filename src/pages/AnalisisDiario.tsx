// src/pages/AnalisisDiario.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, RefreshCw, FileText, BarChart3, ChevronDown, ChevronLeft, ArrowRight,
  AlertCircle, X, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAnalisisDiario, buildProductoresResumen,
  buildClasesYGruposDesdeClasificacion, buildCalibresDesdeClasificacion,
} from "@/hooks/useAnalisisDiario";
import type { LoteResumen, ProductorResumen } from "@/hooks/useAnalisisDiario";
import { DailyListTable } from "@/components/DailyListTable";
import { MiniKpi } from "@/components/MiniKpi";
import { AutoWeekFallbackNotice } from "@/components/AutoWeekFallbackNotice";
import { LoteDetailSheet } from "@/components/LoteDetailSheet";
import { WeekSelector } from "@/components/WeekSelector";
import { AnalisisCalibres } from "@/components/AnalisisCalibres";
import { AnalisisProductores } from "@/components/AnalisisProductores";
import { buildWeekRange } from "@/lib/analisisDiarioView";
import type { Periodo } from "@/lib/analisisDiarioView";
import { formatKgCompact as formatKg, today, toISODateLocal } from "@/lib/format";
import { GRUPO_COLORS } from "@/lib/destinoClasificacion";
import {
  C, GRID, XAXIS, YAXIS, MARGIN, barFill, activeDotStyle, GlassTooltip, CHART_PANEL_CLASS,
} from "@/lib/chartTheme";

function formatFechaLarga(iso: string): string {
  if (!iso || iso === "—") return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODateLocal(d);
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const VALID_TABS = ["resumen", "lotes", "calibres", "destino", "productores"] as const;
type TabValue = (typeof VALID_TABS)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (VALID_TABS as readonly string[]).includes(v);
}

export default function AnalisisDiario() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryDesde = searchParams.get("desde");
  const queryHasta = searchParams.get("hasta");
  // ?productor= permite llegar desde el dossier de Productores con el filtro puesto.
  const queryProductor = searchParams.get("productor");
  const hasQueryRange = Boolean(queryDesde && queryHasta);
  const [periodo, setPeriodo] = useState<Periodo>(() => (hasQueryRange ? "custom" : "esta_semana"));
  const [customDesde, setCustomDesde] = useState(() => queryDesde ?? daysAgo(30));
  const [customHasta, setCustomHasta] = useState(() => queryHasta ?? today());
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [productorFiltro, setProductorFiltro] = useState<string>(() => queryProductor ?? "todos");
  const [productoFiltro, setProductoFiltro] = useState<string>(() => searchParams.get("producto") ?? "todos");
  const [activeTab, setActiveTab] = useState<TabValue>(() => {
    const t = searchParams.get("tab");
    return isTabValue(t) ? t : "resumen";
  });
  const [selectedLote, setSelectedLote] = useState<LoteResumen | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!queryDesde || !queryHasta) return;
    setPeriodo("custom");
    setCustomDesde(queryDesde);
    setCustomHasta(queryHasta);
  }, [queryDesde, queryHasta]);

  useEffect(() => {
    if (queryProductor) setProductorFiltro(queryProductor);
  }, [queryProductor]);

  // Los filtros viven también en la URL (compartir enlaces y no perder el
  // estado con atrás/adelante). Solo se escriben cuando difieren, para no
  // entrar en bucle con los efectos que leen searchParams.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string, defecto: string) => {
      if (value && value !== defecto) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete("productor", productorFiltro, "todos");
    setOrDelete("producto", productoFiltro, "todos");
    setOrDelete("q", search, "");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [productorFiltro, productoFiltro, search, searchParams, setSearchParams]);

  const handleTabChange = (v: string) => {
    if (!isTabValue(v)) return;
    setActiveTab(v);
    const next = new URLSearchParams(searchParams);
    next.set("tab", v);
    setSearchParams(next, { replace: true });
  };

  const weekRange = useMemo(
    () => buildWeekRange(periodo, customDesde, customHasta),
    [periodo, customDesde, customHasta]
  );

  const { data, loading, error, refetch } = useAnalisisDiario(weekRange.start, weekRange.end);

  const hayDatos = data.totals.n_lotes > 0 || data.totals.kg_calibres > 0;

  const handleNavigateWeek = (direction: -1 | 1) => {
    const start = new Date(weekRange.start + "T12:00:00");
    start.setDate(start.getDate() + direction * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    setCustomDesde(start.toISOString().slice(0, 10));
    setCustomHasta(end.toISOString().slice(0, 10));
    setPeriodo("custom");
  };

  // ─── Fallback automático a la semana anterior (solo en la carga inicial) ──
  // Si "esta_semana" está vacía y el usuario no ha navegado/filtrado todavía ni
  // llegó con un rango fijado por URL, saltamos una única vez a la semana
  // anterior (enfoque optimista: si también está vacía, se ve el empty state
  // normal con el aviso encima).
  const autoFallbackTried = useRef(false);
  const [autoFallbackActive, setAutoFallbackActive] = useState(false);
  const manualNavRef = useRef(false);

  useEffect(() => {
    if (loading || autoFallbackTried.current || manualNavRef.current) return;
    if (hasQueryRange || periodo !== "esta_semana") return;
    autoFallbackTried.current = true;
    if (!hayDatos) {
      handleNavigateWeek(-1);
      setAutoFallbackActive(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasQueryRange, periodo, hayDatos]);

  function handleGoToCurrentWeek() {
    manualNavRef.current = true;
    setAutoFallbackActive(false);
    setPeriodo("esta_semana");
  }

  function handleManualPeriodoChange(p: Periodo) {
    manualNavRef.current = true;
    setAutoFallbackActive(false);
    setPeriodo(p);
  }

  function handleManualNavigateWeek(direction: -1 | 1) {
    manualNavRef.current = true;
    setAutoFallbackActive(false);
    handleNavigateWeek(direction);
  }

  const searchLower = normalizeText(search).trim();

  // Opciones de productor/producto derivadas de los lotes del rango. El valor
  // filtrado actual se incluye siempre aunque no exista en el rango (p.ej. al
  // llegar por URL desde el dossier): así el select no se queda en blanco.
  const productorOptions = useMemo(() => {
    const set = new Set(data.lotes.map((l) => l.productor).filter((p) => p && p !== "—"));
    if (productorFiltro !== "todos") set.add(productorFiltro);
    return Array.from(set).sort();
  }, [data.lotes, productorFiltro]);
  const productoOptions = useMemo(() => {
    const set = new Set(data.lotes.map((l) => l.producto).filter((p) => p && p !== "—"));
    if (productoFiltro !== "todos") set.add(productoFiltro);
    return Array.from(set).sort();
  }, [data.lotes, productoFiltro]);

  const hayFiltrosActivos = Boolean(searchLower) || productorFiltro !== "todos" || productoFiltro !== "todos";

  const filteredLotes = useMemo(() => {
    return data.lotes.filter((l) => {
      if (productorFiltro !== "todos" && l.productor !== productorFiltro) return false;
      if (productoFiltro !== "todos" && l.producto !== productoFiltro) return false;
      if (!searchLower) return true;
      return (
        normalizeText(l.productor).includes(searchLower) ||
        normalizeText(l.producto).includes(searchLower) ||
        normalizeText(l.lote_codigo).includes(searchLower) ||
        normalizeText(l.fecha).includes(searchLower)
      );
    });
  }, [data.lotes, searchLower, productorFiltro, productoFiltro]);

  const handleClearFiltros = () => {
    setSearch("");
    setProductorFiltro("todos");
    setProductoFiltro("todos");
  };

  // Lotes y Productores siempre se recalculan desde los lotes filtrados.
  const productoresFiltrados = useMemo(
    () => buildProductoresResumen(filteredLotes),
    [filteredLotes]
  );
  const kgFiltrado = useMemo(
    () => filteredLotes.reduce((s, l) => s + l.kg_peso_total, 0),
    [filteredLotes]
  );

  // Calibres, Clase y Grupo: sin filtro usan calibres_dia (más completo); con
  // filtro se recalculan desde lote_clasificacion filtrado por los mismos criterios.
  const filteredClasificacionRows = useMemo(() => {
    if (!hayFiltrosActivos) return data.clasificacionRows;
    return data.clasificacionRows.filter((r) => {
      if (productorFiltro !== "todos" && r.productor !== productorFiltro) return false;
      if (productoFiltro !== "todos" && r.producto !== productoFiltro) return false;
      if (!searchLower) return true;
      return (
        normalizeText(r.productor).includes(searchLower) ||
        normalizeText(r.producto).includes(searchLower) ||
        normalizeText(r.lote_codigo).includes(searchLower) ||
        normalizeText(r.fecha ?? "").includes(searchLower)
      );
    });
  }, [data.clasificacionRows, hayFiltrosActivos, searchLower, productorFiltro, productoFiltro]);

  const { clases: clasesMostradas, grupos: gruposMostrados } = useMemo(() => {
    if (!hayFiltrosActivos) return { clases: data.clases, grupos: data.grupos };
    return buildClasesYGruposDesdeClasificacion(filteredClasificacionRows);
  }, [hayFiltrosActivos, data.clases, data.grupos, filteredClasificacionRows]);

  const calibresMostrados = useMemo(() => {
    if (!hayFiltrosActivos) return data.calibres;
    return buildCalibresDesdeClasificacion(filteredClasificacionRows);
  }, [hayFiltrosActivos, data.calibres, filteredClasificacionRows]);

  const kgClasificadosMostrado = useMemo(() => {
    if (!hayFiltrosActivos) return data.totals.kg_calibres;
    return filteredClasificacionRows.reduce((s, r) => s + r.peso_kg, 0);
  }, [hayFiltrosActivos, data.totals.kg_calibres, filteredClasificacionRows]);

  const handleLoteClick = (lote: LoteResumen) => {
    setSelectedLote(lote);
    setSheetOpen(true);
  };

  // KPIs de cabecera: reflejan los lotes filtrados (si hay filtros activos).
  const kgLotesMostrado = hayFiltrosActivos ? kgFiltrado : data.totals.kg_lotes;
  const kgIndustriaMostrado = hayFiltrosActivos
    ? filteredLotes.reduce((s, l) => s + (l.kg_industria ?? 0), 0)
    : data.totals.kg_industria;
  const lotesConTphMostrado = filteredLotes.filter((l) => l.toneladas_hora !== null && l.toneladas_hora > 0);
  const totalMinMostrado = lotesConTphMostrado.reduce((s, l) => s + (l.duracion_min ?? 0), 0);
  const totalHorasMostrado = hayFiltrosActivos ? totalMinMostrado / 60 : data.totals.total_horas;
  const avgTphMostrado = hayFiltrosActivos
    ? (() => {
        const minTph = lotesConTphMostrado.reduce((s, l) => s + (l.duracion_min ?? 0), 0);
        if (lotesConTphMostrado.length === 0) return null;
        return minTph > 0
          ? lotesConTphMostrado.reduce((s, l) => s + (l.toneladas_hora ?? 0) * (l.duracion_min ?? 1), 0) / minTph
          : lotesConTphMostrado.reduce((s, l) => s + (l.toneladas_hora ?? 0), 0) / lotesConTphMostrado.length;
      })()
    : data.totals.avg_tph;

  const pctIndustria = kgLotesMostrado > 0
    ? (kgIndustriaMostrado / kgLotesMostrado) * 100
    : 0;

  const nDiasMostrado = hayFiltrosActivos
    ? new Set(filteredLotes.map((l) => l.fecha).filter((f) => f && f !== "—")).size
    : data.totals.n_dias;

  return (
    <div className="page-shell">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Análisis diario</h1>
          <p className="page-subtitle">
            {formatFechaLarga(weekRange.start)} — {formatFechaLarga(weekRange.end)}
            {!loading && hayDatos && <> · {data.totals.n_dias} día{data.totals.n_dias === 1 ? "" : "s"} con datos</>}
          </p>
        </div>
        <Button variant="outline" size="sm" className="glass glass-hover" onClick={() => refetch()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </header>

      {/* ─── Loading ────────────────────────────────────────────── */}
      {loading && (
        <>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full sm:w-72" />
          <Skeleton className="h-96" />
        </>
      )}

      {/* ─── Error ──────────────────────────────────────────────── */}
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

      {/* ─── Toolbar única sticky: periodo + búsqueda + filtros ────
           Siempre visible tras cargar (incluso sin datos) para poder
           navegar a una semana anterior que sí tenga información. ── */}
      {!loading && !error && (
        <div className="sticky top-[calc(3.5rem+1rem)] z-10 glass-overlay rounded-xl p-3 space-y-3 sm:top-[calc(4rem+1.25rem)]">
          <div className="flex flex-wrap items-center gap-2.5">
            <WeekSelector
              periodo={periodo}
              onPeriodoChange={handleManualPeriodoChange}
              customDesde={customDesde}
              customHasta={customHasta}
              onCustomDesdeChange={setCustomDesde}
              onCustomHastaChange={setCustomHasta}
              onNavigateWeek={handleManualNavigateWeek}
              canNavigateNext={weekRange.end < today()}
            />
          </div>
          {hayDatos && (
            <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--glass-border)] pt-3">
              <div className="relative w-full sm:w-auto">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar productor, producto, lote, fecha..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-full sm:w-64 h-9"
                />
              </div>
              <Select value={productorFiltro} onValueChange={setProductorFiltro}>
                <SelectTrigger className="h-9 w-full sm:w-48">
                  <SelectValue placeholder="Productor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los productores</SelectItem>
                  {productorOptions.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={productoFiltro} onValueChange={setProductoFiltro}>
                <SelectTrigger className="h-9 w-full sm:w-48">
                  <SelectValue placeholder="Producto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los productos</SelectItem>
                  {productoOptions.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hayFiltrosActivos && (
                <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={handleClearFiltros}>
                  <X className="h-3.5 w-3.5" /> Limpiar filtros
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {filteredLotes.length} lote{filteredLotes.length === 1 ? "" : "s"} visible{filteredLotes.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ─── Aviso de fallback automático a la semana anterior ─────────────── */}
      {!loading && !error && autoFallbackActive && (
        <AutoWeekFallbackNotice
          message={`Esta semana aún no tiene datos — mostrando la semana anterior (${formatFechaLarga(weekRange.start)} – ${formatFechaLarga(weekRange.end)})`}
          onGoToCurrentWeek={handleGoToCurrentWeek}
        />
      )}

      {/* ─── Contenido principal (solo si hay datos en el periodo) ── */}
      {!loading && hayDatos && (
        <>
          {/* ─── KPI strip compacto ─────────────────────────────────── */}
          <section className="glass-accented rounded-xl px-2 py-1">
            <div className="grid grid-cols-3 gap-x-2 gap-y-3 py-2.5 sm:flex sm:flex-nowrap sm:items-stretch sm:gap-0 sm:overflow-x-auto">
              <MiniKpi label="Kg totales" value={formatKg(kgLotesMostrado)} />
              <MiniKpi label="Lotes" value={String(filteredLotes.length)} />
              <MiniKpi
                label="T/h media"
                value={avgTphMostrado ? avgTphMostrado.toFixed(1) : "—"}
                tone={avgTphMostrado ? (avgTphMostrado >= 14.5 ? "success" : avgTphMostrado >= 12.5 ? "warning" : "destructive") : "neutral"}
              />
              <MiniKpi label="Horas" value={`${totalHorasMostrado.toFixed(1)} h`} />
              <MiniKpi
                label="Kg industria"
                value={kgIndustriaMostrado > 0 ? formatKg(kgIndustriaMostrado) : "—"}
                sub={kgIndustriaMostrado > 0 ? `${pctIndustria.toFixed(1)}%` : undefined}
                labelInfo="Suma de los kg de industria apuntados a mano en cada lote (en el detalle del parte)."
              />
              <MiniKpi label="Días" value={String(nDiasMostrado)} last />
            </div>
          </section>

          {/* ─── Tabs ───────────────────────────────────────────────── */}
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="glass-accented rounded-xl p-1.5">
              <TabsList className="flex w-full flex-nowrap justify-start gap-1 overflow-x-auto [&>*]:shrink-0 sm:w-auto sm:grid sm:grid-cols-5">
                <TabsTrigger value="resumen">Resumen</TabsTrigger>
                <TabsTrigger value="lotes">
                  Lotes <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredLotes.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="calibres">
                  Calibres <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{calibresMostrados.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="destino">
                  Destino <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{gruposMostrados.length + clasesMostradas.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="productores">
                  Productores <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{productoresFiltrados.length}</Badge>
                </TabsTrigger>
              </TabsList>
            </div>

            {hayFiltrosActivos && activeTab !== "lotes" && activeTab !== "resumen" && (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 text-info" />
                Filtrado según informes de lote — solo lotes con clasificación detallada cargada.
              </p>
            )}

            <div className="mt-4">
              <TabsContent value="resumen" className="mt-0">
                <ResumenTab
                  grupos={gruposMostrados}
                  clases={clasesMostradas}
                  calibres={calibresMostrados}
                  productores={productoresFiltrados}
                  lotes={filteredLotes}
                  kgTotal={kgLotesMostrado}
                  onGoToTab={handleTabChange}
                />
              </TabsContent>
              <TabsContent value="lotes" className="mt-0">
                <DailyListTable
                  lotes={filteredLotes}
                  onLoteClick={handleLoteClick}
                />
              </TabsContent>
              <TabsContent value="productores" className="mt-0">
                <AnalisisProductores
                  productores={productoresFiltrados}
                  days={data.days}
                  kgTotal={kgLotesMostrado}
                />
              </TabsContent>
              <TabsContent value="calibres" className="mt-0">
                <AnalisisCalibres
                  calibres={calibresMostrados}
                  days={data.days}
                  kgClasificados={kgClasificadosMostrado}
                  kgProduccionReal={data.totals.kg_produccion_real}
                />
              </TabsContent>
              <TabsContent value="destino" className="mt-0">
                <DestinoTabSummary
                  grupos={gruposMostrados}
                  clases={clasesMostradas}
                  totalKg={kgClasificadosMostrado}
                  days={data.days}
                />
              </TabsContent>
            </div>
          </Tabs>

          <LoteDetailSheet lote={selectedLote} open={sheetOpen} onOpenChange={setSheetOpen} />
        </>
      )}

      {/* ─── Empty state ────────────────────────────────────────── */}
      {!loading && !hayDatos && (
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-1 py-12 text-center">
            <BarChart3 className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="font-semibold text-foreground">No hay datos de detalle para este periodo</p>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              Para ver datos aquí necesitas subir el informe de tamaños/calibres al parte y pulsar "Analizar".
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Button variant="outline" className="glass glass-hover" onClick={() => handleManualNavigateWeek(-1)}>
                <ChevronLeft className="h-4 w-4" /> Ver semana anterior
              </Button>
              <Button variant="outline" className="glass glass-hover" onClick={() => handleManualPeriodoChange("ultimas_4")}>
                Ampliar a 4 semanas
              </Button>
              <Button asChild variant="outline" className="glass glass-hover">
                <Link to="/partes"><FileText className="h-4 w-4" /> Ir a Partes</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Cabecera de sección compartida (kicker + subtítulo) ───────────────────

function SectionHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
      <div className="min-w-0 flex-1">
        <p className="panel-kicker">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function VerDetalleButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 text-xs text-primary hover:text-primary" onClick={onClick}>
      Ver detalle <ArrowRight className="h-3 w-3" />
    </Button>
  );
}

// Solo el acento (pill / barras / puntos) lleva color — el resto de la tarjeta
// usa los tokens glass estándar, igual que el resto de la app. El color en sí
// sale de GRUPO_COLORS (destinoClasificacion.ts), única fuente de verdad para
// los grupos de destino en toda la app (Dashboard, Productores, LoteDetailSheet...).
function getGrupoColor(nombre: string): string {
  return GRUPO_COLORS[nombre] ?? GRUPO_COLORS.Otro;
}

/** Pill de grupo/clase: fondo suave del color + texto del mismo color (mismo hex en toda la app). */
function grupoPillStyle(nombre: string): React.CSSProperties {
  const color = getGrupoColor(nombre);
  return { backgroundColor: barFill(color, 0.14), color };
}

/** Barra sólida rellena con el color del grupo. */
function grupoBarStyle(nombre: string): React.CSSProperties {
  return { backgroundColor: getGrupoColor(nombre) };
}

/** Grupo de destino con más kg dentro de una clase — las clases heredan su color. */
function grupoDominanteDeClase(grupos: Record<string, number>): string {
  let best = "Otro";
  let bestKg = -1;
  for (const [grupo, kg] of Object.entries(grupos)) {
    if (kg > bestKg) { best = grupo; bestKg = kg; }
  }
  return best;
}

// ─── Resumen tab (vista de un vistazo) ─────────────────────────────────────

type ClaseResumenLite = { clase: string; kg_total: number; n_registros: number; n_dias: number; grupos: Record<string, number>; por_dia?: Record<string, number> };
type GrupoResumenLite = { grupo: string; kg_total: number; n_registros: number; n_dias: number; por_dia?: Record<string, number> };
type CalibreResumenLite = { calibre: string; kg_total: number; por_clase: Record<string, number>; por_dia: Record<string, number> };

interface ResumenTabProps {
  grupos: GrupoResumenLite[];
  clases: ClaseResumenLite[];
  calibres: CalibreResumenLite[];
  productores: ProductorResumen[];
  lotes: LoteResumen[];
  kgTotal: number;
  onGoToTab: (tab: TabValue) => void;
}

function ResumenTab({ grupos, clases, calibres, productores, lotes, kgTotal, onGoToTab }: ResumenTabProps) {
  const evolucionDiaria = useMemo(() => {
    const porDia = new Map<string, { kg: number; minTph: number; sumaPonderada: number; sumaSimple: number; nTph: number }>();
    for (const l of lotes) {
      if (!l.fecha || l.fecha === "—") continue;
      const acc = porDia.get(l.fecha) ?? { kg: 0, minTph: 0, sumaPonderada: 0, sumaSimple: 0, nTph: 0 };
      acc.kg += l.kg_peso_total;
      if (l.toneladas_hora && l.toneladas_hora > 0) {
        const min = l.duracion_min ?? 0;
        acc.minTph += min;
        acc.sumaPonderada += l.toneladas_hora * (min || 1);
        acc.sumaSimple += l.toneladas_hora;
        acc.nTph += 1;
      }
      porDia.set(l.fecha, acc);
    }
    return Array.from(porDia.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, v]) => ({
        fecha,
        label: formatFechaLarga(fecha).slice(0, 5),
        kg: v.kg,
        tph: v.nTph > 0 ? (v.minTph > 0 ? v.sumaPonderada / v.minTph : v.sumaSimple / v.nTph) : null,
      }));
  }, [lotes]);

  const hayEvolucion = evolucionDiaria.length > 1;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Destino de la fruta */}
      <Card className="glass-accented lg:col-span-5">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <SectionHeading
            title="Destino de la fruta"
            subtitle="Reparto de kg por grupo de destino"
            action={<VerDetalleButton onClick={() => onGoToTab("destino")} />}
          />
          <ResumenDestinoBar grupos={grupos} totalKg={kgTotal} />
        </CardContent>
      </Card>

      {/* Clases */}
      <Card className="glass-accented lg:col-span-7">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <SectionHeading
            title="Clases"
            subtitle="Top 6 clases comerciales por kg"
            action={<VerDetalleButton onClick={() => onGoToTab("destino")} />}
          />
          <ResumenTopBarras
            items={clases.slice(0, 6).map((c) => ({ nombre: c.clase, kg: c.kg_total, grupo: grupoDominanteDeClase(c.grupos) }))}
            totalKg={kgTotal}
          />
        </CardContent>
      </Card>

      {/* Calibres */}
      <Card className="glass-accented lg:col-span-5">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <SectionHeading
            title="Calibres"
            subtitle="Top 6 calibres por kg"
            action={<VerDetalleButton onClick={() => onGoToTab("calibres")} />}
          />
          <ResumenTopBarras
            items={calibres.slice(0, 6).map((c) => ({ nombre: c.calibre, kg: c.kg_total }))}
            totalKg={kgTotal}
            neutral
          />
        </CardContent>
      </Card>

      {/* Top productores */}
      <Card className="glass-accented lg:col-span-7">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <SectionHeading
            title="Top productores"
            subtitle="Los 6 productores con más kg del periodo"
            action={<VerDetalleButton onClick={() => onGoToTab("productores")} />}
          />
          <ResumenTopProductores productores={productores.slice(0, 6)} />
        </CardContent>
      </Card>

      {/* Evolución diaria */}
      <Card className="glass-accented lg:col-span-12">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <SectionHeading
            title="Evolución diaria"
            subtitle="Barras = kg por día · línea = T/h media del día"
            action={<VerDetalleButton onClick={() => onGoToTab("lotes")} />}
          />
          {hayEvolucion ? (
            <div className={cn(CHART_PANEL_CLASS, "h-64")}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={evolucionDiaria} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...XAXIS} />
                  <YAxis
                    yAxisId="kg"
                    {...YAXIS}
                    tickFormatter={(v) => `${(v / 1000).toFixed(1)}t`}
                    width={40}
                  />
                  <YAxis
                    yAxisId="tph"
                    orientation="right"
                    {...YAXIS}
                    tickFormatter={(v) => `${v}`}
                    width={32}
                    domain={[0, "auto"]}
                  />
                  <Tooltip
                    content={
                      <GlassTooltip
                        formatter={(v, name) => (name === "tph" ? `${Number(v).toFixed(1)} T/h` : formatKg(Number(v)))}
                      />
                    }
                  />
                  <Bar
                    yAxisId="kg"
                    dataKey="kg"
                    strokeWidth={1.5}
                    radius={[6, 6, 2, 2]}
                    maxBarSize={34}
                    stroke={C.primary}
                    fill={barFill(C.primary)}
                    name="kg"
                  />
                  <Line
                    yAxisId="tph"
                    type="monotone"
                    dataKey="tph"
                    stroke={C.info}
                    strokeWidth={2.5}
                    dot={{ r: 3.5, fill: C.info, stroke: "var(--glass-bg-strong)", strokeWidth: 2 }}
                    activeDot={activeDotStyle(C.info)}
                    connectNulls
                    name="tph"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-8 text-center text-sm text-muted-foreground">
              Se necesita más de un día con datos para mostrar la evolución.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ResumenDestinoBar({ grupos, totalKg }: { grupos: GrupoResumenLite[]; totalKg: number }) {
  if (grupos.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Sin datos de destino</p>;
  }
  const total = grupos.reduce((s, g) => s + g.kg_total, 0);
  return (
    <div className="space-y-3">
      <div className="flex h-6 w-full overflow-hidden rounded-md border border-[var(--glass-border)]">
        {grupos.map((g) => {
          const pct = total > 0 ? (g.kg_total / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <div
              key={g.grupo}
              style={{ width: `${pct}%`, ...grupoBarStyle(g.grupo) }}
              title={`${g.grupo}: ${formatKg(g.kg_total)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <ul className="space-y-2">
        {grupos.map((g) => {
          const pct = totalKg > 0 ? (g.kg_total / totalKg) * 100 : (total > 0 ? (g.kg_total / total) * 100 : 0);
          return (
            <li key={g.grupo} className="flex items-center gap-2.5 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={grupoBarStyle(g.grupo)} />
              <span className="min-w-0 flex-1 truncate font-medium">{g.grupo}</span>
              <span className="tabular-nums font-semibold">{formatKg(g.kg_total)}</span>
              <span className="w-12 shrink-0 text-right tabular-nums text-xs text-muted-foreground">{pct.toFixed(1)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResumenTopBarras({
  items, totalKg, neutral = false,
}: {
  items: Array<{ nombre: string; kg: number; grupo?: string }>;
  totalKg: number;
  neutral?: boolean;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Sin datos</p>;
  }
  const maxKg = Math.max(...items.map((i) => i.kg), 1);
  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const barWidth = (item.kg / maxKg) * 100;
        const pct = totalKg > 0 ? (item.kg / totalKg) * 100 : 0;
        return (
          <div key={item.nombre} className="flex items-center gap-3">
            <span className="w-20 shrink-0 truncate text-sm font-medium sm:w-28">{item.nombre}</span>
            <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
              <div
                className={cn("h-full rounded-full transition-all duration-500", neutral && "bg-primary")}
                style={{ width: `${barWidth}%`, ...(neutral ? {} : grupoBarStyle(item.grupo ?? item.nombre)) }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">{formatKg(item.kg)}</span>
            <span className="hidden w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">{pct.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function ResumenTopProductores({ productores }: { productores: ProductorResumen[] }) {
  const navigate = useNavigate();
  if (productores.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Sin productores</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--glass-border)] text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-1.5 text-left font-semibold">Productor</th>
            <th className="py-1.5 text-right font-semibold">Kg</th>
            <th className="py-1.5 text-right font-semibold">Lotes</th>
            <th className="py-1.5 text-right font-semibold">T/h</th>
          </tr>
        </thead>
        <tbody>
          {productores.map((p) => {
            const tphTone = p.tph_promedio === null ? "neutral" : p.tph_promedio >= 14.5 ? "success" : p.tph_promedio >= 12.5 ? "warning" : "destructive";
            return (
              <tr
                key={p.productor}
                className="cursor-pointer border-b border-[var(--glass-border)] transition-colors last:border-b-0 hover:bg-[var(--glass-bg-strong)]"
                onClick={() => navigate(`/productores?productor=${encodeURIComponent(p.productor)}`)}
                title="Abrir el dossier del productor"
              >
                <td className="max-w-[160px] truncate py-2 font-medium">{p.productor}</td>
                <td className="py-2 text-right tabular-nums font-semibold">{formatKg(p.kg_total)}</td>
                <td className="py-2 text-right tabular-nums text-muted-foreground">{p.n_lotes}</td>
                <td className="py-2 text-right">
                  <Badge variant="outline" className={cn("text-xs tabular-nums", MINI_KPI_TONE_BADGE[tphTone])}>
                    {p.tph_promedio !== null ? p.tph_promedio.toFixed(1) : "—"}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const MINI_KPI_TONE_BADGE: Record<string, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground",
};

// ─── Mini-barras de evolución por día (compartidas por Destino) ────────────

function MiniDias({ porDia, days, dotColor }: { porDia: Record<string, number> | undefined; days: string[]; dotColor: string }) {
  if (!porDia || days.length <= 1) return null;
  const max = Math.max(...days.map((d) => porDia[d] ?? 0), 1);
  return (
    <div className="space-y-1 pt-3 border-t border-[var(--glass-border)]">
      <div className="flex h-7 items-end gap-1">
        {days.map((d) => {
          const kg = porDia[d] ?? 0;
          return (
            <div
              key={d}
              title={`${formatFechaLarga(d)} · ${formatKg(kg)}`}
              className="flex-1 rounded-t-[2px] opacity-80"
              style={{ height: `${kg > 0 ? Math.max(8, (kg / max) * 100) : 2}%`, backgroundColor: dotColor }}
            />
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">kg por día del periodo</p>
    </div>
  );
}

// ─── Destino tab (fusiona antiguas Clase + Grupo) ──────────────────────────

interface DestinoTabSummaryProps {
  grupos: GrupoResumenLite[];
  clases: ClaseResumenLite[];
  totalKg: number;
  days: string[];
}

function DestinoTabSummary({ grupos, clases, totalKg, days }: DestinoTabSummaryProps) {
  const sinDatos = grupos.length === 0 && clases.length === 0;
  if (sinDatos) {
    return (
      <Card className="glass-accented">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Sin resultados de destino</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Por grupo de destino */}
      <div className="space-y-4">
        <SectionHeading title="Por grupo de destino" subtitle="Reparto de kg clasificados por grupo de destino" />
        {grupos.length === 0 ? (
          <p className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-8 text-center text-sm text-muted-foreground">
            Sin resultados de grupo
          </p>
        ) : (
          <GrupoCards grupos={grupos} totalKg={totalKg} days={days} />
        )}
      </div>

      {/* Por clase comercial */}
      <div className="space-y-4">
        <SectionHeading title="Por clase comercial" subtitle="Reparto de kg clasificados por clase · toca una fila para ver el detalle" />
        {clases.length === 0 ? (
          <p className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-8 text-center text-sm text-muted-foreground">
            Sin resultados de clase
          </p>
        ) : (
          <ClaseList clases={clases} totalKg={totalKg} days={days} />
        )}
      </div>
    </div>
  );
}

function GrupoCards({ grupos, totalKg, days }: { grupos: GrupoResumenLite[]; totalKg: number; days: string[] }) {
  const maxKg = grupos.length > 0 ? Math.max(...grupos.map((g) => g.kg_total)) : 1;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {grupos.map((g) => {
        const pct = totalKg > 0 ? (g.kg_total / totalKg) * 100 : 0;
        const barWidth = maxKg > 0 ? (g.kg_total / maxKg) * 100 : 0;
        const color = getGrupoColor(g.grupo);
        return (
          <div key={g.grupo} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-shadow)] backdrop-blur-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-bold" style={grupoPillStyle(g.grupo)}>
                {g.grupo}
              </span>
              <span className="text-sm font-semibold text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">{formatKg(g.kg_total)}</p>
            <div className="space-y-1.5">
              <div className="h-2 w-full rounded-full bg-[var(--glass-bg-strong)] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barWidth}%`, backgroundColor: color }} />
              </div>
              <p className="text-[11px] text-muted-foreground">{g.n_registros} lotes · {g.n_dias} {g.n_dias === 1 ? "día" : "días"}</p>
            </div>
            <MiniDias porDia={g.por_dia} days={days} dotColor={color} />
          </div>
        );
      })}
    </div>
  );
}

function ClaseList({ clases, totalKg, days }: { clases: ClaseResumenLite[]; totalKg: number; days: string[] }) {
  const maxKg = Math.max(...clases.map((c) => c.kg_total), 1);
  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="divide-y divide-[var(--glass-border)] p-0">
        {clases.map((c) => (
          <ClaseRow key={c.clase} clase={c} totalKg={totalKg} maxKg={maxKg} days={days} />
        ))}
      </CardContent>
    </Card>
  );
}

function ClaseRow({ clase: c, totalKg, maxKg, days }: { clase: ClaseResumenLite; totalKg: number; maxKg: number; days: string[] }) {
  const [open, setOpen] = useState(false);
  const grupoDominante = grupoDominanteDeClase(c.grupos);
  const color = getGrupoColor(grupoDominante);
  const pct = totalKg > 0 ? (c.kg_total / totalKg) * 100 : 0;
  const barWidth = maxKg > 0 ? (c.kg_total / maxKg) * 100 : 0;
  const gruposOrdenados = Object.entries(c.grupos).sort((a, b) => b[1] - a[1]);
  const maxGrupoKg = gruposOrdenados.length > 0 ? gruposOrdenados[0][1] : 1;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--glass-bg-strong)] sm:gap-4">
        <span
          className="inline-flex w-24 shrink-0 items-center justify-center rounded-lg px-2 py-1 text-xs font-bold sm:w-32 sm:text-sm"
          style={grupoPillStyle(grupoDominante)}
        >
          {c.clase}
        </span>
        <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barWidth}%`, backgroundColor: color }} />
        </div>
        <span className="w-20 shrink-0 text-right text-sm font-bold tabular-nums sm:w-24 sm:text-base">{formatKg(c.kg_total)}</span>
        <span className="hidden w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-muted-foreground sm:inline">{pct.toFixed(1)}%</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg-strong)]/40 px-4 py-4 sm:px-[7.5rem]">
          <p className="text-[11px] text-muted-foreground">
            {pct.toFixed(1)}% del total · {c.n_registros} lotes · {c.n_dias} {c.n_dias === 1 ? "día" : "días"}
          </p>

          {gruposOrdenados.length > 0 && (
            <div className="mt-3 space-y-2">
              {gruposOrdenados.map(([g, kg]) => {
                const gPct = c.kg_total > 0 ? (kg / c.kg_total) * 100 : 0;
                const gBarWidth = maxGrupoKg > 0 ? (kg / maxGrupoKg) * 100 : 0;
                const gColor = getGrupoColor(g);
                return (
                  <div key={g} className="flex items-center gap-2.5">
                    <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: gColor }} />
                    <span className="w-24 shrink-0 truncate text-sm font-medium sm:w-28">{g}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${gBarWidth}%`, backgroundColor: gColor }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatKg(kg)}</span>
                    <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{gPct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          )}

          <MiniDias porDia={c.por_dia} days={days} dotColor={color} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
