// src/components/CalidadInformeDialog.tsx
// Ficha completa de un informe de calidad, reutilizable desde PartDetail
// (PartDetailCalidad) y Productores (CalidadProductorCard). Acepta tanto un
// CalidadLote completo como el historial resumido de Productores, siempre que
// tenga los mismos nombres de campo (ver CalidadInformeLote).
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Camera,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  MessageSquareText,
  RotateCcw,
} from "lucide-react";
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

/** Longitud máxima de un párrafo "digerible" antes de cortar por frases. */
const MAX_PARAGRAPH_LENGTH = 320;

/**
 * Divide un texto largo en párrafos legibles, sin recortar ni perder
 * información. Respeta los saltos de línea dobles ya presentes (párrafos
 * "naturales") y, si un bloque resultante es muy largo y no tiene saltos de
 * línea propios, lo subdivide por frases hasta un tamaño digerible.
 */
function splitIntoParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (block.length <= MAX_PARAGRAPH_LENGTH || block.includes("\n")) {
      paragraphs.push(block);
      continue;
    }

    // Bloque largo sin saltos de línea: subdividir por frases.
    const sentences = block.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) ?? [block];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > MAX_PARAGRAPH_LENGTH) {
        paragraphs.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) paragraphs.push(current.trim());
  }

  return paragraphs;
}

/** Renderiza un texto largo como una serie de párrafos espaciados y legibles. */
function ParagraphText({ text, className }: { text: string; className?: string }) {
  const paragraphs = splitIntoParagraphs(text);
  if (paragraphs.length === 0) return null;
  return (
    <div className={cn("space-y-2", className)}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line text-sm leading-relaxed">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

/** Sección con título pequeño + icono, para no repetir la maquetación. */
function Section({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function CalidadInformeDialog({ lote, open, onOpenChange, adjuntosCount = 0 }: CalidadInformeDialogProps) {
  const estado: CalidadInformeEstado = lote?.informe_estado ?? "borrador";

  const hasDefectos = !!lote && lote.defectos.length > 0;
  const hasDefectoOtro = !!lote?.defecto_otro?.trim();
  const hasObservacion = !!lote?.observacion?.trim();
  const hasAccion = !!lote?.accion_recomendada?.trim();
  const hasInforme = !!lote?.informe_generado?.trim();

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

              {(hasDefectos || hasDefectoOtro) && (
                <Section icon={<AlertTriangle className="h-3 w-3" />} title="Defectos">
                  {hasDefectos && (
                    <div className="flex flex-wrap gap-1.5">
                      {lote.defectos.map((defecto) => (
                        <Badge key={defecto} variant="outline" className="border-border bg-muted/40 text-foreground">
                          {defecto}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {hasDefectoOtro && (
                    <p className={cn("text-sm text-muted-foreground", hasDefectos && "mt-1.5")}>
                      Otro: {lote.defecto_otro}
                    </p>
                  )}
                </Section>
              )}

              {(hasObservacion || hasAccion) && (
                <div className={cn("grid gap-4", hasObservacion && hasAccion ? "sm:grid-cols-2" : "grid-cols-1")}>
                  {hasObservacion && (
                    <Section icon={<MessageSquareText className="h-3 w-3" />} title="Observación">
                      <ParagraphText text={lote.observacion!} />
                    </Section>
                  )}
                  {hasAccion && (
                    <Section icon={<ClipboardList className="h-3 w-3" />} title="Acción recomendada">
                      <ParagraphText text={lote.accion_recomendada!} />
                    </Section>
                  )}
                </div>
              )}

              {hasInforme && (
                <Section icon={<FileText className="h-3 w-3" />} title="Informe generado">
                  <div className="rounded-xl border border-border/70 bg-[var(--glass-bg)] p-3">
                    <ParagraphText text={lote.informe_generado!} />
                  </div>
                </Section>
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
