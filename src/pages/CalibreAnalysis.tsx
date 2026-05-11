/**
 * M5 — Curva de calibres y alertas de tamaño
 * Visualiza la distribución de calibres por día y productor.
 * Datos desde calibres_dia (importados con el parser de informes).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { KPICard } from "@/components/KPICard";
import { formatKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BarChart3, AlertTriangle, Globe, ShoppingCart, Wrench } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Cell,
} from "recharts";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";

interface CalibreDia {
  id: string;
  part_id: string;
  calibre: string;
  piezas: number;
  kg: number;
  pct: number;
  clase: string | null;
  grupo_destino: string | null;
  created_at: string;
  parte_date?: string;
}

const GRUPO_COLOR: Record<string, string> = {
  exportacion: "hsl(var(--success))",
  mercado:     "hsl(var(--info, 220 90% 56%))",
  industria:   "hsl(var(--warning))",
  otro:        "hsl(var(--muted-foreground))",
};

const CALIBRE_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
];

function clasificarGrupo(g: string | null): "exportacion" | "mercado" | "industria" | "otro" {
  if (!g) return "otro";
  const s = g.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes("export")) return "exportacion";
  if (s.includes("mercado") || s.includes("nac") || s.includes("int")) return "mercado";
  if (s.includes("ind")) return "industria";
  return "otro";
}

export default function CalibreAnalysis() {
  const [calibres, setCalibres] = useState<CalibreDia[]>([]);
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("calibres_dia")
      .select("*, partes_diarios(date)")
      .gte("created_at", since + "T00:00:00")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error cargando calibres", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows: CalibreDia[] = (data ?? []).map((r: any) => ({
      ...r,
      parte_date: r.partes_diarios?.date ?? null,
    }));
    setCalibres(rows);
    setLoading(false);
  }

  useEffect(() => { load(); }, [since]);

  // Fechas disponibles
  const fechasDisponibles = useMemo(() => {
    const dates = [...new Set(calibres.map((c) => c.parte_date).filter(Boolean))] as string[];
    return dates.sort().reverse();
  }, [calibres]);

  const activeFecha = selectedDate ?? fechasDisponibles[0] ?? null;

  // Calibres del día seleccionado
  const calibresDia = useMemo(() => {
    if (!activeFecha) return calibres;
    return calibres.filter((c) => c.parte_date === activeFecha);
  }, [calibres, activeFecha]);

  // Agrupar por calibre
  const porCalibre = useMemo(() => {
    const map: Record<string, { kg: number; piezas: number; grupos: Record<string, number> }> = {};
    calibresDia.forEach((c) => {
      if (!map[c.calibre]) map[c.calibre] = { kg: 0, piezas: 0, grupos: {} };
      map[c.calibre].kg += c.kg;
      map[c.calibre].piezas += c.piezas;
      const g = clasificarGrupo(c.grupo_destino);
      map[c.calibre].grupos[g] = (map[c.calibre].grupos[g] ?? 0) + c.kg;
    });
    return Object.entries(map)
      .map(([calibre, v]) => ({
        calibre,
        kg: v.kg,
        piezas: v.piezas,
        exportacion: v.grupos.exportacion ?? 0,
        mercado:     v.grupos.mercado ?? 0,
        industria:   v.grupos.industria ?? 0,
        otro:        v.grupos.otro ?? 0,
      }))
      .sort((a, b) => b.kg - a.kg);
  }, [calibresDia]);

  // Totales por destino
  const kg_exportacion = calibresDia
    .filter((c) => clasificarGrupo(c.grupo_destino) === "exportacion")
    .reduce((s, c) => s + c.kg, 0);
  const kg_mercado = calibresDia
    .filter((c) => clasificarGrupo(c.grupo_destino) === "mercado")
    .reduce((s, c) => s + c.kg, 0);
  const kg_industria = calibresDia
    .filter((c) => clasificarGrupo(c.grupo_destino) === "industria")
    .reduce((s, c) => s + c.kg, 0);
  const kg_total = calibresDia.reduce((s, c) => s + c.kg, 0);

  // Top calibre
  const topCalibre = porCalibre[0]?.calibre ?? "—";
  const pctTop = kg_total > 0 ? (porCalibre[0]?.kg ?? 0) / kg_total * 100 : 0;

  // Alerta: % fuera de calibre comercial (solo industria > 30%)
  const pctIndustria = kg_total > 0 ? (kg_industria / kg_total) * 100 : 0;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-muted-foreground" />
            Análisis de calibres
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Curva de calibres, clase y destino — datos desde Informe_tamaños importado
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

      {/* Alerta de industria alta */}
      {!loading && pctIndustria > 30 && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          <p className="text-sm text-warning font-medium">
            {pctIndustria.toFixed(1)}% de la fruta fue a industria — superior al umbral del 30%.
            Revisar calibres fuera de rango comercial.
          </p>
        </div>
      )}

      {/* Selector de fecha */}
      {fechasDisponibles.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {fechasDisponibles.slice(0, 10).map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDate(d === activeFecha ? null : d)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                d === activeFecha
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {d.slice(5)}
            </button>
          ))}
          {activeFecha && (
            <button
              onClick={() => setSelectedDate(null)}
              className="px-3 py-1 rounded-full text-xs font-medium border border-border text-muted-foreground hover:border-destructive"
            >
              Todos
            </button>
          )}
        </div>
      )}

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KPICard
              label="Exportación"
              value={formatKg(kg_exportacion)}
              hint={kg_total > 0 ? `${(kg_exportacion / kg_total * 100).toFixed(1)}%` : "—"}
              icon={Globe}
              trend="up"
            />
            <KPICard
              label="Mercado nacional"
              value={formatKg(kg_mercado)}
              hint={kg_total > 0 ? `${(kg_mercado / kg_total * 100).toFixed(1)}%` : "—"}
              icon={ShoppingCart}
            />
            <KPICard
              label="Industria"
              value={formatKg(kg_industria)}
              hint={`${pctIndustria.toFixed(1)}%`}
              icon={Wrench}
              trend={pctIndustria > 30 ? "down" : "neutral"}
            />
            <KPICard
              label="Calibre dominante"
              value={topCalibre}
              hint={`${pctTop.toFixed(1)}% del total`}
              icon={BarChart3}
            />
          </>
        )}
      </section>

      {/* Curva de calibres */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Curva de calibres
            {activeFecha && <span className="ml-2 text-sm font-normal text-muted-foreground">· {activeFecha}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72" />
          ) : porCalibre.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              Sin datos. Importa un Informe_tamaños desde el parte diario.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porCalibre} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="calibre"
                  fontSize={10}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  fontSize={10}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(1)}t`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }}
                  formatter={(v: number, name: string) => [formatKg(v), name]}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="exportacion" stackId="a" fill={GRUPO_COLOR.exportacion} name="Exportación" />
                <Bar dataKey="mercado"     stackId="a" fill={GRUPO_COLOR.mercado}     name="Mercado" />
                <Bar dataKey="industria"   stackId="a" fill={GRUPO_COLOR.industria}   name="Industria" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tabla detalle calibres */}
      {porCalibre.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tabla de calibres</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Calibre</TableHead>
                  <TableHead className="text-right">Kg total</TableHead>
                  <TableHead className="text-right">% total</TableHead>
                  <TableHead className="text-right">Exportación</TableHead>
                  <TableHead className="text-right">Mercado</TableHead>
                  <TableHead className="text-right">Industria</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porCalibre.map((c) => {
                  const pct = kg_total > 0 ? (c.kg / kg_total) * 100 : 0;
                  return (
                    <TableRow key={c.calibre}>
                      <TableCell className="font-medium">{c.calibre}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(c.kg)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {pct.toFixed(1)}%
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", c.exportacion > 0 && "text-success font-medium")}>
                        {c.exportacion > 0 ? formatKg(c.exportacion) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {c.mercado > 0 ? formatKg(c.mercado) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", c.industria > 0 && "text-warning")}>
                        {c.industria > 0 ? formatKg(c.industria) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
