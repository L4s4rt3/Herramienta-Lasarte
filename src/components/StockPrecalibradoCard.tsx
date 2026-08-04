/**
 * StockPrecalibradoCard — el precalibrado SIEMPRE visible (regla del dueño,
 * 2026-07-28), en la pestaña "Stock en cámara" de /entradas.
 *
 * Muestra lo medible con fiabilidad del circuito PREC: kg reintroducidos por
 * báscula, cuánto ya re-pasó por línea y cuánto sigue FÍSICAMENTE en la nave
 * esperando calibrador, por almacén (PREC 1/2) y por re-entrada. Lo apartado
 * HACIA el almacén no siempre se pesa, así que el contenido total del almacén
 * no se calcula (ver src/lib/stockPrecalibrado.ts).
 *
 * Refuerzo 04-08-2026 (el dueño: "estoy segurísimo de que se han usado, pero
 * no lo has detectado" + corrección posterior "no asumas, usa lo que se
 * indique"): además de lo pendiente de siempre, ahora distingue las
 * re-entradas resueltas por EVIDENCIA de pasada compuesta (nombradas por su
 * código en una pasada del calibrador aunque el reparto no les diera kg
 * propio — se cierran solas, ver useEntradasBascula/candidatosCierre) de las
 * que NO tienen ninguna indicación en ningún informe (esas jamás se cierran
 * solas: cierre manual 1-clic, admin).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, Lock, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import type { CierreModo } from "@/lib/entradasBascula";
import { errorMessage } from "@/lib/errorMessage";
import type { StockPrecalibrado } from "@/lib/stockPrecalibrado";
import { formatDate, formatKgCompact as formatKg } from "@/lib/format";

interface CerrarLoteMutation {
  mutate: (
    variables: { id: string; cierreModo: CierreModo },
    options?: { onSuccess?: () => void; onError?: (e: unknown) => void },
  ) => void;
  isPending: boolean;
}

interface Props {
  /** Ya calculado por la página (compartido con el efecto de cierre automático) — ver src/lib/stockPrecalibrado.ts. */
  stock: StockPrecalibrado;
  /** Cierre manual 1-clic de una re-entrada SIN indicación en ningún informe (nunca automático, ver cabecera del archivo). Opcional: sin ella, el botón no se muestra. */
  cerrarLote?: CerrarLoteMutation;
}

export function StockPrecalibradoCard({ stock, cerrarLote }: Props) {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [cerrandoId, setCerrandoId] = useState<string | null>(null);

  if (stock.nReentradas === 0) return null;

  const handleCerrarManual = (id: string, lote: string) => {
    if (!cerrarLote) return;
    setCerrandoId(id);
    cerrarLote.mutate(
      { id, cierreModo: "sin_registro" },
      {
        onSuccess: () => {
          setCerrandoId(null);
          toast({ title: `Re-entrada ${lote} cerrada`, description: "Cierre manual: sin indicación en ningún informe, decisión del usuario." });
        },
        onError: (e) => {
          setCerrandoId(null);
          toast({ title: "No se pudo cerrar", description: errorMessage(e), variant: "destructive" });
        },
      },
    );
  };

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

        {stock.resueltasPorCompuesta.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-lg border border-success/30 bg-success/10 p-2 text-[11px] text-success">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {stock.resueltasPorCompuesta.length} re-entrada{stock.resueltasPorCompuesta.length === 1 ? "" : "s"} ({formatKg(stock.resueltasPorCompuesta.reduce((s, r) => s + r.kg, 0))})
              {" "}resuelta{stock.resueltasPorCompuesta.length === 1 ? "" : "s"} por evidencia: el calibrador las nombró en una pasada compuesta
              (junto a {Array.from(new Set(stock.resueltasPorCompuesta.flatMap((r) => r.primeros))).slice(0, 3).join(", ")}
              {stock.resueltasPorCompuesta.length > 3 ? "…" : ""}) aunque no les atribuyera kg bajo su propio código — se cierran solas 2 días
              después de esa mención.
            </span>
          </p>
        )}

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
                  {cerrarLote && <TableHead className="text-right">Sin indicación</TableHead>}
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
                    {cerrarLote && (
                      <TableCell className="text-right">
                        {isAdmin && p.id ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            disabled={cerrarLote.isPending && cerrandoId === p.id}
                            title={`Sin ninguna pasada del calibrador que la mencione (ni directa ni compuesta) en ${p.dias} días: no se cierra sola — decisión manual.`}
                            onClick={() => handleCerrarManual(p.id!, p.lote)}
                          >
                            {cerrarLote.isPending && cerrandoId === p.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : "Cerrar"}
                          </Button>
                        ) : (
                          <Lock className="ml-auto h-3 w-3 text-muted-foreground" />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6}>Total pendiente en nave (sin indicación)</TableCell>
                  <TableCell className="text-right tabular-nums" colSpan={cerrarLote ? 2 : 1}>{formatKg(Math.round(stock.kgPendiente))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
