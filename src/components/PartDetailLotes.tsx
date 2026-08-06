import { Fragment, useMemo, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTooltip } from "@/components/InfoTooltip";
import { formatKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Boxes, Layers } from "lucide-react";
import { DesglosarPasadaDialog } from "@/components/DesglosarPasadaDialog";
import { repartirPasadaPorBox, type LineaDesglose, type ReentradaPrecCandidata } from "@/lib/desgloseBox";
import type { EntradaParaDesglose } from "@/hooks/usePasadaBoxLineas";

export interface LoteDelDia {
  id: string;
  lote_codigo: string | null;
  productor: string | null;
  producto: string | null;
  kg_peso_total: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  kg_industria: number;
  /** Kg apartados a PRECALIBRADO 1/2 desde este lote hoy (manual, migración 20260722100000): el flujo de ENTRADA al almacén PREC que faltaba. */
  kg_precalibrado_z1: number;
  kg_precalibrado_z2: number;
  notas: string | null;
}

export type LotePatch = Partial<Pick<LoteDelDia, "notas" | "kg_industria" | "kg_precalibrado_z1" | "kg_precalibrado_z2">>;

/**
 * Desglose por box de las pasadas (encargo del dueño 06-08-2026): lo que hace
 * falta para poder abrir una pasada y decir qué lotes se echaron en ella. Es
 * opcional — sin él, la tabla es exactamente la de siempre.
 */
export interface DesgloseBoxProps {
  /** Líneas ya guardadas de una pasada (usePasadaBoxLineas). */
  lineasDe: (loteDiaId: string) => LineaDesglose[];
  reentradasPrec: ReentradaPrecCandidata[];
  codigosBascula: Set<string>;
  entradaPorCodigo: Map<string, EntradaParaDesglose>;
  guardar: {
    mutateAsync: (v: { loteDiaId: string; lineas: LineaDesglose[] }) => Promise<{ guardadas: number }>;
    isPending: boolean;
  };
}

interface PartDetailLotesProps {
  lotes: LoteDelDia[];
  loading: boolean;
  readOnly: boolean;
  onLoteUpdate: (loteId: string, patch: LotePatch) => void;
  /** Fecha del parte: da el año a las fechas "22/07" con que se nombra el precalibrado. */
  fechaParte?: string;
  desglose?: DesgloseBoxProps;
}

function tphClass(tph: number | null) {
  if (tph === null) return "text-muted-foreground";
  return tph >= 14.5 ? "text-success" : tph >= 12.5 ? "text-warning" : "text-destructive";
}

function LoteNotaField({ loteId, initialValue, readOnly, onSave }: {
  loteId: string;
  initialValue: string;
  readOnly: boolean;
  onSave: (loteId: string, patch: LotePatch) => void;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue]);

  if (readOnly) {
    return value
      ? <p className="text-xs text-muted-foreground">{value}</p>
      : <span className="text-xs text-muted-foreground/50">—</span>;
  }

  return (
    <Input
      value={value}
      placeholder="Añadir nota…"
      className="h-8 text-xs"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value !== initialValue) onSave(loteId, { notas: value }); }}
    />
  );
}

/** Campo numérico manual por lote (kg): sirve para kg_industria y para los apartados a PREC 1/2. */
function LoteKgField({ loteId, campo, initialValue, readOnly, onSave }: {
  loteId: string;
  campo: "kg_industria" | "kg_precalibrado_z1" | "kg_precalibrado_z2";
  initialValue: number;
  readOnly: boolean;
  onSave: (loteId: string, patch: LotePatch) => void;
}) {
  const [value, setValue] = useState(String(initialValue || ""));
  useEffect(() => setValue(String(initialValue || "")), [initialValue]);

  if (readOnly) {
    return initialValue > 0
      ? <span className="tabular-nums text-xs">{formatKg(initialValue)}</span>
      : <span className="text-xs text-muted-foreground/50">—</span>;
  }

  return (
    <div className="relative w-28">
      <Input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        value={value}
        placeholder="0"
        className="h-8 pr-8 text-right text-xs tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const next = Number(value) || 0;
          if (next !== initialValue) onSave(loteId, { [campo]: next });
        }}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground">kg</span>
    </div>
  );
}

/** Etiqueta de una línea del desglose: el lote, el precalibrado por fecha o el reciclaje. */
function etiquetaLinea(linea: LineaDesglose): string {
  // El "reciclaje" cubre todo lo que entra a línea sin ser de un lote nuevo
  // (reciclaje, descarte, desmontaje, Egipto): la nota dice cuál era.
  if (linea.tipo === "reciclaje") return linea.nota?.trim() || "Reciclaje";
  if (linea.lote_codigo) return linea.lote_codigo;
  if (linea.prec_fecha) return `PREC ${linea.prec_fecha.slice(8, 10)}/${linea.prec_fecha.slice(5, 7)}`;
  return "—";
}

export default function PartDetailLotes({
  lotes, loading, readOnly, onLoteUpdate, fechaParte, desglose,
}: PartDetailLotesProps) {
  const totalIndustria = lotes.reduce((s, l) => s + (Number(l.kg_industria) || 0), 0);
  const totalPrec = lotes.reduce((s, l) => s + (Number(l.kg_precalibrado_z1) || 0) + (Number(l.kg_precalibrado_z2) || 0), 0);

  const [pasadaADesglosar, setPasadaADesglosar] = useState<LoteDelDia | null>(null);

  // Reparto ya calculado de cada pasada desglosada: lo consumen la tabla, las
  // tarjetas de móvil y el resumen de la cabecera sin recalcular tres veces.
  const repartoPorLote = useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof repartirPasadaPorBox>>();
    if (!desglose) return mapa;
    for (const l of lotes) {
      const lineas = desglose.lineasDe(l.id);
      if (lineas.length > 0) mapa.set(l.id, repartirPasadaPorBox(Number(l.kg_peso_total) || 0, lineas));
    }
    return mapa;
  }, [lotes, desglose]);

  const puedeDesglosar = Boolean(desglose && fechaParte);

  /** Sub-filas del desglose de una pasada (mismo contenido en tabla y en móvil). */
  const filasDesglose = (loteId: string) => repartoPorLote.get(loteId)?.lineas ?? [];

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="panel-kicker">Trazabilidad del día</p>
              <InfoTooltip iconClassName="h-3 w-3">
                Lotes procesados según el informe de producción. El T/h de cada lote es la velocidad del calibrador mientras esa fruta pasaba — solo aparece si el parte se analizó con IA. Los kg de industria, los apartados a PREC 1/2 y la nota son datos manuales por lote y se conservan aunque se vuelva a analizar.
              </InfoTooltip>
            </div>
            <CardTitle className="text-base">Lotes procesados</CardTitle>
            {(totalIndustria > 0 || totalPrec > 0) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {totalIndustria > 0 && <>Industria de los lotes: <span className="font-medium tabular-nums text-foreground">{formatKg(totalIndustria)}</span></>}
                {totalIndustria > 0 && totalPrec > 0 && " · "}
                {totalPrec > 0 && <>Apartado a precalibrado: <span className="font-medium tabular-nums text-foreground">{formatKg(totalPrec)}</span></>}
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : lotes.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center text-sm text-muted-foreground">
            <Layers className="mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="font-medium text-foreground">Sin lotes para este día</p>
            <p className="max-w-xs text-xs">Sube el informe de producción y pulsa "Analizar parte" para verlos aquí.</p>
          </div>
        ) : (
          <>
            {/* Escritorio: tabla */}
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lote</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Productor / Finca</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Producto</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kg</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">T/h calibr.</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Duración</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kg industria</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">PREC 1</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">PREC 2</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nota del lote</th>
                    {puedeDesglosar && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((l) => (
                    <Fragment key={l.id}>
                    <tr>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">
                        {l.lote_codigo ? (
                          <Link to={`/trazabilidad?lote=${encodeURIComponent(l.lote_codigo)}`} className="hover:text-primary hover:underline">
                            {l.lote_codigo}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {l.productor && l.productor !== "—" ? (
                          <Link to={`/productores?productor=${encodeURIComponent(l.productor)}`} className="hover:text-primary hover:underline">
                            {l.productor}
                          </Link>
                        ) : (l.productor || "—")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{l.producto || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatKg(l.kg_peso_total)}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", tphClass(l.toneladas_hora))}>
                        {l.toneladas_hora ? l.toneladas_hora.toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {l.duracion_min ? `${l.duracion_min} min` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end">
                          <LoteKgField loteId={l.id} campo="kg_industria" initialValue={Number(l.kg_industria) || 0} readOnly={readOnly} onSave={onLoteUpdate} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end">
                          <LoteKgField loteId={l.id} campo="kg_precalibrado_z1" initialValue={Number(l.kg_precalibrado_z1) || 0} readOnly={readOnly} onSave={onLoteUpdate} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end">
                          <LoteKgField loteId={l.id} campo="kg_precalibrado_z2" initialValue={Number(l.kg_precalibrado_z2) || 0} readOnly={readOnly} onSave={onLoteUpdate} />
                        </div>
                      </td>
                      <td className="px-4 py-3 min-w-[220px]">
                        <LoteNotaField loteId={l.id} initialValue={l.notas ?? ""} readOnly={readOnly} onSave={onLoteUpdate} />
                      </td>
                      {puedeDesglosar && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 whitespace-nowrap px-2 text-[11px] text-muted-foreground hover:text-primary"
                            onClick={() => setPasadaADesglosar(l)}
                          >
                            <Boxes className="h-3.5 w-3.5" />
                            {filasDesglose(l.id).length > 0 ? `${filasDesglose(l.id).length} por box` : "Desglosar"}
                          </Button>
                        </td>
                      )}
                    </tr>
                    {/* Desglose por box: qué se echó de verdad en esta pasada. */}
                    {filasDesglose(l.id).map((linea, i) => (
                      <tr key={`${l.id}-box-${i}`} className="bg-[var(--glass-bg)]/40 text-xs">
                        <td className="px-4 py-1.5 pl-8 text-muted-foreground">
                          {linea.codigoAtribuido ? (
                            <Link to={`/trazabilidad?lote=${encodeURIComponent(linea.codigoAtribuido)}`} className="hover:text-primary hover:underline">
                              ↳ {etiquetaLinea(linea)}
                            </Link>
                          ) : (
                            <span>↳ {etiquetaLinea(linea)}</span>
                          )}
                        </td>
                        <td className="px-4 py-1.5 text-muted-foreground" colSpan={2}>
                          {linea.box == null
                            ? "sin box indicados"
                            : `${linea.box} box ${linea.box_tamano === "grande" ? "grandes" : "pequeños"}`}
                          {!linea.codigoAtribuido && linea.box != null && " · no suma a ningún lote"}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                          {linea.box == null ? "—" : formatKg(linea.kg)}
                        </td>
                        <td colSpan={puedeDesglosar ? 7 : 6} />
                      </tr>
                    ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Móvil: tarjetas */}
            <div className="divide-y divide-[var(--glass-border)] md:hidden">
              {lotes.map((l) => (
                <div key={l.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    {l.lote_codigo ? (
                      <Link to={`/trazabilidad?lote=${encodeURIComponent(l.lote_codigo)}`} className="font-semibold hover:text-primary hover:underline">
                        {l.lote_codigo}
                      </Link>
                    ) : (
                      <span className="font-semibold">—</span>
                    )}
                    <span className={cn("text-sm font-semibold tabular-nums", tphClass(l.toneladas_hora))}>
                      {l.toneladas_hora ? `${l.toneladas_hora.toFixed(1)} T/h` : "—"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {l.productor && l.productor !== "—" ? (
                      <Link to={`/productores?productor=${encodeURIComponent(l.productor)}`} className="hover:text-primary hover:underline">
                        {l.productor}
                      </Link>
                    ) : l.productor}
                    {l.productor && l.producto ? " · " : null}
                    {l.producto}
                    {!l.productor && !l.producto ? "—" : null}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatKg(l.kg_peso_total)}</span>
                    <span className="tabular-nums">{l.duracion_min ? `${l.duracion_min} min` : "—"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">Kg industria</span>
                    <LoteKgField loteId={l.id} campo="kg_industria" initialValue={Number(l.kg_industria) || 0} readOnly={readOnly} onSave={onLoteUpdate} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">Apartado PREC 1</span>
                    <LoteKgField loteId={l.id} campo="kg_precalibrado_z1" initialValue={Number(l.kg_precalibrado_z1) || 0} readOnly={readOnly} onSave={onLoteUpdate} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">Apartado PREC 2</span>
                    <LoteKgField loteId={l.id} campo="kg_precalibrado_z2" initialValue={Number(l.kg_precalibrado_z2) || 0} readOnly={readOnly} onSave={onLoteUpdate} />
                  </div>
                  <div className="mt-2">
                    <LoteNotaField loteId={l.id} initialValue={l.notas ?? ""} readOnly={readOnly} onSave={onLoteUpdate} />
                  </div>
                  {puedeDesglosar && (
                    <div className="mt-2 space-y-1">
                      {filasDesglose(l.id).map((linea, i) => (
                        <div key={`${l.id}-box-${i}`} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="truncate">
                            ↳ {etiquetaLinea(linea)}
                            {linea.box != null && ` · ${linea.box} box`}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums text-foreground">
                            {linea.box == null ? "—" : formatKg(linea.kg)}
                          </span>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full text-xs"
                        onClick={() => setPasadaADesglosar(l)}
                      >
                        <Boxes className="h-3.5 w-3.5" />
                        {filasDesglose(l.id).length > 0 ? "Editar desglose por box" : "Desglosar por box"}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>

      {desglose && fechaParte && pasadaADesglosar && (
        <DesglosarPasadaDialog
          open={Boolean(pasadaADesglosar)}
          onOpenChange={(next) => { if (!next) setPasadaADesglosar(null); }}
          pasada={{
            id: pasadaADesglosar.id,
            lote_codigo: pasadaADesglosar.lote_codigo,
            kg_peso_total: Number(pasadaADesglosar.kg_peso_total) || 0,
            date: fechaParte,
          }}
          lineasGuardadas={desglose.lineasDe(pasadaADesglosar.id)}
          reentradasPrec={desglose.reentradasPrec}
          codigosBascula={desglose.codigosBascula}
          entradaPorCodigo={desglose.entradaPorCodigo}
          guardar={desglose.guardar}
          // A propósito NO se pasa `readOnly`: el desglose por box no modifica
          // ni un dato del parte (ni la cascada ni el descuadre) — solo reparte
          // entre lotes kg que el calibrador ya midió. Exigir "Reabrir" el
          // parte para anotar box sería cambiar su estado por algo que no le
          // afecta. Mismo criterio que la anotación de pasada
          // (AnotarPasadaDialog), que tampoco depende del estado del parte.
        />
      )}
    </Card>
  );
}
