// src/pages/RrhhVacaciones.tsx
// Seccion "Vacaciones y horas" de RRHH: devengo/disfrute de vacaciones por
// trabajador (rrhh_vacaciones_periodos) y bolsa de horas +/- (rrhh_horas).
// Vista tipo "panel de control": tarjetas por trabajador con saldo grande
// coloreado + barra de progreso, para ver de un vistazo quien tiene
// vacaciones/horas pendientes y quien esta en negativo.
import { useMemo, useState } from "react";
import {
  AlertTriangle, CalendarDays, CalendarPlus, CheckCircle2, ChevronRight, Clock,
  Minus, Plus, ShieldAlert, Trash2, TrendingDown, TrendingUp, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KPICard } from "@/components/KPICard";
import { toast } from "@/hooks/use-toast";
import {
  useRrhhVacaciones, type RrhhHoraRow, type RrhhTrabajadorRow, type RrhhVacacionesPeriodoRow,
} from "@/hooks/useRrhhVacaciones";
import {
  diasDisfrutadosEnAnio, diasNaturalesPeriodo, diasDevengados,
} from "@/lib/rrhhVacaciones";
import { formatDate, formatNumber, toISODateLocal } from "@/lib/format";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";

type TopTab = "vacaciones" | "horas";

const hoyISO = () => toISODateLocal(new Date());

export default function RrhhVacaciones() {
  const rrhh = useRrhhVacaciones();
  const [tab, setTab] = useState<TopTab>("vacaciones");
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);

  const anios = useMemo(() => {
    const set = new Set<number>([anioActual]);
    for (const p of rrhh.periodos) set.add(Number(p.fecha_inicio.slice(0, 4)));
    return Array.from(set).sort((a, b) => b - a);
  }, [rrhh.periodos, anioActual]);

  if (rrhh.accessDenied) {
    return (
      <div className="page-shell">
        <Header />
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Sin permiso para ver esta sección</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                "Vacaciones y horas" solo está disponible para perfiles de RRHH o administración.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (rrhh.tablesMissing) {
    return (
      <div className="page-shell">
        <Header />
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Sección pendiente de activar</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Las tablas de vacaciones y horas todavía no existen en la base de datos.
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
        <Header />

        <TabsList>
          <TabsTrigger value="vacaciones">Vacaciones</TabsTrigger>
          <TabsTrigger value="horas">Bolsa de horas</TabsTrigger>
        </TabsList>

        <TabsContent value="vacaciones" className="space-y-4">
          <VacacionesTab rrhh={rrhh} anio={anio} setAnio={setAnio} anios={anios} anioActual={anioActual} />
        </TabsContent>

        <TabsContent value="horas" className="space-y-4">
          <HorasTab rrhh={rrhh} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Header() {
  return (
    <header className="page-header">
      <div>
        <p className="panel-kicker">RRHH</p>
        <h1 className="page-title">Vacaciones y horas</h1>
        <p className="page-subtitle">Devengo y disfrute de vacaciones, y bolsa de horas por trabajador.</p>
      </div>
    </header>
  );
}

// ─── Vacaciones ────────────────────────────────────────────────────────────

interface FilaVacaciones {
  trabajador: RrhhTrabajadorRow;
  devengados: number;
  disfrutados: number;
  saldo: number;
  diasAnuales: number;
  estado: "ok" | "bajo" | "negativo";
  periodosAnio: RrhhVacacionesPeriodoRow[];
}

function VacacionesTab({
  rrhh, anio, setAnio, anios, anioActual,
}: {
  rrhh: ReturnType<typeof useRrhhVacaciones>;
  anio: number;
  setAnio: (a: number) => void;
  anios: number[];
  anioActual: number;
}) {
  const hasta = anio === anioActual ? hoyISO() : `${anio}-12-31`;
  const [expandido, setExpandido] = useState<string | null>(null);

  const filas = useMemo<FilaVacaciones[]>(() => {
    return rrhh.trabajadores
      .map((t) => {
        const periodosTrabajador = rrhh.periodos.filter((p) => p.trabajador_id === t.id);
        const devengados = diasDevengados({
          fechaAlta: t.fecha_alta,
          hasta,
          diasAnuales: t.vacaciones_dias_anuales ?? 30,
        });
        const disfrutados = diasDisfrutadosEnAnio(periodosTrabajador, anio);
        const saldo = devengados - disfrutados;
        const estado: FilaVacaciones["estado"] = saldo < 0 ? "negativo" : saldo <= 2 ? "bajo" : "ok";
        const periodosAnio = periodosTrabajador
          .filter((p) => p.fecha_inicio.slice(0, 4) === String(anio) || p.fecha_fin.slice(0, 4) === String(anio))
          .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));
        return {
          trabajador: t,
          devengados,
          disfrutados,
          saldo,
          diasAnuales: t.vacaciones_dias_anuales ?? 30,
          estado,
          periodosAnio,
        };
      })
      // los más ajustados o excedidos primero: lo que más necesita atención se ve antes.
      .sort((a, b) => a.saldo - b.saldo);
  }, [rrhh.trabajadores, rrhh.periodos, hasta, anio]);

  const resumen = useMemo(() => {
    let ok = 0, bajo = 0, negativo = 0;
    for (const f of filas) {
      if (f.estado === "negativo") negativo++;
      else if (f.estado === "bajo") bajo++;
      else ok++;
    }
    return { ok, bajo, negativo };
  }, [filas]);

  return (
    <div className="space-y-4">
      <div className="section-toolbar flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Año</Label>
          <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
            <SelectTrigger className="h-9 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {anios.map((a) => (
                <SelectItem key={a} value={String(a)}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {anio === anioActual ? `Devengado a hoy (${formatDate(hoyISO())})` : `Devengado a 31/12/${anio}`}
          </span>
        </div>
        <RegistrarPeriodoDialog rrhh={rrhh} />
      </div>

      {!rrhh.isLoading && filas.length > 0 && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KPICard
            className="glass-accented"
            label="Con saldo disponible"
            value={formatNumber(resumen.ok)}
            hint="más de 2 días de margen"
            icon={CheckCircle2}
            accent="success"
          />
          <KPICard
            className="glass-accented"
            label="Cerca de agotar"
            value={formatNumber(resumen.bajo)}
            hint="entre 0 y 2 días restantes"
            icon={AlertTriangle}
            accent={resumen.bajo > 0 ? "warning" : "primary"}
          />
          <KPICard
            className="glass-accented"
            label="Saldo excedido"
            value={formatNumber(resumen.negativo)}
            hint="han disfrutado de más días de los devengados"
            icon={XCircle}
            accent={resumen.negativo > 0 ? "destructive" : "primary"}
          />
        </section>
      )}

      {rrhh.isLoading ? (
        <Card className="glass-accented">
          <CardContent className="p-10 text-center text-sm text-muted-foreground">Cargando…</CardContent>
        </Card>
      ) : filas.length === 0 ? (
        <Card className="glass-accented overflow-hidden">
          <CardContent className="p-0">
            <EmptyState icon={CalendarDays} text="No hay trabajadores activos registrados." />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filas.map((f) => (
            <TrabajadorVacacionesCard
              key={f.trabajador.id}
              fila={f}
              rrhh={rrhh}
              expandido={expandido === f.trabajador.id}
              onToggleExpand={() => setExpandido((prev) => (prev === f.trabajador.id ? null : f.trabajador.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const ESTADO_TEXT_CLASS: Record<FilaVacaciones["estado"], string> = {
  ok: "text-success",
  bajo: "text-warning",
  negativo: "text-destructive",
};

const ESTADO_BAR_CLASS: Record<FilaVacaciones["estado"], string> = {
  ok: "bg-success",
  bajo: "bg-warning",
  negativo: "bg-destructive",
};

function TrabajadorVacacionesCard({
  fila, rrhh, expandido, onToggleExpand,
}: {
  fila: FilaVacaciones;
  rrhh: ReturnType<typeof useRrhhVacaciones>;
  expandido: boolean;
  onToggleExpand: () => void;
}) {
  const { trabajador, devengados, disfrutados, saldo, diasAnuales, estado, periodosAnio } = fila;
  const base = devengados > 0 ? devengados : diasAnuales;
  const ratio = base > 0 ? disfrutados / base : 0;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const barWidth = disfrutados > 0 ? Math.max(pct, 3) : 0;

  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{trabajador.nombre}</p>
            <p className="text-[11px] text-muted-foreground">{diasAnuales} días naturales/año</p>
          </div>
          {estado === "negativo" && (
            <Badge variant="outline" className="shrink-0 border-destructive/40 bg-destructive/10 text-[10px] text-destructive">
              Excedido
            </Badge>
          )}
          {estado === "bajo" && (
            <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/10 text-[10px] text-warning">
              Casi agotado
            </Badge>
          )}
        </div>

        <div>
          <p className="panel-kicker">Saldo restante</p>
          <p className={cn("text-3xl font-semibold tabular-nums leading-tight", ESTADO_TEXT_CLASS[estado])}>
            {formatNumber(saldo, 1)}
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
            <div
              className={cn("h-full rounded-full transition-all", ESTADO_BAR_CLASS[estado])}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{formatNumber(disfrutados, 0)} disfrutados</span>
            <span>{formatNumber(devengados, 1)} devengados</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleExpand}
          className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expandido && "rotate-90")} />
          {periodosAnio.length} periodo{periodosAnio.length !== 1 ? "s" : ""} este año
        </button>

        {expandido && (
          periodosAnio.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--glass-border)] px-3 py-2 text-xs text-muted-foreground">
              Sin periodos registrados este año.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)] rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)]">
              {periodosAnio.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="tabular-nums">
                      {formatDate(p.fecha_inicio)} → {formatDate(p.fecha_fin)} · {p.dias_naturales} d.
                    </p>
                    {p.notas && <p className="truncate text-muted-foreground">{p.notas}</p>}
                  </div>
                  <BorrarPeriodoDialog rrhh={rrhh} periodo={p} />
                </li>
              ))}
            </ul>
          )
        )}
      </CardContent>
    </Card>
  );
}

function RegistrarPeriodoDialog({ rrhh }: { rrhh: ReturnType<typeof useRrhhVacaciones> }) {
  const anioActual = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [trabajadorId, setTrabajadorId] = useState<string>("");
  const [fechaInicio, setFechaInicio] = useState(hoyISO());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [notas, setNotas] = useState("");

  const diasNaturales = useMemo(() => {
    if (!fechaInicio || !fechaFin || fechaFin < fechaInicio) return 0;
    return diasNaturalesPeriodo(fechaInicio, fechaFin);
  }, [fechaInicio, fechaFin]);

  const trabajadorSeleccionado = useMemo(
    () => rrhh.trabajadores.find((t) => t.id === trabajadorId) ?? null,
    [rrhh.trabajadores, trabajadorId],
  );

  const resumenConsumo = useMemo(() => {
    if (!trabajadorSeleccionado || diasNaturales <= 0 || !fechaInicio) return null;
    const anioPeriodo = Number(fechaInicio.slice(0, 4));
    const hastaDevengo = anioPeriodo === anioActual ? hoyISO() : `${anioPeriodo}-12-31`;
    const devengados = diasDevengados({
      fechaAlta: trabajadorSeleccionado.fecha_alta,
      hasta: hastaDevengo,
      diasAnuales: trabajadorSeleccionado.vacaciones_dias_anuales ?? 30,
    });
    const periodosPrevios = rrhh.periodos.filter((p) => p.trabajador_id === trabajadorId);
    const disfrutadosPrevios = diasDisfrutadosEnAnio(periodosPrevios, anioPeriodo);
    const restante = devengados - disfrutadosPrevios - diasNaturales;
    return { restante, devengados };
  }, [trabajadorSeleccionado, trabajadorId, fechaInicio, diasNaturales, rrhh.periodos, anioActual]);

  function resetForm() {
    setTrabajadorId("");
    setFechaInicio(hoyISO());
    setFechaFin(hoyISO());
    setNotas("");
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm();
    setOpen(next);
  }

  async function handleSubmit() {
    if (!trabajadorId) {
      toast({ title: "Selecciona un trabajador", variant: "destructive" });
      return;
    }
    if (!fechaInicio || !fechaFin || fechaFin < fechaInicio) {
      toast({ title: "Rango de fechas no válido", description: "La fecha de fin debe ser posterior o igual a la de inicio.", variant: "destructive" });
      return;
    }
    try {
      await rrhh.crearPeriodo.mutateAsync({
        trabajador_id: trabajadorId,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        dias_naturales: diasNaturales,
        notas: notas.trim() || null,
      });
      toast({ title: "Periodo registrado", description: `${diasNaturales} día(s) natural(es).` });
      setOpen(false);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Registrar periodo
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-accented sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-primary" /> Registrar periodo de vacaciones
          </DialogTitle>
          <DialogDescription>Selecciona la persona y el rango de fechas disfrutado.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Trabajador</Label>
            <Select value={trabajadorId} onValueChange={setTrabajadorId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un trabajador" />
              </SelectTrigger>
              <SelectContent>
                {rrhh.trabajadores.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Fecha inicio</Label>
              <GlassDatePicker value={fechaInicio} onChange={setFechaInicio} className="w-full" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Fecha fin</Label>
              <GlassDatePicker value={fechaFin} onChange={setFechaFin} className="w-full" />
            </div>
          </div>

          <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-sm">
            <span className="text-muted-foreground">Días naturales: </span>
            <span className="font-semibold tabular-nums">{diasNaturales}</span>
            {resumenConsumo && (
              <p className={cn("mt-1 text-xs", resumenConsumo.restante < 0 ? "text-destructive" : "text-muted-foreground")}>
                {resumenConsumo.restante < 0
                  ? `Se pasará ${formatNumber(Math.abs(resumenConsumo.restante), 1)} día(s) del devengo (${formatNumber(resumenConsumo.devengados, 1)}).`
                  : `Le quedarán ${formatNumber(resumenConsumo.restante, 1)} de ${formatNumber(resumenConsumo.devengados, 1)} devengados.`}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notas (opcional)</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Observaciones…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={rrhh.crearPeriodo.isPending}>
            {rrhh.crearPeriodo.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BorrarPeriodoDialog({ rrhh, periodo }: { rrhh: ReturnType<typeof useRrhhVacaciones>; periodo: RrhhVacacionesPeriodoRow }) {
  async function handleDelete() {
    try {
      await rrhh.borrarPeriodo.mutateAsync(periodo.id);
      toast({ title: "Periodo eliminado" });
    } catch (error) {
      toast({ title: "Error al eliminar", description: errorMessage(error), variant: "destructive" });
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar periodo?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminará el periodo del {formatDate(periodo.fecha_inicio)} al {formatDate(periodo.fecha_fin)}. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Bolsa de horas ──────────────────────────────────────────────────────────

interface SaldoHoras {
  trabajador: RrhhTrabajadorRow;
  total: number;
  totalPositivo: number;
  totalNegativo: number;
}

function HorasTab({ rrhh }: { rrhh: ReturnType<typeof useRrhhVacaciones> }) {
  const saldos = useMemo<SaldoHoras[]>(() => {
    return rrhh.trabajadores
      .map((t) => {
        const horasTrabajador = rrhh.horas.filter((h) => h.trabajador_id === t.id);
        const totalPositivo = horasTrabajador
          .filter((h) => Number(h.horas) > 0)
          .reduce((sum, h) => sum + Number(h.horas), 0);
        const totalNegativo = horasTrabajador
          .filter((h) => Number(h.horas) < 0)
          .reduce((sum, h) => sum + Number(h.horas), 0);
        return { trabajador: t, total: totalPositivo + totalNegativo, totalPositivo, totalNegativo };
      })
      // quien más debe (saldo más negativo) primero, para que llame la atención.
      .sort((a, b) => a.total - b.total);
  }, [rrhh.trabajadores, rrhh.horas]);

  const resumen = useMemo(() => {
    const totalGeneral = saldos.reduce((sum, s) => sum + s.total, 0);
    const enNegativo = saldos.filter((s) => s.total < 0).length;
    const enPositivo = saldos.filter((s) => s.total > 0).length;
    return { totalGeneral, enNegativo, enPositivo };
  }, [saldos]);

  const trabajadorNombre = (id: string) => rrhh.trabajadores.find((t) => t.id === id)?.nombre ?? "—";
  const historialReciente = useMemo(
    () => [...rrhh.horas].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 30),
    [rrhh.horas],
  );

  return (
    <div className="space-y-4">
      <div className="section-toolbar flex items-center justify-end">
        <ApuntarHorasDialog rrhh={rrhh} />
      </div>

      {!rrhh.isLoading && saldos.length > 0 && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KPICard
            className="glass-accented"
            label="Saldo global de la bolsa"
            value={`${resumen.totalGeneral > 0 ? "+" : ""}${formatNumber(resumen.totalGeneral, 1)} h`}
            icon={Clock}
            accent={resumen.totalGeneral < 0 ? "destructive" : resumen.totalGeneral > 0 ? "success" : "primary"}
          />
          <KPICard
            className="glass-accented"
            label="Deben horas"
            value={formatNumber(resumen.enNegativo)}
            hint="saldo negativo"
            icon={TrendingDown}
            accent={resumen.enNegativo > 0 ? "destructive" : "primary"}
          />
          <KPICard
            className="glass-accented"
            label="Acumulan horas"
            value={formatNumber(resumen.enPositivo)}
            hint="saldo a favor"
            icon={TrendingUp}
            accent="success"
          />
        </section>
      )}

      {rrhh.isLoading ? (
        <Card className="glass-accented">
          <CardContent className="p-10 text-center text-sm text-muted-foreground">Cargando…</CardContent>
        </Card>
      ) : saldos.length === 0 ? (
        <Card className="glass-accented overflow-hidden">
          <CardContent className="p-0">
            <EmptyState icon={Clock} text="No hay trabajadores activos registrados." />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {saldos.map((s) => (
            <TrabajadorHorasCard key={s.trabajador.id} saldo={s} />
          ))}
        </div>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Historial reciente</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {historialReciente.length === 0 ? (
            <EmptyState icon={Clock} text="Todavía no se han apuntado horas." />
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {historialReciente.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{trabajadorNombre(h.trabajador_id)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(h.fecha)}{h.motivo ? ` · ${h.motivo}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn(
                      "tabular-nums text-sm font-semibold",
                      h.horas < 0 ? "text-destructive" : "text-success",
                    )}>
                      {h.horas > 0 ? "+" : ""}{formatNumber(h.horas, 1)} h
                    </span>
                    <BorrarHorasDialog rrhh={rrhh} hora={h} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TrabajadorHorasCard({ saldo }: { saldo: SaldoHoras }) {
  const { trabajador, total, totalPositivo, totalNegativo } = saldo;
  const colorClass = total < 0 ? "text-destructive" : total > 0 ? "text-success" : "text-muted-foreground";

  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate font-semibold">{trabajador.nombre}</p>
          {total < 0 && (
            <Badge variant="outline" className="shrink-0 border-destructive/40 bg-destructive/10 text-[10px] text-destructive">
              Debe horas
            </Badge>
          )}
        </div>

        <div>
          <p className="panel-kicker">Saldo acumulado</p>
          <p className={cn("text-3xl font-semibold tabular-nums leading-tight", colorClass)}>
            {total > 0 ? "+" : ""}{formatNumber(total, 1)} h
          </p>
        </div>

        {(totalPositivo !== 0 || totalNegativo !== 0) && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1 text-success">
              <TrendingUp className="h-3 w-3" /> {formatNumber(totalPositivo, 1)}
            </span>
            <span className="flex items-center gap-1 text-destructive">
              <TrendingDown className="h-3 w-3" /> {formatNumber(Math.abs(totalNegativo), 1)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApuntarHorasDialog({ rrhh }: { rrhh: ReturnType<typeof useRrhhVacaciones> }) {
  const [open, setOpen] = useState(false);
  const [trabajadorId, setTrabajadorId] = useState<string>("");
  const [fecha, setFecha] = useState(hoyISO());
  const [signo, setSigno] = useState<"+" | "-">("+");
  const [horasAbs, setHorasAbs] = useState<string>("");
  const [motivo, setMotivo] = useState("");

  const horasAbsNum = Number(horasAbs.replace(",", "."));
  const previewValido = horasAbs !== "" && Number.isFinite(horasAbsNum) && horasAbsNum > 0;

  function resetForm() {
    setTrabajadorId("");
    setFecha(hoyISO());
    setSigno("+");
    setHorasAbs("");
    setMotivo("");
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm();
    setOpen(next);
  }

  async function handleSubmit() {
    if (!trabajadorId) {
      toast({ title: "Selecciona un trabajador", variant: "destructive" });
      return;
    }
    if (!fecha || !previewValido) {
      toast({ title: "Horas no válidas", description: "Indica un número de horas mayor que cero.", variant: "destructive" });
      return;
    }
    const horasNum = signo === "-" ? -horasAbsNum : horasAbsNum;
    try {
      await rrhh.registrarHoras.mutateAsync({
        trabajador_id: trabajadorId,
        fecha,
        horas: horasNum,
        motivo: motivo.trim() || null,
      });
      toast({ title: "Horas registradas", description: `${signo}${formatNumber(horasAbsNum, 1)} h` });
      setOpen(false);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Apuntar horas
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-accented sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" /> Apuntar horas
          </DialogTitle>
          <DialogDescription>Suma horas a favor del trabajador o resta horas que debe recuperar.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Trabajador</Label>
            <Select value={trabajadorId} onValueChange={setTrabajadorId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un trabajador" />
              </SelectTrigger>
              <SelectContent>
                {rrhh.trabajadores.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Fecha</Label>
            <GlassDatePicker value={fecha} onChange={setFecha} className="w-full" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Horas</Label>
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 rounded-lg border border-[var(--glass-border)] p-0.5">
                <button
                  type="button"
                  onClick={() => setSigno("+")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    signo === "+" ? "bg-success/15 text-success" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Plus className="h-3.5 w-3.5" /> Sumar
                </button>
                <button
                  type="button"
                  onClick={() => setSigno("-")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    signo === "-" ? "bg-destructive/15 text-destructive" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Minus className="h-3.5 w-3.5" /> Restar
                </button>
              </div>
              <Input
                type="text"
                inputMode="decimal"
                value={horasAbs}
                onChange={(e) => setHorasAbs(e.target.value)}
                placeholder="p. ej. 2,5"
                className="flex-1"
              />
            </div>
            {previewValido && (
              <p className={cn("text-xs font-semibold tabular-nums", signo === "-" ? "text-destructive" : "text-success")}>
                {signo === "-" ? "-" : "+"}{formatNumber(horasAbsNum, 1)} h
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Motivo (opcional)</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Horas extra, permiso, recuperación…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={rrhh.registrarHoras.isPending}>
            {rrhh.registrarHoras.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BorrarHorasDialog({ rrhh, hora }: { rrhh: ReturnType<typeof useRrhhVacaciones>; hora: RrhhHoraRow }) {
  async function handleDelete() {
    try {
      await rrhh.borrarHoras.mutateAsync(hora.id);
      toast({ title: "Registro eliminado" });
    } catch (error) {
      toast({ title: "Error al eliminar", description: errorMessage(error), variant: "destructive" });
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar registro?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminará el registro de {formatNumber(hora.horas, 1)} h del {formatDate(hora.fecha)}. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Compartidos ─────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, text }: { icon: typeof CalendarDays; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/50" />
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
