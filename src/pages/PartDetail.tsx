import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthProvider";
import { PARTES_QUERY_KEY, type Parte as CachedParte } from "@/hooks/usePartes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { KPICard } from "@/components/KPICard";
import { FichaStrip } from "@/components/FichaStrip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { SemaforoPill } from "@/components/SemaforoPill";
import { CascadeView } from "@/components/CascadeView";
import { computeCascade } from "@/lib/cascade";
import { formatDate, formatKg } from "@/lib/format";
import { getSemaforo } from "@/lib/semaforo";
import { detectarTipoClasificacion, GRUPO_COLORS } from "@/lib/destinoClasificacion";
import { calcularTphOperativa, horasOperativasDia } from "@/lib/velocidadOperativa";
import {
  calcularRendimientoGrupos, calcularResumenKgPersonaOperacion, RENDIMIENTO_GRUPOS,
} from "@/lib/asistenciaRendimiento";
import { calcularRendimientoZonasAlmacen } from "@/lib/asistenciaPlantilla";
import {
  attachmentCountMap, calidadSummary, buildCalidadIncidentRows,
  type CalidadAdjunto, type CalidadEstado, type CalidadLote,
} from "@/lib/calidad";
import { cn } from "@/lib/utils";
import { PART_DETAIL_MANUAL_FIELDS } from "@/lib/partDetailManualFields";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft, Save, Lock, Unlock, Sparkles, Loader2, BarChart3, MoreHorizontal,
  ChevronDown, Truck, Package, TrendingDown, Gauge, Timer, ClipboardCheck,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportPartesDialog } from "@/components/ExportPartesDialog";
import { CalidadInformeDialog } from "@/components/CalidadInformeDialog";
import PartDetailArchivos from "@/components/PartDetailArchivos";
import PartDetailCalidad from "@/components/PartDetailCalidad";
import PartDetailManual from "@/components/PartDetailManual";
import PartDetailLotes from "@/components/PartDetailLotes";
import PartDetailDestino from "@/components/PartDetailDestino";
import PartDetailZonas from "@/components/PartDetailZonas";

interface Parte {
  id: string;
  date: string;
  estado: string;
  kg_industria_manual: number;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  kg_inventario_sin_alta: number;
  kg_podrido_bolsa_basura: number;
  kg_produccion_calibrador: number;
  kg_mujeres_calibrador: number;
  kg_palets_brutos: number;
  kg_palets_egipto: number;
  kg_palets_campo: number;
  kg_podrido_calibrador_auto: number;
  kg_inventario_anterior_sin_alta: number;
  notas_generales: string | null;
  notas_inventario: string | null;
}

// Mismo nombre que usa Asistencia para esta zona (internamente es "Envasadoras").
const RENDIMIENTO_LABELS: Record<string, string> = {
  Envasadoras: "Mesas", Industria: "Industria", Mallas: "Mallas", Graneleras: "Graneleras",
};

// Mismos colores que PartDetailCalidad/Productores para el badge de calidad.
const QUALITY_STYLE: Record<CalidadEstado, string> = {
  Excelente: "border-emerald-600/35 bg-emerald-600/12 text-emerald-800 dark:text-emerald-200",
  Bueno: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  Regular: "border-amber-500/35 bg-amber-500/14 text-amber-700 dark:text-amber-300",
  Deficiente: "border-orange-500/35 bg-orange-500/14 text-orange-700 dark:text-orange-300",
  Pésimo: "border-red-500/35 bg-red-500/12 text-red-700 dark:text-red-300",
};

const CATEGORIES = [
  { id: "GSTOCK", label: "GSTOCK" },
  { id: "Produccion", label: "Producción" },
  { id: "InformeLote", label: "Informes por lote" },
  { id: "Otro", label: "Otro" },
] as const;
type CategoryId = typeof CATEGORIES[number]["id"];

interface Archivo {
  id: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  uploaded_at: string;
}

type ParteUpdatePayload = TablesUpdate<"partes_diarios">;

function normalizeParte(raw: Partial<CachedParte> & { id: string; date: string; estado: string }): Parte {
  return {
    id: raw.id,
    date: raw.date,
    estado: raw.estado,
    kg_industria_manual: Number(raw.kg_industria_manual) || 0,
    kg_reciclado_malla_z1: Number(raw.kg_reciclado_malla_z1) || 0,
    kg_reciclado_malla_z2: Number(raw.kg_reciclado_malla_z2) || 0,
    kg_inventario_sin_alta: Number(raw.kg_inventario_sin_alta) || 0,
    kg_podrido_bolsa_basura: Number(raw.kg_podrido_bolsa_basura) || 0,
    kg_produccion_calibrador: Number(raw.kg_produccion_calibrador) || 0,
    kg_mujeres_calibrador: Number(raw.kg_mujeres_calibrador) || 0,
    kg_palets_brutos: Number(raw.kg_palets_brutos) || 0,
    kg_palets_egipto: Number(raw.kg_palets_egipto) || 0,
    kg_palets_campo: Number(raw.kg_palets_campo) || 0,
    kg_podrido_calibrador_auto: Number(raw.kg_podrido_calibrador_auto) || 0,
    kg_inventario_anterior_sin_alta: Number(raw.kg_inventario_anterior_sin_alta) || 0,
    notas_generales: raw.notas_generales ?? null,
    notas_inventario: raw.notas_inventario ?? null,
  };
}

export default function PartDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cachedParte = id
    ? queryClient.getQueryData<CachedParte[]>(PARTES_QUERY_KEY)?.find((p) => p.id === id)
    : null;
  const [parte, setParte] = useState<Parte | null>(() => (cachedParte ? normalizeParte(cachedParte) : null));
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadingCat, setUploadingCat] = useState<CategoryId | null>(null);
  const [activeTab, setActiveTab] = useState("archivos");
  const [calidadPreview, setCalidadPreview] = useState<CalidadLote | null>(null);
  const [calidadPreviewOpen, setCalidadPreviewOpen] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nextCachedParte = id
      ? queryClient.getQueryData<CachedParte[]>(PARTES_QUERY_KEY)?.find((p) => p.id === id)
      : null;
    setParte(nextCachedParte ? normalizeParte(nextCachedParte) : null);
    setArchivos([]);
  }, [id, queryClient]);

    const load = useCallback(async () => {
    if (!id) return;
    try {
      const [{ data: p, error }, { data: files }] = await Promise.all([
        supabase.from("partes_diarios").select("*").eq("id", id).maybeSingle(),
        supabase.from("partes_archivos").select("*").eq("part_id", id).order("uploaded_at", { ascending: false }),
      ]);
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }
      if (!p) {
        toast({ title: "Error", description: "Parte no encontrada", variant: "destructive" });
        navigate("/partes");
        return;
      }

      const { data: prev } = await supabase
        .from("partes_diarios")
        .select("kg_inventario_sin_alta, date")
        .eq("user_id", p.user_id)
        .lt("date", p.date)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prev) {
        const prevInv = Number(prev.kg_inventario_sin_alta) || 0;
        if (prevInv !== Number(p.kg_inventario_anterior_sin_alta)) {
          await supabase.from("partes_diarios")
            .update({ kg_inventario_anterior_sin_alta: prevInv })
            .eq("id", id);
          p.kg_inventario_anterior_sin_alta = prevInv;
        }
      }

      setParte(normalizeParte(p));
      setArchivos((files ?? []) as Archivo[]);
      void queryClient.invalidateQueries({ queryKey: PARTES_QUERY_KEY });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }, [id, navigate, queryClient]);

  useEffect(() => { load(); }, [load]);

  const cascade = useMemo(() => {
    if (!parte) return null;
    const paletsCascada = Number(parte.kg_palets_brutos) - Number(parte.kg_palets_egipto);
    const base = computeCascade({
      kg_produccion_calibrador: Number(parte.kg_produccion_calibrador),
      kg_mujeres_calibrador: Number(parte.kg_mujeres_calibrador),
      kg_palets_brutos: paletsCascada,
      kg_podrido_calibrador: Number(parte.kg_podrido_calibrador_auto),
      kg_industria_manual: Number(parte.kg_industria_manual),
      kg_reciclado_malla_z1: Number(parte.kg_reciclado_malla_z1),
      kg_reciclado_malla_z2: Number(parte.kg_reciclado_malla_z2),
      kg_inventario_sin_alta: Number(parte.kg_inventario_sin_alta),
      kg_podrido_bolsa_basura: Number(parte.kg_podrido_bolsa_basura),
      kg_inventario_anterior_sin_alta: Number(parte.kg_inventario_anterior_sin_alta),
    });
    // T/h operativo de este parte: kg de producción real entre las horas de
    // jornada del día (8 h hasta 1 jul 2026, 7 h después).
    return { ...base, tph_promedio: calcularTphOperativa(base.produccion_real, parte.date) };
  }, [parte]);

  // Las secciones de lectura del parte muestran datos que se escriben FUERA
  // de esta página (la edge function al analizar, Asistencia, Calidad). Por
  // eso todas cuelgan de la clave raíz ["parte-detail", id] — una sola
  // invalidación las refresca todas — y refetchean al montar, saltándose el
  // staleTime global de 5 min que las dejaría vacías tras analizar.
  const detailQueryDefaults = { refetchOnMount: "always" as const };

  // Destino de fruta + calibre/categoría dominantes: mismos datos y
  // clasificación que el donut del Dashboard, filtrados a este parte. Solo
  // hay datos si el parte ya se analizó con IA (Informe de tamaños).
  const { data: calibresResumen, isLoading: calibresResumenLoading } = useQuery({
    ...detailQueryDefaults,
    queryKey: ["parte-detail", parte?.id, "calibres"],
    enabled: Boolean(parte?.id),
    queryFn: async () => {
      const { data: calibres } = await supabase
        .from("calibres_dia")
        .select("calibre, clase, grupo_destino, kg")
        .eq("part_id", parte!.id)
        .limit(100000);

      if (!calibres || calibres.length === 0) return null;

      const destinoMap = new Map<string, number>();
      const calibreMap = new Map<string, number>();
      const claseMap = new Map<string, number>();
      let totalKg = 0;
      for (const c of calibres) {
        const kg = Number(c.kg) || 0;
        totalKg += kg;
        destinoMap.set(detectarTipoClasificacion(c.grupo_destino), (destinoMap.get(detectarTipoClasificacion(c.grupo_destino)) ?? 0) + kg);
        const calibre = c.calibre?.trim() || "Sin calibre";
        calibreMap.set(calibre, (calibreMap.get(calibre) ?? 0) + kg);
        const clase = c.clase?.trim() || "Sin categoría";
        claseMap.set(clase, (claseMap.get(clase) ?? 0) + kg);
      }

      const destino = Array.from(destinoMap.entries())
        .map(([grupo, kg]) => ({ grupo, kg, color: GRUPO_COLORS[grupo] ?? GRUPO_COLORS["Otro"] }))
        .filter((g) => g.kg > 0)
        .sort((a, b) => b.kg - a.kg);

      const top = (map: Map<string, number>) => {
        let best: [string, number] | null = null;
        for (const entry of map) if (!best || entry[1] > best[1]) best = entry;
        return best ? { label: best[0], pct: totalKg > 0 ? (best[1] / totalKg) * 100 : 0 } : null;
      };

      return { destino, calibreDominante: top(calibreMap), categoriaTop: top(claseMap) };
    },
  });
  const destinoFruta = calibresResumen?.destino;
  const destinoFrutaLoading = calibresResumenLoading;

  // Lotes del día: trazabilidad + velocidad del calibrador. Solo hay datos
  // si el parte ya se analizó con IA.
  const { data: lotesDelDia, isLoading: lotesLoading } = useQuery({
    ...detailQueryDefaults,
    queryKey: ["parte-detail", parte?.id, "lotes"],
    enabled: Boolean(parte?.id),
    queryFn: async () => {
      const { data } = await supabase
        .from("lotes_dia")
        .select("id, lote_codigo, productor, producto, kg_peso_total, toneladas_hora, duracion_min, kg_industria, notas")
        .eq("part_id", parte!.id)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  async function saveLoteUpdate(loteId: string, patch: { notas?: string | null; kg_industria?: number }) {
    const { error } = await supabase.from("lotes_dia").update(patch).eq("id", loteId);
    if (error) {
      toast({ title: "Error guardando el lote", description: error.message, variant: "destructive" });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["parte-detail", parte?.id, "lotes"] });
  }

  // Velocidad del calibrador: media de T/h por lote ponderada por duración
  // (mismo cálculo que usa Productores) — distinta de la velocidad del día,
  // que reparte la producción entre las 8h trabajadas.
  const tphCalibrador = useMemo(() => {
    const lotesConTph = (lotesDelDia ?? []).filter((l) => l.toneladas_hora && Number(l.toneladas_hora) > 0);
    if (lotesConTph.length === 0) return null;
    const totalMin = lotesConTph.reduce((s, l) => s + (Number(l.duracion_min) || 0), 0);
    return totalMin > 0
      ? lotesConTph.reduce((s, l) => s + Number(l.toneladas_hora) * (Number(l.duracion_min) || 1), 0) / totalMin
      : lotesConTph.reduce((s, l) => s + Number(l.toneladas_hora), 0) / lotesConTph.length;
  }, [lotesDelDia]);

  // Producto empacado del día (Informe_producto) — para repartir kg por zona.
  const { data: productoDelDia } = useQuery({
    ...detailQueryDefaults,
    queryKey: ["parte-detail", parte?.id, "producto"],
    enabled: Boolean(parte?.id),
    queryFn: async () => {
      const { data } = await supabase
        .from("producto_dia")
        .select("linea, producto, formato_caja, kg, grupo_destino")
        .eq("part_id", parte!.id);
      return data ?? [];
    },
  });

  // Trabajadores activos + asistencia de este día — para el rendimiento por
  // zonas (mismo motor que usa Asistencia).
  const { data: trabajadoresList } = useQuery({
    queryKey: ["trabajadores-activos"],
    queryFn: async () => {
      const { data } = await supabase.from("trabajadores").select("id, zona, activo").eq("activo", true);
      return data ?? [];
    },
  });

  const { data: asistenciaDelDia } = useQuery({
    ...detailQueryDefaults,
    queryKey: ["parte-detail", parte?.id, "asistencia", parte?.date],
    enabled: Boolean(parte?.date),
    queryFn: async () => {
      const { data } = await supabase
        .from("asistencia_detalle")
        .select("trabajador_id, presente")
        .eq("date", parte!.date);
      return data ?? [];
    },
  });

  const rendimientoZonas = useMemo(() => {
    if (!parte || !cascade || !trabajadoresList || !asistenciaDelDia) return null;
    const asistenciaMap: Record<string, boolean> = {};
    for (const a of asistenciaDelDia) {
      if (a.trabajador_id) asistenciaMap[a.trabajador_id] = a.presente === true;
    }
    const parteParaRendimiento = {
      kg_produccion_calibrador: parte.kg_produccion_calibrador,
      kg_mujeres_calibrador: parte.kg_mujeres_calibrador,
      kg_reciclado_malla_z1: parte.kg_reciclado_malla_z1,
      kg_reciclado_malla_z2: parte.kg_reciclado_malla_z2,
      producto_dia: productoDelDia ?? [],
    };
    // Kg por zona (a partir del informe de producto).
    const grupos = calcularRendimientoGrupos({
      parte: parteParaRendimiento,
      trabajadores: trabajadoresList,
      asistencia: asistenciaMap,
    });
    const resumen = calcularResumenKgPersonaOperacion({
      trabajadores: trabajadoresList,
      asistencia: asistenciaMap,
      kgProduccionDia: cascade.produccion_real,
    });
    // Dotación real de cada zona: suma la plantilla de "arranque de línea"
    // (15 personas que arrancan la línea general: encargadas, tría de podrido,
    // aéreo, carretilleros, transpaletas, producción, mantenimiento) a cada
    // zona productiva, igual que hace Asistencia — si no, cada zona parece
    // tener menos personas de las que realmente cubre el turno.
    const zonasAlmacen = calcularRendimientoZonasAlmacen({
      trabajadores: trabajadoresList,
      asistencia: asistenciaMap,
      kgPorZona: {
        mallas: grupos.Mallas.kg,
        granelRp: grupos.Graneleras.kg,
        mesas: grupos.Envasadoras.kg,
        industria: grupos.Industria.kg,
      },
    });
    const zonaById = new Map(zonasAlmacen.zonas.map((z) => [z.id, z]));
    const zonaByGrupo: Record<string, (typeof zonasAlmacen.zonas)[number] | undefined> = {
      Envasadoras: zonaById.get("mesas"),
      Industria: zonaById.get("industria"),
      Mallas: zonaById.get("mallas"),
      Graneleras: zonaById.get("granelRp"),
    };
    const totalKg = RENDIMIENTO_GRUPOS.reduce((s, g) => s + grupos[g].kg, 0);
    const zonas = RENDIMIENTO_GRUPOS.map((g) => {
      const zona = zonaByGrupo[g];
      const kg = grupos[g].kg;
      return {
        grupo: g,
        label: RENDIMIENTO_LABELS[g] ?? g,
        kg,
        porcentajeKg: totalKg > 0 ? (kg / totalKg) * 100 : 0,
        personas: zona?.presentes ?? grupos[g].personas,
        objetivo: zona?.objetivo ?? null,
        kgPersona: zona?.kgPersonaPresentes ?? (grupos[g].personas > 0 ? kg / grupos[g].personas : 0),
      };
    });
    return {
      zonas,
      kgPersonaGeneral: resumen.kgPersona,
      presentesComputables: resumen.presentesComputables,
      sinZona: zonasAlmacen.sinZona,
    };
  }, [parte, cascade, trabajadoresList, asistenciaDelDia, productoDelDia]);

  // Resumen de calidad del día (detalle completo en la pestaña Calidad).
  const { data: calidadDelDia } = useQuery({
    ...detailQueryDefaults,
    queryKey: ["parte-detail", parte?.id, "calidad", parte?.date],
    enabled: Boolean(parte?.date),
    queryFn: async () => {
      const { data } = await supabase.from("calidad_lotes").select("*").eq("fecha", parte!.date).order("created_at", { ascending: true });
      return (data ?? []) as CalidadLote[];
    },
  });
  const calidadResumen = calidadDelDia ? calidadSummary(calidadDelDia) : null;
  const calidadIncidencias = calidadDelDia ? buildCalidadIncidentRows(calidadDelDia).length : 0;

  // Nº de adjuntos por lote, para el preview clicable de "Calidad del día".
  const { data: calidadAdjuntosDelDia } = useQuery({
    ...detailQueryDefaults,
    queryKey: ["parte-detail", parte?.id, "calidad-adjuntos", parte?.date],
    enabled: Boolean(calidadDelDia && calidadDelDia.length > 0),
    queryFn: async () => {
      const { data } = await supabase.from("calidad_adjuntos").select("*").in("lote_id", (calidadDelDia ?? []).map((l) => l.id));
      return (data ?? []) as CalidadAdjunto[];
    },
  });
  const calidadAdjuntoCounts = useMemo(() => attachmentCountMap(calidadAdjuntosDelDia ?? []), [calidadAdjuntosDelDia]);

  const abrirTabCalidad = useCallback(() => {
    setActiveTab("calidad");
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const readOnly = parte?.estado !== "Borrador";

  function update<K extends keyof Parte>(key: K, value: Parte[K]) {
    setParte((p) => (p ? { ...p, [key]: value } : p));
  }

  async function save() {
    if (!parte || !cascade) return;
    setSaving(true);
    const payload: ParteUpdatePayload = {
      notas_generales: parte.notas_generales,
      notas_inventario: parte.notas_inventario,
    };
    PART_DETAIL_MANUAL_FIELDS.forEach((f) => (payload[f.key] = Number(parte[f.key] || 0)));
    if (parte.estado !== "Borrador") {
      const abs = Math.abs(cascade.dsj_pct);
      payload.estado = abs > 3 ? "Con descuadre" : abs >= 1 ? "Analizado" : "Validado";
    }
    const { error } = await supabase.from("partes_diarios").update(payload).eq("id", parte.id);
    setSaving(false);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    toast({ title: "Guardado" });
    void queryClient.invalidateQueries({ queryKey: PARTES_QUERY_KEY });
    if (typeof payload.estado === "string" && payload.estado !== parte.estado) load();
  }

  async function toggleEstado() {
    if (!parte || !cascade) return;
    let next: "Borrador" | "Analizado" | "Con descuadre" | "Validado";
    if (parte.estado === "Borrador") {
      const abs = Math.abs(cascade.dsj_pct);
      next = abs > 3 ? "Con descuadre" : abs >= 1 ? "Analizado" : "Validado";
    } else {
      next = "Borrador";
    }
    const { error } = await supabase.from("partes_diarios").update({ estado: next }).eq("id", parte.id);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    toast({ title: next === "Borrador" ? "Parte reabierto" : `Parte ${next.toLowerCase()}` });
    void queryClient.invalidateQueries({ queryKey: PARTES_QUERY_KEY });
    load();
  }

  function extractInvokeError(error: { context?: unknown; message?: string }): string {
    return typeof error.context === "string"
      ? (() => { try { return JSON.parse(error.context as string)?.error ?? error.message; } catch { return error.context; } })()
      : (error.message ?? "Error desconocido");
  }

  async function handleUpload(cat: CategoryId, fileList: FileList | File[]) {
    if (!user || !parte) return;
    const list = Array.from(fileList);
    if (list.length === 0) return;
    setUploadingCat(cat);
    let ok = 0, fail = 0;
    // Resultados del parseo autom\u00e1tico de "Informes por lote" (solo aplica a esa categor\u00eda).
    const loteResultados: Array<{ ok: true; lote_codigo: string; kg_total: number } | { ok: false; error: string }> = [];
    for (const file of list) {
      const safeName = file.name
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.id}/${parte.id}/${cat}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("partes-archivos").upload(path, file);
      if (upErr) { fail++; console.error(upErr); continue; }
      const { data: inserted, error: dbErr } = await supabase.from("partes_archivos").insert({
        part_id: parte.id, user_id: user.id, file_name: file.name, file_path: path,
        file_type: cat, mime_type: file.type, file_size: file.size,
      }).select("id").single();
      if (dbErr || !inserted) { fail++; console.error(dbErr); continue; }
      ok++;

      // Informes por lote: se parsean solos al subir, sin esperar a "Analizar parte".
      if (cat === "InformeLote") {
        try {
          const { data: result, error: fnErr } = await supabase.functions.invoke("analizar-lote-excel", {
            body: { archivo_id: inserted.id },
          });
          if (fnErr) {
            loteResultados.push({ ok: false, error: extractInvokeError(fnErr) });
          } else if (result?.error) {
            loteResultados.push({ ok: false, error: String(result.error) });
          } else {
            loteResultados.push({
              ok: true,
              lote_codigo: String(result?.lote_codigo ?? file.name),
              kg_total: Number(result?.kg_total) || 0,
            });
          }
        } catch (e) {
          loteResultados.push({ ok: false, error: String(e) });
        }
      }
    }
    setUploadingCat(null);

    let description: string | undefined;
    let variant: "destructive" | undefined = fail > 0 ? "destructive" : undefined;
    if (loteResultados.length > 0) {
      const buenos = loteResultados.filter((r): r is { ok: true; lote_codigo: string; kg_total: number } => r.ok);
      const malos = loteResultados.filter((r) => !r.ok) as Array<{ ok: false; error: string }>;
      const detalleBuenos = buenos.map((r) => `${r.lote_codigo}: ${formatKg(r.kg_total)}`).join(", ");
      if (malos.length === 0) {
        description = `${buenos.length} lote(s) procesado(s)${detalleBuenos ? ` (${detalleBuenos})` : ""}`;
      } else {
        description = `${buenos.length} procesado(s), ${malos.length} con error: ${malos.map((m) => m.error).join("; ")}`;
        variant = "destructive";
      }
    }

    toast({
      title: fail === 0 ? `${ok} archivo(s) subido(s)` : `${ok} subido(s), ${fail} con error`,
      description,
      variant,
    });
    load();
  }

  async function handleDeleteFile(a: Archivo) {
    if (!a.file_path) return;
    await supabase.storage.from("partes-archivos").remove([a.file_path]);
    await supabase.from("partes_archivos").delete().eq("id", a.id);
    toast({ title: "Archivo eliminado" });
    load();
  }

  // ── Análisis con IA (edge function) ───────────────────────────────────────
  async function analyze() {
    if (!parte) return;
    setAnalyzing(true);
    try {
      // Enviar valores actuales del formulario (incluyendo no guardados)
      const currentValues = {
        kg_reciclado_malla_z1: Number(parte.kg_reciclado_malla_z1) || 0,
        kg_reciclado_malla_z2: Number(parte.kg_reciclado_malla_z2) || 0,
        kg_inventario_sin_alta: Number(parte.kg_inventario_sin_alta) || 0,
        kg_podrido_bolsa_basura: Number(parte.kg_podrido_bolsa_basura) || 0,
      };
      
      const { error } = await supabase.functions.invoke("analizar-parte", {
        body: { part_id: parte.id, current_values: currentValues },
      });
      
      if (error) {
        const detail = typeof error.context === "string"
          ? (() => { try { return JSON.parse(error.context)?.error ?? error.message; } catch { return error.context; } })()
          : error.message;
        setAnalyzing(false);
        return toast({ title: "Error analizando", description: detail, variant: "destructive" });
      }
    } catch (e) {
      setAnalyzing(false);
      return toast({ title: "Error", description: String(e), variant: "destructive" });
    }
    
    await new Promise(r => setTimeout(r, 1000));
    setAnalyzing(false);
    await load();
    // El análisis escribe en lotes_dia/calibres_dia/producto_dia: refrescar
    // todas las secciones del parte de un golpe (si no, la caché serviría el
    // "vacío" previo al análisis durante los 5 min de staleTime global).
    await queryClient.invalidateQueries({ queryKey: ["parte-detail", parte.id] });

    toast({
      title: "✅ Análisis completado",
      description: "Cascada actualizada con los datos de IA"
    });
  }

  if (!parte || !cascade) {
    return (
      <div className="page-shell">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const sem = getSemaforo(cascade.dsj_pct);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/partes")} title="Volver a Partes">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="page-title">
              Parte ·{" "}
              <Link to={`/analisis/diario?desde=${parte.date}&hasta=${parte.date}`} className="text-primary hover:underline">
                {formatDate(parte.date)}
              </Link>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge estado={parte.estado} />
              <SemaforoPill dsjPct={cascade.dsj_pct} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild className="hidden glass glass-hover sm:inline-flex">
            <Link to={`/analisis/diario?desde=${parte.date}&hasta=${parte.date}`}>
              <BarChart3 className="h-4 w-4" />Análisis detallado
            </Link>
          </Button>
          <ExportPartesDialog defaultFrom={parte.date} defaultTo={parte.date} />
          <Button variant="outline" onClick={toggleEstado} className="hidden glass glass-hover sm:inline-flex">
            {parte.estado === "Borrador"
              ? <><Lock className="h-4 w-4" />Cerrar</>
              : <><Unlock className="h-4 w-4" />Reabrir</>}
          </Button>
          <Button
            variant="default"
            onClick={analyze}
            disabled={analyzing || archivos.length === 0}
            className="glass glass-hover"
          >
            {analyzing
              ? <><Loader2 className="h-4 w-4 animate-spin" />Analizando…</>
              : <><Sparkles className="h-4 w-4" />Analizar parte</>
            }
          </Button>
          <Button onClick={save} disabled={saving || readOnly} className="glass glass-hover">
            <Save className="h-4 w-4" />Guardar
          </Button>
          {/* Secundarias agrupadas en móvil */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="glass glass-hover sm:hidden" aria-label="Más acciones">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/analisis/diario?desde=${parte.date}&hasta=${parte.date}`)}>
                <BarChart3 className="h-4 w-4" />Análisis detallado
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleEstado}>
                {parte.estado === "Borrador"
                  ? <><Lock className="h-4 w-4" />Cerrar</>
                  : <><Unlock className="h-4 w-4" />Reabrir</>}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Tira de ficha compacta: entidad + datos clave antes del contenido (patrón Aerobotics) */}
      <FichaStrip
        items={[
          { label: "Fecha", value: formatDate(parte.date) },
          {
            label: "Estado",
            value: parte.estado,
            tone: parte.estado === "Con descuadre" ? "warning" : parte.estado === "Validado" ? "success" : "neutral",
          },
          { label: "Kg calibrador", value: formatKg(parte.kg_produccion_calibrador) },
          {
            label: "Semáforo DJPMN",
            value: `${cascade.dsj_pct >= 0 ? "+" : ""}${cascade.dsj_pct.toFixed(2)}%`,
            tone: sem.accent,
          },
        ]}
      />

      {/* ─── KPIs del día ───────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <KPICard
          label="Producción real"
          value={formatKg(cascade.produccion_real)}
          icon={Truck}
        />
        <KPICard
          label="Kg dados de alta"
          value={formatKg(cascade.palets_ajustados)}
          icon={Package}
        />
        <KPICard
          label="Dif. Sin Justificar"
          value={formatKg(cascade.dsj)}
          icon={TrendingDown}
          accent={sem.accent}
          delta={`${cascade.dsj_pct >= 0 ? "+" : ""}${cascade.dsj_pct.toFixed(2)}%`}
          deltaTrend={sem.deltaTrend}
        />
        <KPICard
          label="Velocidad día"
          value={cascade.tph_promedio !== null ? `${cascade.tph_promedio.toFixed(1)} T/h` : "—"}
          icon={Gauge}
          labelInfo="Producción real entre las horas de jornada del día: 8 h hasta el 1 jul 2026 y 7 h desde el 2 jul (hasta nuevo aviso)."
          hint={`kg del día ÷ ${horasOperativasDia(parte?.date)} h`}
        />
        <KPICard
          label="Velocidad calibrador"
          value={tphCalibrador !== null ? `${tphCalibrador.toFixed(1)} T/h` : "—"}
          icon={Timer}
          labelInfo="Media de T/h por lote mientras la máquina corre, ponderada por duración. Distinta de la velocidad del día: esta solo cuenta el tiempo de máquina en marcha."
          hint={tphCalibrador !== null ? "media de lotes" : "sin lotes analizados"}
        />
      </section>

      {/* ─── ¿Qué pasó hoy? ─────────────────────────────────────────────── */}
      <Card className="glass-accented">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
            <p className="panel-kicker">¿Qué pasó hoy?</p>
          </div>
        </CardHeader>
        <CardContent>
          {readOnly ? (
            parte.notas_generales ? (
              <p className="text-sm leading-relaxed">{parte.notas_generales}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">Sin notas para este día.</p>
            )
          ) : (
            <div className="space-y-1.5">
              <Textarea
                rows={3}
                maxLength={2000}
                placeholder="Paradas, incidencias, algo que explique el día..."
                value={parte.notas_generales ?? ""}
                onChange={(e) => update("notas_generales", e.target.value)}
              />
              <div className="text-right text-[11px] tabular-nums text-muted-foreground">
                {(parte.notas_generales ?? "").length}/2000
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Lotes del día ──────────────────────────────────────────────── */}
      <PartDetailLotes
        lotes={lotesDelDia ?? []}
        loading={lotesLoading}
        readOnly={readOnly}
        onLoteUpdate={saveLoteUpdate}
      />

      {/* ─── Destino de fruta + Rendimiento por zonas ───────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PartDetailDestino
          destinoFruta={destinoFruta}
          loading={destinoFrutaLoading}
          produccionReal={cascade.produccion_real}
          calibreDominante={calibresResumen?.calibreDominante}
          categoriaTop={calibresResumen?.categoriaTop}
        />
        <PartDetailZonas
          loading={!rendimientoZonas}
          zonas={rendimientoZonas?.zonas ?? null}
          kgPersonaGeneral={rendimientoZonas?.kgPersonaGeneral ?? 0}
          presentesComputables={rendimientoZonas?.presentesComputables ?? 0}
          sinZona={rendimientoZonas?.sinZona ?? null}
        />
      </div>

      {/* ─── Calidad del día (resumen, más visible + clicable) ──────────── */}
      {calidadResumen && calidadResumen.total > 0 && (
        <Card className="glass-accented">
          <CardContent className="space-y-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
                <div>
                  <p className="panel-kicker">Calidad del día</p>
                  <p className="text-sm">
                    {calidadResumen.total} lote{calidadResumen.total === 1 ? "" : "s"} revisado{calidadResumen.total === 1 ? "" : "s"}
                    {calidadIncidencias > 0 && (
                      <span className="ml-1 font-medium text-warning">· {calidadIncidencias} con incidencia{calidadIncidencias === 1 ? "" : "s"}</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="glass glass-hover" onClick={abrirTabCalidad}>
                  <ClipboardCheck className="h-4 w-4" />
                  Ver informes de calidad
                </Button>
                <Button variant="ghost" size="sm" className="glass-hover" asChild>
                  <Link to={`/calidad?fecha=${parte.date}`}>Abrir Jornada de Calidad</Link>
                </Button>
              </div>
            </div>
            {calidadDelDia && calidadDelDia.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {calidadDelDia.map((lote) => (
                  <button
                    key={lote.id}
                    type="button"
                    onClick={() => {
                      setCalidadPreview(lote);
                      setCalidadPreviewOpen(true);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--glass-bg-strong)]",
                      QUALITY_STYLE[lote.calidad],
                    )}
                    title="Ver informe de calidad"
                  >
                    {lote.numero_lote || "Lote s/n"}
                    <span className="opacity-70">· {lote.calidad}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Cascada DJPMN (detalle, replegado) ─────────────────────────── */}
      <Collapsible>
        <Card className="glass-accented overflow-hidden">
          <CollapsibleTrigger asChild>
            <CardHeader className="group cursor-pointer select-none">
              <div className="flex items-center gap-3">
                <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0 flex-1">
                  <p className="panel-kicker">El cuadre por dentro</p>
                  <CardTitle>Cascada DJPMN detallada</CardTitle>
                </div>
                <span className={cn("shrink-0 text-lg font-semibold tabular-nums sm:text-xl", sem.text)}>
                  {cascade.dsj_pct >= 0 ? "+" : ""}{cascade.dsj_pct.toFixed(2)}%
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <CascadeView result={cascade} />
              <div className="mt-4 rounded-xl glass p-3 text-xs text-muted-foreground">
                Sube los archivos en cada categoría y pulsa <strong>Analizar parte</strong> para rellenar automáticamente.
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full" ref={tabsRef}>
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
          <TabsTrigger value="archivos">
            Archivos {archivos.length > 0 && <Badge variant="secondary" className="ml-1.5 px-1.5 text-[10px]">{archivos.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="manual">Datos manuales</TabsTrigger>
          <TabsTrigger value="calidad">
            Calidad {calidadResumen && calidadResumen.total > 0 && <Badge variant="secondary" className="ml-1.5 px-1.5 text-[10px]">{calidadResumen.total}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── TAB: Archivos ───────────────────────────────────────────────── */}
        <TabsContent value="archivos" className="mt-4">
          <PartDetailArchivos
            archivos={archivos}
            readOnly={readOnly}
            uploadingCat={uploadingCat}
            handleUpload={handleUpload}
            handleDeleteFile={handleDeleteFile}
          />
        </TabsContent>

        {/* ── TAB: Datos manuales ─────────────────────────────────────────── */}
        <TabsContent value="manual" className="mt-4 space-y-6">
          <PartDetailManual
            parte={parte}
            readOnly={readOnly}
            update={update}
            manualFields={PART_DETAIL_MANUAL_FIELDS}
          />
        </TabsContent>

        <TabsContent value="calidad" className="mt-4">
          <PartDetailCalidad date={parte.date} />
        </TabsContent>
      </Tabs>

      <CalidadInformeDialog
        lote={calidadPreview}
        open={calidadPreviewOpen}
        onOpenChange={setCalidadPreviewOpen}
        adjuntosCount={calidadPreview ? calidadAdjuntoCounts[calidadPreview.id] ?? 0 : 0}
      />
    </div>
  );
}
