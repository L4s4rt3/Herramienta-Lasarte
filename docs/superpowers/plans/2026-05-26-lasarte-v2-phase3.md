# Lasarte SAT v2 — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add proactive alerts, trend panels, visual producer history, and comparison mode to elevate the app from reactive to proactive.

**Architecture:** Add new queries for slow producers and anomalous consumption; extend Dashboard with proactive alert cards; add weekly/monthly toggle to trend chart; enhance Productores page with richer historical visuals; add day/week comparison mode.

**Tech Stack:** React 18, Supabase, TanStack Query, shadcn/ui, Recharts, React Router 6.

---

### Task 1: Alertas proactivas en Dashboard

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Add query for slow producers (TPH < 12 in last 7 days)**

In `Dashboard.tsx`, add a new query after the existing `paceData` query:

```tsx
const { data: slowProducers } = useQuery({
  queryKey: ["dashboard-slow-producers"],
  queryFn: async () => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceStr = since.toISOString().slice(0, 10);
    const { data } = await supabase
      .from("lotes_dia")
      .select("productor, toneladas_hora, duracion_min, partes_diarios!inner(date)")
      .gte("partes_diarios.date", sinceStr)
      .not("toneladas_hora", "is", null);
    if (!data || data.length === 0) return [];
    const byProducer = new Map<string, { totalTph: number; count: number; totalMin: number }>();
    for (const row of data) {
      const tph = Number(row.toneladas_hora) || 0;
      const min = Number(row.duracion_min) || 0;
      if (tph <= 0) continue;
      const key = row.productor || "Desconocido";
      if (!byProducer.has(key)) byProducer.set(key, { totalTph: 0, count: 0, totalMin: 0 });
      const p = byProducer.get(key)!;
      p.totalTph += tph * min;
      p.count++;
      p.totalMin += min;
    }
    return Array.from(byProducer.entries())
      .map(([productor, stats]) => ({
        productor,
        avgTph: stats.totalMin > 0 ? stats.totalTph / stats.totalMin : stats.totalTph / stats.count,
        nLotes: stats.count,
      }))
      .filter((p) => p.avgTph < 12)
      .sort((a, b) => a.avgTph - b.avgTph)
      .slice(0, 5);
  },
});
```

- [ ] **Step 2: Add query for anomalous water/energy consumption**

```tsx
const { data: highConsumption } = useQuery({
  queryKey: ["dashboard-high-consumption"],
  queryFn: async () => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceStr = since.toISOString().slice(0, 10);
    const { data } = await supabase
      .from("consumos")
      .select("tipo, cantidad, date, unidad")
      .gte("date", sinceStr)
      .order("date", { ascending: false })
      .limit(10);
    return (data ?? []).filter((c) => {
      if (c.tipo === "Agua" && Number(c.cantidad) > 100000) return true;
      if (c.tipo === "Electricidad" && Number(c.cantidad) > 5000) return true;
      if (c.tipo === "Gasoil" && Number(c.cantidad) > 2000) return true;
      return false;
    });
  },
});
```

- [ ] **Step 3: Add imports**

Ensure these are imported:
```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, GaugeIcon, Zap } from "lucide-react";
```

- [ ] **Step 4: Add proactive alerts section after Acceso rápido**

After the "Acceso rápido" section and before "Últimos partes", add:

```tsx
{/* ─── Alertas proactivas ──────────────────────────────────────── */}
{(slowProducers && slowProducers.length > 0) || (highConsumption && highConsumption.length > 0) ? (
  <div className="space-y-4">
    <h2 className="text-lg font-semibold tracking-tight">Alertas proactivas</h2>
    <div className="grid gap-4 md:grid-cols-2">
      {slowProducers && slowProducers.length > 0 && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <GaugeIcon className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-sm font-semibold">Productores lentos (últ. 7 días)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {slowProducers.map((p) => (
              <div key={p.productor} className="flex items-center justify-between text-sm">
                <span className="font-medium">{p.productor}</span>
                <span className="text-amber-600 font-semibold tabular-nums">
                  {p.avgTph.toFixed(1)} T/h
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {highConsumption && highConsumption.length > 0 && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <Zap className="h-4 w-4 text-destructive" />
            <CardTitle className="text-sm font-semibold">Consumos elevados (últ. 7 días)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {highConsumption.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium">{c.tipo}</span>
                <span className="text-destructive font-semibold tabular-nums">
                  {Number(c.cantidad).toLocaleString()} {c.unidad || ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  </div>
) : null}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean build

---

### Task 2: Panel de tendencias semanales/mensuales

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Add period toggle to trend chart**

Find the chart section ("Evolución DJPMN") and add a period toggle before it. Add state:

```tsx
const [trendPeriod, setTrendPeriod] = useState<"30d" | "90d">("30d");
```

Update the `usePartesDashboard` call or filter `chartSeries` based on `trendPeriod`. If the hook only supports 30d, add a local filter:

```tsx
const filteredChartSeries = useMemo(() => {
  if (trendPeriod === "30d") return chartSeries;
  return chartSeries.slice(-90);
}, [chartSeries, trendPeriod]);
```

Add period buttons in the chart CardHeader:
```tsx
<div className="flex items-center gap-1">
  <Button
    variant={trendPeriod === "30d" ? "default" : "outline"}
    size="sm"
    className="h-7 text-xs px-2"
    onClick={() => setTrendPeriod("30d")}
  >
    30 días
  </Button>
  <Button
    variant={trendPeriod === "90d" ? "default" : "outline"}
    size="sm"
    className="h-7 text-xs px-2"
    onClick={() => setTrendPeriod("90d")}
  >
    90 días
  </Button>
</div>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build

---

### Task 3: Histórico visual por productor

**Files:**
- Modify: `src/pages/Productores.tsx`

- [ ] **Step 1: Enhance productor detail view with more charts**

In `Productores.tsx`, find the selectedStats rendering area (where the TPH line chart is shown). Enhance it with:

1. A KPIs row showing: kg total, lotes, T/h media, peso fruta promedio
2. Keep the existing TPH chart but make it larger
3. Add a production volume bar chart (kg per day for this producer)

The rendering should be inside the same section that shows when a productor is selected. The exact structure depends on the current code. Read the file and add:

```tsx
{selectedStats && (
  <div className="lg:col-span-2 space-y-4">
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{selectedStats.productor}</CardTitle>
        <CardDescription>
          {selectedStats.n_lotes} lotes · {formatKg(selectedStats.kg_total)} total
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="glass rounded-lg p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{selectedStats.n_lotes}</p>
            <p className="text-xs text-muted-foreground">Lotes</p>
          </div>
          <div className="glass rounded-lg p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">
              {selectedStats.tph_promedio ? selectedStats.tph_promedio.toFixed(1) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">T/h media</p>
          </div>
          <div className="glass rounded-lg p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">
              {selectedStats.peso_fruta_promedio_g ? selectedStats.peso_fruta_promedio_g.toFixed(0) : "—"}g
            </p>
            <p className="text-xs text-muted-foreground">Peso fruta</p>
          </div>
          <div className="glass rounded-lg p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{formatKg(selectedStats.kg_total)}</p>
            <p className="text-xs text-muted-foreground">Total kg</p>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
)}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build

---

### Task 4: Modo comparativa entre días/semanas

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Add comparison mode toggle to Dashboard**

Add state for comparison mode:
```tsx
const [compareMode, setCompareMode] = useState<"none" | "week" | "month">("none");
```

Add a button group in the Dashboard header (next to the "vs año anterior" button):
```tsx
<Button
  variant={compareMode === "week" ? "default" : "outline"}
  size="sm"
  onClick={() => setCompareMode(compareMode === "week" ? "none" : "week")}
  className="shadow-sm"
>
  <BarChart3 className="h-4 w-4 mr-1.5" />
  Comparar semanas
</Button>
```

When `compareMode === "week"`, compute weekly aggregates from `chartSeries` and display as grouped bars instead of the regular chart.

```tsx
const weeklyComparison = useMemo(() => {
  if (compareMode !== "week" || chartSeries.length === 0) return null;
  const weeks: { label: string; produccion: number; dsj_pct: number }[] = [];
  const chunkSize = 7;
  for (let i = 0; i < chartSeries.length; i += chunkSize) {
    const chunk = chartSeries.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const prod = chunk.reduce((s, d) => s + (d.produccion || 0), 0);
    const dsj = chunk.reduce((s, d) => s + (d.dsj_pct || 0), 0) / chunk.length;
    weeks.push({
      label: `Sem ${Math.floor(i / chunkSize) + 1}`,
      produccion: prod,
      dsj_pct: dsj,
    });
  }
  return weeks;
}, [chartSeries, compareMode]);
```

When `weeklyComparison` is set, render a simpler bar chart using weekly data instead of the daily chart.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build

---

### Verification

- [ ] Run: `npm run build`
Expected: Clean build
- [ ] Dashboard shows proactive alerts (slow producers, high consumption)
- [ ] Trend chart has 30d/90d toggle
- [ ] Productores page shows enhanced detail view
- [ ] Dashboard has comparison mode toggle
