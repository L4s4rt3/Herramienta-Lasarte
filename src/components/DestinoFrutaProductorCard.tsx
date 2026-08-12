/**
 * DestinoFrutaProductorCard — a qué clientes fue la fruta de este productor.
 *
 * Cierra la pregunta que la app no podía responder: del productor al cliente.
 * Los kilos y euros van repartidos a peso porque el ERP dice qué entradas
 * alimentaron cada lote de confección, no de qué entrada salió cada palet: la
 * lista de clientes es un hecho, las cifras son estimación y se etiquetan.
 *
 * La identidad del productor se casa por `productor_id` y por código de lote,
 * nunca por nombre (ver useDestinoFrutaProductor).
 */
import { Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDestinoFrutaProductor } from "@/hooks/useDestinoFrutaProductor";
import { formatEuro, formatKg } from "@/lib/format";

export function DestinoFrutaProductorCard({ productorKey }: { productorKey: string }) {
  const { ficha, isLoading } = useDestinoFrutaProductor(productorKey);

  if (isLoading) {
    return (
      <Card className="glass-accented">
        <CardContent className="space-y-2 py-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }
  if (!ficha || ficha.clientes.length === 0) return null;

  const vendidos = ficha.clientes.filter((c) => c.cliente !== "(sin vender)");
  const sinVender = ficha.clientes.find((c) => c.cliente === "(sin vender)");

  return (
    <Card className="glass-accented">
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-semibold">A dónde fue su fruta</span>
          <Badge variant="secondary" className="text-[10px] font-normal">según el ERP</Badge>
          <Badge variant="outline" className="text-[10px] font-normal">reparto estimado</Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Lotes de confección</p>
            <p className="text-lg font-semibold tabular-nums">{ficha.confecciones.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Kg trazados</p>
            <p className="text-lg font-semibold tabular-nums">{formatKg(ficha.kgEstimadosVendidos)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Facturado</p>
            <p className="text-lg font-semibold tabular-nums">
              {ficha.eurosEstimados != null ? formatEuro(ficha.eurosEstimados) : "sin facturar"}
            </p>
          </div>
        </div>

        <ul className="space-y-1 text-sm">
          {vendidos.map((c) => (
            <li key={c.cliente} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{c.cliente}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                {formatKg(c.kgEstimados)}
                {c.eurosEstimados != null && ` · ${formatEuro(c.eurosEstimados)}`}
              </span>
            </li>
          ))}
          {sinVender && (
            <li className="flex flex-wrap items-baseline gap-x-2 border-t pt-1 text-muted-foreground">
              <span>Todavía sin vender</span>
              <span className="ml-auto tabular-nums">{formatKg(sinVender.kgEstimados)}</span>
            </li>
          )}
        </ul>

        <p className="text-xs text-muted-foreground">
          Solo aparece la fruta cuyo recorrido registró el ERP: en la campaña, el 57% de los kilos paletizados. Lo
          que no sale aquí no es que no se vendiera, es que el ERP no enlazó su elaboración. Y el reparto entre
          clientes va a peso, porque el ERP sabe qué entradas alimentaron cada lote de confección pero no de qué
          entrada salió cada palet.
        </p>
      </CardContent>
    </Card>
  );
}
