// src/components/DesglosarPasadaDialog.tsx
// "Desglosar por box" (parte del día → Lotes procesados): encargo del dueño
// 06-08-2026 — "el martes echaron varios lotes en 1 y necesito contabilizarlos
// todos junto con los box que se echaron de cada uno, así sabemos cuántos kg
// se han echado de cada lote".
//
// El cálculo NO vive aquí: es repartirPasadaPorBox (src/lib/desgloseBox.ts,
// con tests sobre los nombres de pasada reales). Este componente solo captura
// las líneas y enseña en vivo lo que sale. Regla del dueño: el peso del box
// (grande 315 kg de fruta / pequeño 200) solo PONDERA — el total repartido es
// siempre el kg REAL de la pasada del calibrador.
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Boxes, Loader2, Plus, Trash2, Wand2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errorMessage";
import { formatDate, formatKg } from "@/lib/format";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import {
  BOX_NETO_KG,
  BOX_TAMANO_DEFECTO,
  BOX_TAMANO_LABEL,
  BOX_TAMANOS,
  kgPorBoxDeReentrada,
  parsearDesgloseTexto,
  repartirPasadaPorBox,
  resolverPrecalibradoPorFecha,
  type BoxTamano,
  type LineaDesglose,
  type ReentradaPrecCandidata,
  type TipoLineaDesglose,
} from "@/lib/desgloseBox";
import type { EntradaParaDesglose } from "@/hooks/usePasadaBoxLineas";

export interface PasadaADesglosar {
  id: string;
  lote_codigo: string | null;
  kg_peso_total: number;
  /** Fecha del parte: da el año a las fechas "22/07" del precalibrado. */
  date: string;
}

interface DesglosarPasadaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pasada: PasadaADesglosar;
  /** Desglose ya guardado de esta pasada (vacío = todavía sin desglosar). */
  lineasGuardadas: LineaDesglose[];
  reentradasPrec: ReentradaPrecCandidata[];
  codigosBascula: Set<string>;
  entradaPorCodigo: Map<string, EntradaParaDesglose>;
  guardar: {
    mutateAsync: (v: { loteDiaId: string; lineas: LineaDesglose[] }) => Promise<{ guardadas: number }>;
    isPending: boolean;
  };
  readOnly?: boolean;
}

const TIPO_LABEL: Record<TipoLineaDesglose, string> = {
  lote: "Lote",
  precalibrado: "Precalibrado",
  reciclaje: "Reciclaje",
};

const SELECT_CLASS =
  "h-8 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] px-1.5 text-xs";

function lineaVacia(tipo: TipoLineaDesglose = "lote"): LineaDesglose {
  return { tipo, lote_codigo: null, prec_fecha: null, box: null, box_tamano: BOX_TAMANO_DEFECTO };
}

/**
 * Resuelve los precalibrados que vienen por fecha contra las re-entradas de
 * báscula. Solo cuando hay UNA candidata ese día: con varias (PREC 1 y PREC 2)
 * se deja sin resolver para que lo elija una persona en el desplegable — nunca
 * se adivina (doctrina de stockPrecalibrado.ts).
 */
function autorresolverPrec(lineas: LineaDesglose[], candidatas: ReentradaPrecCandidata[]): LineaDesglose[] {
  return lineas.map((l) => {
    if (l.tipo !== "precalibrado" || l.lote_codigo || !l.prec_fecha) return l;
    const r = resolverPrecalibradoPorFecha(l.prec_fecha, candidatas);
    return r.estado === "resuelto" ? { ...l, lote_codigo: r.codigo } : l;
  });
}

export function DesglosarPasadaDialog({
  open, onOpenChange, pasada, lineasGuardadas, reentradasPrec, codigosBascula,
  entradaPorCodigo, guardar, readOnly = false,
}: DesglosarPasadaDialogProps) {
  const [lineas, setLineas] = useState<LineaDesglose[]>([]);

  // Al abrir: lo guardado si lo hay; si no, lo que dice el nombre que escribió
  // el operario en el calibrador (con los precalibrados ya resueltos).
  useEffect(() => {
    if (!open) return;
    setLineas(
      lineasGuardadas.length > 0
        ? lineasGuardadas.map((l) => ({ ...l }))
        : autorresolverPrec(parsearDesgloseTexto(pasada.lote_codigo, pasada.date), reentradasPrec),
    );
  }, [open, pasada.id, pasada.lote_codigo, pasada.date, lineasGuardadas, reentradasPrec]);

  const reparto = useMemo(() => repartirPasadaPorBox(pasada.kg_peso_total, lineas), [pasada.kg_peso_total, lineas]);

  const patch = (i: number, cambio: Partial<LineaDesglose>) =>
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, ...cambio } : l)));

  const cambiarTipo = (i: number, tipo: TipoLineaDesglose) =>
    patch(i, { tipo, lote_codigo: null, prec_fecha: null, nota: tipo === "reciclaje" ? "Reciclaje" : null });

  const cambiarFechaPrec = (i: number, fecha: string) => {
    const r = resolverPrecalibradoPorFecha(fecha || null, reentradasPrec);
    patch(i, {
      prec_fecha: fecha || null,
      lote_codigo: r.estado === "resuelto" ? r.codigo : null,
    });
  };

  const rellenarDesdeCalibrador = () => {
    const parseadas = autorresolverPrec(parsearDesgloseTexto(pasada.lote_codigo, pasada.date), reentradasPrec);
    if (parseadas.length === 0) {
      toast({ title: "El nombre de la pasada no menciona ningún lote, fecha ni reciclaje", variant: "destructive" });
      return;
    }
    setLineas(parseadas);
  };

  const handleGuardar = async () => {
    try {
      const { guardadas } = await guardar.mutateAsync({ loteDiaId: pasada.id, lineas });
      toast({
        title: guardadas > 0 ? `Desglose guardado (${guardadas} líneas)` : "Desglose borrado",
        description: guardadas > 0
          ? `${reparto.boxTotal} box · ${formatKg(reparto.kgPasada)} repartidos entre ${reparto.lineas.filter((l) => l.codigoAtribuido).length} lote(s).`
          : "La pasada vuelve a contar entera para el primer código de su nombre.",
      });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "No se pudo guardar el desglose", description: errorMessage(e), variant: "destructive" });
    }
  };

  // Avisos por línea: código que no está en báscula, o precalibrado con varias
  // re-entradas ese día (hay que elegir una).
  const candidatasDe = (fecha: string | null | undefined) =>
    fecha ? reentradasPrec.filter((c) => c.fecha === fecha) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!guardar.isPending) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-info" /> Desglosar la pasada por box
          </DialogTitle>
          <DialogDescription>
            Indica qué se echó en esta pasada y cuántos box de cada cosa. Los kg REALES del calibrador se
            reparten en proporción a los box: un box grande cuenta {BOX_NETO_KG.grande} kg de fruta
            (350 brutos − 35 de tara) y uno pequeño {BOX_NETO_KG.pequeno} (230 − 30). El total repartido
            siempre es el kg de la pasada, ni uno más ni uno menos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-xs">
            <div className="min-w-0">
              <p className="truncate"><span className="text-muted-foreground">Escrito en el calibrador:</span> <span className="font-mono">{pasada.lote_codigo || "—"}</span></p>
              <p><span className="text-muted-foreground">{formatDate(pasada.date)} ·</span> <span className="font-semibold tabular-nums">{formatKg(pasada.kg_peso_total)}</span></p>
            </div>
            {!readOnly && (
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={rellenarDesdeCalibrador}>
                <Wand2 className="h-3.5 w-3.5" /> Rellenar desde el nombre
              </Button>
            )}
          </div>

          {lineas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--glass-border)] p-6 text-center text-xs text-muted-foreground">
              Sin desglose: la pasada cuenta entera para el primer código de su nombre.
              Añade una línea por cada lote que se echó.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-1.5 text-left">Qué se echó</th>
                    <th className="px-2 py-1.5 text-left">Lote / fecha</th>
                    <th className="px-2 py-1.5 text-right">Box</th>
                    <th className="px-2 py-1.5 text-left">Tamaño</th>
                    <th className="px-2 py-1.5 text-right">Kg</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {reparto.lineas.map((linea, i) => {
                    const codigoTecleado = normalizarLoteCodigo(linea.lote_codigo);
                    const fueraDeBascula = Boolean(codigoTecleado) && !codigosBascula.has(codigoTecleado!);
                    const candidatas = candidatasDe(linea.prec_fecha);
                    const entrada = codigoTecleado ? entradaPorCodigo.get(codigoTecleado) : undefined;
                    const kgBoxReferencia = entrada ? kgPorBoxDeReentrada(entrada) : null;

                    return (
                      <tr key={i} className="border-t border-[var(--glass-border)] align-top">
                        <td className="px-2 py-2">
                          <select
                            aria-label={`Tipo de la línea ${i + 1}`}
                            className={SELECT_CLASS}
                            value={linea.tipo}
                            disabled={readOnly}
                            onChange={(e) => cambiarTipo(i, e.target.value as TipoLineaDesglose)}
                          >
                            {(Object.keys(TIPO_LABEL) as TipoLineaDesglose[]).map((t) => (
                              <option key={t} value={t}>{TIPO_LABEL[t]}</option>
                            ))}
                          </select>
                        </td>

                        <td className="px-2 py-2">
                          {linea.tipo === "reciclaje" ? (
                            <span className="text-muted-foreground">Fruta ya contada: no suma a ningún lote</span>
                          ) : linea.tipo === "lote" ? (
                            <>
                              <Input
                                aria-label={`Código de lote de la línea ${i + 1}`}
                                className="h-8 w-32 font-mono text-xs"
                                placeholder="26051904"
                                value={linea.lote_codigo ?? ""}
                                disabled={readOnly}
                                onChange={(e) => patch(i, { lote_codigo: e.target.value })}
                              />
                              {fueraDeBascula && (
                                <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                                  <AlertTriangle className="h-3 w-3" /> No está en báscula
                                </p>
                              )}
                              {entrada && (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  {entrada.agricultor || entrada.finca || "—"}
                                  {kgBoxReferencia ? ` · ${formatKg(kgBoxReferencia)}/box en báscula` : ""}
                                </p>
                              )}
                            </>
                          ) : (
                            <>
                              <Input
                                type="date"
                                aria-label={`Fecha del precalibrado de la línea ${i + 1}`}
                                className="h-8 w-36 text-xs"
                                value={linea.prec_fecha ?? ""}
                                disabled={readOnly}
                                onChange={(e) => cambiarFechaPrec(i, e.target.value)}
                              />
                              {candidatas.length > 1 && (
                                <select
                                  aria-label={`Almacén del precalibrado de la línea ${i + 1}`}
                                  className={`${SELECT_CLASS} mt-1 w-36`}
                                  value={linea.lote_codigo ?? ""}
                                  disabled={readOnly}
                                  onChange={(e) => patch(i, { lote_codigo: e.target.value || null })}
                                >
                                  <option value="">¿Cuál de los dos?</option>
                                  {candidatas.map((c) => (
                                    // La finca ("PREC 1/2 ALMACEN") solo viene
                                    // en las filas del export de báscula; en las
                                    // sembradas desde stock hay que decidir por
                                    // kg y box, que es lo que de verdad ayuda a
                                    // saber cuál de las dos se echó.
                                    <option key={c.lote} value={c.lote}>
                                      {c.lote} · {c.finca ?? "PREC"} · {formatKg(c.kg_entrada)}
                                      {c.envases ? ` · ${c.envases} box` : ""}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {linea.prec_fecha && candidatas.length === 0 && (
                                <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                                  <AlertTriangle className="h-3 w-3" /> Sin re-entrada de báscula ese día: sus kg no se atribuyen a ningún lote
                                </p>
                              )}
                              {linea.lote_codigo && (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Cuenta como {linea.lote_codigo}
                                  {kgBoxReferencia ? ` · ${formatKg(kgBoxReferencia)}/box en báscula` : ""}
                                </p>
                              )}
                            </>
                          )}
                        </td>

                        <td className="px-2 py-2 text-right">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            aria-label={`Box de la línea ${i + 1}`}
                            className="h-8 w-20 text-right text-xs tabular-nums"
                            placeholder="—"
                            value={linea.box ?? ""}
                            disabled={readOnly}
                            onChange={(e) => patch(i, { box: e.target.value === "" ? null : Number(e.target.value) })}
                          />
                        </td>

                        <td className="px-2 py-2">
                          <select
                            aria-label={`Tamaño de box de la línea ${i + 1}`}
                            className={SELECT_CLASS}
                            value={linea.box_tamano}
                            disabled={readOnly}
                            onChange={(e) => patch(i, { box_tamano: e.target.value as BoxTamano })}
                          >
                            {BOX_TAMANOS.map((t) => (
                              <option key={t} value={t}>{BOX_TAMANO_LABEL[t]}</option>
                            ))}
                          </select>
                        </td>

                        <td className="px-2 py-2 text-right">
                          {linea.box == null ? (
                            <span className="text-[11px] text-warning">Faltan box</span>
                          ) : (
                            <span className="font-semibold tabular-nums">{formatKg(linea.kg)}</span>
                          )}
                          {linea.box != null && !linea.codigoAtribuido && (
                            <p className="text-[11px] text-muted-foreground">sin atribuir</p>
                          )}
                        </td>

                        <td className="px-2 py-2 text-right">
                          {!readOnly && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5 text-muted-foreground hover:text-destructive"
                              aria-label={`Quitar la línea ${i + 1}`}
                              onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLineas((p) => [...p, lineaVacia()])}>
                <Plus className="h-3.5 w-3.5" /> Lote
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLineas((p) => [...p, lineaVacia("precalibrado")])}>
                <Plus className="h-3.5 w-3.5" /> Precalibrado
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLineas((p) => [...p, { ...lineaVacia("reciclaje"), nota: "Reciclaje" }])}>
                <Plus className="h-3.5 w-3.5" /> Reciclaje
              </Button>
            </div>
          )}

          {lineas.length > 0 && (
            <div className="space-y-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-xs">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span><span className="text-muted-foreground">Box:</span> <span className="font-semibold tabular-nums">{reparto.boxTotal}</span></span>
                {reparto.kgPorBoxReal != null && (
                  <span><span className="text-muted-foreground">Real:</span> <span className="font-semibold tabular-nums">{formatKg(reparto.kgPorBoxReal)}/box</span></span>
                )}
                <span><span className="text-muted-foreground">A lotes:</span> <span className="font-semibold tabular-nums">{formatKg(reparto.kgAtribuido)}</span></span>
                {reparto.kgSinAtribuir > 0 && (
                  <span><span className="text-muted-foreground">Sin atribuir:</span> <span className="font-semibold tabular-nums">{formatKg(reparto.kgSinAtribuir)}</span></span>
                )}
              </p>
              {reparto.lineasSinBox > 0 && (
                <p className="flex items-center gap-1.5 text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {reparto.lineasSinBox} línea(s) sin box: no reciben kg hasta que los indiques.
                </p>
              )}
              {reparto.boxTotal > 0 && (
                <p className="text-muted-foreground">
                  Box llenos serían {formatKg(reparto.kgTeoricoTotal)};{" "}
                  {reparto.desviacionKg < 0
                    ? `van ${formatKg(Math.abs(reparto.desviacionKg))} por debajo (${(Math.abs(reparto.desviacionKg) / reparto.kgTeoricoTotal * 100).toFixed(0)} %), lo normal.`
                    : `van ${formatKg(reparto.desviacionKg)} por encima: revisa si faltan box por indicar.`}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {!readOnly && lineasGuardadas.length > 0 && (
            <Button
              variant="ghost"
              className="mr-auto text-muted-foreground hover:text-destructive"
              disabled={guardar.isPending}
              onClick={() => setLineas([])}
            >
              <Trash2 className="h-3.5 w-3.5" /> Vaciar
            </Button>
          )}
          {readOnly ? (
            <Badge variant="outline" className="border-[var(--glass-border)] font-normal text-muted-foreground">
              Parte cerrado: solo lectura
            </Badge>
          ) : (
            <Button onClick={() => void handleGuardar()} disabled={guardar.isPending}>
              {guardar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Boxes className="h-3.5 w-3.5" />}
              Guardar desglose
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
