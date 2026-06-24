import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHART_PANEL_CLASS, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS, BAR_STYLE } from "@/lib/chartTheme";
import { formatKg, formatNumber } from "@/lib/format";
import { aggregateVentasCategoria } from "@/lib/ventasCategoria";
import type { VentasCategoriaLineaRow, VentasCategoriaClienteAjusteRow } from "@/lib/types";

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
