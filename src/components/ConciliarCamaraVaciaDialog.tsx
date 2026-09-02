// src/components/ConciliarCamaraVaciaDialog.tsx
// "Conciliar cámara vacía" (solo admin, botón por PROCEDENCIA en
// CamarasExternasCard.tsx): encargo del dueño 03-08-2026 ("ya no hay nada en
// cámaras externas, y aún así eso no se ha contabilizado"). Guadex/Zamexfruit
// están FÍSICAMENTE vacías pero la app sigue derivando camiones "en cámara"
// porque su lote no aparece en ninguna pasada de lotes_dia ni en
// lote_clasificacion: su fruta salió sin dejar rastro con su código. Casarlos
// a ciegas con otro lote sería inventar un cruce — este diálogo enseña la
// lista ANTES de tocar nada y explica exactamente qué va a pasar (ver
// src/lib/conciliarCamaraVacia.ts para la selección/preview pura).
import { useMemo, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ChevronDown, Loader2, Snowflake } from "lucide-react";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import type { CamionCamaraExternaRow } from "@/hooks/useCamarasExternas";
import type { EntradaBasculaRow } from "@/hooks/useEntradasBascula";
import type { SenalesRecepcion } from "@/lib/camarasExternas";
import {
  combinarNotaEntrada,
  notaConciliacionCamaraVacia,
  previsualizarConciliacionCamaraVacia,
  type EntradaBasculaParaConciliacion,
} from "@/lib/conciliarCamaraVacia";
import type { CierreModo } from "@/lib/entradasBascula";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKgCompact as formatKg, today } from "@/lib/format";

interface CerrarLotesEnBloqueMutation {
  mutateAsync: (variables: {
    items: Array<{ id: string; cierreModo: CierreModo }>;
    onProgress?: (hecho: number, total: number) => void;
  }) => Promise<{ cerrados: number }>;
  isPending: boolean;
}

interface MarcarConciliadosMutation {
  mutateAsync: (items: Array<{ id: string; notaEntrada: string; entradaLst1?: string }>) => Promise<{ marcados: number }>;
  isPending: boolean;
}

interface ConciliarCamaraVaciaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  procedencia: string;
  camiones: CamionCamaraExternaRow[];
  senales: SenalesRecepcion;
  /** Para resolver el id real de entradas_bascula por lote y saber si ya está cerrada. */
  entradas: EntradaBasculaRow[];
  cerrarLotesEnBloque: CerrarLotesEnBloqueMutation;
  marcarConciliados: MarcarConciliadosMutation;
}

export function ConciliarCamaraVaciaDialog({
  open, onOpenChange, procedencia, camiones, senales, entradas, cerrarLotesEnBloque, marcarConciliados,
}: ConciliarCamaraVaciaDialogProps) {
  const queryClient = useQueryClient();
  const [fecha, setFecha] = useState(today());
  const [confirmando, setConfirmando] = useState(false);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);

  const entradasParaConciliacion = useMemo((): EntradaBasculaParaConciliacion[] =>
    entradas.map((e) => ({ id: e.id, lote: e.lote, cerradoAt: e.cerrado_at ?? null })), [entradas]);

  const preview = useMemo(
    () => previsualizarConciliacionCamaraVacia<CamionCamaraExternaRow>(procedencia, camiones, senales, entradasParaConciliacion, today()),
    [procedencia, camiones, senales, entradasParaConciliacion],
  );

  const anyPending = cerrarLotesEnBloque.isPending || marcarConciliados.isPending;
  const total = preview.pendientes.length;

  const handleConfirmar = async () => {
    if (total === 0) return;
    setProgreso({ hecho: 0, total });
    try {
      // 1) Señal de salida en la báscula (fecha_salida_camara): mismo patrón
      // que el import del Excel de mermas (CardMermaCamara.tsx) — columna de
      // la migración 20260721150000, sin cast tipado hasta regenerar types.ts.
      const conEntrada = preview.pendientes.filter((p) => p.entradaId != null);
      for (const p of conEntrada) {
        const { error } = await supabase
          .from("entradas_bascula")
          .update({ fecha_salida_camara: fecha })
          .eq("id", p.entradaId as string);
        if (error) throw new Error(errorMessage(error));
      }

      // 2) Cierra como 'sin_registro' las que NO estaban ya cerradas a mano
      // (respeta el cierre existente de las que sí, no se pisa su modo).
      const itemsParaCerrar = conEntrada.filter((p) => !p.entradaYaCerrada);
      if (itemsParaCerrar.length > 0) {
        await cerrarLotesEnBloque.mutateAsync({
          items: itemsParaCerrar.map((p) => ({ id: p.entradaId as string, cierreModo: "sin_registro" as const })),
          onProgress: (hecho) => setProgreso({ hecho, total }),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["entradas_bascula"] });

      // 3) Nota rastreable en el propio camión (siempre) + señal de salida
      // directamente en el camión para las rarezas sin entrada localizable
      // (entrada_lst_1: mismo campo que estadoCamionExterno ya lee como
      // "recibido según el registro").
      await marcarConciliados.mutateAsync(
        preview.pendientes.map((p) => ({
          id: p.camion.id,
          notaEntrada: combinarNotaEntrada(p.camion.nota_entrada, notaConciliacionCamaraVacia(fecha)),
          ...(p.entradaId == null ? { entradaLst1: fecha } : {}),
        })),
      );
      setProgreso({ hecho: total, total });

      toast({
        title: `${procedencia} conciliada`,
        description: `${total} camión(es) declarados fuera de cámara (${formatKg(preview.kgTotal)})${preview.sinEntradaBascula.length ? `, ${preview.sinEntradaBascula.length} sin entrada de báscula localizable (solo se marcó el camión)` : ""}.`,
      });
      setConfirmando(false);
      onOpenChange(false);
    } catch (e) {
      toast({ title: "No se pudo completar la conciliación", description: errorMessage(e), variant: "destructive" });
    } finally {
      setProgreso(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!anyPending) onOpenChange(next); }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Snowflake className="h-4 w-4 text-info" /> Conciliar cámara vacía — {procedencia}
          </DialogTitle>
          <DialogDescription>
            La cámara de {procedencia} está físicamente vacía, pero la herramienta sigue derivando estos {total} camión
            (es) como "en cámara" porque su lote no aparece en ninguna pasada del calibrador (ni compuesta) ni en la
            clasificación de lotes: su fruta salió sin dejar rastro con su código (reidentificada, mezclada o vendida
            sin registrar). Nada se casa a ciegas con otro lote — confirma abajo para declararla vacía.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Fecha de salida a declarar</span>
          <GlassDatePicker value={fecha} onChange={setFecha} displayFormat="dd MMM yyyy" disabled={anyPending} />
        </div>

        {total === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0" /> No hay camiones de {procedencia} pendientes en cámara.
          </p>
        ) : (
          <div className="space-y-2.5">
            <div className="overflow-hidden rounded-lg border border-[var(--glass-border)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S/Ref</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead className="whitespace-nowrap">Almacenado</TableHead>
                    <TableHead className="text-right">Kg</TableHead>
                    <TableHead>Situación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.pendientes.map((p) => (
                    <TableRow key={p.camion.s_ref}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{p.camion.s_ref}</TableCell>
                      <TableCell className="font-medium tabular-nums">{p.camion.lote ?? "—"}</TableCell>
                      <TableCell className="max-w-[140px] truncate">{p.camion.proveedor ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(p.camion.fecha_almacenamiento)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatKg(Math.round(p.kgPendiente))}</TableCell>
                      <TableCell>
                        {p.entradaId == null ? (
                          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                            sin entrada de báscula
                          </Badge>
                        ) : p.entradaYaCerrada ? (
                          <Badge variant="outline" className="border-info/40 bg-info/10 text-[10px] text-info">
                            ya cerrada (no se pisa)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-[var(--glass-border)] text-[10px] text-muted-foreground">
                            se cierra sin registro
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              Total <span className="font-semibold text-foreground">{formatKg(preview.kgTotal)}</span> en {total} camión(es). Al
              confirmar: se pone la fecha de salida elegida en su entrada de báscula (pasan a "recibido"), se cierran
              como "sin análisis de pérdida" (su procesado no consta bajo este código: salen del stock sin contar como
              merma) y se añade una nota rastreable en cada camión.
            </p>

            {preview.sinEntradaBascula.length > 0 && (
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-left text-xs text-warning">
                  <span className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {preview.sinEntradaBascula.length} sin entrada de báscula localizable (rareza)
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-xs text-muted-foreground">
                  Su lote no tiene ninguna fila en entradas_bascula: no hay báscula que cerrar. Solo se marca la señal
                  en el propio camión (entrada_lst_1 + nota) para que deje de contar como "en cámara" — revisa a mano
                  si conviene crear su entrada:{" "}
                  {preview.sinEntradaBascula.map((p) => p.camion.lote ?? p.camion.s_ref).join(", ")}.
                </CollapsibleContent>
              </Collapsible>
            )}

            {preview.entradaYaCerrada.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-left text-xs text-info">
                  <span className="flex items-center gap-1.5 font-medium">
                    {preview.entradaYaCerrada.length} con la entrada ya cerrada a mano
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 rounded-lg border border-info/30 bg-info/5 p-2.5 text-xs text-muted-foreground">
                  Su cierre_modo existente no se toca (solo se pone la fecha de salida):{" "}
                  {preview.entradaYaCerrada.map((p) => p.camion.lote ?? p.camion.s_ref).join(", ")}.
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        {progreso && (
          <div className="space-y-1.5">
            <Progress value={progreso.total > 0 ? (progreso.hecho / progreso.total) * 100 : 0} />
            <p className="text-center text-xs text-muted-foreground">{progreso.hecho} / {progreso.total} camión(es) conciliados</p>
          </div>
        )}

        <AlertDialog open={confirmando} onOpenChange={(next) => { if (!anyPending) setConfirmando(next); }}>
          <AlertDialogTrigger asChild>
            <Button disabled={total === 0 || anyPending} className="self-end">
              {anyPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Snowflake className="h-3.5 w-3.5" />}
              Declarar {procedencia} vacía ({total})
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Declarar {procedencia} vacía?</AlertDialogTitle>
              <AlertDialogDescription>
                Se conciliarán {total} camión(es) ({formatKg(preview.kgTotal)}) con fecha de salida {formatDate(fecha)}.
                Esta acción no se puede deshacer con un botón — si te equivocas, habrá que reabrir a mano cada entrada
                de báscula afectada.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={anyPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={anyPending} onClick={(e) => { e.preventDefault(); void handleConfirmar(); }}>
                {anyPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirmar conciliación
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
