# Categoria Segunda - Rediseno completo de pestanas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redisenar las pestanas Clientes, Productos, Articulos y Base diaria con vistas detalle, sparklines, agrupacion y datos expandibles. El Dashboard se mantiene igual.

**Architecture:** 5 nuevos componentes independientes que se integran en la pagina principal. Los datos ya existen via `useVentasCategoria` hook y `allLinesQuery`. Cada componente recibe los datos necesarios via props y maneja su propio estado de expansion.

**Tech Stack:** React + TypeScript + Recharts (sparklines) + shadcn/ui Collapsible + Lucide icons

**Files to create:**
- `src/components/SparklineCell.tsx` — mini sparkline de evolucion
- `src/components/DailyGroupTable.tsx` — tabla agrupada por dia
- `src/components/VentasCategoriaClienteDetail.tsx` — detalle de cliente
- `src/components/VentasCategoriaProductoDetail.tsx` — detalle de producto
- `src/components/VentasCategoriaArticuloDetail.tsx` — detalle de articulo

**Files to modify:**
- `src/pages/VentasCategoriaSegunda.tsx` — refactor de las 4 pestanas

---

### Task 1: SparklineCell component

**Files:**
- Create: `src/components/SparklineCell.tsx`

Mini grafica de barras que muestra la evolucion de kilos en los ultimos meses. Se reutiliza en las tablas de Clientes, Productos y Articulos.

- [ ] **Step 1: Write the component**

Crear `src/components/SparklineCell.tsx`:

```tsx
import { Bar, BarChart, ResponsiveContainer } from "recharts";

interface SparklinePoint {
  mes: string;
  kilos: number;
}

interface SparklineCellProps {
  data: SparklinePoint[];
  /** Max kilos value across all data points, for consistent scaling */
  maxKilos?: number;
  width?: number;
  height?: number;
}

export function SparklineCell({ data, maxKilos, width = 80, height = 24 }: SparklineCellProps) {
  if (data.length === 0) return <span className="text-xs text-muted-foreground">—</span>;

  const max = maxKilos ?? Math.max(...data.map((d) => d.kilos), 1);
  const trend = data.length >= 2 ? data[data.length - 1].kilos - data[0].kilos : 0;
  const color = trend > 0 ? "var(--color-success, #22c55e)" : trend < 0 ? "var(--color-destructive, #ef4444)" : "var(--color-muted, #64748b)";

  return (
    <div style={{ width, height }} title={`Tendencia: ${trend > 0 ? "subiendo" : trend < 0 ? "bajando" : "estable"}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Bar dataKey="kilos" fill={color} radius={[1, 1, 0, 0]} maxBarSize={6} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: BUILD OK

- [ ] **Step 3: Commit**

```bash
git add src/components/SparklineCell.tsx
git commit -m "feat: add SparklineCell component for mini evolution charts"
```

---

### Task 2: DailyGroupTable component

**Files:**
- Create: `src/components/DailyGroupTable.tsx`

Tabla agrupada por fecha con Collapsible, subtotales por dia, columnas congeladas y paginacion "Cargar mas".

- [ ] **Step 1: Write the component**

Crear `src/components/DailyGroupTable.tsx`:

```tsx
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDate, formatKg, formatNumber } from "@/lib/format";
import type { VentasCategoriaLineaRow } from "@/lib/types";

interface DailyGroupTableProps {
  lines: VentasCategoriaLineaRow[];
  pageSize?: number;
}

interface DayGroup {
  fecha: string;
  lines: VentasCategoriaLineaRow[];
  totalKilos: number;
  totalBase: number;
}

function groupByDay(lines: VentasCategoriaLineaRow[]): DayGroup[] {
  const map = new Map<string, VentasCategoriaLineaRow[]>();
  lines.forEach((line) => {
    const existing = map.get(line.fecha) ?? [];
    existing.push(line);
    map.set(line.fecha, existing);
  });
  return Array.from(map.entries()).map(([fecha, dayLines]) => ({
    fecha,
    lines: dayLines,
    totalKilos: dayLines.reduce((sum, l) => sum + l.kilos, 0),
    totalBase: dayLines.reduce((sum, l) => sum + l.base_iva, 0),
  })).sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export function DailyGroupTable({ lines, pageSize = 5 }: DailyGroupTableProps) {
  const [visibleDays, setVisibleDays] = useState(pageSize);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const dayGroups = useMemo(() => groupByDay(lines), [lines]);
  const visible = dayGroups.slice(0, visibleDays);
  const hasMore = visibleDays < dayGroups.length;

  const toggleDay = (fecha: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(fecha)) next.delete(fecha);
      else next.add(fecha);
      return next;
    });
  };

  const loadMore = () => setVisibleDays((prev) => prev + pageSize);

  if (dayGroups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No hay lineas con estos filtros.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((day) => {
        const isExpanded = expandedDays.has(day.fecha);
        return (
          <div key={day.fecha} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-shadow)] backdrop-blur-xl">
            <button
              onClick={() => toggleDay(day.fecha)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--glass-bg-strong)]"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <span className="font-semibold">{formatDate(`${day.fecha}T12:00:00`)}</span>
                <span className="ml-2 text-xs text-muted-foreground">{day.lines.length} lineas</span>
              </div>
              <div className="flex items-center gap-4 text-sm tabular-nums">
                <span className="font-medium">{formatKg(day.totalKilos)}</span>
                <span className="text-muted-foreground">{formatNumber(day.totalBase, 2)} EUR</span>
              </div>
            </button>
            {isExpanded && (
              <div className="overflow-x-auto border-t border-[var(--glass-border)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-[var(--glass-bg)]">Cliente</TableHead>
                      <TableHead className="sticky left-[180px] z-10 bg-[var(--glass-bg)] min-w-[280px]">Articulo</TableHead>
                      <TableHead>Metodo</TableHead>
                      <TableHead className="text-right">Kilos</TableHead>
                      <TableHead className="text-right">PM</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {day.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="sticky left-0 z-10 bg-[var(--glass-bg)] min-w-[180px]">
                          <div className="font-medium truncate max-w-[170px]">{line.cliente_nombre}</div>
                        </TableCell>
                        <TableCell className="sticky left-[180px] z-10 bg-[var(--glass-bg)] min-w-[280px]">
                          <div className="truncate max-w-[270px]">{line.articulo}</div>
                        </TableCell>
                        <TableCell>{line.metodo_producto ?? "Sin clasificar"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(line.kilos)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(line.pm_venta, 3)} EUR/kg</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(line.base_iva, 2)} EUR</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t border-[var(--glass-border-accent)] font-semibold">
                      <TableCell colSpan={3} className="text-xs text-muted-foreground">Subtotal dia</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(day.totalKilos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(day.totalKilos > 0 ? day.totalBase / day.totalKilos : 0, 3)} EUR/kg</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(day.totalBase, 2)} EUR</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={loadMore}>
            Cargar mas dias ({dayGroups.length - visibleDays} restantes)
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: BUILD OK

- [ ] **Step 3: Commit**

```bash
git add src/components/DailyGroupTable.tsx
git commit -m "feat: add DailyGroupTable with day grouping and frozen columns"
```

---

### Task 3: ClienteDetail component

**Files:**
- Create: `src/components/VentasCategoriaClienteDetail.tsx`

Panel expandido que se muestra al hacer clic en un cliente. Muestra KPIs, grafica evolucion, productos y articulos que compra.

- [ ] **Step 1: Write the component**

Crear `src/components/VentasCategoriaClienteDetail.tsx`:

```tsx
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHART_PANEL_CLASS, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS, lineStyle, BAR_STYLE } from "@/lib/chartTheme";
import { formatKg, formatNumber } from "@/lib/format";
import { aggregateVentasCategoria, type VentasCategoriaDetalleFilters } from "@/lib/ventasCategoria";
import type { VentasCategoriaLineaRow, VentasCategoriaClienteAjusteRow } from "@/lib/types";
// Ajustes editing is handled in the page-level AjusteTableRow component

interface VentasCategoriaClienteDetailProps {
  clienteCodigo: string;
  clienteNombre: string;
  allLines: VentasCategoriaLineaRow[];
  ajuste?: VentasCategoriaClienteAjusteRow;
  onSaveAjuste: (input: { cliente_codigo: string; cliente_nombre: string; comision_pct: number; comision_cent_kg: number; transporte_pct: number; transporte_cent_kg: number }) => void;
}

export function VentasCategoriaClienteDetail({ clienteCodigo, clienteNombre, allLines, ajuste, onSaveAjuste }: VentasCategoriaClienteDetailProps) {
  const clienteLines = useMemo(
    () => allLines.filter((l) => l.cliente_codigo === clienteCodigo),
    [allLines, clienteCodigo]
  );

  const aggregation = useMemo(() => aggregateVentasCategoria(clienteLines), [clienteLines]);
  const { resumen, productos, articulos } = aggregation;

  const monthlyData = useMemo(() => {
    const map = new Map<string, { mes: string; kilos: number; base: number }>();
    clienteLines.forEach((l) => {
      const current = map.get(l.mes) ?? { mes: l.mes, kilos: 0, base: 0 };
      current.kilos += l.kilos;
      current.base += l.base_iva;
      map.set(l.mes, current);
    });
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [clienteLines]);

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader>
        <CardTitle className="text-lg">{clienteNombre}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kilos</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatKg(resumen.kilos)}</p>
          </div>
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PM bruto</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatNumber(resumen.pm_venta, 3)} EUR/kg</p>
          </div>
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Base IVA</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatNumber(resumen.base_iva, 2)} EUR</p>
          </div>
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Productos</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{productos.length}</p>
          </div>
        </section>

        <div>
          <h4 className="mb-2 text-sm font-semibold">Evolucion mensual</h4>
          <div className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="mes" {...XAXIS} />
                <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                <Bar dataKey="kilos" name="Kilos" fill="var(--color-primary, #3b82f6)" stroke="var(--color-primary, #3b82f6)" {...BAR_STYLE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold">Productos</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metodo</TableHead>
                  <TableHead className="text-right">Kilos</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productos.slice(0, 10).map((p) => (
                  <TableRow key={p.key}>
                    <TableCell>{p.metodo_producto}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKg(p.kilos)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(resumen.kilos > 0 ? (p.kilos / resumen.kilos) * 100 : 0, 1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">Articulos top</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Articulo</TableHead>
                  <TableHead className="text-right">Kilos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articulos.slice(0, 10).map((a) => (
                  <TableRow key={a.key}>
                    <TableCell className="max-w-[200px] truncate">{a.articulo}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKg(a.kilos)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

Note: The `AdjustableRow` import will be removed. The ajustes UI will be integrated into this component later in Task 6.

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: BUILD OK

- [ ] **Step 3: Commit**

```bash
git add src/components/VentasCategoriaClienteDetail.tsx
git commit -m "feat: add VentasCategoriaClienteDetail panel"
```

---

### Task 4: ProductoDetail component

**Files:**
- Create: `src/components/VentasCategoriaProductoDetail.tsx`

Panel detalle de producto (metodo): KPIs, evolucion, ranking de clientes.

- [ ] **Step 1: Write the component**

Crear `src/components/VentasCategoriaProductoDetail.tsx`:

```tsx
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHART_PANEL_CLASS, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS, BAR_STYLE } from "@/lib/chartTheme";
import { formatKg, formatNumber } from "@/lib/format";
import type { VentasCategoriaLineaRow } from "@/lib/types";

interface VentasCategoriaProductoDetailProps {
  metodo: string;
  descripcion: string;
  allLines: VentasCategoriaLineaRow[];
}

export function VentasCategoriaProductoDetail({ metodo, descripcion, allLines }: VentasCategoriaProductoDetailProps) {
  const productLines = useMemo(
    () => allLines.filter((l) => l.metodo_producto === metodo),
    [allLines, metodo]
  );

  const totalKilos = useMemo(() => productLines.reduce((s, l) => s + l.kilos, 0), [productLines]);
  const totalBase = useMemo(() => productLines.reduce((s, l) => s + l.base_iva, 0), [productLines]);
  const uniqueClients = useMemo(() => new Set(productLines.map((l) => l.cliente_codigo)).size, [productLines]);

  const clientRanking = useMemo(() => {
    const map = new Map<string, { codigo: string; nombre: string; kilos: number; base: number }>();
    productLines.forEach((l) => {
      const current = map.get(l.cliente_codigo) ?? { codigo: l.cliente_codigo, nombre: l.cliente_nombre, kilos: 0, base: 0 };
      current.kilos += l.kilos;
      current.base += l.base_iva;
      map.set(l.cliente_codigo, current);
    });
    return Array.from(map.values()).sort((a, b) => b.kilos - a.kilos);
  }, [productLines]);

  const monthlyData = useMemo(() => {
    const map = new Map<string, { mes: string; kilos: number }>();
    productLines.forEach((l) => {
      const current = map.get(l.mes) ?? { mes: l.mes, kilos: 0 };
      current.kilos += l.kilos;
      map.set(l.mes, current);
    });
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [productLines]);

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader>
        <CardTitle className="text-lg">{metodo}{descripcion ? ` — ${descripcion}` : ""}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="grid gap-3 grid-cols-3">
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kilos</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatKg(totalKilos)}</p>
          </div>
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PM</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatNumber(totalKilos > 0 ? totalBase / totalKilos : 0, 3)} EUR/kg</p>
          </div>
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clientes</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{uniqueClients}</p>
          </div>
        </section>

        <div>
          <h4 className="mb-2 text-sm font-semibold">Evolucion mensual</h4>
          <div className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="mes" {...XAXIS} />
                <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                <Bar dataKey="kilos" name="Kilos" fill="var(--color-success, #22c55e)" stroke="var(--color-success, #22c55e)" {...BAR_STYLE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold">Clientes que compran este producto</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Kilos</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">PM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientRanking.map((c) => (
                <TableRow key={c.codigo}>
                  <TableCell className="min-w-[200px] font-medium">{c.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKg(c.kilos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(totalKilos > 0 ? (c.kilos / totalKilos) * 100 : 0, 1)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(c.kilos > 0 ? c.base / c.kilos : 0, 3)} EUR/kg</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: BUILD OK

- [ ] **Step 3: Commit**

```bash
git add src/components/VentasCategoriaProductoDetail.tsx
git commit -m "feat: add VentasCategoriaProductoDetail panel"
```

---

### Task 5: ArticuloDetail component

**Files:**
- Create: `src/components/VentasCategoriaArticuloDetail.tsx`

Panel detalle de articulo: KPIs, evolucion, clientes que lo compran.

- [ ] **Step 1: Write the component**

Crear `src/components/VentasCategoriaArticuloDetail.tsx`:

```tsx
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHART_PANEL_CLASS, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS, BAR_STYLE } from "@/lib/chartTheme";
import { formatKg, formatNumber } from "@/lib/format";
import type { VentasCategoriaLineaRow } from "@/lib/types";

interface VentasCategoriaArticuloDetailProps {
  articulo: string;
  referencia: string | null;
  allLines: VentasCategoriaLineaRow[];
}

export function VentasCategoriaArticuloDetail({ articulo, referencia, allLines }: VentasCategoriaArticuloDetailProps) {
  const articleLines = useMemo(
    () => allLines.filter((l) => l.articulo === articulo && (referencia ? l.referencia === referencia : true)),
    [allLines, articulo, referencia]
  );

  const totalKilos = useMemo(() => articleLines.reduce((s, l) => s + l.kilos, 0), [articleLines]);
  const totalBase = useMemo(() => articleLines.reduce((s, l) => s + l.base_iva, 0), [articleLines]);
  const lineCount = articleLines.length;

  const clientRanking = useMemo(() => {
    const map = new Map<string, { nombre: string; kilos: number }>();
    articleLines.forEach((l) => {
      const current = map.get(l.cliente_codigo) ?? { nombre: l.cliente_nombre, kilos: 0 };
      current.kilos += l.kilos;
      map.set(l.cliente_codigo, current);
    });
    return Array.from(map.values()).sort((a, b) => b.kilos - a.kilos);
  }, [articleLines]);

  const monthlyData = useMemo(() => {
    const map = new Map<string, { mes: string; kilos: number }>();
    articleLines.forEach((l) => {
      const current = map.get(l.mes) ?? { mes: l.mes, kilos: 0 };
      current.kilos += l.kilos;
      map.set(l.mes, current);
    });
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [articleLines]);

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader>
        <CardTitle className="text-lg">{articulo}</CardTitle>
        {referencia && <p className="text-xs text-muted-foreground">Ref: {referencia}</p>}
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="grid gap-3 grid-cols-3">
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kilos</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatKg(totalKilos)}</p>
          </div>
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PM</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatNumber(totalKilos > 0 ? totalBase / totalKilos : 0, 3)} EUR/kg</p>
          </div>
          <div className="rounded-md border border-[var(--glass-border)] bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lineas</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{lineCount}</p>
          </div>
        </section>

        <div>
          <h4 className="mb-2 text-sm font-semibold">Evolucion mensual</h4>
          <div className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="mes" {...XAXIS} />
                <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                <Bar dataKey="kilos" name="Kilos" fill="var(--color-warning, #eab308)" stroke="var(--color-warning, #eab308)" {...BAR_STYLE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold">Clientes que compran este articulo</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Kilos</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientRanking.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{c.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKg(c.kilos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(totalKilos > 0 ? (c.kilos / totalKilos) * 100 : 0, 1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: BUILD OK

- [ ] **Step 3: Commit**

```bash
git add src/components/VentasCategoriaArticuloDetail.tsx
git commit -m "feat: add VentasCategoriaArticuloDetail panel"
```

---

### Task 6: Refactor VentasCategoriaSegunda page

**Files:**
- Modify: `src/pages/VentasCategoriaSegunda.tsx`

Este es el cambio principal: reemplazar el contenido de las 4 pestanas para usar los nuevos componentes.

- [ ] **Step 1: Add imports for new components**

Anadir al inicio del archivo:

```typescript
import { SparklineCell } from "@/components/SparklineCell";
import { DailyGroupTable } from "@/components/DailyGroupTable";
import { VentasCategoriaClienteDetail } from "@/components/VentasCategoriaClienteDetail";
import { VentasCategoriaProductoDetail } from "@/components/VentasCategoriaProductoDetail";
import { VentasCategoriaArticuloDetail } from "@/components/VentasCategoriaArticuloDetail";
```

- [ ] **Step 2: Add state for selected entities**

Anadir estados para controlar que detalle esta abierto. Despues de `const [page, setPage] = useState(0);`:

```typescript
const [selectedCliente, setSelectedCliente] = useState<string | null>(null);
const [selectedClienteNombre, setSelectedClienteNombre] = useState<string>("");
const [selectedProducto, setSelectedProducto] = useState<string | null>(null);
const [selectedProductoDesc, setSelectedProductoDesc] = useState<string>("");
const [selectedArticulo, setSelectedArticulo] = useState<string | null>(null);
const [selectedArticuloRef, setSelectedArticuloRef] = useState<string | null>(null);
```

- [ ] **Step 3: Compute monthly evolution data for sparklines**

Despues de `const topArticulos = ...`, anadir:

```typescript
// Monthly evolution data for sparklines
const monthlyEvolution = useMemo(() => {
  const byCliente = new Map<string, Map<string, number>>();
  const source = hasActiveFilters ? displayMensualCliente : mensualCliente;
  source.forEach((row: Record<string, unknown>) => {
    const codigo = String(row.cliente_codigo ?? "");
    const mes = String(row.mes ?? "");
    const kilos = Number(row.kilos ?? 0);
    if (!codigo || !mes) return;
    if (!byCliente.has(codigo)) byCliente.set(codigo, new Map());
    byCliente.get(codigo)!.set(mes, kilos);
  });
  return byCliente;
}, [hasActiveFilters, displayMensualCliente, mensualCliente]);

const getSparklineData = (codigo: string) => {
  const clientData = monthlyEvolution.get(codigo);
  if (!clientData) return [];
  const allMonths = hasActiveFilters
    ? displayMensualCliente.map((r: Record<string, unknown>) => String(r.mes ?? "")).filter(Boolean)
    : mensualCliente.map((r: Record<string, unknown>) => String(r.mes ?? "")).filter(Boolean);
  const uniqueMonths = [...new Set(allMonths)].sort();
  const last6 = uniqueMonths.slice(-6);
  const max = Math.max(...last6.map((m) => clientData.get(m) ?? 0), 1);
  return {
    points: last6.map((mes) => ({ mes, kilos: clientData.get(mes) ?? 0 })),
    maxKilos: max,
  };
};
```

- [ ] **Step 4: Replace Clientes tab content**

Reemplazar el contenido de `<TabsContent value="clientes">`:

```tsx
<TabsContent value="clientes" className="space-y-5">
  {selectedCliente ? (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={() => setSelectedCliente(null)}>
        ← Volver al ranking
      </Button>
      <VentasCategoriaClienteDetail
        clienteCodigo={selectedCliente}
        clienteNombre={selectedClienteNombre}
        allLines={allLines}
        ajuste={ajustes.find((a: Record<string, unknown>) => a.cliente_codigo === selectedCliente)}
        onSaveAjuste={(input) => ventas.updateAjuste.mutate(input)}
      />
    </div>
  ) : (
    <>
      <section className="grid gap-5 xl:grid-cols-2">
        <DataTable title="Ranking por kilos" headers={["#", "Cliente", "Kilos", "PM", "Evolucion"]}>
          {displayRanking.slice(0, 30).map((row: Record<string, unknown>, i: number) => {
            const spark = getSparklineData(String(row.cliente_codigo ?? ""));
            return (
              <TableRow
                key={String(row.cliente_codigo)}
                className="cursor-pointer hover:bg-[var(--glass-bg-strong)]"
                onClick={() => { setSelectedCliente(String(row.cliente_codigo)); setSelectedClienteNombre(String(row.cliente_nombre ?? "")); }}
              >
                <TableCell className="text-xs text-muted-foreground w-6">{i + 1}</TableCell>
                <TableCell className="min-w-[240px]">
                  <div className="font-medium">{String(row.cliente_nombre ?? "")}</div>
                  <div className="text-xs text-muted-foreground">{String(row.cliente_codigo ?? "")}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatKg(Number(row.kilos ?? 0))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(Number(row.pm_real ?? row.pm_venta ?? 0), 3)} EUR/kg</TableCell>
                <TableCell><SparklineCell data={spark.points} maxKilos={spark.maxKilos} /></TableCell>
              </TableRow>
            );
          })}
        </DataTable>
        <DataTable title="Ranking por PM real" headers={["#", "Cliente", "PM real", "Kilos", "Evolucion"]}>
          {[...displayRanking].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
            Number(b.pm_real ?? b.pm_venta ?? 0) - Number(a.pm_real ?? a.pm_venta ?? 0)
          ).slice(0, 30).map((row: Record<string, unknown>, i: number) => {
            const spark = getSparklineData(String(row.cliente_codigo ?? ""));
            return (
              <TableRow
                key={String(row.cliente_codigo)}
                className="cursor-pointer hover:bg-[var(--glass-bg-strong)]"
                onClick={() => { setSelectedCliente(String(row.cliente_codigo)); setSelectedClienteNombre(String(row.cliente_nombre ?? "")); }}
              >
                <TableCell className="text-xs text-muted-foreground w-6">{i + 1}</TableCell>
                <TableCell className="min-w-[240px]">
                  <div className="font-medium">{String(row.cliente_nombre ?? "")}</div>
                  <div className="text-xs text-muted-foreground">{String(row.cliente_codigo ?? "")}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(Number(row.pm_real ?? row.pm_venta ?? 0), 3)} EUR/kg</TableCell>
                <TableCell className="text-right tabular-nums">{formatKg(Number(row.kilos ?? 0))}</TableCell>
                <TableCell><SparklineCell data={spark.points} maxKilos={spark.maxKilos} /></TableCell>
              </TableRow>
            );
          })}
        </DataTable>
      </section>
      <Card className="glass-accented overflow-hidden">
        <CardHeader><CardTitle>Ajustes de comision y transporte</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Kilos</TableHead>
                  <TableHead className="w-28">Comision %</TableHead>
                  <TableHead className="w-32">Comision cent/kg</TableHead>
                  <TableHead className="w-30">Transporte %</TableHead>
                  <TableHead className="w-36">Transporte cent/kg</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRanking.slice(0, 80).map((cliente: Record<string, unknown>) => (
                  <AjusteTableRow
                    key={String(cliente.cliente_codigo)}
                    cliente={cliente}
                    ajuste={ajustes.find((a: Record<string, unknown>) => a.cliente_codigo === cliente.cliente_codigo)}
                    onSave={(input) => ventas.updateAjuste.mutate(input)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  )}
</TabsContent>
```

- [ ] **Step 5: Replace Productos tab content**

Reemplazar el contenido de `<TabsContent value="productos">`:

```tsx
<TabsContent value="productos" className="space-y-5">
  {selectedProducto ? (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={() => setSelectedProducto(null)}>
        ← Volver al ranking
      </Button>
      <VentasCategoriaProductoDetail
        metodo={selectedProducto}
        descripcion={selectedProductoDesc}
        allLines={allLines}
      />
    </div>
  ) : (
    <>
      <ChartCard title="Productos catalogo por mes">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={productMonthlyChart} margin={MARGIN}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="mes" {...XAXIS} />
            <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
            <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
            <Legend wrapperStyle={legendStyle} />
            {catalogo.map((producto: Record<string, unknown>, index: number) => (
              <Bar key={String(producto.metodo)} dataKey={String(producto.metodo)} stackId="kg" name={String(producto.metodo)} fill={SERIES_PALETTE[index % SERIES_PALETTE.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <DataTable title="Productos catalogo" headers={["Metodo", "Descripcion", "Kilos", "PM", "Clientes"]}>
        {catalogo.map((row: Record<string, unknown>) => (
          <TableRow
            key={String(row.id)}
            className="cursor-pointer hover:bg-[var(--glass-bg-strong)]"
            onClick={() => { setSelectedProducto(String(row.metodo)); setSelectedProductoDesc(String(row.descripcion ?? "")); }}
          >
            <TableCell className="font-semibold">{String(row.metodo)}</TableCell>
            <TableCell>{String(row.descripcion ?? "")}</TableCell>
            <TableCell className="text-right tabular-nums">{formatKg(Number(row.kilos))}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(Number(row.base_iva) / Math.max(Number(row.kilos), 1), 3)} EUR/kg</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(filterOptions.metodos.length)}</TableCell>
          </TableRow>
        ))}
      </DataTable>
      <ChartCard title="Comparativa de precio medio por producto">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={productMonthlyChart} margin={MARGIN}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="mes" {...XAXIS} />
            <YAxis {...YAXIS} tickFormatter={(v) => `${formatNumber(Number(v), 2)} EUR`} />
            <Tooltip cursor={CHART_LINE_CURSOR} content={<GlassTooltip formatter={(v) => `${formatNumber(Number(v), 3)} EUR/kg`} />} />
            <Legend wrapperStyle={legendStyle} />
            {catalogo.map((producto: Record<string, unknown>, index: number) => (
              <Line key={String(producto.metodo)} type="monotone" dataKey={String(producto.metodo)} name={String(producto.metodo)} stroke={SERIES_PALETTE[index % SERIES_PALETTE.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </>
  )}
</TabsContent>
```

- [ ] **Step 6: Replace Articulos tab content**

Reemplazar el contenido de `<TabsContent value="articulos">`:

```tsx
<TabsContent value="articulos" className="space-y-5">
  {selectedArticulo ? (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={() => setSelectedArticulo(null)}>
        ← Volver al listado
      </Button>
      <VentasCategoriaArticuloDetail
        articulo={selectedArticulo}
        referencia={selectedArticuloRef}
        allLines={allLines}
      />
    </div>
  ) : (
    (() => {
      const grouped = new Map<string, { referencia: string; articulos: Array<Record<string, unknown>>; totalKilos: number }>();
      displayArticulos.forEach((row: Record<string, unknown>) => {
        const ref = String(row.referencia ?? "SIN REF");
        if (!grouped.has(ref)) grouped.set(ref, { referencia: ref, articulos: [], totalKilos: 0 });
        const group = grouped.get(ref)!;
        group.articulos.push(row);
        group.totalKilos += Number(row.kilos ?? 0);
      });
      return (
        <div className="space-y-3">
          {Array.from(grouped.values()).sort((a, b) => b.totalKilos - a.totalKilos).map((group) => (
            <Card key={group.referencia} className="glass-accented overflow-hidden">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-semibold">
                  {group.referencia} ({group.articulos.length} articulos | {formatKg(group.totalKilos)})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Articulo</TableHead>
                      <TableHead className="text-right">Kilos</TableHead>
                      <TableHead className="text-right">PM</TableHead>
                      <TableHead className="text-right">Lineas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.articulos.sort((a, b) => Number(b.kilos ?? 0) - Number(a.kilos ?? 0)).map((row) => (
                      <TableRow
                        key={`${row.referencia}-${row.articulo}`}
                        className="cursor-pointer hover:bg-[var(--glass-bg-strong)]"
                        onClick={() => { setSelectedArticulo(String(row.articulo)); setSelectedArticuloRef(String(row.referencia ?? "")); }}
                      >
                        <TableCell className="min-w-[320px] font-medium">{String(row.articulo)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(Number(row.kilos))}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(Number(row.pm_bruto ?? row.pm_venta ?? 0), 3)} EUR/kg</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(Number(row.lineas))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      );
    })()
  )}
</TabsContent>
```

- [ ] **Step 7: Replace Base diaria tab content**

Reemplazar el contenido de `<TabsContent value="base">`:

```tsx
<TabsContent value="base" className="space-y-5">
  <DailyGroupTable lines={filteredLines} pageSize={5} />
</TabsContent>
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: BUILD OK

- [ ] **Step 9: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/pages/VentasCategoriaSegunda.tsx
git commit -m "feat: refactor all tabs with detail panels, sparklines, and daily grouping"
```

---

### Task 7: Lint and final verification

**Files:**
All modified files.

- [ ] **Step 1: Run linter**

Run: `npm run lint`
Expected: No errors in changed files (pre-existing errors elsewhere are OK)

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All 222+ tests pass

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: BUILD OK

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: lint and verify build for categoria-segunda full redesign"
```

---

## Spec Coverage Check

| Spec requirement | Task covering it |
|---|---|
| Sparklines de evolucion en tablas | Task 1 (SparklineCell), Task 6 (step 3-4 data) |
| Clientes: vista detalle con KPIs, grafica, productos, articulos | Task 3, Task 6 (step 4) |
| Productos: vista detalle con clientes, evolucion | Task 4, Task 6 (step 5) |
| Productos: grafica comparativa PM | Task 6 (step 5 - LineChart) |
| Articulos: agrupados por referencia con subtotales | Task 6 (step 6 - grouped map) |
| Articulos: vista detalle con clientes, evolucion | Task 5, Task 6 (step 6) |
| Base diaria: agrupada por dia, columnas congeladas, subtotales | Task 2, Task 6 (step 7) |
| Base diaria: boton "Cargar mas" | Task 2 (DailyGroupTable) |
| Dashboard: sin cambios | No se modifica |
| Importar: sin cambios | No se modifica |
