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
import { Plus, Trash2, Save, History, BarChart3, Settings, Droplet, Zap, Fuel, FlaskConical, FileText, FileSpreadsheet, CalendarDays } from "lucide-react";
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
  const [tab, setTab] = useState("resumen");
  const consumosFisicos = useConsumosFisicos();
  const [cfRecurso, setCfRecurso] = useState<"agua" | "electricidad" | "gasoil" | "quimicos">("gasoil");
  const [cfInicio, setCfInicio] = useState("2025-09-01");
  const [cfFin, setCfFin] = useState(today());
  const [cfCantidad, setCfCantidad] = useState("");
  const [cfUnidad, setCfUnidad] = useState<"l" | "m3" | "kwh">("l");
  const [cfFuente, setCfFuente] = useState<"contador" | "factura_detallada" | "albaran" | "estimacion_manual">("albaran");
  const [cfReferencia, setCfReferencia] = useState("");
  const [cfNotas, setCfNotas] = useState("");
  const [baseTipo, setBaseTipo] = useState<"ventas" | "manual">("ventas");
  const [baseInicio, setBaseInicio] = useState("2025-09-01");
  const [baseFin, setBaseFin] = useState(today());
  const [baseKg, setBaseKg] = useState("");
  const [baseReferencia, setBaseReferencia] = useState("");
  const [baseNotas, setBaseNotas] = useState("");

  const guardarConsumoFisico = () => {
    const cantidad = Number(cfCantidad) || 0;
    if (cantidad <= 0) {
      toast({ title: "Cantidad requerida", description: "Introduce una cantidad fisica mayor que cero.", variant: "destructive" });
      return;
    }
    consumosFisicos.addConsumo.mutate({
      recurso: cfRecurso,
      fecha_inicio: cfInicio,
      fecha_fin: cfFin,
      cantidad,
      unidad: cfUnidad,
      fuente: cfFuente,
      referencia: cfReferencia || null,
      notas: cfNotas || null,
    }, {
      onSuccess: () => {
        toast({ title: "Consumo guardado" });
        setCfCantidad("");
        setCfReferencia("");
        setCfNotas("");
      },
      onError: (e) => toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
    });
  };

  const guardarBaseKg = () => {
    const kg = Number(baseKg) || 0;
    if (kg <= 0) {
      toast({ title: "Kg requeridos", description: "Introduce kg vendidos o manuales mayores que cero.", variant: "destructive" });
      return;
    }
    consumosFisicos.addBaseKg.mutate({
      tipo_base: baseTipo,
      fecha_inicio: baseInicio,
      fecha_fin: baseFin,
      kg,
      referencia: baseReferencia || null,
      notas: baseNotas || null,
    }, {
      onSuccess: () => {
        toast({ title: "Base kg guardada" });
        setBaseKg("");
        setBaseReferencia("");
        setBaseNotas("");
      },
      onError: (e) => toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
    });
  };

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
          <TabsList className="grid w-full grid-cols-2 md:w-auto md:grid-cols-5">
            <TabsTrigger value="resumen"><BarChart3 className="h-4 w-4 mr-1.5" />Resumen</TabsTrigger>
            <TabsTrigger value="registrar"><Save className="h-4 w-4 mr-1.5" />Registrar</TabsTrigger>
            <TabsTrigger value="historico"><History className="h-4 w-4 mr-1.5" />Historico</TabsTrigger>
            <TabsTrigger value="validacion"><FileText className="h-4 w-4 mr-1.5" />Validacion</TabsTrigger>
            <TabsTrigger value="maquinas"><Settings className="h-4 w-4 mr-1.5" />Maquinas</TabsTrigger>
          </TabsList>
          </div>

          {/* REGISTRAR */}
          <TabsContent value="registrar" className="space-y-6">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Consumo fisico</p>
                <CardTitle>Registrar recurso medido</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-3">
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recurso</Label>
                  <Select value={cfRecurso} onValueChange={(value) => setCfRecurso(value as typeof cfRecurso)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agua">Agua</SelectItem>
                      <SelectItem value="electricidad">Electricidad</SelectItem>
                      <SelectItem value="gasoil">Gasoil</SelectItem>
                      <SelectItem value="quimicos">Quimicos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha inicio</Label>
                  <ConsumoDatePicker value={cfInicio} onChange={setCfInicio} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha fin</Label>
                  <ConsumoDatePicker value={cfFin} onChange={setCfFin} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cantidad fisica</Label>
                  <Input type="number" step="0.1" min="0" value={cfCantidad} onChange={(e) => setCfCantidad(e.target.value)} placeholder="0" />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unidad</Label>
                  <Select value={cfUnidad} onValueChange={(value) => setCfUnidad(value as typeof cfUnidad)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="l">l</SelectItem>
                      <SelectItem value="m3">m3</SelectItem>
                      <SelectItem value="kwh">kwh</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fuente</Label>
                  <Select value={cfFuente} onValueChange={(value) => setCfFuente(value as typeof cfFuente)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contador">Contador</SelectItem>
                      <SelectItem value="factura_detallada">Factura detallada</SelectItem>
                      <SelectItem value="albaran">Albaran</SelectItem>
                      <SelectItem value="estimacion_manual">Estimacion manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Referencia</Label>
                  <Input value={cfReferencia} onChange={(e) => setCfReferencia(e.target.value)} placeholder="Opcional" />
                </div>
                <div className="glass p-4 space-y-2 md:col-span-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notas</Label>
                  <Input value={cfNotas} onChange={(e) => setCfNotas(e.target.value)} placeholder="Opcional" />
                </div>
                <div className="md:col-span-3 flex justify-end">
                  <Button onClick={guardarConsumoFisico} disabled={consumosFisicos.addConsumo.isPending} className="glass glass-hover px-8">
                    <Save className="h-4 w-4 mr-2" /> Guardar consumo
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Base kg</p>
                <CardTitle>Registrar kg vendidos o manuales</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-3">
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tipo</Label>
                  <Select value={baseTipo} onValueChange={(value) => setBaseTipo(value as typeof baseTipo)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ventas">Ventas</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha inicio</Label>
                  <ConsumoDatePicker value={baseInicio} onChange={setBaseInicio} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha fin</Label>
                  <ConsumoDatePicker value={baseFin} onChange={setBaseFin} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kg</Label>
                  <Input type="number" step="0.1" min="0" value={baseKg} onChange={(e) => setBaseKg(e.target.value)} placeholder="0" />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Referencia</Label>
                  <Input value={baseReferencia} onChange={(e) => setBaseReferencia(e.target.value)} placeholder="Opcional" />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notas</Label>
                  <Input value={baseNotas} onChange={(e) => setBaseNotas(e.target.value)} placeholder="Opcional" />
                </div>
                <div className="md:col-span-3 flex justify-end">
                  <Button onClick={guardarBaseKg} disabled={consumosFisicos.addBaseKg.isPending} className="glass glass-hover px-8">
                    <Save className="h-4 w-4 mr-2" /> Guardar base kg
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="resumen" className="space-y-6">
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
          <TabsContent value="validacion" className="space-y-6">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Validacion de consumos</p>
                <CardTitle>Revision pendiente</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">La revision de periodos incompletos se anadira en el siguiente bloque.</p>
              </CardContent>
            </Card>
          </TabsContent>

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
