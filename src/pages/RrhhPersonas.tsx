// src/pages/RrhhPersonas.tsx
// Sección "Plantilla" de RRHH: listado de trabajadores con datos de personal
// (categoría profesional, fecha de alta, antigüedad) + ficha individual de
// consulta (faltas, bajas, justificantes, amonestaciones, vacaciones, bolsa de
// horas, nóminas). La gestión/alta de cada uno de esos historiales vive en sus
// propias secciones; aquí solo se consulta y se edita el trío de campos del
// trabajador (categoría, fecha de alta, días de vacaciones anuales).
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  Clock,
  Download,
  FileWarning,
  Files,
  Palmtree,
  Pencil,
  Receipt,
  Search,
  ShieldAlert,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KPICard } from "@/components/KPICard";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatNumber, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { diasNaturalesPeriodo, saldoVacaciones } from "@/lib/rrhhVacaciones";
import { cuentaTrabajadorKgPersona } from "@/lib/asistenciaRendimiento";
import {
  urlDescargaRrhhDoc,
  useRrhhFichaPersona,
  useRrhhPlantilla,
  type RrhhGravedad,
  type TrabajadorPlantillaRow,
} from "@/hooks/useRrhhPersonas";

// ─── Helpers ────────────────────────────────────────────────────────────────

function antiguedadTexto(fechaAlta: string | null): string {
  if (!fechaAlta) return "—";
  const [y, m, d] = fechaAlta.split("-").map(Number);
  const alta = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
  const ahora = new Date();
  if (alta > ahora) return "Aún no dado de alta";

  let años = ahora.getFullYear() - alta.getFullYear();
  let meses = ahora.getMonth() - alta.getMonth();
  if (ahora.getDate() < alta.getDate()) meses -= 1;
  if (meses < 0) {
    años -= 1;
    meses += 12;
  }
  if (años <= 0 && meses <= 0) return "Menos de un mes";

  const partes: string[] = [];
  if (años > 0) partes.push(`${años} año${años === 1 ? "" : "s"}`);
  if (meses > 0) partes.push(`${meses} mes${meses === 1 ? "" : "es"}`);
  return partes.join(" y ") || "Menos de un mes";
}

const GRAVEDAD_LABEL: Record<RrhhGravedad, string> = {
  leve: "Leve",
  grave: "Grave",
  muy_grave: "Muy grave",
};

const GRAVEDAD_CLASS: Record<RrhhGravedad, string> = {
  leve: "border-warning/40 bg-warning/10 text-warning",
  grave: "border-destructive/40 bg-destructive/10 text-destructive",
  muy_grave: "border-destructive/60 bg-destructive/20 text-destructive",
};

function EstadoVacio({ icon: Icon, texto }: { icon: typeof Users; texto: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}

async function abrirDescarga(path: string | null) {
  if (!path) {
    toast({ title: "Sin archivo adjunto", variant: "destructive" });
    return;
  }
  try {
    const url = await urlDescargaRrhhDoc(path);
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    toast({ title: "Error al generar el enlace", description: errorMessage(err), variant: "destructive" });
  }
}

// ─── Página principal ───────────────────────────────────────────────────────

export default function RrhhPersonas() {
  const { trabajadores, isLoading, error, updateFicha } = useRrhhPlantilla();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TrabajadorPlantillaRow | null>(null);

  const trabajadoresFiltrados = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("es");
    const lista = q
      ? trabajadores.filter((t) => t.nombre.toLocaleLowerCase("es").includes(q))
      : trabajadores;
    return [...lista].sort((a, b) => {
      if (a.activo !== b.activo) return a.activo ? -1 : 1;
      return a.nombre.localeCompare(b.nombre, "es");
    });
  }, [trabajadores, search]);

  const activos = trabajadores.filter((t) => t.activo);
  const conCategoria = activos.filter((t) => t.categoria_profesional?.trim()).length;
  const conFechaAlta = activos.filter((t) => t.fecha_alta).length;

  const selected = trabajadores.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">RRHH</p>
          <h1 className="page-title">Plantilla</h1>
          <p className="page-subtitle">Listado de trabajadores, datos de personal y ficha individual.</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KPICard
          className="glass-accented"
          label="Plantilla activa"
          value={formatNumber(activos.length)}
          hint={`${trabajadores.length - activos.length} inactivo(s)`}
          icon={Users}
        />
        <KPICard
          className="glass-accented"
          label="Con categoría profesional"
          value={formatNumber(conCategoria)}
          hint={activos.length > 0 ? `de ${activos.length} activos` : undefined}
          icon={Briefcase}
        />
        <KPICard
          className="glass-accented"
          label="Con fecha de alta"
          value={formatNumber(conFechaAlta)}
          hint={activos.length > 0 ? `de ${activos.length} activos` : undefined}
          icon={CalendarClock}
        />
        <KPICard
          className="glass-accented"
          label="Vacaciones por defecto"
          value="30 días"
          hint="Personalizable por trabajador"
          icon={Palmtree}
        />
      </section>

      <div className="section-toolbar flex items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre..."
          className="h-9 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
      </div>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Trabajadores ({trabajadoresFiltrados.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Cargando plantilla…</p>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <AlertTriangle className="h-8 w-8 text-warning" />
              <p className="text-sm text-muted-foreground">{errorMessage(error)}</p>
            </div>
          ) : trabajadoresFiltrados.length === 0 ? (
            <EstadoVacio icon={Users} texto="No hay trabajadores que coincidan con la búsqueda." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="data-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Zona / grupo</TableHead>
                    <TableHead>Categoría profesional</TableHead>
                    <TableHead>Fecha de alta</TableHead>
                    <TableHead>Antigüedad</TableHead>
                    <TableHead>Kg/persona</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trabajadoresFiltrados.map((t) => (
                    <TableRow
                      key={t.id}
                      className={cn("cursor-pointer", !t.activo && "opacity-60")}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <TableCell className="font-medium">{t.nombre}</TableCell>
                      <TableCell className="text-muted-foreground">{t.zona ?? "—"}</TableCell>
                      <TableCell>
                        {t.categoria_profesional?.trim() ? (
                          t.categoria_profesional
                        ) : (
                          <span className="text-muted-foreground">Sin asignar</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {t.fecha_alta ? formatDate(t.fecha_alta) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{antiguedadTexto(t.fecha_alta)}</TableCell>
                      <TableCell>
                        {t.computa_kg_persona === true ? (
                          <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Sí</Badge>
                        ) : t.computa_kg_persona === false ? (
                          <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">No</Badge>
                        ) : (
                          <Badge variant="outline" className="border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground">
                            Auto · {cuentaTrabajadorKgPersona(t) ? "Sí" : "No"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={t.activo ? "border-success/40 bg-success/10 text-success" : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground"}
                        >
                          {t.activo ? "Activo" : "Inactivo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(t);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <EditarTrabajadorDialog
        trabajador={editing}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (!editing) return;
          try {
            await updateFicha.mutateAsync({ id: editing.id, ...patch });
            toast({ title: "Datos actualizados", description: patch.nombre || editing.nombre });
            setEditing(null);
          } catch (err) {
            const codigo = (err as { code?: string } | null)?.code;
            if (codigo === "23505") {
              toast({ title: "Nombre duplicado", description: "Ya existe un trabajador con ese nombre.", variant: "destructive" });
            } else {
              toast({ title: "Error al guardar", description: errorMessage(err), variant: "destructive" });
            }
          }
        }}
        saving={updateFicha.isPending}
      />

      <FichaPersonaSheet
        trabajador={selected}
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

// ─── Dialog de edición (categoría / fecha alta / vacaciones) ───────────────

type ComputaKgPersonaOpcion = "auto" | "si" | "no";

function EditarTrabajadorDialog({
  trabajador,
  onClose,
  onSave,
  saving,
}: {
  trabajador: TrabajadorPlantillaRow | null;
  onClose: () => void;
  onSave: (patch: {
    nombre: string;
    categoria_profesional: string | null;
    fecha_alta: string | null;
    vacaciones_dias_anuales: number;
    computa_kg_persona: boolean | null;
  }) => void;
  saving: boolean;
}) {
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("");
  const [fechaAlta, setFechaAlta] = useState("");
  const [vacaciones, setVacaciones] = useState("30");
  const [computaOpcion, setComputaOpcion] = useState<ComputaKgPersonaOpcion>("auto");

  // Reinicia el formulario cada vez que cambia el trabajador a editar.
  const trabajadorId = trabajador?.id ?? null;
  const [lastId, setLastId] = useState<string | null>(null);
  if (trabajadorId !== lastId) {
    setLastId(trabajadorId);
    setNombre(trabajador?.nombre ?? "");
    setCategoria(trabajador?.categoria_profesional ?? "");
    setFechaAlta(trabajador?.fecha_alta ?? "");
    setVacaciones(String(trabajador?.vacaciones_dias_anuales ?? 30));
    setComputaOpcion(
      trabajador?.computa_kg_persona === true ? "si" : trabajador?.computa_kg_persona === false ? "no" : "auto",
    );
  }

  const nombreValido = nombre.trim().length > 0;

  return (
    <Dialog open={Boolean(trabajador)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{trabajador?.nombre}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rrhh-nombre">Nombre</Label>
            <Input
              id="rrhh-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre y apellidos"
            />
            {!nombreValido ? (
              <p className="text-xs text-destructive">El nombre no puede quedar vacío.</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rrhh-categoria">Categoría profesional</Label>
            <Input
              id="rrhh-categoria"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="p. ej. Oficial de 2ª"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rrhh-fecha-alta">Fecha de alta</Label>
            <Input
              id="rrhh-fecha-alta"
              type="date"
              value={fechaAlta}
              onChange={(e) => setFechaAlta(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rrhh-vacaciones">Días de vacaciones anuales</Label>
            <Input
              id="rrhh-vacaciones"
              type="number"
              min={0}
              max={60}
              value={vacaciones}
              onChange={(e) => setVacaciones(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rrhh-computa-kg">Computa en kg/persona</Label>
            <Select value={computaOpcion} onValueChange={(v) => setComputaOpcion(v as ComputaKgPersonaOpcion)}>
              <SelectTrigger id="rrhh-computa-kg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automático (según zona)</SelectItem>
                <SelectItem value="si">Sí computa</SelectItem>
                <SelectItem value="no">No computa</SelectItem>
              </SelectContent>
            </Select>
            {computaOpcion === "auto" && trabajador ? (
              <p className="text-xs text-muted-foreground">
                Ahora: {cuentaTrabajadorKgPersona(trabajador) ? "sí computa" : "no computa"}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button
            onClick={() => onSave({
              nombre: nombre.trim(),
              categoria_profesional: categoria.trim() || null,
              fecha_alta: fechaAlta || null,
              vacaciones_dias_anuales: Number(vacaciones) || 30,
              computa_kg_persona: computaOpcion === "si" ? true : computaOpcion === "no" ? false : null,
            })}
            disabled={saving || !nombreValido}
          >
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ficha individual (drawer) ──────────────────────────────────────────────

function FichaPersonaSheet({
  trabajador,
  open,
  onClose,
}: {
  trabajador: TrabajadorPlantillaRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const { ficha, isLoading, sinPermiso } = useRrhhFichaPersona(trabajador?.id ?? null);

  const hoy = today();
  const saldo = trabajador
    ? saldoVacaciones(
        { fechaAlta: trabajador.fecha_alta, hasta: hoy, diasAnuales: trabajador.vacaciones_dias_anuales },
        ficha.vacaciones.map((p) => ({
          fecha_inicio: p.fecha_inicio,
          fecha_fin: p.fecha_fin,
          dias_naturales: p.dias_naturales ?? diasNaturalesPeriodo(p.fecha_inicio, p.fecha_fin),
        })),
      )
    : null;

  const saldoBolsaHoras = ficha.horas.reduce((sum, h) => sum + (Number(h.horas) || 0), 0);

  const justificantesPorFecha = useMemo(() => {
    const set = new Set(ficha.justificantes.map((j) => j.fecha));
    return set;
  }, [ficha.justificantes]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {!trabajador ? null : (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2">
                <UserRound className="h-5 w-5 text-primary" />
                {trabajador.nombre}
              </SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-xl glass-accented p-3 text-sm">
                <div>
                  <p className="panel-kicker">Zona</p>
                  <p className="font-medium">{trabajador.zona ?? "—"}</p>
                </div>
                <div>
                  <p className="panel-kicker">Categoría</p>
                  <p className="font-medium">{trabajador.categoria_profesional?.trim() || "Sin asignar"}</p>
                </div>
                <div>
                  <p className="panel-kicker">Fecha de alta</p>
                  <p className="font-medium tabular-nums">{trabajador.fecha_alta ? formatDate(trabajador.fecha_alta) : "—"}</p>
                </div>
                <div>
                  <p className="panel-kicker">Antigüedad</p>
                  <p className="font-medium">{antiguedadTexto(trabajador.fecha_alta)}</p>
                </div>
              </div>

              {sinPermiso ? (
                <div className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  Solo RRHH y administración
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <KPICard
                  className="glass-accented"
                  label="Saldo de vacaciones"
                  value={saldo ? `${formatNumber(saldo.saldo, 1)} días` : "—"}
                  hint={saldo ? `${formatNumber(saldo.devengados, 1)} devengados · ${formatNumber(saldo.disfrutados, 1)} disfrutados` : undefined}
                  icon={Palmtree}
                  accent={saldo && saldo.saldo < 0 ? "destructive" : "primary"}
                />
                <KPICard
                  className="glass-accented"
                  label="Bolsa de horas"
                  value={`${saldoBolsaHoras >= 0 ? "+" : ""}${formatNumber(saldoBolsaHoras, 1)} h`}
                  hint={`${ficha.horas.length} registro(s)`}
                  icon={Clock}
                  accent={saldoBolsaHoras < 0 ? "destructive" : "primary"}
                />
              </div>

              {isLoading ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Cargando ficha…</p>
              ) : (
                <Tabs defaultValue="faltas" className="space-y-3">
                  <TabsList className="w-full flex-wrap">
                    <TabsTrigger value="faltas">Faltas</TabsTrigger>
                    <TabsTrigger value="bajas">Bajas</TabsTrigger>
                    <TabsTrigger value="justificantes">Justificantes</TabsTrigger>
                    <TabsTrigger value="amonestaciones">Amonestaciones</TabsTrigger>
                    <TabsTrigger value="vacaciones">Vacaciones</TabsTrigger>
                    <TabsTrigger value="horas">Horas</TabsTrigger>
                    <TabsTrigger value="nominas">Nóminas</TabsTrigger>
                  </TabsList>

                  <TabsContent value="faltas">
                    {ficha.faltas.length === 0 ? (
                      <EstadoVacio icon={Users} texto="Sin faltas registradas." />
                    ) : (
                      <Table className="data-table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Motivo</TableHead>
                            <TableHead className="text-right">Justificante</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ficha.faltas.map((f) => (
                            <TableRow key={`${f.trabajador_id}-${f.date}`}>
                              <TableCell className="tabular-nums">{formatDate(f.date)}</TableCell>
                              <TableCell className="text-muted-foreground">{f.motivo_ausencia ?? "—"}</TableCell>
                              <TableCell className="text-right">
                                {justificantesPorFecha.has(f.date) ? (
                                  <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Justificada</Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Sin justificar</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>

                  <TabsContent value="bajas">
                    {ficha.bajas.length === 0 ? (
                      <EstadoVacio icon={FileWarning} texto="Sin bajas laborales registradas." />
                    ) : (
                      <Table className="data-table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Inicio</TableHead>
                            <TableHead>Fin</TableHead>
                            <TableHead>Motivo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ficha.bajas.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell className="tabular-nums">{formatDate(b.fecha_inicio)}</TableCell>
                              <TableCell className="tabular-nums">{b.fecha_fin ? formatDate(b.fecha_fin) : "En curso"}</TableCell>
                              <TableCell className="text-muted-foreground">{b.motivo}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>

                  <TabsContent value="justificantes">
                    {sinPermiso ? (
                      <EstadoVacio icon={ShieldAlert} texto="Solo RRHH y administración." />
                    ) : ficha.justificantes.length === 0 ? (
                      <EstadoVacio icon={Files} texto="Sin justificantes registrados." />
                    ) : (
                      <Table className="data-table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Notas</TableHead>
                            <TableHead className="text-right">Archivo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ficha.justificantes.map((j) => (
                            <TableRow key={j.id}>
                              <TableCell className="tabular-nums">{formatDate(j.fecha)}</TableCell>
                              <TableCell className="text-muted-foreground">{j.notas ?? "—"}</TableCell>
                              <TableCell className="text-right">
                                {j.archivo_path ? (
                                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => abrirDescarga(j.archivo_path)}>
                                    <Download className="h-3.5 w-3.5" /> {j.archivo_nombre ?? "Ver"}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>

                  <TabsContent value="amonestaciones">
                    {sinPermiso ? (
                      <EstadoVacio icon={ShieldAlert} texto="Solo RRHH y administración." />
                    ) : ficha.amonestaciones.length === 0 ? (
                      <EstadoVacio icon={ShieldAlert} texto="Sin amonestaciones registradas." />
                    ) : (
                      <Table className="data-table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Motivo</TableHead>
                            <TableHead>Gravedad</TableHead>
                            <TableHead className="text-right">Archivo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ficha.amonestaciones.map((a) => (
                            <TableRow key={a.id}>
                              <TableCell className="tabular-nums">{formatDate(a.fecha)}</TableCell>
                              <TableCell className="text-muted-foreground">{a.motivo}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={GRAVEDAD_CLASS[a.gravedad]}>
                                  {GRAVEDAD_LABEL[a.gravedad]}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {a.archivo_path ? (
                                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => abrirDescarga(a.archivo_path)}>
                                    <Download className="h-3.5 w-3.5" /> {a.archivo_nombre ?? "Ver"}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>

                  <TabsContent value="vacaciones">
                    {sinPermiso ? (
                      <EstadoVacio icon={ShieldAlert} texto="Solo RRHH y administración." />
                    ) : ficha.vacaciones.length === 0 ? (
                      <EstadoVacio icon={Palmtree} texto="Sin periodos de vacaciones registrados." />
                    ) : (
                      <Table className="data-table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Inicio</TableHead>
                            <TableHead>Fin</TableHead>
                            <TableHead className="text-right">Días naturales</TableHead>
                            <TableHead>Notas</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ficha.vacaciones.map((v) => (
                            <TableRow key={v.id}>
                              <TableCell className="tabular-nums">{formatDate(v.fecha_inicio)}</TableCell>
                              <TableCell className="tabular-nums">{formatDate(v.fecha_fin)}</TableCell>
                              <TableCell className="text-right tabular-nums">{v.dias_naturales ?? diasNaturalesPeriodo(v.fecha_inicio, v.fecha_fin)}</TableCell>
                              <TableCell className="text-muted-foreground">{v.notas ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>

                  <TabsContent value="horas">
                    {sinPermiso ? (
                      <EstadoVacio icon={ShieldAlert} texto="Solo RRHH y administración." />
                    ) : ficha.horas.length === 0 ? (
                      <EstadoVacio icon={Clock} texto="Sin registros de bolsa de horas." />
                    ) : (
                      <Table className="data-table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead className="text-right">Horas</TableHead>
                            <TableHead>Motivo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ficha.horas.map((h) => (
                            <TableRow key={h.id}>
                              <TableCell className="tabular-nums">{formatDate(h.fecha)}</TableCell>
                              <TableCell className={cn("text-right tabular-nums font-medium", h.horas < 0 ? "text-destructive" : "text-success")}>
                                {h.horas >= 0 ? "+" : ""}{formatNumber(h.horas, 1)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{h.motivo ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>

                  <TabsContent value="nominas">
                    {sinPermiso ? (
                      <EstadoVacio icon={ShieldAlert} texto="Solo RRHH y administración." />
                    ) : ficha.nominas.length === 0 ? (
                      <EstadoVacio icon={Receipt} texto="Sin nóminas registradas." />
                    ) : (
                      <Table className="data-table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Periodo</TableHead>
                            <TableHead>Notas</TableHead>
                            <TableHead className="text-right">Archivo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ficha.nominas.map((n) => (
                            <TableRow key={n.id}>
                              <TableCell className="tabular-nums">{String(n.mes).padStart(2, "0")}/{n.anio}</TableCell>
                              <TableCell className="text-muted-foreground">{n.notas ?? "—"}</TableCell>
                              <TableCell className="text-right">
                                {n.archivo_path ? (
                                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => abrirDescarga(n.archivo_path)}>
                                    <Download className="h-3.5 w-3.5" /> {n.archivo_nombre ?? "Ver"}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
