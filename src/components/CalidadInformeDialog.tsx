// src/components/CalidadInformeDialog.tsx
// Ficha completa de un informe de calidad, reutilizable desde PartDetail
// (PartDetailCalidad) y Productores (CalidadProductorCard). Acepta tanto un
// CalidadLote completo como el historial resumido de Productores, siempre que
// tenga los mismos nombres de campo (ver CalidadInformeLote).
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Camera, CheckCircle2, ExternalLink, FileText, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCalidadDate, formatHoraCorta, type CalidadEstado, type CalidadInformeEstado } from "@/lib/calidad";
import { cn } from "@/lib/utils";

const QUALITY_STYLE: Record<CalidadEstado, string> = {
  Excelente: "border-emerald-600/35 bg-emerald-600/12 text-emerald-800 dark:text-emerald-200",
  Bueno: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  Regular: "border-amber-500/35 bg-amber-500/14 text-amber-700 dark:text-amber-300",
  Deficiente: "border-orange-500/35 bg-orange-500/14 text-orange-700 dark:text-orange-300",
  Pésimo: "border-red-500/35 bg-red-500/12 text-red-700 dark:text-red-300",
};

const INFORME_ESTADO_LABEL: Record<CalidadInformeEstado, string> = {
  borrador: "Borrador",
  generado: "Generado",
  validado: "Validado",
  reabierto: "Reabierto",
};

const INFORME_ESTADO_STYLE: Record<CalidadInformeEstado, string> = {
  borrador: "border-border bg-muted/40 text-muted-foreground",
  generado: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  validado: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  reabierto: "border-amber-500/35 bg-amber-500/14 text-amber-700 dark:text-amber-300",
};

/**
 * Shape mínimo que necesita la ficha. Un `CalidadLote` completo (lib/calidad)
 * lo cumple directamente; el historial resumido de Productores también, en
 * cuanto se enriquece con estos mismos nombres de campo.
 */
export interface CalidadInformeLote {
  id?: string;
  fecha: string;
  numero_lote: string;
  productor_finca_nombre: string;
  producto?: string | null;
  variedad?: string | null;
  cantidad?: string | null;
  hora: string | null;
  calidad: CalidadEstado;
  defectos: string[];
  defecto_otro?: string | null;
  observacion?: string | null;
  accion_recomendada?: string | null;
  informe_estado?: CalidadInformeEstado | null;
  informe_generado?: string | null;
  aerobotics_realizado?: boolean | null;
  validado_at?: string | null;
  validado_by?: string | null;
}

interface CalidadInformeDialogProps {
  lote: CalidadInformeLote | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adjuntosCount?: number;
}

function Field({ label, value, icon }: { label: string; value?: string | null; icon?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate text-sm">{value || "—"}</p>
    </div>
  );
}

export function CalidadInformeDialog({ lote, open, onOpenChange, adjuntosCount = 0 }: CalidadInformeDialogProps) {
  const estado: CalidadInformeEstado = lote?.informe_estado ?? "borrador";

  return (
    <Dialog open={open && !!lote} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {lote && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn(QUALITY_STYLE[lote.calidad])}>
                  {lote.calidad}
                </Badge>
                <Badge variant="outline" className={cn(INFORME_ESTADO_STYLE[estado])}>
                  {estado === "validado" && <CheckCircle2 className="mr-1 h-3 w-3" />}
                  {estado === "reabierto" && <RotateCcw className="mr-1 h-3 w-3" />}
                  Informe {INFORME_ESTADO_LABEL[estado]}
                </Badge>
                {lote.aerobotics_realizado && (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                    <BadgeCheck className="mr-1 h-3 w-3" />
                    Aerobotics
                  </Badge>
                )}
              </div>
              <DialogTitle className="mt-2 truncate">
                {lote.numero_lote || "Lote sin número"} · {lote.productor_finca_nombre || "Productor/Finca pendiente"}
              </DialogTitle>
              <DialogDescription className="tabular-nums">
                {formatCalidadDate(lote.fecha)}
                {lote.hora ? ` · ${formatHoraCorta(lote.hora) ?? lote.hora}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Producto" value={lote.producto} />
                <Field label="Variedad" value={lote.variedad} />
                <Field label="Box" value={lote.cantidad} />
                <Field
                  label="Adjuntos"
                  icon={<Camera className="h-3 w-3" />}
                  value={adjuntosCount > 0 ? `${adjuntosCount} adjunto${adjuntosCount === 1 ? "" : "s"}` : "Sin adjuntos"}
                />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Defectos</p>
                <p className="mt-1 text-sm">
                  {lote.defectos.length > 0 ? lote.defectos.join(", ") : "Sin defectos marcados"}
                  {lote.defectos.includes("Otro") && lote.defecto_otro ? ` — ${lote.defecto_otro}` : ""}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observación</p>
                  <p className="mt-1 whitespace-pre-line text-sm">{lote.observacion || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acción recomendada</p>
                  <p className="mt-1 whitespace-pre-line text-sm">{lote.accion_recomendada || "—"}</p>
                </div>
              </div>

              {lote.informe_generado && (
                <div>
                  <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <FileText className="h-3 w-3" />
                    Informe generado
                  </p>
                  <div className="mt-1 whitespace-pre-line rounded-xl border border-border/70 bg-[var(--glass-bg)] p-3 text-sm leading-relaxed">
                    {lote.informe_generado}
                  </div>
                </div>
              )}

              {lote.validado_at && (
                <p className="text-xs text-muted-foreground">
                  Validado el {formatCalidadDate(lote.validado_at)}
                  {lote.validado_by ? ` por ${lote.validado_by}` : ""}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" className="glass glass-hover" asChild>
                <Link to={`/calidad?fecha=${lote.fecha}`} onClick={() => onOpenChange(false)}>
                  <ExternalLink className="h-4 w-4" />
                  Abrir en Calidad
                </Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
