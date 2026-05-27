/**
 * AnalisisDashboard.tsx — Dashboard visual del análisis diario Lasarte.
 *
 * Muestra TODOS los campos capturados por los parsers, en el orden exacto pedido:
 *
 * PRODUCCIÓN:  ID Lote · Nombre Lote · Cód. Productor · Nombre Productor ·
 *              Variedad · Tiempo Inicio · Hora Máquina · Peso(kg) · T/h · Peso Fruta(g)
 * PRODUCTO:    Producto · Empaque · Empaques · Peso(kg) · Fruta
 * CALIBRES:    Variedad · Clase · Grupo · Peso(kg) · Tamaños
 *              + agrupación Tipo (Export/Mujeres/No export/No comercial)
 * PALETS:      Producto · Fecha · Cliente · Kg Netos
 *
 * Incluye vista "Reporte Ejecutivo" con formato Markdown exportable.
 */
import { Suspense, lazy, useState } from "react";
import { type AnalisisDia, type Alerta } from "@/lib/analisis";
import { formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ReporteOperativo } from "@/components/ReporteOperativo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
const BarChart = lazy(() => import("recharts").then(m => ({ default: m.BarChart })));
const Bar = lazy(() => import("recharts").then(m => ({ default: m.Bar })));
const XAxis = lazy(() => import("recharts").then(m => ({ default: m.XAxis })));
const YAxis = lazy(() => import("recharts").then(m => ({ default: m.YAxis })));
const CartesianGrid = lazy(() => import("recharts").then(m => ({ default: m.CartesianGrid })));
const Tooltip = lazy(() => import("recharts").then(m => ({ default: m.Tooltip })));
const Legend = lazy(() => import("recharts").then(m => ({ default: m.Legend })));
const ResponsiveContainer = lazy(() => import("recharts").then(m => ({ default: m.ResponsiveContainer })));
const PieChart = lazy(() => import("recharts").then(m => ({ default: m.PieChart })));
const Pie = lazy(() => import("recharts").then(m => ({ default: m.Pie })));
const Cell = lazy(() => import("recharts").then(m => ({ default: m.Cell })));
import { AlertTriangle, Info, XCircle, Globe, Gauge, Package, Warehouse, TrendingUp, Users, BarChart3, FileText } from "lucide-react";
import {
  GlassTooltip, C, DEST_COLORS, GRID, XAXIS, YAXIS, MARGIN,
  BAR_STYLE, BAR_STYLE_STACKED, CHART_CURSOR, CHART_LINE_CURSOR,
  CHART_PANEL_CLASS, PIE_STYLE, tphColor, barFill,
} from "@/lib/chartTheme";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// ─── Alerta badge ─────────────────────────────────────────────────────────────
function AlertaBadge({ alerta }: { alerta: Alerta }) {
  const styles = {
    danger:  { wrap: "bg-destructive/10 border-destructive/30 text-destructive", icon: <XCircle className="h-3.5 w-3.5 shrink-0" /> },
    warning: { wrap: "bg-warning/10 border-warning/30 text-warning", icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> },
    info:    { wrap: "bg-[var(--glass-bg)] border-[var(--glass-border)] text-muted-foreground", icon: <Info className="h-3.5 w-3.5 shrink-0" /> },
  }[alerta.severidad];
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs backdrop-blur-sm", styles.wrap)}>
      {styles.icon}
      <div><span className="font-semibold">{alerta.titulo}</span>{" — "}<span className="opacity-80">{alerta.detalle}</span></div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, accentClass }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; accentClass?: string;
}) {
  return (
    <Card className={cn("border-l-4", accentClass ?? "border-l-primary")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums truncate">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tooltip de gráficos (glass) ──────────────────────────────────────────────
function CalibreTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
  const items = payload.map((p: any) => ({ name: p.name, value: formatKg(p.value), color: p.fill }));
  items.push({ name: "Total", value: formatKg(total), color: "#888" });
  return <GlassTooltip active label={label} payload={items} />;
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const items = [{ name: d.name, value: formatKg(d.value), color: d.payload.color }];
  return <GlassTooltip active payload={items} />;
}

// ─── Sección colapsable ───────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2">{children}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ─── Columnas diagnóstico ─────────────────────────────────────────────────────
function ColDiag({ cols }: { cols?: string[] }) {
  if (!cols || cols.length === 0) return null;
  return (
    <p className="text-[10px] text-muted-foreground mt-1">
      <span className="font-medium">Columnas detectadas:</span>{" "}
      {cols.filter(c => !c.startsWith("_")).join(" · ")}
    </p>
  );
}


// ─── Componente principal ─────────────────────────────────────────────────────
interface Props { analisis: AnalisisDia; fechaParte?: string; }

type Vista = "dashboard" | "reporte";

export function AnalisisDashboard({ analisis, fechaParte }: Props) {
  const [vista, setVista] = useState<Vista>("dashboard");
  const { kpis, alertas, calibres, clientes, top_productos, productores,
          serie_calibres, serie_destinos, serie_tph_por_lote } = analisis;

  const dangerCount  = alertas.filter(a => a.severidad === "danger").length;
  const warningCount = alertas.filter(a => a.severidad === "warning").length;

  return (
    <div className="space-y-8">

      {/* ── Selector de vista ─────────────────────────────────────────── */}
      <div className="flex w-fit items-center gap-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1 shadow-[var(--glass-shadow)] backdrop-blur-sm">
        <button
          onClick={() => setVista("dashboard")}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
            vista === "dashboard"
              ? "border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)]"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Dashboard Visual
        </button>
        <button
          onClick={() => setVista("reporte")}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
            vista === "reporte"
              ? "border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] text-foreground shadow-[var(--glass-shadow)]"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          Reporte Ejecutivo
        </button>
      </div>

      {/* ── Vista Reporte Ejecutivo ───────────────────────────────────── */}
      {vista === "reporte" && (
        <ReporteOperativo analisis={analisis} fechaParte={fechaParte} />
      )}

      {/* ── Vista Dashboard ───────────────────────────────────────────── */}
      {vista === "dashboard" && (
        <Suspense fallback={<div className="flex items-center justify-center py-16"><p className="text-sm text-muted-foreground">Cargando gráficos…</p></div>}>

      {/* ── Alertas ───────────────────────────────────────────────────── */}
      {alertas.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Alertas del día</h3>
            {dangerCount > 0  && <Badge variant="destructive">{dangerCount} críticas</Badge>}
            {warningCount > 0 && <Badge className="bg-warning/15 text-warning border-warning/30 border">{warningCount} avisos</Badge>}
          </div>
          <div className="space-y-1.5">{alertas.map(a => <AlertaBadge key={a.id} alerta={a} />)}</div>
        </section>
      )}

      {/* ── KPI cards ─────────────────────────────────────────────────── */}
      <section className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Producción calibrador" value={formatKg(kpis.kg_calibrador)}
          sub={`${kpis.n_lotes} lotes · ${kpis.n_productores} productores`} icon={TrendingUp} accentClass="border-l-primary" />
        <KpiCard label="% Exportación" value={`${kpis.pct_exportacion}%`} sub={formatKg(kpis.kg_exportacion)}
          icon={Globe} accentClass={kpis.pct_exportacion >= 60 ? "border-l-success" : "border-l-warning"} />
        <KpiCard label="Eficiencia T/h" value={kpis.tph_promedio ? `${kpis.tph_promedio} T/h` : "—"}
          sub={kpis.tph_min && kpis.tph_max ? `min ${kpis.tph_min} · max ${kpis.tph_max}` : undefined}
          icon={Gauge} accentClass={kpis.tph_promedio ? kpis.tph_promedio >= 16 ? "border-l-success" : kpis.tph_promedio >= 12 ? "border-l-warning" : "border-l-destructive" : "border-l-muted"} />
        <KpiCard label="Top calibre / variedad" value={kpis.top_calibre ?? "—"}
          sub={kpis.top_calibre ? `${kpis.top_calibre_pct}% del total` : undefined} icon={BarChart3} accentClass="border-l-info" />
        <KpiCard label="Stock en cámara" value={formatKg(kpis.kg_camara)} sub={`${kpis.n_palets} palets`}
          icon={Warehouse} accentClass="border-l-warning" />
      </section>

      {/* ── Gráficos destino ──────────────────────────────────────────── */}
      {(serie_calibres.length > 0 || serie_destinos.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-3">
          {serie_calibres.length > 0 && (
            <Card className="xl:col-span-2 glass-accented">
              <CardHeader className="pb-3 px-5 pt-4">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-1 rounded-full bg-primary" />
                  <div>
                    <CardTitle className="text-lg font-semibold">Calibres / Variedades por destino</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">kg apilados por tipo de destino</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-1">
                <div className={CHART_PANEL_CLASS}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={serie_calibres} margin={{ top: 4, right: 8, left: 0, bottom: 36 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="name" {...XAXIS} fontSize={9} angle={-35} textAnchor="end" interval={0} />
                    <YAxis {...YAXIS} tickFormatter={v => `${(v/1000).toFixed(0)}t`} width={32} />
                    <Tooltip cursor={CHART_CURSOR} content={<CalibreTooltip />} />
                    <Legend wrapperStyle={legendStyle} />
                    <Bar dataKey="export"    name="Exportación" stackId="a" fill={barFill(DEST_COLORS.exportacion, 0.28)} stroke={DEST_COLORS.exportacion} {...BAR_STYLE_STACKED} />
                    <Bar dataKey="mercado"   name="Mercado"     stackId="a" fill={barFill(DEST_COLORS.mercado,     0.28)} stroke={DEST_COLORS.mercado} {...BAR_STYLE_STACKED} />
                    <Bar dataKey="industria" name="Industria"   stackId="a" fill={barFill(DEST_COLORS.industria,   0.28)} stroke={DEST_COLORS.industria} {...BAR_STYLE_STACKED} />
                  </BarChart>
                </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
          {serie_destinos.length > 0 && (
            <Card className="glass-accented">
              <CardHeader className="pb-3 px-5 pt-4">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-1 rounded-full bg-primary" />
                  <div>
                    <CardTitle className="text-lg font-semibold">Destino de la fruta</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">distribución en kg</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-1 flex flex-col items-center gap-3">
                <div className={CHART_PANEL_CLASS + " w-full"}>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={serie_destinos} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={78} {...PIE_STYLE}>
                        {serie_destinos.map((d) => <Cell key={d.name} fill={barFill(d.color, 0.35)} stroke={d.color} strokeWidth={2} />)}
                      </Pie>
                      <Tooltip cursor={CHART_LINE_CURSOR} content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full space-y-1.5">
                  {serie_destinos.map(d => {
                    const total = serie_destinos.reduce((s, x) => s + x.value, 0);
                    const pct = total > 0 ? (d.value / total * 100).toFixed(1) : "0";
                    return (
                      <div key={d.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
                          <span className="text-muted-foreground">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className="text-muted-foreground">{pct}%</span>
                          <span className="font-medium">{formatKg(d.value)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── T/h por lote ──────────────────────────────────────────────── */}
      {serie_tph_por_lote.length > 1 && (
        <Card className="glass-accented">
          <CardHeader className="pb-3 px-5 pt-4">
            <div className="flex items-center gap-3">
              <div className="h-7 w-1 rounded-full bg-primary" />
              <div>
                <CardTitle className="text-lg font-semibold">T/h por lote</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Velocidad de procesamiento por lote del día</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-1">
            <div className={CHART_PANEL_CLASS}>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={serie_tph_por_lote} {...MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="lote" {...XAXIS} fontSize={9} />
                <YAxis {...YAXIS} tickFormatter={v => `${v}T`} width={30} domain={["auto", "auto"]} />
                <Tooltip cursor={CHART_CURSOR} content={(props: any) => {
                  if (!props.active || !props.payload?.length) return null;
                  const d = props.payload[0].payload;
                  const c = tphColor(d.tph);
                  const items = [
                    { name: "Productor", value: d.productor, color: c },
                    { name: "T/h", value: `${d.tph} T/h`, color: c },
                  ];
                  return <GlassTooltip active label={d.lote} payload={items} />;
                }} />
                <Bar dataKey="tph" name="T/h" {...BAR_STYLE}>
                  {serie_tph_por_lote.map((e) => (
                    <Cell key={e.lote} fill={barFill(tphColor(e.tph), 0.25)} stroke={tphColor(e.tph)} strokeWidth={1.5} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* TABLAS DETALLADAS CON TODOS LOS CAMPOS                            */}
      {/* ────────────────────────────────────────────────────────────────── */}

      {/* PRODUCCIÓN: todos los campos de lote */}
      {analisis._raw_produccion && analisis._raw_produccion.lotes?.length > 0 && (
        <section>
          <SectionTitle>Producción — Lotes</SectionTitle>
          <RawProduccionTable lotes={analisis._raw_produccion.lotes} columnas={analisis._raw_produccion._columnas_detectadas} />
        </section>
      )}

      {/* PRODUCTO: Producto · Empaque · Empaques · Peso(kg) · Fruta */}
      {analisis._raw_producto && analisis._raw_producto.lineas?.length > 0 && (
        <section>
          <SectionTitle>Producto Empacado</SectionTitle>
          <RawProductoTable lineas={analisis._raw_producto.lineas} columnas={analisis._raw_producto._columnas_detectadas} />
        </section>
      )}

      {/* CALIBRES/TAMAÑOS: Variedad · Clase · Grupo · Peso(kg) · Tamaños */}
      {analisis._raw_calibres && analisis._raw_calibres.calibres?.length > 0 && (
        <section className="space-y-4">
          <SectionTitle>Tamaños, Clase y Calidad por Variedad</SectionTitle>
          <RawCalibresTable calibres={analisis._raw_calibres.calibres} columnas={analisis._raw_calibres._columnas_detectadas} />
          {analisis._raw_calibres.tipos_clasificacion?.length > 0 && (
            <>
              <SectionTitle>Clasificación por Tipo</SectionTitle>
              <TiposClasificacionTable tipos={analisis._raw_calibres.tipos_clasificacion} />
            </>
          )}
        </section>
      )}

      {/* PALETS: Producto · Fecha · Cliente · Kg Netos */}
      {analisis._raw_palets && analisis._raw_palets.palets?.length > 0 && (
        <section>
          <SectionTitle>Palets</SectionTitle>
          <RawPaletsTable palets={analisis._raw_palets.palets} columnas={analisis._raw_palets._columnas_detectadas} />
        </section>
      )}

      {/* PRODUCTORES */}
      {productores.length > 0 && (
        <section>
          <SectionTitle>Productores</SectionTitle>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Productor</TableHead>
                    <TableHead className="text-right">Kg</TableHead>
                    <TableHead className="text-right">Lotes</TableHead>
                    <TableHead className="text-right">T/h medio</TableHead>
                    <TableHead className="text-right">Peso fruta avg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productores.map((p) => (
                    <TableRow key={p.productor}>
                      <TableCell className="text-xs font-medium">{p.productor}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{formatKg(p.kg_total)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{p.n_lotes}</TableCell>
                      <TableCell className="text-right text-xs">
                        {p.tph_avg ? (
                          <span className={cn("tabular-nums font-semibold",
                            p.tph_avg >= 16 ? "text-success" : p.tph_avg >= 12 ? "text-warning" : "text-destructive"
                          )}>{p.tph_avg.toFixed(1)} T/h</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {p.peso_fruta_avg_g ? `${p.peso_fruta_avg_g.toFixed(0)} g` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}

      <p className="text-[10px] text-muted-foreground text-right">
        Análisis generado · {new Date(analisis.fecha_analisis).toLocaleString("es-ES")}
      </p>

        </Suspense>
      )}
    </div>
  );
}


// ─── Tabla Producción ─────────────────────────────────────────────────────────
// Orden: ID Lote · Nombre Lote · Cód. Productor · Nombre Productor ·
//        Variedad · Tiempo Inicio · Hora Máquina · Peso(kg) · T/h · Peso Fruta(g)

import type { LoteProduccion, ProductoEmpacado, CalibreRow, PaletRow, TipoClasificacion } from "@/lib/parsers";

function RawProduccionTable({ lotes, columnas }: { lotes: LoteProduccion[]; columnas?: string[] }) {
  const na = (v: any) => v ?? <span className="text-muted-foreground text-[10px]">—</span>;
  return (
    <Card>
      <CardContent className="p-0">
        <ColDiag cols={columnas} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">ID Lote</TableHead>
                <TableHead className="whitespace-nowrap">Nombre Lote</TableHead>
                <TableHead className="whitespace-nowrap">Cód. Productor</TableHead>
                <TableHead className="whitespace-nowrap">Nombre Productor</TableHead>
                <TableHead className="whitespace-nowrap">Variedad</TableHead>
                <TableHead className="whitespace-nowrap">Tiempo Inicio</TableHead>
                <TableHead className="whitespace-nowrap">Hora Máquina</TableHead>
                <TableHead className="whitespace-nowrap text-right">Peso (kg)</TableHead>
                <TableHead className="whitespace-nowrap text-right">T/h</TableHead>
                <TableHead className="whitespace-nowrap text-right">Peso Fruta (g)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lotes.map((l) => (
                <TableRow key={l.id_lote}>
                  <TableCell className="text-xs font-mono">{na(l.id_lote)}</TableCell>
                  <TableCell className="text-xs">{na(l.nombre_lote)}</TableCell>
                  <TableCell className="text-xs font-mono">{na(l.codigo_productor)}</TableCell>
                  <TableCell className="text-xs font-medium">{na(l.nombre_productor)}</TableCell>
                  <TableCell className="text-xs">{na(l.variedad)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{na(l.tiempo_inicio)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{na(l.hora_maquina)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs font-semibold">{formatKg(l.kg_peso_total)}</TableCell>
                  <TableCell className="text-right text-xs">
                    {l.toneladas_hora !== null
                      ? <span className={cn("tabular-nums font-medium",
                          l.toneladas_hora >= 16 ? "text-success" : l.toneladas_hora >= 12 ? "text-warning" : "text-destructive"
                        )}>{l.toneladas_hora.toFixed(2)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {l.peso_fruta_promedio_g !== null ? `${l.peso_fruta_promedio_g.toFixed(0)} g` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tabla Producto ───────────────────────────────────────────────────────────
// Orden: Producto · Empaque · Empaques · Peso(kg) · Fruta

function RawProductoTable({ lineas, columnas }: { lineas: ProductoEmpacado[]; columnas?: string[] }) {
  const na = (v: any) => v ?? <span className="text-muted-foreground text-[10px]">—</span>;
  return (
    <Card>
      <CardContent className="p-0">
        <ColDiag cols={columnas} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Empaque</TableHead>
                <TableHead className="text-right">Empaques</TableHead>
                <TableHead className="text-right">Peso (kg)</TableHead>
                <TableHead>Fruta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineas.map((l) => (
                <TableRow key={`${l.producto}-${l.empaque}`}>
                  <TableCell className="text-xs font-medium max-w-[200px] truncate" title={l.producto ?? ""}>{na(l.producto)}</TableCell>
                  <TableCell className="text-xs">{na(l.empaque)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {l.empaques !== null ? formatNumber(l.empaques) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs font-semibold">{formatKg(l.kg)}</TableCell>
                  <TableCell className="text-xs">{na(l.fruta)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tabla Calibres / Tamaños ─────────────────────────────────────────────────
// Orden: Variedad · Clase · Grupo · Peso(kg) · Tamaños

function RawCalibresTable({ calibres, columnas }: { calibres: CalibreRow[]; columnas?: string[] }) {
  const na = (v: any) => v ?? <span className="text-muted-foreground text-[10px]">—</span>;
  return (
    <Card>
      <CardContent className="p-0">
        <ColDiag cols={columnas} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variedad</TableHead>
                <TableHead>Clase</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead className="text-right">Peso (kg)</TableHead>
                <TableHead>Tamaños</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calibres.map((c) => (
                <TableRow key={`${c.variedad}-${c.clase}-${c.grupo}`}>
                  <TableCell className="text-xs font-medium">{na(c.variedad)}</TableCell>
                  <TableCell className="text-xs">{na(c.clase)}</TableCell>
                  <TableCell className="text-xs">
                    {c.grupo ? <GrupoBadge grupo={c.grupo} /> : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs font-semibold">{c.kg > 0 ? formatKg(c.kg) : "—"}</TableCell>
                  <TableCell className="text-xs">{na(c.tamanos)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tabla Tipos de Clasificación ────────────────────────────────────────────
// Tipo · Peso(kg) · Tamaños

function TiposClasificacionTable({ tipos }: { tipos: TipoClasificacion[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Peso (kg)</TableHead>
              <TableHead>Tamaños</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tipos.map((t) => (
              <TableRow key={t.tipo}>
                <TableCell className="text-xs font-medium">
                  <GrupoBadge grupo={t.tipo} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs font-semibold">{t.kg > 0 ? formatKg(t.kg) : "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate" title={t.tamanos.join(", ")}>
                  {t.tamanos.length > 0 ? t.tamanos.join(", ") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Tabla Palets ─────────────────────────────────────────────────────────────
// Orden: Producto · Fecha · Cliente · Kg Netos

function RawPaletsTable({ palets, columnas }: { palets: PaletRow[]; columnas?: string[] }) {
  const na = (v: any) => v ?? <span className="text-muted-foreground text-[10px]">—</span>;
  return (
    <Card>
      <CardContent className="p-0">
        <ColDiag cols={columnas} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Kg Netos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {palets.map((p) => (
                <TableRow key={`${p.producto}-${p.fecha}-${p.cliente}`}>
                  <TableCell className="text-xs font-medium max-w-[200px] truncate" title={p.producto ?? ""}>{na(p.producto)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{na(p.fecha)}</TableCell>
                  <TableCell className="text-xs">{na(p.cliente)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs font-semibold">{formatKg(p.kg_neto)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helper badge grupo destino ───────────────────────────────────────────────
function GrupoBadge({ grupo }: { grupo: string }) {
  const s = grupo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes("export"))
    return <span className="text-[10px] font-medium text-success bg-success/10 px-1.5 py-0.5 rounded">{grupo}</span>;
  if (s.includes("mujer"))
    return <span className="text-[10px] font-medium text-info bg-info/10 px-1.5 py-0.5 rounded">{grupo}</span>;
  if (s.includes("no_export") || s.includes("no export"))
    return <span className="text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded">{grupo}</span>;
  if (s.includes("ind") || s.includes("no_comerc") || s.includes("no comerc"))
    return <span className="text-[10px] font-medium text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">{grupo}</span>;
  if (s.includes("mercado") || s.includes("nac"))
    return <span className="text-[10px] font-medium text-info bg-info/10 px-1.5 py-0.5 rounded">{grupo}</span>;
  return <span className="text-[10px] text-muted-foreground">{grupo}</span>;
}
