import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTooltip } from "@/components/InfoTooltip";
import { DestinoBar, type DestinoFrutaItem } from "@/components/CascadeView";
import { C } from "@/lib/chartTheme";
import { Globe } from "lucide-react";

interface TopItem {
  label: string;
  pct: number;
}

interface PartDetailDestinoProps {
  destinoFruta: DestinoFrutaItem[] | undefined;
  loading: boolean;
  produccionReal: number;
  calibreDominante?: TopItem | null;
  categoriaTop?: TopItem | null;
}

export default function PartDetailDestino({ destinoFruta, loading, produccionReal, calibreDominante, categoriaTop }: PartDetailDestinoProps) {
  const sinClasificar = destinoFruta
    ? Math.max(0, produccionReal - destinoFruta.reduce((s, d) => s + d.kg, 0))
    : 0;

  if (!loading && (!destinoFruta || destinoFruta.length === 0)) return null;

  return (
    <Card className="glass-accented">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="panel-kicker">Clasificación</p>
              <InfoTooltip iconClassName="h-3 w-3">
                Reparto de la producción real por destino, a partir de los lotes clasificados al analizar el parte con IA (misma clasificación que el Dashboard). "Sin clasificar" es la diferencia entre la producción real y lo ya clasificado — un cálculo distinto del DJPMN. El calibre y la categoría vienen del Informe de tamaños, que se genera para todo el día (no por lote).
              </InfoTooltip>
            </div>
            <CardTitle className="text-base">Destino de la fruta</CardTitle>
            {(calibreDominante || categoriaTop) && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {calibreDominante && <>Calibre dominante: <span className="font-medium text-foreground">{calibreDominante.label}</span> ({calibreDominante.pct.toFixed(1)}%)</>}
                {calibreDominante && categoriaTop && " · "}
                {categoriaTop && <>Categoría top: <span className="font-medium text-foreground">{categoriaTop.label}</span> ({categoriaTop.pct.toFixed(1)}%)</>}
              </p>
            )}
          </div>
          <Globe className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <>
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </>
        ) : (
          <>
            {destinoFruta!.map((d) => (
              <DestinoBar key={d.grupo} label={d.grupo} kg={d.kg} total={produccionReal} color={d.color} />
            ))}
            {sinClasificar > 0 && (
              <DestinoBar label="Sin clasificar" kg={sinClasificar} total={produccionReal} color={C.destructive} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
