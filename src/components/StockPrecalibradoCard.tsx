/**
 * StockPrecalibradoCard — el precalibrado SIEMPRE visible (regla del dueño,
 * 2026-07-28), en la pestaña "Stock en cámara" de /entradas.
 *
 * Muestra lo medible con fiabilidad del circuito PREC: kg reintroducidos por
 * báscula, cuánto ya re-pasó por línea y cuánto sigue FÍSICAMENTE en la nave
 * esperando calibrador, por almacén (PREC 1/2) y por re-entrada. Lo apartado
 * HACIA el almacén no siempre se pesa, así que el contenido total del almacén
 * no se calcula (ver src/lib/stockPrecalibrado.ts).
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildStockPrecalibrado, type ReentradaPrecalibradoInput } from "@/lib/stockPrecalibrado";
import { formatDate, formatKgCompact as formatKg, today } from "@/lib/format";

interface Props {
  reentradas: ReentradaPrecalibradoInput[];
  /** Filas sintéticas de la conciliación de kg (conciliacionKg.procesados). */
  procesadosConciliados: Array<{ lote_codigo: string; kg_peso_total: number }>;
}

export function StockPrecalibradoCard({ reentradas, procesadosConciliados }: Props) {
  const stock = useMemo(
    () => buildStockPrecalibrado(reentradas, procesadosConciliados, today()),
    [reentradas, procesadosConciliados],
  );

  if (stock.nReentradas === 0) return null;

  return (
    <Card className="glass-accented">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
          <div>
            <p className="panel-kicker">Stock de precalibrado</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Fruta apartada que vuelve a entrar para re-pasarse. Lo apartado hacia el almacén no siempre se pesa:
              esto es lo REINTRODUCIDO por báscula y lo que aún espera línea.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
            <RotateCcw className="h-3.5 w-3.5 text-primary" />
            {formatKg(Math.round(stock.kgPendiente))} en nave esperando línea
          </span>
          <span className="tabular-nums text-muted-foreground">
            reintroducido {formatKg(Math.round(stock.kgReintroducido))} ({stock.nReentradas} re-entradas)
          </span>
          <span className="tabular-nums text-muted-foreground">
            re-procesado {formatKg(Math.round(stock.kgReprocesado))}
          </span>
          {stock.porAlmacen.map((a) => (
            <span key={a.almacen} className="tabular-nums text-muted-foreground">
              {a.almacen}: {formatKg(Math.round(a.kg))}{a.kgPendiente > 0 && <> · pendiente {formatKg(Math.round(a.kgPendiente))}</>}
            </span>
          ))}
        </div>

        {stock.pendientes.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Almacén</TableHead>
                  <TableHead>Re-entrada</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead className="text-right">Días esperando</TableHead>
                  <TableHead className="text-right">Reintroducido</TableHead>
                  <TableHead className="text-right">Re-procesado</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.pendientes.map((p) => (
                  <TableRow key={`${p.lote}::${p.fecha}`}>
                    <TableCell>
                      <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] text-primary">{p.almacen}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(p.fecha)}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link
                        to={`/trazabilidad?lote=${encodeURIComponent(p.lote)}`}
                        className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                      >
                        {p.lote}
                      </Link>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${p.dias > 7 ? "font-semibold text-warning" : ""}`}>{p.dias}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatKg(Math.round(p.kg))}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatKg(Math.round(p.kgReprocesado))}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatKg(Math.round(p.kgPendiente))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6}>Total pendiente en nave</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKg(Math.round(stock.kgPendiente))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
