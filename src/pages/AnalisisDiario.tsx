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
import { useAnalisisDiario } from "@/hooks/useAnalisisDiario";
import { KPICard } from "@/components/KPICard";
import { DailyListTable } from "@/components/DailyListTable";
import { WeekSelector } from "@/components/WeekSelector";
import {
  buildWeekRange,
} from "@/lib/analisisDiarioView";
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

const CLASE_COLORS: Record<string, string> = {
  Exportación: "text-success",
  Mercado: "text-info",
  "No exportación": "text-warning",
  "No comercial": "text-destructive",
  Mujeres: "text-info",
  Otro: "text-muted-foreground",
};

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
      <div className="page-header">
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
      </div>

      <WeekSelector
        periodo={periodo}
        onPeriodoChange={setPeriodo}
        customDesde={customDesde}
        customHasta={customHasta}
        onCustomDesdeChange={setCustomDesde}
        onCustomHastaChange={setCustomHasta}
        onNavigateWeek={handleNavigateWeek}
      />

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando datos...</span>
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

      {!loading && hayDatos && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard label="Kg totales" value={formatKg(data.totals.kg_lotes)} hint={`${data.totals.n_lotes} lotes`} icon={PackageCheck} />
            <KPICard
              label="Velocidad media"
              value={data.totals.avg_tph ? `${data.totals.avg_tph.toFixed(1)} T/h` : "—"}
              hint={`${data.totals.n_dias} dias operativos`}
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
            <KPICard label="Dias analizados" value={String(data.totals.n_dias)} icon={Calendar} />
          </section>

          {hayDatos && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar productor, producto, lote..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-64 h-8"
              />
            </div>
          )}

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
      <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] py-12 text-center">
        <p className="text-sm text-muted-foreground">Sin resultados de clase</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {clases.map((c) => {
        const pct = totalKg > 0 ? (c.kg_total / totalKg) * 100 : 0;
        const gruposOrdenados = Object.entries(c.grupos).sort((a, b) => b[1] - a[1]);
        return (
          <div key={c.clase} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
            <div className="flex items-center justify-between gap-4 mb-2">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold ${CLASE_COLORS[c.clase] ?? ""}`}>{c.clase}</span>
                <Badge variant="secondary" className="text-xs">{c.n_registros} registros</Badge>
                <Badge variant="secondary" className="text-xs">{c.n_dias} dias</Badge>
              </div>
              <div className="text-right">
                <span className="font-mono font-semibold tabular-nums">{formatKg(c.kg_total)}</span>
                <span className="text-xs text-muted-foreground ml-2">{pct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
              <div
                className="h-full rounded-full transition-all duration-500 bg-primary/40"
                style={{ width: `${pct}%` }}
              />
            </div>
            {gruposOrdenados.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {gruposOrdenados.map(([g, kg]) => (
                  <Badge key={g} variant="outline" className={`text-xs ${CLASE_COLORS[g] ?? ""}`}>
                    {g}: {formatKg(kg)}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Grupo tab ──────────────────────────────────────────────────────────────

function GrupoTabSummary({ grupos, totalKg }: { grupos: Array<{ grupo: string; kg_total: number; n_registros: number; n_dias: number }>; totalKg: number }) {
  if (grupos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] py-12 text-center">
        <p className="text-sm text-muted-foreground">Sin resultados de grupo</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {grupos.map((g) => {
        const pct = totalKg > 0 ? (g.kg_total / totalKg) * 100 : 0;
        return (
          <div key={g.grupo} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
            <div className="flex items-center justify-between gap-4 mb-2">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold ${CLASE_COLORS[g.grupo] ?? ""}`}>{g.grupo}</span>
                <Badge variant="secondary" className="text-xs">{g.n_registros} registros</Badge>
                <Badge variant="secondary" className="text-xs">{g.n_dias} dias</Badge>
              </div>
              <div className="text-right">
                <span className="font-mono font-semibold tabular-nums">{formatKg(g.kg_total)}</span>
                <span className="text-xs text-muted-foreground ml-2">{pct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
              <div
                className="h-full rounded-full transition-all duration-500 bg-primary/40"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
