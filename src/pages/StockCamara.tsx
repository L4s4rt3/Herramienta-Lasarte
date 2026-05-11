/**
 * M4 — Stock en cámara en tiempo real
 * Lee la tabla palets_dia (columna situacion) y muestra el stock S=cámara vs F=facturado.
 * También permite ver por producto, cliente y día.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { KPICard } from "@/components/KPICard";
import { formatKg, formatNumber, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Warehouse, Package, TruckIcon, AlertTriangle, Search } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { toast } from "@/hooks/use-toast";

interface PaletDia {
  id: string;
  part_id: string;
  palet_id: string | null;
  producto: string | null;
  cliente: string | null;
  destino: string | null;
  kg_neto: number;
  situacion: string | null;
  n_cajas: number | null;
  created_at: string;
  // joined
  parte_date?: string;
}

function SitBadge({ sit }: { sit: string | null }) {
  if (sit === "S")
    return (
      <Badge className="bg-warning/15 text-warning border-warning/30 border text-[10px] font-semibold">
        Cámara
      </Badge>
    );
  if (sit === "F")
    return (
      <Badge className="bg-success/15 text-success border-success/30 border text-[10px] font-semibold">
        Facturado
      </Badge>
    );
  return (
    <Badge variant="secondary" className="text-[10px]">
      Ficticio
    </Badge>
  );
}

export default function StockCamara() {
  const [palets, setPalets] = useState<PaletDia[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [since, setSince] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });

  async function load() {
    setLoading(true);
    // palets_dia joined with partes_diarios for the date
    const { data, error } = await (supabase as any)
      .from("palets_dia")
      .select("*, partes_diarios(date)")
      .gte("created_at", since + "T00:00:00")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error cargando stock", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows: PaletDia[] = (data ?? []).map((r: any) => ({
      ...r,
      parte_date: r.partes_diarios?.date ?? null,
    }));
    setPalets(rows);
    setLoading(false);
  }

  useEffect(() => { load(); }, [since]);

  const filtered = useMemo(() => {
    if (!search) return palets;
    const q = search.toLowerCase();
    return palets.filter(
      (p) =>
        p.producto?.toLowerCase().includes(q) ||
        p.cliente?.toLowerCase().includes(q) ||
        p.palet_id?.toLowerCase().includes(q) ||
        p.destino?.toLowerCase().includes(q)
    );
  }, [palets, search]);

  // KPIs
  const kg_camara = filtered
    .filter((p) => p.situacion === "S")
    .reduce((s, p) => s + (p.kg_neto ?? 0), 0);
  const kg_facturado = filtered
    .filter((p) => p.situacion === "F")
    .reduce((s, p) => s + (p.kg_neto ?? 0), 0);
  const kg_ficticio = filtered
    .filter((p) => p.situacion === null || (p.situacion !== "S" && p.situacion !== "F"))
    .reduce((s, p) => s + (p.kg_neto ?? 0), 0);
  const n_palets_camara = filtered.filter((p) => p.situacion === "S").length;

  // Agrupación por producto (solo los en cámara)
  const porProducto = useMemo(() => {
    const map: Record<string, { kg: number; cajas: number; palets: number }> = {};
    filtered
      .filter((p) => p.situacion === "S")
      .forEach((p) => {
        const key = p.producto ?? "Sin producto";
        if (!map[key]) map[key] = { kg: 0, cajas: 0, palets: 0 };
        map[key].kg += p.kg_neto ?? 0;
        map[key].cajas += p.n_cajas ?? 0;
        map[key].palets += 1;
      });
    return Object.entries(map)
      .map(([producto, v]) => ({ producto, ...v }))
      .sort((a, b) => b.kg - a.kg);
  }, [filtered]);

  // Agrupación por cliente
  const porCliente = useMemo(() => {
    const map: Record<string, number> = {};
    filtered
      .filter((p) => p.situacion === "S" && p.cliente)
      .forEach((p) => {
        const key = p.cliente!;
        map[key] = (map[key] ?? 0) + (p.kg_neto ?? 0);
      });
    return Object.entries(map)
      .map(([cliente, kg]) => ({ cliente, kg }))
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 8);
  }, [filtered]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-muted-foreground" />
            Stock en cámara
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Palets en cámara (Sit=S) y facturados (Sit=F) — fuente: informe palets importado
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground">Desde</label>
          <Input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="w-36 h-9"
          />
        </div>
      </header>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KPICard
              label="En cámara (kg)"
              value={formatKg(kg_camara)}
              hint={`${n_palets_camara} palets`}
              icon={Warehouse}
              trend="neutral"
            />
            <KPICard
              label="Facturado (kg)"
              value={formatKg(kg_facturado)}
              icon={TruckIcon}
              trend="up"
            />
            <KPICard
              label="Ficticio / industria (kg)"
              value={formatKg(kg_ficticio)}
              icon={Package}
              trend="neutral"
            />
            <KPICard
              label="Productos en cámara"
              value={String(porProducto.length)}
              hint="referencias distintas"
              icon={AlertTriangle}
            />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Stock por producto */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock en cámara por producto</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-52" />
            ) : porProducto.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Sin datos. Importa un informe de palets para ver el stock.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={porProducto.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis
                    type="number"
                    fontSize={10}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(1)}t`}
                  />
                  <YAxis
                    dataKey="producto"
                    type="category"
                    width={130}
                    fontSize={9}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }}
                    formatter={(v: number) => [formatKg(v), "kg"]}
                  />
                  <Bar dataKey="kg" fill="hsl(var(--warning) / 0.7)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Stock por cliente */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock asignado por cliente</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-52" />
            ) : porCliente.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Sin clientes asignados en los datos importados.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={porCliente} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis
                    type="number"
                    fontSize={10}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(1)}t`}
                  />
                  <YAxis
                    dataKey="cliente"
                    type="category"
                    width={130}
                    fontSize={9}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }}
                    formatter={(v: number) => [formatKg(v), "kg"]}
                  />
                  <Bar dataKey="kg" fill="hsl(var(--primary) / 0.7)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabla de palets */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Palets detalle</CardTitle>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Producto, cliente…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-44 h-8"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Sin palets. Importa un informe de palets desde el parte diario.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Palet</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Kg neto</TableHead>
                    <TableHead className="text-right">Cajas</TableHead>
                    <TableHead>Situación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 200).map((p) => (
                    <TableRow
                      key={p.id}
                      className={cn(
                        p.situacion === "S" && "bg-warning/[0.03]",
                        p.situacion === "F" && "bg-success/[0.03]"
                      )}
                    >
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {p.parte_date ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{p.palet_id ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[180px] truncate" title={p.producto ?? ""}>
                        {p.producto ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate" title={p.cliente ?? ""}>
                        {p.cliente ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {formatKg(p.kg_neto)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {p.n_cajas ?? "—"}
                      </TableCell>
                      <TableCell>
                        <SitBadge sit={p.situacion} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length > 200 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Mostrando 200 de {filtered.length} registros. Usa el buscador para filtrar.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
