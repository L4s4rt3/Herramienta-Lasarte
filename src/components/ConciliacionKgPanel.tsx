// ConciliacionKgPanel — la auditoría visible de conciliarKgProcesados (ver
// src/lib/conciliacionKg.ts): dónde ha ido cada kg que el calibrador atribuyó
// a un código que no podía absorberlo. Pestaña "Conciliación kg" de Entradas.
//
// Enseña, en este orden: (1) KPIs del reparto, (2) los movimientos entre
// lotes agregados por origen→destino con su motivo, (3) los boxes de
// reciclaje descontados (Z1/Z2 netos), y (4) la cola de
// revisión: exceso que NO encontró receptor y que alguien debe mirar a mano
// (códigos con errores de tecleo, excesos sin lote hermano con pendiente…).
// Todo enlaza a la ficha de Trazabilidad del lote.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Recycle, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ConciliacionKg, MovimientoKg } from "@/lib/conciliacionKg";
import type { StockLoteRow } from "@/lib/entradasBascula";
import { formatKgCompact as formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const MOTIVO_LABEL: Record<MovimientoKg["motivo"], string> = {
  multi_codigo: "pasada multi-lote",
  exceso_misma_finca: "exceso → misma finca",
  exceso_misma_variedad: "exceso → misma variedad",
};

const MOTIVO_BADGE: Record<MovimientoKg["motivo"], string> = {
  multi_codigo: "border-info/40 bg-info/10 text-info",
  exceso_misma_finca: "border-success/40 bg-success/10 text-success",
  exceso_misma_variedad: "border-warning/40 bg-warning/10 text-warning",
};

function LoteLink({ lote }: { lote: string }) {
  // Solo los códigos de 8 dígitos tienen ficha; los textos crudos de la cola
  // ("PREC DIA 08/11/25") se muestran tal cual.
  if (!/^\d{8}$/.test(lote)) return <span className="text-muted-foreground">{lote}</span>;
  return (
    <Link to={`/trazabilidad?lote=${lote}`} className="font-medium tabular-nums text-info hover:underline">
      {lote}
    </Link>
  );
}

export function ConciliacionKgPanel({ conciliacion, filasStock }: {
  conciliacion: ConciliacionKg;
  filasStock: StockLoteRow[];
}) {
  const { movimientos, excesosSinColocar, reciclaje, kgReciclajeEstimado } = conciliacion;

  const infoPorLote = useMemo(() => {
    const map = new Map<string, { finca: string | null; articulo: string | null }>();
    for (const f of filasStock) map.set(f.lote, { finca: f.finca, articulo: f.articulo });
    return map;
  }, [filasStock]);

  // Movimientos agregados por (de, a, motivo): un mismo par puede repetirse
  // en varias pasadas; agregado es como se audita, no pasada a pasada.
  const movimientosAgregados = useMemo(() => {
    const map = new Map<string, MovimientoKg>();
    for (const m of movimientos) {
      const key = `${m.de}::${m.a}::${m.motivo}`;
      const acc = map.get(key);
      if (acc) acc.kg += m.kg;
      else map.set(key, { ...m });
    }
    return Array.from(map.values()).sort((a, b) => b.kg - a.kg);
  }, [movimientos]);

  const kgPorMotivo = useMemo(() => {
    const acc: Record<MovimientoKg["motivo"], number> = { multi_codigo: 0, exceso_misma_finca: 0, exceso_misma_variedad: 0 };
    for (const m of movimientos) acc[m.motivo] += m.kg;
    return acc;
  }, [movimientos]);

  const reciclajePorLote = useMemo(() => {
    const map = new Map<string, { nBox: number; kg: number }>();
    for (const r of reciclaje) {
      const acc = map.get(r.lote) ?? { nBox: 0, kg: 0 };
      acc.nBox += r.nBox;
      acc.kg += r.kg;
      map.set(r.lote, acc);
    }
    return Array.from(map.entries()).map(([lote, v]) => ({ lote, ...v })).sort((a, b) => b.kg - a.kg);
  }, [reciclaje]);

  const colaOrdenada = useMemo(
    () => [...excesosSinColocar].sort((a, b) => b.kg - a.kg),
    [excesosSinColocar],
  );

  const kgMovidos = movimientos.reduce((s, m) => s + m.kg, 0);
  const kgCola = excesosSinColocar.reduce((s, e) => s + e.kg, 0);
  const totalBoxes = reciclaje.reduce((s, r) => s + r.nBox, 0);

  return (
    <div className="space-y-4">
      <Card className="glass-accented">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 bg-primary/10 text-primary">
              <Scale className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Conciliación de kg procesados</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                El calibrador atribuye cada pasada al primer código de lote de su nombre, pero en línea se mezclan
                lotes (camiones seguidos sin cambiar el código, boxes de reciclaje, precalibrado). Aquí se ve cómo se
                ha repartido cada kg: los lotes con más kg que su entrada ceden el exceso a lotes con pendiente —
                primero misma finca y variedad, luego misma variedad — y el reciclaje del parte (reciclado malla
                Z1+Z2, ya neto de la tara de sus box) se descuenta de las pasadas de su día:
                es fruta que vuelve de la línea, ya contada en su lote. El stock y las fichas usan estos números; los
                datos crudos del calibrador no se modifican.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-[var(--glass-border)] pt-3 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
              <p className="text-xs font-semibold text-muted-foreground">Kg reasignados</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{formatKg(kgMovidos)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatKg(kgPorMotivo.multi_codigo)} multi-lote · {formatKg(kgPorMotivo.exceso_misma_finca)} misma finca
                · {formatKg(kgPorMotivo.exceso_misma_variedad)} misma variedad
              </p>
            </div>
            <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
              <p className="text-xs font-semibold text-muted-foreground">Reciclaje descontado (neto)</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{formatKg(kgReciclajeEstimado)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{formatNumber(totalBoxes)} box · kg ya netos de tara</p>
            </div>
            <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
              <p className="text-xs font-semibold text-muted-foreground">Movimientos</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{formatNumber(movimientosAgregados.length)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">pares lote→lote</p>
            </div>
            <div className={cn("rounded-lg border p-3", kgCola > 0 ? "border-warning/40 bg-warning/10" : "border-[var(--glass-border)] bg-[var(--glass-bg)]")}>
              <p className={cn("text-xs font-semibold", kgCola > 0 ? "text-warning" : "text-muted-foreground")}>Cola de revisión</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{formatKg(kgCola)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{formatNumber(colaOrdenada.length)} caso(s) sin receptor</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Movimientos */}
      <Card className="glass-accented">
        <CardContent className="p-4 sm:p-5">
          <p className="mb-2 text-sm font-semibold">Movimientos entre lotes</p>
          {movimientosAgregados.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos: todos los kg procesados caben en su propio lote.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-bg)] text-left text-xs text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">Del lote</th>
                    <th className="px-3 py-1.5 font-medium" />
                    <th className="px-3 py-1.5 font-medium">Al lote</th>
                    <th className="px-3 py-1.5 font-medium">Destino (finca · variedad)</th>
                    <th className="px-3 py-1.5 text-right font-medium">Kg</th>
                    <th className="px-3 py-1.5 font-medium">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientosAgregados.slice(0, 150).map((m, i) => {
                    const destino = infoPorLote.get(m.a);
                    return (
                      <tr key={`${m.de}-${m.a}-${m.motivo}-${i}`} className="border-b border-[var(--glass-border)] last:border-0">
                        <td className="px-3 py-1.5"><LoteLink lote={m.de} /></td>
                        <td className="px-1 py-1.5"><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
                        <td className="px-3 py-1.5"><LoteLink lote={m.a} /></td>
                        <td className="max-w-56 truncate px-3 py-1.5 text-xs text-muted-foreground">
                          {destino ? `${destino.finca ?? "—"}${destino.articulo ? ` · ${destino.articulo}` : ""}` : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatKg(m.kg)}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", MOTIVO_BADGE[m.motivo])}>
                            {MOTIVO_LABEL[m.motivo]}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {movimientosAgregados.length > 150 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Mostrando los 150 movimientos con más kg de {formatNumber(movimientosAgregados.length)}.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Reciclaje */}
        <Card className="glass-accented">
          <CardContent className="p-4 sm:p-5">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Recycle className="h-4 w-4 text-success" /> Reciclaje descontado por día/pasada
            </p>
            {reciclajePorLote.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin reciclaje que descontar: los partes no traen kg de reciclado (Z1/Z2) para los días con pasadas.
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-lg border border-[var(--glass-border)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-bg)] text-left text-xs text-muted-foreground">
                      <th className="px-3 py-1.5 font-medium">Pasada del lote / parte</th>
                      <th className="px-3 py-1.5 text-right font-medium">Boxes</th>
                      <th className="px-3 py-1.5 text-right font-medium">Kg netos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reciclajePorLote.map((r) => (
                      <tr key={r.lote} className="border-b border-[var(--glass-border)] last:border-0">
                        <td className="px-3 py-1.5"><LoteLink lote={r.lote} /></td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(r.nBox)}</td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatKg(r.kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cola de revisión */}
        <Card className={cn("glass-accented", colaOrdenada.length > 0 && "border-warning/30")}>
          <CardContent className="p-4 sm:p-5">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <AlertTriangle className={cn("h-4 w-4", colaOrdenada.length > 0 ? "text-warning" : "text-muted-foreground")} />
              Cola de revisión
            </p>
            {colaOrdenada.length === 0 ? (
              <p className="text-sm text-muted-foreground">Vacía: todo el exceso encontró receptor.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  Kg atribuidos a estos códigos que superan su entrada y no tienen ningún lote compatible con
                  pendiente (errores de tecleo del calibrador, mezclas fuera de la finca/variedad…). Se quedan fuera
                  del procesado conciliado hasta que alguien los revise — no se inventa un cuadre.
                </p>
                <div className="max-h-96 overflow-y-auto rounded-lg border border-[var(--glass-border)]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0">
                      <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-bg)] text-left text-xs text-muted-foreground">
                        <th className="px-3 py-1.5 font-medium">Código</th>
                        <th className="px-3 py-1.5 font-medium">Finca · variedad</th>
                        <th className="px-3 py-1.5 text-right font-medium">Kg sin colocar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {colaOrdenada.map((e, i) => {
                        const info = infoPorLote.get(e.lote);
                        return (
                          <tr key={`${e.lote}-${i}`} className="border-b border-[var(--glass-border)] last:border-0">
                            <td className="px-3 py-1.5"><LoteLink lote={e.lote} /></td>
                            <td className="max-w-48 truncate px-3 py-1.5 text-xs text-muted-foreground">
                              {info ? `${info.finca ?? "—"}${info.articulo ? ` · ${info.articulo}` : ""}` : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatKg(e.kg)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
