/**
 * M2 — Módulo de trazabilidad por productor
 * Tabla por productor × día con kg, T/h, peso fruta promedio, nº lotes.
 * Histórico y alertas de calibre derivante.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { KPICard } from "@/components/KPICard";
import { formatKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Users, AlertTriangle, TrendingUp, Gauge, Search } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
} from "recharts";
import {
  GlassTooltip, C, GRID, XAXIS, YAXIS, MARGIN, legendStyle,
  CHART_CURSOR, CHART_LINE_CURSOR, CHART_PANEL_CLASS, areaStops, lineStyle,
} from "@/lib/chartTheme";
import { toast } from "@/hooks/use-toast";

interface LoteDia {
  id: string;
  part_id: string;
  lote_codigo: string | null;
  productor: string | null;
  producto: string | null;
  kg_peso_total: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  peso_fruta_promedio_g: number | null;
  hora_inicio: string | null;
  created_at: string;
  parte_date?: string;
}

interface ProductorStats {
  productor: string;
  kg_total: number;
  n_lotes: number;
  tph_promedio: number | null;
  peso_fruta_promedio_g: number | null;
  ultimo_dia: string | null;
  lotes: LoteDia[];
}

type LoteDiaRow = LoteDia & {
  partes_diarios?: { date?: string | null } | null;
};

function TphBadge({ tph }: { tph: number | null }) {
  if (tph === null) return <span className="text-muted-foreground text-xs">N/D</span>;
  const color =
    tph >= 18 ? "text-success" : tph >= 14 ? "text-warning" : "text-destructive";
  return (
    <span className={cn("tabular-nums font-semibold text-sm", color)}>
      {tph.toFixed(2)} T/h
    </span>
  );
}

export default function Productores() {
  const [lotes, setLotes] = useState<LoteDia[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(today);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("lotes_dia")
      .select("*, partes_diarios!inner(date)")
      .gte("partes_diarios.date", dateFrom)
      .lte("partes_diarios.date", dateTo)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error cargando lotes", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows: LoteDia[] = ((data ?? []) as LoteDiaRow[]).map((r) => ({
      ...r,
      parte_date: r.partes_diarios?.date ?? null,
    })).sort((a, b) => (b.parte_date ?? "").localeCompare(a.parte_date ?? ""));
    setLotes(rows);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { setSelected(null); load(); }, [load]);

  // Agrupar por productor
  const byProductor = useMemo<ProductorStats[]>(() => {
    const map: Record<string, LoteDia[]> = {};
    lotes.forEach((l) => {
      const key = l.productor ?? "Sin productor";
      if (!map[key]) map[key] = [];
      map[key].push(l);
    });

    return Object.entries(map)
      .map(([productor, ls]) => {
        const kg_total = ls.reduce((s, l) => s + (l.kg_peso_total ?? 0), 0);
        const lotesConTph = ls.filter((l) => l.toneladas_hora && l.toneladas_hora > 0);
        const totalMin = lotesConTph.reduce((s, l) => s + (l.duracion_min ?? 0), 0);
        const tph_promedio =
          lotesConTph.length > 0
            ? totalMin > 0
              ? lotesConTph.reduce((s, l) => s + l.toneladas_hora! * (l.duracion_min ?? 1), 0) / totalMin
              : lotesConTph.reduce((s, l) => s + l.toneladas_hora!, 0) / lotesConTph.length
            : null;
        const lotesConPeso = ls.filter((l) => l.peso_fruta_promedio_g && l.peso_fruta_promedio_g > 0);
        const peso_fruta_promedio_g =
          lotesConPeso.length > 0
            ? lotesConPeso.reduce((s, l) => s + l.peso_fruta_promedio_g!, 0) / lotesConPeso.length
            : null;
        const fechas = ls.map((l) => l.parte_date).filter(Boolean).sort().reverse();
        return {
          productor,
          kg_total,
          n_lotes: ls.length,
          tph_promedio,
          peso_fruta_promedio_g,
          ultimo_dia: fechas[0] ?? null,
          lotes: ls,
        };
      })
      .sort((a, b) => b.kg_total - a.kg_total);
  }, [lotes]);

  const filtered = useMemo(() => {
    if (!search) return byProductor;
    const q = search.toLowerCase();
    return byProductor.filter((p) => p.productor.toLowerCase().includes(q));
  }, [byProductor, search]);

  const selectedStats = useMemo(
    () => (selected ? byProductor.find((p) => p.productor === selected) ?? null : null),
    [selected, byProductor]
  );

  // Serie histórica T/h del productor seleccionado
  const tphSeries = useMemo(() => {
    if (!selectedStats) return [];
    return [...selectedStats.lotes]
      .filter((l) => l.parte_date && l.toneladas_hora)
      .sort((a, b) => (a.parte_date ?? "").localeCompare(b.parte_date ?? ""))
      .map((l) => ({
        date: l.parte_date ?? "",
        tph: l.toneladas_hora ?? 0,
        kg: l.kg_peso_total,
        lote: l.lote_codigo ?? "",
      }));
  }, [selectedStats]);

  // Serie diaria de kg para el productor seleccionado
  const dailyKg = useMemo(() => {
    if (!selectedStats) return [];
    const map = new Map<string, number>();
    for (const l of selectedStats.lotes) {
      const day = l.parte_date;
      if (!day) continue;
      map.set(day, (map.get(day) ?? 0) + (l.kg_peso_total || 0));
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, kg]) => ({ fecha, kg }));
  }, [selectedStats]);

  // KPIs globales
  const totalKg = byProductor.reduce((s, p) => s + p.kg_total, 0);
  const lotesConTph = lotes.filter((l) => l.toneladas_hora && l.toneladas_hora > 0);
  const totalMin = lotesConTph.reduce((s, l) => s + (l.duracion_min ?? 0), 0);
  const avgTph =
    lotesConTph.length > 0
      ? totalMin > 0
        ? lotesConTph.reduce((s, l) => s + l.toneladas_hora! * (l.duracion_min ?? 1), 0) / totalMin
        : lotesConTph.reduce((s, l) => s + l.toneladas_hora!, 0) / lotesConTph.length
      : null;
  const nProductores = byProductor.length;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Productores
          </h1>
          <p className="page-subtitle">
            Trazabilidad por productor · kg, T/h, peso fruta promedio — filtrado por fecha del parte
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl glass border border-[var(--glass-border)] px-3 py-2 shadow-[var(--glass-shadow)]">
          <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Desde</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-34 h-8 text-xs glass glass-hover"
          />
          <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Hasta</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-34 h-8 text-xs glass glass-hover"
          />
        </div>
      </header>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KPICard label="Productores activos" value={String(nProductores)} icon={Users} />
            <KPICard label="Kg totales procesados" value={formatKg(totalKg)} icon={TrendingUp} />
            <KPICard
              label="T/h media"
              value={avgTph ? `${avgTph.toFixed(2)} T/h` : "N/D"}
              icon={Gauge}
              trend={avgTph ? (avgTph >= 16 ? "up" : "down") : "neutral"}
            />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Lista productores */}
        <div className="lg:col-span-1 space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar productor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>

          <Card className="glass">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-10 text-center">
                  <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Sin datos. Importa informes de producción para ver los productores.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-[var(--glass-border)]">
                  {filtered.map((p) => {
                    const isSelected = selected === p.productor;
                    const tphOk = p.tph_promedio !== null && p.tph_promedio >= 14;
                    return (
                      <li key={p.productor}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelected(isSelected ? null : p.productor)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelected(isSelected ? null : p.productor);
                            }
                          }}
                          className={cn(
                            "w-full text-left px-4 py-3 transition-colors cursor-pointer glass-hover",
                            isSelected && "bg-primary/5 border-l-2 border-l-primary"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">{p.productor}</span>
                              <Link
                                to={`/partes`}
                                className="text-[10px] font-medium text-primary/70 hover:text-primary shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Ver partes →
                              </Link>
                            </div>
                            {p.tph_promedio !== null && !tphOk && (
                              <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatKg(p.kg_total)}
                            </span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">
                              {p.n_lotes} lote{p.n_lotes !== 1 ? "s" : ""}
                            </span>
                            {p.tph_promedio !== null && (
                              <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <TphBadge tph={p.tph_promedio} />
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detalle del productor seleccionado */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedStats ? (
            <Card className="glass-accented">
              <CardContent className="py-16 text-center text-sm text-muted-foreground space-y-2">
                <Users className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p>Selecciona un productor de la lista para ver su histórico detallado.</p>
                <p className="text-xs text-muted-foreground/60">
                  Datos desde {dateFrom} hasta {dateTo}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="glass-accented">
                <CardContent className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      Kg totales
                    </p>
                    <p className="text-xl font-bold tabular-nums">{formatKg(selectedStats.kg_total)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      Nº lotes
                    </p>
                    <p className="text-xl font-bold tabular-nums">{selectedStats.n_lotes}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      T/h medio
                    </p>
                    <TphBadge tph={selectedStats.tph_promedio} />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                      Peso fruta prom.
                    </p>
                    <p className="text-xl font-bold tabular-nums">
                      {selectedStats.peso_fruta_promedio_g
                        ? `${selectedStats.peso_fruta_promedio_g.toFixed(0)} g`
                        : "N/D"}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-accented">
                <CardHeader className="pb-3 px-5 pt-4">
                  <div className="flex items-center gap-3">
                    <div className="h-7 w-1 rounded-full bg-primary" />
                    <div>
                      <CardTitle className="text-lg font-semibold">Evolución T/h — {selectedStats.productor}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">Velocidad de procesamiento por lote</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-1">
                  <div className={CHART_PANEL_CLASS}>
                  {tphSeries.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={tphSeries} margin={MARGIN}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="date" {...XAXIS} />
                        <YAxis {...YAXIS} domain={["auto", "auto"]} tickFormatter={(v) => `${v} T/h`} width={54} />
                        <Tooltip cursor={CHART_LINE_CURSOR} content={<GlassTooltip formatter={(v, name) => name === "tph" ? `${Number(v).toFixed(2)} T/h` : formatKg(Number(v))} />} />
                        <Legend wrapperStyle={legendStyle} formatter={(v) => v === "tph" ? "T/h" : "kg lote"} />
                        <Line dataKey="tph" {...lineStyle(C.primary)} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">Sin datos de velocidad (T/h) para este productor en el período seleccionado.</p>
                  )}
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-accented">
                <CardHeader className="pb-3 px-5 pt-4">
                  <div className="flex items-center gap-3">
                    <div className="h-7 w-1 rounded-full bg-primary" />
                    <div>
                      <CardTitle className="text-lg font-semibold">Producción diaria — {selectedStats.productor}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">Kg totales procesados por día</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-1">
                  <div className={CHART_PANEL_CLASS}>
                  {dailyKg.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={dailyKg} margin={MARGIN}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="fecha" {...XAXIS} />
                        <YAxis {...YAXIS} tickFormatter={(v) => `${(v / 1000).toFixed(0)}t`} width={36} />
                        <Tooltip cursor={CHART_CURSOR} content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                        {areaStops("productorKgFill", C.primary)}
                        <Area type="monotone" dataKey="kg" stroke={C.primary} strokeWidth={2.5} fill="url(#productorKgFill)" dot={false} activeDot={lineStyle(C.primary).activeDot} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">Sin producción registrada para este productor en el período seleccionado.</p>
                  )}
                  </div>
                </CardContent>
              </Card>

              {/* Tabla lotes */}
              <Card className="glass">
                <CardContent className="p-0">
                  <table className="w-full text-sm data-table">
                    <thead>
                      <tr>
                        <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-4">Fecha</th>
                        <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-4">Lote</th>
                        <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-4">Producto</th>
                        <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right sm:px-4">Kg</th>
                        <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right sm:px-4">T/h</th>
                        <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right sm:px-4">Peso fruta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...selectedStats.lotes]
                        .sort((a, b) => (b.parte_date ?? "").localeCompare(a.parte_date ?? ""))
                        .map((l) => (
                          <tr key={l.id}>
                            <td className="text-xs text-muted-foreground">{l.parte_date ?? "—"}</td>
                            <td className="text-xs font-mono">{l.lote_codigo ?? "—"}</td>
                            <td className="text-xs">{l.producto ?? "—"}</td>
                            <td className="text-right tabular-nums text-sm font-medium">{formatKg(l.kg_peso_total)}</td>
                            <td className="text-right">
                              <TphBadge tph={l.toneladas_hora ?? null} />
                            </td>
                            <td className="text-right tabular-nums text-xs text-muted-foreground">
                              {l.peso_fruta_promedio_g ? `${l.peso_fruta_promedio_g.toFixed(0)} g` : "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
