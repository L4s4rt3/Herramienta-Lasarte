// src/components/AnotarPasadaDialog.tsx
// "Indicar qué más se echó" (solo admin, botón en la cola de excesos sin
// colocar de la pestaña "Conciliación kg" de Entradas): encargo del dueño
// 04-08-2026 — mecanismo para anotar A POSTERIORI qué más se echó en una
// pasada del calibrador cuando planta no lo escribió en el código de la
// pasada (lotes o precalibrados "colados" sin nombrar). El motor
// (conciliarKgProcesados, src/lib/conciliacionKg.ts) NO se toca: la
// anotación se inyecta antes de llamarlo (useEntradasBascula.ts,
// construirLoteCodigoEfectivo) y se trata EXACTAMENTE igual que un código
// que el calibrador hubiera escrito él mismo — el principal se llena
// primero, el resto según el orden en que se anote aquí (jamás FIFO).
//
// Mismo patrón que ConfirmarLotesEnCamaraDialog.tsx: pega una lista de
// códigos, se validan contra báscula (incluido precalibrado) y se muestra
// claramente cuáles NO se encontraron (nunca se inventa un cruce).
import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, ClipboardEdit, Loader2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { PasadaAnotacionRow } from "@/lib/pasadaAnotaciones";
import { parsearCodigosAnotacion, validarCodigosContraBascula } from "@/lib/pasadaAnotaciones";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKgCompact as formatKg } from "@/lib/format";

export interface CandidatoPasada {
  id: string;
  lote_codigo: string;
  kg_peso_total: number;
  date: string | null;
}

export interface AgregarAnotacionMutation {
  mutateAsync: (variables: { loteDiaId: string; codigos: string[]; nota: string | null }) => Promise<{ agregados: number }>;
  isPending: boolean;
}

export interface QuitarAnotacionMutation {
  mutateAsync: (id: string) => Promise<void>;
  isPending: boolean;
}

interface AnotarPasadaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Código donante de la cola de excesos ("26050101") y su kg sin colocar (solo informativo). */
  lote: string;
  kgExceso: number;
  /** Pasadas CRUDAS (lotes_dia) cuyo PRIMER código es `lote`: normalmente 1, puede haber varias (camiones seguidos sin cambiar el código). */
  candidatos: CandidatoPasada[];
  /** Anotaciones existentes por pasada (lote_dia_id -> filas), para poder listarlas y quitarlas. */
  anotacionesPorLoteDia: Map<string, PasadaAnotacionRow[]>;
  codigosBascula: Set<string>;
  agregarAnotacion: AgregarAnotacionMutation;
  quitarAnotacion: QuitarAnotacionMutation;
}

export function AnotarPasadaDialog({
  open, onOpenChange, lote, kgExceso, candidatos, anotacionesPorLoteDia, codigosBascula, agregarAnotacion, quitarAnotacion,
}: AnotarPasadaDialogProps) {
  // Si solo hay una pasada candidata (el caso normal), se preselecciona sola;
  // si hay varias, el usuario elige a cuál de las pasadas físicas anota.
  const [pasadaId, setPasadaId] = useState<string | null>(candidatos[0]?.id ?? null);
  const [codigosTexto, setCodigosTexto] = useState("");
  const [nota, setNota] = useState("");

  const pasada = useMemo(() => candidatos.find((c) => c.id === pasadaId) ?? candidatos[0] ?? null, [candidatos, pasadaId]);

  const codigos = useMemo(() => parsearCodigosAnotacion(codigosTexto), [codigosTexto]);
  const yaEnTexto = useMemo(
    () => new Set(String(pasada?.lote_codigo ?? "").match(/\d{8}/g) ?? []),
    [pasada],
  );
  const { encontrados, noEncontrados } = useMemo(() => validarCodigosContraBascula(codigos, codigosBascula), [codigos, codigosBascula]);
  // De los encontrados, los que ya aparecen tal cual en el texto de la
  // pasada (código repetido a mano, o el propio principal): no aportan nada
  // nuevo, construirLoteCodigoEfectivo los ignoraría igualmente — se avisa
  // para que quede claro, no se bloquea el guardado del resto.
  const nuevos = useMemo(() => encontrados.filter((c) => !yaEnTexto.has(c)), [encontrados, yaEnTexto]);
  const yaPresentes = useMemo(() => encontrados.filter((c) => yaEnTexto.has(c)), [encontrados, yaEnTexto]);

  const anotacionesExistentes = pasada ? anotacionesPorLoteDia.get(pasada.id) ?? [] : [];

  const anyPending = agregarAnotacion.isPending || quitarAnotacion.isPending;

  const handleGuardar = async () => {
    if (!pasada || nuevos.length === 0) return;
    try {
      await agregarAnotacion.mutateAsync({ loteDiaId: pasada.id, codigos: nuevos, nota: nota.trim() || null });
      toast({
        title: "Anotación guardada",
        description: `${nuevos.length} código(s) añadidos a la pasada ${pasada.lote_codigo} (${formatDate(pasada.date ?? "")})${noEncontrados.length ? `. ${noEncontrados.length} código(s) NO encontrados en báscula: ${noEncontrados.join(", ")}.` : "."}`,
      });
      setCodigosTexto("");
      setNota("");
    } catch (e) {
      toast({ title: "No se pudo guardar la anotación", description: errorMessage(e), variant: "destructive" });
    }
  };

  const handleQuitar = async (fila: PasadaAnotacionRow) => {
    try {
      await quitarAnotacion.mutateAsync(fila.id);
      toast({ title: `Anotación ${fila.codigo_extra} quitada` });
    } catch (e) {
      toast({ title: "No se pudo quitar la anotación", description: errorMessage(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!anyPending) onOpenChange(next); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardEdit className="h-4 w-4 text-info" /> Indicar qué más se echó
          </DialogTitle>
          <DialogDescription>
            Anota aquí los lotes o precalibrados que se metieron a la línea en esta pasada sin escribirlos en el
            código del calibrador. Se tratan EXACTAMENTE igual que si el calibrador los hubiera escrito: el código
            principal se llena primero, el resto en el orden en que los pegues aquí (nunca por orden de llegada).
          </DialogDescription>
        </DialogHeader>

        {candidatos.length === 0 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            No se encontró ninguna pasada de lotes_dia con "{lote}" como primer código: no se puede anotar.
          </p>
        ) : (
          <div className="space-y-3">
            {candidatos.length > 1 && (
              <div className="space-y-1.5">
                <label htmlFor="pasada-a-anotar" className="text-xs font-medium text-muted-foreground">
                  {candidatos.length} pasadas con este código: elige a cuál anotar
                </label>
                <select
                  id="pasada-a-anotar"
                  value={pasadaId ?? ""}
                  onChange={(e) => setPasadaId(e.target.value)}
                  disabled={anyPending}
                  className="h-9 w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2 text-xs"
                >
                  {candidatos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.lote_codigo} · {formatDate(c.date ?? "")} · {formatKg(c.kg_peso_total)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {pasada && (
              <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-xs">
                <p><span className="text-muted-foreground">Código literal:</span> <span className="font-mono">{pasada.lote_codigo}</span></p>
                <p><span className="text-muted-foreground">Fecha:</span> {formatDate(pasada.date ?? "")}</p>
                <p><span className="text-muted-foreground">Kg de la pasada:</span> {formatKg(pasada.kg_peso_total)}</p>
                <p><span className="text-muted-foreground">Exceso sin colocar (cola):</span> {formatKg(kgExceso)}</p>
              </div>
            )}

            {anotacionesExistentes.length > 0 && (
              <div className="space-y-1 rounded-lg border border-[var(--glass-border)] p-2">
                <p className="px-1 text-xs font-medium text-muted-foreground">Anotaciones de esta pasada</p>
                {anotacionesExistentes.map((fila) => (
                  <div key={fila.id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-[var(--glass-bg)]">
                    <span className="tabular-nums">
                      {fila.codigo_extra}
                      {fila.nota && <span className="ml-1.5 text-muted-foreground">«{fila.nota}»</span>}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                      disabled={anyPending}
                      onClick={() => void handleQuitar(fila)}
                    >
                      <X className="h-3 w-3" /> Quitar
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="codigos-anotacion" className="text-xs font-medium text-muted-foreground">
                Códigos a añadir (separados por comas, espacios o saltos de línea — en el orden en que deben llenarse)
              </label>
              <Textarea
                id="codigos-anotacion"
                value={codigosTexto}
                onChange={(e) => setCodigosTexto(e.target.value)}
                placeholder="26051408, 26051906..."
                disabled={anyPending}
                className="min-h-[80px] font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="nota-anotacion" className="text-xs font-medium text-muted-foreground">Nota (opcional)</label>
              <Input
                id="nota-anotacion"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="p.ej. camión seguido de la misma finca"
                disabled={anyPending}
                className="h-9"
              />
            </div>

            {codigos.length > 0 && (
              <div className="space-y-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  {nuevos.length} de {codigos.length} código(s) listos para anotar
                </p>
                {nuevos.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {nuevos.map((c) => (
                      <Badge key={c} variant="outline" className="border-[var(--glass-border)] px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
                        {c}
                      </Badge>
                    ))}
                  </div>
                )}
                {yaPresentes.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {yaPresentes.length} código(s) ya están en el texto de esta pasada (no se anotan de nuevo): {yaPresentes.join(", ")}.
                  </p>
                )}
                {noEncontrados.length > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{noEncontrados.length} código(s) NO encontrados en báscula (no se anotan): {noEncontrados.join(", ")}.</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() => void handleGuardar()}
            disabled={!pasada || nuevos.length === 0 || anyPending}
          >
            {agregarAnotacion.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardEdit className="h-3.5 w-3.5" />}
            Anotar {nuevos.length > 0 ? `${nuevos.length} código(s)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
