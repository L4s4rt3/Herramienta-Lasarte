// src/pages/RrhhNominas.tsx
// Sección "RRHH → Nóminas": cuadrícula persona × mes (12 columnas) para el año
// seleccionado. Cada celda es un check (nómina ya subida, click abre con URL
// firmada) o un botón de subida (hueco). Los documentos viven en el bucket
// privado "rrhh-docs" y solo son visibles para RRHH/administración.
import { useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, FileStack, Info, Loader2, ShieldAlert, Trash2, Upload } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  analizarPdfNominas,
  urlFirmada,
  useRrhhNominas,
  useTrabajadoresActivos,
  type AsignacionPaginaNomina,
  type RrhhNominaRow,
  type TrabajadorActivo,
} from "@/hooks/useRrhhDocs";
import { errorMessage } from "@/lib/errorMessage";
import type { PaginaNomina } from "@/lib/nominasPdf";
import { cn } from "@/lib/utils";

const MESES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

export default function RrhhNominas() {
  const [anio, setAnio] = useState(currentYear);
  const { porTrabajadorYMes, isLoading, sinPermiso, subir, eliminar, importarNominasPdf } = useRrhhNominas(anio);
  const { trabajadores } = useTrabajadoresActivos();

  const [uploadTarget, setUploadTarget] = useState<{ trabajador: TrabajadorActivo; mes: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RrhhNominaRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const handleAbrir = async (row: RrhhNominaRow) => {
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
      toast({ title: "Nómina eliminada" });
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
            <h1 className="page-title">Nóminas</h1>
            <p className="page-subtitle">Documentos de nómina por persona y mes.</p>
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
          <p className="panel-kicker">RRHH</p>
          <h1 className="page-title">Nóminas</h1>
          <p className="page-subtitle">Documentos de nómina por persona y mes.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="panel-kicker">Año</Label>
            <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
              <SelectTrigger className="h-9 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)}>
            <FileStack className="h-4 w-4" />
            Importar PDF de nóminas
          </Button>
        </div>
      </header>

      <div className="flex items-start gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Documentos visibles solo para RRHH y administración.
      </div>

      <Card className="glass-accented overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">Cargando…</div>
          ) : trabajadores.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <ShieldAlert className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No hay trabajadores activos.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-2 [&>th]:py-2">
                  <tr>
                    <th className="sticky left-0 z-10 bg-[var(--glass-bg-solid)] px-3 text-left">Persona</th>
                    {MESES.map((m) => (
                      <th key={m} className="text-center">{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trabajadores.map((t, i) => (
                    <tr key={t.id} className={i % 2 === 1 ? "bg-[var(--glass-bg)]/40" : undefined}>
                      <td className="sticky left-0 z-10 bg-[var(--glass-bg-solid)] px-3 py-2 font-semibold">
                        {t.nombre}
                      </td>
                      {MESES.map((_, idx) => {
                        const mes = idx + 1;
                        const row = porTrabajadorYMes.get(`${t.id}-${mes}`);
                        return (
                          <td key={mes} className="px-1 py-1.5 text-center">
                            {row ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => handleAbrir(row)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-success hover:bg-success/10"
                                  title={row.archivo_nombre}
                                  aria-label={`Abrir nómina de ${t.nombre}, mes ${mes}`}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => setPendingDelete(row)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  aria-label={`Eliminar nómina de ${t.nombre}, mes ${mes}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setUploadTarget({ trabajador: t, mes })}
                                className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-md border border-dashed",
                                  "border-[var(--glass-border)] text-muted-foreground/60 hover:border-primary hover:text-primary",
                                )}
                                aria-label={`Subir nómina de ${t.nombre}, mes ${mes}`}
                              >
                                <Upload className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <SubirNominaDialog
        key={uploadTarget ? `${uploadTarget.trabajador.id}-${uploadTarget.mes}` : "closed"}
        target={uploadTarget}
        anio={anio}
        onOpenChange={(open) => !open && setUploadTarget(null)}
        subir={subir}
      />

      <ImportarNominasDialog
        key={importOpen ? "open" : "closed"}
        open={importOpen}
        anioInicial={anio}
        trabajadores={trabajadores}
        importarNominasPdf={importarNominasPdf}
        onOpenChange={setImportOpen}
      />

      <AlertDialog open={pendingDelete != null} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar nómina</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará <strong>{pendingDelete?.archivo_nombre}</strong> de forma permanente. Esta acción no se puede deshacer.
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

// ─── Dialog "Subir nómina" ────────────────────────────────────────────────────

function SubirNominaDialog({
  target, anio, onOpenChange, subir,
}: {
  target: { trabajador: TrabajadorActivo; mes: number } | null;
  anio: number;
  onOpenChange: (open: boolean) => void;
  subir: ReturnType<typeof useRrhhNominas>["subir"];
}) {
  const [notas, setNotas] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mes, setMes] = useState<number>(target?.mes ?? 1);

  // El componente se remonta (key = trabajador-mes) cada vez que se abre desde
  // una celda distinta, así que `mes` siempre nace ya inicializado al target.
  const open = target != null;

  const resetForm = () => {
    setNotas("");
    setFile(null);
  };

  const handleSubmit = async () => {
    if (!target) return;
    if (!file) {
      toast({ title: "Selecciona un archivo", variant: "destructive" });
      return;
    }
    try {
      await subir.mutateAsync({
        trabajador_id: target.trabajador.id,
        anio,
        mes,
        notas: notas.trim() || null,
        file,
      });
      toast({ title: "Nómina subida" });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resetForm(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subir nómina</DialogTitle>
        </DialogHeader>
        {target ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Persona</Label>
                <Input value={target.trabajador.nombre} disabled />
              </div>
              <div className="space-y-1.5">
                <Label>Año / mes</Label>
                <div className="flex items-center gap-2">
                  <Input value={anio} disabled className="w-20" />
                  <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MESES.map((m, idx) => (
                        <SelectItem key={m} value={String(idx + 1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Archivo (PDF o imagen)</Label>
              <Input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={subir.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={subir.isPending} className="gap-2">
            <Upload className="h-4 w-4" />
            {subir.isPending ? "Subiendo…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog "Importar PDF de nóminas" ─────────────────────────────────────────
// Un PDF trae una nómina por página. Se lee en el navegador (pdfjs), se casa
// cada página con un trabajador por nombre (nominasPdf.ts) y el usuario revisa
// /corrige la asignación antes de trocear (pdf-lib) y subir cada página.

const SIN_ASIGNAR = "__sin_asignar__";

interface FilaImportacion {
  indice: number;
  textoPreview: string;
  confianza: PaginaNomina["confianza"];
  trabajadorId: string | null;
  descartada: boolean;
}

function ImportarNominasDialog({
  open, anioInicial, trabajadores, importarNominasPdf, onOpenChange,
}: {
  open: boolean;
  anioInicial: number;
  trabajadores: TrabajadorActivo[];
  importarNominasPdf: ReturnType<typeof useRrhhNominas>["importarNominasPdf"];
  onOpenChange: (open: boolean) => void;
}) {
  const [anio, setAnio] = useState(anioInicial);
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [file, setFile] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [filas, setFilas] = useState<FilaImportacion[] | null>(null);

  const handleArchivo = async (nuevoFile: File | null) => {
    setFile(nuevoFile);
    setFilas(null);
    if (!nuevoFile) return;

    setAnalizando(true);
    try {
      const paginas = await analizarPdfNominas(nuevoFile, trabajadores);
      setFilas(
        paginas.map((p) => ({
          indice: p.indice,
          textoPreview: p.textoPreview,
          confianza: p.confianza,
          trabajadorId: p.trabajadorId,
          descartada: false,
        })),
      );
    } catch (error) {
      toast({ title: "No se pudo leer el PDF", description: errorMessage(error), variant: "destructive" });
      setFile(null);
    } finally {
      setAnalizando(false);
    }
  };

  const actualizarFila = (indice: number, patch: Partial<FilaImportacion>) => {
    setFilas((prev) => (prev ? prev.map((f) => (f.indice === indice ? { ...f, ...patch } : f)) : prev));
  };

  const handleGuardar = async () => {
    if (!file || !filas) return;
    const asignaciones: AsignacionPaginaNomina[] = filas
      .filter((f) => !f.descartada && f.trabajadorId)
      .map((f) => ({ paginaIndice: f.indice, trabajadorId: f.trabajadorId as string }));

    if (asignaciones.length === 0) {
      toast({ title: "Asigna al menos una página a un trabajador", variant: "destructive" });
      return;
    }

    try {
      const resumen = await importarNominasPdf.mutateAsync({ file, anio, mes, asignaciones });
      const sinAsignar = filas.length - resumen.asignadas;
      toast({
        title: "Importación completada",
        description: `${resumen.asignadas} nómina(s) asignada(s) · ${sinAsignar} sin asignar o descartada(s).`,
      });
      if (resumen.errores.length > 0) {
        toast({
          title: `${resumen.errores.length} página(s) con error`,
          description: resumen.errores.map((e) => `Pág. ${e.paginaIndice + 1}: ${e.mensaje}`).join(" · "),
          variant: "destructive",
        });
      }
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error al importar", description: errorMessage(error), variant: "destructive" });
    }
  };

  const guardando = importarNominasPdf.isPending;
  const totalActivas = filas?.filter((f) => !f.descartada).length ?? 0;
  const totalRevisar = filas?.filter((f) => !f.descartada && f.confianza !== "alta").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !guardando && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar PDF de nóminas</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Año destino</Label>
              <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))} disabled={guardando}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Mes destino</Label>
              <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))} disabled={guardando}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MESES.map((m, idx) => (
                    <SelectItem key={m} value={String(idx + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>PDF con todas las nóminas</Label>
              <Input
                type="file"
                accept="application/pdf"
                disabled={analizando || guardando}
                onChange={(e) => handleArchivo(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          {analizando ? (
            <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              Leyendo el PDF y comparando nombres… puede tardar unos segundos.
            </div>
          ) : filas && filas.length > 0 ? (
            <>
              <div className="flex items-start gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-2.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {filas.length} página(s) detectada(s), {totalActivas} activa(s) para importar.
                {totalRevisar > 0 && (
                  <span className="font-semibold text-warning"> {totalRevisar} necesita(n) revisión (resaltadas en ámbar).</span>
                )}
              </div>

              <div className="flex-1 overflow-auto rounded-xl border border-[var(--glass-border)]">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 z-10 border-b border-[var(--glass-border)] bg-[var(--glass-bg-solid)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-2">
                    <tr>
                      <th className="text-left">Pág.</th>
                      <th className="text-left">Vista previa del texto</th>
                      <th className="text-left">Estado</th>
                      <th className="text-left">Trabajador asignado</th>
                      <th className="text-center">Descartar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((fila) => {
                      const necesitaRevision = !fila.descartada && fila.confianza !== "alta";
                      return (
                        <tr
                          key={fila.indice}
                          className={cn(
                            "border-b border-[var(--glass-border)] align-top last:border-b-0",
                            fila.descartada && "opacity-50",
                            necesitaRevision && "bg-warning/10",
                          )}
                        >
                          <td className="px-3 py-2 font-semibold">{fila.indice + 1}</td>
                          <td className="max-w-[260px] px-3 py-2 text-xs text-muted-foreground">
                            <span className="line-clamp-2">{fila.textoPreview || "(página sin texto legible)"}</span>
                          </td>
                          <td className="px-3 py-2">
                            {fila.confianza === "alta" ? (
                              <Badge className="gap-1 border-transparent bg-success/15 text-success hover:bg-success/15">
                                <CheckCircle2 className="h-3 w-3" /> Clara
                              </Badge>
                            ) : fila.confianza === "baja" ? (
                              <Badge className="gap-1 border-transparent bg-warning/15 text-warning hover:bg-warning/15">
                                <AlertTriangle className="h-3 w-3" /> Ambigua
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-muted-foreground">
                                <Ban className="h-3 w-3" /> Sin match
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={fila.trabajadorId ?? SIN_ASIGNAR}
                              onValueChange={(v) => actualizarFila(fila.indice, { trabajadorId: v === SIN_ASIGNAR ? null : v })}
                              disabled={fila.descartada || guardando}
                            >
                              <SelectTrigger className="h-8 min-w-[200px]">
                                <SelectValue placeholder="Sin asignar" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={SIN_ASIGNAR}>— Sin asignar —</SelectItem>
                                {trabajadores.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Checkbox
                              checked={fila.descartada}
                              disabled={guardando}
                              onCheckedChange={(checked) => actualizarFila(fila.indice, { descartada: checked === true })}
                              aria-label={`Descartar página ${fila.indice + 1}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : filas && filas.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              <ShieldAlert className="h-8 w-8 text-muted-foreground/50" />
              No se ha detectado ninguna página en el PDF.
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
              <FileStack className="h-8 w-8 text-muted-foreground/50" />
              Elige el año, el mes y el PDF con todas las nóminas del mes. Cada página debe ser la nómina completa de una persona.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={handleGuardar} disabled={!filas || filas.length === 0 || analizando || guardando} className="gap-2">
            <Upload className="h-4 w-4" />
            {guardando ? "Guardando…" : "Asignar y guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
