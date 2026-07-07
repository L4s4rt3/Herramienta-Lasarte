// src/pages/EconomicoCostes.tsx
// Sección "Económico → Costes": cruza los consumos físicos del periodo elegido
// (Semana | Mes | Campaña) con las tarifas vigentes en cada fecha para dar un
// coste total, coste por kg producido y desglose por recurso.
import { useMemo, useState } from "react";
import { Droplet, Euro, Fuel, FlaskConical, Package, Scale, ShieldAlert, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { KPICard } from "@/components/KPICard";
import { ConsumoPeriodoSelector } from "@/components/consumos/ConsumoPeriodoSelector";
import { useCostesPeriodo } from "@/hooks/useEconomico";
import {
  buildPeriodoRange,
  type ConsumoPeriodoTipo,
} from "@/lib/consumoPeriodoView";
import {
  C, GRID, GlassTooltip, MARGIN, XAXIS, YAXIS, barFill, CHART_PANEL_CLASS, CHART_CURSOR,
} from "@/lib/chartTheme";
import { formatDate, formatKg, formatNumber, today } from "@/lib/format";

const RECURSO_LABEL: Record<string, string> = {
  agua: "Agua",
  electricidad: "Electricidad",
  gasoil: "Gasoil",
  quimicos: "Quimicos",
};

const RECURSO_ICON: Record<string, LucideIcon> = {
  agua: Droplet,
  electricidad: Zap,
  gasoil: Fuel,
  quimicos: FlaskConical,
};

function recursoLabel(recurso: string): string {
  return RECURSO_LABEL[recurso] ?? recurso.charAt(0).toUpperCase() + recurso.slice(1);
}

function formatEuro(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, digits)} €`;
}

export default function EconomicoCostes() {
  const [periodoTipo, setPeriodoTipo] = useState<ConsumoPeriodoTipo>("semana");
  const [periodoOffset, setPeriodoOffset] = useState(0);

  const periodoRange = useMemo(() => buildPeriodoRange(periodoTipo, periodoOffset), [periodoTipo, periodoOffset]);
  const isPeriodoActual = periodoOffset === 0;
  const puedeAvanzarPeriodo = periodoRange.start <= today();

  const {
    porRecurso, costeTotal, kgProducidos, costePorKg, hayPreciosACero, serieSemanal, isLoading, sinPermiso,
  } = useCostesPeriodo(periodoRange.start, periodoRange.end);

  const mostrarSerieSemanal = serieSemanal.length >= 3;
  const maxCosteSemanal = Math.max(...serieSemanal.map((s) => s.coste), 0);

  if (sinPermiso) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker">Económico</p>
            <h1 className="page-title">Costes del periodo</h1>
            <p className="page-subtitle">Coste total y por kg producido, según las tarifas vigentes.</p>
          </div>
        </header>
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Acceso restringido</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Solo administración puede ver esta sección.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">Económico</p>
          <h1 className="page-title">Costes del periodo</h1>
          <p className="page-subtitle">Coste total y por kg producido, según las tarifas vigentes.</p>
        </div>
      </header>

      <ConsumoPeriodoSelector
        tipo={periodoTipo}
        onTipoChange={setPeriodoTipo}
        range={periodoRange}
        onNavigate={(direction) => setPeriodoOffset((prev) => prev + direction)}
        onToday={() => setPeriodoOffset(0)}
        isCurrent={isPeriodoActual}
        canNavigateNext={puedeAvanzarPeriodo}
      />

      {hayPreciosACero && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex items-center gap-3 pt-6">
            <ShieldAlert className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <span className="font-semibold">Faltan tarifas reales:</span> hay consumo registrado sin tarifa (o con precio 0), así que su coste sale a 0 abajo.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <KPICard
            label="Coste total"
            value={formatEuro(costeTotal)}
            icon={Euro}
            hint={`${porRecurso.length} recurso(s) con consumo`}
          />
          <KPICard
            label="Coste / kg producido"
            value={costePorKg != null ? `${formatNumber(costePorKg, 4)} €/kg` : "—"}
            icon={Scale}
            hint={kgProducidos > 0 ? undefined : "Sin kg producidos en el periodo"}
          />
          <KPICard
            label="Kg producidos"
            value={formatKg(kgProducidos)}
            icon={Package}
            accent="success"
          />
        </section>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardHeader>
          <p className="panel-kicker">Desglose</p>
          <CardTitle>Coste por recurso — {periodoRange.label}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">Cargando…</div>
          ) : porRecurso.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              Sin consumo registrado en este periodo.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recurso</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Precio aplicado (medio)</TableHead>
                  <TableHead className="text-right">Coste</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porRecurso.map((fila) => {
                  const Icon = RECURSO_ICON[fila.recurso] ?? Droplet;
                  return (
                    <TableRow key={fila.recurso}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          {recursoLabel(fila.recurso)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(fila.cantidad, 0)} {fila.unidad}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fila.unidadPrecio && fila.precioMedio != null
                          ? `${formatNumber(fila.precioMedio, 4)} €/${fila.unidadPrecio}`
                          : (
                            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                              Sin tarifa
                            </Badge>
                          )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatEuro(fila.coste)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {mostrarSerieSemanal && (
        <Card className="glass-accented overflow-hidden">
          <CardHeader>
            <p className="panel-kicker">Evolución</p>
            <CardTitle>Coste total por semana</CardTitle>
          </CardHeader>
          <CardContent className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={serieSemanal} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis {...XAXIS} dataKey="semanaInicio" tickFormatter={(value: string) => formatDate(value)} />
                <YAxis {...YAXIS} domain={[0, Math.max(maxCosteSemanal * 1.15, 1)]} />
                <Tooltip
                  cursor={CHART_CURSOR}
                  content={({ active, payload, label }) => (
                    <GlassTooltip
                      active={active}
                      payload={payload as { name: string; value: number | string; color?: string; fill?: string; stroke?: string }[] | undefined}
                      label={label ? `Semana del ${formatDate(String(label))}` : undefined}
                      formatter={(value) => formatEuro(Number(value))}
                    />
                  )}
                />
                <Bar
                  dataKey="coste"
                  name="Coste total"
                  fill={barFill(C.primary, 0.4)}
                  stroke={C.primary}
                  strokeWidth={1.5}
                  radius={[6, 6, 2, 2]}
                  maxBarSize={34}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        El agua usa la regla de contadores (subcontadores no suman); los costes usan la tarifa vigente en cada fecha.
      </p>
    </div>
  );
}
