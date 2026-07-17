// src/pages/Edeka.tsx
// Sección "Edeka" para el rol de ventas: resumen de lo enviado al cliente
// EDEKA EINKAUFSKONTOR GMBH, sacado de los palets de los partes diarios.
// A diferencia de Mercadona, aquí NO hay Excel de ventas: todo el dato sale
// de palets_dia (ver useEdeka). El volumen es todavía muy bajo (unas pocas
// decenas de palets en toda la base), así que la página se diseña para verse
// digna con pocos datos — sin gráficos vacíos gigantes, tablas compactas — y
// escalar con naturalidad si el volumen crece.
import { AlertTriangle, Boxes, CalendarClock, Package, Scale, Ship } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KPICard } from "@/components/KPICard";
import { useEdeka } from "@/hooks/useEdeka";
import { formatDate, formatKg, formatNumber } from "@/lib/format";
import { BAR_STYLE, C, CHART_PANEL_CLASS, GlassTooltip, GRID, MARGIN, XAXIS, YAXIS } from "@/lib/chartTheme";

const AVISO_COBERTURA =
  "Datos de los palets registrados en los partes diarios; puede no reflejar todos los envíos a Edeka.";

// Umbral a partir del cual la serie semanal se muestra como gráfico de barras
// en vez de tabla compacta: con pocos puntos un gráfico solo aporta ruido.
const MIN_SEMANAS_PARA_GRAFICO = 4;

export default function Edeka() {
  const edeka = useEdeka();

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />Comercial</p>
            <Badge variant={edeka.n_palets > 0 ? "outline" : "destructive"} className="rounded-md px-2 py-0 text-xs">
              {edeka.isLoading ? "…" : edeka.n_palets > 0 ? `${formatNumber(edeka.n_palets)} envío(s)` : "Sin datos"}
            </Badge>
          </div>
          <h1 className="page-title">Edeka</h1>
          <p className="page-subtitle">Resumen de lo enviado al cliente EDEKA a partir de los palets de los partes diarios.</p>
        </div>
      </header>

      <AvisoCobertura />

      {edeka.isLoading ? (
        <Card className="glass-accented">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Cargando…</CardContent>
        </Card>
      ) : edeka.n_palets === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Kpis edeka={edeka} />
          <ProductosTable edeka={edeka} />
          <SerieSemanal edeka={edeka} />
          <EnviosTable edeka={edeka} />
        </>
      )}
    </div>
  );
}

// ─── Sub-secciones ───────────────────────────────────────────────────────────

function AvisoCobertura() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-sm text-warning">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="leading-relaxed">{AVISO_COBERTURA}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="glass-accented">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <Ship className="h-10 w-10 text-muted-foreground/50" />
        <div>
          <h2 className="text-lg font-semibold">Todavía no hay palets registrados para Edeka</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            En cuanto se apunten palets con cliente EDEKA en algún parte diario, aparecerán aquí.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpis({ edeka }: { edeka: ReturnType<typeof useEdeka> }) {
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <KPICard
        className="glass-accented"
        label="Kg totales"
        value={formatKg(edeka.kg_total)}
        hint={`${formatKg(edeka.kg_por_palet, 1)}/palet de media`}
        icon={Scale}
      />
      <KPICard
        className="glass-accented"
        label="Palets"
        value={formatNumber(edeka.n_palets)}
        icon={Boxes}
      />
      <KPICard
        className="glass-accented"
        label="Cajas"
        value={formatNumber(edeka.n_cajas)}
        icon={Package}
      />
      <KPICard
        className="glass-accented"
        label="Último envío"
        value={edeka.ultimo_envio ? formatDate(edeka.ultimo_envio) : "—"}
        hint={edeka.primer_envio ? `Desde ${formatDate(edeka.primer_envio)}` : undefined}
        icon={CalendarClock}
      />
    </section>
  );
}

function ProductosTable({ edeka }: { edeka: ReturnType<typeof useEdeka> }) {
  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Por producto</CardTitle>
        <p className="text-xs text-muted-foreground">Palets a Edeka agrupados por producto, todo el histórico.</p>
      </CardHeader>
      <CardContent className="p-0">
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
              {edeka.por_producto.map((p, i) => (
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
      </CardContent>
    </Card>
  );
}

function SerieSemanal({ edeka }: { edeka: ReturnType<typeof useEdeka> }) {
  const semanas = edeka.por_semana;
  const comoGrafico = semanas.length >= MIN_SEMANAS_PARA_GRAFICO;

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Evolución semanal</CardTitle>
        <p className="text-xs text-muted-foreground">Kg y palets enviados a Edeka por semana (lunes a domingo).</p>
      </CardHeader>
      <CardContent className={comoGrafico ? undefined : "p-0"}>
        {semanas.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin envíos registrados.</p>
        ) : comoGrafico ? (
          <div className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={semanas.map((s) => ({ ...s, label: `S${s.semana} · ${s.anio}` }))}
                margin={MARGIN}
              >
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" {...XAXIS} />
                <YAxis {...YAXIS} />
                <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
                <Bar dataKey="kg" name="Kg enviados" fill={C.info} stroke={C.info} {...BAR_STYLE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                <tr>
                  <th className="text-left">Semana</th>
                  <th className="text-left">Inicio</th>
                  <th className="text-right">Palets</th>
                  <th className="text-right">Kg</th>
                </tr>
              </thead>
              <tbody>
                {semanas.map((s, i) => (
                  <tr key={`${s.anio}-${s.semana}`} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                    <td className="px-3 py-1.5 font-semibold">S{s.semana} · {s.anio}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{formatDate(s.inicio)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(s.palets)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(s.kg)}</td>
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

function EnviosTable({ edeka }: { edeka: ReturnType<typeof useEdeka> }) {
  const hayDestinoOSituacion = edeka.envios.some((e) => e.destino || e.situacion);

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Envíos individuales</CardTitle>
        <p className="text-xs text-muted-foreground">Cada palet registrado para Edeka, del más reciente al más antiguo.</p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
              <tr>
                <th className="text-left">Fecha</th>
                <th className="text-left">Producto</th>
                <th className="text-right">Kg</th>
                <th className="text-right">Cajas</th>
                {hayDestinoOSituacion ? <th className="text-left">Destino / situación</th> : null}
              </tr>
            </thead>
            <tbody>
              {edeka.envios.map((e, i) => (
                <tr key={`${e.date}-${e.palet_id ?? i}`} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                  <td className="px-3 py-1.5 text-muted-foreground">{formatDate(e.date)}</td>
                  <td className="px-3 py-1.5 font-medium">{e.producto}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(e.kg)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(e.cajas)}</td>
                  {hayDestinoOSituacion ? (
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {[e.destino, e.situacion].filter(Boolean).join(" · ") || "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
