/**
 * AnalisisDiarioSummary.tsx — Panel resumen del análisis diario.
 *
 * Nota: actualmente no se monta en ninguna página (el Dashboard usa sus propios
 * paneles), pero se mantiene alineado con useAnalisisDiario por si se recupera.
 *
 * Muestra KPIs de producción y el top de productores del periodo, con
 * actualización en tiempo real al cambiar partes_diarios.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, Package, Users, RefreshCw, Gauge } from "lucide-react";
import { useAnalisisDiario } from "@/hooks/useAnalisisDiario";
import { supabase } from "@/integrations/supabase/client";
import { formatKg, formatNumber, today, toISODateLocal } from "@/lib/format";

interface Props {
  days?: number; // Últimos N días (default 30)
}

export function AnalisisDiarioSummary({ days = 30 }: Props) {
  const [desde] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return toISODateLocal(d);
  });

  const [hasta] = useState(() => today());

  const { data, loading, refetch } = useAnalisisDiario(desde, hasta);

  // Suscribirse a cambios en partes_diarios
  useEffect(() => {
    const channel = supabase
      .channel("partes-todos")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "partes_diarios",
          filter: `date=gte.${desde}`,
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [desde, refetch]);

  const hayDatos = data.totals.n_lotes > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Análisis Diario (últimos {days} días)</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* KPIs */}
      {!loading && hayDatos && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <KpiCard
            label="Días con datos"
            value={data.totals.n_dias}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <KpiCard
            label="Productores"
            value={data.productores.length}
            sub={formatKg(data.totals.kg_lotes)}
            icon={<Users className="h-4 w-4" />}
          />
          <KpiCard
            label="Lotes"
            value={data.totals.n_lotes}
            icon={<Package className="h-4 w-4" />}
          />
          <KpiCard
            label="T/h media"
            value={data.totals.avg_tph != null ? formatNumber(data.totals.avg_tph, 1) : "—"}
            sub={formatKg(data.totals.kg_produccion_real)}
            icon={<Gauge className="h-4 w-4" />}
          />
        </div>
      )}

      {/* Top Productores */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Top Productores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : data.productores.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin datos</p>
          ) : (
            data.productores.slice(0, 5).map((p) => (
              <div key={p.productor} className="flex items-center justify-between text-sm">
                <div className="truncate">
                  <p className="font-medium text-xs">{p.productor}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {p.n_lotes} lote{p.n_lotes !== 1 ? "s" : ""} · T/h: {p.tph_promedio?.toFixed(1) ?? "—"}
                  </p>
                </div>
                <span className="text-xs font-mono text-right shrink-0 ml-2">
                  {formatKg(p.kg_total)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 py-3 px-3">
        {icon && <div className="text-primary shrink-0">{icon}</div>}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold tabular-nums">{value}</p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            {label}
            {sub && ` · ${sub}`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
