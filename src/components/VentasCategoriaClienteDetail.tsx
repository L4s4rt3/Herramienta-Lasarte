import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { MiniKpi } from "@/components/MiniKpi";
import { CHART_PANEL_CLASS, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS, BAR_STYLE, C } from "@/lib/chartTheme";
import { formatKg, formatNumber } from "@/lib/format";
import { aggregateVentasCategoria } from "@/lib/ventasCategoria";
import { cn } from "@/lib/utils";
import type { VentasCategoriaLineaRow, VentasCategoriaClienteAjusteRow } from "@/lib/types";
import type { VentasCategoriaAjusteInput } from "@/hooks/useVentasCategoria";

interface VentasCategoriaClienteDetailProps {
  clienteCodigo: string;
  clienteNombre: string;
  allLines: VentasCategoriaLineaRow[];
  ajuste?: VentasCategoriaClienteAjusteRow;
  onSaveAjuste: (input: VentasCategoriaAjusteInput) => void;
}

export function VentasCategoriaClienteDetail({ clienteCodigo, clienteNombre, allLines, ajuste, onSaveAjuste }: VentasCategoriaClienteDetailProps) {
  const clienteLines = useMemo(
    () => allLines.filter((l) => l.cliente_codigo === clienteCodigo),
    [allLines, clienteCodigo]
  );

  const aggregation = useMemo(() => aggregateVentasCategoria(clienteLines), [clienteLines]);
  const { resumen, productos, articulos } = aggregation;

  const pmReal = useMemo(() => {
    if (!ajuste) return resumen.pm_venta;
    const descuentoPct = (ajuste.comision_pct + ajuste.transporte_pct) / 100;
    const descuentoCentKg = (ajuste.comision_cent_kg + ajuste.transporte_cent_kg) / 100;
    return Math.max(0, resumen.pm_venta * (1 - descuentoPct) - descuentoCentKg);
  }, [ajuste, resumen.pm_venta]);

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
    <div className="space-y-3">
      {/* Cabecera compacta */}
      <div className="glass-accented rounded-xl px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 className="truncate text-base font-bold">{clienteNombre}</h2>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {clienteCodigo} · {productos.length} producto{productos.length === 1 ? "" : "s"} · {articulos.length} articulo{articulos.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Metricas en fila */}
      <div className="glass-accented rounded-xl">
        <div className="grid grid-cols-2 gap-x-2 gap-y-2 p-3 sm:flex sm:flex-nowrap sm:items-stretch sm:gap-0 sm:p-0">
          <MiniKpi label="Kilos" value={formatKg(resumen.kilos)} size="lg" />
          <MiniKpi label="PM bruto" value={`${formatNumber(resumen.pm_venta, 3)} €/kg`} size="lg" />
          <MiniKpi
            label="PM real"
            value={`${formatNumber(pmReal, 3)} €/kg`}
            sub={ajuste ? "tras ajustes" : "sin ajustes"}
            subBlock
            labelInfo="Precio medio tras aplicar la comision y el transporte configurados para este cliente."
            labelInfoIcon
            size="lg"
          />
          <MiniKpi label="Base IVA" value={`${formatNumber(resumen.base_iva, 2)} €`} last size="lg" />
        </div>
      </div>

      {/* Evolucion */}
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
                <Bar dataKey="kilos" name="Kilos" fill={C.primary} stroke={C.primary} {...BAR_STYLE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Ajustes de comision/transporte */}
      <AjusteEditor clienteCodigo={clienteCodigo} clienteNombre={clienteNombre} ajuste={ajuste} onSave={onSaveAjuste} />

      {/* Productos y articulos */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="glass-accented overflow-hidden">
          <CardContent className="p-0">
            <div className="border-b border-[var(--glass-border)] px-3 py-2">
              <p className="text-sm font-semibold">Productos</p>
            </div>
            <table className="w-full text-[13px]">
              <thead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>tr>th]:px-3 [&>tr>th]:py-1.5">
                <tr className="border-b border-[var(--glass-border)]">
                  <th>Método</th>
                  <th className="text-right">Kilos</th>
                  <th className="text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {productos.slice(0, 10).map((p, i) => (
                  <tr key={p.key} className={cn("border-b border-[var(--glass-border)] last:border-b-0", i % 2 === 1 && "bg-[var(--glass-bg)]/40")}>
                    <td className="px-3 py-1.5">{p.metodo_producto}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(p.kilos)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatNumber(resumen.kilos > 0 ? (p.kilos / resumen.kilos) * 100 : 0, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card className="glass-accented overflow-hidden">
          <CardContent className="p-0">
            <div className="border-b border-[var(--glass-border)] px-3 py-2">
              <p className="text-sm font-semibold">Artículos top</p>
            </div>
            <table className="w-full text-[13px]">
              <thead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>tr>th]:px-3 [&>tr>th]:py-1.5">
                <tr className="border-b border-[var(--glass-border)]">
                  <th>Artículo</th>
                  <th className="text-right">Kilos</th>
                </tr>
              </thead>
              <tbody>
                {articulos.slice(0, 10).map((a, i) => (
                  <tr key={a.key} className={cn("border-b border-[var(--glass-border)] last:border-b-0", i % 2 === 1 && "bg-[var(--glass-bg)]/40")}>
                    <td className="max-w-[220px] truncate px-3 py-1.5">{a.articulo}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(a.kilos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AjusteEditor({ clienteCodigo, clienteNombre, ajuste, onSave }: {
  clienteCodigo: string;
  clienteNombre: string;
  ajuste?: VentasCategoriaClienteAjusteRow;
  onSave: (input: VentasCategoriaAjusteInput) => void;
}) {
  const [values, setValues] = useState({
    comision_pct: Number(ajuste?.comision_pct ?? 0),
    comision_cent_kg: Number(ajuste?.comision_cent_kg ?? 0),
    transporte_pct: Number(ajuste?.transporte_pct ?? 0),
    transporte_cent_kg: Number(ajuste?.transporte_cent_kg ?? 0),
  });

  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: Number(value) || 0 }));

  return (
    <Card className="glass-accented">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded-full bg-primary" />
          <p className="text-sm font-semibold">Ajustes de comision y transporte</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FieldNumber label="Comision %" value={values.comision_pct} onChange={(v) => set("comision_pct", v)} />
          <FieldNumber label="Comision cent/kg" value={values.comision_cent_kg} onChange={(v) => set("comision_cent_kg", v)} />
          <FieldNumber label="Transporte %" value={values.transporte_pct} onChange={(v) => set("transporte_pct", v)} />
          <FieldNumber label="Transporte cent/kg" value={values.transporte_cent_kg} onChange={(v) => set("transporte_cent_kg", v)} />
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => onSave({ cliente_codigo: clienteCodigo, cliente_nombre: clienteNombre, ...values })}
        >
          <Save className="h-3.5 w-3.5" /> Guardar ajuste
        </Button>
      </CardContent>
    </Card>
  );
}

function FieldNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="panel-kicker">{label}</label>
      <Input type="number" className="h-8 text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
