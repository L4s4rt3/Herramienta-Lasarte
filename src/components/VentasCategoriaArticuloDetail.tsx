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
