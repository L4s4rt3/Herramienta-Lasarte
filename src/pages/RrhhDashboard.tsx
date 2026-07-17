// src/pages/RrhhDashboard.tsx
// "Panel de RRHH": nueva portada de la sección RRHH. Concentra los KPIs
// generales de plantilla/asistencia, la comparativa semanal de kg/persona
// (antes en src/pages/AsistenciaComparativa.tsx) y el rendimiento por grupo +
// kg/persona de un día concreto (antes en src/pages/Asistencia.tsx). Las
// tablas rrhh_* (amonestaciones, vacaciones, justificantes) tienen RLS
// restringida a rrhh/admin: si el usuario no tiene ese rol se degradan con un
// aviso, pero el resto del panel (asistencia, rendimiento, comparativa) no es
// sensible y se muestra igual.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarCheck,
  CalendarClock,
  FileWarning,
  HeartPulse,
  Mail,
  Package,
  Palmtree,
  Scale,
  ShieldAlert,
  ShoppingCart,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { KPICard } from "@/components/KPICard";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  GRID, XAXIS, YAXIS, MARGIN, BAR_STYLE, CHART_CURSOR, CHART_PANEL_CLASS,
  GlassTooltip, legendStyle, WEEK_PALETTE, barFill,
} from "@/lib/chartTheme";
import { formatDate, formatKg, formatNumber, today } from "@/lib/format";
import { useRrhhDashboard, useRendimientoDia } from "@/hooks/useRrhhDashboard";
import { useRrhhNominas } from "@/hooks/useRrhhDocs";
import type { SemanaComparativaData } from "@/lib/asistenciaComparativa";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DAY_KEYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

const MES_LABELS = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const GRAVEDAD_LABEL: Record<string, string> = {
  leve: "Leve",
  grave: "Grave",
  muy_grave: "Muy grave",
};

const GRAVEDAD_CLASS: Record<string, string> = {
  leve: "border-warning/40 bg-warning/10 text-warning",
  grave: "border-[hsl(24_95%_53%/0.4)] bg-[hsl(24_95%_53%/0.1)] text-[hsl(24_95%_40%)]",
  muy_grave: "border-destructive/40 bg-destructive/10 text-destructive",
};

function weekKgPersona(sem: SemanaComparativaData): { kg: number; workers: number; kgPersona: number } {
  const days = Object.values(sem.days);
  const kg = days.reduce((s, d) => s + d.kg, 0);
  const workers = days.reduce((s, d) => s + d.workers, 0);
  return { kg, workers, kgPersona: workers > 0 ? kg / workers : 0 };
}

function SinPermisoAviso() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      Solo RRHH y administración pueden ver este bloque.
    </div>
  );
}

function EstadoVacio({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <FileWarning className="h-7 w-7 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}

export default function RrhhDashboard() {
  const rrhh = useRrhhDashboard();
  // Las asistencias se registran al día siguiente: "hoy" normalmente aún no
  // tiene datos, así que el selector arranca en el último día con asistencia
  // registrada (o ayer si todavía no hay ninguno) en vez de en hoy. Se guarda
  // solo la elección manual del usuario; mientras no elija, sigue el valor
  // por defecto que expone el hook (que llega async tras la primera carga).
  const [fechaRendimientoManual, setFechaRendimientoManual] = useState<string | null>(null);
  const fechaRendimiento = fechaRendimientoManual ?? rrhh.ultimoDiaConAsistencia;
  const rendimiento = useRendimientoDia(fechaRendimiento);

  // ─── Nóminas: mes con hueco más reciente (dato-resumen barato para el
  // acceso a "Nóminas", hoy isla) — una sola query a rrhh_nominas del año en
  // curso, recorrida hacia atrás desde el mes actual hasta encontrar uno con
  // menos nóminas subidas que trabajadores activos.
  const hoy = today();
  const anioActual = Number(hoy.slice(0, 4));
  const mesActual = Number(hoy.slice(5, 7));
  const nominas = useRrhhNominas(anioActual);
  const mesConHuecoNominas = useMemo(() => {
    if (nominas.sinPermiso || rrhh.plantillaActiva === 0) return null;
    const trabajadoresPorMes = new Map<number, Set<string>>();
    for (const n of nominas.nominas) {
      const set = trabajadoresPorMes.get(n.mes) ?? new Set<string>();
      set.add(n.trabajador_id);
      trabajadoresPorMes.set(n.mes, set);
    }
    for (let mes = mesActual; mes >= 1; mes--) {
      const count = trabajadoresPorMes.get(mes)?.size ?? 0;
      if (count < rrhh.plantillaActiva) return mes;
    }
    return null;
  }, [nominas.nominas, nominas.sinPermiso, rrhh.plantillaActiva, mesActual]);

  const semanas = rrhh.semanas;
  const chartData = semanas.map((sem) => {
    const row: Record<string, string | number | null> = { semana: sem.label };
    for (const dk of DAY_KEYS) {
      const dia = sem.days[dk];
      row[dk] = dia ? Math.round(dia.kgPorPersona) : null;
    }
    return row;
  });
  const ultimaSemana = semanas[semanas.length - 1] ?? null;
  const ultimaSemanaStats = ultimaSemana ? weekKgPersona(ultimaSemana) : null;

  const maxGrupoKgPersona = Math.max(1, ...rendimiento.grupos.map((g) => g.kgPersona));

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />
            RRHH
          </p>
          <h1 className="page-title">Panel de RRHH</h1>
          <p className="page-subtitle">
            Plantilla, asistencia, rendimiento y comparativa semanal en un único vistazo.
          </p>
        </div>
      </header>

      {/* ─── KPIs ─────────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6">
        <KPICard
          className="glass-accented"
          label="Plantilla activa"
          value={rrhh.isLoading ? "…" : formatNumber(rrhh.plantillaActiva)}
          hint={`${formatNumber(rrhh.computablesKgPersona)} computan kg/persona`}
          icon={Users}
          to="/rrhh/personas"
          /* --vivo: KPI principal de este dashboard (dato vivo, ajuste 2026-07-16) */
          valueClassName="text-vivo"
        />
        <KPICard
          className="glass-accented"
          label={`Asistencia (último día: ${formatDate(rrhh.ultimoDiaConAsistencia)})`}
          value={!rrhh.hayAsistenciaRegistrada ? "—" : rrhh.isLoading ? "…" : formatNumber(rrhh.presentesUltimoDia)}
          hint={rrhh.hayAsistenciaRegistrada ? `${formatNumber(rrhh.pctAsistenciaUltimoDia ?? 0, 0)}% asistencia` : "Sin días con asistencia registrada"}
          accent={
            !rrhh.hayAsistenciaRegistrada
              ? "primary"
              : (rrhh.pctAsistenciaUltimoDia ?? 0) >= 90
                ? "success"
                : (rrhh.pctAsistenciaUltimoDia ?? 0) >= 75
                  ? "warning"
                  : "destructive"
          }
          icon={CalendarCheck}
          to="/costes/asistencia"
        />
        <KPICard
          className="glass-accented"
          label="Ausencias esta semana"
          value={rrhh.isLoading ? "…" : formatNumber(rrhh.ausenciasSemana)}
          hint="Desde el lunes"
          accent={rrhh.ausenciasSemana > 0 ? "warning" : "primary"}
          icon={AlertTriangle}
          to="/rrhh/ausencias"
        />
        <KPICard
          className="glass-accented"
          label="Bajas activas"
          value={rrhh.isLoading ? "…" : formatNumber(rrhh.bajasActivas.length)}
          hint="Bajas laborales en curso"
          accent={rrhh.bajasActivas.length > 0 ? "warning" : "primary"}
          icon={HeartPulse}
          to="/costes/asistencia"
        />
        <KPICard
          className="glass-accented"
          label="Justificantes sin resolver"
          value={rrhh.sinPermisoRrhh ? "—" : rrhh.isLoadingRrhh ? "…" : formatNumber(rrhh.justificantesPendientes)}
          hint={rrhh.sinPermisoRrhh ? "Solo RRHH y administración" : "Ausencias sin justificante"}
          accent={!rrhh.sinPermisoRrhh && rrhh.justificantesPendientes > 0 ? "destructive" : "primary"}
          icon={FileWarning}
          to="/rrhh/ausencias"
        />
        <KPICard
          className="glass-accented"
          label="Días de vacaciones repartidos"
          value={rrhh.sinPermisoRrhh ? "—" : rrhh.isLoadingRrhh ? "…" : formatNumber(rrhh.diasVacacionesAnioActual)}
          hint={rrhh.sinPermisoRrhh ? "Solo RRHH y administración" : `En ${today().slice(0, 4)}`}
          icon={Palmtree}
          to="/rrhh/vacaciones"
        />
      </section>

      {/* ─── Comparativa semanal ──────────────────────────────────────────── */}
      <Card className="glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-primary">
                <Scale className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold">Comparativa semanal de kg/persona</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Últimos {semanas.length} semana(s) con asistencia y producción registrada.
                </p>
              </div>
            </div>
            <Link
              to="/costes/asistencia/comparativa"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ver comparativa completa →
            </Link>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-1">
          {rrhh.isLoading ? (
            <Skeleton className="h-64" />
          ) : semanas.length === 0 ? (
            <EstadoVacio texto="Sin datos semanales todavía (últimos 60 días)." />
          ) : (
            <>
              {ultimaSemanaStats && (
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                    <p className="panel-kicker">Última semana</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {formatNumber(Math.round(ultimaSemanaStats.kgPersona))} kg/p
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                    <p className="panel-kicker">Kg producidos</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{formatKg(ultimaSemanaStats.kg)}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                    <p className="panel-kicker">Semana del</p>
                    <p className="mt-1 text-lg font-semibold">{ultimaSemana?.label}</p>
                  </div>
                </div>
              )}
              <div className={CHART_PANEL_CLASS}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={MARGIN}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="semana" {...XAXIS} />
                    <YAxis {...YAXIS} tickFormatter={(v) => `${v} kg/p`} width={52} />
                    <Tooltip
                      cursor={CHART_CURSOR}
                      content={<GlassTooltip formatter={(v) => (v ? `${new Intl.NumberFormat("es-ES").format(Number(v))} kg/p` : "—")} />}
                    />
                    <Legend wrapperStyle={legendStyle} />
                    {DAY_KEYS.map((dk, i) => {
                      const c = WEEK_PALETTE[i];
                      return (
                        <Bar key={dk} dataKey={dk} name={DAYS[i]} fill={barFill(c, 0.28)} stroke={c} {...BAR_STYLE} maxBarSize={20} />
                      );
                    })}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Rendimiento por grupo + kg/persona de un día ────────────────── */}
      <Card className="glass-accented">
        <CardHeader className="pb-3 px-5 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-primary">
                <Package className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold">Rendimiento por grupo</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Kg y kg/persona por grupo en un día concreto.</p>
              </div>
            </div>
            <GlassDatePicker value={fechaRendimiento} onChange={setFechaRendimientoManual} label="Elegir día" displayFormat="dd MMM yyyy" />
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {rendimiento.isLoading ? (
            <Skeleton className="h-48" />
          ) : !rendimiento.hayDatos ? (
            <EstadoVacio texto={`Sin parte ni asistencia registrada para el ${formatDate(fechaRendimiento)}.`} />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] p-4">
                  <p className="panel-kicker">Kg/persona general</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-primary">
                    {formatNumber(Math.round(rendimiento.kgPersonaGeneral))} kg/p
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatKg(rendimiento.kgProduccionDia)} · {formatNumber(rendimiento.presentesComputables)} personas computan
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
                  <p className="panel-kicker">Presentes</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(rendimiento.presentes)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatNumber(rendimiento.fueraKgPersona)} fuera de kg/persona</p>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
                  <p className="panel-kicker">Producción del día</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{rendimiento.hayParte ? formatKg(rendimiento.kgProduccionDia) : "Sin parte"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(fechaRendimiento)}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {rendimiento.grupos.map((g, i) => (
                  <div key={g.grupo} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{g.label}</p>
                      <Badge variant="outline" className="text-[10px] tabular-nums">{formatNumber(g.porcentajeKg, 0)}%</Badge>
                    </div>
                    <p className="mt-2 text-xl font-semibold tabular-nums">{formatNumber(Math.round(g.kgPersona))} kg/p</p>
                    <p className="text-xs text-muted-foreground">{formatKg(g.kg)} · {formatNumber(g.personas)} pers.{g.objetivo != null ? ` (obj. ${g.objetivo})` : ""}</p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(4, Math.round((g.kgPersona / maxGrupoKgPersona) * 100))}%`,
                          background: barFill(WEEK_PALETTE[i % WEEK_PALETTE.length], 0.9),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Amonestaciones / vacaciones / bajas / nóminas y comunicaciones ─ */}
      <section className="grid gap-4 xl:grid-cols-4">
        <Card className="glass-accented">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Últimas amonestaciones</CardTitle>
              <Link to="/rrhh/amonestaciones" className="text-xs font-semibold text-primary hover:underline">Ver todas</Link>
            </div>
          </CardHeader>
          <CardContent>
            {rrhh.sinPermisoRrhh ? (
              <SinPermisoAviso />
            ) : rrhh.isLoadingRrhh ? (
              <Skeleton className="h-32" />
            ) : rrhh.amonestacionesRecientes.length === 0 ? (
              <EstadoVacio texto="Sin amonestaciones registradas." />
            ) : (
              <ul className="divide-y divide-[var(--glass-border)]">
                {rrhh.amonestacionesRecientes.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.nombre}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.motivo}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="outline" className={`text-[10px] ${GRAVEDAD_CLASS[a.gravedad] ?? ""}`}>
                        {GRAVEDAD_LABEL[a.gravedad] ?? a.gravedad}
                      </Badge>
                      <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(a.fecha)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="glass-accented">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Próximas vacaciones</CardTitle>
              <Link to="/rrhh/vacaciones" className="text-xs font-semibold text-primary hover:underline">Ver todas</Link>
            </div>
          </CardHeader>
          <CardContent>
            {rrhh.sinPermisoRrhh ? (
              <SinPermisoAviso />
            ) : rrhh.isLoadingRrhh ? (
              <Skeleton className="h-32" />
            ) : rrhh.vacacionesProximas.length === 0 ? (
              <EstadoVacio texto="Sin periodos de vacaciones próximos." />
            ) : (
              <ul className="divide-y divide-[var(--glass-border)]">
                {rrhh.vacacionesProximas.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{v.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(v.fechaInicio)} — {formatDate(v.fechaFin)}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px] tabular-nums">
                      {formatNumber(v.diasNaturales)} días
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="glass-accented">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Bajas activas</CardTitle>
              <Link to="/costes/asistencia" className="text-xs font-semibold text-primary hover:underline">Ver asistencia</Link>
            </div>
          </CardHeader>
          <CardContent>
            {rrhh.isLoading ? (
              <Skeleton className="h-32" />
            ) : rrhh.bajasActivas.length === 0 ? (
              <EstadoVacio texto="Sin bajas laborales activas." />
            ) : (
              <ul className="divide-y divide-[var(--glass-border)]">
                {rrhh.bajasActivas.map((b) => (
                  <li key={b.id} className="flex items-start justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.nombre}</p>
                      <p className="truncate text-xs text-muted-foreground">{b.motivo}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {formatDate(b.fechaInicio)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Nóminas y comunicaciones: hoy islas, se enganchan al panel con un
            dato-resumen barato (mes con hueco más reciente en nóminas). */}
        <Card className="glass-accented">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Nóminas y comunicaciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Link
              to="/rrhh/nominas"
              className="group flex items-start gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 transition-colors hover:bg-[var(--glass-bg-strong)]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg glass-strong text-primary">
                <Banknote className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Nóminas</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {nominas.sinPermiso
                    ? "Solo RRHH y administración"
                    : mesConHuecoNominas != null
                      ? `Falta subir ${MES_LABELS[mesConHuecoNominas]}`
                      : `Al día en ${anioActual}`}
                </p>
              </div>
              <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/rrhh/comunicaciones"
              className="group flex items-start gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 transition-colors hover:bg-[var(--glass-bg-strong)]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg glass-strong text-primary">
                <Mail className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Comunicaciones</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Avisos automáticos y correos a la plantilla</p>
              </div>
              <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
            {/* Isla pendiente (anotada en FASE 4): Mercadona completa vive en su
                propia sección de RRHH, pero no tenía acceso desde este panel. */}
            <Link
              to="/rrhh/mercadona"
              className="group flex items-start gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 transition-colors hover:bg-[var(--glass-bg-strong)]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg glass-strong text-primary">
                <ShoppingCart className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Mercadona</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Ventas, facturas y precios del cliente principal</p>
              </div>
              <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
