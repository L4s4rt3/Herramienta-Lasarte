import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useConsumosFisicos } from "@/hooks/useConsumosFisicos";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, History, BarChart3, Settings, Droplet, Zap, Fuel, FlaskConical, FileText, FileSpreadsheet, CalendarDays, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { today, formatNumber, formatDate } from "@/lib/format";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Bar, BarChart, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  GlassTooltip, legendStyle, C, GRID, XAXIS, YAXIS, MARGIN,
  CHART_LINE_CURSOR, CHART_PANEL_CLASS, lineStyle,
} from "@/lib/chartTheme";
import { buildDailyWaterMeterConsumo, parseConsumoNumber, type ConsumoPeriodoRow } from "@/lib/consumosFisicos";
import { errorMessage } from "@/lib/errorMessage";
import { MaquinaRow, SesionConsumoRow, ConsumoMaquinaRow } from "@/lib/types";
import { exportConsumoToExcel, exportConsumoToPDF } from "@/lib/exportConsumo";
import {
  isDuplicateFacturaConsumo,
  parseFacturaConsumoFile,
  type FacturaConsumoParsedRow,
  type FacturaConsumoParseResult,
} from "@/lib/facturasConsumoImport";
import {
  CAMPANA_2024_2025_VENTAS_KG,
  FACTURAS_CAMPANA_2024_2025_AGUA_CONSUMOS,
  FACTURAS_CAMPANA_2024_2025_CONSUMOS,
  FACTURAS_CAMPANA_2024_2025_ELECTRICIDAD_CONSUMOS,
  FACTURAS_CAMPANA_2024_2025_RANGE,
} from "@/lib/facturasCampana2024_2025";
import {
  CAMPANA_2025_2026_VENTAS_KG,
  FACTURAS_CAMPANA_2025_2026_AGUA_CONSUMOS,
  FACTURAS_CAMPANA_2025_2026_CONSUMOS,
  FACTURAS_CAMPANA_2025_2026_ELECTRICIDAD_CONSUMOS,
  FACTURAS_CAMPANA_2025_2026_RANGE,
} from "@/lib/facturasCampana2025_2026";

const ZONAS = [
  { value: "drencher", label: "Drencher" },
  { value: "linea_tratamiento", label: "Línea tratamiento" },
  { value: "planta_general", label: "Planta general" },
  { value: "compresor", label: "Compresor" },
];

type ConsumoRecurso = "agua" | "electricidad" | "gasoil" | "quimicos";
type ConsumoUnidad = "l" | "m3" | "kwh";
type ConsumoPeriodoVista = "semanal" | "mensual" | "diario";

const UNIDADES_POR_RECURSO: Record<ConsumoRecurso, ConsumoUnidad[]> = {
  agua: ["l"],
  electricidad: ["kwh"],
  gasoil: ["l"],
  quimicos: ["l"],
};

const UNIDAD_LABEL: Record<ConsumoUnidad, string> = {
  l: "Litros",
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

function percentCss(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(100, value))}%`;
}

function boundedPercent(value: number, max: number) {
  if (max <= 0 || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

const PERIODO_VISTA_LABEL: Record<ConsumoPeriodoVista, string> = {
  semanal: "Semanal",
  mensual: "Mensual",
  diario: "Diario",
};

const PERIODO_VISTA_DETAIL_LABEL: Record<ConsumoPeriodoVista, string> = {
  semanal: "semanas",
  mensual: "meses",
  diario: "dias",
};

const WEEK_BLOCK_SIZE = 6;

interface PeriodBlock {
  id: string;
  label: string;
  detail: string;
  rows: ConsumoPeriodoRow[];
}

function periodShortLabel(periodo: string) {
  if (/^S\d{2,}$/.test(periodo)) {
    return periodo;
  }

  if (/^\d{4}-W\d{2}$/.test(periodo)) {
    return `S${periodo.slice(-2)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(periodo)) {
    return format(new Date(`${periodo}T12:00:00`), "dd MMM", { locale: es });
  }

  const [year, month] = periodo.split("-").map(Number);
  return format(new Date(year, month - 1, 1), "MMM yy", { locale: es });
}

function buildPeriodBlocks(rows: ConsumoPeriodoRow[], size = WEEK_BLOCK_SIZE): PeriodBlock[] {
  const blocks: PeriodBlock[] = [];

  for (let end = rows.length; end > 0; end -= size) {
    const start = Math.max(0, end - size);
    const blockRows = rows.slice(start, end);
    const first = blockRows[0];
    const last = blockRows.at(-1);

    if (!first || !last) {
      continue;
    }

    blocks.push({
      id: blocks.length === 0 ? "latest" : `${start}-${end}`,
      label: blocks.length === 0
        ? `Ultimas ${blockRows.length} semanas`
        : `${periodShortLabel(first.periodo)} - ${periodShortLabel(last.periodo)}`,
      detail: `${formatDate(first.fechaInicio)} - ${formatDate(last.fechaFin)}`,
      rows: blockRows,
    });
  }

  return blocks;
}

function hasConsumo(row: FacturaConsumoParsedRow): row is FacturaConsumoParsedRow & { consumo: NonNullable<FacturaConsumoParsedRow["consumo"]> } {
  return Boolean(row.consumo);
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
  const [campanaId, setCampanaId] = useState<string>(FACTURAS_CAMPANA_2025_2026_RANGE.id);
  const [periodoVista, setPeriodoVista] = useState<ConsumoPeriodoVista>("semanal");
  const [periodBlockId, setPeriodBlockId] = useState("latest");
  const isCurrentCampaign = campanaId === FACTURAS_CAMPANA_2025_2026_RANGE.id;
  const campanasConsumo = useMemo(() => [
    FACTURAS_CAMPANA_2024_2025_RANGE,
    {
      ...FACTURAS_CAMPANA_2025_2026_RANGE,
      fechaFin: today(),
    },
  ], []);
  const selectedCampana = campanasConsumo.find((campana) => campana.id === campanaId) ?? campanasConsumo[0];
  const activePeriodoVista: ConsumoPeriodoVista = isCurrentCampaign ? periodoVista : "mensual";
  const consumosFisicos = useConsumosFisicos(selectedCampana.fechaInicio, selectedCampana.fechaFin);
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
  const [facturaImportResults, setFacturaImportResults] = useState<FacturaConsumoParseResult[]>([]);
  const [facturaImportLoading, setFacturaImportLoading] = useState(false);
  const [facturaImportSaving, setFacturaImportSaving] = useState(false);
  const [aguaDiariaFecha, setAguaDiariaFecha] = useState(today());
  const [aguaContadorGeneral, setAguaContadorGeneral] = useState("");
  const [aguaLineaTratamiento, setAguaLineaTratamiento] = useState("");
  const [aguaDrencher, setAguaDrencher] = useState("");

  useEffect(() => {
    setCfInicio(selectedCampana.fechaInicio);
    setCfFin(selectedCampana.fechaFin);
    setBaseInicio(selectedCampana.fechaInicio);
    setBaseFin(selectedCampana.fechaFin);
  }, [selectedCampana.fechaFin, selectedCampana.fechaInicio]);

  useEffect(() => {
    setPeriodBlockId("latest");
  }, [campanaId, activePeriodoVista]);

  useEffect(() => {
    if (!isCurrentCampaign && periodoVista !== "mensual") {
      setPeriodoVista("mensual");
    }
  }, [isCurrentCampaign, periodoVista]);

  const facturaRows = useMemo(
    () => facturaImportResults.flatMap((result) => result.rows),
    [facturaImportResults],
  );
  const facturaRowsWithConsumo = useMemo(
    () => facturaRows.filter(hasConsumo),
    [facturaRows],
  );
  const facturaDuplicateIds = useMemo(
    () => new Set(
      facturaRowsWithConsumo
        .filter((row) => isDuplicateFacturaConsumo(row.consumo, consumosFisicos.consumos))
        .map((row) => row.id),
    ),
    [facturaRowsWithConsumo, consumosFisicos.consumos],
  );
  const facturaNewRows = useMemo(
    () => facturaRowsWithConsumo.filter((row) => !facturaDuplicateIds.has(row.id)),
    [facturaDuplicateIds, facturaRowsWithConsumo],
  );
  const facturaSkippedRows = useMemo(
    () => facturaRows.filter((row) => row.status === "skipped"),
    [facturaRows],
  );
  const facturasIntegradasResumen = useMemo(() => {
    const aguaConsumos = isCurrentCampaign
      ? FACTURAS_CAMPANA_2025_2026_AGUA_CONSUMOS
      : FACTURAS_CAMPANA_2024_2025_AGUA_CONSUMOS;
    const electricidadConsumos = isCurrentCampaign
      ? FACTURAS_CAMPANA_2025_2026_ELECTRICIDAD_CONSUMOS
      : FACTURAS_CAMPANA_2024_2025_ELECTRICIDAD_CONSUMOS;
    const gasoilConsumos = isCurrentCampaign
      ? FACTURAS_CAMPANA_2025_2026_CONSUMOS
      : FACTURAS_CAMPANA_2024_2025_CONSUMOS;
    const ventasKg = isCurrentCampaign
      ? CAMPANA_2025_2026_VENTAS_KG
      : CAMPANA_2024_2025_VENTAS_KG;

    return {
      aguaM3: aguaConsumos.reduce((total, row) => total + row.m3, 0),
      aguaFacturas: aguaConsumos.length,
      electricidadKwh: electricidadConsumos.reduce((total, row) => total + row.kwh, 0),
      electricidadFacturas: electricidadConsumos.length,
      gasoilL: gasoilConsumos.reduce((total, row) => total + row.litros, 0),
      gasoilLineas: gasoilConsumos.length,
      ventasKg: ventasKg.reduce((total, row) => total + row.kgNetos, 0),
      ventasMeses: ventasKg.length,
      ventasFuente: isCurrentCampaign ? "ventas campana 2526.xlsx" : "campana2425.xlsx",
      gasoilFuente: isCurrentCampaign ? "facturas 2526" : "2024-2025-GASOIL.xls",
    };
  }, [isCurrentCampaign]);

  const guardarConsumoFisico = () => {
    const cantidad = parseConsumoNumber(cfCantidad);
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
      unidad: cfRecurso === "agua" ? "l" : cfUnidad,
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

  const guardarLecturaAguaDiaria = () => {
    const contadorGeneralL = parseConsumoNumber(aguaContadorGeneral);
    const lineaTratamientoL = parseConsumoNumber(aguaLineaTratamiento);
    const drencherL = parseConsumoNumber(aguaDrencher);

    if (contadorGeneralL <= 0) {
      toast({ title: "Contador general requerido", description: "Introduce el gasto de agua del contador general.", variant: "destructive" });
      return;
    }

    const alreadyExists = consumosFisicos.consumos.some((row) => (
      row.recurso === "agua"
      && row.fuente === "contador"
      && row.fecha_inicio === aguaDiariaFecha
      && row.fecha_fin === aguaDiariaFecha
      && row.referencia === "agua-contador-general"
    ));

    if (alreadyExists) {
      toast({ title: "Lectura ya registrada", description: "Ya existe una lectura de contador general para ese dia.", variant: "destructive" });
      return;
    }

    consumosFisicos.addConsumo.mutate(buildDailyWaterMeterConsumo({
      fecha: aguaDiariaFecha,
      contadorGeneralL,
      lineaTratamientoL,
      drencherL,
    }), {
      onSuccess: () => {
        toast({ title: "Lectura de agua guardada" });
        setAguaContadorGeneral("");
        setAguaLineaTratamiento("");
        setAguaDrencher("");
      },
      onError: (e) => toast({ title: "Error", description: errorMessage(e), variant: "destructive" }),
    });
  };

  const analizarFacturas = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      return;
    }

    setFacturaImportLoading(true);
    try {
      const parsedResults = await Promise.all(files.map((file) => parseFacturaConsumoFile(file)));
      const importableCount = parsedResults.reduce((total, result) => total + result.summary.importable, 0);
      const skippedCount = parsedResults.reduce((total, result) => total + result.summary.skipped, 0);

      setFacturaImportResults(parsedResults);
      setTab("importar");
      toast({
        title: "Facturas revisadas",
        description: `${importableCount} consumos detectados, ${skippedCount} filas omitidas.`,
      });
    } catch (error) {
      toast({
        title: "No se pudieron leer las facturas",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setFacturaImportLoading(false);
      input.value = "";
    }
  };

  const guardarFacturasImportadas = async () => {
    if (facturaNewRows.length === 0) {
      toast({ title: "Sin consumos nuevos", description: "No hay filas nuevas para guardar." });
      return;
    }

    setFacturaImportSaving(true);
    try {
      for (const row of facturaNewRows) {
        await consumosFisicos.addConsumo.mutateAsync(row.consumo);
      }

      toast({
        title: "Facturas importadas",
        description: `${facturaNewRows.length} consumos guardados.`,
      });
      setFacturaImportResults([]);
      setTab("historico");
    } catch (error) {
      toast({
        title: "Error al importar",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setFacturaImportSaving(false);
    }
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
      onError: (e) => toast({ title: "Error", description: errorMessage(e), variant: "destructive" }),
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
  const allPeriodRows = useMemo(() => {
    if (activePeriodoVista === "diario") {
      return consumosFisicos.dailyRows;
    }

    if (activePeriodoVista === "mensual") {
      return consumosFisicos.monthlyRows;
    }

    return consumosFisicos.weeklyRows;
  }, [activePeriodoVista, consumosFisicos.dailyRows, consumosFisicos.monthlyRows, consumosFisicos.weeklyRows]);

  const weeklyBlocks = useMemo(
    () => (isCurrentCampaign && activePeriodoVista === "semanal" ? buildPeriodBlocks(allPeriodRows) : []),
    [activePeriodoVista, allPeriodRows, isCurrentCampaign],
  );

  const activeWeeklyBlock = useMemo(
    () => weeklyBlocks.find((block) => block.id === periodBlockId) ?? weeklyBlocks[0] ?? null,
    [periodBlockId, weeklyBlocks],
  );

  const rows = useMemo(() => {
    if (!isCurrentCampaign || activePeriodoVista !== "semanal") {
      return allPeriodRows;
    }

    if (periodBlockId === "all") {
      return allPeriodRows;
    }

    return activeWeeklyBlock?.rows ?? allPeriodRows.slice(-WEEK_BLOCK_SIZE);
  }, [activePeriodoVista, activeWeeklyBlock, allPeriodRows, isCurrentCampaign, periodBlockId]);

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
        acc.kgPalets += row.kgPalets;
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
        kgPalets: 0,
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
  const totalKgPalets = selectedTotals.kgPalets;
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

  const monthsWithData = selectedRows.length;
  const monthsInRange = rows.length;
  const monthsCoveragePct = monthsInRange > 0 ? (monthsWithData / monthsInRange) * 100 : 0;
  const periodDetailLabel = PERIODO_VISTA_DETAIL_LABEL[activePeriodoVista];
  const selectedPeriodLabel = PERIODO_VISTA_LABEL[activePeriodoVista];
  const currentPeriodRow = isCurrentCampaign && activePeriodoVista === "semanal" ? allPeriodRows.at(-1) : null;
  const previousPeriodRow = isCurrentCampaign && activePeriodoVista === "semanal" && allPeriodRows.length > 1 ? allPeriodRows.at(-2) : null;
  const visibleRangeLabel = !isCurrentCampaign
    ? "Toda la campana por mes"
    : activePeriodoVista === "semanal"
    ? periodBlockId === "all"
      ? "Toda la campana"
      : activeWeeklyBlock?.label ?? "Ultimas semanas"
    : selectedPeriodLabel;

  const topConsumptionMonth = useMemo(() => (
    selectedRows.reduce(
      (best, row) => {
        const score = row.aguaL + row.electricidadKwh + row.gasoilL + row.quimicosL;
        return score > best.score ? { periodo: row.periodo, score } : best;
      },
      { periodo: "-", score: 0 },
    )
  ), [selectedRows]);

  const resourceCards = useMemo(() => {
    const maxAgua = Math.max(...selectedRows.map((row) => row.aguaL), 0);
    const maxElectricidad = Math.max(...selectedRows.map((row) => row.electricidadKwh), 0);
    const maxGasoil = Math.max(...selectedRows.map((row) => row.gasoilL), 0);
    const maxQuimicos = Math.max(...selectedRows.map((row) => row.quimicosL), 0);

    return [
      {
        id: "agua",
        label: "Agua",
        icon: Droplet,
        color: C.info,
        textClass: "text-info",
        softClass: "bg-info/10 border-info/20",
        total: totalAguaL,
        unit: "L",
        ratio: ratioText(resumenRatios.aguaLKg, 2, "L/kg"),
        coverage: selectedRows.filter((row) => row.aguaL > 0).length,
        peak: selectedRows.reduce((best, row) => (row.aguaL > best.value ? { periodo: row.periodo, value: row.aguaL } : best), { periodo: "-", value: 0 }),
        max: maxAgua,
      },
      {
        id: "electricidad",
        label: "Electricidad",
        icon: Zap,
        color: C.warning,
        textClass: "text-warning",
        softClass: "bg-warning/10 border-warning/20",
        total: totalElectricidadKwh,
        unit: "kWh",
        ratio: ratioText(resumenRatios.electricidadKwhKg, 3, "kWh/kg"),
        coverage: selectedRows.filter((row) => row.electricidadKwh > 0).length,
        peak: selectedRows.reduce((best, row) => (row.electricidadKwh > best.value ? { periodo: row.periodo, value: row.electricidadKwh } : best), { periodo: "-", value: 0 }),
        max: maxElectricidad,
      },
      {
        id: "gasoil",
        label: "Gasoil",
        icon: Fuel,
        color: C.primary,
        textClass: "text-primary",
        softClass: "bg-primary/10 border-primary/20",
        total: totalGasoilL,
        unit: "L",
        ratio: ratioText(resumenRatios.gasoilMlKg, 1, "mL/kg"),
        coverage: selectedRows.filter((row) => row.gasoilL > 0).length,
        peak: selectedRows.reduce((best, row) => (row.gasoilL > best.value ? { periodo: row.periodo, value: row.gasoilL } : best), { periodo: "-", value: 0 }),
        max: maxGasoil,
      },
      {
        id: "quimicos",
        label: "Quimicos",
        icon: FlaskConical,
        color: C.destructive,
        textClass: "text-destructive",
        softClass: "bg-destructive/10 border-destructive/20",
        total: totalQuimicosL,
        unit: "L",
        ratio: ratioText(resumenRatios.quimicosMlKg, 1, "mL/kg"),
        coverage: selectedRows.filter((row) => row.quimicosL > 0).length,
        peak: selectedRows.reduce((best, row) => (row.quimicosL > best.value ? { periodo: row.periodo, value: row.quimicosL } : best), { periodo: "-", value: 0 }),
        max: maxQuimicos,
      },
    ];
  }, [
    resumenRatios.aguaLKg,
    resumenRatios.electricidadKwhKg,
    resumenRatios.gasoilMlKg,
    resumenRatios.quimicosMlKg,
    selectedRows,
    totalAguaL,
    totalElectricidadKwh,
    totalGasoilL,
    totalQuimicosL,
  ]);

  const monthlyEvolution = useMemo(
    () => selectedRows.map((row) => ({
      periodo: row.periodo,
      etiqueta: periodShortLabel(row.periodo),
      "Agua L/kg": row.aguaLKg,
      "Electricidad kWh/kg": row.electricidadKwhKg,
      "Gasoil mL/kg": row.gasoilMlKg,
      "Quimicos mL/kg": row.quimicosMlKg,
    })),
    [selectedRows],
  );

  const monthlyVolumeChart = useMemo(
    () => selectedRows.map((row) => ({
      periodo: row.periodo,
      etiqueta: periodShortLabel(row.periodo),
      agua: row.aguaL,
      electricidad: row.electricidadKwh,
      gasoil: row.gasoilL,
    })),
    [selectedRows],
  );

  const monthlyDetailRows = useMemo(() => {
    const maxKg = Math.max(...selectedRows.map((row) => row.kgBase), 0);
    const maxAgua = Math.max(...selectedRows.map((row) => row.aguaL), 0);
    const maxElectricidad = Math.max(...selectedRows.map((row) => row.electricidadKwh), 0);
    const maxGasoil = Math.max(...selectedRows.map((row) => row.gasoilL), 0);

    return selectedRows.map((row) => ({
      ...row,
      label: periodShortLabel(row.periodo),
      kgPct: boundedPercent(row.kgBase, maxKg),
      aguaPct: boundedPercent(row.aguaL, maxAgua),
      electricidadPct: boundedPercent(row.electricidadKwh, maxElectricidad),
      gasoilPct: boundedPercent(row.gasoilL, maxGasoil),
    }));
  }, [selectedRows]);

  const issueRows = useMemo(() => rows.filter((row) => row.issues.length > 0), [rows]);

  const loading = loadingMaquinas || consumosFisicos.isLoading;
  const exportLoading = loadingMaquinas || loadingSesiones || loadingConsumosMaquinas || consumosFisicos.isLoading;
  const exportDisabled = exportLoading || selectedRows.length === 0;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1 className="page-title">Consumos físicos</h1>
          <p className="page-subtitle">Agua · Electricidad · Gasoil · Químicos por kg de naranja · {selectedCampana.label}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={campanaId} onValueChange={setCampanaId}>
            <SelectTrigger className="glass glass-hover h-9 w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {campanasConsumo.map((campana) => (
                <SelectItem key={campana.id} value={campana.id}>{campana.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={activePeriodoVista}
            onValueChange={(value) => setPeriodoVista(value as ConsumoPeriodoVista)}
            disabled={!isCurrentCampaign}
          >
            <SelectTrigger className="glass glass-hover h-9 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isCurrentCampaign && <SelectItem value="semanal">Semanal</SelectItem>}
              <SelectItem value="mensual">Mensual</SelectItem>
              {isCurrentCampaign && <SelectItem value="diario">Diario</SelectItem>}
            </SelectContent>
          </Select>
          {isCurrentCampaign && activePeriodoVista === "semanal" && (
            <Select value={periodBlockId} onValueChange={setPeriodBlockId}>
              <SelectTrigger className="glass glass-hover h-9 w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weeklyBlocks.map((block) => (
                  <SelectItem key={block.id} value={block.id}>
                    {block.label}
                  </SelectItem>
                ))}
                <SelectItem value="all">Toda la campana</SelectItem>
              </SelectContent>
            </Select>
          )}
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
          <TabsList className="grid w-full grid-cols-2 md:w-auto md:grid-cols-6">
            <TabsTrigger value="resumen"><BarChart3 className="h-4 w-4 mr-1.5" />Resumen</TabsTrigger>
            <TabsTrigger value="registrar"><Save className="h-4 w-4 mr-1.5" />Registrar</TabsTrigger>
            <TabsTrigger value="importar"><Upload className="h-4 w-4 mr-1.5" />Importar</TabsTrigger>
            <TabsTrigger value="historico"><History className="h-4 w-4 mr-1.5" />Historico</TabsTrigger>
            <TabsTrigger value="validacion"><FileText className="h-4 w-4 mr-1.5" />Validacion</TabsTrigger>
            <TabsTrigger value="maquinas"><Settings className="h-4 w-4 mr-1.5" />Maquinas</TabsTrigger>
          </TabsList>
          </div>

          {/* REGISTRAR */}
          <TabsContent value="registrar" className="space-y-6">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Agua diaria</p>
                <CardTitle>Registrar lectura diaria de agua</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-4">
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha</Label>
                  <ConsumoDatePicker value={aguaDiariaFecha} onChange={setAguaDiariaFecha} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gasto agua contador general (Litros)</Label>
                  <Input inputMode="decimal" value={aguaContadorGeneral} onChange={(e) => setAguaContadorGeneral(e.target.value)} placeholder="0" />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Consumo agua linea tratamiento (Litros)</Label>
                  <Input inputMode="decimal" value={aguaLineaTratamiento} onChange={(e) => setAguaLineaTratamiento(e.target.value)} placeholder="0" />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Consumo agua drencher (Litros)</Label>
                  <Input inputMode="decimal" value={aguaDrencher} onChange={(e) => setAguaDrencher(e.target.value)} placeholder="0" />
                </div>
                <div className="md:col-span-4 flex justify-end">
                  <Button onClick={guardarLecturaAguaDiaria} disabled={consumosFisicos.addConsumo.isPending} className="glass glass-hover px-8">
                    <Save className="h-4 w-4 mr-2" /> Guardar lectura
                  </Button>
                </div>
              </CardContent>
            </Card>

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
                  <Input inputMode="decimal" value={cfCantidad} onChange={(e) => setCfCantidad(e.target.value)} placeholder="0" />
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
          <TabsContent value="importar" className="space-y-6">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Facturas</p>
                <CardTitle>Importar consumos fisicos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div className="glass p-4 space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Archivos Excel</Label>
                    <Input
                      type="file"
                      accept=".xls,.xlsx"
                      multiple
                      onChange={analizarFacturas}
                      disabled={facturaImportLoading || facturaImportSaving}
                    />
                  </div>
                  <Button
                    onClick={guardarFacturasImportadas}
                    disabled={facturaImportLoading || facturaImportSaving || facturaNewRows.length === 0}
                    className="glass glass-hover h-10 px-6"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Guardar nuevos ({facturaNewRows.length})
                  </Button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="glass p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Archivos</p>
                    <p className="mt-2 text-2xl font-bold">{formatNumber(facturaImportResults.length)}</p>
                  </div>
                  <div className="glass p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-success">Nuevos</p>
                    <p className="mt-2 text-2xl font-bold">{formatNumber(facturaNewRows.length)}</p>
                  </div>
                  <div className="glass p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-warning">Duplicados</p>
                    <p className="mt-2 text-2xl font-bold">{formatNumber(facturaRowsWithConsumo.length - facturaNewRows.length)}</p>
                  </div>
                  <div className="glass p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-destructive">Omitidas</p>
                    <p className="mt-2 text-2xl font-bold">{formatNumber(facturaSkippedRows.length)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">{selectedCampana.label}</p>
                <CardTitle>Facturas integradas</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="glass p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">Agua</p>
                  <p className="mt-2 text-2xl font-bold">{formatNumber(facturasIntegradasResumen.aguaM3 * 1000)} <span className="text-sm font-normal text-muted-foreground">L</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{facturasIntegradasResumen.aguaFacturas} facturas fisicas ({formatNumber(facturasIntegradasResumen.aguaM3)} m3)</p>
                </div>
                <div className="glass p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">Kg vendidos</p>
                  <p className="mt-2 text-2xl font-bold">{formatNumber(facturasIntegradasResumen.ventasKg)} <span className="text-sm font-normal text-muted-foreground">kg</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{facturasIntegradasResumen.ventasMeses} meses netos desde {facturasIntegradasResumen.ventasFuente}</p>
                </div>
                <div className="glass p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">Electricidad</p>
                  <p className="mt-2 text-2xl font-bold">{formatNumber(facturasIntegradasResumen.electricidadKwh)} <span className="text-sm font-normal text-muted-foreground">kWh</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{facturasIntegradasResumen.electricidadFacturas} facturas fisicas de Endesa</p>
                </div>
                <div className="glass p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">Gasoil</p>
                  <p className="mt-2 text-2xl font-bold">{formatNumber(facturasIntegradasResumen.gasoilL)} <span className="text-sm font-normal text-muted-foreground">L</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{facturasIntegradasResumen.gasoilLineas} lineas fisicas de {facturasIntegradasResumen.gasoilFuente}</p>
                </div>
              </CardContent>
            </Card>

            {facturaRows.length === 0 ? (
              <Card className="glass-accented">
                <CardContent className="p-12 text-center">
                  <FileSpreadsheet className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No hay facturas analizadas.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-accented">
                <CardHeader>
                  <p className="panel-kicker">Revision</p>
                  <CardTitle>Vista previa ({facturaRows.length} filas)</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Estado</TableHead>
                        <TableHead>Archivo</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Recurso</TableHead>
                        <TableHead>Referencia</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead>Detalle</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {facturaRows.map((row) => {
                        const duplicate = facturaDuplicateIds.has(row.id);
                        const statusLabel = row.status === "skipped" ? "Omitido" : duplicate ? "Duplicado" : "Nuevo";
                        const statusClass = row.status === "skipped"
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : duplicate
                            ? "border-warning/30 bg-warning/10 text-warning"
                            : "border-success/30 bg-success/10 text-success";
                        const cantidad = row.consumo
                          ? `${formatNumber(row.consumo.cantidad, row.consumo.cantidad % 1 === 0 ? 0 : 2)} ${UNIDAD_LABEL[row.consumo.unidad]}`
                          : "-";
                        const detalle = duplicate
                          ? "Ya existe con la misma fecha, cantidad y referencia."
                          : row.reason ?? row.consumo?.notas ?? "";

                        return (
                          <TableRow key={row.id}>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs ${statusClass}`}>
                                {statusLabel}
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.fileName}</TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums">{row.fecha ? formatDate(row.fecha) : "-"}</TableCell>
                            <TableCell className="capitalize">{row.recurso ?? "-"}</TableCell>
                            <TableCell className="whitespace-nowrap">{row.consumo?.referencia ?? row.concepto}</TableCell>
                            <TableCell className="text-right tabular-nums">{cantidad}</TableCell>
                            <TableCell className="min-w-[280px] text-xs text-muted-foreground">
                              <div className="flex items-start gap-2">
                                {row.status === "skipped" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
                                <span>{detalle}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
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
                <section className="grid gap-4 xl:grid-cols-12">
                  <Card className="glass-accented overflow-hidden xl:col-span-8">
                    <CardContent className="p-0">
                      <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
                        <div className="p-5 sm:p-6">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
                              {selectedCampana.label}
                            </Badge>
                            <Badge variant="outline" className={issueRows.length === 0 ? CONFIDENCE_CLASS.real : CONFIDENCE_CLASS.mixto}>
                              {issueRows.length === 0 ? "Sin incidencias" : `${issueRows.length} ${periodDetailLabel} a revisar`}
                            </Badge>
                            <Badge variant="outline" className="border-info/25 bg-info/10 text-info">
                              Vista {selectedPeriodLabel.toLowerCase()}
                            </Badge>
                            <Badge variant="outline" className="border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-muted-foreground">
                              {visibleRangeLabel}
                            </Badge>
                          </div>
                          <div className="mt-5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kg base de la campana</p>
                            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
                              {formatNumber(totalKg)} <span className="text-lg font-medium text-muted-foreground">kg</span>
                            </p>
                            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                              Partes: {formatNumber(totalKgPartes)} kg · Palets: {formatNumber(totalKgPalets)} kg · Ventas: {formatNumber(totalKgVentas)} kg · Manual: {formatNumber(totalKgManual)} kg
                            </p>
                          </div>
                          <div className="mt-6 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cobertura</p>
                              <p className="mt-1 text-xl font-semibold tabular-nums">{monthsWithData}/{monthsInRange} {periodDetailLabel}</p>
                              <div className="mt-3 h-1.5 rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary" style={{ width: percentCss(monthsCoveragePct) }} />
                              </div>
                            </div>
                            <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Periodo mas intenso</p>
                              <p className="mt-1 text-xl font-semibold tabular-nums">{topConsumptionMonth.periodo}</p>
                              <p className="mt-1 text-xs text-muted-foreground">Por suma de consumos fisicos</p>
                            </div>
                            <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fuentes activas</p>
                              <p className="mt-1 text-xl font-semibold tabular-nums">{resourceCards.filter((resource) => resource.total > 0).length}/4</p>
                              <p className="mt-1 text-xs text-muted-foreground">Agua, luz, gasoil y quimicos</p>
                            </div>
                          </div>
                          {isCurrentCampaign && activePeriodoVista === "semanal" && (
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Semana actual</p>
                                <p className="mt-1 text-lg font-semibold tabular-nums">{currentPeriodRow?.periodo ?? "Sin semana"}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {currentPeriodRow ? `${formatDate(currentPeriodRow.fechaInicio)} - ${formatDate(currentPeriodRow.fechaFin)}` : "No hay rango activo"}
                                </p>
                              </div>
                              <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] p-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Semana anterior</p>
                                <p className="mt-1 text-lg font-semibold tabular-nums">{previousPeriodRow?.periodo ?? "Sin semana"}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {previousPeriodRow ? `${formatDate(previousPeriodRow.fechaInicio)} - ${formatDate(previousPeriodRow.fechaFin)}` : "No hay rango previo"}
                                </p>
                              </div>
                            </div>
                          )}
                          {isCurrentCampaign && activePeriodoVista === "semanal" && activeWeeklyBlock && periodBlockId !== "all" && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Bloque visible: {activeWeeklyBlock.detail}. Cambia el selector superior para revisar semanas anteriores.
                            </p>
                          )}
                        </div>
                        <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg-strong)] p-5 sm:p-6 lg:border-l lg:border-t-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Intensidad acumulada</p>
                          <div className="mt-4 space-y-4">
                            {[
                              { label: "Agua", value: ratioText(resumenRatios.aguaLKg, 2, "L/kg"), color: "bg-info" },
                              { label: "Electricidad", value: ratioText(resumenRatios.electricidadKwhKg, 3, "kWh/kg"), color: "bg-warning" },
                              { label: "Gasoil", value: ratioText(resumenRatios.gasoilMlKg, 1, "mL/kg"), color: "bg-primary" },
                              { label: "Quimicos", value: ratioText(resumenRatios.quimicosMlKg, 1, "mL/kg"), color: "bg-destructive" },
                            ].map((item) => (
                              <div key={item.label} className="flex items-center justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
                                  <span className="truncate text-sm font-medium text-muted-foreground">{item.label}</span>
                                </div>
                                <span className="text-sm font-semibold tabular-nums">{item.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="glass-accented overflow-hidden xl:col-span-4">
                    <CardHeader className="pb-3">
                      <p className="panel-kicker">Lectura rapida</p>
                      <CardTitle>Estado del periodo</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {resourceCards.map((resource) => {
                        const Icon = resource.icon;
                        const coveragePct = monthsWithData > 0 ? (resource.coverage / monthsWithData) * 100 : 0;
                        return (
                          <div key={resource.id} className={`rounded-lg border p-3 ${resource.softClass}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <Icon className={`h-4 w-4 shrink-0 ${resource.textClass}`} />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold">{resource.label}</p>
                                  <p className="text-xs text-muted-foreground">{resource.coverage} {periodDetailLabel} con dato</p>
                                </div>
                              </div>
                              <p className="text-right text-sm font-semibold tabular-nums">{resource.ratio}</p>
                            </div>
                            <div className="mt-3 h-1.5 rounded-full bg-background/60">
                              <div className="h-full rounded-full" style={{ width: percentCss(coveragePct), backgroundColor: resource.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                </section>

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {resourceCards.map((resource) => {
                    const Icon = resource.icon;
                    return (
                      <div key={resource.id} className="glass-accented rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className={`text-xs font-semibold uppercase tracking-wider ${resource.textClass}`}>{resource.label}</p>
                            <p className="mt-2 text-2xl font-semibold tabular-nums">
                              {formatNumber(resource.total, resource.total % 1 === 0 ? 0 : 1)} <span className="text-sm font-medium text-muted-foreground">{resource.unit}</span>
                            </p>
                          </div>
                          <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${resource.softClass}`}>
                            <Icon className={`h-5 w-5 ${resource.textClass}`} />
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">Ratio</span>
                            <span className="font-semibold tabular-nums">{resource.ratio}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">Pico del periodo</span>
                            <span className="font-semibold tabular-nums">{resource.peak.periodo}</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-full rounded-full"
                              style={{ width: percentCss(boundedPercent(resource.peak.value, resource.max)), backgroundColor: resource.color }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>

                {monthlyEvolution.length > 1 && (
                  <section className="grid gap-4 xl:grid-cols-2">
                    <Card className="glass-accented">
                      <CardHeader className="pb-3 px-5 pt-4">
                        <div className="flex items-center gap-3">
                          <div className="h-7 w-1 rounded-full bg-primary" />
                          <div>
                            <CardTitle className="text-lg font-semibold">Intensidad {selectedPeriodLabel.toLowerCase()}</CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">Consumo fisico por kg vendido o producido</p>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 pt-1">
                        <div className={CHART_PANEL_CLASS}>
                          <ResponsiveContainer width="100%" height={320}>
                            <LineChart data={monthlyEvolution} margin={MARGIN}>
                              <CartesianGrid {...GRID} />
                              <XAxis dataKey="etiqueta" {...XAXIS} />
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

                    <Card className="glass-accented">
                      <CardHeader className="pb-3 px-5 pt-4">
                        <div className="flex items-center gap-3">
                          <div className="h-7 w-1 rounded-full bg-info" />
                          <div>
                            <CardTitle className="text-lg font-semibold">Volumen {selectedPeriodLabel.toLowerCase()}</CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">Lectura absoluta de agua, electricidad y gasoil</p>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 pt-1">
                        <div className={CHART_PANEL_CLASS}>
                          <ResponsiveContainer width="100%" height={320}>
                            <BarChart data={monthlyVolumeChart} margin={MARGIN}>
                              <CartesianGrid {...GRID} />
                              <XAxis dataKey="etiqueta" {...XAXIS} />
                              <YAxis {...YAXIS} />
                              <Tooltip
                                cursor={{ fill: "var(--glass-bg-strong)" }}
                                content={(
                                  <GlassTooltip
                                    formatter={(value, name) => {
                                      const numericValue = typeof value === "number" ? value : Number(value);
                                      const unit = String(name).toLowerCase().includes("electricidad") ? "kWh" : "L";
                                      return `${formatNumber(Number.isFinite(numericValue) ? numericValue : 0, unit === "kWh" ? 1 : 0)} ${unit}`;
                                    }}
                                  />
                                )}
                              />
                              <Legend wrapperStyle={legendStyle} />
                              <Bar dataKey="agua" name="Agua" fill={C.info} radius={[5, 5, 0, 0]} />
                              <Bar dataKey="electricidad" name="Electricidad" fill={C.warning} radius={[5, 5, 0, 0]} />
                              <Bar dataKey="gasoil" name="Gasoil" fill={C.primary} radius={[5, 5, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                )}

                <Card className="glass-accented overflow-hidden">
                  <CardHeader>
                    <p className="panel-kicker">Detalle {selectedPeriodLabel.toLowerCase()}</p>
                    <CardTitle>Consumos y ratios por {activePeriodoVista === "diario" ? "dia" : activePeriodoVista === "semanal" ? "semana" : "mes"}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Mes</TableHead>
                            <TableHead>Confianza</TableHead>
                            <TableHead className="min-w-[160px]">Kg base</TableHead>
                            <TableHead className="min-w-[160px]">Agua</TableHead>
                            <TableHead className="min-w-[170px]">Electricidad</TableHead>
                            <TableHead className="min-w-[160px]">Gasoil</TableHead>
                            <TableHead className="text-right">Ratio agua</TableHead>
                            <TableHead className="text-right">Ratio luz</TableHead>
                            <TableHead className="text-right">Ratio gasoil</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {monthlyDetailRows.map((row) => (
                            <TableRow key={row.periodo}>
                              <TableCell className="whitespace-nowrap font-medium">{row.label}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={`text-xs ${CONFIDENCE_CLASS[row.confianza]}`}>
                                  {CONFIDENCE_LABEL[row.confianza]}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  <div className="flex justify-between gap-3 text-xs tabular-nums">
                                    <span>{formatNumber(row.kgBase)}</span>
                                    <span className="text-muted-foreground">kg</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-success" style={{ width: percentCss(row.kgPct) }} />
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  <div className="flex justify-between gap-3 text-xs tabular-nums">
                                    <span>{formatNumber(row.aguaL)}</span>
                                    <span className="text-muted-foreground">L</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-info" style={{ width: percentCss(row.aguaPct) }} />
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  <div className="flex justify-between gap-3 text-xs tabular-nums">
                                    <span>{formatNumber(row.electricidadKwh, 1)}</span>
                                    <span className="text-muted-foreground">kWh</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-warning" style={{ width: percentCss(row.electricidadPct) }} />
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  <div className="flex justify-between gap-3 text-xs tabular-nums">
                                    <span>{formatNumber(row.gasoilL, 1)}</span>
                                    <span className="text-muted-foreground">L</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-primary" style={{ width: percentCss(row.gasoilPct) }} />
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{ratioText(row.aguaLKg, 2, "L/kg")}</TableCell>
                              <TableCell className="text-right tabular-nums">{ratioText(row.electricidadKwhKg, 3, "kWh/kg")}</TableCell>
                              <TableCell className="text-right tabular-nums">{ratioText(row.gasoilMlKg, 1, "mL/kg")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ════════ VALIDACION ════════ */}
          <TabsContent value="validacion" className="space-y-6">
            {issueRows.length === 0 ? (
              <Card className="glass-accented">
                <CardContent className="p-12 text-center">
                  <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No hay incidencias de validacion en los periodos calculados.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-accented">
                <CardHeader>
                  <p className="panel-kicker">Validacion de consumos</p>
                  <CardTitle>Periodos con incidencias ({issueRows.length})</CardTitle>
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
                  <p className="text-sm text-muted-foreground">No hay periodos de consumo calculados.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-accented">
                <CardHeader>
                  <p className="panel-kicker">{selectedPeriodLabel}</p>
                  <CardTitle>Historico fisico ({rows.length} {periodDetailLabel})</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periodo</TableHead>
                        <TableHead>Confianza</TableHead>
                        <TableHead className="text-right">Kg partes</TableHead>
                        <TableHead className="text-right">Kg palets</TableHead>
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
                          <TableCell className="text-right tabular-nums">{formatNumber(row.kgPalets)}</TableCell>
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
