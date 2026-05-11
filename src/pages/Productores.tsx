/**
 * M2 — Módulo de trazabilidad por productor
 * Tabla por productor × día con kg, T/h, peso fruta promedio, nº lotes.
 * Histórico y alertas de calibre derivante.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { KPICard } from "@/components/KPICard";
import { formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Users, AlertTriangle, TrendingUp, TrendingDown, Gauge, Search } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
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
  const [since, setSince] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("lotes_dia")
      .select("*, partes_diarios(date)")
      .gte("created_at", since + "T00:00:00")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error cargando lotes", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows: LoteDia[] = (data ?? []).map((r: any) => ({
      ...r,
      parte_date: r.partes_diarios?.date ?? null,
    }));
    setLotes(rows);
    setLoading(false);
  }

  useEffect(() => { load(); }, [since]);

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
        const tph_promedio =
          lotesConTph.length > 0
            ? lotesConTph.reduce((s, l) => s + l.toneladas_hora!, 0) / lotesConTph.length
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
        date: l.parte_date?.slice(5) ?? "",
        tph: l.toneladas_hora ?? 0,
        kg: l.kg_peso_total,
        lote: l.lote_codigo ?? "",
      }));
  }, [selectedStats]);

  // KPIs globales
  const totalKg = byProductor.reduce((s, p) => s + p.kg_total, 0);
  const avgTph =
    byProductor.filter((p) => p.tph_promedio !== null).length > 0
      ? byProductor
          .filter((p) => p.tph_promedio !== null)
          .reduce((s, p) => s + p.tph_promedio!, 0) /
        byProductor.filter((p) => p.tph_promedio !== null).length
      : null;
  const nProductores = byProductor.length;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6 text-muted-foreground" />
            Productores
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Trazabilidad por productor · kg, T/h, peso fruta promedio — datos desde importación de informes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground">Desde</label>
          <Input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="w-36 h-9"
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

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Sin datos. Importa informes de producción para ver los productores.
                </div>
              ) : (
                <ul className="divide-y">
                  {filtered.map((p) => {
                    const isSelected = selected === p.productor;
                    const tphOk = p.tph_promedio !== null && p.tph_promedio >= 14;
                    return (
                      <li key={p.productor}>
                        <button
                          onClick={() => setSelected(isSelected ? null : p.productor)}
                          className={cn(
                            "w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors",
                            isSelected && "bg-primary/5 border-l-2 border-l-primary"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate">{p.productor}</span>
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
                        </button>
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
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Selecciona un productor para ver su histórico detallado.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{selectedStats.productor}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
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

              {tphSeries.length > 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Evolución T/h — {selectedStats.productor}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={tphSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="date" fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis
                          fontSize={10}
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                          domain={["auto", "auto"]}
                          tickFormatter={(v) => `${v} T/h`}
                          width={54}
                        />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }}
                          formatter={(v: number, name: string) => [
                            name === "tph" ? `${v.toFixed(2)} T/h` : formatKg(v),
                            name === "tph" ? "T/h" : "kg",
                          ]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === "tph" ? "T/h" : "kg lote"} />
                        <Line type="monotone" dataKey="tph" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Tabla lotes */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Lotes de {selectedStats.productor}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Lote</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Kg</TableHead>
                        <TableHead className="text-right">T/h</TableHead>
                        <TableHead className="text-right">Peso fruta</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...selectedStats.lotes]
                        .sort((a, b) => (b.parte_date ?? "").localeCompare(a.parte_date ?? ""))
                        .map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-xs text-muted-foreground">{l.parte_date ?? "—"}</TableCell>
                            <TableCell className="text-xs font-mono">{l.lote_codigo ?? "—"}</TableCell>
                            <TableCell className="text-xs">{l.producto ?? "—"}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{formatKg(l.kg_peso_total)}</TableCell>
                            <TableCell className="text-right">
                              <TphBadge tph={l.toneladas_hora ?? null} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                              {l.peso_fruta_promedio_g ? `${l.peso_fruta_promedio_g.toFixed(0)} g` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
