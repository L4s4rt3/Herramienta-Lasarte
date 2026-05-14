/**
 * AnalisisDiarioSummary.tsx — Panel resumen del análisis diario para Dashboard
 *
 * Muestra:
 * - KPIs de producción, palets, productos
 * - Top proveedores, productos, clientes
 * - Se actualiza en tiempo real
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, Package, Users, RefreshCw } from "lucide-react";
import { useAnalisisDiario } from "@/hooks/useAnalisisDiario";
import { supabase } from "@/integrations/supabase/client";
import { formatKg } from "@/lib/format";

interface Props {
  days?: number; // Últimos N días (default 30)
}

export function AnalisisDiarioSummary({ days = 30 }: Props) {
  const [desde] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  });

  const [hasta] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, loading, refetch } = useAnalisisDiario(desde, hasta);

  // Suscribirse a cambios en partes_diarios
  useEffect(() => {
    const channel = supabase
      .channel("partes-todos")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "partes_diarios",
          filter: `date=gte.${desde}`,
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [desde, refetch]);

  const hayDatos = data.totals.n_lotes > 0 || data.totals.n_palets > 0;

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
            label="Días"
            value={data.totals.n_dias}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <KpiCard
            label="Proveedores"
            value={data.totals.n_proveedores}
            sub={formatKg(data.totals.kg_lotes)}
            icon={<Users className="h-4 w-4" />}
          />
          <KpiCard
            label="Lotes"
            value={data.totals.n_lotes}
            icon={<Package className="h-4 w-4" />}
          />
          <KpiCard
            label="Palets"
            value={data.totals.n_palets}
            sub={formatKg(data.totals.kg_palets)}
            icon={<Package className="h-4 w-4" />}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Proveedores */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Proveedores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : data.proveedores.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin datos</p>
            ) : (
              data.proveedores.slice(0, 5).map((p) => (
                <div key={p.productor} className="flex items-center justify-between text-sm">
                  <div className="truncate">
                    <p className="font-medium text-xs">{p.productor}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {p.n_lotes} lote{p.n_lotes !== 1 ? "s" : ""} · T/h: {p.tph_avg?.toFixed(1) ?? "—"}
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

        {/* Top Productos */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Productos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : data.productos.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin datos</p>
            ) : (
              data.productos.slice(0, 5).map((p) => (
                <div key={p.producto} className="flex items-center justify-between text-sm gap-2">
                  <div className="truncate min-w-0">
                    <p className="font-medium text-xs truncate">{p.producto}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {p.grupo_destino && (
                        <Badge variant="secondary" className="text-[10px]">
                          {p.grupo_destino}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-right shrink-0">
                    {formatKg(p.kg_total)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Top Clientes */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Clientes</CardTitle>
            <CardDescription className="text-xs">
              {data.totals.n_clientes} cliente{data.totals.n_clientes !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : data.clientes.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin datos</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {data.clientes.slice(0, 6).map((c) => (
                  <div key={c.cliente} className="rounded-lg border border-border/40 p-2">
                    <p className="font-medium text-xs truncate">{c.cliente}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-muted-foreground">
                        {c.n_palets} palets
                      </span>
                      <span className="text-[10px] font-mono text-foreground">
                        {formatKg(c.kg_total)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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
