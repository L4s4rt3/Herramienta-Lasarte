import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { KPICard } from "@/components/KPICard";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, History, BarChart3, Settings, Droplet, Zap, Fuel, FlaskConical } from "lucide-react";
import { today, formatNumber, formatDate } from "@/lib/format";
import {
  BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { MaquinaRow, SesionConsumoRow, ConsumoMaquinaRow } from "@/lib/types";

const ZONAS = [
  { value: "drencher", label: "Drencher" },
  { value: "linea_tratamiento", label: "Línea tratamiento" },
  { value: "planta_general", label: "Planta general" },
  { value: "compresor", label: "Compresor" },
];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function ConsumoCostes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("sesion");

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: maquinas = [], isLoading: loadingMaquinas } = useQuery({
    queryKey: ["maquinas"],
    queryFn: async () => {
      const { data } = await supabase.from("maquinas").select("*").order("nombre");
      return (data ?? []) as MaquinaRow[];
    },
  });

  const { data: sesiones = [], isLoading: loadingSesiones } = useQuery({
    queryKey: ["sesiones_consumo"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sesiones_consumo")
        .select("*")
        .order("fecha_inicio", { ascending: false });
      return (data ?? []) as SesionConsumoRow[];
    },
  });

  const { data: consumosMaquinas = [] } = useQuery({
    queryKey: ["consumo_maquinas"],
    queryFn: async () => {
      const { data } = await supabase.from("consumo_maquinas").select("*");
      return (data ?? []) as ConsumoMaquinaRow[];
    },
  });

  // ─── Formulario sesión ────────────────────────────────────────────────────
  const [fInicio, setFInicio] = useState(today());
  const [fFin, setFFin] = useState(today());
  const [fKg, setFKg] = useState("");
  const [fAguaLinea, setFAguaLinea] = useState("");
  const [fAguaDrencher, setFAguaDrencher] = useState("");
  const [fQuimicos, setFQuimicos] = useState("");
  const [fGasoil, setFGasoil] = useState("");
  const [fElectricidad, setFElectricidad] = useState("");
  const [fNotas, setFNotas] = useState("");
  const [fMaquinaKwh, setFMaquinaKwh] = useState<Record<string, string>>({});

  const sessionMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No auth");
      const kg = Number(fKg) || 0;
      if (kg <= 0) throw new Error("Kg procesados requerido");
      const { data, error } = await supabase.from("sesiones_consumo").insert({
        user_id: user.id,
        fecha_inicio: fInicio,
        fecha_fin: fFin,
        kg_procesados: kg,
        agua_linea_l: Number(fAguaLinea) || 0,
        agua_drencher_l: Number(fAguaDrencher) || 0,
        quimicos_drencher_l: Number(fQuimicos) || 0,
        gasoil_l: Number(fGasoil) || 0,
        electricidad_total_kwh: Number(fElectricidad) || 0,
        notas: fNotas || null,
      }).select("id").single();
      if (error) throw error;

      const cmRows = maquinas
        .filter((m) => (Number(fMaquinaKwh[m.id]) || 0) > 0)
        .map((m) => ({
          sesion_id: data.id,
          maquina_id: m.id,
          kwh: Number(fMaquinaKwh[m.id]) || 0,
        }));
      if (cmRows.length > 0) {
        const { error: cmErr } = await supabase.from("consumo_maquinas").insert(cmRows);
        if (cmErr) throw cmErr;
      }
    },
    onSuccess: () => {
      toast({ title: "Sesión guardada" });
      setFKg(""); setFAguaLinea(""); setFAguaDrencher("");
      setFQuimicos(""); setFGasoil(""); setFElectricidad(""); setFNotas("");
      setFMaquinaKwh({});
      qc.invalidateQueries({ queryKey: ["sesiones_consumo"] });
      qc.invalidateQueries({ queryKey: ["consumo_maquinas"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ─── Formulario máquina ───────────────────────────────────────────────────
  const [mNombre, setMNombre] = useState("");
  const [mZona, setMZona] = useState(ZONAS[0].value);

  const maquinaMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No auth");
      if (!mNombre.trim()) throw new Error("Nombre requerido");
      const { error } = await supabase.from("maquinas").insert({
        user_id: user.id, nombre: mNombre.trim(), zona: mZona,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Máquina añadida" });
      setMNombre("");
      qc.invalidateQueries({ queryKey: ["maquinas"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const delMaquinaMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("maquinas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Máquina eliminada" });
      qc.invalidateQueries({ queryKey: ["maquinas"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ─── Eliminar sesión ──────────────────────────────────────────────────────
  const delSesionMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sesiones_consumo").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Sesión eliminada" });
      qc.invalidateQueries({ queryKey: ["sesiones_consumo"] });
      qc.invalidateQueries({ queryKey: ["consumo_maquinas"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ─── Métricas calculadas ──────────────────────────────────────────────────
  const resultados = useMemo(() => {
    if (sesiones.length === 0) return null;
    const totalKg = sesiones.reduce((s, r) => s + (r.kg_procesados || 0), 0);
    if (totalKg === 0) return null;
    const totalAguaLinea = sesiones.reduce((s, r) => s + (r.agua_linea_l || 0), 0);
    const totalAguaDrencher = sesiones.reduce((s, r) => s + (r.agua_drencher_l || 0), 0);
    const totalQuimicos = sesiones.reduce((s, r) => s + (r.quimicos_drencher_l || 0), 0);
    const totalGasoil = sesiones.reduce((s, r) => s + (r.gasoil_l || 0), 0);
    const totalElectricidad = sesiones.reduce((s, r) => s + (r.electricidad_total_kwh || 0), 0);

    const cmKg: Record<string, number> = {};
    consumosMaquinas.forEach((cm) => {
      const ses = sesiones.find((s) => s.id === cm.sesion_id);
      if (ses) cmKg[cm.maquina_id] = (cmKg[cm.maquina_id] || 0) + (cm.kwh || 0);
    });

    return {
      totalKg,
      agua_linea_l_kg: totalAguaLinea / totalKg,
      agua_drencher_l_kg: totalAguaDrencher / totalKg,
      agua_total_l_kg: (totalAguaLinea + totalAguaDrencher) / totalKg,
      quimicos_ml_kg: (totalQuimicos * 1000) / totalKg,
      gasoil_ml_kg: (totalGasoil * 1000) / totalKg,
      electricidad_kwh_kg: totalElectricidad / totalKg,
      maquinas: maquinas.map((m) => ({
        ...m,
        totalKwh: cmKg[m.id] || 0,
        kwhKg: totalKg > 0 ? ((cmKg[m.id] || 0) / totalKg) : 0,
      })),
    };
  }, [sesiones, consumosMaquinas, maquinas]);

  // ─── Gráfico histórico ────────────────────────────────────────────────────
  const historicoChart = useMemo(() => {
    return [...sesiones].reverse().map((s) => {
      const kg = s.kg_procesados || 1;
      return {
        periodo: s.fecha_inicio.slice(5) + (s.fecha_fin !== s.fecha_inicio ? " — " + s.fecha_fin.slice(5) : ""),
        "Agua L/kg": ((s.agua_linea_l || 0) + (s.agua_drencher_l || 0)) / kg,
        "Electricidad kWh/kg": (s.electricidad_total_kwh || 0) / kg,
        "Gasoil mL/kg": ((s.gasoil_l || 0) * 1000) / kg,
        "Químicos mL/kg": ((s.quimicos_drencher_l || 0) * 1000) / kg,
      };
    });
  }, [sesiones]);

  // ─── Última sesión para KPIs ──────────────────────────────────────────────
  const ultimaSesion = sesiones.length > 0 ? sesiones[0] : null;
  const penultimaSesion = sesiones.length > 1 ? sesiones[1] : null;

  const kpisUltima = useMemo(() => {
    if (!ultimaSesion) return null;
    const kg = ultimaSesion.kg_procesados || 1;
    const aguaTotal = (ultimaSesion.agua_linea_l || 0) + (ultimaSesion.agua_drencher_l || 0);
    return {
      aguaTotal_l_kg: aguaTotal / kg,
      electricidad_kwh_kg: (ultimaSesion.electricidad_total_kwh || 0) / kg,
      gasoil_ml_kg: ((ultimaSesion.gasoil_l || 0) * 1000) / kg,
      quimicos_ml_kg: ((ultimaSesion.quimicos_drencher_l || 0) * 1000) / kg,
    };
  }, [ultimaSesion]);

  const kpisPenultima = useMemo(() => {
    if (!penultimaSesion) return null;
    const kg = penultimaSesion.kg_procesados || 1;
    const aguaTotal = (penultimaSesion.agua_linea_l || 0) + (penultimaSesion.agua_drencher_l || 0);
    return {
      aguaTotal_l_kg: aguaTotal / kg,
      electricidad_kwh_kg: (penultimaSesion.electricidad_total_kwh || 0) / kg,
      gasoil_ml_kg: ((penultimaSesion.gasoil_l || 0) * 1000) / kg,
      quimicos_ml_kg: ((penultimaSesion.quimicos_drencher_l || 0) * 1000) / kg,
    };
  }, [penultimaSesion]);

  const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);

  const loading = loadingMaquinas || loadingSesiones;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl">Consumos físicos</h1>
          <p className="text-sm text-muted-foreground">Agua · Electricidad · Gasoil · Químicos por kg de naranja</p>
        </div>
      </header>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="sesion"><Save className="h-4 w-4 mr-1.5" />Sesión</TabsTrigger>
            <TabsTrigger value="resultados"><BarChart3 className="h-4 w-4 mr-1.5" />Resultados</TabsTrigger>
            <TabsTrigger value="maquinas"><Settings className="h-4 w-4 mr-1.5" />Máquinas</TabsTrigger>
            <TabsTrigger value="historico"><History className="h-4 w-4 mr-1.5" />Histórico</TabsTrigger>
          </TabsList>

          {/* ════════ SESIÓN ════════ */}
          <TabsContent value="sesion" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Nueva sesión</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Fecha inicio</Label>
                  <Input type="date" value={fInicio} onChange={(e) => setFInicio(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Fecha fin</Label>
                  <Input type="date" value={fFin} onChange={(e) => setFFin(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Kg procesados *</Label>
                  <Input type="number" step="0.1" min="0" value={fKg} onChange={(e) => setFKg(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Droplet className="h-3.5 w-3.5 text-blue-500" /> Agua línea (L)</Label>
                  <Input type="number" step="0.1" min="0" value={fAguaLinea} onChange={(e) => setFAguaLinea(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Droplet className="h-3.5 w-3.5 text-blue-300" /> Agua drencher (L)</Label>
                  <Input type="number" step="0.1" min="0" value={fAguaDrencher} onChange={(e) => setFAguaDrencher(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><FlaskConical className="h-3.5 w-3.5 text-purple-500" /> Químicos drencher (L)</Label>
                  <Input type="number" step="0.01" min="0" value={fQuimicos} onChange={(e) => setFQuimicos(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Fuel className="h-3.5 w-3.5 text-orange-500" /> Gasoil (L)</Label>
                  <Input type="number" step="0.1" min="0" value={fGasoil} onChange={(e) => setFGasoil(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-yellow-500" /> Electricidad total (kWh)</Label>
                  <Input type="number" step="0.1" min="0" value={fElectricidad} onChange={(e) => setFElectricidad(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <Label>Notas</Label>
                  <Input value={fNotas} onChange={(e) => setFNotas(e.target.value)} placeholder="Opcional" />
                </div>
              </CardContent>
            </Card>

            {/* kWh por máquina */}
            {maquinas.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">Consumo por máquina (kWh)</CardTitle></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {maquinas.map((m) => (
                    <div key={m.id} className="space-y-1.5">
                      <Label className="text-sm">{m.nombre} <span className="text-muted-foreground text-xs">({ZONAS.find((z) => z.value === m.zona)?.label})</span></Label>
                      <Input type="number" step="0.1" min="0"
                        value={fMaquinaKwh[m.id] ?? ""}
                        onChange={(e) => setFMaquinaKwh((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        placeholder="kWh" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Button onClick={() => sessionMut.mutate()} disabled={sessionMut.isPending || !fKg} className="w-full md:w-auto">
              <Save className="h-4 w-4 mr-2" /> Guardar sesión
            </Button>
          </TabsContent>

          {/* ════════ RESULTADOS ════════ */}
          <TabsContent value="resultados" className="space-y-4">
            {!resultados || sesiones.length === 0 ? (
              <Card><CardContent className="p-12 text-center text-muted-foreground">Aún no hay sesiones registradas.</CardContent></Card>
            ) : (
              <>
                {/* KPIs última sesión */}
                {kpisUltima && (
                  <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <KPICard label="Agua total" value={`${formatNumber(kpisUltima.aguaTotal_l_kg, 2)} L/kg`}
                      hint={kpisPenultima ? `${pct(kpisUltima.aguaTotal_l_kg, kpisPenultima.aguaTotal_l_kg) > 0 ? "+" : ""}${pct(kpisUltima.aguaTotal_l_kg, kpisPenultima.aguaTotal_l_kg).toFixed(1)}% vs anterior` : "—"}
                      trend={kpisPenultima ? (kpisUltima.aguaTotal_l_kg > kpisPenultima.aguaTotal_l_kg ? "up" : "down") : "neutral"}
                      icon={Droplet} />
                    <KPICard label="Electricidad" value={`${formatNumber(kpisUltima.electricidad_kwh_kg, 3)} kWh/kg`}
                      hint={kpisPenultima ? `${pct(kpisUltima.electricidad_kwh_kg, kpisPenultima.electricidad_kwh_kg) > 0 ? "+" : ""}${pct(kpisUltima.electricidad_kwh_kg, kpisPenultima.electricidad_kwh_kg).toFixed(1)}% vs anterior` : "—"}
                      trend={kpisPenultima ? (kpisUltima.electricidad_kwh_kg > kpisPenultima.electricidad_kwh_kg ? "up" : "down") : "neutral"}
                      icon={Zap} />
                    <KPICard label="Gasoil" value={`${formatNumber(kpisUltima.gasoil_ml_kg, 1)} mL/kg`}
                      hint={kpisPenultima ? `${pct(kpisUltima.gasoil_ml_kg, kpisPenultima.gasoil_ml_kg) > 0 ? "+" : ""}${pct(kpisUltima.gasoil_ml_kg, kpisPenultima.gasoil_ml_kg).toFixed(1)}% vs anterior` : "—"}
                      trend={kpisPenultima ? (kpisUltima.gasoil_ml_kg > kpisPenultima.gasoil_ml_kg ? "up" : "down") : "neutral"}
                      icon={Fuel} />
                    <KPICard label="Químicos" value={`${formatNumber(kpisUltima.quimicos_ml_kg, 1)} mL/kg`}
                      hint={kpisPenultima ? `${pct(kpisUltima.quimicos_ml_kg, kpisPenultima.quimicos_ml_kg) > 0 ? "+" : ""}${pct(kpisUltima.quimicos_ml_kg, kpisPenultima.quimicos_ml_kg).toFixed(1)}% vs anterior` : "—"}
                      trend={kpisPenultima ? (kpisUltima.quimicos_ml_kg > kpisPenultima.quimicos_ml_kg ? "up" : "down") : "neutral"}
                      icon={FlaskConical} />
                  </section>
                )}

                {/* Métricas acumuladas */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Resumen acumulado ({sesiones.length} sesiones, {formatNumber(resultados.totalKg)} kg totales)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="rounded-lg border p-4 bg-blue-50/50">
                        <p className="text-xs font-medium text-blue-700 uppercase tracking-wider">Agua total</p>
                        <p className="text-2xl font-bold text-blue-800">{formatNumber(resultados.agua_total_l_kg, 2)} L/kg</p>
                        <p className="text-xs text-blue-600 mt-1">Línea: {formatNumber(resultados.agua_linea_l_kg, 2)} · Drencher: {formatNumber(resultados.agua_drencher_l_kg, 2)} L/kg</p>
                      </div>
                      <div className="rounded-lg border p-4 bg-yellow-50/50">
                        <p className="text-xs font-medium text-yellow-700 uppercase tracking-wider">Electricidad</p>
                        <p className="text-2xl font-bold text-yellow-800">{formatNumber(resultados.electricidad_kwh_kg, 3)} kWh/kg</p>
                        <p className="text-xs text-yellow-600 mt-1">{formatNumber(resultados.totalKg > 0 ? (resultados.totalKg / (sesiones.reduce((s, r) => s + (r.electricidad_total_kwh || 0), 0) || 1)) : 0, 1)} kg/kWh</p>
                      </div>
                      <div className="rounded-lg border p-4 bg-orange-50/50">
                        <p className="text-xs font-medium text-orange-700 uppercase tracking-wider">Gasoil</p>
                        <p className="text-2xl font-bold text-orange-800">{formatNumber(resultados.gasoil_ml_kg, 1)} mL/kg</p>
                      </div>
                      <div className="rounded-lg border p-4 bg-purple-50/50">
                        <p className="text-xs font-medium text-purple-700 uppercase tracking-wider">Químicos drencher</p>
                        <p className="text-2xl font-bold text-purple-800">{formatNumber(resultados.quimicos_ml_kg, 1)} mL/kg</p>
                      </div>
                      <div className="rounded-lg border p-4 bg-green-50/50">
                        <p className="text-xs font-medium text-green-700 uppercase tracking-wider">Agua línea</p>
                        <p className="text-2xl font-bold text-green-800">{formatNumber(resultados.agua_linea_l_kg, 2)} L/kg</p>
                      </div>
                      <div className="rounded-lg border p-4 bg-cyan-50/50">
                        <p className="text-xs font-medium text-cyan-700 uppercase tracking-wider">Agua drencher</p>
                        <p className="text-2xl font-bold text-cyan-800">{formatNumber(resultados.agua_drencher_l_kg, 2)} L/kg</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Desglose por máquina */}
                {resultados.maquinas.some((m) => m.totalKwh > 0) && (
                  <Card>
                    <CardHeader><CardTitle className="text-lg">Desglose por máquina</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Máquina</TableHead>
                            <TableHead>Zona</TableHead>
                            <TableHead className="text-right">kWh total</TableHead>
                            <TableHead className="text-right">kWh/kg</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {resultados.maquinas.filter((m) => m.totalKwh > 0).map((m) => (
                            <TableRow key={m.id}>
                              <TableCell className="font-medium">{m.nombre}</TableCell>
                              <TableCell>{ZONAS.find((z) => z.value === m.zona)?.label}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(m.totalKwh, 1)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(m.kwhKg, 4)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {/* Gráfico comparativo histórico */}
                {historicoChart.length > 1 && (
                  <Card>
                    <CardHeader><CardTitle className="text-lg">Evolución por sesión</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={historicoChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="periodo" fontSize={10} />
                          <YAxis fontSize={11} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="Agua L/kg" fill="#3b82f6" />
                          <Bar dataKey="Electricidad kWh/kg" fill="#eab308" />
                          <Bar dataKey="Gasoil mL/kg" fill="#f97316" />
                          <Bar dataKey="Químicos mL/kg" fill="#a855f7" />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ════════ MÁQUINAS ════════ */}
          <TabsContent value="maquinas" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Añadir máquina</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1.5 flex-1 min-w-[200px]">
                  <Label>Nombre</Label>
                  <Input value={mNombre} onChange={(e) => setMNombre(e.target.value)} placeholder="Ej: Cinta principal" />
                </div>
                <div className="space-y-1.5 w-48">
                  <Label>Zona</Label>
                  <Select value={mZona} onValueChange={setMZona}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ZONAS.map((z) => (
                        <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => maquinaMut.mutate()} disabled={maquinaMut.isPending || !mNombre.trim()}>
                  <Plus className="h-4 w-4 mr-2" /> Añadir
                </Button>
              </CardContent>
            </Card>

            {maquinas.length === 0 ? (
              <Card><CardContent className="p-12 text-center text-muted-foreground">No hay máquinas registradas. Añade la primera cuando el experto os dé los datos.</CardContent></Card>
            ) : (
              <Card>
                <CardHeader><CardTitle className="text-lg">Máquinas ({maquinas.length})</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Zona</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {maquinas.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">{m.nombre}</TableCell>
                          <TableCell>{ZONAS.find((z) => z.value === m.zona)?.label}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" onClick={() => delMaquinaMut.mutate(m.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ════════ HISTÓRICO ════════ */}
          <TabsContent value="historico" className="space-y-4">
            {sesiones.length === 0 ? (
              <Card><CardContent className="p-12 text-center text-muted-foreground">No hay sesiones registradas.</CardContent></Card>
            ) : (
              <>
                {/* Tabla de sesiones */}
                <Card>
                  <CardHeader><CardTitle className="text-lg">Sesiones anteriores</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Período</TableHead>
                          <TableHead className="text-right">Kg</TableHead>
                          <TableHead className="text-right">Agua L/kg</TableHead>
                          <TableHead className="text-right">kWh/kg</TableHead>
                          <TableHead className="text-right">Gasoil mL/kg</TableHead>
                          <TableHead className="text-right">Químicos mL/kg</TableHead>
                          <TableHead>Notas</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sesiones.map((s) => {
                          const kg = s.kg_procesados || 1;
                          const aguaTotal = (s.agua_linea_l || 0) + (s.agua_drencher_l || 0);
                          return (
                            <TableRow key={s.id}>
                              <TableCell className="whitespace-nowrap text-xs">
                                {s.fecha_inicio === s.fecha_fin
                                  ? formatDate(s.fecha_inicio)
                                  : `${formatDate(s.fecha_inicio)} — ${formatDate(s.fecha_fin)}`}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(kg, 0)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(aguaTotal / kg, 2)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber((s.electricidad_total_kwh || 0) / kg, 3)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(((s.gasoil_l || 0) * 1000) / kg, 1)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(((s.quimicos_drencher_l || 0) * 1000) / kg, 1)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{s.notas}</TableCell>
                              <TableCell className="text-right">
                                <Button variant="ghost" size="icon" onClick={() => delSesionMut.mutate(s.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Evolución histórica */}
                {historicoChart.length > 1 && (
                  <Card>
                    <CardHeader><CardTitle className="text-lg">Evolución de ratios</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={historicoChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="periodo" fontSize={10} />
                          <YAxis fontSize={11} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Line type="monotone" dataKey="Agua L/kg" stroke="#3b82f6" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="Electricidad kWh/kg" stroke="#eab308" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
