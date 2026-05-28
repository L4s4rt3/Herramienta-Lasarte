import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import {
  GlassTooltip, legendStyle, WEEK_PALETTE, GRID, XAXIS, YAXIS, MARGIN,
  BAR_STYLE, CHART_CURSOR, CHART_PANEL_CLASS, barFill,
} from "@/lib/chartTheme";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FileText, Scale } from "lucide-react";
import { exportEficienciaToExcel, exportEficienciaToPDF } from "@/lib/exportEficiencia";

interface DiaData {
  date: string;
  workers: number;
  kg: number;
  kgPorPersona: number;
}

interface SemanaData {
  weekStart: string;
  label: string;
  days: Record<string, DiaData>;
}

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DAY_KEYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

const DAY_MAP: Record<number, string> = {
  1: "Lun", 2: "Mar", 3: "Mie", 4: "Jue", 5: "Vie", 6: "Sab", 0: "Dom",
};

const RANGE_DAYS = 60;

function num(value: unknown): number {
  return Number(value) || 0;
}

function produccionReal(row: any): number {
  return (
    num(row.kg_produccion_calibrador) +
    num(row.kg_industria_manual) -
    num(row.kg_mujeres_calibrador) -
    num(row.kg_reciclado_malla_z1) -
    num(row.kg_reciclado_malla_z2)
  );
}

function getWeekStart(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

function formatWeekLabel(weekStart: string) {
  const d = new Date(weekStart + "T12:00:00");
  const day = d.getDate();
  const month = d.toLocaleDateString("es-ES", { month: "short" });
  return `${day} ${month}`;
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function weekStats(sem?: SemanaData | null) {
  const days = sem ? Object.values(sem.days) : [];
  const kg = days.reduce((s, d) => s + d.kg, 0);
  const workers = days.reduce((s, d) => s + d.workers, 0);
  const kgPorPersona = workers > 0 ? kg / workers : 0;
  const kgPorDia = days.length > 0 ? kg / days.length : 0;
  const personasDia = days.length > 0 ? workers / days.length : 0;
  const mejorDia = days.reduce<DiaData | null>((best, d) => (!best || d.kgPorPersona > best.kgPorPersona ? d : best), null);
  return { kg, workers, kgPorPersona, kgPorDia, personasDia, dias: days.length, mejorDia };
}

export default function AsistenciaComparativa() {
  const navigate = useNavigate();
  const [semanas, setSemanas] = useState<SemanaData[]>([]);
  const [baseWeek, setBaseWeek] = useState("");
  const [compareWeek, setCompareWeek] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    const until = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - RANGE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: attendance } = await supabase
      .from("asistencia_detalle")
      .select("date, presente")
      .gte("date", from)
      .lte("date", until);

    const dayWorkers: Record<string, number> = {};
    for (const r of attendance ?? []) {
      if (r.presente) dayWorkers[r.date] = (dayWorkers[r.date] ?? 0) + 1;
    }

    const { data: production } = await supabase
      .from("partes_diarios")
      .select("date, kg_produccion_calibrador, kg_industria_manual, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
      .gte("date", from)
      .lte("date", until);

    const kgByDay: Record<string, number> = {};
    for (const r of production ?? []) {
      const kg = produccionReal(r) || num(r.kg_produccion_calibrador);
      if (kg > 0) kgByDay[r.date] = (kgByDay[r.date] ?? 0) + kg;
    }

    const weeksMap: Record<string, SemanaData> = {};
    for (const [date, workers] of Object.entries(dayWorkers)) {
      const kg = kgByDay[date] ?? 0;
      if (kg === 0) continue;
      const d = new Date(date + "T12:00:00");
      const dayKey = DAY_MAP[d.getDay()];
      const ws = getWeekStart(date);
      if (!weeksMap[ws]) {
        weeksMap[ws] = { weekStart: ws, label: formatWeekLabel(ws), days: {} };
      }
      weeksMap[ws].days[dayKey] = {
        date,
        workers,
        kg,
        kgPorPersona: workers > 0 ? kg / workers : 0,
      };
    }

    const result = Object.values(weeksMap).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    setSemanas(result);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (semanas.length === 0) return;
    const exists = (weekStart: string) => semanas.some((s) => s.weekStart === weekStart);
    if (!baseWeek || !exists(baseWeek)) setBaseWeek(semanas[semanas.length - 1].weekStart);
    if (!compareWeek || !exists(compareWeek)) setCompareWeek(semanas[Math.max(0, semanas.length - 2)].weekStart);
  }, [baseWeek, compareWeek, semanas]);

  const chartData = useMemo(() => {
    return semanas.map((sem) => {
      const row: Record<string, any> = { semana: sem.label };
      for (const dk of DAY_KEYS) {
        const dia = sem.days[dk];
        row[dk] = dia ? Math.round(dia.kgPorPersona) : null;
      }
      return row;
    });
  }, [semanas]);

  const totalDias = useMemo(
    () => semanas.reduce((s, w) => s + Object.keys(w.days).length, 0),
    [semanas]
  );
  const totalKg = useMemo(
    () => semanas.reduce((s, w) => s + Object.values(w.days).reduce((a, d) => a + d.kg, 0), 0),
    [semanas]
  );
  const totalWorkers = useMemo(
    () => semanas.reduce((s, w) => s + Object.values(w.days).reduce((a, d) => a + d.workers, 0), 0),
    [semanas]
  );
  const globalKgPorPersona = totalWorkers > 0 ? Math.round(totalKg / totalWorkers) : 0;
  const selectedBase = semanas.find((s) => s.weekStart === baseWeek) ?? semanas[semanas.length - 1];
  const selectedCompare = semanas.find((s) => s.weekStart === compareWeek) ?? semanas[Math.max(0, semanas.length - 2)];
  const baseStats = weekStats(selectedBase);
  const compareStats = weekStats(selectedCompare);
  const diff = (a: number, b: number) => a - b;
  const pctDiff = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);
  const metricCards = [
    {
      label: "Kg/persona",
      base: `${formatNumber(baseStats.kgPorPersona)} kg/p`,
      compare: `${formatNumber(compareStats.kgPorPersona)} kg/p`,
      delta: `${diff(baseStats.kgPorPersona, compareStats.kgPorPersona) >= 0 ? "+" : ""}${formatNumber(diff(baseStats.kgPorPersona, compareStats.kgPorPersona))} kg/p`,
      pct: pctDiff(baseStats.kgPorPersona, compareStats.kgPorPersona),
    },
    {
      label: "Kg producidos",
      base: `${formatNumber(baseStats.kg)} kg`,
      compare: `${formatNumber(compareStats.kg)} kg`,
      delta: `${diff(baseStats.kg, compareStats.kg) >= 0 ? "+" : ""}${formatNumber(diff(baseStats.kg, compareStats.kg))} kg`,
      pct: pctDiff(baseStats.kg, compareStats.kg),
    },
    {
      label: "Personas/dia",
      base: formatNumber(baseStats.personasDia, 1),
      compare: formatNumber(compareStats.personasDia, 1),
      delta: `${diff(baseStats.personasDia, compareStats.personasDia) >= 0 ? "+" : ""}${formatNumber(diff(baseStats.personasDia, compareStats.personasDia), 1)}`,
      pct: pctDiff(baseStats.personasDia, compareStats.personasDia),
    },
    {
      label: "Kg/dia",
      base: `${formatNumber(baseStats.kgPorDia)} kg`,
      compare: `${formatNumber(compareStats.kgPorDia)} kg`,
      delta: `${diff(baseStats.kgPorDia, compareStats.kgPorDia) >= 0 ? "+" : ""}${formatNumber(diff(baseStats.kgPorDia, compareStats.kgPorDia))} kg`,
      pct: pctDiff(baseStats.kgPorDia, compareStats.kgPorDia),
    },
  ];

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/costes/asistencia")} className="h-8">
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
          <div>
            <h1 className="page-title">Comparativa semanal</h1>
            <p className="page-subtitle">
              Kg/persona por día y semana (últimos {RANGE_DAYS} días)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={semanas.length === 0} onClick={() => exportEficienciaToExcel(semanas, `Media global: ${globalKgPorPersona} kg/persona`)} className="glass glass-hover">
            <FileText className="h-4 w-4 mr-1.5" /> Excel
          </Button>
          <Button variant="outline" size="sm" disabled={semanas.length === 0} onClick={() => exportEficienciaToPDF(semanas, `Media global: ${globalKgPorPersona} kg/persona`)} className="glass glass-hover">
            <Download className="h-4 w-4 mr-1.5" /> PDF
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      ) : semanas.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Sin datos semanales (últimos {RANGE_DAYS} días).
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="glass-accented">
            <CardHeader className="pb-3 px-5 pt-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-primary">
                    <Scale className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-semibold">Comparar semanas</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Misma ventana temporal, mas informacion para decidir si la semana mejora o empeora.</p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:w-[420px]">
                  <select value={compareWeek} onChange={(e) => setCompareWeek(e.target.value)} className="h-10 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 text-sm shadow-sm backdrop-blur-xl">
                    {semanas.map((sem) => (
                      <option key={sem.weekStart} value={sem.weekStart}>Comparar: semana del {sem.label}</option>
                    ))}
                  </select>
                  <select value={baseWeek} onChange={(e) => setBaseWeek(e.target.value)} className="h-10 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 text-sm shadow-sm backdrop-blur-xl">
                    {semanas.map((sem) => (
                      <option key={sem.weekStart} value={sem.weekStart}>Actual: semana del {sem.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {metricCards.map((m) => {
                  const positive = m.pct >= 0;
                  return (
                    <div key={m.label} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 shadow-sm backdrop-blur-xl">
                      <div className="flex items-center justify-between gap-3">
                        <p className="panel-kicker">{m.label}</p>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${positive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                          {positive ? "+" : ""}{formatNumber(m.pct, 1)}%
                        </span>
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-2xl font-semibold tabular-nums text-foreground">{m.base}</p>
                          <p className="text-xs text-muted-foreground">vs {m.compare}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-semibold tabular-nums ${positive ? "text-success" : "text-destructive"}`}>{m.delta}</p>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">diferencia</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
                  <p className="panel-kicker">Mejor dia semana actual</p>
                  <p className="mt-1 text-sm font-semibold">
                    {baseStats.mejorDia ? `${formatDateShort(baseStats.mejorDia.date)} · ${formatNumber(baseStats.mejorDia.kgPorPersona)} kg/persona` : "Sin dato"}
                  </p>
                  <p className="text-xs text-muted-foreground">{baseStats.dias} dias con datos, {formatNumber(baseStats.workers)} presencias acumuladas.</p>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
                  <p className="panel-kicker">Lectura directiva</p>
                  <p className="mt-1 text-sm text-foreground">
                    La semana actual esta {baseStats.kgPorPersona >= compareStats.kgPorPersona ? "por encima" : "por debajo"} de la semana comparada en rendimiento por persona, con {formatNumber(baseStats.kg)} kg producidos y {formatNumber(baseStats.personasDia, 1)} personas/dia.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Chart */}
          <Card className="glass-accented">
            <CardHeader className="pb-3 px-5 pt-4">
              <div className="flex items-center gap-3">
                <div className="h-7 w-1 rounded-full bg-primary" />
                <div>
                  <CardTitle className="text-lg font-semibold">Kg/persona por día de la semana</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Rendimiento comparativo por día y semana</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-1">
              <div className={CHART_PANEL_CLASS}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={MARGIN}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="semana" {...XAXIS} />
                  <YAxis {...YAXIS} tickFormatter={(v) => `${v} kg/p`} width={52} />
                  <Tooltip cursor={CHART_CURSOR} content={<GlassTooltip formatter={(v) => v ? `${new Intl.NumberFormat("es-ES").format(Number(v))} kg/p` : "—"} />} />
                  <Legend wrapperStyle={legendStyle} />
                  {DAY_KEYS.map((dk, i) => {
                    const c = WEEK_PALETTE[i];
                    return (
                      <Bar key={dk} dataKey={dk} name={DAYS[i]} fill={barFill(c, 0.28)} stroke={c} {...BAR_STYLE} maxBarSize={20} connectNulls={false} />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Data table — week rows × day columns */}
          <Card className="glass-accented">
            <CardHeader>
              <CardTitle className="text-sm">Días por semana</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="glass rounded-xl overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                      <th className="sticky left-0 z-10 bg-[var(--glass-bg-strong)] px-4 py-3 text-left text-xs font-bold uppercase text-muted-foreground backdrop-blur-xl">Semana</th>
                      {DAYS.map((d) => (
                        <th key={d} className="text-center px-3 py-3 font-bold text-xs uppercase text-muted-foreground">{d}</th>
                      ))}
                      <th className="text-right px-4 py-3 font-bold text-xs uppercase text-muted-foreground">Kg total</th>
                      <th className="text-right px-4 py-3 font-bold text-xs uppercase text-muted-foreground">Personas</th>
                      <th className="text-right px-4 py-3 font-bold text-xs uppercase text-muted-foreground">Dias</th>
                      <th className="text-right px-4 py-3 font-bold text-xs uppercase text-muted-foreground">Kg/persona</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {semanas.map((sem) => {
                      const semKg = Object.values(sem.days).reduce((a, d) => a + d.kg, 0);
                      const semWorkers = Object.values(sem.days).reduce((a, d) => a + d.workers, 0);
                      const semEfic = semWorkers > 0 ? Math.round(semKg / semWorkers) : 0;
                      const values = Object.values(sem.days);
                      const maxKgP = values.length > 0 ? Math.max(...values.map(d => d.kgPorPersona)) : 0;
                      return (
                        <tr key={sem.weekStart}>
                          <td className="sticky left-0 z-10 bg-[var(--glass-bg-strong)] px-4 py-3 text-left font-medium backdrop-blur-xl">Semana del {sem.label}</td>
                          {DAY_KEYS.map((dk) => {
                            const dia = sem.days[dk];
                            if (!dia) return <td key={dk} className="text-center px-3 py-3 text-muted-foreground text-xs">—</td>;
                            const pct = maxKgP > 0 ? dia.kgPorPersona / maxKgP : 0;
                            const intensity = Math.max(0.05, pct);
                            return (
                              <td key={dk} className="text-center px-3 py-3 relative">
                                <div
                                  className="absolute inset-0 rounded"
                                  style={{ background: `hsla(142, 55%, 42%, ${intensity * 0.18})` }}
                                />
                                <div className="relative z-10">
                                  <p className="font-semibold tabular-nums text-xs">{formatNumber(Math.round(dia.kgPorPersona))}</p>
                                  <p className="text-[10px] text-muted-foreground">{formatNumber(dia.kg)} kg · {dia.workers} p.</p>
                                </div>
                              </td>
                            );
                          })}
                          <td className="text-right px-4 py-3 font-semibold tabular-nums">{formatNumber(semKg)}</td>
                          <td className="text-right px-4 py-3 tabular-nums">{formatNumber(semWorkers)}</td>
                          <td className="text-right px-4 py-3 tabular-nums">{Object.keys(sem.days).length}</td>
                          <td className="text-right px-4 py-3 font-bold tabular-nums">{new Intl.NumberFormat("es-ES").format(semEfic)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Summary note */}
          <Card className="glass-accented">
            <CardContent className="p-5 text-sm space-y-1">
              <p className="text-foreground"><strong>Media global:</strong> {globalKgPorPersona} kg/persona en {totalDias} días ({totalKg > 1000 ? `${(totalKg / 1000).toFixed(1)}t` : `${Math.round(totalKg)} kg`} totales).</p>
              <p className="text-xs text-muted-foreground">Basado en datos de los últimos {RANGE_DAYS} días con asistencia y producción registrada.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
