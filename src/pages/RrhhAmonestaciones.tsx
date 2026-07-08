// src/pages/RrhhAmonestaciones.tsx
// Sección "RRHH → Amonestaciones": lista cronológica de amonestaciones por
// trabajador, con filtro por persona/gravedad y alta/baja de registros. El
// documento firmado (entregado en mano y escaneado) es opcional y se guarda
// en el bucket privado "rrhh-docs".
import { useMemo, useState } from "react";
import { AlertTriangle, FileText, Filter, Plus, ShieldAlert, Trash2 } from "lucide-react";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  urlFirmada,
  useRrhhAmonestaciones,
  useTrabajadoresActivos,
  type RrhhAmonestacionRow,
  type RrhhGravedad,
} from "@/hooks/useRrhhDocs";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, today } from "@/lib/format";
import { cn } from "@/lib/utils";

const GRAVEDAD_LABEL: Record<RrhhGravedad, string> = {
  leve: "Leve",
  grave: "Grave",
  muy_grave: "Muy grave",
};

const GRAVEDAD_BADGE: Record<RrhhGravedad, string> = {
  leve: "border-warning/40 bg-warning/10 text-warning",
  grave: "border-[hsl(24_95%_53%/0.4)] bg-[hsl(24_95%_53%/0.1)] text-[hsl(24_95%_40%)]",
  muy_grave: "border-destructive/40 bg-destructive/10 text-destructive",
};

const GRAVEDAD_OPTIONS: RrhhGravedad[] = ["leve", "grave", "muy_grave"];

export default function RrhhAmonestaciones() {
  const { amonestaciones, isLoading, sinPermiso, crear, eliminar } = useRrhhAmonestaciones();
  const { trabajadores } = useTrabajadoresActivos();

  const [filtroPersona, setFiltroPersona] = useState<string>("todas");
  const [filtroGravedad, setFiltroGravedad] = useState<string>("todas");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RrhhAmonestacionRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const trabajadoresPorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of trabajadores) map.set(t.id, t.nombre);
    return map;
  }, [trabajadores]);

  const filtradas = useMemo(() => {
    return amonestaciones
      .filter((a) => filtroPersona === "todas" || a.trabajador_id === filtroPersona)
      .filter((a) => filtroGravedad === "todas" || a.gravedad === filtroGravedad);
  }, [amonestaciones, filtroPersona, filtroGravedad]);

  const handleVerDocumento = async (row: RrhhAmonestacionRow) => {
    if (!row.archivo_path) return;
    try {
      const url = await urlFirmada(row.archivo_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({ title: "No se pudo abrir el documento", description: errorMessage(error), variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await eliminar.mutateAsync(pendingDelete);
      toast({ title: "Amonestación eliminada" });
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
            <p className="panel-kicker">RRHH</p>
            <h1 className="page-title">Amonestaciones</h1>
            <p className="page-subtitle">Registro cronológico de amonestaciones por trabajador.</p>
          </div>
        </header>
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Acceso restringido</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Solo RRHH y administración pueden ver esta sección.
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
            <p className="panel-kicker">RRHH</p>
            <Badge variant="outline" className="rounded-md px-2 py-0 text-xs">
              {amonestaciones.length} registro(s)
            </Badge>
          </div>
          <h1 className="page-title">Amonestaciones</h1>
          <p className="page-subtitle">Registro cronológico de amonestaciones por trabajador.</p>
        </div>
        <Button className="gap-2" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> Nueva amonestación
        </Button>
      </header>

      <div className="section-toolbar flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Select value={filtroPersona} onValueChange={setFiltroPersona}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue placeholder="Persona" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las personas</SelectItem>
            {trabajadores.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroGravedad} onValueChange={setFiltroGravedad}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Gravedad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Toda gravedad</SelectItem>
            {GRAVEDAD_OPTIONS.map((g) => (
              <SelectItem key={g} value={g}>{GRAVEDAD_LABEL[g]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="glass-accented overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">Cargando…</div>
          ) : filtradas.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <ShieldAlert className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <h2 className="text-lg font-semibold">
                  {amonestaciones.length === 0 ? "Sin amonestaciones registradas" : "Sin resultados para este filtro"}
                </h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {amonestaciones.length === 0
                    ? "Registra la primera amonestación con el botón de arriba."
                    : "Prueba a cambiar la persona o la gravedad seleccionadas."}
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {filtradas.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{trabajadoresPorId.get(a.trabajador_id) ?? "Trabajador eliminado"}</span>
                      <Badge variant="outline" className={cn("text-[10px]", GRAVEDAD_BADGE[a.gravedad])}>
                        {GRAVEDAD_LABEL[a.gravedad]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{formatDate(a.fecha)}</span>
                    </div>
                    <p className="text-sm">{a.motivo}</p>
                    {a.notas ? <p className="text-xs text-muted-foreground">{a.notas}</p> : null}
                    {a.archivo_path ? (
                      <button
                        onClick={() => handleVerDocumento(a)}
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" /> Documento firmado
                      </button>
                    ) : null}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(a)}
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <NuevaAmonestacionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        trabajadores={trabajadores}
        crear={crear}
      />

      <AlertDialog open={pendingDelete != null} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar amonestación</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará de forma permanente el registro
              {pendingDelete ? ` de ${trabajadoresPorId.get(pendingDelete.trabajador_id) ?? "este trabajador"}` : ""}.
              Esta acción no se puede deshacer.
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

// ─── Dialog "Nueva amonestación" ─────────────────────────────────────────────

function NuevaAmonestacionDialog({
  open, onOpenChange, trabajadores, crear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trabajadores: { id: string; nombre: string }[];
  crear: ReturnType<typeof useRrhhAmonestaciones>["crear"];
}) {
  const [trabajadorId, setTrabajadorId] = useState<string>("");
  const [fecha, setFecha] = useState(today());
  const [motivo, setMotivo] = useState("");
  const [gravedad, setGravedad] = useState<RrhhGravedad>("leve");
  const [notas, setNotas] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const resetForm = () => {
    setTrabajadorId("");
    setFecha(today());
    setMotivo("");
    setGravedad("leve");
    setNotas("");
    setFile(null);
  };

  const handleSubmit = async () => {
    if (!trabajadorId) {
      toast({ title: "Selecciona una persona", variant: "destructive" });
      return;
    }
    if (!motivo.trim()) {
      toast({ title: "El motivo es obligatorio", variant: "destructive" });
      return;
    }
    try {
      await crear.mutateAsync({
        trabajador_id: trabajadorId,
        fecha,
        motivo: motivo.trim(),
        gravedad,
        notas: notas.trim() || null,
        file,
      });
      toast({ title: "Amonestación registrada" });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resetForm(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva amonestación</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Persona</Label>
            <Select value={trabajadorId} onValueChange={setTrabajadorId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un trabajador" />
              </SelectTrigger>
              <SelectContent>
                {trabajadores.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No hay trabajadores activos.</div>
                ) : (
                  trabajadores.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <GlassDatePicker value={fecha} onChange={setFecha} className="w-full" />
            </div>
            <div className="space-y-1.5">
              <Label>Gravedad</Label>
              <Select value={gravedad} onValueChange={(v) => setGravedad(v as RrhhGravedad)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRAVEDAD_OPTIONS.map((g) => (
                    <SelectItem key={g} value={g}>{GRAVEDAD_LABEL[g]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Describe el motivo de la amonestación…"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </div>

          <div className="space-y-1.5">
            <Label>Documento firmado (opcional)</Label>
            <p className="text-xs text-muted-foreground">
              Foto o PDF del documento entregado en mano y escaneado.
            </p>
            <Input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={crear.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={crear.isPending} className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            {crear.isPending ? "Guardando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
