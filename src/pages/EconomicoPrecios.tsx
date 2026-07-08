// src/pages/EconomicoPrecios.tsx
// Sección "Económico → Tarifas": precio vigente por recurso (agua, electricidad,
// gasoil, quimicos...), histórico expandible y alta/edición/borrado de tarifas.
// Cambiar de precio = dar de alta una fila nueva con `vigente_desde` en la fecha
// del cambio; editar/borrar una fila existente solo está pensado para corregir
// una errata (ver comentario de cabecera de useEconomico.ts).
import { useMemo, useState } from "react";
import {
  AlertTriangle, ChevronDown, History, Pencil, Plus, ShieldAlert, Trash2,
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  usePreciosRecursos,
  type EconomicoPrecioRow,
  type EditarTarifaInput,
  type NuevaTarifaInput,
} from "@/hooks/useEconomico";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatNumber, today } from "@/lib/format";
import { cn } from "@/lib/utils";

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

export default function EconomicoPrecios() {
  const {
    recursos, vigentesPorRecurso, historicoPorRecurso, hayPrecioCero,
    isLoading, sinPermiso, crear, editar, borrar,
  } = usePreciosRecursos();

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
        <Button className="gap-2" onClick={() => { setEditingRow(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4" /> Nueva tarifa
        </Button>
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
            <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">Cargando…</div>
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
