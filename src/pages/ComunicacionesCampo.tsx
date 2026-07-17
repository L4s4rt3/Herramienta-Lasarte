// src/pages/ComunicacionesCampo.tsx
// "Comunicaciones de campaña": sección exclusiva de Jesús (jesus@lasartesat.es,
// más administración) para enviar comunicados a agricultores y proveedores
// informando de qué hay que hacer para la campaña que entra. Los destinatarios
// se introducen a mano (emails sueltos) o desde la agenda (contactos_campo),
// que se alimenta con altas manuales o importando un Excel.
// El envío reutiliza la Edge Function `enviar-comunicacion`; sin proveedor de
// correo configurado la comunicación se guarda como borrador, sin bloquear.
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle, CheckCircle2, Clock, FileSpreadsheet, Info, Mail, Plus, Search,
  Send, ShieldAlert, Sprout, Upload, UserPlus, Users, X, XCircle,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  useComunicacionesCampo,
  type ComunicacionCampoEstado,
  type DestinatarioCampo,
} from "@/hooks/useComunicacionesCampo";
import {
  esEmailValido,
  normalizarEmail,
  parseContactosCampoRows,
  parseEmailsManuales,
  type ContactoCampoTipo,
  type ParseContactosCampoResult,
} from "@/lib/contactosCampo";
import { errorMessage } from "@/lib/errorMessage";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type FiltroTipo = "todos" | ContactoCampoTipo;

const TIPO_LABEL: Record<ContactoCampoTipo, string> = {
  agricultor: "Agricultor",
  proveedor: "Proveedor",
};

const ESTADO_LABEL: Record<ComunicacionCampoEstado, string> = {
  enviada: "Enviada",
  borrador: "Borrador",
  error: "Error",
};

const ESTADO_BADGE_CLASS: Record<ComunicacionCampoEstado, string> = {
  enviada: "border-success/40 bg-success/10 text-success",
  borrador: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

const _dtf = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function formatFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return _dtf.format(d);
}

export default function ComunicacionesCampo() {
  const campo = useComunicacionesCampo();

  // ─── Redacción ────────────────────────────────────────────────────────────
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  // Destinatarios manuales (chips) + selección de agenda: se combinan al enviar.
  const [emailsManuales, setEmailsManuales] = useState<string[]>([]);
  const [entradaManual, setEntradaManual] = useState("");
  const [idsSeleccionados, setIdsSeleccionados] = useState<string[]>([]);
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<{
    estado: ComunicacionCampoEstado;
    enviados: number;
    fallidos: { email: string; error: string }[];
    motivo?: string;
  } | null>(null);

  // ─── Agenda: alta manual ──────────────────────────────────────────────────
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoEmail, setNuevoEmail] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState<ContactoCampoTipo>("agricultor");

  // ─── Agenda: importación Excel (dropzone → preview → confirmar) ──────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ParseContactosCampoResult | null>(null);
  const [importFilename, setImportFilename] = useState("");
  const [importTipoDefecto, setImportTipoDefecto] = useState<ContactoCampoTipo>("agricultor");
  const [importRows, setImportRows] = useState<unknown[][] | null>(null);
  const [parseando, setParseando] = useState(false);

  const noConfigurado = campo.historial[0]?.estado === "borrador";

  const contactosActivos = useMemo(() => campo.contactos.filter((c) => c.activo), [campo.contactos]);

  const contactosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return contactosActivos.filter((c) => {
      if (filtroTipo !== "todos" && c.tipo !== filtroTipo) return false;
      if (!q) return true;
      return c.nombre.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    });
  }, [contactosActivos, filtroTipo, busqueda]);

  // Destinatarios combinados (manual + agenda), deduplicados por email.
  const destinatarios: DestinatarioCampo[] = useMemo(() => {
    const porEmail = new Map<string, DestinatarioCampo>();
    for (const c of contactosActivos) {
      if (idsSeleccionados.includes(c.id)) {
        porEmail.set(normalizarEmail(c.email), { nombre: c.nombre, email: c.email });
      }
    }
    for (const email of emailsManuales) {
      const clave = normalizarEmail(email);
      if (!porEmail.has(clave)) porEmail.set(clave, { nombre: email.split("@")[0], email });
    }
    return Array.from(porEmail.values());
  }, [contactosActivos, idsSeleccionados, emailsManuales]);

  function agregarEmailsManuales() {
    if (!entradaManual.trim()) return;
    const { validos, invalidos } = parseEmailsManuales(entradaManual);
    if (validos.length > 0) {
      setEmailsManuales((prev) => Array.from(new Set([...prev, ...validos])));
    }
    if (invalidos.length > 0) {
      toast({
        title: "Emails no válidos",
        description: `Se han ignorado: ${invalidos.join(", ")}`,
        variant: "destructive",
      });
    }
    setEntradaManual("");
  }

  function onEntradaManualKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      agregarEmailsManuales();
    }
  }

  function quitarEmailManual(email: string) {
    setEmailsManuales((prev) => prev.filter((e) => e !== email));
  }

  function toggleContacto(id: string) {
    setIdsSeleccionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function seleccionarVisibles() {
    setIdsSeleccionados((prev) => Array.from(new Set([...prev, ...contactosFiltrados.map((c) => c.id)])));
  }

  function limpiarSeleccion() {
    setIdsSeleccionados([]);
  }

  function validarAntesDeEnviar(): boolean {
    if (!asunto.trim()) {
      toast({ title: "Escribe un asunto", variant: "destructive" });
      return false;
    }
    if (!cuerpo.trim()) {
      toast({ title: "Escribe el cuerpo del mensaje", variant: "destructive" });
      return false;
    }
    if (destinatarios.length === 0) {
      toast({
        title: "Sin destinatarios",
        description: "Añade emails a mano o marca contactos de la agenda.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  }

  async function handleEnviar() {
    setConfirmarEnvio(false);
    try {
      const resultado = await campo.enviarComunicacion.mutateAsync({ asunto, cuerpo, destinatarios });
      setUltimoResultado({
        estado: resultado.estado,
        enviados: resultado.enviados,
        fallidos: resultado.fallidos,
        motivo: resultado.motivo,
      });

      if (resultado.estado === "enviada") {
        toast({
          title: "Comunicado enviado",
          description: `${resultado.enviados} correo(s) enviado(s)${resultado.fallidos.length > 0 ? `, ${resultado.fallidos.length} fallido(s)` : ""}.`,
        });
        setAsunto("");
        setCuerpo("");
        setEmailsManuales([]);
        setIdsSeleccionados([]);
      } else if (resultado.estado === "borrador") {
        toast({
          title: "Guardado como borrador",
          description: "El envío de correos aún no está activo. Se enviará cuando se configure el proveedor de correo.",
        });
        setAsunto("");
        setCuerpo("");
        setEmailsManuales([]);
        setIdsSeleccionados([]);
      } else {
        toast({
          title: "Error al enviar",
          description: resultado.fallidos[0]?.error ?? "No se pudo contactar con el servicio de envío.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({ title: "Error al guardar el comunicado", description: errorMessage(error), variant: "destructive" });
    }
  }

  // ─── Agenda: alta manual ──────────────────────────────────────────────────

  async function handleCrearContacto() {
    if (!nuevoNombre.trim()) {
      toast({ title: "Escribe el nombre del contacto", variant: "destructive" });
      return;
    }
    if (!esEmailValido(nuevoEmail)) {
      toast({ title: "Email no válido", description: nuevoEmail.trim() || "Escribe un email.", variant: "destructive" });
      return;
    }
    try {
      await campo.crearContacto.mutateAsync({ nombre: nuevoNombre, email: nuevoEmail, tipo: nuevoTipo });
      toast({ title: "Contacto añadido", description: `${nuevoNombre.trim()} (${TIPO_LABEL[nuevoTipo]})` });
      setNuevoNombre("");
      setNuevoEmail("");
    } catch (error) {
      toast({ title: "No se pudo añadir el contacto", description: errorMessage(error), variant: "destructive" });
    }
  }

  async function handleToggleActivo(id: string, activo: boolean) {
    try {
      await campo.setContactoActivo.mutateAsync({ id, activo });
    } catch (error) {
      toast({ title: "No se pudo actualizar el contacto", description: errorMessage(error), variant: "destructive" });
    }
  }

  // ─── Agenda: importación Excel ────────────────────────────────────────────

  async function handleFicheroImport(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setParseando(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][];
      setImportRows(rows);
      setImportFilename(file.name);
      setImportPreview(parseContactosCampoRows(rows, importTipoDefecto));
    } catch (error) {
      toast({ title: "No se pudo leer el fichero", description: errorMessage(error), variant: "destructive" });
    } finally {
      setParseando(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onDropImport(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (parseando || campo.importarContactos.isPending) return;
    void handleFicheroImport(e.dataTransfer.files);
  }

  function cambiarTipoDefecto(tipo: ContactoCampoTipo) {
    setImportTipoDefecto(tipo);
    // Reparsear con el nuevo tipo por defecto para que el preview sea fiel.
    if (importRows) setImportPreview(parseContactosCampoRows(importRows, tipo));
  }

  function cancelarImport() {
    setImportPreview(null);
    setImportRows(null);
    setImportFilename("");
  }

  async function confirmarImport() {
    if (!importPreview || importPreview.contactos.length === 0) return;
    try {
      const n = await campo.importarContactos.mutateAsync(importPreview.contactos);
      toast({ title: "Agenda actualizada", description: `${n} contacto(s) importado(s) o actualizado(s).` });
      cancelarImport();
    } catch (error) {
      toast({ title: "Error al importar", description: errorMessage(error), variant: "destructive" });
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (campo.access.isLoading) {
    return (
      <div className="page-shell">
        <Header />
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!campo.access.hasAccess) {
    return (
      <div className="page-shell">
        <Header />
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Acceso restringido</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Esta sección es exclusiva de Jesús (jesus@lasartesat.es) y administración.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <Header />

      {campo.infraPendiente && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            La base de datos de esta sección aún no está preparada (migración pendiente de aplicar).
            La agenda y el historial aparecerán en cuanto se active.
          </p>
        </div>
      )}

      {noConfigurado && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            El envío de correos aún no está activo. Puedes preparar y guardar comunicados;
            se enviarán cuando se configure el proveedor de correo.
          </p>
        </div>
      )}

      {/* ─── Redactar comunicado ─────────────────────────────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Redactar comunicado de campaña</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Asunto</Label>
            <Input value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="Asunto del correo" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Cuerpo</Label>
            <Textarea
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              rows={6}
              placeholder="Qué hay que hacer para la campaña que entra…"
            />
            <p className="text-[11px] text-muted-foreground">
              Puedes usar <code className="rounded bg-muted px-1 py-0.5">{"{nombre}"}</code> — se sustituye por el
              nombre de cada destinatario al enviar.
            </p>
          </div>

          {/* Destinatarios: manual + agenda, combinables */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Emails sueltos (a mano)</Label>
              <div className="flex gap-2">
                <Input
                  value={entradaManual}
                  onChange={(e) => setEntradaManual(e.target.value)}
                  onKeyDown={onEntradaManualKeyDown}
                  onBlur={agregarEmailsManuales}
                  placeholder="pepe@finca.es, riegos@sumin.com…"
                  className="h-9"
                />
                <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 shrink-0" onClick={agregarEmailsManuales}>
                  <Plus className="h-3.5 w-3.5" /> Añadir
                </Button>
              </div>
              {emailsManuales.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {emailsManuales.map((email) => (
                    <Badge key={email} variant="outline" className="gap-1 pr-1 text-xs font-normal">
                      {email}
                      <button
                        type="button"
                        onClick={() => quitarEmailManual(email)}
                        className="rounded-full p-0.5 hover:bg-muted"
                        aria-label={`Quitar ${email}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Puedes pegar varios separados por comas o saltos de línea.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs font-medium">Desde la agenda ({contactosActivos.length})</Label>
                <div className="flex gap-1">
                  {(["todos", "agricultor", "proveedor"] as const).map((f) => (
                    <Button
                      key={f}
                      type="button"
                      size="sm"
                      variant={filtroTipo === f ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      onClick={() => setFiltroTipo(f)}
                    >
                      {f === "todos" ? "Todos" : f === "agricultor" ? "Agricultores" : "Proveedores"}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por nombre o email…"
                  className="h-9 pl-8"
                />
              </div>
              <ScrollArea className="h-44 rounded-lg border border-[var(--glass-border)]">
                <div className="divide-y divide-[var(--glass-border)]">
                  {contactosFiltrados.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                      {contactosActivos.length === 0
                        ? "La agenda está vacía. Añade contactos abajo o importa un Excel."
                        : "Sin resultados."}
                    </p>
                  ) : (
                    contactosFiltrados.map((c) => (
                      <label
                        key={c.id}
                        htmlFor={`contacto-${c.id}`}
                        className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-[var(--glass-bg)]"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Checkbox
                            id={`contacto-${c.id}`}
                            checked={idsSeleccionados.includes(c.id)}
                            onCheckedChange={() => toggleContacto(c.id)}
                          />
                          <span className="min-w-0">
                            <span className="block truncate">{c.nombre}</span>
                            <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                          </span>
                        </span>
                        <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                          {TIPO_LABEL[c.tipo]}
                        </Badge>
                      </label>
                    ))
                  )}
                </div>
              </ScrollArea>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={seleccionarVisibles}>
                  Marcar visibles ({contactosFiltrados.length})
                </Button>
                {idsSeleccionados.length > 0 && (
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={limpiarSeleccion}>
                    Quitar selección
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-muted-foreground" />
              Se enviará a <span className="font-semibold tabular-nums">{formatNumber(destinatarios.length)}</span> destinatario(s)
            </span>
            <Button
              onClick={() => {
                if (validarAntesDeEnviar()) setConfirmarEnvio(true);
              }}
              disabled={campo.enviarComunicacion.isPending}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {campo.enviarComunicacion.isPending ? "Enviando…" : noConfigurado ? "Guardar borrador" : "Enviar comunicado"}
            </Button>
          </div>

          {ultimoResultado && (
            <div
              className={cn(
                "space-y-1 rounded-lg border px-3 py-2.5 text-sm",
                ultimoResultado.estado === "error"
                  ? "border-destructive/40 bg-destructive/10"
                  : "border-[var(--glass-border)] bg-[var(--glass-bg)]",
              )}
            >
              <p className="flex items-center gap-1.5 font-medium">
                <EstadoIcon estado={ultimoResultado.estado} />
                {ultimoResultado.estado === "enviada" && `Comunicado enviado: ${ultimoResultado.enviados} correo(s).`}
                {ultimoResultado.estado === "borrador" && "Guardado como borrador (envío de correos sin activar)."}
                {ultimoResultado.estado === "error" && "El comunicado no se pudo enviar."}
              </p>
              {ultimoResultado.fallidos.length > 0 && (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {ultimoResultado.fallidos.map((f) => (
                    <li key={f.email}>
                      <span className="font-medium">{f.email}</span>: {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmación de envío */}
      <AlertDialog open={confirmarEnvio} onOpenChange={setConfirmarEnvio}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Enviar el comunicado?</AlertDialogTitle>
            <AlertDialogDescription>
              Se enviará «{asunto.trim()}» a {formatNumber(destinatarios.length)} destinatario(s)
              {noConfigurado ? " (se guardará como borrador: el envío de correos aún no está activo)" : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleEnviar()}>
              {noConfigurado ? "Guardar borrador" : "Enviar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Agenda ──────────────────────────────────────────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Agenda de agricultores y proveedores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Alta manual */}
          <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Nombre</Label>
              <Input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nombre del contacto" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Email</Label>
              <Input value={nuevoEmail} onChange={(e) => setNuevoEmail(e.target.value)} placeholder="contacto@dominio.es" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Tipo</Label>
              <Select value={nuevoTipo} onValueChange={(v) => setNuevoTipo(v as ContactoCampoTipo)}>
                <SelectTrigger className="h-9 w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agricultor">Agricultor</SelectItem>
                  <SelectItem value="proveedor">Proveedor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              onClick={() => void handleCrearContacto()}
              disabled={campo.crearContacto.isPending}
              className="h-9 gap-1.5"
            >
              <UserPlus className="h-4 w-4" /> Añadir
            </Button>
          </div>

          {/* Importación Excel: dropzone → preview → confirmar */}
          {!importPreview ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDropImport}
              className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-6 text-center"
            >
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Arrastra aquí un Excel con la agenda (columnas nombre, email y, si lo tienes, tipo)…
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={parseando}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                {parseando ? "Leyendo…" : "…o elige el fichero"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e: ChangeEvent<HTMLInputElement>) => void handleFicheroImport(e.target.files)}
              />
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  {importFilename}
                </p>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Tipo si no viene en el fichero:</Label>
                  <Select value={importTipoDefecto} onValueChange={(v) => cambiarTipoDefecto(v as ContactoCampoTipo)}>
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agricultor">Agricultor</SelectItem>
                      <SelectItem value="proveedor">Proveedor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="text-sm">
                <span className="font-semibold tabular-nums">{formatNumber(importPreview.contactos.length)}</span> contacto(s) listos para importar
                {importPreview.descartados.length > 0 && (
                  <span className="text-warning"> · {importPreview.descartados.length} fila(s) descartada(s)</span>
                )}
              </p>

              {importPreview.contactos.length > 0 && (
                <ScrollArea className="max-h-44 rounded-md border border-[var(--glass-border)]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--glass-border)] text-left text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">Nombre</th>
                        <th className="px-2 py-1.5 font-medium">Email</th>
                        <th className="px-2 py-1.5 font-medium">Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.contactos.slice(0, 30).map((c) => (
                        <tr key={c.email} className="border-b border-[var(--glass-border)] last:border-0">
                          <td className="truncate px-2 py-1.5">{c.nombre}</td>
                          <td className="truncate px-2 py-1.5">{c.email}</td>
                          <td className="px-2 py-1.5">{TIPO_LABEL[c.tipo]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importPreview.contactos.length > 30 && (
                    <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      … y {importPreview.contactos.length - 30} más.
                    </p>
                  )}
                </ScrollArea>
              )}

              {importPreview.descartados.length > 0 && (
                <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  <p className="flex items-center gap-1.5 font-medium text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" /> Filas descartadas
                  </p>
                  <ul className="max-h-24 space-y-0.5 overflow-y-auto text-muted-foreground">
                    {importPreview.descartados.map((d) => (
                      <li key={`${d.fila}-${d.motivo}`}>Fila {d.fila}: {d.motivo}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={cancelarImport}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={importPreview.contactos.length === 0 || campo.importarContactos.isPending}
                  onClick={() => void confirmarImport()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {campo.importarContactos.isPending
                    ? "Importando…"
                    : `Importar ${formatNumber(importPreview.contactos.length)} contacto(s)`}
                </Button>
              </div>
            </div>
          )}

          {/* Lista de contactos */}
          {campo.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : campo.contactos.length === 0 ? (
            <EmptyState icon={Sprout} text="Todavía no hay contactos en la agenda." />
          ) : (
            <ul className="divide-y divide-[var(--glass-border)] rounded-lg border border-[var(--glass-border)]">
              {campo.contactos.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm",
                    !c.activo && "opacity-55",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.nombre}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                    {TIPO_LABEL[c.tipo]}
                  </Badge>
                  {!c.activo && (
                    <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/10 text-[10px] text-warning">
                      Desactivado
                    </Badge>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={campo.setContactoActivo.isPending}
                    onClick={() => void handleToggleActivo(c.id, !c.activo)}
                  >
                    {c.activo ? "Desactivar" : "Reactivar"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ─── Historial ───────────────────────────────────────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Historial de comunicados</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {campo.isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : campo.historial.length === 0 ? (
            <EmptyState icon={Mail} text="Todavía no se ha enviado ningún comunicado de campaña." />
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {campo.historial.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{c.asunto}</span>
                      <Badge variant="outline" className={cn("text-[10px]", ESTADO_BADGE_CLASS[c.estado])}>
                        {ESTADO_LABEL[c.estado]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatFechaHora(c.created_at)} · {c.destinatarios?.length ?? 0} destinatario(s)
                      {c.fallidos && c.fallidos.length > 0 ? ` · ${c.fallidos.length} fallido(s)` : ""}
                    </p>
                  </div>
                  <EstadoIcon estado={c.estado} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EstadoIcon({ estado }: { estado: ComunicacionCampoEstado }) {
  if (estado === "enviada") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
  if (estado === "error") return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function Header() {
  return (
    <header className="page-header">
      <div>
        <p className="panel-kicker flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />
          Campo
        </p>
        <h1 className="page-title">Comunicaciones de campaña</h1>
        <p className="page-subtitle">
          Comunicados a agricultores y proveedores con lo que hay que preparar para la campaña que entra.
        </p>
      </div>
    </header>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof Mail; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/50" />
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
