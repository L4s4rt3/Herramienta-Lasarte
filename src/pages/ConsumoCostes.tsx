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
import { Badge } from "@/components/ui/badge";
import { useConsumosFisicos } from "@/hooks/useConsumosFisicos";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, History, BarChart3, Settings, Droplet, Zap, Fuel, FlaskConical, FileText, FileSpreadsheet, CalendarDays } from "lucide-react";
import { today, formatNumber, formatDate } from "@/lib/format";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  GlassTooltip, legendStyle, C, GRID, XAXIS, YAXIS, MARGIN,
  CHART_LINE_CURSOR, CHART_PANEL_CLASS, lineStyle,
} from "@/lib/chartTheme";
import { MaquinaRow, SesionConsumoRow, ConsumoMaquinaRow } from "@/lib/types";
import { exportConsumoToExcel, exportConsumoToPDF } from "@/lib/exportConsumo";

const ZONAS = [
  { value: "drencher", label: "Drencher" },
  { value: "linea_tratamiento", label: "Línea tratamiento" },
  { value: "planta_general", label: "Planta general" },
  { value: "compresor", label: "Compresor" },
];

type ConsumoRecurso = "agua" | "electricidad" | "gasoil" | "quimicos";
type ConsumoUnidad = "l" | "m3" | "kwh";

const UNIDADES_POR_RECURSO: Record<ConsumoRecurso, ConsumoUnidad[]> = {
  agua: ["l", "m3"],
  electricidad: ["kwh"],
  gasoil: ["l"],
  quimicos: ["l"],
};

const UNIDAD_LABEL: Record<ConsumoUnidad, string> = {
  l: "l",
  m3: "m3",
  kwh: "kWh",
};

type ConsumoConfianza = "real" | "estimado" | "mixto" | "incompleto";

const CONFIDENCE_LABEL: Record<ConsumoConfianza, string> = {
  real: "Real",
  estimado: "Estimado",
  mixto: "Mixto",
  incompleto: "Incompleto",
};

const CONFIDENCE_CLASS: Record<ConsumoConfianza, string> = {
  real: "border-success/30 bg-success/10 text-success",
  estimado: "border-warning/30 bg-warning/10 text-warning",
  mixto: "border-info/30 bg-info/10 text-info",
  incompleto: "border-destructive/30 bg-destructive/10 text-destructive",
};

function ratioValue(cantidad: number, kgBase: number) {
  return kgBase > 0 ? cantidad / kgBase : null;
}

function ratioText(value: number | null | undefined, digits: number, unit = "") {
  if (value == null || !Number.isFinite(value)) return "Sin base";
  const formatted = formatNumber(value, digits);
  return unit ? `${formatted} ${unit}` : formatted;
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
  const maquinasQueryKey = ["maquinas", user?.id] as const;
  const sesionesConsumoQueryKey = ["sesiones_consumo", user?.id] as const;
  const consumosMaquinasQueryKey = ["consumo_maquinas", user?.id] as const;
  const [cfRecurso, setCfRecurso] = useState<ConsumoRecurso>("gasoil");
  const [cfInicio, setCfInicio] = useState("2025-09-01");
  const [cfFin, setCfFin] = useState(today());
  const [cfCantidad, setCfCantidad] = useState("");
  const [cfUnidad, setCfUnidad] = useState<ConsumoUnidad>("l");
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
    if (cfFin < cfInicio) {
      toast({ title: "Fechas no validas", description: "La fecha fin debe ser igual o posterior a la fecha inicio.", variant: "destructive" });
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
    if (baseFin < baseInicio) {
      toast({ title: "Fechas no validas", description: "La fecha fin debe ser igual o posterior a la fecha inicio.", variant: "destructive" });
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
    queryKey: maquinasQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("maquinas").select("*").order("nombre");
      if (error) throw error;
      return (data ?? []) as MaquinaRow[];
    },
    enabled: Boolean(user),
  });

  const { data: sesiones = [], isLoading: loadingSesiones } = useQuery({
    queryKey: sesionesConsumoQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sesiones_consumo")
        .select("*")
        .order("fecha_inicio", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SesionConsumoRow[];
    },
    enabled: Boolean(user),
  });

  const { data: consumosMaquinas = [], isLoading: loadingConsumosMaquinas } = useQuery({
    queryKey: consumosMaquinasQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("consumo_maquinas").select("*");
      if (error) throw error;
      return (data ?? []) as ConsumoMaquinaRow[];
    },
    enabled: Boolean(user),
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
      qc.invalidateQueries({ queryKey: maquinasQueryKey });
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
      qc.invalidateQueries({ queryKey: maquinasQueryKey });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ─── Métricas calculadas ──────────────────────────────────────────────────
  const rows = useMemo(() => consumosFisicos.monthlyRows, [consumosFisicos.monthlyRows]);

  const selectedRows = useMemo(
    () => rows.filter((row) => (
      row.kgBase > 0
      || row.aguaL > 0
      || row.electricidadKwh > 0
      || row.gasoilL > 0
      || row.quimicosL > 0
    )),
    [rows],
  );

  const selectedTotals = useMemo(
    () => selectedRows.reduce(
      (acc, row) => {
        acc.kgBase += row.kgBase;
        acc.kgPartes += row.kgPartes;
        acc.kgVentas += row.kgVentas;
        acc.kgManual += row.kgManual;
        acc.aguaL += row.aguaL;
        acc.electricidadKwh += row.electricidadKwh;
        acc.gasoilL += row.gasoilL;
        acc.quimicosL += row.quimicosL;
        return acc;
      },
      {
        kgBase: 0,
        kgPartes: 0,
        kgVentas: 0,
        kgManual: 0,
        aguaL: 0,
        electricidadKwh: 0,
        gasoilL: 0,
        quimicosL: 0,
      },
    ),
    [selectedRows],
  );

  const totalKg = selectedTotals.kgBase;
  const totalKgPartes = selectedTotals.kgPartes;
  const totalKgVentas = selectedTotals.kgVentas;
  const totalKgManual = selectedTotals.kgManual;
  const totalAguaL = selectedTotals.aguaL;
  const totalElectricidadKwh = selectedTotals.electricidadKwh;
  const totalGasoilL = selectedTotals.gasoilL;
  const totalQuimicosL = selectedTotals.quimicosL;

  const resumenRatios = useMemo(() => ({
    aguaLKg: ratioValue(totalAguaL, totalKg),
    electricidadKwhKg: ratioValue(totalElectricidadKwh, totalKg),
    gasoilMlKg: ratioValue(totalGasoilL * 1000, totalKg),
    quimicosMlKg: ratioValue(totalQuimicosL * 1000, totalKg),
  }), [totalAguaL, totalElectricidadKwh, totalGasoilL, totalKg, totalQuimicosL]);

  const monthlyEvolution = useMemo(
    () => selectedRows.map((row) => ({
      periodo: row.periodo,
      "Agua L/kg": row.aguaLKg,
      "Electricidad kWh/kg": row.electricidadKwhKg,
      "Gasoil mL/kg": row.gasoilMlKg,
      "Quimicos mL/kg": row.quimicosMlKg,
    })),
    [selectedRows],
  );

  const issueRows = useMemo(() => rows.filter((row) => row.issues.length > 0), [rows]);

  const loading = loadingMaquinas || consumosFisicos.isLoading;
  const exportLoading = loadingMaquinas || loadingSesiones || loadingConsumosMaquinas || consumosFisicos.isLoading;
  const exportDisabled = exportLoading || selectedRows.length === 0;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1 className="page-title">Consumos físicos</h1>
          <p className="page-subtitle">Agua · Electricidad · Gasoil · Químicos por kg de naranja</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={exportDisabled}
            onClick={() => exportConsumoToExcel({
              sesiones,
              maquinas,
              consumosMaquinas,
              consumosFisicos: consumosFisicos.consumos,
              basesKg: consumosFisicos.basesKg,
              periodos: rows,
            })}
            className="glass glass-hover"
          >
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exportDisabled}
            onClick={() => exportConsumoToPDF({
              sesiones,
              maquinas,
              consumosMaquinas,
              consumosFisicos: consumosFisicos.consumos,
              basesKg: consumosFisicos.basesKg,
              periodos: rows,
            })}
            className="glass glass-hover"
          >
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
                  <Select
                    value={cfRecurso}
                    onValueChange={(value) => {
                      const recurso = value as ConsumoRecurso;
                      setCfRecurso(recurso);
                      setCfUnidad(UNIDADES_POR_RECURSO[recurso][0]);
                    }}
                  >
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
                  <Select value={cfUnidad} onValueChange={(value) => setCfUnidad(value as ConsumoUnidad)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNIDADES_POR_RECURSO[cfRecurso].map((unidad) => (
                        <SelectItem key={unidad} value={unidad}>{UNIDAD_LABEL[unidad]}</SelectItem>
                      ))}
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
            {selectedRows.length === 0 ? (
              <Card className="glass-accented">
                <CardContent className="p-12 text-center text-muted-foreground">
                  Aun no hay consumos fisicos o kg base para resumir la campana.
                </CardContent>
              </Card>
            ) : (
              <>
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <KPICard
                    label="Agua L/kg"
                    value={ratioText(resumenRatios.aguaLKg, 2, "L/kg")}
                    hint={`${formatNumber(totalAguaL)} L / ${formatNumber(totalKg)} kg`}
                    icon={Droplet}
                    className="glass-accented"
                  />
                  <KPICard
                    label="Electricidad kWh/kg"
                    value={ratioText(resumenRatios.electricidadKwhKg, 3, "kWh/kg")}
                    hint={`${formatNumber(totalElectricidadKwh, 1)} kWh / ${formatNumber(totalKg)} kg`}
                    icon={Zap}
                    className="glass-accented"
                  />
                  <KPICard
                    label="Gasoil mL/kg"
                    value={ratioText(resumenRatios.gasoilMlKg, 1, "mL/kg")}
                    hint={`${formatNumber(totalGasoilL, 1)} L / ${formatNumber(totalKg)} kg`}
                    icon={Fuel}
                    className="glass-accented"
                  />
                  <KPICard
                    label="Quimicos mL/kg"
                    value={ratioText(resumenRatios.quimicosMlKg, 1, "mL/kg")}
                    hint={`${formatNumber(totalQuimicosL, 1)} L / ${formatNumber(totalKg)} kg`}
                    icon={FlaskConical}
                    className="glass-accented"
                  />
                </section>

                <Card className="glass-accented">
                  <CardHeader>
                    <p className="panel-kicker">Campana</p>
                    <CardTitle>Totales ({selectedRows.length} meses con datos)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-success/40 rounded-full" />
                        <p className="text-xs font-semibold text-success uppercase tracking-wider">Kg base</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(totalKg)} <span className="text-sm font-normal text-muted-foreground">kg</span></p>
                        <p className="mt-2 text-xs text-muted-foreground">Partes: {formatNumber(totalKgPartes)} - Ventas: {formatNumber(totalKgVentas)} - Manual: {formatNumber(totalKgManual)}</p>
                      </div>
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-info/40 rounded-full" />
                        <p className="text-xs font-semibold text-info uppercase tracking-wider">Agua</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(totalAguaL)} <span className="text-sm font-normal text-muted-foreground">L</span></p>
                      </div>
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-warning/40 rounded-full" />
                        <p className="text-xs font-semibold text-warning uppercase tracking-wider">Electricidad</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(totalElectricidadKwh, 1)} <span className="text-sm font-normal text-muted-foreground">kWh</span></p>
                      </div>
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-primary/40 rounded-full" />
                        <p className="text-xs font-semibold text-primary uppercase tracking-wider">Gasoil</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(totalGasoilL, 1)} <span className="text-sm font-normal text-muted-foreground">L</span></p>
                      </div>
                      <div className="glass p-5 relative overflow-hidden">
                        <div className="absolute inset-x-4 top-0 h-0.5 bg-destructive/40 rounded-full" />
                        <p className="text-xs font-semibold text-destructive uppercase tracking-wider">Quimicos</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(totalQuimicosL, 1)} <span className="text-sm font-normal text-muted-foreground">L</span></p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {monthlyEvolution.length > 1 && (
                  <Card className="glass-accented">
                    <CardHeader className="pb-3 px-5 pt-4">
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-1 rounded-full bg-primary" />
                        <div>
                          <CardTitle className="text-lg font-semibold">Evolucion mensual</CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5">Ratios fisicos calculados con kg base mensual</p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-1">
                      <div className={CHART_PANEL_CLASS}>
                        <ResponsiveContainer width="100%" height={320}>
                          <LineChart data={monthlyEvolution} margin={MARGIN}>
                            <CartesianGrid {...GRID} />
                            <XAxis dataKey="periodo" {...XAXIS} />
                            <YAxis {...YAXIS} />
                            <Tooltip
                              cursor={CHART_LINE_CURSOR}
                              content={(
                                <GlassTooltip
                                  formatter={(value, name) => {
                                    const label = String(name);
                                    const numericValue = typeof value === "number" ? value : Number(value);
                                    const unit = label.includes("kWh") ? "kWh/kg" : label.includes("L/kg") ? "L/kg" : "mL/kg";
                                    const digits = label.includes("Electricidad") ? 3 : label.includes("Agua") ? 2 : 1;
                                    return ratioText(Number.isFinite(numericValue) ? numericValue : null, digits, unit);
                                  }}
                                />
                              )}
                            />
                            <Legend wrapperStyle={legendStyle} />
                            <Line dataKey="Agua L/kg" {...lineStyle(C.info)} />
                            <Line dataKey="Electricidad kWh/kg" {...lineStyle(C.warning)} />
                            <Line dataKey="Gasoil mL/kg" {...lineStyle(C.primary)} />
                            <Line dataKey="Quimicos mL/kg" {...lineStyle(C.destructive)} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ════════ VALIDACION ════════ */}
          <TabsContent value="validacion" className="space-y-6">
            {issueRows.length === 0 ? (
              <Card className="glass-accented">
                <CardContent className="p-12 text-center">
                  <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No hay incidencias de validacion en los meses calculados.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-accented">
                <CardHeader>
                  <p className="panel-kicker">Validacion de consumos</p>
                  <CardTitle>Meses con incidencias ({issueRows.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periodo</TableHead>
                        <TableHead>Confianza</TableHead>
                        <TableHead>Incidencias</TableHead>
                        <TableHead className="text-right">Kg base</TableHead>
                        <TableHead className="text-right">Agua</TableHead>
                        <TableHead className="text-right">Electricidad</TableHead>
                        <TableHead className="text-right">Gasoil</TableHead>
                        <TableHead className="text-right">Quimicos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {issueRows.map((row) => (
                        <TableRow key={row.periodo}>
                          <TableCell className="whitespace-nowrap font-medium">{row.periodo}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${CONFIDENCE_CLASS[row.confianza]}`}>
                              {CONFIDENCE_LABEL[row.confianza]}
                            </Badge>
                          </TableCell>
                          <TableCell className="min-w-[240px]">
                            <div className="flex flex-wrap gap-1.5">
                              {row.issues.map((issue) => (
                                <span key={issue} className="rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                                  {issue}
                                </span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.kgBase)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.aguaL)} L</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.electricidadKwh, 1)} kWh</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.gasoilL, 1)} L</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.quimicosL, 1)} L</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
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
            {rows.length === 0 ? (
              <Card className="glass-accented">
                <CardContent className="p-12 text-center">
                  <History className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No hay meses de consumo calculados.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-accented">
                <CardHeader>
                  <p className="panel-kicker">Mensual</p>
                  <CardTitle>Historico fisico ({rows.length} meses)</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periodo</TableHead>
                        <TableHead>Confianza</TableHead>
                        <TableHead className="text-right">Kg partes</TableHead>
                        <TableHead className="text-right">Kg ventas</TableHead>
                        <TableHead className="text-right">Kg manual</TableHead>
                        <TableHead className="text-right">Kg base</TableHead>
                        <TableHead className="text-right">Agua L/kg</TableHead>
                        <TableHead className="text-right">kWh/kg</TableHead>
                        <TableHead className="text-right">Gasoil mL/kg</TableHead>
                        <TableHead className="text-right">Quimicos mL/kg</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.periodo}>
                          <TableCell className="whitespace-nowrap">
                            <div className="font-medium">{row.periodo}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {formatDate(row.fechaInicio)} - {formatDate(row.fechaFin)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${CONFIDENCE_CLASS[row.confianza]}`}>
                              {CONFIDENCE_LABEL[row.confianza]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.kgPartes)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.kgVentas)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.kgManual)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{formatNumber(row.kgBase)}</TableCell>
                          <TableCell className="text-right tabular-nums">{ratioText(row.aguaLKg, 2)}</TableCell>
                          <TableCell className="text-right tabular-nums">{ratioText(row.electricidadKwhKg, 3)}</TableCell>
                          <TableCell className="text-right tabular-nums">{ratioText(row.gasoilMlKg, 1)}</TableCell>
                          <TableCell className="text-right tabular-nums">{ratioText(row.quimicosMlKg, 1)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
