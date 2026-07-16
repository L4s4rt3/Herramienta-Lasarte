// src/components/CerrarLoteDialog.tsx
// Diálogo de cierre manual de UN lote (entradas_bascula.cerrado_at +
// cierre_modo, ver src/lib/mermaLote.ts para qué hace cada modo). Compartido
// por TrazabilidadLote.tsx (ficha del lote) y EntradasBascula.tsx (fila de la
// tabla de stock): mismo texto, misma preselección por umbral, para que un
// usuario no vea dos comportamientos distintos según por dónde cierre.
import { useState } from "react";
import { Lock } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { criterioCierreModo, UMBRAL_CIERRE_CON_ANALISIS, type CierreModo } from "@/lib/entradasBascula";
import { formatKgCompact as formatKg, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CerrarLoteDialogProps {
  lote: string;
  /** Kg de entrada por báscula del lote. */
  kgEntrada: number;
  /** Kg ya contabilizados como procesados (calibrador + ajuste de stock) para calcular el % y preseleccionar el modo. */
  kgProcesado: number;
  trigger: React.ReactNode;
  onConfirm: (modo: CierreModo) => void;
  isPending?: boolean;
}

/** Texto explicativo de cada modo (reutilizado también por el diálogo de cierre en bloque). */
export const CIERRE_MODO_TEXTOS: Record<CierreModo, { titulo: string; detalle: string }> = {
  con_analisis: {
    titulo: "Contar el resto como merma y podrido",
    detalle: "El lote se procesó de verdad y el hueco es pérdida real (merma natural + podrido pre-calibrador).",
  },
  sin_registro: {
    titulo: "Sin análisis de pérdida",
    detalle: "Su procesado no consta bajo este código (compuestos, venta sin procesar…): sale del stock pero no se cuenta como pérdida.",
  },
};

export function CerrarLoteDialog({ lote, kgEntrada, kgProcesado, trigger, onConfirm, isPending }: CerrarLoteDialogProps) {
  const kgHueco = Math.max(0, kgEntrada - kgProcesado);
  const pctProcesado = kgEntrada > 0 ? (kgProcesado / kgEntrada) * 100 : 0;
  const sugerido = criterioCierreModo(kgEntrada, kgProcesado);
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<CierreModo>(sugerido);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setModo(sugerido); // reabre siempre con la sugerencia fresca, no con la última elección
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()} className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>¿Cerrar el lote {lote}?</AlertDialogTitle>
          <AlertDialogDescription>
            El lote se dará por terminado y dejará de aparecer como stock en cámara:{" "}
            <span className="font-semibold text-foreground">{formatPct(pctProcesado)}</span> procesado,{" "}
            <span className="font-semibold text-foreground">{formatKg(kgHueco)}</span> sin cuadrar. Elige qué hacer con ese hueco:
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup value={modo} onValueChange={(v) => setModo(v as CierreModo)} className="gap-2.5 py-1">
          {(["con_analisis", "sin_registro"] as const).map((valor) => (
            <label
              key={valor}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors",
                modo === valor
                  ? "border-primary/50 bg-primary/5"
                  : "border-[var(--glass-border)] hover:bg-[var(--glass-bg)]",
              )}
            >
              <RadioGroupItem value={valor} className="mt-0.5 shrink-0" />
              <span>
                <span className="block font-medium text-foreground">{CIERRE_MODO_TEXTOS[valor].titulo}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{CIERRE_MODO_TEXTOS[valor].detalle}</span>
              </span>
            </label>
          ))}
        </RadioGroup>

        <p className="text-xs text-muted-foreground">
          Sugerido: <span className="font-medium text-foreground">{CIERRE_MODO_TEXTOS[sugerido].titulo.toLowerCase()}</span>{" "}
          ({formatPct(pctProcesado)} procesado, umbral {formatPct(UMBRAL_CIERRE_CON_ANALISIS * 100)}). Puedes elegir el otro si sabes que no aplica.
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={() => onConfirm(modo)}>
            <Lock className="h-3.5 w-3.5" /> Cerrar lote
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
