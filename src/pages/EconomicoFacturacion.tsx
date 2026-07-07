// src/pages/EconomicoFacturacion.tsx
// Sección "Económico → Facturación": factura de Mercadona (base IVA de
// mercadona_semanas / mercadona_semana_metodos) — la única fuente de € de venta
// disponible hoy. Solo las semanas importadas con el formato semanal real traen
// base_iva por método + ajustes/abonos; las semanas históricas no lo incluían.
import { useMemo } from "react";
import { AlertTriangle, Euro, Percent, Scale } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KPICard } from "@/components/KPICard";
import { useMercadonaVentas, type MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { formatMercadonaWeekRangeLabel } from "@/lib/mercadonaVentas";
import { metodoLabel, METODOS_ORDEN } from "@/components/mercadona/mercadonaAnalisis.helpers";
import {
  C, GRID, GlassTooltip, MARGIN, XAXIS, YAXIS, barFill, CHART_PANEL_CLASS, CHART_CURSOR,
} from "@/lib/chartTheme";
import { formatKg, formatNumber, formatPct } from "@/lib/format";

function formatEuro(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, digits)} €`;
}

/** true si la semana trae base_iva real (formato semanal real, v2), no el histórico. */
function tieneBaseIva(semana: MercadonaSemanaConMetodos): boolean {
  return semana.metodos.some((m) => m.base_iva != null) || semana.ajustes_base_iva != null;
}

interface FilaSemana {
  id: string;
  anio: number;
  semana: number;
  facturacionMetodos: number;
  ajustes: number;
  neto: number;
  vendidoKg: number;
  eurosPorKg: number | null;
}

function buildFilasSemana(semanas: MercadonaSemanaConMetodos[]): FilaSemana[] {
  return semanas
    .filter(tieneBaseIva)
    .map((s) => {
      const facturacionMetodos = s.metodos.reduce((sum, m) => sum + (m.base_iva ?? 0), 0);
      const ajustes = s.ajustes_base_iva ?? 0;
      const neto = facturacionMetodos + ajustes;
      const vendidoKg = s.vendido_kg ?? 0;
      return {
        id: s.id,
        anio: s.anio,
        semana: s.semana,
        facturacionMetodos,
        ajustes,
        neto,
        vendidoKg,
        eurosPorKg: vendidoKg > 0 ? neto / vendidoKg : null,
      };
    })
    .sort((a, b) => (a.anio - b.anio) || (a.semana - b.semana));
}

interface FilaMetodo {
  metodo: string;
  kilos: number;
  baseIva: number;
  eurosPorKg: number | null;
}

function buildFilasMetodo(semanasConBaseIva: MercadonaSemanaConMetodos[]): FilaMetodo[] {
  const acc = new Map<string, { kilos: number; baseIva: number }>();
  for (const semana of semanasConBaseIva) {
    for (const m of semana.metodos) {
      if (m.base_iva == null) continue;
      const entry = acc.get(m.metodo) ?? { kilos: 0, baseIva: 0 };
      entry.kilos += m.kilos ?? 0;
      entry.baseIva += m.base_iva;
      acc.set(m.metodo, entry);
    }
  }
  const codigos = Array.from(new Set([...METODOS_ORDEN, ...acc.keys()])).filter((codigo) => acc.has(codigo));
  return codigos.map((codigo) => {
    const entry = acc.get(codigo)!;
    return {
      metodo: codigo,
      kilos: entry.kilos,
      baseIva: entry.baseIva,
      eurosPorKg: entry.kilos > 0 ? entry.baseIva / entry.kilos : null,
    };
  });
}

export default function EconomicoFacturacion() {
  const { semanas, isLoading, tablesMissing } = useMercadonaVentas();

  const semanasConBaseIva = useMemo(() => semanas.filter(tieneBaseIva), [semanas]);
  const filasSemana = useMemo(() => buildFilasSemana(semanas), [semanas]);
  const filasMetodo = useMemo(() => buildFilasMetodo(semanasConBaseIva), [semanasConBaseIva]);

  const facturacionBruta = useMemo(
    () => filasSemana.reduce((sum, f) => sum + f.facturacionMetodos, 0),
    [filasSemana],
  );
  const totalAjustes = useMemo(() => filasSemana.reduce((sum, f) => sum + f.ajustes, 0), [filasSemana]);
  const facturacionNeta = facturacionBruta + totalAjustes;
  const vendidoKgTotal = useMemo(() => filasSemana.reduce((sum, f) => sum + f.vendidoKg, 0), [filasSemana]);
  const eurosPorKgMedio = vendidoKgTotal > 0 ? facturacionNeta / vendidoKgTotal : null;
  const pesoAjustesPct = facturacionBruta > 0 ? (totalAjustes / facturacionBruta) * 100 : null;

  const mostrarGrafico = filasSemana.length >= 2;
  const maxNeto = Math.max(...filasSemana.map((f) => f.neto), 0);

  if (tablesMissing) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker">Económico</p>
            <h1 className="page-title">Facturación</h1>
            <p className="page-subtitle">Facturación de Mercadona por semana y por método.</p>
          </div>
        </header>
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Sección pendiente de activar</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Las tablas de ventas semanales de Mercadona todavía no existen en la base de datos.
                En cuanto se aplique la migración correspondiente, esta sección funcionará con normalidad.
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
          <h1 className="page-title">Facturación</h1>
          <p className="page-subtitle">
            Facturación de Mercadona por semana y por método — la única fuente de € de venta hoy.
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : filasSemana.length === 0 ? (
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <h2 className="text-lg font-semibold">Sin facturación importada</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Ninguna semana importada trae todavía base IVA. Importa una semana con el formato semanal real
                desde Mercadona → Importar para que aparezca aquí.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <KPICard
              label="Facturación total"
              value={formatEuro(facturacionNeta)}
              icon={Euro}
              hint={`${filasSemana.length} semana(s) con base IVA`}
            />
            <KPICard
              label="€ / kg medio"
              value={eurosPorKgMedio != null ? `${formatNumber(eurosPorKgMedio, 3)} €/kg` : "—"}
              icon={Scale}
            />
            <KPICard
              label="Peso de ajustes/abonos"
              value={formatEuro(totalAjustes)}
              icon={Percent}
              accent={totalAjustes < 0 ? "warning" : "primary"}
              hint={pesoAjustesPct != null ? `${formatPct(pesoAjustesPct)} sobre facturación bruta` : undefined}
            />
          </section>

          <Card className="glass-accented overflow-hidden">
            <CardHeader>
              <p className="panel-kicker">Detalle</p>
              <CardTitle>Facturación por semana</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Semana</TableHead>
                    <TableHead className="text-right">Métodos</TableHead>
                    <TableHead className="text-right">Ajustes</TableHead>
                    <TableHead className="text-right">Neto</TableHead>
                    <TableHead className="text-right">Vendido</TableHead>
                    <TableHead className="text-right">€/kg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filasSemana.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">
                        <div>S{f.semana} · {f.anio}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatMercadonaWeekRangeLabel(f.anio, f.semana)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(f.facturacionMetodos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(f.ajustes)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatEuro(f.neto)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKg(f.vendidoKg)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.eurosPorKg != null ? `${formatNumber(f.eurosPorKg, 3)} €/kg` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="glass-accented overflow-hidden">
            <CardHeader>
              <p className="panel-kicker">Desglose</p>
              <CardTitle>Facturación por método</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {filasMetodo.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
                  Sin datos de base IVA por método.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Método</TableHead>
                      <TableHead className="text-right">Kilos</TableHead>
                      <TableHead className="text-right">Base IVA</TableHead>
                      <TableHead className="text-right">€/kg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filasMetodo.map((f) => (
                      <TableRow key={f.metodo}>
                        <TableCell className="font-medium">
                          <div>{metodoLabel(f.metodo)}</div>
                          <div className="text-xs text-muted-foreground">{f.metodo}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatKg(f.kilos)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatEuro(f.baseIva)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {f.eurosPorKg != null ? `${formatNumber(f.eurosPorKg, 3)} €/kg` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {mostrarGrafico && (
            <Card className="glass-accented overflow-hidden">
              <CardHeader>
                <p className="panel-kicker">Evolución</p>
                <CardTitle>Facturación neta por semana</CardTitle>
              </CardHeader>
              <CardContent className={CHART_PANEL_CLASS}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={filasSemana.map((f) => ({ ...f, label: `S${f.semana}` }))} margin={MARGIN}>
                    <CartesianGrid {...GRID} />
                    <XAxis {...XAXIS} dataKey="label" />
                    <YAxis {...YAXIS} domain={[0, Math.max(maxNeto * 1.15, 1)]} />
                    <Tooltip
                      cursor={CHART_CURSOR}
                      content={({ active, payload, label }) => (
                        <GlassTooltip
                          active={active}
                          payload={payload as { name: string; value: number | string; color?: string; fill?: string; stroke?: string }[] | undefined}
                          label={label ? `Semana ${String(label)}` : undefined}
                          formatter={(value) => formatEuro(Number(value))}
                        />
                      )}
                    />
                    <Bar
                      dataKey="neto"
                      name="Facturación neta"
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
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Solo las semanas importadas con el fichero semanal traen facturación; las históricas no incluían base IVA.
      </p>
    </div>
  );
}
