// src/components/ConciliarInformeCamaraDialog.tsx
// "Conciliar con informe de cámara" (solo admin, EntradasBascula.tsx —
// pestaña "Stock en cámara"): motivado por el cierre masivo por fecha del
// 2026-07-16 que cerró 97 lotes que en realidad seguían físicamente en cámara
// (fruta que puede llevar 2-3 meses en cámara de forma legítima) y hubo que
// reabrir a mano contra el informe real "APROVECHAMIENTO STOCK LOTES" del
// programa de báscula. Este diálogo automatiza ese cuadre: se importa el
// informe real y se comparan sus lotes contra el stock activo de la
// herramienta (ver conciliarStockConInforme en src/lib/entradasBascula.ts),
// en vez de cerrar en bloque por fecha a ciegas.
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle, ChevronDown, FileSpreadsheet, GitCompare, Loader2, Lock, LockOpen, Upload,
} from "lucide-react";
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
import { CIERRE_MODO_TEXTOS } from "@/components/CerrarLoteDialog";
import { toast } from "@/hooks/use-toast";
import type { EntradaBasculaRow } from "@/hooks/useEntradasBascula";
import { errorMessage } from "@/lib/errorMessage";
import {
  conciliarStockConInforme,
  parseInformeAprovechamientoStock,
  type CierreModo,
  type ConciliacionResultado,
  type InformeAprovechamientoLote,
  type StockLoteRow,
} from "@/lib/entradasBascula";
import { formatKgCompact as formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CerrarLotesEnBloqueMutation {
  mutateAsync: (variables: {
    items: Array<{ id: string; cierreModo: CierreModo }>;
    onProgress?: (hecho: number, total: number) => void;
  }) => Promise<{ cerrados: number }>;
  isPending: boolean;
}

interface ReabrirLotesEnBloqueMutation {
  mutateAsync: (variables: {
    ids: string[];
    onProgress?: (hecho: number, total: number) => void;
  }) => Promise<{ reabiertos: number }>;
  isPending: boolean;
}

interface ConciliarInformeCamaraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stock actual (activos + procesados/cerrados) de la herramienta. */
  stockFilas: StockLoteRow[];
  /** Para resolver el id real de entradas_bascula por lote (StockLoteRow no lo trae). */
  entradas: EntradaBasculaRow[];
  cerrarLotesEnBloque: CerrarLotesEnBloqueMutation;
  reabrirLotesEnBloque: ReabrirLotesEnBloqueMutation;
}

interface InformeCargado {
  fileName: string;
  nLotes: number;
  kgTotal: number;
  descartadas: Array<{ fila: number; motivo: string }>;
  resultado: ConciliacionResultado;
}

async function leerInforme(file: File): Promise<{
  fileName: string;
  nLotes: number;
  kgTotal: number;
  descartadas: Array<{ fila: number; motivo: string }>;
  lotes: InformeAprovechamientoLote[];
}> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  const { lotes, descartadas } = parseInformeAprovechamientoStock(rows);
  return {
    fileName: file.name,
    nLotes: lotes.length,
    kgTotal: lotes.reduce((s, l) => s + l.kgExistencia, 0),
    descartadas,
    lotes,
  };
}

function Dropzone({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-lg border-2 border-dashed p-8 text-center text-sm transition-colors",
        dragOver ? "border-primary bg-primary/5" : "border-[var(--glass-border)]",
        disabled && "pointer-events-none opacity-60",
      )}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <FileSpreadsheet className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-muted-foreground">
        Arrastra aquí el Excel <span className="font-medium text-foreground">"APROVECHAMIENTO STOCK LOTES"</span> del
        programa de báscula, o
      </p>
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
        <Upload className="h-3.5 w-3.5" /> Seleccionar archivo
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

/** Encabezado de sección colapsable con contador + tono. */
function SeccionHeader({ titulo, count, tono }: { titulo: string; count: number; tono: "warning" | "info" | "muted" | "destructive" }) {
  const toneClass = {
    warning: "border-warning/40 bg-warning/10 text-warning",
    info: "border-info/40 bg-info/10 text-info",
    muted: "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground",
    destructive: "border-destructive/40 bg-destructive/10 text-destructive",
  }[tono];
  return (
    <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--glass-bg-strong)]">
      <span className="flex items-center gap-2 text-sm font-semibold">
        {titulo}
        <Badge variant="outline" className={cn("px-1.5 py-0 text-[11px] font-semibold tabular-nums", toneClass)}>{count}</Badge>
      </span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
}

export function ConciliarInformeCamaraDialog({
  open, onOpenChange, stockFilas, entradas, cerrarLotesEnBloque, reabrirLotesEnBloque,
}: ConciliarInformeCamaraDialogProps) {
  const [cargando, setCargando] = useState(false);
  const [informe, setInforme] = useState<InformeCargado | null>(null);
  const [confirmando, setConfirmando] = useState<"cerrar" | "reabrir" | null>(null);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);

  const entradaPorLote = useMemo(() => new Map(entradas.map((e) => [e.lote, e])), [entradas]);

  const anyPending = cerrarLotesEnBloque.isPending || reabrirLotesEnBloque.isPending;

  const handleFile = async (file: File) => {
    setCargando(true);
    try {
      const leido = await leerInforme(file);
      if (leido.nLotes === 0) {
        toast({
          title: "Archivo no reconocido",
          description: "No parece el informe \"APROVECHAMIENTO STOCK LOTES\" del programa de báscula (no se encontraron lotes con Creación + Lote + Kgr.Exist.).",
          variant: "destructive",
        });
        return;
      }
      const resultado = conciliarStockConInforme(stockFilas, leido.lotes);
      setInforme({ fileName: leido.fileName, nLotes: leido.nLotes, kgTotal: leido.kgTotal, descartadas: leido.descartadas, resultado });
    } catch (e) {
      toast({ title: "No se pudo leer el archivo", description: errorMessage(e), variant: "destructive" });
    } finally {
      setCargando(false);
    }
  };

  // Candidatos a cerrar: activos que ya no están en el informe, con id real resuelto por lote.
  const itemsParaCerrar = useMemo(() => {
    if (!informe) return [];
    return informe.resultado.sobranEnHerramienta
      .map((item) => {
        const row = entradaPorLote.get(item.lote);
        return row ? { id: row.id, lote: item.lote, cierreModo: item.modoSugerido } : null;
      })
      .filter((x): x is { id: string; lote: string; cierreModo: CierreModo } => x != null);
  }, [informe, entradaPorLote]);

  // Candidatos a reabrir: cerrados a mano que sí están en el informe, con id real resuelto por lote.
  const itemsParaReabrir = useMemo(() => {
    if (!informe) return [];
    return informe.resultado.faltanEnHerramienta.reabrir
      .map((item) => {
        const row = entradaPorLote.get(item.lote);
        return row ? { id: row.id, lote: item.lote } : null;
      })
      .filter((x): x is { id: string; lote: string } => x != null);
  }, [informe, entradaPorLote]);

  const handleConfirmarCerrar = async () => {
    setProgreso({ hecho: 0, total: itemsParaCerrar.length });
    try {
      const resultado = await cerrarLotesEnBloque.mutateAsync({
        items: itemsParaCerrar.map(({ id, cierreModo }) => ({ id, cierreModo })),
        onProgress: (hecho, total) => setProgreso({ hecho, total }),
      });
      toast({ title: "Lotes cerrados", description: `${resultado.cerrados} lote(s) que ya no estaban en el informe se han cerrado.` });
      setConfirmando(null);
    } catch (e) {
      toast({ title: "No se pudo completar el cierre", description: errorMessage(e), variant: "destructive" });
    } finally {
      setProgreso(null);
    }
  };

  const handleConfirmarReabrir = async () => {
    setProgreso({ hecho: 0, total: itemsParaReabrir.length });
    try {
      const resultado = await reabrirLotesEnBloque.mutateAsync({
        ids: itemsParaReabrir.map((i) => i.id),
        onProgress: (hecho, total) => setProgreso({ hecho, total }),
      });
      toast({ title: "Lotes reabiertos", description: `${resultado.reabiertos} lote(s) cerrados a mano que sí están en el informe se han reabierto.` });
      setConfirmando(null);
    } catch (e) {
      toast({ title: "No se pudo completar la reapertura", description: errorMessage(e), variant: "destructive" });
    } finally {
      setProgreso(null);
    }
  };

  const handleClose = (next: boolean) => {
    if (anyPending) return;
    if (!next) { setInforme(null); setConfirmando(null); }
    onOpenChange(next);
  };

  const r = informe?.resultado;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conciliar con informe de cámara</DialogTitle>
          <DialogDescription>
            Importa el informe real "APROVECHAMIENTO STOCK LOTES" del programa de báscula y compáralo contra el stock
            activo de la herramienta antes de cerrar nada en bloque por fecha — así no vuelve a pasar lo del
            2026-07-16 (97 lotes que seguían físicamente en cámara se cerraron por error y hubo que reabrirlos a mano).
          </DialogDescription>
        </DialogHeader>

        {!informe ? (
          <Dropzone onFile={(f) => void handleFile(f)} disabled={cargando} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-info/30 bg-info/10 px-3 py-2.5 text-sm">
              <span className="flex items-center gap-1.5 font-medium text-info">
                <FileSpreadsheet className="h-4 w-4" /> {informe.fileName}
              </span>
              <span className="text-muted-foreground">
                {informe.nLotes} lote(s) · <span className="font-semibold text-foreground">{formatKg(informe.kgTotal)}</span> en el informe
              </span>
              <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setInforme(null)} disabled={cargando}>
                Cambiar archivo
              </Button>
            </div>
            {informe.descartadas.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {informe.descartadas.length} fila(s) del informe descartada(s) (leyenda de colores al final del archivo, normal —
                los subtotales por producto/agricultor se ignoran aparte, sin contar como descarte).
              </p>
            )}

            {r && (
              <div className="space-y-2.5">
                {/* ─── Cuadran ─────────────────────────────────────────── */}
                <Collapsible>
                  <SeccionHeader titulo="Cuadran (activos, en el informe)" count={r.cuadran.length} tono="muted" />
                  <CollapsibleContent className="mt-1.5 overflow-hidden rounded-lg border border-[var(--glass-border)]">
                    {r.cuadran.length === 0 ? (
                      <p className="p-3 text-center text-xs text-muted-foreground">Ninguno.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Lote</TableHead>
                            <TableHead>Agricultor</TableHead>
                            <TableHead className="text-right">Kg herramienta</TableHead>
                            <TableHead className="text-right">Kg informe</TableHead>
                            <TableHead className="text-right">Delta</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {r.cuadran.map((it) => (
                            <TableRow key={it.lote}>
                              <TableCell className="font-medium tabular-nums">{it.lote}</TableCell>
                              <TableCell className="max-w-[160px] truncate">{it.agricultor ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatKg(it.kgHerramienta)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatKg(it.kgInforme)}</TableCell>
                              <TableCell className={cn("text-right tabular-nums", Math.abs(it.deltaKg) > 0 && "text-warning")}>
                                {it.deltaKg > 0 ? "+" : ""}{formatNumber(it.deltaKg)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                {/* ─── Sobran en la herramienta → cerrar ──────────────────── */}
                <Collapsible defaultOpen={r.sobranEnHerramienta.length > 0}>
                  <SeccionHeader titulo="Sobran en la herramienta (candidatos a cerrar)" count={r.sobranEnHerramienta.length} tono="warning" />
                  <CollapsibleContent className="mt-1.5 space-y-2">
                    <div className="overflow-hidden rounded-lg border border-[var(--glass-border)]">
                      {r.sobranEnHerramienta.length === 0 ? (
                        <p className="p-3 text-center text-xs text-muted-foreground">Ninguno: todo lo activo en la herramienta está también en el informe.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Lote</TableHead>
                              <TableHead>Agricultor</TableHead>
                              <TableHead>Variedad</TableHead>
                              <TableHead className="text-right">Días</TableHead>
                              <TableHead className="text-right">Kg en cámara</TableHead>
                              <TableHead>Modo sugerido</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {r.sobranEnHerramienta.map((it) => (
                              <TableRow key={it.lote}>
                                <TableCell className="font-medium tabular-nums">{it.lote}</TableCell>
                                <TableCell className="max-w-[140px] truncate">{it.agricultor ?? "—"}</TableCell>
                                <TableCell className="max-w-[140px] truncate text-muted-foreground">{it.articulo ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">{it.diasEnCamara}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{formatKg(it.kgEnCamara)}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="px-1.5 py-0 text-[11px]">{CIERRE_MODO_TEXTOS[it.modoSugerido].titulo}</Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                    {itemsParaCerrar.length > 0 && (
                      <AlertDialog open={confirmando === "cerrar"} onOpenChange={(next) => setConfirmando(next ? "cerrar" : null)}>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="border-warning/40 text-warning hover:bg-warning/10" disabled={anyPending}>
                            <Lock className="h-3.5 w-3.5" /> Cerrar los {itemsParaCerrar.length} que ya no están (con su modo)
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Cerrar {itemsParaCerrar.length} lote(s)?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Se cerrarán con el modo sugerido para cada uno (según su % procesado): dejarán de contar como stock en
                              cámara. Puedes reabrir cualquiera después desde la tabla de stock si te equivocas.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          {progreso && (
                            <div className="space-y-1.5">
                              <Progress value={progreso.total > 0 ? (progreso.hecho / progreso.total) * 100 : 0} />
                              <p className="text-center text-xs text-muted-foreground">{progreso.hecho} / {progreso.total} lotes cerrados</p>
                            </div>
                          )}
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={cerrarLotesEnBloque.isPending}>Cancelar</AlertDialogCancel>
                            <AlertDialogAction disabled={cerrarLotesEnBloque.isPending} onClick={(e) => { e.preventDefault(); void handleConfirmarCerrar(); }}>
                              {cerrarLotesEnBloque.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                              Cerrar {itemsParaCerrar.length} lote(s)
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                {/* ─── Faltan en la herramienta: reabrir + conflicto + sinEntrada ── */}
                <Collapsible defaultOpen={r.faltanEnHerramienta.reabrir.length > 0}>
                  <SeccionHeader
                    titulo="Cerrados que sí están en el informe (candidatos a reabrir)"
                    count={r.faltanEnHerramienta.reabrir.length}
                    tono="destructive"
                  />
                  <CollapsibleContent className="mt-1.5 space-y-2">
                    <div className="overflow-hidden rounded-lg border border-[var(--glass-border)]">
                      {r.faltanEnHerramienta.reabrir.length === 0 ? (
                        <p className="p-3 text-center text-xs text-muted-foreground">Ninguno.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Lote</TableHead>
                              <TableHead>Agricultor</TableHead>
                              <TableHead className="text-right">Kg entrada</TableHead>
                              <TableHead className="text-right">Hueco natural</TableHead>
                              <TableHead className="text-right">Kg informe</TableHead>
                              <TableHead>Cerrado como</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {r.faltanEnHerramienta.reabrir.map((it) => (
                              <TableRow key={it.lote}>
                                <TableCell className="font-medium tabular-nums">{it.lote}</TableCell>
                                <TableCell className="max-w-[140px] truncate">{it.agricultor ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatKg(it.kgEntrada)}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{formatKg(it.kgHuecoNatural)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatKg(it.kgInforme)}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
                                    {it.cierreModo ? CIERRE_MODO_TEXTOS[it.cierreModo].titulo : "—"}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Solo se proponen reabrir los <span className="font-medium text-foreground">cerrados a mano</span>. Los que el
                      calibrador ya dio por procesados por kg (sin cierre manual) aparecen aparte, como conflicto: el informe puede
                      ser de hace días y haberse procesado después de la foto, así que esos no se tocan automáticamente.
                    </p>
                    {itemsParaReabrir.length > 0 && (
                      <AlertDialog open={confirmando === "reabrir"} onOpenChange={(next) => setConfirmando(next ? "reabrir" : null)}>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" disabled={anyPending}>
                            <LockOpen className="h-3.5 w-3.5" /> Reabrir los {itemsParaReabrir.length} cerrados que sí están
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Reabrir {itemsParaReabrir.length} lote(s)?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Se les quita el cierre manual (cerrado_at y cierre_modo): vuelven a contar como stock activo en cámara,
                              con el estado que les corresponda por su % procesado.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          {progreso && (
                            <div className="space-y-1.5">
                              <Progress value={progreso.total > 0 ? (progreso.hecho / progreso.total) * 100 : 0} />
                              <p className="text-center text-xs text-muted-foreground">{progreso.hecho} / {progreso.total} lotes reabiertos</p>
                            </div>
                          )}
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={reabrirLotesEnBloque.isPending}>Cancelar</AlertDialogCancel>
                            <AlertDialogAction disabled={reabrirLotesEnBloque.isPending} onClick={(e) => { e.preventDefault(); void handleConfirmarReabrir(); }}>
                              {reabrirLotesEnBloque.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />}
                              Reabrir {itemsParaReabrir.length} lote(s)
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible>
                  <SeccionHeader
                    titulo="Conflicto de datos (procesado por kg, sin cierre manual)"
                    count={r.faltanEnHerramienta.conflicto.length}
                    tono="info"
                  />
                  <CollapsibleContent className="mt-1.5 overflow-hidden rounded-lg border border-[var(--glass-border)]">
                    {r.faltanEnHerramienta.conflicto.length === 0 ? (
                      <p className="p-3 text-center text-xs text-muted-foreground">Ninguno.</p>
                    ) : (
                      <>
                        <p className="border-b border-[var(--glass-border)] bg-info/5 p-2.5 text-xs text-muted-foreground">
                          El calibrador ya dio estos lotes por procesados (≥97% por kg), pero el informe dice que aún están en
                          cámara. Probablemente el informe es de hace días y se procesaron después — solo informativo, revisa a
                          mano si algo no cuadra.
                        </p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Lote</TableHead>
                              <TableHead>Agricultor</TableHead>
                              <TableHead className="text-right">Kg entrada</TableHead>
                              <TableHead className="text-right">Kg procesado</TableHead>
                              <TableHead className="text-right">Kg informe</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {r.faltanEnHerramienta.conflicto.map((it) => (
                              <TableRow key={it.lote}>
                                <TableCell className="font-medium tabular-nums">{it.lote}</TableCell>
                                <TableCell className="max-w-[140px] truncate">{it.agricultor ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatKg(it.kgEntrada)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatKg(it.kgProcesado)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatKg(it.kgInforme)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible>
                  <SeccionHeader
                    titulo="Sin entrada en la herramienta"
                    count={r.faltanEnHerramienta.sinEntrada.length}
                    tono="muted"
                  />
                  <CollapsibleContent className="mt-1.5 overflow-hidden rounded-lg border border-[var(--glass-border)]">
                    {r.faltanEnHerramienta.sinEntrada.length === 0 ? (
                      <p className="p-3 text-center text-xs text-muted-foreground">Ninguno.</p>
                    ) : (
                      <>
                        <p className="border-b border-[var(--glass-border)] p-2.5 text-xs text-muted-foreground">
                          Lotes del informe sin ninguna fila en la herramienta (ni activa ni cerrada) — no se puede reabrir lo que
                          no existe. Solo informativo.
                        </p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Lote</TableHead>
                              <TableHead>Agricultor</TableHead>
                              <TableHead>Producto</TableHead>
                              <TableHead className="text-right">Kg informe</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {r.faltanEnHerramienta.sinEntrada.map((it) => (
                              <TableRow key={it.lote}>
                                <TableCell className="font-medium tabular-nums">{it.lote}</TableCell>
                                <TableCell className="max-w-[140px] truncate">{it.agricultor ?? "—"}</TableCell>
                                <TableCell className="max-w-[140px] truncate text-muted-foreground">{it.producto ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatKg(it.kgInforme)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Icono para el botón que abre este diálogo (EntradasBascula.tsx). */
export const ConciliarInformeCamaraIcon = GitCompare;
