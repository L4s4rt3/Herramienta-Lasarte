// src/pages/Mercadona.tsx
// Seccion "Mercadona": concentra la informacion relevante del cliente principal —
// ventas semanales planificadas vs vendidas (Excel del dueño) + aprovechamiento
// MDNA sobre produccion (useMercadona) + cruce con productores/formatos top.
import { useMemo, useState } from "react";
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, Boxes, ChevronLeft, ChevronRight, Euro, Package, PackageCheck, ShoppingCart, TrendingUp, Trophy, Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KPICard } from "@/components/KPICard";
import { MercadonaImportar } from "@/components/mercadona/MercadonaImportar";
import { MercadonaExportar } from "@/components/mercadona/MercadonaExportar";
import { useMercadona } from "@/hooks/useMercadona";
import { useMercadonaVentas, useMercadonaTopProductores, type MercadonaSemanaConMetodos } from "@/hooks/useMercadonaVentas";
import { formatMercadonaWeekRangeLabel, mercadonaWeekDateRange } from "@/lib/mercadonaVentas";
import { formatKg, formatNumber, formatPct } from "@/lib/format";
import { BAR_STYLE, C, CHART_PANEL_CLASS, GlassTooltip, GRID, lineStyle, MARGIN, XAXIS, YAXIS } from "@/lib/chartTheme";
import { cn } from "@/lib/utils";

type TopTab = "resumen" | "va-bien" | "importar" | "exportar";

export default function Mercadona() {
  const ventas = useMercadonaVentas();
  const [tab, setTab] = useState<TopTab>("resumen");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const semanas = ventas.semanas;
  const activeIndex = useMemo(() => {
    if (semanas.length === 0) return -1;
    if (!selectedId) return semanas.length - 1;
    const idx = semanas.findIndex((s) => s.id === selectedId);
    return idx === -1 ? semanas.length - 1 : idx;
  }, [semanas, selectedId]);

  const activeSemana = activeIndex >= 0 ? semanas[activeIndex] : null;

  const navigateWeek = (direction: -1 | 1) => {
    if (activeIndex === -1) return;
    const nextIndex = activeIndex + direction;
    if (nextIndex < 0 || nextIndex >= semanas.length) return;
    setSelectedId(semanas[nextIndex].id);
  };

  // La semana de Mercadona va de LUNES A SABADO (6 dias, sin domingo): todo cruce
  // con datos internos (aprovechamiento MDNA, mejores dias, top productores) debe
  // usar este rango, no la semana ISO completa (que incluiria el domingo).
  const rango = activeSemana ? mercadonaWeekDateRange(activeSemana.anio, activeSemana.semana) : null;
  const rangoLabel = activeSemana ? formatMercadonaWeekRangeLabel(activeSemana.anio, activeSemana.semana) : null;
  const mercadona = useMercadona(rango?.desde ?? "1970-01-01", rango?.hasta ?? "1970-01-01");
  const topProductores = useMercadonaTopProductores(rango?.desde ?? "1970-01-01", rango?.hasta ?? "1970-01-01");

  if (ventas.tablesMissing) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker">Comercial</p>
            <h1 className="page-title">Mercadona</h1>
            <p className="page-subtitle">Aprovechamiento, ventas semanales y planificación del cliente principal.</p>
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
      <Tabs value={tab} onValueChange={(v) => setTab(v as TopTab)} className="space-y-4">
        <header className="page-header">
          <div>
            <div className="flex items-center gap-2">
              <p className="panel-kicker">Comercial</p>
              <Badge variant={semanas.length > 0 ? "outline" : "destructive"} className="rounded-md px-2 py-0 text-xs">
                {semanas.length > 0 ? `${semanas.length} semana(s)` : "Sin datos"}
              </Badge>
            </div>
            <h1 className="page-title">Mercadona</h1>
            <p className="page-subtitle">Aprovechamiento, ventas semanales y planificación del cliente principal.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-md px-3 text-xs" onClick={() => setTab("importar")}>
              <Upload className="h-3.5 w-3.5" /> Importar Excel
            </Button>
          </div>
        </header>

        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="va-bien">Qué le va bien</TabsTrigger>
          <TabsTrigger value="importar">Importar</TabsTrigger>
          <TabsTrigger value="exportar">Exportar</TabsTrigger>
        </TabsList>

        {/* ─── Resumen ─────────────────────────────────────────────── */}
        <TabsContent value="resumen" className="space-y-4">
          {semanas.length === 0 ? (
            <EmptyState onImport={() => setTab("importar")} />
          ) : (
            <>
              <WeekNav
                semana={activeSemana}
                rangoLabel={rangoLabel}
                onPrev={() => navigateWeek(-1)}
                onNext={() => navigateWeek(1)}
                canPrev={activeIndex > 0}
                canNext={activeIndex < semanas.length - 1 && activeIndex !== -1}
              />

              {activeSemana ? <ResumenSemana semana={activeSemana} mercadona={mercadona} /> : null}

              <EvolucionSemanal semanas={semanas} />
            </>
          )}
        </TabsContent>

        {/* ─── Qué le va bien a Mercadona ─────────────────────────── */}
        <TabsContent value="va-bien" className="space-y-4">
          {semanas.length === 0 || !activeSemana ? (
            <EmptyState onImport={() => setTab("importar")} />
          ) : (
            <>
              <WeekNav
                semana={activeSemana}
                rangoLabel={rangoLabel}
                onPrev={() => navigateWeek(-1)}
                onNext={() => navigateWeek(1)}
                canPrev={activeIndex > 0}
                canNext={activeIndex < semanas.length - 1 && activeIndex !== -1}
              />
              <QueLeVaBien mercadona={mercadona} topProductores={topProductores.productores} />
            </>
          )}
        </TabsContent>

        {/* ─── Importar ────────────────────────────────────────────── */}
        <TabsContent value="importar" className="space-y-4">
          <MercadonaImportar ventas={ventas} onImported={() => setTab("resumen")} />
        </TabsContent>

        {/* ─── Exportar ────────────────────────────────────────────── */}
        <TabsContent value="exportar" className="space-y-4">
          <MercadonaExportar semanas={semanas} selectedId={activeSemana?.id ?? null} onSelect={setSelectedId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sub-secciones ───────────────────────────────────────────────────────────

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <Card className="glass-accented">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <ShoppingCart className="h-10 w-10 text-muted-foreground/50" />
        <div>
          <h2 className="text-lg font-semibold">Todavía no hay semanas importadas</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Importa el Excel de Mercadona (histórico o semanal, p. ej. "mercadona s27.xlsx") para ver el resumen.
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={onImport}>
          <Upload className="h-4 w-4" /> Importar Excel
        </Button>
      </CardContent>
    </Card>
  );
}

function WeekNav({
  semana, rangoLabel, onPrev, onNext, canPrev, canNext,
}: {
  semana: MercadonaSemanaConMetodos | null;
  rangoLabel: string | null;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl glass-accented p-3">
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={onPrev} disabled={!canPrev}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="text-center">
        <p className="text-sm font-semibold">
          {semana ? `Semana ${semana.semana} · ${semana.anio}` : "Sin semana seleccionada"}
        </p>
        {rangoLabel ? (
          <p className="text-xs text-muted-foreground">{rangoLabel}</p>
        ) : null}
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={onNext} disabled={!canNext}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function cumplimientoAccent(pct: number): "success" | "warning" | "destructive" {
  if (pct >= 95) return "success";
  if (pct >= 80) return "warning";
  return "destructive";
}

function ResumenSemana({
  semana, mercadona,
}: {
  semana: MercadonaSemanaConMetodos;
  mercadona: ReturnType<typeof useMercadona>;
}) {
  const vendido = semana.vendido_kg ?? 0;
  const planificado = semana.planificado_semana_kg ?? 0;
  const pctCumplimiento = planificado > 0 ? (vendido / planificado) * 100 : 0;
  const accent = cumplimientoAccent(pctCumplimiento);
  const totalPalets = semana.metodos.reduce((s, m) => s + (m.palets ?? 0), 0);
  const totalCajas = semana.metodos.reduce((s, m) => s + (m.cajas ?? 0), 0);

  // KPI "Facturación (base IVA)": solo si el formato semanal real trajo base_iva.
  // Métodos + ajustes/abonos (estos últimos casi siempre negativos).
  const tieneBaseIva = semana.metodos.some((m) => m.base_iva != null) || semana.ajustes_base_iva != null;
  const facturacionMetodos = semana.metodos.reduce((s, m) => s + (m.base_iva ?? 0), 0);
  const facturacionTotal = facturacionMetodos + (semana.ajustes_base_iva ?? 0);
  const eurosPorKg = vendido > 0 ? facturacionTotal / vendido : 0;

  return (
    <div className="space-y-4">
      <section className={cn("grid grid-cols-2 gap-3", tieneBaseIva ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
        <KPICard
          className="glass-accented"
          label="Vendido"
          value={formatKg(vendido)}
          hint={semana.diferencia_pct != null ? `${semana.diferencia_pct >= 0 ? "+" : ""}${formatNumber(semana.diferencia_pct, 1)}% vs planificado` : undefined}
          trend={semana.diferencia_pct != null ? (semana.diferencia_pct >= 0 ? "up" : "down") : "neutral"}
          icon={ShoppingCart}
        />
        <KPICard
          className="glass-accented"
          label="Planificado"
          value={planificado > 0 ? formatKg(planificado) : "Previsto pendiente"}
          hint={semana.planificado_quincena_kg != null ? `${formatKg(semana.planificado_quincena_kg)} / quincena` : (planificado > 0 ? undefined : "Añádelo en Importar → Planificación manual")}
          accent={planificado > 0 ? "primary" : "warning"}
          icon={TrendingUp}
        />
        <KPICard
          className="glass-accented"
          label="Cumplimiento"
          value={planificado > 0 ? formatPct(pctCumplimiento) : "—"}
          accent={accent}
          icon={PackageCheck}
          labelInfo="Vendido / planificado de la semana. Verde ≥95%, ámbar ≥80%, rojo por debajo."
        />
        <KPICard
          className="glass-accented"
          label="Palets / cajas"
          value={`${formatNumber(totalPalets)} / ${formatNumber(totalCajas)}`}
          hint="Totales de los métodos"
          icon={Boxes}
        />
        {tieneBaseIva ? (
          <KPICard
            className="glass-accented"
            label="Facturación (base IVA)"
            value={`${formatNumber(facturacionTotal, 2)} €`}
            hint={`${formatNumber(eurosPorKg, 3)} €/kg medio`}
            icon={Euro}
            labelInfo="Suma de la base IVA de los métodos más los ajustes/abonos de la semana (estos últimos habitualmente negativos)."
          />
        ) : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="glass-accented overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Aprovechamiento MDNA (Mercadona)</CardTitle>
            <p className="text-xs text-muted-foreground">Kg confeccionados MDNA vs total, en los días de esta semana.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {mercadona.isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
            ) : mercadona.kg_total === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sin producción registrada esta semana.</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums">{formatPct(mercadona.pct_kg)}</span>
                  <span className="text-xs text-muted-foreground">{formatKg(mercadona.kg_mercadona)} / {formatKg(mercadona.kg_total)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, mercadona.pct_kg)}%` }} />
                </div>
                <div className="space-y-1.5 pt-1">
                  {mercadona.por_formato.slice(0, 5).map((f) => (
                    <div key={f.formato} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{f.formato}</span>
                      <span className="tabular-nums font-medium">{formatKg(f.kg)} · {formatPct(f.pct)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="glass-accented overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notas de la semana</CardTitle>
          </CardHeader>
          <CardContent>
            {semana.notas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sin notas para esta semana.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {semana.notas.map((nota, i) => (
                  <li key={i} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs leading-relaxed">
                    {nota}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Detalle por método</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                <tr>
                  <th className="text-left">Método</th>
                  <th className="text-left">Descripción</th>
                  <th className="text-right">Kilos</th>
                  {tieneBaseIva ? (
                    <>
                      <th className="text-right">Líneas</th>
                      <th className="text-right">Base IVA</th>
                    </>
                  ) : (
                    <>
                      <th className="text-right">%</th>
                      <th className="text-right">Palets</th>
                      <th className="text-right">Cajas</th>
                      <th className="text-right">Comparativa</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {semana.metodos.length === 0 ? (
                  <tr><td colSpan={tieneBaseIva ? 5 : 7} className="py-6 text-center text-sm text-muted-foreground">Sin métodos registrados.</td></tr>
                ) : semana.metodos.map((m, i) => (
                  <tr key={m.id} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                    <td className="px-3 py-1.5 font-semibold">{m.metodo}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{m.descripcion ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatKg(m.kilos ?? 0)}</td>
                    {tieneBaseIva ? (
                      <>
                        <td className="px-3 py-1.5 text-right tabular-nums">{m.lineas != null ? formatNumber(m.lineas) : "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{m.base_iva != null ? `${formatNumber(m.base_iva, 2)} €` : "—"}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-1.5 text-right tabular-nums">{m.pct != null ? `${formatNumber(m.pct, 0)}%` : "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(m.palets ?? 0)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(m.cajas ?? 0)}</td>
                        <td className={cn(
                          "px-3 py-1.5 text-right tabular-nums",
                          m.comparativa_anterior_pct != null && m.comparativa_anterior_pct >= 0 ? "text-success" : "text-destructive",
                        )}>
                          {m.comparativa_anterior_pct != null ? `${m.comparativa_anterior_pct >= 0 ? "+" : ""}${formatNumber(m.comparativa_anterior_pct, 0)}%` : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {tieneBaseIva && semana.ajustes_base_iva != null ? (
                  <tr className="border-t border-[var(--glass-border)] font-medium">
                    <td className="px-3 py-1.5" colSpan={2}>Ajustes/abonos</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">—</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{semana.ajustes_lineas != null ? formatNumber(semana.ajustes_lineas) : "—"}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums", semana.ajustes_base_iva < 0 ? "text-destructive" : "text-success")}>
                      {formatNumber(semana.ajustes_base_iva, 2)} €
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EvolucionSemanal({ semanas }: { semanas: MercadonaSemanaConMetodos[] }) {
  const data = semanas.map((s) => ({
    label: `S${s.semana}`,
    vendido: s.vendido_kg ?? 0,
    planificado: s.planificado_semana_kg ?? 0,
  }));

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Evolución semanal</CardTitle>
        <p className="text-xs text-muted-foreground">Vendido (barras) vs planificado (línea) por semana importada.</p>
      </CardHeader>
      <CardContent>
        <div className={CHART_PANEL_CLASS}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={MARGIN}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" {...XAXIS} />
              <YAxis {...YAXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
              <Tooltip content={<GlassTooltip formatter={(v) => formatKg(Number(v))} />} />
              <Bar dataKey="vendido" name="Vendido" fill={C.primary} stroke={C.primary} {...BAR_STYLE} />
              <Line dataKey="planificado" name="Planificado" {...lineStyle(C.info)} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function QueLeVaBien({
  mercadona, topProductores,
}: {
  mercadona: ReturnType<typeof useMercadona>;
  topProductores: Array<{ productor: string; kg: number; n_lotes: number }>;
}) {
  const mejorDia = [...mercadona.por_dia].sort((a, b) => b.pct - a.pct)[0] ?? null;
  const topFormatos = mercadona.por_formato.slice(0, 5);
  const topProds = topProductores.slice(0, 8);

  if (mercadona.isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" /> Top formatos MDNA
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topFormatos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin datos de formato esta semana.</p>
          ) : (
            <ol className="space-y-2">
              {topFormatos.map((f, i) => (
                <li key={f.formato} className="flex items-center justify-between rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs">
                  <span className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{i + 1}</span>
                    {f.formato}
                  </span>
                  <span className="tabular-nums font-medium">{formatKg(f.kg)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-success" /> Mejor día de aprovechamiento
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!mejorDia ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin días con producción esta semana.</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-center">
                <p className="text-xs text-muted-foreground">{mejorDia.date}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-success">{formatPct(mejorDia.pct)}</p>
                <p className="text-xs text-muted-foreground">{formatKg(mejorDia.kg_mercadona)} de {formatKg(mejorDia.kg_total)}</p>
              </div>
              <ul className="space-y-1.5">
                {[...mercadona.por_dia].sort((a, b) => b.pct - a.pct).slice(1, 4).map((d) => (
                  <li key={d.date} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{d.date}</span>
                    <span className="tabular-nums">{formatPct(d.pct)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-warning" /> Top productores de la semana
          </CardTitle>
          <p className="text-xs text-muted-foreground">Ranking por kg en lotes_dia de los días de esta semana.</p>
        </CardHeader>
        <CardContent>
          {topProds.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin lotes registrados esta semana.</p>
          ) : (
            <ol className="space-y-2">
              {topProds.map((p, i) => (
                <li key={p.productor} className="flex items-center justify-between rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/10 text-[10px] font-semibold text-warning">{i + 1}</span>
                    <span className="truncate">{p.productor}</span>
                  </span>
                  <span className="shrink-0 tabular-nums font-medium">{formatKg(p.kg)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
