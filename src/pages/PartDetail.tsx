import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { CascadeView } from "@/components/CascadeView";
import { AnalisisDashboard } from "@/components/AnalisisDashboard";
import { computeCascade } from "@/lib/cascade";
import { formatDate, formatKg } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { useAnalisisInformes } from "@/hooks/useAnalisisInformes";
import { ArrowLeft, Save, Lock, Unlock, Upload, Trash2, Sparkles, FileText, Table2, CheckCircle2, BarChart3, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportPartesDialog } from "@/components/ExportPartesDialog";
import {
  parseInforme,
  detectarTipoInforme,
  ParsedProduccion,
  ParsedPalets,
  ParsedProducto,
  ParsedCalibres,
} from "@/lib/parsers";
import * as XLSX from "xlsx";

interface Parte {
  id: string;
  date: string;
  estado: string;
  // Manual (5)
  kg_industria_manual: number;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  kg_inventario_sin_alta: number;
  kg_podrido_bolsa_basura: number;
  // Automáticos (IA / archivos)
  kg_produccion_calibrador: number;
  kg_mujeres_calibrador: number;
  kg_palets_brutos: number;
  kg_podrido_calibrador_auto: number;
  kg_inventario_anterior_sin_alta: number;
  notas_generales: string | null;
  notas_inventario: string | null;
}

const MANUAL_FIELDS: { key: keyof Parte; label: string }[] = [
  { key: "kg_industria_manual", label: "Industria de la punta" },
  { key: "kg_reciclado_malla_z1", label: "Reciclado malla Z1" },
  { key: "kg_reciclado_malla_z2", label: "Reciclado malla Z2" },
  { key: "kg_inventario_sin_alta", label: "Inventario final sin dar de alta" },
  { key: "kg_podrido_bolsa_basura", label: "Podrido manual (bolsa basura)" },
];

const CATEGORIES = [
  { id: "GSTOCK", label: "GSTOCK" },
  { id: "Produccion", label: "Producción" },
  { id: "FotoLotes", label: "Foto lotes" },
  { id: "Otro", label: "Otro" },
] as const;
type CategoryId = typeof CATEGORIES[number]["id"];

// Legacy → nuevos (archivos subidos antes de la migración del enum)
const LEGACY_CAT: Record<string, CategoryId> = {
  gstocks: "GSTOCK",
  produccion: "Produccion",
  foto_lotes: "FotoLotes",
};
const normalizeCat = (t: string | null): CategoryId | null =>
  t ? (LEGACY_CAT[t] ?? (CATEGORIES.find((c) => c.id === t)?.id ?? null)) : null;

interface Archivo {
  id: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  uploaded_at: string;
}

// ─── Tipos para el parser de informes ────────────────────────────────────────
interface ParsePreview {
  tipo: string;
  resumen: string;
  campos: Record<string, number | string | null>;
}

export default function PartDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [parte, setParte] = useState<Parte | null>(null);
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadingCat, setUploadingCat] = useState<CategoryId | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsePreview, setParsePreview] = useState<ParsePreview | null>(null);

  // ── Hook de análisis completo ─────────────────────────────────────────
  const { estado: estadoAnalisis, analisis, progreso: progresoAnalisis, analizar, reset: resetAnalisis } = useAnalisisInformes();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: p, error }, { data: files }] = await Promise.all([
      supabase.from("partes_diarios").select("*").eq("id", id).maybeSingle(),
      supabase.from("partes_archivos").select("*").eq("part_id", id).order("uploaded_at", { ascending: false }),
    ]);
    if (error || !p) {
      toast({ title: "Error", description: error?.message ?? "No encontrado", variant: "destructive" });
      navigate("/partes");
      return;
    }
    setParte(p as Parte);
    setArchivos((files ?? []) as Archivo[]);
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  const cascade = useMemo(() => {
    if (!parte) return null;
    return computeCascade({
      kg_produccion_calibrador: Number(parte.kg_produccion_calibrador),
      kg_mujeres_calibrador: Number(parte.kg_mujeres_calibrador),
      kg_palets_brutos: Number(parte.kg_palets_brutos),
      kg_podrido_calibrador: Number(parte.kg_podrido_calibrador_auto),
      kg_industria_manual: Number(parte.kg_industria_manual),
      kg_reciclado_malla_z1: Number(parte.kg_reciclado_malla_z1),
      kg_reciclado_malla_z2: Number(parte.kg_reciclado_malla_z2),
      kg_inventario_sin_alta: Number(parte.kg_inventario_sin_alta),
      kg_podrido_bolsa_basura: Number(parte.kg_podrido_bolsa_basura),
      kg_inventario_anterior_sin_alta: Number(parte.kg_inventario_anterior_sin_alta),
    });
  }, [parte]);

  const readOnly = parte?.estado !== "Borrador";

  function update<K extends keyof Parte>(key: K, value: Parte[K]) {
    setParte((p) => (p ? { ...p, [key]: value } : p));
  }

  async function save() {
    if (!parte || !cascade) return;
    setSaving(true);
    const payload: any = {
      notas_generales: parte.notas_generales,
      notas_inventario: parte.notas_inventario,
    };
    MANUAL_FIELDS.forEach((f) => (payload[f.key] = Number(parte[f.key] || 0)));

    // Auto-estado según |%DSJ|: <1% Validado · 1-3% Analizado · >3% Con descuadre
    if (parte.estado !== "Borrador") {
      const abs = Math.abs(cascade.dsj_pct);
      payload.estado = abs > 3 ? "Con descuadre" : abs >= 1 ? "Analizado" : "Validado";
    }

    const { error } = await supabase.from("partes_diarios").update(payload).eq("id", parte.id);
    setSaving(false);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    toast({ title: "Guardado" });
    if (payload.estado && payload.estado !== parte.estado) load();
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
    load();
  }

  async function handleUpload(cat: CategoryId, fileList: FileList | File[]) {
    if (!user || !parte) return;
    const list = Array.from(fileList);
    if (list.length === 0) return;
    setUploadingCat(cat);
    let ok = 0, fail = 0;
    for (const file of list) {
      const safeName = file.name
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita tildes
        .replace(/[^a-zA-Z0-9._-]/g, "_"); // sustituye resto
      const path = `${user.id}/${parte.id}/${cat}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("partes-archivos").upload(path, file);
      if (upErr) { fail++; console.error(upErr); continue; }
      const { error: dbErr } = await supabase.from("partes_archivos").insert({
        part_id: parte.id, user_id: user.id, file_name: file.name, file_path: path,
        file_type: cat as any, mime_type: file.type, file_size: file.size,
      });
      if (dbErr) { fail++; console.error(dbErr); } else ok++;
    }
    setUploadingCat(null);
    toast({
      title: fail === 0 ? `${ok} archivo(s) subido(s)` : `${ok} subido(s), ${fail} con error`,
      variant: fail > 0 ? "destructive" : undefined,
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

  // ── M1: Parser de informes Excel ─────────────────────────────────────────
  async function handleParseInforme(fileList: FileList | File[]) {
    if (!user || !parte) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setParsing(true);
    setParsePreview(null);

    for (const file of files) {
      const result = await parseInforme(file);
      if (!result) {
        toast({
          title: "No se pudo detectar el tipo de informe",
          description: `${file.name} — revisa que sea un informe del calibrador Spectrim`,
          variant: "destructive",
        });
        continue;
      }

      if (result.tipo === "produccion") {
        const r = result as ParsedProduccion;
        // Actualizar parte con kg_produccion_calibrador y guardar lotes en Supabase
        setParte((p) => p ? { ...p, kg_produccion_calibrador: r.kg_total } : p);

        // Guardar lotes en lotes_dia (borrar los anteriores del parte primero)
        await supabase.from("lotes_dia").delete().eq("part_id", parte.id);
        if (r.lotes.length > 0) {
          const inserts = r.lotes.map((l) => ({
            part_id: parte.id,
            user_id: user.id,
            lote_codigo: l.lote_codigo,
            productor: l.productor,
            producto: l.producto,
            kg_peso_total: l.kg_peso_total,
            toneladas_hora: l.toneladas_hora,
            duracion_min: l.duracion_min,
            peso_fruta_promedio_g: l.peso_fruta_promedio_g,
            hora_inicio: l.hora_inicio,
            source: "manual" as const,
          }));
          const { error } = await supabase.from("lotes_dia").insert(inserts as any);
          if (error) console.error("Error guardando lotes:", error);
        }

        // Guardar en partes_diarios
        await supabase
          .from("partes_diarios")
          .update({ kg_produccion_calibrador: r.kg_total })
          .eq("id", parte.id);

        setParsePreview({
          tipo: "Informe producción",
          resumen: `${r.lotes.length} lotes · ${r.kg_total.toFixed(0)} kg totales`,
          campos: {
            "Producción calibrador (kg)": r.kg_total,
            "T/h promedio": r.tph_promedio ? r.tph_promedio.toFixed(2) : "N/D",
            "Nº lotes": r.lotes.length,
            "Productores": [...new Set(r.lotes.map((l) => l.productor).filter(Boolean))].join(", ") || "N/D",
          },
        });

        toast({
          title: `Informe producción parseado`,
          description: `${r.lotes.length} lotes · ${r.kg_total.toFixed(0)} kg → kg_produccion_calibrador actualizado`,
        });
      }

      if (result.tipo === "palets") {
        const r = result as ParsedPalets;
        setParte((p) => p
          ? {
              ...p,
              kg_palets_brutos: r.kg_total_bruto,
              kg_inventario_sin_alta: r.kg_camara,
            }
          : p
        );

        // Guardar palets en palets_dia
        await supabase.from("palets_dia" as any).delete().eq("part_id", parte.id);
        if (r.palets.length > 0) {
          const inserts = r.palets.map((p) => ({
            part_id: parte.id,
            user_id: user.id,
            palet_id: p.palet_id,
            producto: p.producto,
            cliente: p.cliente,
            destino: p.destino,
            kg_neto: p.kg_neto,
            situacion: p.situacion,
            n_cajas: p.n_cajas,
            source: "manual" as const,
          }));
          await supabase.from("palets_dia" as any).insert(inserts);
        }

        await supabase
          .from("partes_diarios")
          .update({
            kg_palets_brutos: r.kg_total_bruto,
            kg_inventario_sin_alta: r.kg_camara,
          })
          .eq("id", parte.id);

        setParsePreview({
          tipo: "Informe palets",
          resumen: `${r.palets.length} palets · ${r.kg_total_bruto.toFixed(0)} kg brutos`,
          campos: {
            "Palets brutos (kg)": r.kg_total_bruto,
            "En cámara / kg (Sit=S)": r.kg_camara,
            "Facturado / kg (Sit=F)": r.kg_facturado,
            "Ficticio / kg": r.kg_ficticio,
            "Nº palets": r.palets.length,
          },
        });

        toast({
          title: "Informe palets parseado",
          description: `${r.kg_total_bruto.toFixed(0)} kg brutos · ${r.kg_camara.toFixed(0)} kg en cámara`,
        });
      }

      if (result.tipo === "producto") {
        const r = result as ParsedProducto;
        // Guardar producto_dia
        await supabase.from("producto_dia" as any).delete().eq("part_id", parte.id);
        if (r.lineas.length > 0) {
          const inserts = r.lineas.map((l) => ({
            part_id: parte.id,
            user_id: user.id,
            linea: l.linea,
            producto: l.producto,
            formato_caja: l.formato_caja,
            kg: l.kg,
            n_cajas: l.cajas,
            grupo_destino: l.grupo_destino,
            source: "manual" as const,
          }));
          await supabase.from("producto_dia" as any).insert(inserts);
        }
        setParsePreview({
          tipo: "Informe producto",
          resumen: `${r.lineas.length} líneas · ${r.kg_total.toFixed(0)} kg`,
          campos: {
            "Exportación (kg)": r.kg_exportacion,
            "Mercado nacional (kg)": r.kg_mercado,
            "Industria (kg)": r.kg_industria,
            "Total (kg)": r.kg_total,
          },
        });
        toast({ title: "Informe producto parseado", description: `${r.kg_total.toFixed(0)} kg · ${r.lineas.length} líneas` });
      }

      if (result.tipo === "calibres") {
        const r = result as ParsedCalibres;
        // Guardar calibres_dia
        await supabase.from("calibres_dia" as any).delete().eq("part_id", parte.id);
        if (r.calibres.length > 0) {
          const inserts = r.calibres.map((c) => ({
            part_id: parte.id,
            user_id: user.id,
            calibre: c.calibre,
            piezas: c.piezas,
            kg: c.kg,
            pct: c.pct,
            clase: c.clase,
            grupo_destino: c.grupo_destino,
            source: "manual" as const,
          }));
          await supabase.from("calibres_dia" as any).insert(inserts);
        }
        setParsePreview({
          tipo: "Informe tamaños / calibres",
          resumen: `${r.calibres.length} calibres · ${r.kg_total.toFixed(0)} kg`,
          campos: {
            "Exportación (kg)": r.kg_exportacion,
            "Mercado nacional (kg)": r.kg_mercado,
            "Industria (kg)": r.kg_industria,
            "Total (kg)": r.kg_total,
          },
        });
        toast({ title: "Informe calibres parseado", description: `${r.calibres.length} calibres detectados` });
      }
    }

    setParsing(false);
    load();
  }

  // ── Análisis IA (edge function — legacy) ─────────────────────────────────
  async function analyze() {
    if (!parte) return;
    setAnalyzing(true);
    const { data, error } = await supabase.functions.invoke("analizar-parte", {
      body: { part_id: parte.id },
    });
    setAnalyzing(false);
    if (error) {
      const detail = typeof error.context === "string"
        ? (() => {
            try { return JSON.parse(error.context)?.error ?? error.message; }
            catch { return error.context; }
          })()
        : error.message;
      return toast({ title: "Error analizando", description: detail, variant: "destructive" });
    }
    toast({
      title: data?.ai_warning ? "Análisis parcial completado" : "Análisis completado",
      description: data?.message ?? "Datos extraídos",
      variant: data?.ai_warning ? "destructive" : undefined,
    });
    load();
  }

  // ── Análisis completo de informes Excel (nuevo dashboard) ─────────────────
  async function handleAnalizarInformes() {
    if (!parte || !user) return;

    // Usar archivos ya cargados en memoria si los hay (desde handleParseInforme)
    // Si no, descargar desde Supabase Storage todos los Excel del parte
    const excelArchivos = archivos.filter((a) =>
      a.mime_type?.includes("spreadsheet") ||
      a.mime_type?.includes("excel") ||
      a.file_name?.endsWith(".xlsx") ||
      a.file_name?.endsWith(".xls")
    );

    if (excelArchivos.length === 0) {
      toast({
        title: "Sin archivos Excel",
        description: "Sube los informes en el tab 'Importar' o 'Archivos' primero",
        variant: "destructive",
      });
      return;
    }

    const files: File[] = [];
    for (const a of excelArchivos) {
      if (!a.file_path) continue;
      const { data: blob, error } = await supabase.storage
        .from("partes-archivos")
        .download(a.file_path);
      if (error || !blob) { console.error("Error descargando", a.file_name, error); continue; }
      files.push(new File([blob], a.file_name ?? "informe.xlsx", { type: a.mime_type ?? "" }));
    }

    if (files.length === 0) {
      toast({ title: "No se pudieron descargar los archivos", variant: "destructive" });
      return;
    }

    await analizar(files, parte.id, user.id);
  }

  if (loading || !parte || !cascade) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/partes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl">Parte · {formatDate(parte.date)}</h1>
            <div className="mt-1"><StatusBadge estado={parte.estado} /></div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportPartesDialog defaultFrom={parte.date} defaultTo={parte.date} />
          <Button variant="outline" onClick={toggleEstado}>
            {parte.estado === "Borrador"
              ? <><Lock className="h-4 w-4" />Cerrar</>
              : <><Unlock className="h-4 w-4" />Reabrir</>}
          </Button>
          <Button onClick={save} disabled={saving || readOnly}>
            <Save className="h-4 w-4" />Guardar
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-lg">Cascada DJPMN</CardTitle></CardHeader>
        <CardContent>
          <CascadeView result={cascade} />
          <p className="mt-4 text-xs text-muted-foreground">
            Datos automáticos desde archivos adjuntos (calibrador, mujeres, palets, podrido calibrador).
            Ajustes manuales del operario editables abajo.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="informes" className="w-full">
        <TabsList className="grid w-full grid-cols-4 sm:w-auto sm:inline-flex">
          <TabsTrigger value="informes">
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            Informes & Análisis
            {analisis && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-success inline-block" />}
          </TabsTrigger>
          <TabsTrigger value="manual">Datos manuales</TabsTrigger>
          <TabsTrigger value="archivos">Archivos</TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
        </TabsList>

        {/* ── TAB: Informes & Análisis (unificado) ─────────────────────────── */}
        <TabsContent value="informes" className="mt-4 space-y-4">
          {/* Upload zone */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Importar informes del calibrador
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md bg-muted/50 border px-4 py-3 text-sm space-y-1.5">
                <p className="font-medium">Archivos soportados:</p>
                <ul className="text-muted-foreground space-y-0.5 text-xs ml-2">
                  <li>• <strong>Informe_produccion.xlsx</strong> → lotes, T/h, productores</li>
                  <li>• <strong>palets_*.xlsx</strong> → palets, stock en cámara</li>
                  <li>• <strong>Informe_producto.xlsx</strong> → producto empacado</li>
                  <li>• <strong>Informe_tamaños*.xlsx</strong> → calibres y calidad</li>
                </ul>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex">
                  <input
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    disabled={readOnly || parsing}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleParseInforme(e.target.files);
                      }
                      e.target.value = "";
                    }}
                  />
                  <Button
                    asChild
                    variant="outline"
                    className="cursor-pointer"
                    disabled={readOnly || parsing}
                  >
                    <span>
                      <Upload className="h-4 w-4" />
                      {parsing ? "Parseando…" : "Subir informes Excel"}
                    </span>
                  </Button>
                </label>

                <Button
                  onClick={handleAnalizarInformes}
                  disabled={estadoAnalisis === "parseando" || estadoAnalisis === "calculando" || estadoAnalisis === "guardando" || archivos.filter(a => a.file_name?.endsWith(".xlsx") || a.file_name?.endsWith(".xls")).length === 0}
                >
                  {(estadoAnalisis === "parseando" || estadoAnalisis === "calculando" || estadoAnalisis === "guardando")
                    ? <><Loader2 className="h-4 w-4 animate-spin" />{progresoAnalisis || "Analizando…"}</>
                    : <><BarChart3 className="h-4 w-4" />Analizar informes</>
                  }
                </Button>

                {analisis && (
                  <Button variant="ghost" size="sm" onClick={resetAnalisis} className="text-xs text-muted-foreground">
                    Limpiar análisis
                  </Button>
                )}
              </div>

              {parsePreview && (
                <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium text-success">{parsePreview.tipo}</span>
                    <span className="text-xs text-muted-foreground">— {parsePreview.resumen}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    {Object.entries(parsePreview.campos).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs border-b border-border/40 py-0.5">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="tabular-nums font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Analysis results */}
          {(estadoAnalisis === "parseando" || estadoAnalisis === "calculando" || estadoAnalisis === "guardando") && (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                <p className="text-sm font-medium">{progresoAnalisis || "Procesando…"}</p>
                <p className="text-xs text-muted-foreground">Esto tarda unos segundos</p>
              </CardContent>
            </Card>
          )}

          {estadoAnalisis === "error" && (
            <Card>
              <CardContent className="py-8 text-center space-y-3">
                <p className="text-sm text-destructive font-medium">Error en el análisis</p>
                <Button variant="outline" size="sm" onClick={resetAnalisis}>Reintentar</Button>
              </CardContent>
            </Card>
          )}

          {estadoAnalisis === "listo" && analisis && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Análisis de {archivos.filter(a => a.file_name?.endsWith(".xlsx")).length} archivos ·{" "}
                  {new Date(analisis.fecha_analisis).toLocaleString("es-ES")}
                </p>
              </div>
              <AnalisisDashboard analisis={analisis} />
            </div>
          )}
        </TabsContent>

        {/* ── TAB: Archivos adjuntos ──────────────────────────────────────── */}
        <TabsContent value="archivos" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Archivos adjuntos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {CATEGORIES.map((c) => {
                  const filesInCat = archivos.filter((a) => normalizeCat(a.file_type) === c.id);
                  return (
                    <div key={c.id} className="rounded-lg border bg-card p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{c.label}</p>
                        <span className="text-xs text-muted-foreground">{filesInCat.length}</span>
                      </div>
                      <label className="flex">
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          disabled={readOnly || uploadingCat === c.id}
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              handleUpload(c.id, e.target.files);
                            }
                            e.target.value = "";
                          }}
                        />
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="w-full cursor-pointer"
                          disabled={readOnly || uploadingCat === c.id}
                        >
                          <span>
                            <Upload className="h-4 w-4" />
                            {uploadingCat === c.id ? "Subiendo…" : "Subir"}
                          </span>
                        </Button>
                      </label>
                      <ul className="space-y-1">
                        {filesInCat.map((a) => (
                          <li key={a.id} className="flex items-center gap-2 text-xs">
                            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate flex-1" title={a.file_name ?? ""}>{a.file_name}</span>
                            {!readOnly && (
                              <button
                                onClick={() => handleDeleteFile(a)}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label="Eliminar"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Sube fotos de lotes, archivos GSTOCK y otros documentos del día.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual" className="mt-4 space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-lg">Ajustes manuales</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {MANUAL_FIELDS.map((f) => (
                <div key={f.key as string} className="space-y-1.5">
                  <Label htmlFor={f.key as string}>{f.label}</Label>
                  <Input
                    id={f.key as string}
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={readOnly}
                    value={String(parte[f.key] ?? 0)}
                    onChange={(e) => update(f.key, Number(e.target.value) as any)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Datos automáticos (desde archivos)</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="flex justify-between border-b py-1">
                <span className="text-muted-foreground">Producción calibrador</span>
                <span className="tabular-nums">{formatKg(Number(parte.kg_produccion_calibrador))}</span>
              </div>
              <div className="flex justify-between border-b py-1">
                <span className="text-muted-foreground">Mujeres (L)</span>
                <span className="tabular-nums">{formatKg(Number(parte.kg_mujeres_calibrador))}</span>
              </div>
              <div className="flex justify-between border-b py-1">
                <span className="text-muted-foreground">Palets alta (bruto)</span>
                <span className="tabular-nums">{formatKg(Number(parte.kg_palets_brutos))}</span>
              </div>
              <div className="flex justify-between border-b py-1">
                <span className="text-muted-foreground">Podrido calibrador</span>
                <span className="tabular-nums">{formatKg(Number(parte.kg_podrido_calibrador_auto))}</span>
              </div>
              <div className="flex justify-between border-b py-1">
                <span className="text-muted-foreground">Inv. día anterior</span>
                <span className="tabular-nums">{formatKg(Number(parte.kg_inventario_anterior_sin_alta))}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notas" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Notas</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ng">Notas generales</Label>
                <Textarea id="ng" rows={4} disabled={readOnly} maxLength={2000}
                  value={parte.notas_generales ?? ""}
                  onChange={(e) => update("notas_generales", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ni">Notas inventario</Label>
                <Textarea id="ni" rows={4} disabled={readOnly} maxLength={2000}
                  value={parte.notas_inventario ?? ""}
                  onChange={(e) => update("notas_inventario", e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
