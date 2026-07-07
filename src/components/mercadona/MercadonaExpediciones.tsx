// src/components/mercadona/MercadonaExpediciones.tsx
// Pestaña "Expediciones": lo que realmente SALIO del almacen hacia Mercadona,
// palet a palet (tabla palets_dia). Incluye el cruce de las tres patas:
// confeccionado MDNA (produccion) vs expedido (palets, bruto) vs vendido
// (Excel de Mercadona).
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, Boxes, Package, Scale, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KPICard } from "@/components/KPICard";
import {
  useMercadonaExpediciones, useMercadonaExpedicionesSemanales, useMercadonaConfeccionadoSemanal,
} from "@/hooks/useMercadonaExpediciones";
import type { MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { formatKg, formatNumber } from "@/lib/format";
import { BAR_STYLE, C, CHART_PANEL_CLASS, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS } from "@/lib/chartTheme";
import { cn } from "@/lib/utils";

const AVISO_KG_BRUTOS =
  "Kg brutos de palets: no descuentan las mujeres del calibrador, por lo que van algo inflados respecto a la producción real. Úsalo como orientación, no como dato exacto.";

const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function MercadonaExpediciones({
  semanas, activeSemana,
}: {
  semanas: MercadonaSemanaConMetodos[];
  activeSemana: MercadonaSemanaConMetodos | null;
}) {
  const rango = activeSemana ? mercadonaWeekDateRange(activeSemana.anio, activeSemana.semana) : null;
  const expediciones = useMercadonaExpediciones(rango?.desde ?? "1970-01-01", rango?.hasta ?? "1970-01-01");
  const expedicionesSemanales = useMercadonaExpedicionesSemanales(semanas);
  const confeccionadoSemanal = useMercadonaConfeccionadoSemanal(semanas);

  if (semanas.length === 0 || !activeSemana) {
    return (
      <div className="space-y-4">
        <AvisoKgBrutos />
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Truck className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <h2 className="text-lg font-semibold">Todavía no hay semanas importadas</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Importa el Excel de Mercadona en la pestaña "Importar" para ver las expediciones cruzadas con esta semana.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AvisoKgBrutos />

      <KpisSemana expediciones={expediciones} />

      <ExpedicionesPorDia expediciones={expediciones} rango={rango} />

      <CruceTresPatas
        semanas={semanas}
        expedicionesSemanales={expedicionesSemanales}
        confeccionadoSemanal={confeccionadoSemanal}
      />

      <ProductosExpedidos expediciones={expediciones} />
    </div>
  );
}

// ─── Sub-secciones ───────────────────────────────────────────────────────────

function AvisoKgBrutos() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-sm text-warning">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="leading-relaxed">{AVISO_KG_BRUTOS}</p>
    </div>
  );
}

function KpisSemana({ expediciones }: { expediciones: ReturnType<typeof useMercadonaExpediciones> }) {
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <KPICard
        className="glass-accented"
        label="Kg expedidos"
        value={expediciones.isLoading ? "…" : formatKg(expediciones.kg_total)}
        hint="Bruto de palets, no producción neta"
        accent="warning"
        icon={Truck}
        labelInfo={AVISO_KG_BRUTOS}
      />
      <KPICard
        className="glass-accented"
        label="Palets"
        value={expediciones.isLoading ? "…" : formatNumber(expediciones.n_palets)}
        icon={Boxes}
      />
      <KPICard
        className="glass-accented"
        label="Cajas"
        value={expediciones.isLoading ? "…" : formatNumber(expediciones.n_cajas)}
        icon={Package}
      />
      <KPICard
        className="glass-accented"
        label="Media kg/palet"
        value={expediciones.isLoading ? "…" : formatKg(expediciones.kg_por_palet, 1)}
        icon={Scale}
      />
    </section>
  );
}

function ExpedicionesPorDia({
  expediciones, rango,
}: {
  expediciones: ReturnType<typeof useMercadonaExpediciones>;
  rango: { desde: string; hasta: string } | null;
}) {
  const data = expediciones.por_dia.map((d) => {
    const idx = new Date(`${d.date}T12:00:00`).getDay(); // 0=domingo..6=sabado
    const label = idx >= 1 && idx <= 6 ? DIAS_SEMANA[idx - 1] : d.date;
    return { ...d, label };
  });

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Expedido por día</CardTitle>
        <p className="text-xs text-muted-foreground">
          Kg brutos de palets a Mercadona, lunes a sábado{rango ? ` (${rango.desde} – ${rango.hasta})` : ""}.
        </p>
      </CardHeader>
      <CardContent>
        {expediciones.isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin palets expedidos a Mercadona esta semana.</p>
        ) : (
          <div className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data} margin={MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" {...XAXIS} />
                <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                <Bar dataKey="kg" name="Kg expedidos" fill={C.warning} stroke={C.warning} {...BAR_STYLE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CruceTresPatas({
  semanas, expedicionesSemanales, confeccionadoSemanal,
}: {
  semanas: MercadonaSemanaConMetodos[];
  expedicionesSemanales: ReturnType<typeof useMercadonaExpedicionesSemanales>;
  confeccionadoSemanal: ReturnType<typeof useMercadonaConfeccionadoSemanal>;
}) {
  const isLoading = expedicionesSemanales.isLoading || confeccionadoSemanal.isLoading;

  const filas = semanas.map((s) => {
    const confeccionado = confeccionadoSemanal.porSemana.find((c) => c.anio === s.anio && c.semana === s.semana)?.kg ?? 0;
    const expedido = expedicionesSemanales.porSemana.find((e) => e.anio === s.anio && e.semana === s.semana)?.kg ?? 0;
    const vendido = s.vendido_kg ?? 0;
    return {
      id: s.id,
      anio: s.anio,
      semana: s.semana,
      confeccionado,
      expedido,
      vendido,
      difExpedidoConfeccionado: expedido - confeccionado,
      difVendidoExpedido: vendido - expedido,
    };
  });

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">El cruce de las tres patas</CardTitle>
        <p className="text-xs text-muted-foreground">
          Confeccionado (producción MDNA) vs expedido (palets, bruto) vs vendido (Excel de Mercadona), semana a semana.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin semanas para comparar.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                  <tr>
                    <th className="text-left">Semana</th>
                    <th className="text-right">Confeccionado MDNA</th>
                    <th className="text-right">Expedido (bruto)</th>
                    <th className="text-right">Vendido (Excel)</th>
                    <th className="text-right">Exp. − Conf.</th>
                    <th className="text-right">Vend. − Exp.</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={f.id} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                      <td className="px-3 py-1.5 font-semibold">S{f.semana} · {f.anio}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(f.confeccionado)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(f.expedido)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{f.vendido > 0 ? formatKg(f.vendido) : "—"}</td>
                      <td className={cn(
                        "px-3 py-1.5 text-right tabular-nums",
                        f.difExpedidoConfeccionado >= 0 ? "text-success" : "text-destructive",
                      )}>
                        {f.difExpedidoConfeccionado >= 0 ? "+" : ""}{formatKg(f.difExpedidoConfeccionado)}
                      </td>
                      <td className={cn(
                        "px-3 py-1.5 text-right tabular-nums",
                        f.vendido === 0 ? "text-muted-foreground" : f.difVendidoExpedido >= 0 ? "text-success" : "text-destructive",
                      )}>
                        {f.vendido > 0 ? `${f.difVendidoExpedido >= 0 ? "+" : ""}${formatKg(f.difVendidoExpedido)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-3 pb-3 text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Confeccionado</strong>: kg de producto MDNA que salió de la línea de confección
              (producto_dia), la producción real. <strong className="text-foreground">Expedido</strong>: kg brutos de los palets
              que salieron físicamente hacia Mercadona (palets_dia) — inflados porque no descuentan el calibrador, por eso suele
              ser algo mayor que lo confeccionado. <strong className="text-foreground">Vendido</strong>: kg que Mercadona reporta
              en su propio Excel de ventas, con su propia logística/mermas de por medio, así que tampoco tiene por qué coincidir
              exactamente con lo expedido. Las tres patas miden cosas distintas: no cuadrar exactamente es esperable.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProductosExpedidos({ expediciones }: { expediciones: ReturnType<typeof useMercadonaExpediciones> }) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Productos expedidos</CardTitle>
        <p className="text-xs text-muted-foreground">Palets a Mercadona de esta semana, agrupados por producto.</p>
      </CardHeader>
      <CardContent className="p-0">
        {expediciones.isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : expediciones.por_producto.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin palets expedidos a Mercadona esta semana.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                <tr>
                  <th className="text-left">Producto</th>
                  <th className="text-right">Palets</th>
                  <th className="text-right">Kg</th>
                  <th className="text-right">% del total</th>
                </tr>
              </thead>
              <tbody>
                {expediciones.por_producto.map((p, i) => (
                  <tr key={p.producto} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                    <td className="px-3 py-1.5 font-medium">{p.producto}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(p.palets)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(p.kg)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatNumber(p.pct, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
