/**
 * AnalisisDashboard.tsx
 *
 * Dashboard visual completo del análisis diario:
 *   - Fila de alertas (danger / warning / info)
 *   - 5 KPI cards: Producción · Export% · T/h · Top calibre · Palets en cámara
 *   - Gráfico de barras apiladas: distribución de calibres por destino (top 12)
 *   - Gráfico pie: destino de la fruta (export / mercado / industria / rechazo)
 *   - Tabla top 10 productos empacados
 *   - Tabla de clientes (palets + kg)
 *   - Tabla de productores con T/h
 */
import { type AnalisisDia, type Alerta } from "@/lib/analisis";
import { formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  AlertTriangle, Info, XCircle, Globe, Gauge, Package,
  Warehouse, TrendingUp, Users, BarChart3,
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// ─── Alerta badge ─────────────────────────────────────────────────────────────

function AlertaBadge({ alerta }: { alerta: Alerta }) {
  const styles = {
    danger:  { wrap: "bg-destructive/10 border-destructive/30 text-destructive", icon: <XCircle className="h-3.5 w-3.5 shrink-0" /> },
    warning: { wrap: "bg-warning/10 border-warning/30 text-warning",             icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> },
    info:    { wrap: "bg-muted border-border text-muted-foreground",              icon: <Info className="h-3.5 w-3.5 shrink-0" /> },
  }[alerta.severidad];

  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs", styles.wrap)}>
      {styles.icon}
      <div>
        <span className="font-semibold">{alerta.titulo}</span>
        {" — "}
        <span className="opacity-80">{alerta.detalle}</span>
      </div>
    </div>
  );
}

// ─── KPI card mini ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, accentClass,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accentClass?: string;
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
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tooltip personalizado para barras de calibres ───────────────────────────

function CalibreTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-lg border bg-card shadow-lg p-3 text-xs space-y-1 min-w-[150px]">
      <p className="font-semibold border-b pb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-3">
          <span style={{ color: p.fill }} className="font-medium">{p.name}</span>
          <span className="tabular-nums">{formatKg(p.value)}</span>
        </div>
      ))}
      <div className="flex justify-between border-t pt-1 font-semibold">
        <span>Total</span><span className="tabular-nums">{formatKg(total)}</span>
      </div>
    </div>
  );
}

// ─── Tooltip pie ──────────────────────────────────────────────────────────────

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="rounded-lg border bg-card shadow-lg p-2.5 text-xs">
      <span style={{ color: d.payload.color }} className="font-semibold">{d.name}: </span>
      <span className="tabular-nums">{formatKg(d.value)}</span>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  analisis: AnalisisDia;
}

export function AnalisisDashboard({ analisis }: Props) {
  const { kpis, alertas, calibres, clientes, top_productos, productores,
          serie_calibres, serie_destinos, serie_tph_por_lote } = analisis;

  const dangerCount  = alertas.filter((a) => a.severidad === "danger").length;
  const warningCount = alertas.filter((a) => a.severidad === "warning").length;

  return (
    <div className="space-y-6">

      {/* ── Alertas ──────────────────────────────────────────────────────── */}
      {alertas.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Alertas del día</h3>
            {dangerCount > 0  && <Badge variant="destructive">{dangerCount} críticas</Badge>}
            {warningCount > 0 && <Badge className="bg-warning/15 text-warning border-warning/30 border">{warningCount} avisos</Badge>}
          </div>
          <div className="space-y-1.5">
            {alertas.map((a) => <AlertaBadge key={a.id} alerta={a} />)}
          </div>
        </section>
      )}

      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      <section className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Producción calibrador"
          value={formatKg(kpis.kg_calibrador)}
          sub={`${kpis.n_lotes} lotes · ${kpis.n_productores} productores`}
          icon={TrendingUp}
          accentClass="border-l-primary"
        />
        <KpiCard
          label="% Exportación"
          value={`${kpis.pct_exportacion}%`}
          sub={formatKg(kpis.kg_exportacion)}
          icon={Globe}
          accentClass={kpis.pct_exportacion >= 60 ? "border-l-success" : "border-l-warning"}
        />
        <KpiCard
          label="Eficiencia T/h"
          value={kpis.tph_promedio ? `${kpis.tph_promedio} T/h` : "—"}
          sub={kpis.tph_min && kpis.tph_max ? `min ${kpis.tph_min} · max ${kpis.tph_max}` : undefined}
          icon={Gauge}
          accentClass={
            kpis.tph_promedio
              ? kpis.tph_promedio >= 16 ? "border-l-success"
              : kpis.tph_promedio >= 12 ? "border-l-warning"
              : "border-l-destructive"
              : "border-l-muted"
          }
        />
        <KpiCard
          label="Top calibre"
          value={kpis.top_calibre ?? "—"}
          sub={kpis.top_calibre ? `${kpis.top_calibre_pct}% del total` : undefined}
          icon={BarChart3}
          accentClass="border-l-info"
        />
        <KpiCard
          label="Stock en cámara"
          value={formatKg(kpis.kg_camara)}
          sub={`${kpis.n_palets} palets`}
          icon={Warehouse}
          accentClass="border-l-warning"
        />
      </section>

      {/* ── Gráficos ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-3">

        {/* Barras calibres */}
        {serie_calibres.length > 0 && (
          <Card className="xl:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Distribución calibres · destino</CardTitle>
              <p className="text-xs text-muted-foreground">kg por calibre (top 12) apilado por destino</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={serie_calibres} margin={{ top: 4, right: 8, left: 0, bottom: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="name"
                    fontSize={9}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                    angle={-40}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    fontSize={9}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}t`}
                    width={32}
                  />
                  <Tooltip content={<CalibreTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                  <Bar dataKey="export"   name="Exportación" stackId="a" fill="#22c55e" radius={[0,0,0,0]} />
                  <Bar dataKey="mercado"  name="Mercado"     stackId="a" fill="#3b82f6" />
                  <Bar dataKey="industria" name="Industria"  stackId="a" fill="#f59e0b" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Pie destinos */}
        {serie_destinos.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Destino de la fruta</CardTitle>
              <p className="text-xs text-muted-foreground">distribución total en kg</p>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie
                    data={serie_destinos}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {serie_destinos.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              {/* Leyenda manual */}
              <div className="w-full space-y-1.5">
                {serie_destinos.map((d) => {
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

      {/* ── T/h por lote (si hay variación) ─────────────────────────────── */}
      {serie_tph_por_lote.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">T/h por lote</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={serie_tph_por_lote} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="lote" fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                <YAxis fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `${v}T`} width={30} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: 11 }}
                  formatter={(v: number, _: string, props: any) => [`${v} T/h — ${props.payload.productor}`, "T/h"]}
                />
                <Bar dataKey="tph" name="T/h" fill="hsl(var(--primary))" radius={[3,3,0,0]}>
                  {serie_tph_por_lote.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.tph >= 16 ? "#22c55e" : entry.tph >= 12 ? "#f59e0b" : "#ef4444"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Tablas ───────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Top productos */}
        {top_productos.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                Top productos empacados
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Kg</TableHead>
                    <TableHead className="text-right">Empaques</TableHead>
                    <TableHead>Destino</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top_productos.slice(0, 8).map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium max-w-[160px] truncate" title={p.producto}>
                        {p.producto}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{formatKg(p.kg)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {p.n_empaques > 0 ? formatNumber(p.n_empaques) : "—"}
                      </TableCell>
                      <TableCell>
                        {p.grupo_destino && (
                          <GrupoBadge grupo={p.grupo_destino} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Top clientes por palets */}
        {clientes.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-muted-foreground" />
                Clientes — palets asignados
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Palets</TableHead>
                    <TableHead className="text-right">Kg neto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientes.slice(0, 8).map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium max-w-[160px] truncate" title={c.cliente}>
                        {c.cliente}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{c.n_palets}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{formatKg(c.kg_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Productores */}
      {productores.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Productores
            </CardTitle>
          </CardHeader>
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
                {productores.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{p.productor}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{formatKg(p.kg_total)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{p.n_lotes}</TableCell>
                    <TableCell className="text-right text-xs">
                      {p.tph_avg ? (
                        <span className={cn(
                          "tabular-nums font-semibold",
                          p.tph_avg >= 16 ? "text-success" : p.tph_avg >= 12 ? "text-warning" : "text-destructive"
                        )}>
                          {p.tph_avg.toFixed(1)} T/h
                        </span>
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
      )}

      {/* Footer timestamp */}
      <p className="text-[10px] text-muted-foreground text-right">
        Análisis generado · {new Date(analisis.fecha_analisis).toLocaleString("es-ES")}
      </p>
    </div>
  );
}

// ─── Helper badge grupo destino ───────────────────────────────────────────────

function GrupoBadge({ grupo }: { grupo: string }) {
  const s = grupo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes("export") || s.includes("ext"))
    return <span className="text-[10px] font-medium text-success bg-success/10 px-1.5 py-0.5 rounded">Export</span>;
  if (s.includes("mercado") || s.includes("nac") || s.includes("int"))
    return <span className="text-[10px] font-medium text-info bg-info/10 px-1.5 py-0.5 rounded">Mercado</span>;
  if (s.includes("ind"))
    return <span className="text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded">Industria</span>;
  return <span className="text-[10px] text-muted-foreground">{grupo}</span>;
}
