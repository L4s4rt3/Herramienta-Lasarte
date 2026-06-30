import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, CalendarDays, UserCheck, PackageCheck, FileText, UserX, ShieldOff, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type SemanaDataRaw,
  type FaltasSemanalesRow,
  type RendimientoGrupoSemanal,
  type DiaGrupoData,
  type ProductoClasificadoSemanal,
  getWeekDates,
  getWeekLabel,
  shiftWeek,
  buildFaltasSemanales,
  calcularKgPersonaSemanal,
  calcularRendimientoGrupoSemanal,
  calcularKgSeccionSemanal,
  productosClasificadosSemanales,
} from "@/lib/asistenciaSemanal";

const DAY_ABBR = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "dom"];
const DAY_FULL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function formatoEntero(value: number) {
  return new Intl.NumberFormat("es-ES").format(Math.round(value));
}

function formatoDecimal(value: number, digits = 1) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function statusBadgeClass(status: string) {
  if (status === "presente") return "bg-success/15 text-success border-success/25";
  if (status === "ausente") return "bg-destructive/15 text-destructive border-destructive/25";
  if (status === "baja") return "bg-sky-100 text-sky-800 border-sky-300";
  return "bg-amber-100 text-amber-800 border-amber-300";
}

function statusClass(status: string) {
  if (status === "presente") return "bg-success text-success-foreground";
  if (status === "ausente") return "bg-destructive text-destructive-foreground";
  if (status === "baja") return "bg-sky-400 text-white";
  return "bg-amber-400 text-amber-950";
}

interface AsistenciaSemanalPanelProps {
  semana: SemanaDataRaw | null;
  loading: boolean;
  weekStart: string;
  onWeekChange: (date: string) => void;
  onExport: () => void;
  exporting?: boolean;
  incluirSabado: boolean;
  onToggleSabado: () => void;
}

export default function AsistenciaSemanalPanel({
  semana,
  loading,
  weekStart,
  onWeekChange,
  onExport,
  exporting,
  incluirSabado,
  onToggleSabado,
}: AsistenciaSemanalPanelProps) {
  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekLabel = useMemo(() => getWeekLabel(dates), [dates]);

  const faltas = useMemo(() => {
    if (!semana) return [];
    return buildFaltasSemanales(semana, incluirSabado);
  }, [semana, incluirSabado]);

  const kgPersona = useMemo(() => {
    if (!semana) return { totalKg: 0, mediaPersonasComputables: 0, mediaPersonasTotales: 0, kgPersona: 0, diasConDatos: 0 };
    return calcularKgPersonaSemanal(semana, incluirSabado);
  }, [semana, incluirSabado]);

  const rendimientoGrupos = useMemo(() => {
    if (!semana) return [];
    return calcularRendimientoGrupoSemanal(semana, incluirSabado);
  }, [semana, incluirSabado]);

  const kgSecciones = useMemo(() => {
    if (!semana) return [];
    return calcularKgSeccionSemanal(semana, incluirSabado);
  }, [semana, incluirSabado]);

  const productos = useMemo(() => {
    if (!semana) return [];
    return productosClasificadosSemanales(semana, incluirSabado);
  }, [semana, incluirSabado]);

  const totalActivos = semana?.trabajadores.filter((t) => t.activo).length ?? 0;
  const totalFaltasSemana = faltas.reduce((s, r) => s + r.totalFaltas, 0);
  const totalBajasSemana = faltas.filter((r) => r.totalBajas > 0).length;
  const productosKgComputable = productos.reduce((t, p) => t + (p.computa ? p.kg : 0), 0);
  const maxKgGrupo = Math.max(...rendimientoGrupos.map((g) => g.totalKg), 1);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="glass-accented glass-accent-top overflow-hidden">
        <CardContent className="p-0">
          <div className="border-b border-[var(--glass-border)] p-5">
            <div className="flex flex-wrap items-stretch divide-x divide-[var(--glass-border)] rounded-xl border border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] shadow-[var(--glass-shadow)]">
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                  <Scale className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="panel-kicker">Kg/persona</p>
                  <p className="text-2xl font-semibold leading-none tabular-nums text-primary">{formatoEntero(kgPersona.kgPersona)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <PackageCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="panel-kicker">Kg totales</p>
                  <p className="text-2xl font-semibold leading-none tabular-nums">{formatoEntero(kgPersona.totalKg)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-success/25 bg-success/10 text-success">
                  <UserCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="panel-kicker">Media pers/dia</p>
                  <p className="text-xl font-semibold leading-none tabular-nums">{formatoDecimal(kgPersona.mediaPersonasTotales, 1)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10 text-destructive">
                  <UserX className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="panel-kicker">Ausencias</p>
                  <p className="text-xl font-semibold leading-none tabular-nums">{formatoEntero(totalFaltasSemana)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-300 bg-sky-100 text-sky-700">
                  <ShieldOff className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="panel-kicker">Bajas laborales</p>
                  <p className="text-xl font-semibold leading-none tabular-nums">{formatoEntero(totalBajasSemana)}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Kg/persona por zona (semanal)</p>
              <Badge variant="secondary" className="rounded-full tabular-nums">
                {productos.length} productos clasificados
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {rendimientoGrupos.map((g) => (
                <div key={g.label} className="flex flex-col rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{g.label}</p>
                      <p className="text-xs text-muted-foreground">{formatoDecimal(g.mediaPersonasDia, 1)} pers/dia media</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-primary">{formatoEntero(g.totalKg)} kg</p>
                      <p className="text-[11px] font-semibold tabular-nums text-muted-foreground">{formatoDecimal(g.porcentajeKg, 1)}%</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="text-2xl font-semibold leading-none tabular-nums">{formatoEntero(g.kgPersona)}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">kg/persona zona</p>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(5, (g.totalKg / maxKgGrupo) * 100)}%` }} />
                  </div>
                  {g.daily.some((d) => d.kg > 0 || d.personas > 0) && (
                    <div className="mt-4 border-t border-[var(--glass-border)] pt-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Desglose diario</p>
                      <div className="grid grid-cols-5 gap-2">
                        {g.daily.map((d) => {
                          const diaIdx = new Date(d.date + "T12:00:00").getDay();
                          const diaLabel = DAY_ABBR[diaIdx === 0 ? 6 : diaIdx - 1] ?? d.date.slice(5);
                          return (
                            <div key={d.date} className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-1.5 py-2 text-center">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{diaLabel}</p>
                              <p className="mt-1 text-sm font-semibold tabular-nums">{formatoEntero(d.kg)}</p>
                              <p className="text-[10px] text-muted-foreground tabular-nums">{d.personas} pers</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="border-b border-[var(--glass-border)] pb-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle className="text-lg">Faltas semanales</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{incluirSabado ? "Lun a Sab" : "Lun a Vie"} &middot; Domingo no laborable</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={incluirSabado}
                  onChange={onToggleSabado}
                  className="h-3.5 w-3.5 rounded border-gray-300"
                />
                Incluir sábado
              </label>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> Presente</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-destructive" /> Ausente</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-400" /> Baja</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Sin reg.</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                  <th className="sticky left-0 z-10 bg-[var(--glass-bg-strong)] px-3 py-3 text-left text-xs font-bold uppercase text-muted-foreground">Trabajador</th>
                  <th className="sticky left-0 z-10 bg-[var(--glass-bg-strong)] px-3 py-3 text-left text-xs font-bold uppercase text-muted-foreground">Zona</th>
                  {dates.map((date, i) => {
                    const esDomingo = new Date(date + "T12:00:00").getDay() === 0;
                    const esSabado = new Date(date + "T12:00:00").getDay() === 6;
                    const noLaborable = esDomingo || (esSabado && !incluirSabado);
                    return (
                      <th key={date} className={cn("text-center px-2 py-3 text-xs font-bold uppercase", noLaborable ? "text-muted-foreground/40" : "text-muted-foreground")}>
                        <div>{DAY_ABBR[i]}</div>
                        <div className="text-[10px] font-normal">{new Date(date + "T12:00:00").getDate()}</div>
                        {noLaborable && <div className="text-[8px] font-normal mt-0.5">festivo</div>}
                      </th>
                    );
                  })}
                  <th className="text-center px-2 py-3 text-xs font-bold uppercase text-muted-foreground">Faltas</th>
                  <th className="text-center px-2 py-3 text-xs font-bold uppercase text-muted-foreground">Bajas</th>
                  <th className="text-center px-2 py-3 text-xs font-bold uppercase text-muted-foreground">Pres.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--glass-border)]">
                {faltas.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Sin datos de asistencia para esta semana.
                    </td>
                  </tr>
                ) : (
                  faltas.map((row) => (
                    <tr key={row.trabajadorId} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-sm font-semibold">{row.nombre}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{row.zona ?? "—"}</td>
                      {dates.map((date) => {
                        const status = row.days[date] ?? "sinRegistrar";
                        return (
                          <td key={date} className="px-2 py-2 text-center">
                            <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold", statusClass(status))}>
                              {status === "presente" ? "P" : status === "ausente" ? "A" : status === "baja" ? "B" : "?"}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-center text-sm font-semibold text-destructive">{row.totalFaltas || "—"}</td>
                      <td className="px-2 py-2 text-center text-sm font-semibold text-sky-700">{row.totalBajas || "—"}</td>
                      <td className="px-2 py-2 text-center text-sm font-semibold text-success">{row.totalPresentes || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="glass-accented">
          <CardHeader className="border-b border-[var(--glass-border)] pb-3">
            <CardTitle className="text-sm">Kg por seccion</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {kgSecciones.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">Sin datos de clasificacion esta semana.</p>
            ) : (
              <div className="divide-y divide-[var(--glass-border)]">
                {kgSecciones.map((item) => (
                  <div key={item.zona} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="rounded-full text-xs">{item.zona}</Badge>
                      {!item.computa && <span className="text-xs text-muted-foreground">fuera kg/zona</span>}
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{formatoEntero(item.kg)} kg</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-accented">
          <CardHeader className="border-b border-[var(--glass-border)] pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Productos clasificados</CardTitle>
              <Badge variant="outline" className="rounded-full tabular-nums">{formatoEntero(productosKgComputable)} kg computables</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {productos.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">Sin lineas de producto cargadas.</p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto">
                {productos.map((item, i) => (
                  <div key={`${item.producto}-${item.empaque}-${i}`} className="grid gap-2 border-b border-[var(--glass-border)] px-4 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_160px_110px]">
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-semibold">{item.producto}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.empaque}</p>
                    </div>
                    <div className="flex items-center gap-2 md:justify-start">
                      <Badge variant="outline" className="rounded-full">{item.zona}</Badge>
                      {!item.computa && <span className="text-xs text-muted-foreground">fuera kg/zona</span>}
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-primary md:text-right">{formatoEntero(item.kg)} kg</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
