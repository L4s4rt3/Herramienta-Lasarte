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
