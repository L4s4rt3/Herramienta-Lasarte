// src/pages/EconomicoPrecios.tsx
// Sección "Económico → Tarifas": precio vigente por recurso (agua, electricidad,
// gasoil, quimicos...), histórico expandible y alta/edición/borrado de tarifas.
// Cambiar de precio = dar de alta una fila nueva con `vigente_desde` en la fecha
// del cambio; editar/borrar una fila existente solo está pensado para corregir
// una errata (ver comentario de cabecera de useEconomico.ts).
import { useMemo, useState } from "react";
import {
  AlertTriangle, ChevronDown, Download, History, Pencil, Plus, ShieldAlert, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import {
  usePreciosRecursos,
  type EconomicoPrecioRow,
  type EditarTarifaInput,
  type NuevaTarifaInput,
} from "@/hooks/useEconomico";
import {
  useMallasConfig,
  type EconomicoMallaConfigRow,
  type NuevaMallaConfigInput,
} from "@/hooks/useCosteMallas";
import type { ZonaMalla } from "@/lib/costeMallas";
import {
  useEmpaquePrecios,
  type NuevoEmpaquePrecioInput,
} from "@/hooks/useEmpaquePrecios";
import {
  COMPONENTES_EMPAQUE,
  COMPONENTE_LABEL,
  TIPO_MALLA_LABEL,
  type EmpaqueComponente,
  type TipoMalla,
} from "@/lib/costeEmpaque";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatNumber, today } from "@/lib/format";
import {
  añadirHojaTabla, crearLibroLasarte, descargarLibro, type ColumnaTabla,
} from "@/lib/exportKit";
import { buildLasarteFilename } from "@/lib/reportKit";
import { cn } from "@/lib/utils";

// Formato numérico específico de este export (€/unidad variable, no siempre /kg
// como FMT_EUR_KG de exportKit.ts).
const FMT_EUR_UNIDAD = '#,##0.0000" €"';
const FMT_KG_MALLA = '#,##0.00" kg"';
const FMT_EUR_MALLA = '#,##0.00" €/malla"';

const RECURSOS_CONOCIDOS = ["agua", "electricidad", "gasoil", "quimicos"];

const RECURSO_LABEL: Record<string, string> = {
  agua: "Agua",
  electricidad: "Electricidad",
  gasoil: "Gasoil",
  quimicos: "Quimicos",
};

function recursoLabel(recurso: string): string {
  return RECURSO_LABEL[recurso] ?? recurso.charAt(0).toUpperCase() + recurso.slice(1);
}

function formatPrecio(precio: number, unidad: string): string {
  return `${formatNumber(precio, 4)} €/${unidad}`;
}

function formatPrecioEmpaque(precio: number | null): string {
  return precio != null ? `${formatNumber(precio, 4)} €/malla` : "—";
}

// Fecha "YYYY-MM-DD" anclada al mediodía local (evita el desplazamiento de zona
// horaria de `new Date("YYYY-MM-DD")`), igual que el resto de exports Lasarte.
function parseFechaISO(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return null;
}

// ─── Export Excel (marca Lasarte, clasificación Dirección) ──────────────────

const TARIFAS_COLUMNAS: ColumnaTabla[] = [
  { header: "Recurso", key: "recurso", width: 20 },
  { header: "Unidad", key: "unidad", width: 12 },
  { header: "€/unidad", key: "precio", tipo: "numero", numFmt: FMT_EUR_UNIDAD, width: 14 },
  { header: "Vigente desde", key: "vigenteDesde", tipo: "fecha", width: 16 },
  { header: "Estado", key: "estado", width: 14 },
];

const MALLAS_PRECIOS_COLUMNAS: ColumnaTabla[] = [
  { header: "Zona", key: "zona", width: 16 },
  { header: "Tipo malla", key: "tipoMalla", width: 22 },
  { header: "Kg/malla", key: "kgPorMalla", tipo: "numero", numFmt: FMT_KG_MALLA, width: 14 },
  { header: "Precio/malla", key: "precioMalla", tipo: "numero", numFmt: FMT_EUR_MALLA, width: 16 },
  { header: "Vigente desde", key: "vigenteDesde", tipo: "fecha", width: 16 },
];

async function exportarPrecios(
  precios: EconomicoPrecioRow[],
  vigentesPorRecurso: Map<string, EconomicoPrecioRow>,
  mallasConfigs: EconomicoMallaConfigRow[],
  usuario: string | undefined,
) {
  try {
    const ctx = crearLibroLasarte({
      titulo: "Tarifas y precios",
      usuario,
      clasificacion: "Dirección",
    });

    const preciosOrdenados = [...precios].sort(
      (a, b) => a.recurso.localeCompare(b.recurso, "es") || b.vigente_desde.localeCompare(a.vigente_desde),
    );
    añadirHojaTabla(ctx, {
      nombreHoja: "Tarifas",
      columnas: TARIFAS_COLUMNAS,
      filas: preciosOrdenados.map((fila) => ({
        recurso: recursoLabel(fila.recurso),
        unidad: fila.unidad,
        precio: fila.precio_por_unidad,
        vigenteDesde: parseFechaISO(fila.vigente_desde),
        estado: vigentesPorRecurso.get(fila.recurso)?.id === fila.id ? "Vigente" : "Histórico",
      })),
      autofilter: preciosOrdenados.length > 0,
    });

    const zonaLabelExport: Record<string, string> = { z1: "Zona 1 (Z1)", z2: "Zona 2 (Z2)" };
    const mallasOrdenadas = [...mallasConfigs].sort(
      (a, b) => a.zona.localeCompare(b.zona, "es") || b.vigente_desde.localeCompare(a.vigente_desde),
    );
    añadirHojaTabla(ctx, {
      nombreHoja: "Mallas",
      columnas: MALLAS_PRECIOS_COLUMNAS,
      filas: mallasOrdenadas.map((fila) => ({
        zona: zonaLabelExport[fila.zona] ?? fila.zona,
        tipoMalla: fila.tipo_malla ?? "—",
        kgPorMalla: fila.kg_por_malla,
        precioMalla: fila.precio_malla,
        vigenteDesde: parseFechaISO(fila.vigente_desde),
      })),
      autofilter: mallasOrdenadas.length > 0,
    });

    await descargarLibro(ctx, buildLasarteFilename("Precios", "xlsx"));
    toast({ title: "Precios exportados" });
  } catch (err) {
    toast({ title: "Error al exportar los precios", description: errorMessage(err), variant: "destructive" });
  }
}

export default function EconomicoPrecios() {
  const { user } = useAuth();
  const {
    precios, recursos, vigentesPorRecurso, historicoPorRecurso, hayPrecioCero,
    isLoading, sinPermiso, crear, editar, borrar,
  } = usePreciosRecursos();

  const mallas = useMallasConfig();
  const empaque = useEmpaquePrecios();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<EconomicoPrecioRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EconomicoPrecioRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const toggleExpandido = (recurso: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(recurso)) next.delete(recurso);
      else next.add(recurso);
      return next;
    });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await borrar.mutateAsync(pendingDelete.id);
      toast({ title: "Tarifa eliminada" });
      setPendingDelete(null);
    } catch (error) {
      toast({ title: "Error al eliminar", description: errorMessage(error), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  if (sinPermiso) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker">Económico</p>
            <h1 className="page-title">Tarifas de recursos</h1>
            <p className="page-subtitle">Precio por unidad de agua, electricidad, gasoil y químicos.</p>
          </div>
        </header>
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Acceso restringido</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Solo administración puede ver esta sección.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <p className="panel-kicker">Económico</p>
            <Badge variant="outline" className="rounded-md px-2 py-0 text-xs">
              {recursos.length} recurso(s)
            </Badge>
          </div>
          <h1 className="page-title">Tarifas de recursos</h1>
          <p className="page-subtitle">Precio por unidad de agua, electricidad, gasoil y químicos.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="glass glass-hover gap-1.5"
            onClick={() => exportarPrecios(precios, vigentesPorRecurso, mallas.configs, user?.email ?? undefined)}
          >
            <Download className="h-4 w-4" /> Descargar Excel
          </Button>
          <Button className="gap-2" onClick={() => { setEditingRow(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Nueva tarifa
          </Button>
        </div>
      </header>

      {hayPrecioCero && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <span className="font-semibold">Faltan tarifas reales:</span> los costes saldrán a 0 para los recursos marcados abajo.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : recursos.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <History className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <h2 className="text-lg font-semibold">Sin tarifas registradas</h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Da de alta la primera tarifa con el botón de arriba.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {recursos.map((recurso) => {
                const vigente = vigentesPorRecurso.get(recurso) ?? null;
                const historico = historicoPorRecurso.get(recurso) ?? [];
                const expandido = expandidos.has(recurso);
                const esCero = (vigente?.precio_por_unidad ?? 0) === 0;

                return (
                  <li key={recurso}>
                    <Collapsible open={expandido} onOpenChange={() => toggleExpandido(recurso)}>
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex items-center gap-2 text-left"
                              aria-label={expandido ? "Ocultar histórico" : "Ver histórico"}
                            >
                              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", expandido && "rotate-180")} />
                              <span className="font-semibold">{recursoLabel(recurso)}</span>
                            </button>
                          </CollapsibleTrigger>
                          {esCero && (
                            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                              Precio 0
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-semibold tabular-nums">
                              {vigente ? formatPrecio(vigente.precio_por_unidad, vigente.unidad) : "Sin tarifa"}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {vigente ? `Desde ${formatDate(vigente.vigente_desde)}` : "—"}
                            </p>
                          </div>
                          {vigente && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => { setEditingRow(vigente); setDialogOpen(true); }}
                                aria-label="Editar tarifa vigente"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => setPendingDelete(vigente)}
                                aria-label="Eliminar tarifa vigente"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                      <CollapsibleContent>
                        <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg-strong)]/40 px-4 py-3">
                          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Histórico</p>
                          <ul className="space-y-1.5">
                            {historico.map((fila) => (
                              <li key={fila.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <div className="min-w-0">
                                  <span className="font-medium tabular-nums">{formatPrecio(fila.precio_por_unidad, fila.unidad)}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">desde {formatDate(fila.vigente_desde)}</span>
                                  {fila.notas ? <span className="ml-2 text-xs text-muted-foreground">· {fila.notas}</span> : null}
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() => { setEditingRow(fila); setDialogOpen(true); }}
                                    aria-label="Editar"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => setPendingDelete(fila)}
                                    aria-label="Eliminar"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <MallasRotasSection mallas={mallas} />
      <EmpaqueSection empaque={empaque} />

      <TarifaDialog
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingRow(null); }}
        editingRow={editingRow}
        recursosConocidos={Array.from(new Set([...RECURSOS_CONOCIDOS, ...recursos]))}
        crear={crear}
        editar={editar}
      />

      <AlertDialog open={pendingDelete != null} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar tarifa</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará de forma permanente la tarifa
              {pendingDelete ? ` de ${recursoLabel(pendingDelete.recurso)} vigente desde ${formatDate(pendingDelete.vigente_desde)}` : ""}.
              Usa esto solo para corregir una errata: si el precio cambió de verdad, da de alta una tarifa nueva en vez de borrar la anterior.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Dialog "Nueva tarifa" / edición ─────────────────────────────────────────

const UNIDADES_DISPONIBLES = ["m3", "l", "kwh"];

function TarifaDialog({
  open, onOpenChange, editingRow, recursosConocidos, crear, editar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRow: EconomicoPrecioRow | null;
  recursosConocidos: string[];
  crear: ReturnType<typeof usePreciosRecursos>["crear"];
  editar: ReturnType<typeof usePreciosRecursos>["editar"];
}) {
  const isEditing = editingRow != null;

  const [recursoSeleccionado, setRecursoSeleccionado] = useState<string>("agua");
  const [recursoNuevo, setRecursoNuevo] = useState("");
  const [usarRecursoNuevo, setUsarRecursoNuevo] = useState(false);
  const [unidad, setUnidad] = useState("m3");
  const [precio, setPrecio] = useState("");
  const [vigenteDesde, setVigenteDesde] = useState(today());
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setRecursoSeleccionado(recursosConocidos[0] ?? "agua");
    setRecursoNuevo("");
    setUsarRecursoNuevo(false);
    setUnidad("m3");
    setPrecio("");
    setVigenteDesde(today());
    setNotas("");
  };

  // Al abrir para editar, precarga el formulario con la fila seleccionada.
  const rowId = editingRow?.id;
  useMemo(() => {
    if (editingRow) {
      setRecursoSeleccionado(editingRow.recurso);
      setUsarRecursoNuevo(false);
      setRecursoNuevo("");
      setUnidad(editingRow.unidad);
      setPrecio(String(editingRow.precio_por_unidad));
      setVigenteDesde(editingRow.vigente_desde);
      setNotas(editingRow.notas ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  const handleSubmit = async () => {
    const recurso = (usarRecursoNuevo ? recursoNuevo.trim() : recursoSeleccionado).trim();
    if (!recurso) {
      toast({ title: "Indica el recurso", variant: "destructive" });
      return;
    }
    const precioNumerico = Number(precio.replace(",", "."));
    if (!Number.isFinite(precioNumerico) || precioNumerico < 0) {
      toast({ title: "Precio no válido", description: "Introduce un precio por unidad válido (puede ser 0).", variant: "destructive" });
      return;
    }
    if (!vigenteDesde) {
      toast({ title: "Fecha requerida", description: "Indica desde cuándo es válida esta tarifa.", variant: "destructive" });
      return;
    }

    const payload: NuevaTarifaInput = {
      recurso,
      unidad,
      precio_por_unidad: precioNumerico,
      vigente_desde: vigenteDesde,
      notas: notas.trim() || null,
    };

    setSaving(true);
    try {
      if (isEditing && editingRow) {
        const input: EditarTarifaInput = { ...payload, id: editingRow.id };
        await editar.mutateAsync(input);
        toast({ title: "Tarifa actualizada" });
      } else {
        await crear.mutateAsync(payload);
        toast({ title: "Tarifa registrada" });
      }
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resetForm(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar tarifa" : "Nueva tarifa"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!isEditing && (
            <div className="space-y-1.5">
              <Label>Recurso</Label>
              {usarRecursoNuevo ? (
                <div className="flex gap-2">
                  <Input
                    value={recursoNuevo}
                    onChange={(e) => setRecursoNuevo(e.target.value)}
                    placeholder="p.ej. cartón"
                  />
                  <Button type="button" variant="outline" onClick={() => setUsarRecursoNuevo(false)}>
                    Existente
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Select value={recursoSeleccionado} onValueChange={setRecursoSeleccionado}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {recursosConocidos.map((r) => (
                        <SelectItem key={r} value={r}>{recursoLabel(r)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setUsarRecursoNuevo(true)}>
                    Nuevo
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Unidad</Label>
              <Select value={unidad} onValueChange={setUnidad}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIDADES_DISPONIBLES.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Precio por unidad (€)</Label>
              <Input
                inputMode="decimal"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Vigente desde</Label>
            <GlassDatePicker value={vigenteDesde} onChange={setVigenteDesde} className="w-full" />
            <p className="text-xs text-muted-foreground">
              Un cambio de precio real es siempre una tarifa nueva desde esta fecha, no una edición de la anterior.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando…" : isEditing ? "Guardar cambios" : "Registrar tarifa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sección "Mallas rotas (Z1/Z2)" ──────────────────────────────────────────
// Config del gasto de mallas rotas: tipo de malla, kg de fruta por malla y
// precio por malla, con histórico por zona (mismo patrón que las tarifas de
// recursos de arriba). Un cambio real de peso/precio es una vigencia nueva,
// nunca una edición de la anterior — por eso solo hay "alta", no editar/borrar.

const ZONAS_MALLA: ZonaMalla[] = ["z1", "z2"];

const ZONA_LABEL: Record<ZonaMalla, string> = {
  z1: "Zona 1 (Z1)",
  z2: "Zona 2 (Z2)",
};

function formatKgPorMalla(kgPorMalla: number | null): string {
  return kgPorMalla != null ? `${formatNumber(kgPorMalla, 1)} kg/malla` : "—";
}

function formatPrecioMalla(precioMalla: number | null): string {
  return precioMalla != null ? `${formatNumber(precioMalla, 2)} €/malla` : "—";
}

function MallasRotasSection({ mallas }: { mallas: ReturnType<typeof useMallasConfig> }) {
  const {
    vigentePorZona, historicoPorZona, hayDatosFaltantes, isLoading, crear,
  } = mallas;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [zonaDialog, setZonaDialog] = useState<ZonaMalla>("z1");
  const [expandidos, setExpandidos] = useState<Set<ZonaMalla>>(new Set());

  const toggleExpandido = (zona: ZonaMalla) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(zona)) next.delete(zona);
      else next.add(zona);
      return next;
    });
  };

  return (
    <>
      <div className="flex items-center gap-3 pt-2">
        <div className="h-7 w-1 rounded-full bg-primary" />
        <div>
          <p className="panel-kicker">Económico</p>
          <h2 className="text-xl font-semibold tracking-tight">Mallas rotas (Z1/Z2)</h2>
          <p className="text-sm text-muted-foreground">
            En Z1 se usa un tipo de malla y en Z2 otro: peso de fruta por malla y precio por malla, para calcular el gasto de mallas rotas.
            Si el tipo de la zona es una malla de 3 kg o 5 kg, el precio se toma automáticamente del{" "}
            <span className="font-medium text-foreground">coste total de envasado por malla</span> (sección de arriba);
            el precio manual de aquí queda solo como respaldo.
          </p>
        </div>
      </div>

      {hayDatosFaltantes && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <span className="font-semibold">Falta config de mallas:</span> el gasto de mallas rotas saldrá a 0 para las zonas marcadas abajo hasta que indiques el kg por malla y el precio por malla.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {ZONAS_MALLA.map((zona) => {
                const vigente = vigentePorZona.get(zona) ?? null;
                const historico = historicoPorZona.get(zona) ?? [];
                const expandido = expandidos.has(zona);
                const faltaConfig = !vigente || vigente.kg_por_malla == null || vigente.precio_malla == null;

                return (
                  <li key={zona}>
                    <Collapsible open={expandido} onOpenChange={() => toggleExpandido(zona)}>
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex items-center gap-2 text-left"
                              aria-label={expandido ? "Ocultar histórico" : "Ver histórico"}
                            >
                              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", expandido && "rotate-180")} />
                              <span className="font-semibold">{ZONA_LABEL[zona]}</span>
                            </button>
                          </CollapsibleTrigger>
                          {vigente?.tipo_malla && (
                            <Badge variant="outline" className="rounded-md px-2 py-0 text-xs">
                              {vigente.tipo_malla}
                            </Badge>
                          )}
                          {faltaConfig && (
                            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                              Sin config
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-semibold tabular-nums">
                              {formatKgPorMalla(vigente?.kg_por_malla ?? null)} · {formatPrecioMalla(vigente?.precio_malla ?? null)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {vigente ? `Desde ${formatDate(vigente.vigente_desde)}` : "Sin vigencia registrada"}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setZonaDialog(zona); setDialogOpen(true); }}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" /> Vigencia
                          </Button>
                        </div>
                      </div>
                      <CollapsibleContent>
                        <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg-strong)]/40 px-4 py-3">
                          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Histórico</p>
                          {historico.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Sin vigencias registradas todavía.</p>
                          ) : (
                            <ul className="space-y-1.5">
                              {historico.map((fila) => (
                                <li key={fila.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                  <div className="min-w-0">
                                    <span className="font-medium tabular-nums">
                                      {fila.tipo_malla ? `${fila.tipo_malla} · ` : ""}
                                      {formatKgPorMalla(fila.kg_por_malla)} · {formatPrecioMalla(fila.precio_malla)}
                                    </span>
                                    <span className="ml-2 text-xs text-muted-foreground">desde {formatDate(fila.vigente_desde)}</span>
                                    {fila.notas ? <span className="ml-2 text-xs text-muted-foreground">· {fila.notas}</span> : null}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <MallaConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        zona={zonaDialog}
        crear={crear}
      />
    </>
  );
}

function MallaConfigDialog({
  open, onOpenChange, zona, crear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zona: ZonaMalla;
  crear: ReturnType<typeof useMallasConfig>["crear"];
}) {
  const [tipoMalla, setTipoMalla] = useState("");
  const [kgPorMalla, setKgPorMalla] = useState("");
  const [precioMalla, setPrecioMalla] = useState("");
  const [vigenteDesde, setVigenteDesde] = useState(today());
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setTipoMalla("");
    setKgPorMalla("");
    setPrecioMalla("");
    setVigenteDesde(today());
    setNotas("");
  };

  const handleSubmit = async () => {
    const kgNumerico = kgPorMalla.trim() ? Number(kgPorMalla.replace(",", ".")) : null;
    if (kgPorMalla.trim() && (!Number.isFinite(kgNumerico) || (kgNumerico as number) <= 0)) {
      toast({ title: "Kg por malla no válido", description: "Introduce un peso mayor que 0, o déjalo en blanco.", variant: "destructive" });
      return;
    }
    const precioNumerico = precioMalla.trim() ? Number(precioMalla.replace(",", ".")) : null;
    if (precioMalla.trim() && (!Number.isFinite(precioNumerico) || (precioNumerico as number) < 0)) {
      toast({ title: "Precio por malla no válido", description: "Introduce un precio válido, o déjalo en blanco.", variant: "destructive" });
      return;
    }
    if (!vigenteDesde) {
      toast({ title: "Fecha requerida", description: "Indica desde cuándo es válida esta vigencia.", variant: "destructive" });
      return;
    }

    const payload: NuevaMallaConfigInput = {
      zona,
      tipo_malla: tipoMalla.trim() || null,
      kg_por_malla: kgNumerico,
      precio_malla: precioNumerico,
      vigente_desde: vigenteDesde,
      notas: notas.trim() || null,
    };

    setSaving(true);
    try {
      await crear.mutateAsync(payload);
      toast({ title: "Vigencia registrada" });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resetForm(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva vigencia — {ZONA_LABEL[zona]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo de malla</Label>
            <Input
              value={tipoMalla}
              onChange={(e) => setTipoMalla(e.target.value)}
              placeholder="p.ej. malla verde 10kg"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Kg de fruta por malla</Label>
              <Input
                inputMode="decimal"
                value={kgPorMalla}
                onChange={(e) => setKgPorMalla(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Precio por malla (€)</Label>
              <Input
                inputMode="decimal"
                value={precioMalla}
                onChange={(e) => setPrecioMalla(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Vigente desde</Label>
            <GlassDatePicker value={vigenteDesde} onChange={setVigenteDesde} className="w-full" />
            <p className="text-xs text-muted-foreground">
              Un cambio real de peso o precio de malla es siempre una vigencia nueva desde esta fecha, no una edición de la anterior.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
             {saving ? "Guardando…" : "Registrar vigencia"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sección "Costes de envasado" ─────────────────────────────────────────────
// Precios de materiales de packaging (etiqueta, caja, palet, malla, banda,
// fleje, asa) por tipo de malla (3kg/5kg), con desglose y alta de vigencia
// (mismo patrón que MallasRotasSection).

function EmpaqueSection({ empaque }: { empaque: ReturnType<typeof useEmpaquePrecios> }) {
  const {
    vigentePorTipo, hayPrecioCero, isLoading, costesVigentes, crear,
  } = empaque;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [tipoDialog, setTipoDialog] = useState<TipoMalla>("3kg");
  const [componenteDialog, setComponenteDialog] = useState<EmpaqueComponente>("etiqueta");
  const [expandidos, setExpandidos] = useState<Set<TipoMalla>>(new Set());

  const toggleExpandido = (tipo: TipoMalla) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(tipo)) next.delete(tipo);
      else next.add(tipo);
      return next;
    });
  };

  return (
    <>
      <div className="flex items-center gap-3 pt-2">
        <div className="h-7 w-1 rounded-full bg-primary" />
        <div>
          <p className="panel-kicker">Económico</p>
          <h2 className="text-xl font-semibold tracking-tight">Costes de envasado</h2>
          <p className="text-sm text-muted-foreground">
            Precios de materiales de packaging (etiqueta, caja, palet, malla, banda, fleje, asa) por tipo de malla.
          </p>
        </div>
      </div>

      {hayPrecioCero && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <span className="font-semibold">Faltan precios de envasado:</span> algunos componentes tienen precio 0.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {(["3kg", "5kg"] as TipoMalla[]).map((tipoMalla) => {
                const coste = costesVigentes.find((c) => c.tipoMalla === tipoMalla);
                const vigentes = vigentePorTipo.get(tipoMalla) ?? new Map();
                const expandido = expandidos.has(tipoMalla);
                const total = coste?.totalPorMalla ?? 0;
                const incompleto = coste?.incompleto ?? false;

                return (
                  <li key={tipoMalla}>
                    <Collapsible open={expandido} onOpenChange={() => toggleExpandido(tipoMalla)}>
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex items-center gap-2 text-left"
                              aria-label={expandido ? "Ocultar desglose" : "Ver desglose"}
                            >
                              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", expandido && "rotate-180")} />
                              <span className="font-semibold">{TIPO_MALLA_LABEL[tipoMalla]}</span>
                            </button>
                          </CollapsibleTrigger>
                          {incompleto && (
                            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                              Incompleto
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-semibold tabular-nums text-success">
                              {formatPrecioEmpaque(total)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {COMPONENTES_EMPAQUE.length} componente(s)
                            </p>
                          </div>
                        </div>
                      </div>
                      <CollapsibleContent>
                        <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg-strong)]/40 px-4 py-3">
                          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Desglose por componente</p>
                          <ul className="space-y-1.5">
                            {COMPONENTES_EMPAQUE.map((comp) => {
                              const vigente = vigentes.get(comp) ?? null;
                              const precio = coste?.desglose.find((d) => d.componente === comp)?.precioMalla ?? 0;
                              return (
                                <li key={comp} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                  <div className="min-w-0">
                                    <span className="font-medium">{COMPONENTE_LABEL[comp]}</span>
                                    <span className="ml-2 tabular-nums">{formatPrecioEmpaque(precio > 0 ? precio : null)}</span>
                                    {vigente && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        desde {formatDate(vigente.vigente_desde)}
                                      </span>
                                    )}
                                    {vigente?.notas ? (
                                      <span className="ml-2 text-xs text-muted-foreground">· {vigente.notas}</span>
                                    ) : null}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs"
                                      onClick={() => {
                                        setTipoDialog(tipoMalla);
                                        setComponenteDialog(comp);
                                        setDialogOpen(true);
                                      }}
                                    >
                                      <Plus className="mr-1 h-3 w-3" /> Nueva vigencia
                                    </Button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <EmpaquePrecioDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tipoMalla={tipoDialog}
        componente={componenteDialog}
        crear={crear}
      />
    </>
  );
}

function EmpaquePrecioDialog({
  open, onOpenChange, tipoMalla, componente, crear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipoMalla: TipoMalla;
  componente: EmpaqueComponente;
  crear: ReturnType<typeof useEmpaquePrecios>["crear"];
}) {
  const [precio, setPrecio] = useState("");
  const [vigenteDesde, setVigenteDesde] = useState(today());
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setPrecio("");
    setVigenteDesde(today());
    setNotas("");
  };

  const handleSubmit = async () => {
    const precioNumerico = Number(precio.replace(",", "."));
    if (!Number.isFinite(precioNumerico) || precioNumerico < 0) {
      toast({ title: "Precio no válido", description: "Introduce un precio válido.", variant: "destructive" });
      return;
    }
    if (!vigenteDesde) {
      toast({ title: "Fecha requerida", variant: "destructive" });
      return;
    }

    const payload: NuevoEmpaquePrecioInput = {
      tipo_malla: tipoMalla,
      componente,
      precio_malla: precioNumerico,
      vigente_desde: vigenteDesde,
      notas: notas.trim() || null,
    };

    setSaving(true);
    try {
      await crear.mutateAsync(payload);
      toast({ title: "Precio registrado" });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resetForm(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Nuevo precio — {TIPO_MALLA_LABEL[tipoMalla]} · {COMPONENTE_LABEL[componente]}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Precio por malla (€)</Label>
            <Input
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="0,0000"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Vigente desde</Label>
            <GlassDatePicker value={vigenteDesde} onChange={setVigenteDesde} className="w-full" />
          </div>
          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando…" : "Registrar precio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
