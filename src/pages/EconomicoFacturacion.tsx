// src/pages/EconomicoFacturacion.tsx
// Sección "Económico → Facturación": factura de Mercadona (base IVA de
// mercadona_semanas / mercadona_semana_metodos) por semana y por método. Ya
// NO es la única fuente de € de venta: las ventas de categoría segunda
// (clientes fijos LN211/LN314/LN210/LN560/L1020/L1511/LN551, ver
// ventasMensualImport.ts) se importan aparte con granularidad MENSUAL, no
// semanal, así que se muestran en una tarjeta informativa propia en vez de
// mezclarlas con la tabla/gráfico semanal de Mercadona (ver useEconomicoPanel
// para el cruce completo facturación-coste que sí las suma). Solo las
// semanas importadas con el formato semanal real traen base_iva por método +
// ajustes/abonos; las semanas históricas no lo incluían.
import { useMemo } from "react";
import type { Worksheet } from "exceljs";
import { AlertTriangle, Download, Euro, Percent, Scale, Tag } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KPICard } from "@/components/KPICard";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useMercadonaVentas, type MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { useVentasCategoria } from "@/hooks/useVentasCategoria";
import { formatMercadonaWeekRangeLabel, mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { metodoLabel, METODOS_ORDEN } from "@/components/mercadona/mercadonaAnalisis.helpers";
import {
  C, GRID, GlassTooltip, MARGIN, XAXIS, YAXIS, barFill, CHART_PANEL_CLASS, CHART_CURSOR,
} from "@/lib/chartTheme";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKg, formatNumber, formatPct } from "@/lib/format";
import {
  añadirHojaTabla, crearLibroLasarte, descargarLibro, FMT_EUR, FMT_EUR_KG, FMT_KG, LASARTE_COLORS,
  type ColumnaTabla,
} from "@/lib/exportKit";
import { buildLasarteFilename } from "@/lib/reportKit";

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

// ─── Export Excel (marca Lasarte, clasificación Dirección) ──────────────────
// Una fila por semana + método con base IVA (kg/€/kg/base imponible propios del
// método), con los ajustes/abonos y el neto de la semana repetidos en cada fila
// de esa semana (son un dato semanal, no por método): así la hoja queda plana y
// filtrable sin duplicar el total al sumar columnas — los totales de la fila
// TOTAL se calculan aparte, no sumando las filas mostradas.
const FACTURACION_COLUMNAS: ColumnaTabla[] = [
  { header: "Semana", key: "semana", width: 20 },
  { header: "Método", key: "metodo", width: 26 },
  { header: "Kg facturados", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 16 },
  { header: "€/kg", key: "eurosPorKg", tipo: "numero", numFmt: FMT_EUR_KG, width: 14 },
  { header: "Base imponible", key: "baseImponible", tipo: "numero", numFmt: FMT_EUR, width: 16 },
  { header: "Ajustes/abonos", key: "ajustes", tipo: "numero", numFmt: FMT_EUR, width: 16 },
  { header: "Neto", key: "neto", tipo: "numero", numFmt: FMT_EUR, width: 16 },
];

// Nota fiscal (spec §17 "Requisitos AEAT de factura"): además del aviso de
// clasificación "Dirección" que ya imprime añadirHojaTabla, se añade esta línea
// de pie adicional porque este informe puede usarse como soporte económico.
const NOTA_FISCAL_FACTURACION =
  "Uso como soporte fiscal: cruzar siempre con la numeración de factura, la base imponible y el IVA del documento oficial de Mercadona antes de presentarlo ante la AEAT.";

function añadirNotaFiscal(ws: Worksheet, totalCols: number) {
  const rowIndex = ws.rowCount + 1;
  const cols = Math.max(totalCols, 1);
  ws.mergeCells(rowIndex, 1, rowIndex, cols);
  const cell = ws.getRow(rowIndex).getCell(1);
  cell.value = NOTA_FISCAL_FACTURACION;
  cell.font = { name: "Calibri", size: 7.5, italic: true, color: { argb: `FF${LASARTE_COLORS.grisMedio}` } };
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
}

interface TotalesFacturacion {
  vendidoKgTotal: number;
  eurosPorKgMedio: number | null;
  facturacionBruta: number;
  totalAjustes: number;
  facturacionNeta: number;
}

async function exportarFacturacion(
  semanasConBaseIva: MercadonaSemanaConMetodos[],
  filasSemana: FilaSemana[],
  totales: TotalesFacturacion,
  usuario: string | undefined,
) {
  try {
    const semanasOrdenadas = [...semanasConBaseIva].sort((a, b) => (a.anio - b.anio) || (a.semana - b.semana));
    const filasPorId = new Map(filasSemana.map((f) => [f.id, f]));

    const filas: Record<string, unknown>[] = [];
    for (const semana of semanasOrdenadas) {
      const fila = filasPorId.get(semana.id);
      const ajustes = semana.ajustes_base_iva ?? 0;
      const neto = fila?.neto ?? 0;
      const semanaLabel = `S${semana.semana} · ${semana.anio}`;
      const metodosConBase = semana.metodos.filter((m) => m.base_iva != null);

      if (metodosConBase.length === 0) {
        filas.push({ semana: semanaLabel, metodo: "—", kg: 0, eurosPorKg: null, baseImponible: 0, ajustes, neto });
        continue;
      }

      for (const m of metodosConBase) {
        const kg = m.kilos ?? 0;
        const baseIva = m.base_iva as number;
        filas.push({
          semana: semanaLabel,
          metodo: metodoLabel(m.metodo),
          kg,
          eurosPorKg: kg > 0 ? baseIva / kg : null,
          baseImponible: baseIva,
          ajustes,
          neto,
        });
      }
    }

    let desde: string | undefined;
    let hasta: string | undefined;
    for (const semana of semanasOrdenadas) {
      const rango = mercadonaWeekDateRange(semana.anio, semana.semana);
      if (!desde || rango.desde < desde) desde = rango.desde;
      if (!hasta || rango.hasta > hasta) hasta = rango.hasta;
    }

    const ctx = crearLibroLasarte({
      titulo: "Facturación Mercadona",
      periodo: desde && hasta ? `${formatDate(desde)} - ${formatDate(hasta)}` : undefined,
      usuario,
      filtros: `${semanasOrdenadas.length} semana(s) con base IVA`,
      clasificacion: "Dirección",
    });

    const ws = añadirHojaTabla(ctx, {
      nombreHoja: "Facturación Mercadona",
      columnas: FACTURACION_COLUMNAS,
      filas,
      totales: {
        semana: "TOTAL",
        metodo: "",
        kg: totales.vendidoKgTotal,
        eurosPorKg: totales.eurosPorKgMedio,
        baseImponible: totales.facturacionBruta,
        ajustes: totales.totalAjustes,
        neto: totales.facturacionNeta,
      },
    });
    añadirNotaFiscal(ws, FACTURACION_COLUMNAS.length);

    await descargarLibro(
      ctx,
      buildLasarteFilename("Facturacion_Mercadona", "xlsx", desde && hasta ? { from: desde, to: hasta } : undefined),
    );
    toast({ title: "Facturación exportada" });
  } catch (err) {
    toast({ title: "Error al exportar la facturación", description: errorMessage(err), variant: "destructive" });
  }
}

export default function EconomicoFacturacion() {
  const { user } = useAuth();
  const { semanas, isLoading, tablesMissing } = useMercadonaVentas();
  const segunda = useVentasCategoria("Categoria segunda");
  const segundaResumen = segunda.resumenQuery.data;

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
            Facturación de Mercadona por semana y por método. Las ventas de categoría segunda se muestran aparte
            (dato mensual, no semanal).
          </p>
        </div>
        <Button
          variant="outline"
          className="glass glass-hover gap-1.5"
          disabled={filasSemana.length === 0}
          onClick={() => exportarFacturacion(
            semanasConBaseIva,
            filasSemana,
            { vendidoKgTotal, eurosPorKgMedio, facturacionBruta, totalAjustes, facturacionNeta },
            user?.email ?? undefined,
          )}
        >
          <Download className="h-4 w-4" /> Descargar Excel
        </Button>
      </header>

      {/* ─── Ventas de categoría segunda (dato mensual, no semanal — ver cabecera) ─── */}
      {segunda.hasAccess && (
        <Card className="glass border-[var(--glass-border)] bg-[var(--glass-bg)]">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <Tag className="h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="text-sm">
                <span className="font-semibold text-foreground">Ventas de categoría segunda (total importado):</span>{" "}
                {segunda.resumenQuery.isLoading
                  ? "Cargando…"
                  : segundaResumen
                    ? `${formatEuro(segundaResumen.base_iva)} · ${formatKg(segundaResumen.kilos)}`
                    : "Sin datos importados todavía"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Clientes fijos (LN211/LN314/LN210/LN560/L1020/L1511/LN551) del importador mensual — no incluye
                Mercadona, no hay doble conteo con la facturación de arriba. El total de esta tarjeta es acumulado de
                todo lo importado, no del periodo: la granularidad mensual no encaja con la vista semanal de esta
                página (ver el cruce por rango en Económico → Panel).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

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
