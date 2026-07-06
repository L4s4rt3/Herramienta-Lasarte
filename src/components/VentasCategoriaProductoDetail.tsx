import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { CHART_PANEL_CLASS, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS, BAR_STYLE, C } from "@/lib/chartTheme";
import { formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
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
    <div className="space-y-3">
      {/* Cabecera compacta */}
      <div className="glass-accented rounded-xl px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 className="truncate text-base font-bold">{metodo}</h2>
          {descripcion && <span className="text-xs text-muted-foreground">{descripcion}</span>}
        </div>
      </div>

      {/* Metricas en fila */}
      <div className="glass-accented rounded-xl">
        <div className="grid grid-cols-3 gap-x-2 gap-y-2 p-3 sm:flex sm:flex-nowrap sm:items-stretch sm:gap-0 sm:p-0">
          <MiniMetric label="Kilos" value={formatKg(totalKilos)} />
          <MiniMetric label="PM" value={`${formatNumber(totalKilos > 0 ? totalBase / totalKilos : 0, 3)} €/kg`} />
          <MiniMetric label="Clientes" value={String(uniqueClients)} last />
        </div>
      </div>

      <Card className="glass-accented overflow-hidden">
        <CardContent className="space-y-2 p-3">
          <div className="flex items-center gap-2">
            <div className="h-5 w-1 rounded-full bg-primary" />
            <p className="text-sm font-semibold">Evolucion mensual</p>
          </div>
          <div className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="mes" {...XAXIS} />
                <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                <Bar dataKey="kilos" name="Kilos" fill={C.success} stroke={C.success} {...BAR_STYLE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardContent className="p-0">
          <div className="border-b border-[var(--glass-border)] px-3 py-2">
            <p className="text-sm font-semibold">Clientes que compran este producto</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-[var(--glass-bg)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-xl [&>tr>th]:px-3 [&>tr>th]:py-1.5">
                <tr className="border-b border-[var(--glass-border)]">
                  <th>Cliente</th>
                  <th className="text-right">Kilos</th>
                  <th className="text-right">%</th>
                  <th className="text-right">PM</th>
                </tr>
              </thead>
              <tbody>
                {clientRanking.map((c, i) => (
                  <tr key={c.codigo} className={cn("border-b border-[var(--glass-border)] last:border-b-0", i % 2 === 1 && "bg-[var(--glass-bg)]/40")}>
                    <td className="min-w-[200px] px-3 py-1.5 font-medium">{c.nombre}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(c.kilos)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatNumber(totalKilos > 0 ? (c.kilos / totalKilos) * 100 : 0, 1)}%</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(c.kilos > 0 ? c.base / c.kilos : 0, 3)} €/kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniMetric({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={cn("min-w-0 px-3 py-2 sm:flex-1 sm:border-r sm:border-[var(--glass-border)]", last && "sm:border-r-0")}>
      <p className="panel-kicker truncate">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold leading-tight tabular-nums sm:text-[20px]">{value}</p>
    </div>
  );
}
