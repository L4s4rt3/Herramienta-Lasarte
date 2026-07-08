// src/pages/RrhhPersonas.tsx
// Sección "Plantilla" de RRHH: centro de gestión de trabajadores — alta, edición
// rápida de ficha (nombre, zona/puesto, categoría, fecha de alta, vacaciones,
// computa kg/persona, DNI, email, teléfono), activo/inactivo, baja/alta laboral
// con un botón y descarga a Excel — más la ficha individual de consulta (faltas,
// bajas, justificantes, amonestaciones, vacaciones, bolsa de horas, nóminas). La
// gestión/alta de cada uno de esos historiales vive en sus propias secciones;
// aquí solo se consultan en la ficha.
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
  Plus,
  Receipt,
  Search,
  ShieldAlert,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import { KPICard } from "@/components/KPICard";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatNumber, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createWorkbook, appendRowsSheet, saveWorkbook } from "@/lib/exportWorkbook";
import { diasNaturalesPeriodo, saldoVacaciones } from "@/lib/rrhhVacaciones";
import { cuentaTrabajadorKgPersona } from "@/lib/asistenciaRendimiento";
import {
  urlDescargaRrhhDoc,
  useRrhhFichaPersona,
  useRrhhPlantilla,
  type BajaAbiertaRow,
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

/** Texto de la situación laboral actual (para tabla y export): Inactivo / En baja desde X / Activo. */
function situacionTexto(trabajador: TrabajadorPlantillaRow, baja: BajaAbiertaRow | undefined): string {
  if (!trabajador.activo) return "Inactivo";
  if (baja) return `En baja desde ${formatDate(baja.fecha_inicio)}`;
  return "Activo";
}

function computaKgPersonaTexto(trabajador: TrabajadorPlantillaRow): string {
  if (trabajador.computa_kg_persona === true) return "Sí";
  if (trabajador.computa_kg_persona === false) return "No";
  return `Auto (${cuentaTrabajadorKgPersona(trabajador) ? "Sí" : "No"})`;
}

// Ancho de columna aproximado según el contenido más largo de cada hoja (mismo
// criterio que inferExportColumnWidths de Asistencia.tsx, sin compartir módulo).
function inferColumnWidths(rows: Record<string, unknown>[]) {
  const headers = Array.from(rows.reduce<Set<string>>((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  if (headers.length === 0) return [18];
  return headers.map((header) => {
    const maxContent = rows.reduce((max, row) => Math.max(max, String(row[header] ?? "").length), header.length);
    return Math.min(Math.max(maxContent + 3, 12), 46);
  });
}

function exportarPlantilla(
  trabajadores: TrabajadorPlantillaRow[],
  bajaAbiertaPorTrabajador: Map<string, BajaAbiertaRow>,
) {
  try {
    const workbook = createWorkbook("Lasarte SAT - Plantilla de trabajadores", "Listado completo de trabajadores");
    const rows = [...trabajadores]
      .sort((a, b) => (a.zona ?? "").localeCompare(b.zona ?? "", "es") || a.nombre.localeCompare(b.nombre, "es"))
      .map((t) => ({
        Nombre: t.nombre,
        "Puesto / Zona": t.zona ?? "",
        "Categoría profesional": t.categoria_profesional ?? "",
        DNI: t.dni ?? "",
        Email: t.email ?? "",
        Teléfono: t.telefono ?? "",
        "Fecha de alta": t.fecha_alta ? formatDate(t.fecha_alta) : "",
        Antigüedad: antiguedadTexto(t.fecha_alta),
        Estado: situacionTexto(t, bajaAbiertaPorTrabajador.get(t.id)),
        "Vacaciones/año": t.vacaciones_dias_anuales,
        "Computa kg/persona": computaKgPersonaTexto(t),
      }));
    appendRowsSheet(workbook, "Trabajadores", rows, inferColumnWidths(rows), { freezeHeader: true });
    saveWorkbook(workbook, `Lasarte_Plantilla_${today()}.xlsx`);
    toast({ title: "Plantilla descargada" });
  } catch (err) {
    toast({ title: "Error al exportar la plantilla", description: errorMessage(err), variant: "destructive" });
  }
}

// ─── Página principal ───────────────────────────────────────────────────────

export default function RrhhPersonas() {
  const {
    trabajadores, bajaAbiertaPorTrabajador, isLoading, error,
    updateFicha, altaTrabajador, setActivo, darDeBaja, darDeAlta,
  } = useRrhhPlantilla();
  const [search, setSearch] = useState("");
  const [mostrarInactivos, setMostrarInactivos] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TrabajadorPlantillaRow | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);

  const zonasSugeridas = useMemo(() => {
    const set = new Set<string>();
    for (const t of trabajadores) {
      if (t.zona?.trim()) set.add(t.zona.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [trabajadores]);

  const trabajadoresFiltrados = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("es");
    let lista = q
      ? trabajadores.filter((t) => t.nombre.toLocaleLowerCase("es").includes(q))
      : trabajadores;
    if (!mostrarInactivos) lista = lista.filter((t) => t.activo);
    return [...lista].sort((a, b) => {
      if (a.activo !== b.activo) return a.activo ? -1 : 1;
      return a.nombre.localeCompare(b.nombre, "es");
    });
  }, [trabajadores, search, mostrarInactivos]);

  const activos = trabajadores.filter((t) => t.activo);
  const conCategoria = activos.filter((t) => t.categoria_profesional?.trim()).length;
  const conFechaAlta = activos.filter((t) => t.fecha_alta).length;
  const enBaja = activos.filter((t) => bajaAbiertaPorTrabajador.has(t.id)).length;

  const selected = trabajadores.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">RRHH</p>
          <h1 className="page-title">Plantilla</h1>
          <p className="page-subtitle">Centro de gestión de trabajadores: alta, ficha, bajas laborales y descarga.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="glass glass-hover gap-1.5"
            onClick={() => exportarPlantilla(trabajadores, bajaAbiertaPorTrabajador)}
          >
            <Download className="h-4 w-4" /> Descargar plantilla
          </Button>
          <Button className="gap-1.5" onClick={() => setAddingOpen(true)}>
            <Plus className="h-4 w-4" /> Añadir trabajador
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KPICard
          className="glass-accented"
          label="Plantilla activa"
          value={formatNumber(activos.length)}
          hint={`${trabajadores.length - activos.length} inactivo(s)`}
          icon={Users}
        />
        <KPICard
          className="glass-accented"
          label="En baja laboral"
          value={formatNumber(enBaja)}
          hint={activos.length > 0 ? `de ${activos.length} activos` : undefined}
          icon={UserMinus}
          accent={enBaja > 0 ? "destructive" : "primary"}
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

      <div className="section-toolbar flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre..."
            className="h-9 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={mostrarInactivos} onCheckedChange={setMostrarInactivos} />
          Mostrar inactivos
        </label>
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
                    <TableHead>Situación</TableHead>
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
                        {(() => {
                          const baja = bajaAbiertaPorTrabajador.get(t.id);
                          if (!t.activo) {
                            return (
                              <Badge variant="outline" className="border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground">
                                Inactivo
                              </Badge>
                            );
                          }
                          if (baja) {
                            return (
                              <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                                En baja desde {formatDate(baja.fecha_inicio)}
                              </Badge>
                            );
                          }
                          return (
                            <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Activo</Badge>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={t.activo}
                            onCheckedChange={async (checked) => {
                              try {
                                await setActivo.mutateAsync({ id: t.id, activo: checked });
                                toast({ title: checked ? "Trabajador activado" : "Trabajador desactivado", description: t.nombre });
                              } catch (err) {
                                toast({ title: "Error al cambiar el estado", description: errorMessage(err), variant: "destructive" });
                              }
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg"
                            onClick={() => setEditing(t)}
                            title="Editar ficha"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <BajaLaboralAction
                            trabajador={t}
                            baja={bajaAbiertaPorTrabajador.get(t.id) ?? null}
                            darDeBaja={darDeBaja}
                            darDeAlta={darDeAlta}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ZonasDatalist zonas={zonasSugeridas} />

      <AltaTrabajadorDialog
        open={addingOpen}
        onClose={() => setAddingOpen(false)}
        onSave={async (input) => {
          try {
            await altaTrabajador.mutateAsync(input);
            toast({ title: "Trabajador dado de alta", description: input.nombre });
            setAddingOpen(false);
          } catch (err) {
            const codigo = (err as { code?: string } | null)?.code;
            if (codigo === "23505") {
              toast({ title: "Nombre duplicado", description: "Ya existe un trabajador con ese nombre.", variant: "destructive" });
            } else {
              toast({ title: "Error al dar de alta", description: errorMessage(err), variant: "destructive" });
            }
          }
        }}
        saving={altaTrabajador.isPending}
      />

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

// ─── Datalist de autocompletado de zona (compartido por ambos formularios) ──

const ZONAS_DATALIST_ID = "rrhh-zonas-existentes";

function ZonasDatalist({ zonas }: { zonas: string[] }) {
  return (
    <datalist id={ZONAS_DATALIST_ID}>
      {zonas.map((z) => (
        <option key={z} value={z} />
      ))}
    </datalist>
  );
}

// ─── Dialog de edición de ficha (gestión rápida completa) ──────────────────

type ComputaKgPersonaOpcion = "auto" | "si" | "no";

interface TrabajadorFormPatch {
  nombre: string;
  zona: string | null;
  categoria_profesional: string | null;
  fecha_alta: string | null;
  vacaciones_dias_anuales: number;
  computa_kg_persona: boolean | null;
  email: string | null;
  telefono: string | null;
  dni: string | null;
}

function EditarTrabajadorDialog({
  trabajador,
  onClose,
  onSave,
  saving,
}: {
  trabajador: TrabajadorPlantillaRow | null;
  onClose: () => void;
  onSave: (patch: TrabajadorFormPatch) => void;
  saving: boolean;
}) {
  const [nombre, setNombre] = useState("");
  const [zona, setZona] = useState("");
  const [categoria, setCategoria] = useState("");
  const [fechaAlta, setFechaAlta] = useState("");
  const [vacaciones, setVacaciones] = useState("30");
  const [computaOpcion, setComputaOpcion] = useState<ComputaKgPersonaOpcion>("auto");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [dni, setDni] = useState("");

  // Reinicia el formulario cada vez que cambia el trabajador a editar.
  const trabajadorId = trabajador?.id ?? null;
  const [lastId, setLastId] = useState<string | null>(null);
  if (trabajadorId !== lastId) {
    setLastId(trabajadorId);
    setNombre(trabajador?.nombre ?? "");
    setZona(trabajador?.zona ?? "");
    setCategoria(trabajador?.categoria_profesional ?? "");
    setFechaAlta(trabajador?.fecha_alta ?? "");
    setVacaciones(String(trabajador?.vacaciones_dias_anuales ?? 30));
    setComputaOpcion(
      trabajador?.computa_kg_persona === true ? "si" : trabajador?.computa_kg_persona === false ? "no" : "auto",
    );
    setEmail(trabajador?.email ?? "");
    setTelefono(trabajador?.telefono ?? "");
    setDni(trabajador?.dni ?? "");
  }

  const nombreValido = nombre.trim().length > 0;

  return (
    <Dialog open={Boolean(trabajador)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-accented sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{trabajador?.nombre}</DialogTitle>
          <DialogDescription>Edita cualquier dato de la ficha y guarda los cambios.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-zona">Zona / puesto</Label>
              <Input
                id="rrhh-zona"
                value={zona}
                onChange={(e) => setZona(e.target.value)}
                placeholder="p. ej. Envasado"
                list={ZONAS_DATALIST_ID}
              />
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
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-fecha-alta">Fecha de alta</Label>
              <GlassDatePicker id="rrhh-fecha-alta" value={fechaAlta} onChange={setFechaAlta} className="w-full" label="Sin fecha" />
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
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-dni">DNI</Label>
              <Input id="rrhh-dni" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="12345678A" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-email">Email</Label>
              <Input id="rrhh-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-telefono">Teléfono</Label>
              <Input id="rrhh-telefono" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="600 000 000" />
            </div>
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
              zona: zona.trim() || null,
              categoria_profesional: categoria.trim() || null,
              fecha_alta: fechaAlta || null,
              vacaciones_dias_anuales: Number(vacaciones) || 30,
              computa_kg_persona: computaOpcion === "si" ? true : computaOpcion === "no" ? false : null,
              email: email.trim() || null,
              telefono: telefono.trim() || null,
              dni: dni.trim() || null,
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

// ─── Dialog de alta de trabajador ───────────────────────────────────────────

function AltaTrabajadorDialog({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: {
    nombre: string;
    zona: string;
    categoria_profesional?: string | null;
    fecha_alta?: string | null;
    vacaciones_dias_anuales?: number;
    computa_kg_persona?: boolean | null;
    email?: string | null;
    telefono?: string | null;
    dni?: string | null;
  }) => void;
  saving: boolean;
}) {
  const [nombre, setNombre] = useState("");
  const [zona, setZona] = useState("");
  const [categoria, setCategoria] = useState("");
  const [fechaAlta, setFechaAlta] = useState(today());
  const [vacaciones, setVacaciones] = useState("30");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [dni, setDni] = useState("");

  function resetForm() {
    setNombre("");
    setZona("");
    setCategoria("");
    setFechaAlta(today());
    setVacaciones("30");
    setEmail("");
    setTelefono("");
    setDni("");
  }

  function handleOpenChange(next: boolean) {
    if (!next) onClose();
  }

  const nombreValido = nombre.trim().length > 0;
  const zonaValida = zona.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) resetForm();
        handleOpenChange(next);
      }}
    >
      <DialogContent className="glass-accented sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" /> Añadir trabajador
          </DialogTitle>
          <DialogDescription>Nombre y zona son obligatorios; el resto se puede completar más tarde.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-alta-nombre">Nombre *</Label>
              <Input id="rrhh-alta-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellidos" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-alta-zona">Zona / puesto *</Label>
              <Input
                id="rrhh-alta-zona"
                value={zona}
                onChange={(e) => setZona(e.target.value)}
                placeholder="p. ej. Envasado"
                list={ZONAS_DATALIST_ID}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-alta-categoria">Categoría profesional</Label>
              <Input id="rrhh-alta-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="p. ej. Oficial de 2ª" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-alta-fecha">Fecha de alta</Label>
              <GlassDatePicker id="rrhh-alta-fecha" value={fechaAlta} onChange={setFechaAlta} className="w-full" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-alta-dni">DNI</Label>
              <Input id="rrhh-alta-dni" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="12345678A" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-alta-email">Email</Label>
              <Input id="rrhh-alta-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-alta-telefono">Teléfono</Label>
              <Input id="rrhh-alta-telefono" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="600 000 000" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rrhh-alta-vacaciones">Días de vacaciones anuales</Label>
            <Input
              id="rrhh-alta-vacaciones"
              type="number"
              min={0}
              max={60}
              value={vacaciones}
              onChange={(e) => setVacaciones(e.target.value)}
              className="max-w-[10rem]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button
            onClick={() => onSave({
              nombre: nombre.trim(),
              zona: zona.trim(),
              categoria_profesional: categoria.trim() || null,
              fecha_alta: fechaAlta || null,
              vacaciones_dias_anuales: Number(vacaciones) || 30,
              computa_kg_persona: null,
              email: email.trim() || null,
              telefono: telefono.trim() || null,
              dni: dni.trim() || null,
            })}
            disabled={saving || !nombreValido || !zonaValida}
          >
            {saving ? "Guardando…" : "Añadir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Acción de baja / alta laboral (botón único con estado) ────────────────

function BajaLaboralAction({
  trabajador,
  baja,
  darDeBaja,
  darDeAlta,
}: {
  trabajador: TrabajadorPlantillaRow;
  baja: BajaAbiertaRow | null;
  darDeBaja: ReturnType<typeof useRrhhPlantilla>["darDeBaja"];
  darDeAlta: ReturnType<typeof useRrhhPlantilla>["darDeAlta"];
}) {
  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState(today());
  const [motivo, setMotivo] = useState("");

  function handleOpenChange(next: boolean) {
    if (next) {
      setFecha(today());
      setMotivo("");
    }
    setOpen(next);
  }

  const esAlta = Boolean(baja);

  async function handleSubmit() {
    if (esAlta && baja) {
      if (fecha < baja.fecha_inicio) {
        toast({ title: "Fecha no válida", description: "La fecha de alta debe ser igual o posterior al inicio de la baja.", variant: "destructive" });
        return;
      }
      try {
        await darDeAlta.mutateAsync({ id: baja.id, fecha_fin: fecha });
        toast({ title: "Trabajador dado de alta", description: trabajador.nombre });
        setOpen(false);
      } catch (err) {
        toast({ title: "Error al dar de alta", description: errorMessage(err), variant: "destructive" });
      }
      return;
    }
    try {
      await darDeBaja.mutateAsync({ trabajador_id: trabajador.id, fecha_inicio: fecha, motivo: motivo.trim() || null });
      toast({ title: "Trabajador dado de baja", description: trabajador.nombre });
      setOpen(false);
    } catch (err) {
      toast({ title: "Error al dar de baja", description: errorMessage(err), variant: "destructive" });
    }
  }

  const saving = darDeBaja.isPending || darDeAlta.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8 rounded-lg", esAlta ? "text-warning hover:text-warning" : "text-muted-foreground")}
          title={esAlta ? "Dar de alta" : "Dar de baja"}
        >
          {esAlta ? <UserPlus className="h-3.5 w-3.5" /> : <UserMinus className="h-3.5 w-3.5" />}
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-accented sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{esAlta ? "Dar de alta" : "Dar de baja"} · {trabajador.nombre}</DialogTitle>
          {esAlta && baja ? (
            <DialogDescription>En baja desde el {formatDate(baja.fecha_inicio)} ({baja.motivo}).</DialogDescription>
          ) : (
            <DialogDescription>Registra el inicio de la baja laboral.</DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{esAlta ? "Fecha de alta (fin de baja)" : "Fecha de inicio"}</Label>
            <GlassDatePicker value={fecha} onChange={setFecha} className="w-full" />
          </div>
          {!esAlta ? (
            <div className="space-y-1.5">
              <Label htmlFor="rrhh-baja-motivo">Motivo (opcional)</Label>
              <Input
                id="rrhh-baja-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Baja laboral"
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando…" : esAlta ? "Dar de alta" : "Dar de baja"}
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
