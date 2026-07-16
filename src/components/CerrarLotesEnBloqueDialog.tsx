// src/components/CerrarLotesEnBloqueDialog.tsx
// Cierre masivo de lotes activos antiguos (solo admin, EntradasBascula.tsx —
// pestaña "Stock en cámara"): elige una fecha límite, parte los lotes activos
// con entrada anterior a esa fecha en dos grupos según el umbral de
// criterioCierreModo (85% procesado, ver src/lib/entradasBascula.ts) y
// ejecuta el cierre en bloque con cerrarLotesEnBloque (useEntradasBascula.ts).
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { GlassDatePicker } from "@/components/GlassDatePicker";
import { CIERRE_MODO_TEXTOS } from "@/components/CerrarLoteDialog";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errorMessage";
import {
  criterioCierreModo,
  DIAS_SIN_ACTIVIDAD_TERMINADO,
  UMBRAL_CIERRE_CON_ANALISIS,
  UMBRAL_PROBABLE_TERMINADO,
  type CierreModo,
} from "@/lib/entradasBascula";
import { formatKgCompact as formatKg, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Lo mínimo de un lote activo que necesita este diálogo (id real de entradas_bascula + los kg para clasificarlo). */
export interface LoteActivoParaBloque {
  id: string;
  lote: string;
  fecha_entrada: string;
  kg_entrada: number;
  /** Kg ya contabilizados como procesados (calibrador + ajuste de stock). */
  kg_procesado: number;
}

interface CerrarLotesEnBloqueMutation {
  mutateAsync: (variables: {
    items: Array<{ id: string; cierreModo: CierreModo }>;
    onProgress?: (hecho: number, total: number) => void;
  }) => Promise<{ cerrados: number }>;
  isPending: boolean;
}

interface CerrarLotesEnBloqueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lotes activos (pendiente/parcial) del stock actual — el diálogo filtra por fecha internamente. Ignorado si se pasa `lotesFijos`. */
  filas: LoteActivoParaBloque[];
  cerrarLotesEnBloque: CerrarLotesEnBloqueMutation;
  /**
   * Lista ya decidida de antemano (p.ej. desde el banner de "N lotes llevan
   * ≥DIAS_SIN_ACTIVIDAD_TERMINADO días sin actividad con
   * ≥UMBRAL_PROBABLE_TERMINADO procesado" en EntradasBascula.tsx): cuando se
   * pasa, el diálogo NO filtra por fecha ni reparte por criterioCierreModo —
   * cierra exactamente estos lotes con modo "con_analisis" fijo (ya se
   * preseleccionaron por la regla de "probablemente terminado"). Si se omite,
   * el diálogo funciona igual que antes (fecha límite + reparto automático de
   * dos grupos por criterioCierreModo, un umbral de negocio distinto).
   */
  lotesFijos?: LoteActivoParaBloque[];
}

const FECHA_LIMITE_DEFECTO = "2026-06-01";

interface GrupoCierre {
  modo: CierreModo;
  lotes: LoteActivoParaBloque[];
  kgHueco: number;
}

/** Reparte los lotes anteriores a `fechaLimite` en los dos grupos de criterioCierreModo. Función pura, sin acceso a red. */
function agruparParaCierreEnBloque(filas: LoteActivoParaBloque[], fechaLimite: string): { conAnalisis: GrupoCierre; sinRegistro: GrupoCierre } {
  const antiguos = filas.filter((f) => f.fecha_entrada < fechaLimite);
  const conAnalisis: LoteActivoParaBloque[] = [];
  const sinRegistro: LoteActivoParaBloque[] = [];
  for (const f of antiguos) {
    (criterioCierreModo(f.kg_entrada, f.kg_procesado) === "con_analisis" ? conAnalisis : sinRegistro).push(f);
  }
  const kgHueco = (lotes: LoteActivoParaBloque[]) => lotes.reduce((s, f) => s + Math.max(0, f.kg_entrada - f.kg_procesado), 0);
  return {
    conAnalisis: { modo: "con_analisis", lotes: conAnalisis, kgHueco: kgHueco(conAnalisis) },
    sinRegistro: { modo: "sin_registro", lotes: sinRegistro, kgHueco: kgHueco(sinRegistro) },
  };
}

function GrupoResumen({ grupo, titulo, descripcion, tono }: {
  grupo: GrupoCierre;
  titulo: string;
  descripcion: string;
  tono: "warning" | "muted";
}) {
  if (grupo.lotes.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-sm text-muted-foreground">
        {titulo}: ninguno.
      </div>
    );
  }
  return (
    <div className={cn(
      "rounded-lg border p-3",
      tono === "warning" ? "border-warning/40 bg-warning/10" : "border-[var(--glass-border)] bg-[var(--glass-bg)]",
    )}>
      <p className="text-sm font-semibold text-foreground">
        {grupo.lotes.length} lote{grupo.lotes.length === 1 ? "" : "s"} {titulo} → {descripcion}{" "}
        (<span className="tabular-nums">{formatKg(grupo.kgHueco)}</span>)
      </p>
      <Collapsible>
        <CollapsibleTrigger className="group mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <span className="group-data-[state=open]:hidden">Ver códigos ({grupo.lotes.length})</span>
          <span className="hidden group-data-[state=open]:inline">Ocultar códigos</span>
          <ChevronDown className="h-3 w-3 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {grupo.lotes.map((f) => (
              <Badge key={f.id} variant="outline" className="border-[var(--glass-border)] px-1.5 py-0 text-[11px] font-normal tabular-nums text-muted-foreground">
                {f.lote}
              </Badge>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function CerrarLotesEnBloqueDialog({ open, onOpenChange, filas, cerrarLotesEnBloque, lotesFijos }: CerrarLotesEnBloqueDialogProps) {
  const [fechaLimite, setFechaLimite] = useState(FECHA_LIMITE_DEFECTO);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const modoFijo = lotesFijos != null;

  const { conAnalisis, sinRegistro } = useMemo(() => {
    if (lotesFijos) {
      const kgHueco = lotesFijos.reduce((s, f) => s + Math.max(0, f.kg_entrada - f.kg_procesado), 0);
      return {
        conAnalisis: { modo: "con_analisis" as const, lotes: lotesFijos, kgHueco },
        sinRegistro: { modo: "sin_registro" as const, lotes: [], kgHueco: 0 },
      };
    }
    return agruparParaCierreEnBloque(filas, fechaLimite);
  }, [filas, fechaLimite, lotesFijos]);
  const total = conAnalisis.lotes.length + sinRegistro.lotes.length;

  const handleConfirmar = async () => {
    if (total === 0) return;
    const items = [
      ...conAnalisis.lotes.map((f) => ({ id: f.id, cierreModo: "con_analisis" as const })),
      ...sinRegistro.lotes.map((f) => ({ id: f.id, cierreModo: "sin_registro" as const })),
    ];
    setProgreso({ hecho: 0, total: items.length });
    try {
      const resultado = await cerrarLotesEnBloque.mutateAsync({
        items,
        onProgress: (hecho, totalItems) => setProgreso({ hecho, total: totalItems }),
      });
      toast({
        title: "Cierre en bloque completado",
        description: `${resultado.cerrados} lote(s) cerrado(s): ${conAnalisis.lotes.length} con análisis, ${sinRegistro.lotes.length} sin análisis.`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "No se pudo completar el cierre en bloque", description: errorMessage(e), variant: "destructive" });
    } finally {
      setProgreso(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!cerrarLotesEnBloque.isPending) onOpenChange(next); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{modoFijo ? "Cerrar lotes probablemente terminados" : "Cerrar antiguos en bloque"}</DialogTitle>
          <DialogDescription>
            {modoFijo ? (
              <>
                Cierra con análisis (el hueco cuenta como merma/podrido real) los lotes que llevan el{" "}
                {formatPct(UMBRAL_PROBABLE_TERMINADO * 100)} o más procesado y {DIAS_SIN_ACTIVIDAD_TERMINADO} días o más
                sin ninguna pasada del calibrador — revisa los códigos antes de confirmar.
              </>
            ) : (
              <>
                Cierra de golpe todos los lotes activos con entrada anterior a la fecha elegida. Se reparten
                automáticamente entre "con análisis" y "sin análisis" según si llevan el{" "}
                {formatPct(UMBRAL_CIERRE_CON_ANALISIS * 100)} o más procesado — revisa los códigos antes de confirmar.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!modoFijo && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Entradas anteriores a</span>
            <GlassDatePicker value={fechaLimite} onChange={setFechaLimite} displayFormat="dd MMM yyyy" />
          </div>
        )}

        <div className="space-y-2.5">
          <GrupoResumen
            grupo={conAnalisis}
            titulo={modoFijo ? "probablemente terminados" : "casi terminados"}
            descripcion={`cierre con análisis (${CIERRE_MODO_TEXTOS.con_analisis.titulo.toLowerCase()})`}
            tono="warning"
          />
          {!modoFijo && (
            <GrupoResumen
              grupo={sinRegistro}
              titulo="sin registro suficiente"
              descripcion="cierre sin análisis (fuera del stock, sin contar pérdida)"
              tono="muted"
            />
          )}
        </div>

        {total === 0 && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {modoFijo ? "No hay lotes probablemente terminados." : "No hay lotes activos con entrada anterior a esa fecha."}
          </p>
        )}

        {progreso && (
          <div className="space-y-1.5">
            <Progress value={progreso.total > 0 ? (progreso.hecho / progreso.total) * 100 : 0} />
            <p className="text-center text-xs text-muted-foreground">{progreso.hecho} / {progreso.total} lotes cerrados</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cerrarLotesEnBloque.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirmar} disabled={total === 0 || cerrarLotesEnBloque.isPending}>
            {cerrarLotesEnBloque.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Cerrar {total > 0 ? `${total} lote${total === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
