// src/pages/RrhhAusencias.tsx
// Sección "Ausencias y bajas" de RRHH: KPIs del periodo, filtros (rango de
// fechas, persona, solo-sin-justificar), lista cronológica de faltas con
// acción "Justificar" (nota + foto/PDF opcional) y bloque de bajas laborales
// activas/recientes. rrhh_justificantes tiene RLS solo rrhh/admin: si el
// select falla por permiso, se degrada con un aviso en vez de un error crudo.
import { useMemo, useState } from "react";
import {
  AlertTriangle, Calendar as CalendarIcon, CheckCircle2, Clock, FileText,
  Filter, Paperclip, ShieldAlert, Upload, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  BAJA_LABORAL_MOTIVO, useRrhhAusencias, type FaltaConEstado,
} from "@/hooks/useRrhhAusencias";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, today, toISODateLocal } from "@/lib/format";
import { cn } from "@/lib/utils";

const RANGO_DEFAULT_DIAS = 30;

function fechaHaceNDias(n: number): string {
  return toISODateLocal(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

function motivoLabel(motivo: string | null): string {
  if (!motivo) return "Sin motivo especificado";
  if (motivo === BAJA_LABORAL_MOTIVO) return "Baja laboral";
  return motivo;
}

export default function RrhhAusencias() {
  const [desde, setDesde] = useState(() => fechaHaceNDias(RANGO_DEFAULT_DIAS));
  const [hasta, setHasta] = useState(() => today());
  const [personaFiltro, setPersonaFiltro] = useState("todas");
  const [soloSinJustificar, setSoloSinJustificar] = useState(false);
  const [justificando, setJustificando] = useState<FaltaConEstado | null>(null);

  const {
    trabajadores, faltas, bajasActivas, bajas, isLoading, forbidden, error,
    urlJustificante, justificarFalta,
  } = useRrhhAusencias({ desde, hasta });

  const faltasFiltradas = useMemo(() => {
    return faltas.filter((falta) => {
      if (personaFiltro !== "todas" && falta.trabajadorId !== personaFiltro) return false;
      if (soloSinJustificar && falta.justificante) return false;
      return true;
    });
  }, [faltas, personaFiltro, soloSinJustificar]);

  const totalFaltas = faltas.length;
  const totalJustificadas = faltas.filter((f) => f.justificante).length;
  const totalSinJustificar = totalFaltas - totalJustificadas;
  const totalBajasActivas = bajasActivas.length;

  const trabajadoresPorId = useMemo(() => new Map(trabajadores.map((t) => [t.id, t])), [trabajadores]);

  const bajasRecientes = useMemo(
    () => [...bajas].sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)).slice(0, 12),
    [bajas],
  );

  async function handleVerJustificante(path: string) {
    try {
      const url = await urlJustificante(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "No se pudo abrir el justificante", description: errorMessage(err), variant: "destructive" });
    }
  }

  if (forbidden) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <div>
            <p className="panel-kicker">RRHH</p>
            <h1 className="page-title">Ausencias y bajas</h1>
            <p className="page-subtitle">Faltas, justificantes y bajas laborales del personal.</p>
          </div>
        </header>
        <Card className="glass-accented">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShieldAlert className="h-10 w-10 text-warning" />
            <div>
              <h2 className="text-xl font-semibold">Solo RRHH y administración</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                No tienes permiso para ver los justificantes de ausencias. Contacta con RRHH o administración
                si necesitas acceso a esta sección.
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
          <h1 className="page-title">Ausencias y bajas</h1>
          <p className="page-subtitle">Faltas, justificantes y bajas laborales del personal.</p>
        </div>
      </header>

      {error ? (
        <Card className="glass-accented border-destructive/40">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {errorMessage(error)}
          </CardContent>
        </Card>
      ) : null}

      {/* ── KPIs ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Faltas totales" value={totalFaltas} icon={Clock} accent="primary" loading={isLoading} />
        <KpiCard label="Justificadas" value={totalJustificadas} icon={CheckCircle2} accent="success" loading={isLoading} />
        <KpiCard label="Sin justificar" value={totalSinJustificar} icon={AlertTriangle} accent="warning" loading={isLoading} />
        <KpiCard label="Bajas activas" value={totalBajasActivas} icon={ShieldAlert} accent="destructive" loading={isLoading} />
      </div>

      {/* ── Filtros ──────────────────────────────────────────────── */}
      <div className="section-toolbar glass-overlay flex flex-wrap items-center gap-3">
        <div className="glass-accented flex items-center gap-2 rounded-xl px-3 py-1.5">
          <CalendarIcon className="h-4 w-4 shrink-0 text-primary/75" />
          <GlassDatePicker value={desde} onChange={setDesde} label="Desde" displayFormat="dd MMM yyyy" />
          <span className="text-xs text-muted-foreground">a</span>
          <GlassDatePicker value={hasta} onChange={setHasta} label="Hasta" displayFormat="dd MMM yyyy" />
        </div>

        <div className="mx-1 hidden h-6 w-px bg-[var(--glass-border)] sm:block" />

        <div className="flex min-w-[180px] items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-primary/75" />
          <Select value={personaFiltro} onValueChange={setPersonaFiltro}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Persona" />
            </SelectTrigger>
            <SelectContent className="glass-overlay">
              <SelectItem value="todas">Todas las personas</SelectItem>
              {trabajadores.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mx-1 hidden h-6 w-px bg-[var(--glass-border)] sm:block" />

        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={soloSinJustificar} onCheckedChange={setSoloSinJustificar} />
          Solo sin justificar
        </label>

        <Badge variant="outline" className="ml-auto rounded-full">
          <Filter className="mr-1 h-3 w-3" />
          {faltasFiltradas.length} resultado(s)
        </Badge>
      </div>

      {/* ── Lista cronológica de faltas ──────────────────────────── */}
      <Card className="glass-accented">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary/75" />
            Faltas del periodo
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4 sm:p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : faltasFiltradas.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-success/60" />
              <p className="text-sm font-medium">Sin faltas en este periodo</p>
              <p className="text-xs">Ajusta el rango de fechas o los filtros para ver otros resultados.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {faltasFiltradas.map((falta) => (
                <li
                  key={`${falta.trabajadorId}-${falta.fecha}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--glass-bg-strong)] sm:px-5"
                >
                  <div className="flex min-w-[110px] items-center gap-1.5 text-sm font-semibold tabular-nums">
                    <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    {formatDate(falta.fecha)}
                  </div>
                  <div className="min-w-[160px] flex-1 truncate text-sm font-medium">{falta.nombre}</div>
                  <div className="min-w-[140px] flex-1 truncate text-xs text-muted-foreground">
                    {motivoLabel(falta.motivo)}
                  </div>
                  {falta.justificante ? (
                    <Badge className="border-success/40 bg-success/10 text-success" variant="outline">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Justificada
                    </Badge>
                  ) : (
                    <Badge className="border-warning/40 bg-warning/10 text-warning" variant="outline">
                      <AlertTriangle className="mr-1 h-3 w-3" /> Sin justificar
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {falta.justificante?.archivo_path ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="glass glass-hover h-8"
                        onClick={() => handleVerJustificante(falta.justificante!.archivo_path!)}
                      >
                        <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Ver
                      </Button>
                    ) : null}
                    {!falta.justificante ? (
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => setJustificando(falta)}
                      >
                        <FileText className="mr-1.5 h-3.5 w-3.5" /> Justificar
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Bajas laborales ──────────────────────────────────────── */}
      <Card className="glass-accented">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary/75" />
            Bajas laborales
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4 sm:p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : bajasRecientes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-success/60" />
              <p className="text-sm font-medium">Sin bajas laborales registradas</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {bajasRecientes.map((baja) => {
                const nombre = trabajadoresPorId.get(baja.trabajador_id)?.nombre ?? "Trabajador desconocido";
                const activa = baja.fecha_fin == null;
                return (
                  <li key={baja.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-[160px] flex-1 truncate text-sm font-medium">{nombre}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {formatDate(baja.fecha_inicio)} — {baja.fecha_fin ? formatDate(baja.fecha_fin) : "en curso"}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "ml-auto",
                        activa ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground",
                      )}
                    >
                      {activa ? "Activa" : "Finalizada"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <JustificarDialog
        falta={justificando}
        onClose={() => setJustificando(null)}
        onSubmit={async (notas, archivo) => {
          if (!justificando) return;
          try {
            await justificarFalta.mutateAsync({
              trabajadorId: justificando.trabajadorId,
              fecha: justificando.fecha,
              notas,
              archivo,
            });
            toast({ title: "Falta justificada", description: `${justificando.nombre} — ${formatDate(justificando.fecha)}` });
            setJustificando(null);
          } catch (err) {
            toast({ title: "Error al justificar", description: errorMessage(err), variant: "destructive" });
          }
        }}
        saving={justificarFalta.isPending}
      />
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon: Icon, accent, loading,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: "primary" | "success" | "warning" | "destructive";
  loading: boolean;
}) {
  const accentText: Record<typeof accent, string> = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };

  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="panel-kicker">{label}</p>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-16" />
            ) : (
              <p className="mt-2 text-2xl font-semibold tabular-nums sm:text-3xl">{value}</p>
            )}
          </div>
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl glass-strong sm:h-11 sm:w-11", accentText[accent])}>
            <Icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Dialog de justificación ─────────────────────────────────────────────

function JustificarDialog({
  falta, onClose, onSubmit, saving,
}: {
  falta: FaltaConEstado | null;
  onClose: () => void;
  onSubmit: (notas: string, archivo: File | null) => void | Promise<void>;
  saving: boolean;
}) {
  const [notas, setNotas] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);

  const open = falta !== null;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setNotas("");
      setArchivo(null);
      onClose();
    }
  }

  const puedeGuardar = notas.trim().length > 0 || archivo !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Justificar falta</DialogTitle>
        </DialogHeader>
        {falta ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-sm">
              <p className="font-semibold">{falta.nombre}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(falta.fecha)} · {motivoLabel(falta.motivo)}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rrhh-justificante-notas">Nota</Label>
              <Textarea
                id="rrhh-justificante-notas"
                placeholder="Motivo de la ausencia, referencia del parte médico, etc."
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={4}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rrhh-justificante-archivo">Justificante (foto o PDF) — opcional pero recomendado</Label>
              <label className="relative block">
                <input
                  id="rrhh-justificante-archivo"
                  type="file"
                  accept="image/*,application/pdf"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                />
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-[var(--glass-bg-strong)]">
                  <Upload className="h-4 w-4 shrink-0" />
                  {archivo ? archivo.name : "Adjuntar imagen o PDF"}
                </div>
              </label>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={() => onSubmit(notas, archivo)}
            disabled={!puedeGuardar || saving}
          >
            {saving ? "Guardando..." : "Guardar justificante"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
