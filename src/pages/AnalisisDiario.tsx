// src/pages/AnalisisDiario.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, Search, RefreshCw, FileText, BarChart3,
  Gauge, PackageCheck, Timer, AlertCircle, Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnalisisDiario } from "@/hooks/useAnalisisDiario";
import { KPICard } from "@/components/KPICard";
import { DailyListTable } from "@/components/DailyListTable";
import { WeekSelector } from "@/components/WeekSelector";
import { buildWeekRange } from "@/lib/analisisDiarioView";
import type { Periodo } from "@/lib/analisisDiarioView";
import { today } from "@/lib/format";

function formatKg(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + " t";
  return v.toFixed(0) + " kg";
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

export default function AnalisisDiario() {
  const [searchParams] = useSearchParams();
  const queryDesde = searchParams.get("desde");
  const queryHasta = searchParams.get("hasta");
  const hasQueryRange = Boolean(queryDesde && queryHasta);
  const [periodo, setPeriodo] = useState<Periodo>(() => (hasQueryRange ? "custom" : "esta_semana"));
  const [customDesde, setCustomDesde] = useState(() => queryDesde ?? daysAgo(30));
  const [customHasta, setCustomHasta] = useState(() => queryHasta ?? today());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!queryDesde || !queryHasta) return;
    setPeriodo("custom");
    setCustomDesde(queryDesde);
    setCustomHasta(queryHasta);
  }, [queryDesde, queryHasta]);

  const weekRange = useMemo(
    () => buildWeekRange(periodo, customDesde, customHasta),
    [periodo, customDesde, customHasta]
  );

  const { data, loading, error, refetch } = useAnalisisDiario(weekRange.start, weekRange.end);

  const hayDatos = data.totals.n_lotes > 0 || data.totals.kg_calibres > 0;

  const searchLower = normalizeText(search).trim();

  const filteredLotes = useMemo(() => {
    if (!searchLower) return data.lotes;
    return data.lotes.filter((l) =>
      normalizeText(l.productor).includes(searchLower) ||
      normalizeText(l.producto).includes(searchLower) ||
      normalizeText(l.lote_codigo).includes(searchLower) ||
      normalizeText(l.fecha).includes(searchLower)
    );
  }, [data.lotes, searchLower]);

  const handleNavigateWeek = (direction: -1 | 1) => {
    const start = new Date(weekRange.start + "T12:00:00");
    start.setDate(start.getDate() + direction * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    setCustomDesde(start.toISOString().slice(0, 10));
    setCustomHasta(end.toISOString().slice(0, 10));
    setPeriodo("custom");
  };

  return (
    <div className="page-shell">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header className="page-header">
        <div>
          <h1 className="page-title">Analisis Diario</h1>
          <p className="page-subtitle">
            {formatFechaLarga(weekRange.start)} — {formatFechaLarga(weekRange.end)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading} className="glass glass-hover">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </header>

      {/* ─── Selector de periodo ────────────────────────────────── */}
      <WeekSelector
        periodo={periodo}
        onPeriodoChange={setPeriodo}
        customDesde={customDesde}
        customHasta={customHasta}
        onCustomDesdeChange={setCustomDesde}
        onCustomHastaChange={setCustomHasta}
        onNavigateWeek={handleNavigateWeek}
      />

      {/* ─── Loading ────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando datos...</span>
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
            <Button variant="outline" size="sm" onClick={refetch} className="ml-auto glass glass-hover">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reintentar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Contenido principal ────────────────────────────────── */}
      {!loading && hayDatos && (
        <>
          {/* KPIs */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard label="Kg totales" value={formatKg(data.totals.kg_lotes)} hint={`${data.totals.n_lotes} lotes procesados`} icon={PackageCheck} />
            <KPICard
              label="Velocidad media"
              value={data.totals.avg_tph ? `${data.totals.avg_tph.toFixed(1)} T/h` : "—"}
              hint={`${data.totals.n_dias} días de producción`}
              icon={Gauge}
              trend={data.totals.avg_tph ? (data.totals.avg_tph >= 16 ? "up" : "down") : "neutral"}
            />
            <KPICard
              label="Lotes lentos"
              value={String(data.totals.n_lotes_lentos)}
              hint={`${formatHoras(data.totals.total_min)} tiempo total`}
              icon={Timer}
              trend={data.totals.n_lotes_lentos <= 3 ? "up" : "down"}
            />
            <KPICard label="Días analizados" value={String(data.totals.n_dias)} hint="con datos de detalle" icon={Calendar} />
          </section>

          {/* Toolbar de busqueda */}
          <div className="section-toolbar">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar productor, producto, lote..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-64 h-8"
              />
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="lotes" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="lotes">
                Lotes <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{filteredLotes.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="clase">
                Clase <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{data.clases.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="grupo">
                Grupo <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{data.grupos.length}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="lotes">
              <DailyListTable lotes={filteredLotes} />
            </TabsContent>
            <TabsContent value="clase">
              <ClaseTabSummary clases={data.clases} totalKg={data.totals.kg_calibres} />
            </TabsContent>
            <TabsContent value="grupo">
              <GrupoTabSummary grupos={data.grupos} totalKg={data.totals.kg_calibres} />
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* ─── Empty state ────────────────────────────────────────── */}
      {!loading && !hayDatos && (
        <Card className="glass-accented">
          <CardContent className="py-12 text-center">
            <BarChart3 className="size-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-lg">No hay datos de detalle para este periodo</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
              Para ver datos aqui necesitas subir el informe de tamaños/calibres al parte y pulsar "Analizar".
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button asChild className="glass glass-hover">
                <Link to="/partes"><FileText className="h-4 w-4" /> Ir a Partes</Link>
              </Button>
              <Button variant="outline" onClick={() => setPeriodo("ultimas_4")} className="glass glass-hover">
                Ampliar a 4 semanas
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Clase tab ──────────────────────────────────────────────────────────────

function ClaseTabSummary({ clases, totalKg }: { clases: Array<{ clase: string; kg_total: number; n_registros: number; n_dias: number; grupos: Record<string, number> }>; totalKg: number }) {
  if (clases.length === 0) {
    return (
      <Card className="glass-accented">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Sin resultados de clase</p>
        </CardContent>
      </Card>
    );
  }

  const CLASE_COLORS = {
    Exportación:      { bg: "bg-success/8",   border: "border-success/25",   pill: "bg-success text-success-foreground",  bar: "bg-success" },
    Mercado:          { bg: "bg-info/8",      border: "border-info/25",      pill: "bg-info text-info-foreground",        bar: "bg-info" },
    "No exportación": { bg: "bg-warning/8",   border: "border-warning/25",   pill: "bg-warning text-warning-foreground",  bar: "bg-warning" },
    "No comercial":   { bg: "bg-destructive/8", border: "border-destructive/25", pill: "bg-destructive text-destructive-foreground", bar: "bg-destructive" },
    Mujeres:          { bg: "bg-info/8",      border: "border-info/25",      pill: "bg-info text-info-foreground",        bar: "bg-info" },
    Otro:             { bg: "bg-muted/30",    border: "border-border",        pill: "glass border border-[var(--glass-border)] text-muted-foreground", bar: "bg-muted-foreground/50" },
  } as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2">Distribución por clase</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {clases.map((c) => {
          const pct = totalKg > 0 ? (c.kg_total / totalKg) * 100 : 0;
          const gruposOrdenados = Object.entries(c.grupos).sort((a, b) => b[1] - a[1]);
          const maxGrupoKg = gruposOrdenados.length > 0 ? gruposOrdenados[0][1] : 1;
          const colors = CLASE_COLORS[c.clase as keyof typeof CLASE_COLORS] ?? CLASE_COLORS.Otro;
          return (
            <div key={c.clase} className={cn("rounded-xl border p-5 space-y-3 shadow-[var(--glass-shadow)] backdrop-blur-xl", colors.bg, colors.border)}>
              {/* Nombre de categoría en pill */}
              <div className="flex items-center justify-between gap-3">
                <span className={cn("inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-bold", colors.pill)}>
                  {c.clase}
                </span>
                <span className="text-sm font-semibold text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
              </div>

              {/* Peso total */}
              <p className="text-2xl font-bold tabular-nums text-foreground">{formatKg(c.kg_total)}</p>

              {/* Barra */}
              <div className="space-y-1.5">
                <div className="h-2 w-full rounded-full bg-[var(--glass-bg-strong)] overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-500", colors.bar)} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground">{c.n_registros} lotes · {c.n_dias} {c.n_dias === 1 ? "día" : "días"}</p>
              </div>

              {/* Grupos */}
              {gruposOrdenados.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-[var(--glass-border)]">
                  {gruposOrdenados.map(([g, kg]) => {
                    const gPct = c.kg_total > 0 ? (kg / c.kg_total) * 100 : 0;
                    const barWidth = maxGrupoKg > 0 ? (kg / maxGrupoKg) * 100 : 0;
                    const gc = CLASE_COLORS[g as keyof typeof CLASE_COLORS] ?? CLASE_COLORS.Otro;
                    return (
                      <div key={g} className="flex items-center gap-2.5">
                        <div className={cn("h-2 w-2 rounded-full shrink-0", gc.bar)} />
                        <span className="text-sm font-medium w-28 shrink-0 truncate">{g}</span>
                        <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                          <div className={cn("h-full rounded-full transition-all duration-500", gc.bar)} style={{ width: `${barWidth}%` }} />
                        </div>
                        <span className="text-xs font-mono tabular-nums text-muted-foreground w-16 text-right shrink-0">{formatKg(kg)}</span>
                        <span className="text-[10px] font-mono tabular-nums text-muted-foreground w-8 text-right shrink-0">{gPct.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Grupo tab ──────────────────────────────────────────────────────────────

function GrupoTabSummary({ grupos, totalKg }: { grupos: Array<{ grupo: string; kg_total: number; n_registros: number; n_dias: number }>; totalKg: number }) {
  if (grupos.length === 0) {
    return (
      <Card className="glass-accented">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Sin resultados de grupo</p>
        </CardContent>
      </Card>
    );
  }

  const GRUPO_COLORS = {
    Exportación:      { bg: "bg-success/8",   border: "border-success/25",   pill: "bg-success text-success-foreground",  bar: "bg-success" },
    Mercado:          { bg: "bg-info/8",      border: "border-info/25",      pill: "bg-info text-info-foreground",        bar: "bg-info" },
    "No exportación": { bg: "bg-warning/8",   border: "border-warning/25",   pill: "bg-warning text-warning-foreground",  bar: "bg-warning" },
    "No comercial":   { bg: "bg-destructive/8", border: "border-destructive/25", pill: "bg-destructive text-destructive-foreground", bar: "bg-destructive" },
    Mujeres:          { bg: "bg-info/8",      border: "border-info/25",      pill: "bg-info text-info-foreground",        bar: "bg-info" },
    Otro:             { bg: "bg-muted/30",    border: "border-border",        pill: "glass border border-[var(--glass-border)] text-muted-foreground", bar: "bg-muted-foreground/50" },
  } as const;

  const maxKg = grupos.length > 0 ? Math.max(...grupos.map((g) => g.kg_total)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2">Distribución por grupo</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {grupos.map((g) => {
          const pct = totalKg > 0 ? (g.kg_total / totalKg) * 100 : 0;
          const barWidth = maxKg > 0 ? (g.kg_total / maxKg) * 100 : 0;
          const colors = GRUPO_COLORS[g.grupo as keyof typeof GRUPO_COLORS] ?? GRUPO_COLORS.Otro;
          return (
            <div key={g.grupo} className={cn("rounded-xl border p-5 space-y-3 shadow-[var(--glass-shadow)] backdrop-blur-xl", colors.bg, colors.border)}>
              {/* Nombre del grupo en pill */}
              <div className="flex items-center justify-between gap-3">
                <span className={cn("inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-bold", colors.pill)}>
                  {g.grupo}
                </span>
                <span className="text-sm font-semibold text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
              </div>

              {/* Peso total */}
              <p className="text-2xl font-bold tabular-nums text-foreground">{formatKg(g.kg_total)}</p>

              {/* Barra */}
              <div className="space-y-1.5">
                <div className="h-2 w-full rounded-full bg-[var(--glass-bg-strong)] overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-500", colors.bar)} style={{ width: `${barWidth}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground">{g.n_registros} lotes · {g.n_dias} {g.n_dias === 1 ? "día" : "días"}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
