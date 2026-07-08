// src/pages/RrhhVacaciones.tsx
// Seccion "Vacaciones y horas" de RRHH: devengo/disfrute de vacaciones por
// trabajador (rrhh_vacaciones_periodos) y bolsa de horas +/- (rrhh_horas).
import { useMemo, useState } from "react";
import {
  AlertTriangle, CalendarDays, CalendarPlus, Clock, Plus, ShieldAlert, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toast } from "@/hooks/use-toast";
import {
  useRrhhVacaciones, type RrhhHoraRow, type RrhhVacacionesPeriodoRow,
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

  const filas = useMemo(() => {
    return rrhh.trabajadores.map((t) => {
      const periodosTrabajador = rrhh.periodos.filter((p) => p.trabajador_id === t.id);
      const devengados = diasDevengados({
        fechaAlta: t.fecha_alta,
        hasta,
        diasAnuales: t.vacaciones_dias_anuales ?? 30,
      });
      const disfrutados = diasDisfrutadosEnAnio(periodosTrabajador, anio);
      return {
        trabajador: t,
        devengados,
        disfrutados,
        saldo: devengados - disfrutados,
        diasAnuales: t.vacaciones_dias_anuales ?? 30,
      };
    });
  }, [rrhh.trabajadores, rrhh.periodos, hasta, anio]);

  const periodosAnio = useMemo(
    () => rrhh.periodos
      .filter((p) => p.fecha_inicio.slice(0, 4) === String(anio) || p.fecha_fin.slice(0, 4) === String(anio))
      .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)),
    [rrhh.periodos, anio],
  );

  const trabajadorNombre = (id: string) => rrhh.trabajadores.find((t) => t.id === id)?.nombre ?? "—";

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
        </div>
        <RegistrarPeriodoDialog rrhh={rrhh} />
      </div>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Saldo de vacaciones por trabajador</CardTitle>
          <p className="text-xs text-muted-foreground">
            {anio === anioActual ? `Devengados a hoy (${formatDate(hoyISO())})` : `Devengados a 31/12/${anio}`}.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {rrhh.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <EmptyState icon={CalendarDays} text="No hay trabajadores activos registrados." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                  <tr>
                    <th className="text-left">Trabajador</th>
                    <th className="text-right">Devengados</th>
                    <th className="text-right">Disfrutados ({anio})</th>
                    <th className="text-right">Saldo</th>
                    <th className="text-right">Días/año convenio</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={f.trabajador.id} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                      <td className="px-3 py-1.5 font-medium">{f.trabajador.nombre}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(f.devengados, 1)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(f.disfrutados, 0)}</td>
                      <td className={cn(
                        "px-3 py-1.5 text-right tabular-nums font-semibold",
                        f.saldo < 0 ? "text-destructive" : "text-success",
                      )}>
                        {formatNumber(f.saldo, 1)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{f.diasAnuales}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Periodos de vacaciones · {anio}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {periodosAnio.length === 0 ? (
            <EmptyState icon={CalendarDays} text="No hay periodos registrados para este año." />
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {periodosAnio.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{trabajadorNombre(p.trabajador_id)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.fecha_inicio)} → {formatDate(p.fecha_fin)} · {p.dias_naturales} día(s)
                      {p.notas ? ` · ${p.notas}` : ""}
                    </p>
                  </div>
                  <BorrarPeriodoDialog rrhh={rrhh} periodo={p} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RegistrarPeriodoDialog({ rrhh }: { rrhh: ReturnType<typeof useRrhhVacaciones> }) {
  const [open, setOpen] = useState(false);
  const [trabajadorId, setTrabajadorId] = useState<string>("");
  const [fechaInicio, setFechaInicio] = useState(hoyISO());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [notas, setNotas] = useState("");

  const diasNaturales = useMemo(() => {
    if (!fechaInicio || !fechaFin || fechaFin < fechaInicio) return 0;
    return diasNaturalesPeriodo(fechaInicio, fechaFin);
  }, [fechaInicio, fechaFin]);

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

function HorasTab({ rrhh }: { rrhh: ReturnType<typeof useRrhhVacaciones> }) {
  const saldos = useMemo(() => {
    return rrhh.trabajadores.map((t) => {
      const total = rrhh.horas
        .filter((h) => h.trabajador_id === t.id)
        .reduce((sum, h) => sum + Number(h.horas || 0), 0);
      return { trabajador: t, total };
    });
  }, [rrhh.trabajadores, rrhh.horas]);

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

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Saldo acumulado por trabajador</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rrhh.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : saldos.length === 0 ? (
            <EmptyState icon={Clock} text="No hay trabajadores activos registrados." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                  <tr>
                    <th className="text-left">Trabajador</th>
                    <th className="text-right">Saldo (h)</th>
                  </tr>
                </thead>
                <tbody>
                  {saldos.map((s, i) => (
                    <tr key={s.trabajador.id} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                      <td className="px-3 py-1.5 font-medium">{s.trabajador.nombre}</td>
                      <td className={cn(
                        "px-3 py-1.5 text-right tabular-nums font-semibold",
                        s.total < 0 ? "text-destructive" : s.total > 0 ? "text-success" : "text-muted-foreground",
                      )}>
                        {s.total > 0 ? "+" : ""}{formatNumber(s.total, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

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

function ApuntarHorasDialog({ rrhh }: { rrhh: ReturnType<typeof useRrhhVacaciones> }) {
  const [open, setOpen] = useState(false);
  const [trabajadorId, setTrabajadorId] = useState<string>("");
  const [fecha, setFecha] = useState(hoyISO());
  const [horas, setHoras] = useState<string>("");
  const [motivo, setMotivo] = useState("");

  function resetForm() {
    setTrabajadorId("");
    setFecha(hoyISO());
    setHoras("");
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
    const horasNum = Number(horas.replace(",", "."));
    if (!fecha || !Number.isFinite(horasNum) || horasNum === 0) {
      toast({ title: "Horas no válidas", description: "Indica un número de horas distinto de cero (positivo o negativo).", variant: "destructive" });
      return;
    }
    try {
      await rrhh.registrarHoras.mutateAsync({
        trabajador_id: trabajadorId,
        fecha,
        horas: horasNum,
        motivo: motivo.trim() || null,
      });
      toast({ title: "Horas registradas" });
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
          <DialogDescription>Usa un valor positivo para horas a favor y negativo para horas de más disfrutadas.</DialogDescription>
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
              <Label className="text-xs font-medium">Fecha</Label>
              <GlassDatePicker value={fecha} onChange={setFecha} className="w-full" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Horas (+/-)</Label>
              <Input type="text" inputMode="decimal" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="p. ej. 2.5 o -3" />
            </div>
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
