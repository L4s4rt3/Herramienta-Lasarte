// src/pages/Productores.tsx
// Dossier de eficiencia por productor: ranking + detalle con comparativa vs
// media de planta, evolución, calidad e historial completo de lotes.
// Presentación densa/compacta: toolbar única con KPIs inline, tablas con
// filas finas (py-1.5), zebra sutil y sin cards anidadas.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InfoTooltip } from "@/components/InfoTooltip";
import { DeltaChip } from "@/components/DeltaChip";
import { WeekSelector } from "@/components/WeekSelector";
import { buildWeekRange } from "@/lib/analisisDiarioView";
import type { Periodo } from "@/lib/analisisDiarioView";
import { useProductores, type ProductorDossier, type MediasPlanta } from "@/hooks/useProductores";
import type { CalidadEstado } from "@/lib/calidad";
import { formatKg, formatDate, today, toISODateLocal } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GRUPO_COLORS } from "@/lib/destinoClasificacion";
import {
  GlassTooltip, C, GRID, XAXIS, YAXIS, MARGIN, CHART_PANEL_CLASS, BAR_STYLE, barFill, activeDotStyle,
} from "@/lib/chartTheme";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import {
  Loader2, RefreshCw, AlertCircle,
  ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ArrowLeft, Sprout, Ruler, StickyNote,
} from "lucide-react";

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

// ─── Umbrales / helpers visuales ─────────────────────────────────────────────

function tphClass(tph: number | null): string {
  if (tph === null) return "text-muted-foreground";
  return tph >= 14.5 ? "text-success" : tph >= 12.5 ? "text-warning" : "text-destructive";
}

function pctIndustriaClass(pct: number): string {
  if (pct <= 2) return "text-success";
  if (pct <= 5) return "text-warning";
  return "text-destructive";
}

const QUALITY_STYLE: Record<CalidadEstado, string> = {
  Excelente: "border-emerald-600/35 bg-emerald-600/12 text-emerald-800 dark:text-emerald-200",
  Bueno: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  Regular: "border-amber-500/35 bg-amber-500/14 text-amber-700 dark:text-amber-300",
  Deficiente: "border-orange-500/35 bg-orange-500/14 text-orange-700 dark:text-orange-300",
  Pésimo: "border-red-500/35 bg-red-500/12 text-red-700 dark:text-red-300",
};

const CALIDAD_ORDEN: CalidadEstado[] = ["Pésimo", "Deficiente", "Regular", "Bueno", "Excelente"];

function calidadDominante(calidad: ProductorDossier["calidad"]): CalidadEstado | null {
  if (!calidad || calidad.total === 0) return null;
  // La calidad "dominante" a efectos de alerta: la peor presente con al menos 1 registro,
  // priorizando visibilidad de incidencias sobre el simple conteo mayoritario.
  for (const estado of CALIDAD_ORDEN) {
    if (calidad.porEstado[estado] > 0) return estado;
  }
  return null;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODateLocal(d);
}

function formatDateShort(iso: string): string {
  if (!iso || iso === "—") return "—";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// ─── Sort helpers (patrón ColHead/SortIcon de PartesList.tsx) ────────────────

type SortKey = "productor" | "kg" | "lotes" | "tph" | "lentos" | "peso" | "industria_pct" | "export_pct" | "ultimo_dia";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ChevronUp className="h-3 w-3 text-primary" />
    : <ChevronDown className="h-3 w-3 text-primary" />;
}

function ColHead({ label, sk, right, sortKey, sortDir, onToggle, info }: {
  label: string; sk: SortKey; right?: boolean;
  sortKey: SortKey; sortDir: SortDir; onToggle: (k: SortKey) => void;
  info?: string;
}) {
  return (
    <th
      className={cn(
        "cursor-pointer select-none whitespace-nowrap transition-colors hover:text-foreground",
        right && "text-right"
      )}
      onClick={() => onToggle(sk)}
    >
      <span className={cn("inline-flex items-center gap-1", right && "flex-row-reverse")}>
        {label}<SortIcon active={sortKey === sk} dir={sortDir} />
        {info && <InfoTooltip iconClassName="h-3 w-3">{info}</InfoTooltip>}
      </span>
    </th>
  );
}

// ─── Mini-KPI de la franja compacta (patrón AnalisisDiario) ─────────────────

const MINI_KPI_TONE: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  neutral: "text-foreground",
};

function MiniKpi({
  label, value, sub, tone = "neutral", last = false, labelInfo,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "warning" | "destructive" | "neutral";
  last?: boolean;
  labelInfo?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 px-3 py-1.5 sm:flex-1 sm:border-r sm:border-[var(--glass-border)]",
        last && "sm:border-r-0"
      )}
      title={labelInfo}
    >
      <p className="panel-kicker truncate">{label}</p>
      <p className={cn("mt-0.5 text-[18px] font-semibold leading-tight tabular-nums sm:text-[20px]", MINI_KPI_TONE[tone])}>
        {value}
        {sub && <span className="ml-1 text-xs font-medium text-muted-foreground">({sub})</span>}
      </p>
    </div>
  );
}

// ─── Mini-métrica con delta (para el detalle del productor) ─────────────────

function MiniMetric({
  label, value, delta, deltaTrend, hint, last = false, labelInfo,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTrend?: "up" | "down" | "neutral";
  hint?: string;
  last?: boolean;
  labelInfo?: string;
}) {
  return (
    <div className={cn("min-w-0 px-3 py-2 sm:flex-1 sm:border-r sm:border-[var(--glass-border)]", last && "sm:border-r-0")}>
      <div className="flex items-center gap-1">
        <p className="panel-kicker truncate">{label}</p>
        {labelInfo && <InfoTooltip iconClassName="h-3 w-3">{labelInfo}</InfoTooltip>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-[18px] font-semibold leading-tight tabular-nums sm:text-[20px]">{value}</span>
        {delta && <DeltaChip value={delta} trend={deltaTrend || "neutral"} className="text-[10px] px-1.5 py-0" />}
      </div>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────

const DETAIL_TABS = ["resumen", "lotes", "calibres", "calidad", "destino"] as const;
type DetailTab = typeof DETAIL_TABS[number];

export default function Productores() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryProductor = searchParams.get("productor");
  const queryTab = searchParams.get("tab");
  const activeTab: DetailTab = DETAIL_TABS.includes(queryTab as DetailTab) ? (queryTab as DetailTab) : "resumen";

  const [periodo, setPeriodo] = useState<Periodo>("ultimas_4");
  const [customDesde, setCustomDesde] = useState(() => daysAgo(30));
  const [customHasta, setCustomHasta] = useState(() => today());
  const [selected, setSelected] = useState<string | null>(queryProductor);
  const [sortKey, setSortKey] = useState<SortKey>("kg");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const weekRange = useMemo(
    () => buildWeekRange(periodo, customDesde, customHasta),
    [periodo, customDesde, customHasta]
  );

  const { data, loading, error, refetch } = useProductores(weekRange.start, weekRange.end);

  // Si llega un ?productor=X que existe en los datos, preseleccionarlo.
  useEffect(() => {
    if (queryProductor && data.productores.some((p) => p.productor === queryProductor)) {
      setSelected(queryProductor);
    }
  }, [queryProductor, data.productores]);

  function handleSelect(productor: string | null) {
    setSelected(productor);
    const next = new URLSearchParams(searchParams);
    if (productor) next.set("productor", productor);
    else { next.delete("productor"); next.delete("tab"); }
    setSearchParams(next, { replace: true });
  }

  function handleTabChange(tab: DetailTab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }

  function handleNavigateWeek(direction: -1 | 1) {
    const start = new Date(weekRange.start + "T12:00:00");
    start.setDate(start.getDate() + direction * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    setCustomDesde(start.toISOString().slice(0, 10));
    setCustomHasta(end.toISOString().slice(0, 10));
    setPeriodo("custom");
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "productor" ? "asc" : "desc"); }
  }

  const sorted = useMemo(() => {
    return [...data.productores].sort((a, b) => {
      let va: string | number, vb: string | number;
      switch (sortKey) {
        case "productor":     va = a.productor; vb = b.productor; break;
        case "kg":            va = a.kg_total; vb = b.kg_total; break;
        case "lotes":         va = a.n_lotes; vb = b.n_lotes; break;
        case "tph":           va = a.tph_promedio ?? -1; vb = b.tph_promedio ?? -1; break;
        case "lentos":        va = a.pct_lotes_lentos ?? -1; vb = b.pct_lotes_lentos ?? -1; break;
        case "peso":          va = a.peso_fruta_promedio_g ?? -1; vb = b.peso_fruta_promedio_g ?? -1; break;
        case "industria_pct": va = a.pct_industria; vb = b.pct_industria; break;
        case "export_pct":    va = a.aprovechamiento?.pct_exportacion ?? -1; vb = b.aprovechamiento?.pct_exportacion ?? -1; break;
        case "ultimo_dia":    va = a.ultimo_dia ?? ""; vb = b.ultimo_dia ?? ""; break;
        default:              va = a.kg_total; vb = b.kg_total;
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data.productores, sortKey, sortDir]);

  const selectedDossier = useMemo(
    () => (selected ? data.productores.find((p) => p.productor === selected) ?? null : null),
    [selected, data.productores]
  );

  const kgTotalPeriodo = useMemo(() => data.productores.reduce((s, p) => s + p.kg_total, 0), [data.productores]);

  const mejorTph = useMemo(() => {
    const conTph = data.productores.filter((p) => p.tph_promedio !== null);
    if (conTph.length === 0) return null;
    return conTph.reduce((best, p) => (p.tph_promedio! > best.tph_promedio! ? p : best));
  }, [data.productores]);

  const peorIndustria = useMemo(() => {
    if (data.productores.length === 0) return null;
    return data.productores.reduce((worst, p) => (p.pct_industria > worst.pct_industria ? p : worst));
  }, [data.productores]);

  const hayDatos = data.productores.length > 0;

  return (
    <div className="page-shell">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header className="page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Productores</h1>
          <p className="page-subtitle">
            {periodo === "todo" ? weekRange.label : <>{formatDate(weekRange.start)} — {formatDate(weekRange.end)}</>}
            {!loading && hayDatos && <> · {data.productores.length} productor{data.productores.length === 1 ? "" : "es"}</>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Actualizar
        </Button>
      </header>

      {/* ─── Loading ────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando productores...</span>
        </div>
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
            <Button variant="outline" size="sm" onClick={refetch} className="ml-auto">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reintentar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Toolbar única: siempre visible tras cargar (incluso sin datos)
           para poder navegar a un periodo que sí tenga información ───── */}
      {!loading && !error && (
        <div className="glass-accented rounded-xl p-3 space-y-3">
          <WeekSelector
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            customDesde={customDesde}
            customHasta={customHasta}
            onCustomDesdeChange={setCustomDesde}
            onCustomHastaChange={setCustomHasta}
            onNavigateWeek={handleNavigateWeek}
            canNavigateNext={periodo === "todo" ? true : weekRange.end < today()}
            showTodo
          />
          {hayDatos && (
            <div className="grid grid-cols-2 gap-x-2 gap-y-2 border-t border-[var(--glass-border)] pt-2.5 sm:flex sm:flex-nowrap sm:items-stretch sm:gap-0">
              <MiniKpi label="Productores" value={String(data.productores.length)} />
              <MiniKpi label="Kg totales" value={formatKg(kgTotalPeriodo)} />
              <MiniKpi
                label="Mejor T/h"
                value={mejorTph?.tph_promedio ? `${mejorTph.tph_promedio.toFixed(1)}` : "—"}
                sub={mejorTph?.productor}
                tone="success"
              />
              <MiniKpi
                label="Mayor % industria"
                value={peorIndustria ? `${peorIndustria.pct_industria.toFixed(1)}%` : "—"}
                sub={peorIndustria?.productor}
                tone={peorIndustria && peorIndustria.pct_industria > 5 ? "warning" : "neutral"}
                labelInfo="Porcentaje de los kg del productor apuntados como industria: cuanto más alto, menos aprovechable viene su fruta."
                last
              />
            </div>
          )}
        </div>
      )}

      {/* ─── Contenido principal (solo si hay datos en el periodo) ── */}
      {!loading && !error && hayDatos && (
        <>
          {!selectedDossier ? (
            <RankingTable
              productores={sorted}
              kgTotalPeriodo={kgTotalPeriodo}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              onSelect={handleSelect}
            />
          ) : (
            <ProductorDetalle
              dossier={selectedDossier}
              medias={data.medias}
              days={data.days}
              kgTotalPeriodo={kgTotalPeriodo}
              activeTab={activeTab}
              onTabChange={handleTabChange}
              onBack={() => handleSelect(null)}
              onLoteClick={(partId) => navigate(`/partes/${partId}`)}
            />
          )}
        </>
      )}

      {/* ─── Empty state ────────────────────────────────────────── */}
      {!loading && !error && !hayDatos && (
        <Card className="glass-accented">
          <CardContent className="py-12 text-center">
            <Sprout className="size-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-lg">Sin productores en este periodo</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
              Los productores salen de los lotes del informe de producción. Sube el informe al parte y pulsa "Analizar".
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button variant="outline" onClick={() => handleNavigateWeek(-1)}>
                <ChevronLeft className="h-4 w-4" /> Ver semana anterior
              </Button>
              <Button variant="outline" onClick={() => setPeriodo("ultimas_4")}>
                Ampliar a 4 semanas
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Ranking (tabla ordenable densa + tarjetas móvil) ───────────────────────

function RankingTable({ productores, kgTotalPeriodo, sortKey, sortDir, onToggleSort, onSelect }: {
  productores: ProductorDossier[];
  kgTotalPeriodo: number;
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (k: SortKey) => void;
  onSelect: (productor: string) => void;
}) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="p-0">
        {/* Escritorio: tabla densa */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-[var(--glass-bg-solid)] backdrop-blur-xl">
              <tr className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                <ColHead label="Productor"  sk="productor"     sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
                <ColHead label="Kg"         sk="kg"            sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} right />
                <ColHead label="Lotes"      sk="lotes"         sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} right />
                <ColHead label="T/h"        sk="tph"           sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} right />
                <ColHead label="% lentos"   sk="lentos"        sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} right />
                <ColHead label="Peso fruta" sk="peso"          sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} right />
                <ColHead label="Industria"  sk="industria_pct" sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} right />
                <ColHead
                  label="% Export"
                  sk="export_pct"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={onToggleSort}
                  right
                  info="% de los kg clasificados (Informe LOTE) que van al grupo Exportación. Sin informe de lote no hay dato."
                />
                <th className="whitespace-nowrap">Calidad</th>
                <ColHead label="Últ. día"  sk="ultimo_dia"    sortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} right />
              </tr>
            </thead>
            <tbody>
              {productores.map((p, i) => {
                const dominante = calidadDominante(p.calidad);
                return (
                  <tr
                    key={p.productor}
                    className={cn(
                      "cursor-pointer border-b border-[var(--glass-border)] last:border-b-0 transition-colors hover:bg-[var(--glass-bg-strong)]",
                      i % 2 === 1 && "bg-[var(--glass-bg)]/40"
                    )}
                    onClick={() => onSelect(p.productor)}
                  >
                    <td className="px-3 py-1.5 font-medium max-w-[200px]">
                      <span className="truncate block">{p.productor}</span>
                      {p.productos.length > 0 && (
                        <Tooltip delayDuration={200}>
                          <TooltipTrigger asChild>
                            <span className="block truncate text-[11px] font-normal text-muted-foreground">{p.productos.join(", ")}</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[280px] text-xs">
                            {p.productos.join(", ")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(p.kg_total)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{p.n_lotes}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums font-semibold", tphClass(p.tph_promedio))}>
                      {p.tph_promedio !== null ? `${p.tph_promedio.toFixed(1)}` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {p.pct_lotes_lentos !== null ? `${p.pct_lotes_lentos.toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {p.peso_fruta_promedio_g !== null ? `${p.peso_fruta_promedio_g.toFixed(0)} g` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {p.kg_industria > 0 ? (
                        <>
                          <span className={cn("font-semibold", pctIndustriaClass(p.pct_industria))}>{p.pct_industria.toFixed(1)}%</span>
                          <span className="ml-1 text-[11px] text-muted-foreground">{formatKg(p.kg_industria)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-success">
                      {p.aprovechamiento ? `${p.aprovechamiento.pct_exportacion.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {dominante ? (
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", QUALITY_STYLE[dominante])}>{dominante}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                      {p.ultimo_dia ? formatDateShort(p.ultimo_dia) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Móvil: tarjetas compactas 2-col */}
        <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 md:hidden">
          {productores.map((p) => {
            const pct = kgTotalPeriodo > 0 ? (p.kg_total / kgTotalPeriodo) * 100 : 0;
            const dominante = calidadDominante(p.calidad);
            return (
              <div
                key={p.productor}
                onClick={() => onSelect(p.productor)}
                className="cursor-pointer rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 transition-colors hover:bg-[var(--glass-bg-strong)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{p.productor}</span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-primary">{pct.toFixed(1)}%</span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                  <MobileField label="Kg" value={formatKg(p.kg_total)} />
                  <MobileField label="Lotes" value={String(p.n_lotes)} muted />
                  <MobileField label="T/h" value={p.tph_promedio !== null ? p.tph_promedio.toFixed(1) : "—"} valueClass={tphClass(p.tph_promedio)} />
                  <MobileField label="Industria" value={p.pct_industria > 0 ? `${p.pct_industria.toFixed(1)}%` : "—"} valueClass={pctIndustriaClass(p.pct_industria)} />
                  <MobileField label="% Export" value={p.aprovechamiento ? `${p.aprovechamiento.pct_exportacion.toFixed(1)}%` : "—"} valueClass="text-success" />
                  {dominante && <MobileField label="Calidad" value={dominante} />}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MobileField({ label, value, valueClass, muted }: { label: string; value: string; valueClass?: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-medium tabular-nums", muted && "text-muted-foreground", valueClass)}>{value}</span>
    </div>
  );
}

// ─── Detalle del productor ───────────────────────────────────────────────

function ProductorDetalle({ dossier, medias, days, kgTotalPeriodo, activeTab, onTabChange, onBack, onLoteClick }: {
  dossier: ProductorDossier;
  medias: MediasPlanta;
  days: string[];
  kgTotalPeriodo: number;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onBack: () => void;
  onLoteClick: (partId: string) => void;
}) {
  const chartData = useMemo(() => {
    const porDiaTph = new Map<string, { sumTph: number; nTph: number }>();
    for (const l of dossier.lotes) {
      if (l.fecha === "—" || l.toneladas_hora === null) continue;
      const acc = porDiaTph.get(l.fecha) ?? { sumTph: 0, nTph: 0 };
      acc.sumTph += l.toneladas_hora;
      acc.nTph += 1;
      porDiaTph.set(l.fecha, acc);
    }
    const relevantDays = days.length > 0 ? days : Object.keys(dossier.por_dia).sort();
    return relevantDays.map((d) => {
      const tphInfo = porDiaTph.get(d);
      return {
        fecha: d,
        label: formatDate(d).slice(0, 6),
        kg: dossier.por_dia[d] ?? 0,
        tph: tphInfo && tphInfo.nTph > 0 ? tphInfo.sumTph / tphInfo.nTph : null,
      };
    });
  }, [dossier, days]);

  const pctDelPeriodo = kgTotalPeriodo > 0 ? (dossier.kg_total / kgTotalPeriodo) * 100 : 0;

  const deltaTph = dossier.tph_promedio !== null && medias.tph_media !== null
    ? dossier.tph_promedio - medias.tph_media
    : null;
  const deltaIndustria = dossier.pct_industria - medias.pct_industria_media;
  const deltaPeso = dossier.peso_fruta_promedio_g !== null && medias.peso_fruta_medio !== null
    ? dossier.peso_fruta_promedio_g - medias.peso_fruta_medio
    : null;
  const mediaExport = medias.pct_grupo_medio?.["Exportación"] ?? null;
  const deltaExport = dossier.aprovechamiento && mediaExport !== null
    ? dossier.aprovechamiento.pct_exportacion - mediaExport
    : null;

  return (
    <div className="space-y-3">
      {/* Cabecera compacta: nombre + chips de metadatos en una línea */}
      <div className="glass-accented rounded-xl px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Ranking
          </Button>
          <h2 className="text-base font-bold truncate">{dossier.productor}</h2>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {dossier.n_lotes} lote{dossier.n_lotes === 1 ? "" : "s"} · {dossier.n_dias} día{dossier.n_dias === 1 ? "" : "s"}
            {dossier.ultimo_dia && <> · últ. {formatDateShort(dossier.ultimo_dia)}</>}
            {" "}· {pctDelPeriodo.toFixed(1)}% del periodo
          </span>
          {dossier.productos.map((prod) => (
            <Badge key={prod} variant="secondary" className="text-[10px] px-1.5 py-0">{prod}</Badge>
          ))}
        </div>
      </div>

      {/* KPIs comparativos vs planta: fila de mini-métricas */}
      <div className="glass-accented rounded-xl">
        <div className="grid grid-cols-2 gap-x-2 gap-y-2 p-3 sm:flex sm:flex-nowrap sm:items-stretch sm:gap-0 sm:p-0">
          <MiniMetric
            label="Kg totales"
            value={formatKg(dossier.kg_total)}
            hint={`${pctDelPeriodo.toFixed(1)}% del periodo`}
          />
          <MiniMetric
            label="T/h media"
            value={dossier.tph_promedio !== null ? dossier.tph_promedio.toFixed(1) : "—"}
            delta={deltaTph !== null ? `${deltaTph >= 0 ? "+" : ""}${deltaTph.toFixed(1)}` : undefined}
            deltaTrend={deltaTph !== null ? (deltaTph >= 0 ? "up" : "down") : "neutral"}
            hint={medias.tph_media !== null ? `planta: ${medias.tph_media.toFixed(1)}` : undefined}
            labelInfo="T/h media ponderada por duración del lote, comparada con la media de planta del periodo."
          />
          <MiniMetric
            label="% Exportación"
            value={dossier.aprovechamiento ? `${dossier.aprovechamiento.pct_exportacion.toFixed(1)}%` : "—"}
            delta={deltaExport !== null ? `${deltaExport >= 0 ? "+" : ""}${deltaExport.toFixed(1)} pp` : undefined}
            deltaTrend={deltaExport !== null ? (deltaExport >= 0 ? "up" : "down") : "neutral"}
            hint={mediaExport !== null ? `planta: ${mediaExport.toFixed(1)}%` : dossier.aprovechamiento ? undefined : "sin Informe LOTE"}
            labelInfo="Kg del grupo Exportación sobre kg clasificados en el Informe LOTE. Más alto que la media de planta es mejor."
          />
          <MiniMetric
            label="% industria"
            value={dossier.pct_industria > 0 ? `${dossier.pct_industria.toFixed(1)}%` : "—"}
            delta={`${deltaIndustria >= 0 ? "+" : ""}${deltaIndustria.toFixed(1)} pp`}
            deltaTrend={deltaIndustria <= 0 ? "up" : "down"}
            hint={`planta: ${medias.pct_industria_media.toFixed(1)}%`}
            labelInfo="Kg apuntados a industria sobre kg totales. Menos que la media de planta es mejor (más aprovechable)."
          />
          <MiniMetric
            label="Peso fruta"
            value={dossier.peso_fruta_promedio_g !== null ? `${dossier.peso_fruta_promedio_g.toFixed(0)} g` : "—"}
            delta={deltaPeso !== null ? `${deltaPeso >= 0 ? "+" : ""}${deltaPeso.toFixed(0)} g` : undefined}
            deltaTrend="neutral"
            hint={medias.peso_fruta_medio !== null ? `planta: ${medias.peso_fruta_medio.toFixed(0)} g` : undefined}
            last
          />
        </div>
      </div>

      {/* Pestañas de detalle */}
      <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as DetailTab)}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="lotes">Lotes · {dossier.lotes.length}</TabsTrigger>
          <TabsTrigger value="calibres">Calibres y clases</TabsTrigger>
          <TabsTrigger value="calidad">Calidad</TabsTrigger>
          <TabsTrigger value="destino">Destino</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="space-y-3">
          {/* Evolución */}
          <Card className="overflow-hidden glass-accented">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-5 w-1 rounded-full bg-primary" />
                <p className="text-sm font-semibold">Evolución</p>
                <span className="text-[11px] text-muted-foreground">· barras kg/día · línea T/h media</span>
              </div>
              <div className={CHART_PANEL_CLASS}>
                {chartData.length > 0 ? (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={MARGIN}>
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
                        <RechartsTooltip
                          content={
                            <GlassTooltip
                              formatter={(v, name) => (name === "tph" ? `${Number(v).toFixed(1)} T/h` : formatKg(Number(v)))}
                            />
                          }
                        />
                        <Bar
                          yAxisId="kg"
                          dataKey="kg"
                          {...BAR_STYLE}
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
                  <p className="text-sm text-muted-foreground text-center py-8">Sin datos de evolución para este productor.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Desglose por producto */}
          <PorProductoCard porProducto={dossier.por_producto} />
        </TabsContent>

        <TabsContent value="lotes">
          <HistorialLotes dossier={dossier} onLoteClick={onLoteClick} />
        </TabsContent>

        <TabsContent value="calibres" className="space-y-3">
          <CalibresClasesTab dossier={dossier} />
        </TabsContent>

        <TabsContent value="calidad">
          <CalidadProductorCard calidad={dossier.calidad} />
        </TabsContent>

        <TabsContent value="destino" className="space-y-3">
          <PerfilDestinoCard perfil={dossier.perfil_destino} pctGrupoMedio={medias.pct_grupo_medio} />
          <AprovechamientoCard aprovechamiento={dossier.aprovechamiento} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Desglose por producto (barras finas) ─────────────────────────────────

function PorProductoCard({ porProducto }: { porProducto: ProductorDossier["por_producto"] }) {
  const maxKg = Math.max(...porProducto.map((p) => p.kg), 1);
  return (
    <Card className="glass-accented">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-primary" />
          <p className="text-sm font-semibold">Por producto</p>
        </div>
        {porProducto.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin lotes en el periodo.</p>
        ) : (
          <div className="space-y-1.5">
            {porProducto.map((p) => (
              <div key={p.producto} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium">{p.producto}</span>
                  <span className="text-[11px] text-muted-foreground">{p.n_lotes} lote{p.n_lotes === 1 ? "" : "s"}</span>
                  <span className="tabular-nums font-semibold">{formatKg(p.kg)}</span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-[11px] text-muted-foreground">{p.pct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(p.kg / maxKg) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Aprovechamiento (mini-métricas en fila) ───────────────────────────────

const APROVECHAMIENTO_ACCENT_CLASS: Record<"success" | "primary" | "warning" | "destructive", string> = {
  success: "text-success",
  primary: "text-primary",
  warning: "text-warning",
  destructive: "text-destructive",
};

function AprovechamientoCard({ aprovechamiento }: { aprovechamiento: ProductorDossier["aprovechamiento"] }) {
  if (!aprovechamiento) return null;
  const items: Array<{ label: string; value: number; accent: "success" | "primary" | "warning" | "destructive" }> = [
    { label: "Exportación", value: aprovechamiento.pct_exportacion, accent: "success" },
    { label: "No exportación", value: aprovechamiento.pct_no_export, accent: "warning" },
    { label: "No comercial", value: aprovechamiento.pct_no_comercial, accent: "destructive" },
    { label: "Mujeres", value: aprovechamiento.pct_mujeres, accent: "primary" },
    { label: "Industria", value: aprovechamiento.pct_industria, accent: "warning" },
  ];
  return (
    <Card className="glass-accented">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-primary" />
          <p className="text-sm font-semibold">Aprovechamiento</p>
          <InfoTooltip iconClassName="h-3 w-3">
            % Exportación, No exportación, No comercial y Mujeres se calculan sobre los kg clasificados
            en el Informe LOTE. % Industria se calcula sobre los kg totales del productor (lotes_dia) y es
            independiente del Informe LOTE.
          </InfoTooltip>
        </div>
        <div className="grid grid-cols-3 gap-x-2 gap-y-2 sm:flex sm:flex-nowrap">
          {items.map((it, i) => (
            <div key={it.label} className={cn("min-w-0 flex-1 px-2 py-1", i > 0 && "sm:border-l sm:border-[var(--glass-border)]")}>
              <p className="truncate text-[11px] text-muted-foreground">{it.label}</p>
              <p className={cn("text-base font-semibold tabular-nums", APROVECHAMIENTO_ACCENT_CLASS[it.accent])}>{it.value.toFixed(1)}%</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Calidad del productor ───────────────────────────────────────────────

function CalidadProductorCard({ calidad }: { calidad: ProductorDossier["calidad"] }) {
  return (
    <Card className="glass-accented">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-primary" />
          <p className="text-sm font-semibold">Calidad</p>
        </div>
        {!calidad || calidad.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin notas de calidad en el periodo (se anotan en Calidad).
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {CALIDAD_ORDEN.filter((estado) => calidad.porEstado[estado] > 0).map((estado) => (
                <Badge key={estado} variant="outline" className={cn("text-[11px] px-1.5 py-0", QUALITY_STYLE[estado])}>
                  {estado} · {calidad.porEstado[estado]}
                </Badge>
              ))}
              <span className="text-[11px] text-muted-foreground ml-1">
                {calidad.total} nota{calidad.total === 1 ? "" : "s"} · {calidad.incidencias} incidencia{calidad.incidencias === 1 ? "" : "s"}
              </span>
            </div>
            {calidad.defectosFrecuentes.length > 0 && (
              <div>
                <p className="panel-kicker mb-1">Defectos más frecuentes</p>
                <div className="flex flex-wrap gap-1">
                  {calidad.defectosFrecuentes.map(([defecto, count]) => (
                    <Badge key={defecto} variant="secondary" className="text-[10px] px-1.5 py-0">
                      {defecto} × {count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {calidad.historial.length > 1 && (
              <div>
                <p className="panel-kicker mb-1">Historial de incidencias</p>
                <div className="divide-y divide-[var(--glass-border)] rounded-lg border border-[var(--glass-border)]">
                  {calidad.historial.map((nota, i) => (
                    <div
                      key={`${nota.numero_lote}-${nota.fecha}-${i}`}
                      className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1.5 text-xs", i % 2 === 1 && "bg-[var(--glass-bg)]/40")}
                    >
                      <span className="w-16 shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                        {formatDateShort(nota.fecha)}{nota.hora ? ` ${nota.hora}` : ""}
                      </span>
                      <span className="font-medium">{nota.numero_lote}</span>
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", QUALITY_STYLE[nota.calidad])}>{nota.calidad}</Badge>
                      {nota.defectos.length > 0 && (
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{nota.defectos.join(", ")}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Perfil de calidad y destino ─────────────────────────────────────────

// Orden de presentación de los grupos canónicos de destino.
const GRUPO_ORDEN = ["Exportación", "Mercado", "No exportación", "No comercial", "Mujeres", "Otro"];

// Grupos donde un % más BAJO que la media de planta es mejor (más fruta de
// primera, menos descarte). En el resto (Exportación, Mercado) más alto es mejor.
const GRUPO_SENTIDO_INVERSO = new Set(["No exportación", "No comercial", "Mujeres"]);

function PerfilDestinoCard({ perfil, pctGrupoMedio }: {
  perfil: ProductorDossier["perfil_destino"];
  pctGrupoMedio: Record<string, number> | null;
}) {
  const sinDatos = !perfil || perfil.kg_clasificado <= 0;

  const gruposPresentes = useMemo(() => {
    if (!perfil) return [];
    return GRUPO_ORDEN.filter((g) => (perfil.por_grupo[g] ?? 0) > 0).map((grupo) => {
      const kg = perfil.por_grupo[grupo] ?? 0;
      const pct = perfil.kg_clasificado > 0 ? (kg / perfil.kg_clasificado) * 100 : 0;
      const media = pctGrupoMedio?.[grupo] ?? null;
      const delta = media !== null ? pct - media : null;
      // "Mejor" = más alto que la media en grupos normales; más bajo que la
      // media en los grupos de sentido inverso (donde menos es mejor).
      const esMejor = delta === null ? null : GRUPO_SENTIDO_INVERSO.has(grupo) ? delta <= 0 : delta >= 0;
      return { grupo, kg, pct, media, delta, esMejor };
    });
  }, [perfil, pctGrupoMedio]);

  return (
    <Card className="glass-accented">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-primary" />
          <p className="text-sm font-semibold">Perfil de calidad y destino</p>
          <InfoTooltip iconClassName="h-3 w-3">
            Desglose de calibre/clase/grupo de destino a partir del Informe LOTE subido para este productor,
            comparado con la media de planta del periodo. No todos los productores tienen este informe todavía.
          </InfoTooltip>
        </div>
        {sinDatos ? (
          <p className="text-sm text-muted-foreground">
            Sin Informe LOTE en este periodo para este productor.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Barra apilada */}
            <div className="flex h-3 w-full overflow-hidden rounded-md border border-[var(--glass-border)]">
              {gruposPresentes.map(({ grupo, pct }) => (
                <div
                  key={grupo}
                  className="h-full first:rounded-l-sm last:rounded-r-sm"
                  style={{ width: `${pct}%`, backgroundColor: GRUPO_COLORS[grupo] ?? GRUPO_COLORS.Otro }}
                  title={`${grupo}: ${pct.toFixed(1)}%`}
                />
              ))}
            </div>

            {/* Comparativa por grupo */}
            <div className="space-y-1">
              {gruposPresentes.map(({ grupo, pct, media, delta, esMejor }) => (
                <div key={grupo} className="flex items-center gap-2.5 text-xs">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: GRUPO_COLORS[grupo] ?? GRUPO_COLORS.Otro }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{grupo}</span>
                  <span className="tabular-nums font-semibold">{pct.toFixed(1)}%</span>
                  {delta !== null && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
                        esMejor ? "text-success" : "text-destructive"
                      )}
                    >
                      {delta >= 0 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {delta >= 0 ? "+" : ""}{delta.toFixed(1)} pp
                    </span>
                  )}
                  {media !== null && (
                    <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                      planta: {media.toFixed(1)}%
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Top clases */}
            {perfil.top_clases.length > 0 && (
              <div>
                <p className="panel-kicker mb-1">Clases más producidas</p>
                <div className="space-y-1">
                  {perfil.top_clases.map((c) => (
                    <div key={c.clase} className="flex items-center gap-2.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{c.clase}</span>
                      <span className="tabular-nums text-muted-foreground">{formatKg(c.kg)}</span>
                      <span className="w-12 shrink-0 text-right tabular-nums font-medium">{c.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Historial de lotes ───────────────────────────────────────────────────

function HistorialLotes({ dossier, onLoteClick }: { dossier: ProductorDossier; onLoteClick: (partId: string) => void }) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="p-0">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-[var(--glass-bg-solid)] backdrop-blur-xl">
              <tr className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                <th className="whitespace-nowrap">Fecha</th>
                <th className="whitespace-nowrap">Hora</th>
                <th className="whitespace-nowrap">Lote</th>
                <th className="whitespace-nowrap">Producto</th>
                <th className="text-right whitespace-nowrap">Kg</th>
                <th className="text-right whitespace-nowrap">T/h</th>
                <th className="text-right whitespace-nowrap">Duración</th>
                <th className="text-right whitespace-nowrap">Industria</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {dossier.lotes.map((l, i) => (
                <tr
                  key={`${l.part_id}-${l.lote_codigo}-${i}`}
                  className={cn(
                    "border-b border-[var(--glass-border)] last:border-b-0 transition-colors hover:bg-[var(--glass-bg-strong)]",
                    l.part_id && "cursor-pointer",
                    i % 2 === 1 && "bg-[var(--glass-bg)]/40"
                  )}
                  onClick={() => l.part_id && onLoteClick(l.part_id)}
                >
                  <td className="px-3 py-1.5 whitespace-nowrap">{l.fecha !== "—" ? formatDateShort(l.fecha) : "—"}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{l.hora_inicio || "—"}</td>
                  <td className="px-3 py-1.5 font-medium">{l.lote_codigo}</td>
                  <td className="px-3 py-1.5 text-muted-foreground max-w-[140px] truncate">{l.producto}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(l.kg_peso_total)}</td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums font-semibold", tphClass(l.toneladas_hora))}>
                    {l.toneladas_hora !== null ? l.toneladas_hora.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {l.duracion_min !== null ? `${l.duracion_min.toFixed(0)} min` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {l.kg_industria > 0 ? formatKg(l.kg_industria) : "—"}
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    {l.notas && (
                      <Tooltip delayDuration={150}>
                        <TooltipTrigger asChild>
                          <span onClick={(e) => e.stopPropagation()}>
                            <StickyNote className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-primary" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[240px] text-xs">
                          {l.notas}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Móvil: tarjetas compactas 2-col */}
        <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 md:hidden">
          {dossier.lotes.map((l, i) => (
            <div
              key={`${l.part_id}-${l.lote_codigo}-${i}`}
              className={cn(
                "rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 transition-colors",
                l.part_id && "cursor-pointer hover:bg-[var(--glass-bg-strong)]"
              )}
              onClick={() => l.part_id && onLoteClick(l.part_id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{l.lote_codigo}</span>
                <span className="text-[11px] text-muted-foreground">
                  {l.fecha !== "—" ? formatDateShort(l.fecha) : "—"}{l.hora_inicio ? ` · ${l.hora_inicio}` : ""}
                </span>
              </div>
              <p className="truncate text-[11px] text-muted-foreground mt-0.5">{l.producto}</p>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                <MobileField label="Kg" value={formatKg(l.kg_peso_total)} />
                <MobileField label="T/h" value={l.toneladas_hora !== null ? l.toneladas_hora.toFixed(1) : "—"} valueClass={tphClass(l.toneladas_hora)} />
                <MobileField label="Duración" value={l.duracion_min !== null ? `${l.duracion_min.toFixed(0)} min` : "—"} muted />
                <MobileField label="Industria" value={l.kg_industria > 0 ? formatKg(l.kg_industria) : "—"} muted />
              </div>
              {l.notas && <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={l.notas}>{l.notas}</p>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Calibres y clases (matriz + distribución + tabla completa) ──────────

function CalibresClasesTab({ dossier }: { dossier: ProductorDossier }) {
  const sinDatos = dossier.calibres.length === 0 && dossier.clases_completas.length === 0;

  if (sinDatos) {
    return (
      <Card className="glass-accented">
        <CardContent className="py-12 text-center">
          <Ruler className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium">Sin informes de lote en el periodo</p>
          <p className="mt-1 text-xs text-muted-foreground">
            El calibre y la clase salen del Informe LOTE al analizar cada parte de este productor con IA.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <MatrizCalibreClase dossier={dossier} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DistribucionCalibresCard calibres={dossier.calibres} />
        <ClasesCompletasCard clases={dossier.clases_completas} />
      </div>
    </>
  );
}

function MatrizCalibreClase({ dossier }: { dossier: ProductorDossier }) {
  const clasesCols = useMemo(() => {
    const map = new Map<string, number>();
    for (const fila of Object.values(dossier.matriz_calibre_clase)) {
      for (const [clase, kg] of Object.entries(fila)) {
        map.set(clase, (map.get(clase) ?? 0) + kg);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([clase]) => clase);
  }, [dossier.matriz_calibre_clase]);

  const filas = dossier.calibres; // ya ordenadas por kg desc

  const maxCell = useMemo(() => {
    let max = 1;
    for (const fila of Object.values(dossier.matriz_calibre_clase)) {
      for (const kg of Object.values(fila)) if (kg > max) max = kg;
    }
    return max;
  }, [dossier.matriz_calibre_clase]);

  if (filas.length === 0 || clasesCols.length === 0) return null;

  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <div className="h-5 w-1 shrink-0 rounded-full bg-primary" />
          <p className="text-sm font-semibold">Calibre × Clase</p>
          <InfoTooltip iconClassName="h-3 w-3">
            Kg por combinación de calibre (tamaño) y clase, sumados en el periodo para este productor.
            El color más intenso marca dónde se concentra su producción.
          </InfoTooltip>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--glass-border)]">
                <th className="sticky left-0 z-10 bg-[var(--glass-bg-solid)] px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Calibre</th>
                {clasesCols.map((clase) => (
                  <th key={clase} className="px-3 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{clase}</th>
                ))}
                <th className="px-3 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => {
                const filaMatriz = dossier.matriz_calibre_clase[fila.tamano] ?? {};
                return (
                  <tr key={fila.tamano} className={cn("border-b border-[var(--glass-border)] last:border-b-0", i % 2 === 1 && "bg-[var(--glass-bg)]/40")}>
                    <td className="sticky left-0 z-10 bg-[var(--glass-bg-solid)] px-3 py-1.5 font-medium whitespace-nowrap">{fila.tamano}</td>
                    {clasesCols.map((clase) => {
                      const kg = filaMatriz[clase] ?? 0;
                      const alpha = kg > 0 ? 0.04 + (kg / maxCell) * 0.24 : 0;
                      return (
                        <td
                          key={clase}
                          className={cn("px-3 py-1.5 text-right tabular-nums text-xs", kg === 0 && "text-muted-foreground/30")}
                          style={alpha > 0 ? { backgroundColor: `hsl(24 95% 53% / ${alpha.toFixed(3)})` } : undefined}
                        >
                          {kg > 0 ? nf.format(Math.round(kg)) : "—"}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{nf.format(Math.round(fila.kg))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function DistribucionCalibresCard({ calibres }: { calibres: ProductorDossier["calibres"] }) {
  const maxKg = Math.max(...calibres.map((c) => c.kg), 1);
  return (
    <Card className="glass-accented">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-primary" />
          <p className="text-sm font-semibold">Distribución de calibres</p>
        </div>
        {calibres.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin datos de calibre en el periodo.</p>
        ) : (
          <div className="space-y-1.5">
            {calibres.map((c) => (
              <div key={c.tamano} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium">{c.tamano}</span>
                  <span className="text-[11px] text-muted-foreground">{nf.format(c.piezas)} pzas</span>
                  <span className="tabular-nums font-semibold">{formatKg(c.kg)}</span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-[11px] text-muted-foreground">{c.pct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(c.kg / maxKg) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClasesCompletasCard({ clases }: { clases: ProductorDossier["clases_completas"] }) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <div className="h-5 w-1 rounded-full bg-primary" />
          <p className="text-sm font-semibold">Todas las clases</p>
        </div>
        {clases.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">Sin datos de clase en el periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                  <th className="whitespace-nowrap">Clase</th>
                  <th className="whitespace-nowrap">Grupo</th>
                  <th className="text-right whitespace-nowrap">Kg</th>
                  <th className="text-right whitespace-nowrap">%</th>
                  <th className="text-right whitespace-nowrap">Piezas</th>
                  <th className="text-right whitespace-nowrap">Cartones</th>
                </tr>
              </thead>
              <tbody>
                {clases.map((c, i) => (
                  <tr key={c.clase} className={cn("border-b border-[var(--glass-border)] last:border-b-0", i % 2 === 1 && "bg-[var(--glass-bg)]/40")}>
                    <td className="px-3 py-1.5 font-medium">{c.clase}</td>
                    <td className="px-3 py-1.5">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-transparent"
                        style={{
                          backgroundColor: barFill(GRUPO_COLORS[c.grupo] ?? GRUPO_COLORS.Otro, 0.14),
                          color: GRUPO_COLORS[c.grupo] ?? GRUPO_COLORS.Otro,
                        }}
                      >
                        {c.grupo}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(c.kg)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{c.pct.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{c.piezas > 0 ? nf.format(c.piezas) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{c.cartons > 0 ? nf.format(c.cartons) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
