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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KPICard } from "@/components/KPICard";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useConsumosFisicos } from "@/hooks/useConsumosFisicos";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, History, BarChart3, Settings, Droplet, Zap, Fuel, FlaskConical, Download, FileText, FileSpreadsheet, CalendarDays } from "lucide-react";
import { today, formatNumber, formatDate } from "@/lib/format";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  GlassTooltip, legendStyle, C, GRID, XAXIS, YAXIS, MARGIN,
  BAR_STYLE, CHART_CURSOR, CHART_LINE_CURSOR, CHART_PANEL_CLASS, barFill, lineStyle,
} from "@/lib/chartTheme";
import { MaquinaRow, SesionConsumoRow, ConsumoMaquinaRow } from "@/lib/types";
import { exportConsumoToExcel, exportConsumoToPDF } from "@/lib/exportConsumo";

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

function ConsumoDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="glass glass-hover h-10 w-full justify-start gap-2 rounded-xl border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] px-3 font-semibold"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-primary/75" />
          <span className="tabular-nums">
            {selected ? format(selected, "dd MMM yyyy", { locale: es }) : "Seleccionar..."}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 glass-accented" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) onChange(format(date, "yyyy-MM-dd"));
          }}
          locale={es}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export default function ConsumoCostes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("sesion");
  const { isLoading: loadingConsumosFisicos } = useConsumosFisicos();

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

  // ─── Calcular kg desde partes ──────────────────────────────────────────────
  const [calculandoKg, setCalculandoKg] = useState(false);

  const calcularKgDesdePartes = async () => {
    setCalculandoKg(true);
    try {
      const { data, error } = await supabase
        .from("partes_diarios")
        .select("kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
        .gte("date", fInicio)
        .lte("date", fFin);
      if (error) throw error;
      const total = (data ?? []).reduce((s, r) =>
        s + (r.kg_produccion_calibrador || 0)
          - (r.kg_mujeres_calibrador || 0)
          - (r.kg_reciclado_malla_z1 || 0)
          - (r.kg_reciclado_malla_z2 || 0)
      , 0);
      setFKg(String(total));
      toast({ title: "Kg calculados", description: `${total.toFixed(0)} kg en ${data?.length ?? 0} partes` });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setCalculandoKg(false);
    }
  };

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

  const loading = loadingMaquinas || loadingSesiones || loadingConsumosFisicos;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1 className="page-title">Consumos físicos</h1>
          <p className="page-subtitle">Agua · Electricidad · Gasoil · Químicos por kg de naranja</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={sesiones.length === 0} onClick={() => exportConsumoToExcel({ sesiones, maquinas, consumosMaquinas })} className="glass glass-hover">
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
          </Button>
          <Button variant="outline" size="sm" disabled={sesiones.length === 0} onClick={() => exportConsumoToPDF({ sesiones, maquinas, consumosMaquinas })} className="glass glass-hover">
            <FileText className="h-4 w-4 mr-1.5" /> PDF
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <div className="glass-accented p-1.5 rounded-xl">
          <TabsList className="grid w-full grid-cols-2 md:w-auto md:grid-cols-4">
            <TabsTrigger value="sesion"><Save className="h-4 w-4 mr-1.5" />Sesión</TabsTrigger>
            <TabsTrigger value="resultados"><BarChart3 className="h-4 w-4 mr-1.5" />Resultados</TabsTrigger>
            <TabsTrigger value="maquinas"><Settings className="h-4 w-4 mr-1.5" />Máquinas</TabsTrigger>
            <TabsTrigger value="historico"><History className="h-4 w-4 mr-1.5" />Histórico</TabsTrigger>
          </TabsList>
          </div>

          {/* ════════ SESIÓN ════════ */}
          <TabsContent value="sesion" className="space-y-4">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Registro</p>
                <CardTitle>Nueva sesión</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-3">
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha inicio</Label>
                  <ConsumoDatePicker value={fInicio} onChange={setFInicio} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha fin</Label>
                  <ConsumoDatePicker value={fFin} onChange={setFFin} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kg procesados *</Label>
                  <div className="flex gap-2">
                    <Input type="number" step="0.1" min="0" value={fKg} onChange={(e) => setFKg(e.target.value)} placeholder="0" className="flex-1" />
                    <Button type="button" variant="outline" size="sm" onClick={calcularKgDesdePartes} disabled={calculandoKg} className="glass glass-hover shrink-0">
                      {calculandoKg ? "..." : "Desde partes"}
                    </Button>
                  </div>
                </div>
                <div className="glass p-4 space-y-2 relative overflow-hidden">
                  <div className="absolute inset-x-3 top-0 h-px bg-info/30" />
                  <Label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-info"><Droplet className="h-3.5 w-3.5" /> Agua línea (L)</Label>
                  <Input type="number" step="0.1" min="0" value={fAguaLinea} onChange={(e) => setFAguaLinea(e.target.value)} placeholder="0" />
                </div>
                <div className="glass p-4 space-y-2 relative overflow-hidden">
                  <div className="absolute inset-x-3 top-0 h-px bg-info/25" />
                  <Label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-info"><Droplet className="h-3.5 w-3.5" /> Agua drencher (L)</Label>
                  <Input type="number" step="0.1" min="0" value={fAguaDrencher} onChange={(e) => setFAguaDrencher(e.target.value)} placeholder="0" />
                </div>
                <div className="glass p-4 space-y-2 relative overflow-hidden">
                  <div className="absolute inset-x-3 top-0 h-px bg-info/30" />
                  <Label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-info"><FlaskConical className="h-3.5 w-3.5" /> Químicos drencher (L)</Label>
                  <Input type="number" step="0.01" min="0" value={fQuimicos} onChange={(e) => setFQuimicos(e.target.value)} placeholder="0" />
                </div>
                <div className="glass p-4 space-y-2 relative overflow-hidden">
                  <div className="absolute inset-x-3 top-0 h-px bg-primary/30" />
                  <Label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-warning"><Fuel className="h-3.5 w-3.5" /> Gasoil (L)</Label>
                  <Input type="number" step="0.1" min="0" value={fGasoil} onChange={(e) => setFGasoil(e.target.value)} placeholder="0" />
                </div>
                <div className="glass p-4 space-y-2 relative overflow-hidden">
                  <div className="absolute inset-x-3 top-0 h-px bg-warning/30" />
                  <Label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-warning"><Zap className="h-3.5 w-3.5" /> Electricidad total (kWh)</Label>
                  <Input type="number" step="0.1" min="0" value={fElectricidad} onChange={(e) => setFElectricidad(e.target.value)} placeholder="0" />
                </div>
                <div className="glass p-4 space-y-2 md:col-span-3">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notas</Label>
                  <Input value={fNotas} onChange={(e) => setFNotas(e.target.value)} placeholder="Opcional" />
                </div>
              </CardContent>
            </Card>

            {/* kWh por máquina */}
            {maquinas.length > 0 && (
              <Card className="glass-accented">
                <CardHeader>
                  <p className="panel-kicker">Detalle energético</p>
                  <CardTitle>Consumo por máquina (kWh)</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {maquinas.map((m) => (
                    <div key={m.id} className="glass p-4 space-y-2">
                      <Label className="text-sm font-semibold">{m.nombre} <span className="text-muted-foreground font-normal text-xs">({ZONAS.find((z) => z.value === m.zona)?.label})</span></Label>
                      <Input type="number" step="0.1" min="0"
                        value={fMaquinaKwh[m.id] ?? ""}
                        onChange={(e) => setFMaquinaKwh((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        placeholder="kWh" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end">
              <Button onClick={() => sessionMut.mutate()} disabled={sessionMut.isPending || !fKg} className="glass glass-hover px-8">
                <Save className="h-4 w-4 mr-2" /> Guardar sesión
              </Button>
            </div>
          </TabsContent>

          {/* ════════ RESULTADOS ════════ */}
          <TabsContent value="resultados" className="space-y-6">
            {!resultados || sesiones.length === 0 ? (
              <Card className="glass-accented"><CardContent className="p-12 text-center text-muted-foreground">Aún no hay sesiones registradas.</CardContent></Card>
            ) : (
              <>
                {/* KPIs última sesión */}
                {kpisUltima && (
                  <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <KPICard label="Agua total" value={`${formatNumber(kpisUltima.aguaTotal_l_kg, 2)} L/kg`}
                      hint={kpisPenultima ? `${pct(kpisUltima.aguaTotal_l_kg, kpisPenultima.aguaTotal_l_kg) > 0 ? "+" : ""}${pct(kpisUltima.aguaTotal_l_kg, kpisPenultima.aguaTotal_l_kg).toFixed(1)}% vs anterior` : "—"}
                      trend={kpisPenultima ? (kpisUltima.aguaTotal_l_kg > kpisPenultima.aguaTotal_l_kg ? "up" : "down") : "neutral"}
                      icon={Droplet} className="glass-accented" />
                    <KPICard label="Electricidad" value={`${formatNumber(kpisUltima.electricidad_kwh_kg, 3)} kWh/kg`}
                      hint={kpisPenultima ? `${pct(kpisUltima.electricidad_kwh_kg, kpisPenultima.electricidad_kwh_kg) > 0 ? "+" : ""}${pct(kpisUltima.electricidad_kwh_kg, kpisPenultima.electricidad_kwh_kg).toFixed(1)}% vs anterior` : "—"}
                      trend={kpisPenultima ? (kpisUltima.electricidad_kwh_kg > kpisPenultima.electricidad_kwh_kg ? "up" : "down") : "neutral"}
                      icon={Zap} className="glass-accented" />
                    <KPICard label="Gasoil" value={`${formatNumber(kpisUltima.gasoil_ml_kg, 1)} mL/kg`}
                      hint={kpisPenultima ? `${pct(kpisUltima.gasoil_ml_kg, kpisPenultima.gasoil_ml_kg) > 0 ? "+" : ""}${pct(kpisUltima.gasoil_ml_kg, kpisPenultima.gasoil_ml_kg).toFixed(1)}% vs anterior` : "—"}
                      trend={kpisPenultima ? (kpisUltima.gasoil_ml_kg > kpisPenultima.gasoil_ml_kg ? "up" : "down") : "neutral"}
                      icon={Fuel} className="glass-accented" />
                    <KPICard label="Químicos" value={`${formatNumber(kpisUltima.quimicos_ml_kg, 1)} mL/kg`}
                      hint={kpisPenultima ? `${pct(kpisUltima.quimicos_ml_kg, kpisPenultima.quimicos_ml_kg) > 0 ? "+" : ""}${pct(kpisUltima.quimicos_ml_kg, kpisPenultima.quimicos_ml_kg).toFixed(1)}% vs anterior` : "—"}
                      trend={kpisPenultima ? (kpisUltima.quimicos_ml_kg > kpisPenultima.quimicos_ml_kg ? "up" : "down") : "neutral"}
                      icon={FlaskConical} className="glass-accented" />
                  </section>
                )}

                {/* Métricas acumuladas */}
                <Card className="glass-accented">
                  <CardHeader>
                    <p className="panel-kicker">Acumulado</p>
                    <CardTitle>Resumen ({sesiones.length} sesiones, {formatNumber(resultados.totalKg)} kg)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-info/40 rounded-full" />
                        <p className="text-xs font-semibold text-info uppercase tracking-wider">Agua total</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(resultados.agua_total_l_kg, 2)} <span className="text-sm font-normal text-muted-foreground">L/kg</span></p>
                        <p className="mt-2 text-xs text-muted-foreground">Línea: {formatNumber(resultados.agua_linea_l_kg, 2)} · Drencher: {formatNumber(resultados.agua_drencher_l_kg, 2)} L/kg</p>
                      </div>
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-warning/40 rounded-full" />
                        <p className="text-xs font-semibold text-warning uppercase tracking-wider">Electricidad</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(resultados.electricidad_kwh_kg, 3)} <span className="text-sm font-normal text-muted-foreground">kWh/kg</span></p>
                        <p className="mt-2 text-xs text-muted-foreground">{formatNumber(resultados.totalKg > 0 ? (resultados.totalKg / (sesiones.reduce((s, r) => s + (r.electricidad_total_kwh || 0), 0) || 1)) : 0, 1)} kg/kWh</p>
                      </div>
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-primary/40 rounded-full" />
                        <p className="text-xs font-semibold text-warning uppercase tracking-wider">Gasoil</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(resultados.gasoil_ml_kg, 1)} <span className="text-sm font-normal text-muted-foreground">mL/kg</span></p>
                      </div>
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-info/40 rounded-full" />
                        <p className="text-xs font-semibold text-info uppercase tracking-wider">Químicos drencher</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(resultados.quimicos_ml_kg, 1)} <span className="text-sm font-normal text-muted-foreground">mL/kg</span></p>
                      </div>
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-success/40 rounded-full" />
                        <p className="text-xs font-semibold text-success uppercase tracking-wider">Agua línea</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(resultados.agua_linea_l_kg, 2)} <span className="text-sm font-normal text-muted-foreground">L/kg</span></p>
                      </div>
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-info/40 rounded-full" />
                        <p className="text-xs font-semibold text-info uppercase tracking-wider">Agua drencher</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(resultados.agua_drencher_l_kg, 2)} <span className="text-sm font-normal text-muted-foreground">L/kg</span></p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Desglose por máquina */}
                {resultados.maquinas.some((m) => m.totalKwh > 0) && (
                  <Card className="glass-accented">
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
                  <Card className="glass-accented">
                    <CardHeader className="pb-3 px-5 pt-4">
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-1 rounded-full bg-primary" />
                        <div>
                          <CardTitle className="text-lg font-semibold">Evolución por sesión</CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5">Ratios de consumo por sesión registrada</p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-1">
                      <div className={CHART_PANEL_CLASS}>
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={historicoChart} margin={MARGIN}>
                          <CartesianGrid {...GRID} />
                          <XAxis dataKey="periodo" {...XAXIS} />
                          <YAxis {...YAXIS} />
                          <Tooltip cursor={CHART_CURSOR} content={<GlassTooltip formatter={(v, n) => `${Number(v).toFixed(3)} ${n.split(" ")[1] ?? ""}`} />} />
                          <Legend wrapperStyle={legendStyle} />
                          <Bar dataKey="Agua L/kg"           fill={barFill(C.info, 0.25)}   stroke={C.info}   {...BAR_STYLE} />
                          <Bar dataKey="Electricidad kWh/kg" fill={barFill(C.warning, 0.25)}  stroke={C.warning}  {...BAR_STYLE} />
                          <Bar dataKey="Gasoil mL/kg"        fill={barFill(C.primary, 0.25)} stroke={C.primary} {...BAR_STYLE} />
                          <Bar dataKey="Químicos mL/kg"      fill={barFill(C.destructive, 0.25)} stroke={C.destructive} {...BAR_STYLE} />
                        </BarChart>
                      </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ════════ MÁQUINAS ════════ */}
          <TabsContent value="maquinas" className="space-y-6">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Gestión</p>
                <CardTitle>Añadir máquina</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-4 items-end">
                <div className="glass p-4 space-y-2 flex-1 min-w-[200px]">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nombre</Label>
                  <Input value={mNombre} onChange={(e) => setMNombre(e.target.value)} placeholder="Ej: Cinta principal" />
                </div>
                <div className="glass p-4 space-y-2 w-52">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Zona</Label>
                  <Select value={mZona} onValueChange={setMZona}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ZONAS.map((z) => (
                        <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => maquinaMut.mutate()} disabled={maquinaMut.isPending || !mNombre.trim()} className="glass glass-hover h-10">
                  <Plus className="h-4 w-4 mr-2" /> Añadir
                </Button>
              </CardContent>
            </Card>

            {maquinas.length === 0 ? (
              <Card className="glass-accented">
                <CardContent className="p-12 text-center">
                  <Settings className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No hay máquinas registradas. Añade la primera cuando el experto os dé los datos.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-accented">
                <CardHeader>
                  <p className="panel-kicker">Inventario</p>
                  <CardTitle>Máquinas ({maquinas.length})</CardTitle>
                </CardHeader>
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
          <TabsContent value="historico" className="space-y-6">
            {sesiones.length === 0 ? (
              <Card className="glass-accented">
                <CardContent className="p-12 text-center">
                  <History className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No hay sesiones registradas.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Tabla de sesiones */}
                <Card className="glass-accented">
                  <CardHeader>
                    <p className="panel-kicker">Historial</p>
                    <CardTitle>Sesiones anteriores</CardTitle>
                  </CardHeader>
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
                                <Button variant="ghost" size="icon" className="hover:bg-destructive/10 hover:text-destructive" onClick={() => delSesionMut.mutate(s.id)}>
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
                  <Card className="glass-accented">
                    <CardHeader className="pb-3 px-5 pt-4">
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-1 rounded-full bg-primary" />
                        <div>
                          <CardTitle className="text-lg font-semibold">Evolución de ratios</CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5">Tendencia de consumo por kg procesado</p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-1">
                      <div className={CHART_PANEL_CLASS}>
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={historicoChart} margin={MARGIN}>
                          <CartesianGrid {...GRID} />
                          <XAxis dataKey="periodo" {...XAXIS} />
                          <YAxis {...YAXIS} />
                          <Tooltip cursor={CHART_LINE_CURSOR} content={<GlassTooltip formatter={(v, n) => `${Number(v).toFixed(3)} ${n.split(" ")[1] ?? ""}`} />} />
                          <Legend wrapperStyle={legendStyle} />
                          <Line dataKey="Agua L/kg" {...lineStyle(C.info)} />
                          <Line dataKey="Electricidad kWh/kg" {...lineStyle(C.warning)} />
                        </LineChart>
                      </ResponsiveContainer>
                      </div>
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
