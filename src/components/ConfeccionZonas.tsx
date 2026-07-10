// ConfeccionZonas — kg confeccionados por zona de trabajo (Mallas / Granel /
// Envasado / Industria) en cuatro rangos a la vez: último día con confección,
// semana visible, mes natural y campaña. Mismo patrón visual que el bloque
// "Reciclado de malla" del Dashboard. Fuente y criterio: src/lib/confeccionZonas.ts.
import { useMemo } from "react";
import { Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTooltip } from "@/components/InfoTooltip";
import { useConfeccionZonas } from "@/hooks/useConfeccionZonas";
import {
  agregarConfeccionZonas,
  ZONA_CONFECCION_LABEL,
  ZONAS_CONFECCION,
  type ConfeccionZonasAgg,
  type ZonaConfeccion,
} from "@/lib/confeccionZonas";
import { buildPeriodoRange } from "@/lib/consumoPeriodoView";
import { formatKg, formatPct } from "@/lib/format";
import { C } from "@/lib/chartTheme";

const ZONA_COLOR: Record<ZonaConfeccion, string> = {
  Mallas: C.info,
  Graneleras: C.warning,
  Envasado: C.primary,
  Industria: C.destructive,
};

function ZonaColumn({ title, subtitle, agg }: { title: string; subtitle: string; agg: ConfeccionZonasAgg }) {
  return (
    <div className="space-y-2.5 rounded-xl bg-[var(--glass-bg)] p-4">
      <div>
        <p className="panel-kicker">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {ZONAS_CONFECCION.map((zona) => {
        const kg = agg.kg[zona];
        const pct = agg.total > 0 ? (kg / agg.total) * 100 : 0;
        return (
          <div key={zona} className="flex items-center justify-between text-sm">
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ZONA_COLOR[zona] }} />
              {ZONA_CONFECCION_LABEL[zona]}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums text-xs text-muted-foreground">{formatKg(kg)}</span>
              <span className="min-w-[48px] text-right font-bold tabular-nums">{formatPct(pct, 0)}</span>
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between border-t border-[var(--glass-border)] pt-2.5 text-sm">
        <span className="font-medium">Total confeccionado</span>
        <span className="font-bold tabular-nums">{formatKg(agg.total)}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {agg.nDias} día{agg.nDias === 1 ? "" : "s"} con confección
      </p>
    </div>
  );
}

interface ConfeccionZonasProps {
  semanaStart: string;
  semanaEnd: string;
  semanaTitle: string;
  semanaSubtitle: string;
}

export function ConfeccionZonas({ semanaStart, semanaEnd, semanaTitle, semanaSubtitle }: ConfeccionZonasProps) {
  const { rows, ultimoDia, campana, isLoading } = useConfeccionZonas();
  const rangoMes = useMemo(() => buildPeriodoRange("mes", 0), []);

  const aggDia = useMemo(
    () => (ultimoDia ? agregarConfeccionZonas(rows, ultimoDia, ultimoDia) : agregarConfeccionZonas([], "0", "0")),
    [rows, ultimoDia],
  );
  const aggSemana = useMemo(() => agregarConfeccionZonas(rows, semanaStart, semanaEnd), [rows, semanaStart, semanaEnd]);
  const aggMes = useMemo(() => agregarConfeccionZonas(rows, rangoMes.start, rangoMes.end), [rows, rangoMes]);
  const aggCampana = useMemo(() => agregarConfeccionZonas(rows, campana.start, campana.end), [rows, campana]);

  return (
    <Card className="overflow-hidden glass-accented">
      <CardHeader className="pb-3 px-5 pt-4">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 rounded-full bg-primary" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-lg font-semibold">Confección por zona</CardTitle>
              <InfoTooltip>
                Kg del informe de producto repartidos por zona de trabajo: Mallas (girsac, D-Pack, MDNA…), Granel
                (graneleras), Envasado (mesas) e Industria. Mismo criterio de clasificación que el rendimiento por
                zonas de RRHH; los totales, el podrido, las muestras y el precalibrado quedan fuera. El % es el peso
                de cada zona sobre el total confeccionado del período.
              </InfoTooltip>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mallas · Granel · Envasado · Industria, por día, semana, mes y campaña
            </p>
          </div>
          <Boxes className="ml-auto h-5 w-5 shrink-0 text-primary/60" />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1">
        {isLoading ? (
          <Skeleton className="h-56" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin informes de producto en la campaña todavía.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ZonaColumn
              title="Último día"
              subtitle={ultimoDia
                ? new Date(`${ultimoDia}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" })
                : "Sin confección"}
              agg={aggDia}
            />
            <ZonaColumn title={semanaTitle} subtitle={semanaSubtitle} agg={aggSemana} />
            <ZonaColumn title="Mes" subtitle={rangoMes.label} agg={aggMes} />
            <ZonaColumn title="Campaña" subtitle={campana.label} agg={aggCampana} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
