// src/components/ConfirmarLotesEnCamaraDialog.tsx
// "Confirmar lotes en cámara" (solo admin, botón en la pestaña Stock de
// Entradas): encargo del dueño 04-08-2026 tras inventariar físicamente la
// cámara 5 y encontrar 26 lotes INTACTOS a los que el derrame de la
// conciliación había atribuido 310 t fantasma (9 ya cerrados solos). Este
// diálogo es la vía para que dirección anote la confirmación FÍSICA
// (camara_confirmada_nombre/fecha, migración 20260804120000_camara_confirmada.sql)
// sin tocar SQL a mano: pega una lista de códigos, se buscan en báscula y se
// muestra claramente cuáles NO se encontraron (nunca se inventa un cruce) —
// ver src/lib/camaraConfirmada.ts para la vigencia (caduca sola con una
// pasada propia posterior a la fecha).
import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardCheck, Loader2, X } from "lucide-react";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import { toast } from "@/hooks/use-toast";
import type { EntradaBasculaRow } from "@/hooks/useEntradasBascula";
import type { ConfirmacionCamaraVigente } from "@/lib/camaraConfirmada";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKgCompact as formatKg, today } from "@/lib/format";

interface ActualizarCamaraConfirmadaMutation {
  mutateAsync: (variables: {
    items: Array<{ id: string; nombre: string | null; fecha: string | null }>;
    onProgress?: (hecho: number, total: number) => void;
  }) => Promise<{ actualizados: number }>;
  isPending: boolean;
}

interface ConfirmarLotesEnCamaraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entradas: EntradaBasculaRow[];
  /** lote (8 dígitos) -> confirmación VIGENTE (nombre + fecha), ver camaraConfirmadaVigentePorLote en camaraConfirmada.ts. Solo para el aviso "ya vigente" al parsear — la lista de abajo para limpiar recorre `entradas` directamente (incluye también señales YA caducadas que conviene limpiar). */
  camaraConfirmadaPorLote: Map<string, ConfirmacionCamaraVigente>;
  actualizarCamaraConfirmada: ActualizarCamaraConfirmadaMutation;
}

/** Separa por comas, espacios o saltos de línea y normaliza cada trozo a su código de 8 dígitos (Convención A), sin duplicados y conservando el orden de aparición. */
function parsearCodigos(texto: string): string[] {
  const vistos = new Set<string>();
  const codigos: string[] = [];
  for (const trozo of texto.split(/[,\s]+/)) {
    const codigo = normalizarLoteCodigo(trozo);
    if (codigo && !vistos.has(codigo)) {
      vistos.add(codigo);
      codigos.push(codigo);
    }
  }
  return codigos;
}

export function ConfirmarLotesEnCamaraDialog({
  open, onOpenChange, entradas, camaraConfirmadaPorLote, actualizarCamaraConfirmada,
}: ConfirmarLotesEnCamaraDialogProps) {
  const [codigosTexto, setCodigosTexto] = useState("");
  const [nombreCamara, setNombreCamara] = useState("Cámara 5");
  const [fecha, setFecha] = useState(today());
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);

  const entradaPorLote8 = useMemo(() => {
    const mapa = new Map<string, EntradaBasculaRow>();
    for (const e of entradas) {
      const lote8 = normalizarLoteCodigo(e.lote);
      if (lote8) mapa.set(lote8, e);
    }
    return mapa;
  }, [entradas]);

  const codigos = useMemo(() => parsearCodigos(codigosTexto), [codigosTexto]);
  const encontrados = useMemo(
    () => codigos.map((c) => ({ codigo: c, entrada: entradaPorLote8.get(c) })).filter((m): m is { codigo: string; entrada: EntradaBasculaRow } => Boolean(m.entrada)),
    [codigos, entradaPorLote8],
  );
  const noEncontrados = useMemo(() => codigos.filter((c) => !entradaPorLote8.has(c)), [codigos, entradaPorLote8]);

  /** Entradas con la señal presente en BD ahora mismo (vigente o ya caducada): para poder limpiarlas a mano. Ver camara_confirmada_nombre en useEntradasBascula.ts (EntradaBasculaRow tipado). */
  const entradasConSenal = useMemo(
    () => entradas.filter((e) => e.camara_confirmada_nombre != null).sort((a, b) => a.lote.localeCompare(b.lote)),
    [entradas],
  );

  const anyPending = actualizarCamaraConfirmada.isPending;

  const handleConfirmar = async () => {
    if (encontrados.length === 0) return;
    const total = encontrados.length;
    setProgreso({ hecho: 0, total });
    try {
      await actualizarCamaraConfirmada.mutateAsync({
        items: encontrados.map((m) => ({ id: m.entrada.id, nombre: nombreCamara.trim() || "Cámara 5", fecha })),
        onProgress: (hecho, t) => setProgreso({ hecho, total: t }),
      });
      toast({
        title: "Lotes confirmados en cámara",
        description: `${total} lote(s) marcados en "${nombreCamara.trim() || "Cámara 5"}" (${formatDate(fecha)})${noEncontrados.length ? `. ${noEncontrados.length} código(s) no se encontraron en báscula: ${noEncontrados.join(", ")}.` : "."}`,
      });
      setCodigosTexto("");
    } catch (e) {
      toast({ title: "No se pudo confirmar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setProgreso(null);
    }
  };

  const handleQuitar = async (entrada: EntradaBasculaRow) => {
    try {
      await actualizarCamaraConfirmada.mutateAsync({ items: [{ id: entrada.id, nombre: null, fecha: null }] });
      toast({ title: `Señal quitada de ${entrada.lote}` });
    } catch (e) {
      toast({ title: "No se pudo quitar la señal", description: errorMessage(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!anyPending) onOpenChange(next); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-info" /> Confirmar lotes en cámara
          </DialogTitle>
          <DialogDescription>
            Anota aquí la confirmación FÍSICA de dirección tras inventariar una cámara a pie: los lotes que pegues
            quedan marcados como "sigue en cámara" y quedan excluidos de derrames y de cualquier cierre automático —
            es una señal, no un movimiento. Caduca sola en cuanto el lote registre una pasada propia posterior a esta
            fecha (la fruta empezó a salir de verdad); no hace falta limpiarla a mano salvo que te hayas equivocado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="codigos-camara-confirmada" className="text-xs font-medium text-muted-foreground">
              Códigos de lote (separados por comas, espacios o saltos de línea)
            </label>
            <Textarea
              id="codigos-camara-confirmada"
              value={codigosTexto}
              onChange={(e) => setCodigosTexto(e.target.value)}
              placeholder="26051408, 26051906, 26052602..."
              disabled={anyPending}
              className="min-h-[100px] font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label htmlFor="nombre-camara-confirmada" className="text-xs font-medium text-muted-foreground">Cámara</label>
              <Input
                id="nombre-camara-confirmada"
                value={nombreCamara}
                onChange={(e) => setNombreCamara(e.target.value)}
                disabled={anyPending}
                className="h-9 w-40"
              />
            </div>
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">Fecha del inventario</span>
              <GlassDatePicker value={fecha} onChange={setFecha} displayFormat="dd MMM yyyy" disabled={anyPending} />
            </div>
          </div>

          {codigos.length > 0 && (
            <div className="space-y-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                {encontrados.length} de {codigos.length} código(s) encontrados en báscula
              </p>
              {encontrados.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {encontrados.map((m) => {
                    const vigente = camaraConfirmadaPorLote.get(m.codigo);
                    return (
                      <Badge key={m.codigo} variant="outline" className="border-[var(--glass-border)] px-1.5 py-0 text-[10px] font-normal text-muted-foreground" title={m.entrada.finca ?? undefined}>
                        {m.codigo}
                        {vigente && <span className="ml-1 text-info">(ya vigente)</span>}
                      </Badge>
                    );
                  })}
                </div>
              )}
              {noEncontrados.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{noEncontrados.length} código(s) NO encontrados en báscula (no se tocan): {noEncontrados.join(", ")}.</span>
                </p>
              )}
            </div>
          )}

          {progreso && (
            <div className="space-y-1.5">
              <Progress value={progreso.total > 0 ? (progreso.hecho / progreso.total) * 100 : 0} />
              <p className="text-center text-xs text-muted-foreground">{progreso.hecho} / {progreso.total} lote(s) confirmados</p>
            </div>
          )}
        </div>

        {entradasConSenal.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-left text-xs text-muted-foreground">
              <span className="font-medium">{entradasConSenal.length} lote(s) con señal en BD ahora mismo (limpiar)</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 space-y-1 rounded-lg border border-[var(--glass-border)] p-2">
              {entradasConSenal.map((e) => {
                const lote8 = normalizarLoteCodigo(e.lote);
                const vigente = lote8 ? camaraConfirmadaPorLote.has(lote8) : false;
                return (
                  <div key={e.id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-[var(--glass-bg)]">
                    <span className="flex items-center gap-1.5 tabular-nums">
                      {e.lote}
                      <span className="text-muted-foreground">— {e.camara_confirmada_nombre} ({formatDate(e.camara_confirmada_fecha ?? "")})</span>
                      {vigente ? (
                        <Badge variant="outline" className="border-info/40 bg-info/10 px-1 py-0 text-[9px] text-info">vigente</Badge>
                      ) : (
                        <Badge variant="outline" className="border-[var(--glass-border)] px-1 py-0 text-[9px] text-muted-foreground">caducada</Badge>
                      )}
                      {e.kg_entrada > 0 && <span className="text-muted-foreground">· {formatKg(Number(e.kg_entrada))}</span>}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                      disabled={anyPending}
                      onClick={() => void handleQuitar(e)}
                    >
                      <X className="h-3 w-3" /> Quitar
                    </Button>
                  </div>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}

        <DialogFooter>
          <Button
            onClick={() => void handleConfirmar()}
            disabled={encontrados.length === 0 || anyPending}
          >
            {anyPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
            Confirmar {encontrados.length > 0 ? `${encontrados.length} lote(s)` : ""} en cámara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
