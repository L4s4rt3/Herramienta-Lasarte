// src/pages/RrhhComunicaciones.tsx
// Sección "RRHH → Comunicaciones": avisos automáticos (horas acumuladas,
// saldo de vacaciones) y correos personalizados a una o varias personas,
// enviados por correo real vía Resend (Edge Function `enviar-comunicacion`).
// Si Resend todavía no está configurado, la comunicación se guarda igual
// como borrador — no bloquea la sección.
import { useMemo, useState } from "react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, Info, Mail, Search,
  Send, ShieldAlert, Users, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  useRrhhComunicaciones,
  type ComunicacionEstado,
  type ComunicacionTipo,
  type DestinatarioComunicacion,
  type RrhhComunicacionRow,
} from "@/hooks/useRrhhComunicaciones";
import { errorMessage } from "@/lib/errorMessage";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type ModoDestinatarios = "todos" | "zona" | "individual";

const _dtf = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function formatFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return _dtf.format(d);
}

const TIPO_LABEL: Record<ComunicacionTipo, string> = {
  personalizado: "Personalizado",
  aviso_horas: "Aviso de horas",
  aviso_vacaciones: "Aviso de vacaciones",
  aviso_generico: "Genérico",
};

const ESTADO_LABEL: Record<ComunicacionEstado, string> = {
  enviado: "Enviado",
  parcial: "Parcial",
  error: "Error",
  borrador: "Borrador",
};

const ESTADO_BADGE_CLASS: Record<ComunicacionEstado, string> = {
  enviado: "border-success/40 bg-success/10 text-success",
  parcial: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  borrador: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

const PLANTILLA_HORAS = {
  asunto: "Aviso: horas acumuladas",
  cuerpo: "Hola {nombre},\n\nTe informamos de que tienes {horas} horas acumuladas en tu bolsa de horas.\n\nUn saludo.",
};

const PLANTILLA_VACACIONES = {
  asunto: "Aviso: saldo de vacaciones",
  cuerpo: "Hola {nombre},\n\nTu saldo actual de vacaciones es de {vacaciones} días.\n\nUn saludo.",
};

export default function RrhhComunicaciones() {
  const rrhh = useRrhhComunicaciones();

  const [tipo, setTipo] = useState<ComunicacionTipo>("personalizado");
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [modo, setModo] = useState<ModoDestinatarios>("todos");
  const [zonaSeleccionada, setZonaSeleccionada] = useState<string>("");
  const [idsSeleccionados, setIdsSeleccionados] = useState<string[]>([]);
  const [busqueda, setBusqueda] = useState("");

  const incluirValores = tipo === "aviso_horas" || tipo === "aviso_vacaciones";

  const ultimaComunicacion = rrhh.historial[0] as RrhhComunicacionRow | undefined;
  const noConfigurado = ultimaComunicacion?.estado === "borrador";

  const trabajadoresFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return rrhh.trabajadores;
    return rrhh.trabajadores.filter((t) => t.nombre.toLowerCase().includes(q));
  }, [rrhh.trabajadores, busqueda]);

  // Grupo completo seleccionado (con y sin email), según el modo elegido.
  const grupoSeleccionado = useMemo(() => {
    if (modo === "todos") return rrhh.trabajadores;
    if (modo === "zona") return zonaSeleccionada ? rrhh.trabajadores.filter((t) => (t.zona ?? "").trim() === zonaSeleccionada) : [];
    return rrhh.trabajadores.filter((t) => idsSeleccionados.includes(t.id));
  }, [modo, zonaSeleccionada, idsSeleccionados, rrhh.trabajadores]);

  const destinatarios: DestinatarioComunicacion[] = useMemo(() => {
    if (modo === "todos") return rrhh.destinatariosTodos(incluirValores);
    if (modo === "zona") return zonaSeleccionada ? rrhh.destinatariosDeZona(zonaSeleccionada, incluirValores) : [];
    return rrhh.destinatariosDeIds(idsSeleccionados, incluirValores);
  }, [modo, zonaSeleccionada, idsSeleccionados, incluirValores, rrhh]);

  const sinEmailEnGrupo = grupoSeleccionado.length - destinatarios.length;

  function aplicarPlantilla(nuevoTipo: ComunicacionTipo, plantilla: { asunto: string; cuerpo: string } | null) {
    setTipo(nuevoTipo);
    if (plantilla) {
      setAsunto(plantilla.asunto);
      setCuerpo(plantilla.cuerpo);
    } else {
      setAsunto("");
      setCuerpo("");
    }
  }

  function toggleId(id: string) {
    setIdsSeleccionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function resetFormulario() {
    setAsunto("");
    setCuerpo("");
    setIdsSeleccionados([]);
  }

  async function handleEnviar() {
    if (!asunto.trim()) {
      toast({ title: "Escribe un asunto", variant: "destructive" });
      return;
    }
    if (!cuerpo.trim()) {
      toast({ title: "Escribe el cuerpo del mensaje", variant: "destructive" });
      return;
    }
    if (destinatarios.length === 0) {
      toast({ title: "Sin destinatarios", description: "Selecciona al menos una persona con email registrado.", variant: "destructive" });
      return;
    }

    try {
      const resultado = await rrhh.enviarComunicacion.mutateAsync({ asunto, cuerpo, tipo, destinatarios });

      if (resultado.estado === "enviado") {
        toast({ title: "Comunicación enviada", description: `${resultado.enviados} correo(s) enviado(s).` });
        resetFormulario();
      } else if (resultado.estado === "parcial") {
        toast({
          title: "Envío parcial",
          description: `${resultado.enviados} enviado(s), ${resultado.fallidos.length} fallido(s).`,
        });
        resetFormulario();
      } else if (resultado.estado === "borrador") {
        toast({
          title: "Guardado como borrador",
          description: "El envío de correos aún no está activo. Se enviará cuando se configure Resend.",
        });
        resetFormulario();
      } else {
        toast({
          title: "Error al enviar",
          description: resultado.fallidos[0]?.error ?? "No se pudo contactar con el servicio de envío.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({ title: "Error al guardar la comunicación", description: errorMessage(error), variant: "destructive" });
    }
  }

  if (rrhh.sinPermiso) {
    return (
      <div className="page-shell">
        <Header />
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
      <Header />

      {noConfigurado && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            El envío de correos aún no está activo (falta configurar Resend). Puedes preparar y guardar
            comunicaciones; se enviarán cuando se active.
          </p>
        </div>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Redactar comunicación</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={tipo === "aviso_horas" ? "default" : "outline"}
              onClick={() => aplicarPlantilla("aviso_horas", PLANTILLA_HORAS)}
              className="gap-1.5"
            >
              <Clock className="h-3.5 w-3.5" /> Aviso de horas acumuladas
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tipo === "aviso_vacaciones" ? "default" : "outline"}
              onClick={() => aplicarPlantilla("aviso_vacaciones", PLANTILLA_VACACIONES)}
              className="gap-1.5"
            >
              <CalendarClock className="h-3.5 w-3.5" /> Aviso de vacaciones
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tipo === "personalizado" ? "default" : "outline"}
              onClick={() => aplicarPlantilla("personalizado", null)}
              className="gap-1.5"
            >
              <Mail className="h-3.5 w-3.5" /> Mensaje personalizado
            </Button>
          </div>

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
              placeholder="Escribe el mensaje…"
            />
            <p className="text-[11px] text-muted-foreground">
              Puedes usar <code className="rounded bg-muted px-1 py-0.5">{"{nombre}"}</code>,{" "}
              <code className="rounded bg-muted px-1 py-0.5">{"{horas}"}</code> y{" "}
              <code className="rounded bg-muted px-1 py-0.5">{"{vacaciones}"}</code> — se sustituyen por
              persona al enviar.
            </p>
          </div>

          <div className="space-y-2.5">
            <Label className="text-xs font-medium">Destinatarios</Label>
            <RadioGroup value={modo} onValueChange={(v) => setModo(v as ModoDestinatarios)} className="gap-2.5">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="todos" id="modo-todos" />
                <Label htmlFor="modo-todos" className="cursor-pointer text-sm font-normal">
                  Toda la plantilla activa ({rrhh.trabajadores.length})
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="zona" id="modo-zona" />
                <Label htmlFor="modo-zona" className="cursor-pointer text-sm font-normal">Por zona</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="individual" id="modo-individual" />
                <Label htmlFor="modo-individual" className="cursor-pointer text-sm font-normal">Selección individual</Label>
              </div>
            </RadioGroup>

            {modo === "zona" && (
              <Select value={zonaSeleccionada} onValueChange={setZonaSeleccionada}>
                <SelectTrigger className="h-9 w-full sm:w-64">
                  <SelectValue placeholder="Selecciona una zona" />
                </SelectTrigger>
                <SelectContent>
                  {rrhh.zonas.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No hay zonas registradas.</div>
                  ) : (
                    rrhh.zonas.map((z) => (
                      <SelectItem key={z} value={z}>{z}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}

            {modo === "individual" && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar por nombre…"
                    className="h-9 pl-8"
                  />
                </div>
                <ScrollArea className="h-52 rounded-lg border border-[var(--glass-border)]">
                  <div className="divide-y divide-[var(--glass-border)]">
                    {trabajadoresFiltrados.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">Sin resultados.</p>
                    ) : (
                      trabajadoresFiltrados.map((t) => (
                        <label
                          key={t.id}
                          htmlFor={`trab-${t.id}`}
                          className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-[var(--glass-bg)]"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Checkbox
                              id={`trab-${t.id}`}
                              checked={idsSeleccionados.includes(t.id)}
                              onCheckedChange={() => toggleId(t.id)}
                            />
                            <span className="truncate">{t.nombre}</span>
                          </span>
                          {!t.email && (
                            <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/10 text-[10px] text-warning">
                              Sin email
                            </Badge>
                          )}
                        </label>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-muted-foreground" />
              Se enviará a <span className="font-semibold tabular-nums">{formatNumber(destinatarios.length)}</span> persona(s)
            </span>
            {sinEmailEnGrupo > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {sinEmailEnGrupo} persona(s) del grupo no tienen email y no recibirán nada
              </span>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleEnviar} disabled={rrhh.enviarComunicacion.isPending} className="gap-2">
              <Send className="h-4 w-4" />
              {rrhh.enviarComunicacion.isPending ? "Enviando…" : noConfigurado ? "Guardar borrador" : "Enviar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Historial de comunicaciones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rrhh.isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rrhh.historial.length === 0 ? (
            <EmptyState icon={Mail} text="Todavía no se ha enviado ninguna comunicación." />
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {rrhh.historial.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{c.asunto}</span>
                      <Badge variant="outline" className={cn("text-[10px]", ESTADO_BADGE_CLASS[c.estado])}>
                        {ESTADO_LABEL[c.estado]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {TIPO_LABEL[c.tipo]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatFechaHora(c.created_at)} · {c.destinatarios?.length ?? 0} destinatario(s)
                      {c.detalle_envio?.fallidos && c.detalle_envio.fallidos.length > 0
                        ? ` · ${c.detalle_envio.fallidos.length} fallido(s)`
                        : ""}
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

function EstadoIcon({ estado }: { estado: ComunicacionEstado }) {
  if (estado === "enviado") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
  if (estado === "parcial") return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />;
  if (estado === "error") return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function Header() {
  return (
    <header className="page-header">
      <div>
        <p className="panel-kicker flex items-center gap-1.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seccion-texto" aria-hidden="true" />RRHH</p>
        <h1 className="page-title">Comunicaciones</h1>
        <p className="page-subtitle">
          Avisos automáticos de horas y vacaciones, y correos personalizados a la plantilla.
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
