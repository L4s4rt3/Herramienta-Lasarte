// src/pages/LimpiezaBox.tsx
// Limpieza de box: partes diarios del grupo de limpieza de boxes.
//
// Cada parte registra fecha + turno (hasta 2 por día), los box limpiados (el
// dato de campo llega en PIES o en BOX; 48 pies = 144 box, ver
// src/lib/limpiezaBox.ts), escaleras los días que también se limpian, los
// trabajadores con sus horas y observaciones. El listado agrupa por día, como
// la vista "Entradas por día" de EntradasBascula.tsx.
import { useMemo, useState } from "react";
import {
  AlertTriangle, Brush, CalendarDays, ChevronDown, Clock, Footprints, Loader2, Package, Pencil, Plus, Trash2, Users, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { KPICard } from "@/components/KPICard";
import { SelectorPeriodo } from "@/components/SelectorPeriodo";
import { toast } from "@/hooks/use-toast";
import { useAsistenciaTrabajadores } from "@/hooks/useAsistencia";
import {
  useLimpiezaBox,
  type LimpiezaParteConTrabajadores,
  type LimpiezaParteInput,
} from "@/hooks/useLimpiezaBox";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatNumber, today } from "@/lib/format";
import { addDays, getWeekStart, toIsoDate } from "@/lib/isoWeek";
import { PIES_A_BOX, piesABox, resumenLimpiezaEnRango, sumaHoras } from "@/lib/limpiezaBox";
import { cn } from "@/lib/utils";

/** Sentinela del Select de trabajador para "nombre libre" (Radix no admite value=""). */
const TRABAJADOR_LIBRE = "__libre__";

interface FilaTrabajador {
  /** Clave estable de la fila en el formulario (no es el id de BD). */
  key: number;
  /** id de plantilla, o TRABAJADOR_LIBRE para nombre escrito a mano. */
  trabajadorId: string;
  nombre: string;
  horas: string;
}

let filaKeySeq = 0;
const nuevaFila = (): FilaTrabajador => ({ key: ++filaKeySeq, trabajadorId: TRABAJADOR_LIBRE, nombre: "", horas: "" });

const fmtHoras = (h: number) => `${formatNumber(h, Number.isInteger(h) ? 0 : 1)} h`;

export default function LimpiezaBox() {
  const { partes, tablaPendiente, isLoading, error, crearParte, editarParte, eliminarParte } = useLimpiezaBox();
  const { trabajadores: plantilla } = useAsistenciaTrabajadores();

  // ─── Estado del formulario (alta y edición comparten el mismo) ──────────
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [fecha, setFecha] = useState<string>(today());
  const [turno, setTurno] = useState<1 | 2>(1);
  const [unidad, setUnidad] = useState<"pies" | "box">("pies");
  const [cantidad, setCantidad] = useState("");
  const [escaleras, setEscaleras] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [filas, setFilas] = useState<FilaTrabajador[]>([nuevaFila()]);

  const guardando = crearParte.isPending || editarParte.isPending;

  const cantidadNum = Number(cantidad.replace(",", "."));
  const boxCalculados = !Number.isFinite(cantidadNum) || cantidadNum <= 0
    ? 0
    : unidad === "pies" ? piesABox(cantidadNum) : Math.round(cantidadNum);

  /** Parte ya existente para la fecha+turno elegidos (el UNIQUE de BD lo protege detrás). */
  const parteExistente = useMemo(
    () => partes.find((p) => p.fecha === fecha && p.turno === turno && p.id !== editandoId) ?? null,
    [partes, fecha, turno, editandoId],
  );

  const limpiarFormulario = () => {
    setEditandoId(null);
    setFecha(today());
    setTurno(1);
    setUnidad("pies");
    setCantidad("");
    setEscaleras("");
    setObservaciones("");
    setFilas([nuevaFila()]);
  };

  const cargarParteEnFormulario = (parte: LimpiezaParteConTrabajadores) => {
    setEditandoId(parte.id);
    setFecha(parte.fecha);
    setTurno(parte.turno);
    setUnidad(parte.unidad);
    setCantidad(parte.unidad === "pies" ? String(parte.pies ?? "") : String(parte.box));
    setEscaleras(parte.escaleras == null ? "" : String(parte.escaleras));
    setObservaciones(parte.observaciones ?? "");
    setFilas(
      parte.trabajadores.length > 0
        ? parte.trabajadores.map((t) => ({
            key: ++filaKeySeq,
            trabajadorId: t.trabajador_id ?? TRABAJADOR_LIBRE,
            nombre: t.nombre,
            horas: String(t.horas),
          }))
        : [nuevaFila()],
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const actualizarFila = (key: number, cambios: Partial<FilaTrabajador>) => {
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, ...cambios } : f)));
  };

  const seleccionarTrabajador = (key: number, valor: string) => {
    if (valor === TRABAJADOR_LIBRE) {
      actualizarFila(key, { trabajadorId: TRABAJADOR_LIBRE, nombre: "" });
      return;
    }
    const t = plantilla.find((p) => p.id === valor);
    actualizarFila(key, { trabajadorId: valor, nombre: t?.nombre ?? "" });
  };

  const guardar = () => {
    if (!fecha) {
      toast({ title: "Falta la fecha", variant: "destructive" });
      return;
    }
    if (parteExistente) {
      toast({
        title: `Ya hay un parte del turno ${turno} para ese día`,
        description: "Edítalo desde el aviso del formulario o desde el listado.",
        variant: "destructive",
      });
      return;
    }
    if (boxCalculados <= 0) {
      toast({ title: "Indica los box limpiados", description: unidad === "pies" ? "El dato en pies debe ser mayor que 0." : "El dato en box debe ser mayor que 0.", variant: "destructive" });
      return;
    }
    const trabajadoresValidos = filas
      .map((f) => ({ trabajadorId: f.trabajadorId === TRABAJADOR_LIBRE ? null : f.trabajadorId, nombre: f.nombre.trim(), horas: Number(f.horas.replace(",", ".")) }))
      .filter((f) => f.nombre !== "");
    if (trabajadoresValidos.length === 0) {
      toast({ title: "Añade al menos un trabajador", description: "Elige de la plantilla o escribe un nombre libre.", variant: "destructive" });
      return;
    }
    const horasInvalidas = trabajadoresValidos.find((t) => !Number.isFinite(t.horas) || t.horas < 0 || t.horas > 24);
    if (horasInvalidas) {
      toast({ title: "Revisa las horas", description: `Las horas de ${horasInvalidas.nombre} deben estar entre 0 y 24.`, variant: "destructive" });
      return;
    }

    const escalerasNum = escaleras.trim() === "" ? null : Math.round(Number(escaleras));
    if (escalerasNum != null && (!Number.isFinite(escalerasNum) || escalerasNum < 0)) {
      toast({ title: "Revisa las escaleras", description: "Debe ser un número entero mayor o igual que 0.", variant: "destructive" });
      return;
    }

    const input: LimpiezaParteInput = {
      fecha,
      turno,
      unidad,
      pies: unidad === "pies" ? cantidadNum : null,
      box: boxCalculados,
      escaleras: escalerasNum,
      observaciones: observaciones.trim() === "" ? null : observaciones.trim(),
      trabajadores: trabajadoresValidos,
    };

    const opciones = {
      onSuccess: () => {
        toast({
          title: editandoId ? "Parte actualizado" : "Parte guardado",
          description: `${formatDate(fecha)} · turno ${turno} · ${formatNumber(boxCalculados)} box`,
        });
        limpiarFormulario();
      },
      onError: (e: unknown) => toast({ title: "Error al guardar", description: errorMessage(e), variant: "destructive" }),
    };
    if (editandoId) editarParte.mutate({ id: editandoId, ...input }, opciones);
    else crearParte.mutate(input, opciones);
  };

  const borrarParte = (parte: LimpiezaParteConTrabajadores) => {
    const ok = window.confirm(`¿Borrar el parte del ${formatDate(parte.fecha)} (turno ${parte.turno})? Se eliminarán también sus trabajadores.`);
    if (!ok) return;
    eliminarParte.mutate(parte.id, {
      onSuccess: () => {
        toast({ title: "Parte borrado", description: `${formatDate(parte.fecha)} · turno ${parte.turno}` });
        if (editandoId === parte.id) limpiarFormulario();
      },
      onError: (e) => toast({ title: "Error al borrar", description: errorMessage(e), variant: "destructive" }),
    });
  };

  // ─── KPIs ────────────────────────────────────────────────────────────────
  const resumenes = useMemo(
    () => partes.map((p) => ({ fecha: p.fecha, box: Number(p.box) || 0, horas: sumaHoras(p.trabajadores) })),
    [partes],
  );
  const hoy = today();
  const semanaDesde = toIsoDate(getWeekStart(new Date()));
  const semanaHasta = toIsoDate(addDays(getWeekStart(new Date()), 6));
  const resumenSemana = useMemo(() => resumenLimpiezaEnRango(resumenes, semanaDesde, semanaHasta), [resumenes, semanaDesde, semanaHasta]);
  const resumenHoy = useMemo(() => resumenLimpiezaEnRango(resumenes, hoy, hoy), [resumenes, hoy]);
  const resumenTotal = useMemo(() => resumenLimpiezaEnRango(resumenes), [resumenes]);

  // ─── Partes agrupados por día (más reciente primero) ─────────────────────
  const partesPorDia = useMemo(() => {
    const map = new Map<string, LimpiezaParteConTrabajadores[]>();
    for (const p of partes) {
      const arr = map.get(p.fecha) ?? [];
      arr.push(p);
      map.set(p.fecha, arr);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dia, partesDia]) => ({
        dia,
        // Turno 1 antes que turno 2 dentro del día.
        partesDia: [...partesDia].sort((a, b) => a.turno - b.turno),
        boxDia: partesDia.reduce((s, p) => s + (Number(p.box) || 0), 0),
        horasDia: partesDia.reduce((s, p) => s + sumaHoras(p.trabajadores), 0),
      }));
  }, [partes]);

  const hayPartes = partes.length > 0;

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1 className="page-title">Limpieza de box</h1>
        <p className="page-subtitle">
          Partes diarios del grupo de limpieza: box limpiados (en pies o en box), escaleras, trabajadores y horas.
        </p>
      </header>

      {/* ─── Migración pendiente ─────────────────────────────────────────── */}
      {tablaPendiente && (
        <Card className="glass-accented border-warning/30">
          <CardContent className="flex items-center gap-3 py-5 text-warning">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">
              Sección pendiente de activar: falta aplicar la migración 20260714120000_limpieza_box.sql en la base de datos.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ─── KPIs ────────────────────────────────────────────────────────── */}
      {!isLoading && !error && hayPartes && (
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KPICard
            className="glass-accented"
            label="Box esta semana"
            value={formatNumber(resumenSemana.box)}
            hint={`${resumenSemana.partes} parte${resumenSemana.partes === 1 ? "" : "s"} (lun-dom)`}
            icon={Package}
          />
          <KPICard
            className="glass-accented"
            label="Horas esta semana"
            value={fmtHoras(resumenSemana.horas)}
            hint="Suma de todos los trabajadores"
            icon={Clock}
          />
          <KPICard
            className="glass-accented"
            label="Box hoy"
            value={formatNumber(resumenHoy.box)}
            hint={resumenHoy.partes > 0 ? `${resumenHoy.partes} turno${resumenHoy.partes === 1 ? "" : "s"} registrado${resumenHoy.partes === 1 ? "" : "s"}` : "Sin parte todavía"}
            icon={Brush}
          />
          <KPICard
            className="glass-accented"
            label="Media box/hora"
            value={resumenTotal.boxPorHora == null ? "—" : formatNumber(resumenTotal.boxPorHora, 1)}
            hint="De todos los partes registrados"
            icon={Users}
            labelInfo="Box limpiados divididos entre las horas trabajadas de todos los partes visibles. Sirve de referencia del ritmo del grupo."
          />
        </section>
      )}

      {/* ─── Formulario de parte (alta / edición) ─────────────────────────── */}
      <Card className="glass-accented">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="panel-kicker">{editandoId ? "Editando parte" : "Nuevo parte"}</p>
              <CardTitle className="text-base">
                {editandoId ? `Parte del ${formatDate(fecha)} · turno ${turno}` : "Registrar limpieza del día"}
              </CardTitle>
            </div>
            {editandoId && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={limpiarFormulario} disabled={guardando}>
                <X className="h-3.5 w-3.5" /> Cancelar edición
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            {/* Fecha */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Fecha</p>
              <SelectorPeriodo
                bare
                value={{ modo: "dia", desde: fecha, hasta: fecha }}
                onChange={(next) => setFecha(next.desde)}
                disabled={guardando}
              />
            </div>
            {/* Turno */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Turno</p>
              <div className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0.5">
                {([1, 2] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={guardando}
                    onClick={() => setTurno(t)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      turno === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Turno {t}
                  </button>
                ))}
              </div>
            </div>
            {/* Unidad + cantidad con equivalencia en vivo */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Box limpiados</p>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0.5">
                  {(["pies", "box"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      disabled={guardando}
                      onClick={() => setUnidad(u)}
                      className={cn(
                        "rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors",
                        unidad === u ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {u === "pies" ? "Pies" : "Box"}
                    </button>
                  ))}
                </div>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder={unidad === "pies" ? "48" : "144"}
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  disabled={guardando}
                  className="h-9 w-28"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                48 pies = 144 box (1 pie = {PIES_A_BOX} box)
                {unidad === "pies" && boxCalculados > 0 && (
                  <> · <span className="font-semibold text-primary">= {formatNumber(boxCalculados)} box</span></>
                )}
              </p>
            </div>
            {/* Escaleras */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Escaleras</p>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="—"
                value={escaleras}
                onChange={(e) => setEscaleras(e.target.value)}
                disabled={guardando}
                className="h-9 w-24"
              />
              <p className="text-[11px] text-muted-foreground">Solo los días que también se limpian</p>
            </div>
          </div>

          {/* Aviso de parte duplicado para fecha+turno */}
          {parteExistente && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Ya hay un parte del <span className="font-semibold">turno {turno}</span> para el {formatDate(fecha)}
                {" "}({formatNumber(Number(parteExistente.box) || 0)} box).
              </span>
              <Button
                size="sm"
                variant="outline"
                className="glass glass-hover h-7 border-warning/40 text-warning hover:text-warning"
                onClick={() => cargarParteEnFormulario(parteExistente)}
              >
                <Pencil className="h-3.5 w-3.5" /> Editarlo
              </Button>
            </div>
          )}

          {/* Trabajadores */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Trabajadores y horas</p>
            {filas.map((fila) => (
              <div key={fila.key} className="flex flex-wrap items-center gap-2">
                <Select value={fila.trabajadorId} onValueChange={(v) => seleccionarTrabajador(fila.key, v)} disabled={guardando}>
                  <SelectTrigger className="h-9 w-full sm:w-64">
                    <SelectValue placeholder="Elegir trabajador" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TRABAJADOR_LIBRE}>Nombre libre (fuera de plantilla)</SelectItem>
                    {plantilla.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nombre}{t.activo ? "" : " (inactivo)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fila.trabajadorId === TRABAJADOR_LIBRE && (
                  <Input
                    placeholder="Nombre del trabajador"
                    value={fila.nombre}
                    onChange={(e) => actualizarFila(fila.key, { nombre: e.target.value })}
                    disabled={guardando}
                    className="h-9 w-full sm:w-56"
                  />
                )}
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={24}
                    step={0.5}
                    placeholder="Horas"
                    value={fila.horas}
                    onChange={(e) => actualizarFila(fila.key, { horas: e.target.value })}
                    disabled={guardando}
                    className="h-9 w-24"
                  />
                  <span className="text-xs text-muted-foreground">h</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  title="Quitar esta fila"
                  disabled={guardando || filas.length === 1}
                  onClick={() => setFilas((prev) => prev.filter((f) => f.key !== fila.key))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="glass glass-hover"
              disabled={guardando}
              onClick={() => setFilas((prev) => [...prev, nuevaFila()])}
            >
              <Plus className="h-3.5 w-3.5" /> Añadir trabajador
            </Button>
          </div>

          {/* Observaciones */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Observaciones</p>
            <Textarea
              placeholder="Incidencias, zonas pendientes, material..."
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              disabled={guardando}
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={guardar} disabled={guardando || tablaPendiente || Boolean(parteExistente)}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brush className="h-4 w-4" />}
              {editandoId ? "Guardar cambios" : "Guardar parte"}
            </Button>
            {tablaPendiente && (
              <span className="text-xs text-muted-foreground">Pendiente de aplicar la migración en la base de datos.</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Listado por días ─────────────────────────────────────────────── */}
      {isLoading ? (
        <>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </>
      ) : error ? (
        <Card className="glass-accented border-destructive/30">
          <CardContent className="flex items-center gap-3 py-6 text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">{errorMessage(error)}</p>
          </CardContent>
        </Card>
      ) : !hayPartes ? (
        !tablaPendiente && (
          <Card className="glass-accented">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <Brush className="h-10 w-10 text-muted-foreground/30" />
              <div>
                <p className="font-semibold">Todavía no hay partes de limpieza</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Registra arriba el primer parte del grupo de limpieza: fecha, turno, box limpiados (en pies o en box)
                  y los trabajadores con sus horas.
                </p>
              </div>
            </CardContent>
          </Card>
        )
      ) : (
        <section className="space-y-2">
          {partesPorDia.map(({ dia, partesDia, boxDia, horasDia }, index) => (
            <Collapsible key={dia} defaultOpen={index === 0}>
              <div className="overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                <CollapsibleTrigger className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--glass-bg-strong)]">
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="shrink-0 text-sm font-semibold capitalize">
                    {new Date(`${dia}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" })}
                  </span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {partesDia.length} turno{partesDia.length === 1 ? "" : "s"} · {formatNumber(boxDia)} box · {fmtHoras(horasDia)}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="divide-y divide-[var(--glass-border)] border-t border-[var(--glass-border)]">
                    {partesDia.map((parte) => (
                      <div key={parte.id} className="space-y-1.5 px-3 py-2.5 transition-colors hover:bg-[var(--glass-bg-strong)]/50">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <Badge variant="outline" className="border-primary/40 bg-primary/10 px-1.5 py-0 text-[11px] text-primary">
                            Turno {parte.turno}
                          </Badge>
                          <span className="font-semibold tabular-nums">
                            {formatNumber(Number(parte.box) || 0)} box
                            {parte.unidad === "pies" && parte.pies != null && (
                              <span className="ml-1 font-normal text-muted-foreground">({formatNumber(Number(parte.pies), Number.isInteger(Number(parte.pies)) ? 0 : 1)} pies)</span>
                            )}
                          </span>
                          {parte.escaleras != null && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Footprints className="h-3.5 w-3.5" />
                              {formatNumber(parte.escaleras)} escalera{parte.escaleras === 1 ? "" : "s"}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            {fmtHoras(sumaHoras(parte.trabajadores))}
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-primary"
                              title="Editar este parte"
                              disabled={guardando || eliminarParte.isPending}
                              onClick={() => cargarParteEnFormulario(parte)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Borrar este parte"
                              disabled={eliminarParte.isPending}
                              onClick={() => borrarParte(parte)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {parte.trabajadores.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                            {parte.trabajadores.map((t) => (
                              <Badge key={t.id} variant="outline" className="border-[var(--glass-border)] bg-[var(--glass-bg)] px-1.5 py-0 text-[11px] font-normal">
                                {t.nombre} · {fmtHoras(Number(t.horas) || 0)}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {parte.observaciones && (
                          <p className="text-xs text-muted-foreground">{parte.observaciones}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
          <p className="text-xs text-muted-foreground">
            {partes.length} parte{partes.length === 1 ? "" : "s"} registrado{partes.length === 1 ? "" : "s"} ·{" "}
            {formatNumber(resumenTotal.box)} box limpiados en total · {fmtHoras(resumenTotal.horas)} trabajadas.
          </p>
        </section>
      )}
    </div>
  );
}
