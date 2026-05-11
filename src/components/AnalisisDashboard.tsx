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
 */
import { type AnalisisDia, type Alerta } from "@/lib/analisis";
import { formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { AlertTriangle, Info, XCircle, Globe, Gauge, Package, Warehouse, TrendingUp, Users, BarChart3 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// ─── Alerta badge ─────────────────────────────────────────────────────────────
function AlertaBadge({ alerta }: { alerta: Alerta }) {
  const styles = {
    danger:  { wrap: "bg-destructive/10 border-destructive/30 text-destructive", icon: <XCircle className="h-3.5 w-3.5 shrink-0" /> },
    warning: { wrap: "bg-warning/10 border-warning/30 text-warning", icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> },
    info:    { wrap: "bg-muted border-border text-muted-foreground", icon: <Info className="h-3.5 w-3.5 shrink-0" /> },
  }[alerta.severidad];
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs", styles.wrap)}>
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
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tooltip de gráficos ──────────────────────────────────────────────────────
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
interface Props { analisis: AnalisisDia; }

export function AnalisisDashboard({ analisis }: Props) {
  const { kpis, alertas, calibres, clientes, top_productos, productores,
          serie_calibres, serie_destinos, serie_tph_por_lote } = analisis;

  const dangerCount  = alertas.filter(a => a.severidad === "danger").length;
  const warningCount = alertas.filter(a => a.severidad === "warning").length;

  return (
    <div className="space-y-8">

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
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Calibres / Variedades por destino</CardTitle>
                <p className="text-xs text-muted-foreground">kg apilados por tipo de destino</p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={serie_calibres} margin={{ top: 4, right: 8, left: 0, bottom: 36 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${(v/1000).toFixed(0)}t`} width={32} />
                    <Tooltip content={<CalibreTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                    <Bar dataKey="export"   name="Exportación" stackId="a" fill="#22c55e" />
                    <Bar dataKey="mercado"  name="Mercado"     stackId="a" fill="#3b82f6" />
                    <Bar dataKey="industria" name="Industria"  stackId="a" fill="#f59e0b" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          {serie_destinos.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Destino de la fruta</CardTitle>
                <p className="text-xs text-muted-foreground">distribución en kg</p>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={serie_destinos} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={78} paddingAngle={2}>
                      {serie_destinos.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
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
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">T/h por lote</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={serie_tph_por_lote} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="lote" fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                <YAxis fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${v}T`} width={30} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: 11 }}
                  formatter={(v: number, _: string, props: any) => [`${v} T/h — ${props.payload.productor}`, "T/h"]} />
                <Bar dataKey="tph" name="T/h" fill="hsl(var(--primary))" radius={[3,3,0,0]}>
                  {serie_tph_por_lote.map((e, i) => (
                    <Cell key={i} fill={e.tph >= 16 ? "#22c55e" : e.tph >= 12 ? "#f59e0b" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* TABLAS DETALLADAS CON TODOS LOS CAMPOS                            */}
      {/* ────────────────────────────────────────────────────────────────── */}

      {/* PRODUCCIÓN: todos los campos de lote */}
      {(analisis as any)._raw_produccion && (analisis as any)._raw_produccion.lotes?.length > 0 && (
        <section>
          <SectionTitle>Producción — Lotes</SectionTitle>
          <RawProduccionTable lotes={(analisis as any)._raw_produccion.lotes} columnas={(analisis as any)._raw_produccion._columnas_detectadas} />
        </section>
      )}

      {/* PRODUCTO: Producto · Empaque · Empaques · Peso(kg) · Fruta */}
      {(analisis as any)._raw_producto && (analisis as any)._raw_producto.lineas?.length > 0 && (
        <section>
          <SectionTitle>Producto Empacado</SectionTitle>
          <RawProductoTable lineas={(analisis as any)._raw_producto.lineas} columnas={(analisis as any)._raw_producto._columnas_detectadas} />
        </section>
      )}

      {/* CALIBRES/TAMAÑOS: Variedad · Clase · Grupo · Peso(kg) · Tamaños */}
      {(analisis as any)._raw_calibres && (analisis as any)._raw_calibres.calibres?.length > 0 && (
        <section className="space-y-4">
          <SectionTitle>Tamaños, Clase y Calidad por Variedad</SectionTitle>
          <RawCalibresTable calibres={(analisis as any)._raw_calibres.calibres} columnas={(analisis as any)._raw_calibres._columnas_detectadas} />
          {(analisis as any)._raw_calibres.tipos_clasificacion?.length > 0 && (
            <>
              <SectionTitle>Clasificación por Tipo</SectionTitle>
              <TiposClasificacionTable tipos={(analisis as any)._raw_calibres.tipos_clasificacion} />
            </>
          )}
        </section>
      )}

      {/* PALETS: Producto · Fecha · Cliente · Kg Netos */}
      {(analisis as any)._raw_palets && (analisis as any)._raw_palets.palets?.length > 0 && (
        <section>
          <SectionTitle>Palets</SectionTitle>
          <RawPaletsTable palets={(analisis as any)._raw_palets.palets} columnas={(analisis as any)._raw_palets._columnas_detectadas} />
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
                  {productores.map((p, i) => (
                    <TableRow key={i}>
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
              {lotes.map((l, i) => (
                <TableRow key={i}>
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
              {lineas.map((l, i) => (
                <TableRow key={i}>
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
              {calibres.map((c, i) => (
                <TableRow key={i}>
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
            {tipos.map((t, i) => (
              <TableRow key={i}>
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
              {palets.map((p, i) => (
                <TableRow key={i}>
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
    return <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{grupo}</span>;
  return <span className="text-[10px] text-muted-foreground">{grupo}</span>;
}
