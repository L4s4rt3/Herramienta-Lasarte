import { Suspense, lazy, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KPICard } from "@/components/KPICard";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, FileSpreadsheet, FileText } from "lucide-react";
import { today, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
const BarChart = lazy(() => import("recharts").then(m => ({ default: m.BarChart })));
const Bar = lazy(() => import("recharts").then(m => ({ default: m.Bar })));
const LineChart = lazy(() => import("recharts").then(m => ({ default: m.LineChart })));
const Line = lazy(() => import("recharts").then(m => ({ default: m.Line })));
const CartesianGrid = lazy(() => import("recharts").then(m => ({ default: m.CartesianGrid })));
const XAxis = lazy(() => import("recharts").then(m => ({ default: m.XAxis })));
const YAxis = lazy(() => import("recharts").then(m => ({ default: m.YAxis })));
const Tooltip = lazy(() => import("recharts").then(m => ({ default: m.Tooltip })));
const Legend = lazy(() => import("recharts").then(m => ({ default: m.Legend })));
const ResponsiveContainer = lazy(() => import("recharts").then(m => ({ default: m.ResponsiveContainer })));
import { exportConsumoToExcel, exportConsumoToPDF, ConsumoRow } from "@/lib/exportConsumo";

const ZONAS = ["Línea de tratamiento", "Mallas", "Graneles", "Mesas", "Industria", "Drencher"];
const TIPOS: { value: string; unit: string }[] = [
  { value: "Cera", unit: "kg" },
  { value: "Agua", unit: "L" },
  { value: "Electricidad", unit: "kWh" },
  { value: "Gasoil", unit: "L" },
  { value: "Fungicida", unit: "kg" },
];
const TIPO_COLOR: Record<string, string> = {
  Cera: "bg-amber-100 text-amber-800",
  Agua: "bg-blue-100 text-blue-800",
  Electricidad: "bg-yellow-100 text-yellow-700",
  Gasoil: "bg-orange-100 text-orange-800",
  Fungicida: "bg-green-100 text-green-800",
};
const CHART_COLOR: Record<string, string> = {
  Cera: "hsl(var(--warning))",
  Agua: "hsl(var(--info))",
  Electricidad: "#eab308",
  Gasoil: "hsl(var(--destructive))",
  Fungicida: "hsl(var(--success))",
};

const unitFor = (t: string) => TIPOS.find((x) => x.value === t)?.unit ?? "";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function ConsumoCostes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [zonaFilter, setZonaFilter] = useState<string>("");
  const [tipoFilter, setTipoFilter] = useState<string>("");

  // Add form
  const [fDate, setFDate] = useState(today());
  const [fZona, setFZona] = useState(ZONAS[0]);
  const [fTipo, setFTipo] = useState(TIPOS[0].value);
  const [fCant, setFCant] = useState("");
  const [fCoste, setFCoste] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["costes", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("costes_diarios")
        .select("id,date,zona_id,tipo,cantidad,unidad,coste_unitario")
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConsumoRow[];
    },
  });

  const filtered = useMemo(() => rows.filter((r) =>
    (!zonaFilter || r.zona_id === zonaFilter) &&
    (!tipoFilter || r.tipo === tipoFilter)
  ), [rows, zonaFilter, tipoFilter]);

  const addMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No auth");
      const cant = Number(fCant) || 0;
      const coste = Number(fCoste) || 0;
      if (cant <= 0) throw new Error("Cantidad requerida");
      const { error } = await supabase.from("costes_diarios").insert({
        user_id: user.id, date: fDate, zona_id: fZona, tipo: fTipo,
        cantidad: cant, unidad: unitFor(fTipo), coste_unitario: coste,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Registro añadido" });
      setFCant(""); setFCoste("");
      qc.invalidateQueries({ queryKey: ["costes"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const patchMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ConsumoRow> }) => {
      const { error } = await supabase.from("costes_diarios").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["costes", from, to] });
      const prev = qc.getQueryData<ConsumoRow[]>(["costes", from, to]);
      qc.setQueryData<ConsumoRow[]>(["costes", from, to], (old) =>
        (old ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r))
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["costes", from, to], ctx.prev);
      toast({ title: "Error al guardar", variant: "destructive" });
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("costes_diarios").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["costes", from, to] });
      const prev = qc.getQueryData<ConsumoRow[]>(["costes", from, to]);
      qc.setQueryData<ConsumoRow[]>(["costes", from, to], (old) =>
        (old ?? []).filter((r) => r.id !== id)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["costes", from, to], ctx.prev);
      toast({ title: "Error al eliminar", variant: "destructive" });
    },
    onSuccess: () => toast({ title: "Eliminado" }),
  });

  // KPIs día actual
  const kpis = useMemo(() => {
    const t = today();
    const y = daysAgo(1);
    const todayRows = rows.filter((r) => r.date === t);
    const yRows = rows.filter((r) => r.date === y);
    const byTipo = (arr: ConsumoRow[], tipo: string) =>
      arr.filter((r) => r.tipo === tipo).reduce((a, r) => a + (Number(r.cantidad) || 0), 0);
    const cost = (arr: ConsumoRow[]) =>
      arr.reduce((a, r) => a + (Number(r.cantidad) || 0) * (Number(r.coste_unitario) || 0), 0);
    const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);

    return TIPOS.map((tp) => ({
      label: tp.value,
      val: byTipo(todayRows, tp.value),
      unit: tp.unit,
      delta: pct(byTipo(todayRows, tp.value), byTipo(yRows, tp.value)),
    })).concat([
      { label: "Coste total", val: cost(todayRows), unit: "€", delta: pct(cost(todayRows), cost(yRows)) },
    ]);
  }, [rows]);

  // Chart 1: consumo últimos 14d por tipo
  const chart14 = useMemo(() => {
    const days: Record<string, any> = {};
    for (let i = 13; i >= 0; i--) {
      const d = daysAgo(i);
      days[d] = { date: d.slice(5), ...Object.fromEntries(TIPOS.map((t) => [t.value, 0])) };
    }
    rows.forEach((r) => {
      if (days[r.date] && r.tipo) days[r.date][r.tipo] += Number(r.cantidad) || 0;
    });
    return Object.values(days);
  }, [rows]);

  // Chart 2: coste diario
  const costChart = useMemo(() => {
    const days: Record<string, any> = {};
    for (let i = 13; i >= 0; i--) {
      const d = daysAgo(i);
      days[d] = { date: d.slice(5), coste: 0 };
    }
    rows.forEach((r) => {
      if (days[r.date]) days[r.date].coste += (Number(r.cantidad) || 0) * (Number(r.coste_unitario) || 0);
    });
    return Object.values(days);
  }, [rows]);

  // Chart 3: por zona
  const zonaChart = useMemo(() => {
    return ZONAS.map((z) => {
      const base: any = { zona: z.length > 12 ? z.slice(0, 12) + "…" : z };
      TIPOS.forEach((t) => {
        base[t.value] = rows
          .filter((r) => r.zona_id === z && r.tipo === t.value)
          .reduce((a, r) => a + (Number(r.cantidad) || 0), 0);
      });
      return base;
    });
  }, [rows]);

  const totalFiltrado = filtered.reduce(
    (a, r) => a + (Number(r.cantidad) || 0) * (Number(r.coste_unitario) || 0), 0
  );

  return (
    <Suspense fallback={<div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6"><Skeleton className="h-96" /></div>}>
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl">Consumos y costes</h1>
          <p className="text-sm text-muted-foreground">Cera · Agua · Electricidad · Gasoil · Fungicida</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportConsumoToExcel(filtered, from, to)}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => exportConsumoToPDF(filtered, from, to)}>
            <FileText className="h-4 w-4" /> PDF
          </Button>
        </div>
      </header>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 grid gap-3 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label>Desde</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Hasta</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Zona</Label>
            <select className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              value={zonaFilter} onChange={(e) => setZonaFilter(e.target.value)}>
              <option value="">Todas</option>
              {ZONAS.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <select className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)}>
              <option value="">Todos</option>
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.value}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => { setFrom(today()); setTo(today()); }}>Hoy</Button>
            <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(6)); setTo(today()); }}>7 días</Button>
            <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(30)); setTo(today()); }}>30 días</Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          kpis.map((k) => (
            <KPICard
              key={k.label}
              label={k.label}
              value={`${formatNumber(k.val, k.unit === "€" ? 2 : 0)} ${k.unit}`}
              hint={k.delta === 0 ? "—" : `${k.delta > 0 ? "+" : ""}${k.delta.toFixed(1)}% vs ayer`}
              trend={k.delta > 0 ? "up" : k.delta < 0 ? "down" : "neutral"}
            />
          ))
        )}
      </section>

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-lg">Consumo · últimos 14 días</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chart14}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {TIPOS.map((t) => <Bar key={t.value} dataKey={t.value} fill={CHART_COLOR[t.value]} />)}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Coste diario (€) · 14 días</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={costChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }} />
                <Line type="monotone" dataKey="coste" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader><CardTitle className="text-lg">Distribución por zona</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={zonaChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="zona" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {TIPOS.map((t) => <Bar key={t.value} dataKey={t.value} stackId="a" fill={CHART_COLOR[t.value]} />)}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Add form */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Añadir consumo</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <div className="space-y-1.5"><Label>Fecha</Label><Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Zona</Label>
            <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={fZona} onChange={(e) => setFZona(e.target.value)}>
              {ZONAS.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.value} ({t.unit})</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label>Cantidad ({unitFor(fTipo)})</Label><Input type="number" step="0.01" min="0" value={fCant} onChange={(e) => setFCant(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>€ por ud</Label><Input type="number" step="0.001" min="0" value={fCoste} onChange={(e) => setFCoste(e.target.value)} /></div>
          <div className="flex items-end">
            <Button className="w-full" onClick={() => addMut.mutate()} disabled={addMut.isPending}>
              <Plus className="h-4 w-4" /> Añadir
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Registros ({filtered.length})</CardTitle>
          <span className="text-sm font-medium">Total: {formatNumber(totalFiltrado, 2)} €</span>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sin registros en este rango.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Zona</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Ud.</TableHead>
                  <TableHead className="text-right">€/ud</TableHead>
                  <TableHead className="text-right">Total €</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const total = (Number(r.cantidad) || 0) * (Number(r.coste_unitario) || 0);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                      <TableCell>
                        <select className="h-8 rounded-md border bg-background px-2 text-sm"
                          value={r.zona_id ?? ""}
                          onChange={(e) => patchMut.mutate({ id: r.id, patch: { zona_id: e.target.value } })}>
                          {ZONAS.map((z) => <option key={z} value={z}>{z}</option>)}
                        </select>
                      </TableCell>
                      <TableCell>
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", TIPO_COLOR[r.tipo ?? ""])}>
                          {r.tipo}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input type="number" step="0.01" min="0" className="h-8 w-24 ml-auto tabular-nums text-right"
                          defaultValue={r.cantidad}
                          onBlur={(e) => {
                            const v = Number(e.target.value) || 0;
                            if (v !== r.cantidad) patchMut.mutate({ id: r.id, patch: { cantidad: v } });
                          }} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{r.unidad}</TableCell>
                      <TableCell className="text-right">
                        <Input type="number" step="0.001" min="0" className="h-8 w-24 ml-auto tabular-nums text-right"
                          defaultValue={r.coste_unitario}
                          onBlur={(e) => {
                            const v = Number(e.target.value) || 0;
                            if (v !== r.coste_unitario) patchMut.mutate({ id: r.id, patch: { coste_unitario: v } });
                          }} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatNumber(total, 2)} €</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => delMut.mutate(r.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
    </Suspense>
  );
}
