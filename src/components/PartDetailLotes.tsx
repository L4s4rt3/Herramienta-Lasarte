import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTooltip } from "@/components/InfoTooltip";
import { formatKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Layers } from "lucide-react";

export interface LoteDelDia {
  id: string;
  lote_codigo: string | null;
  productor: string | null;
  producto: string | null;
  kg_peso_total: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  kg_industria: number;
  notas: string | null;
}

export type LotePatch = Partial<Pick<LoteDelDia, "notas" | "kg_industria">>;

interface PartDetailLotesProps {
  lotes: LoteDelDia[];
  loading: boolean;
  readOnly: boolean;
  onLoteUpdate: (loteId: string, patch: LotePatch) => void;
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

function LoteIndustriaField({ loteId, initialValue, readOnly, onSave }: {
  loteId: string;
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
          if (next !== initialValue) onSave(loteId, { kg_industria: next });
        }}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground">kg</span>
    </div>
  );
}

export default function PartDetailLotes({ lotes, loading, readOnly, onLoteUpdate }: PartDetailLotesProps) {
  const totalIndustria = lotes.reduce((s, l) => s + (Number(l.kg_industria) || 0), 0);

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="panel-kicker">Trazabilidad del día</p>
              <InfoTooltip iconClassName="h-3 w-3">
                Lotes procesados según el informe de producción. El T/h de cada lote es la velocidad del calibrador mientras esa fruta pasaba — solo aparece si el parte se analizó con IA. Los kg de industria y la nota son datos manuales por lote y se conservan aunque se vuelva a analizar.
              </InfoTooltip>
            </div>
            <CardTitle className="text-base">Lotes procesados</CardTitle>
            {totalIndustria > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Industria de los lotes: <span className="font-medium tabular-nums text-foreground">{formatKg(totalIndustria)}</span>
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
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nota del lote</th>
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{l.lote_codigo || "—"}</td>
                      <td className="px-4 py-3">{l.productor || "—"}</td>
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
                          <LoteIndustriaField loteId={l.id} initialValue={Number(l.kg_industria) || 0} readOnly={readOnly} onSave={onLoteUpdate} />
                        </div>
                      </td>
                      <td className="px-4 py-3 min-w-[220px]">
                        <LoteNotaField loteId={l.id} initialValue={l.notas ?? ""} readOnly={readOnly} onSave={onLoteUpdate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Móvil: tarjetas */}
            <div className="divide-y divide-[var(--glass-border)] md:hidden">
              {lotes.map((l) => (
                <div key={l.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{l.lote_codigo || "—"}</span>
                    <span className={cn("text-sm font-semibold tabular-nums", tphClass(l.toneladas_hora))}>
                      {l.toneladas_hora ? `${l.toneladas_hora.toFixed(1)} T/h` : "—"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[l.productor, l.producto].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatKg(l.kg_peso_total)}</span>
                    <span className="tabular-nums">{l.duracion_min ? `${l.duracion_min} min` : "—"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">Kg industria</span>
                    <LoteIndustriaField loteId={l.id} initialValue={Number(l.kg_industria) || 0} readOnly={readOnly} onSave={onLoteUpdate} />
                  </div>
                  <div className="mt-2">
                    <LoteNotaField loteId={l.id} initialValue={l.notas ?? ""} readOnly={readOnly} onSave={onLoteUpdate} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
