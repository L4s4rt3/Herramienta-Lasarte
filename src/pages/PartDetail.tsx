import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { PARTES_QUERY_KEY, type Parte as CachedParte } from "@/hooks/usePartes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/StatusBadge";
import { SemaforoPill } from "@/components/SemaforoPill";
import { CascadeView } from "@/components/CascadeView";
import { computeCascade } from "@/lib/cascade";
import { formatDate } from "@/lib/format";
import { getSemaforo } from "@/lib/semaforo";
import { cn } from "@/lib/utils";
import { PART_DETAIL_MANUAL_FIELDS } from "@/lib/partDetailManualFields";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Lock, Unlock, Sparkles, Loader2, BarChart3, MoreHorizontal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportPartesDialog } from "@/components/ExportPartesDialog";
import PartDetailArchivos from "@/components/PartDetailArchivos";
import PartDetailCalidad from "@/components/PartDetailCalidad";
import PartDetailManual from "@/components/PartDetailManual";
import PartDetailNotas from "@/components/PartDetailNotas";

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

const CATEGORIES = [
  { id: "GSTOCK", label: "GSTOCK" },
  { id: "Produccion", label: "Producción" },
  { id: "FotoLotes", label: "Foto lotes" },
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

type ParteUpdatePayload = Partial<Record<keyof Parte, string | number | null>>;

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

      setParte(normalizeParte(p as CachedParte));
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
    return computeCascade({
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
  }, [parte]);

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

  async function handleUpload(cat: CategoryId, fileList: FileList | File[]) {
    if (!user || !parte) return;
    const list = Array.from(fileList);
    if (list.length === 0) return;
    setUploadingCat(cat);
    let ok = 0, fail = 0;
    for (const file of list) {
      const safeName = file.name
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.id}/${parte.id}/${cat}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("partes-archivos").upload(path, file);
      if (upErr) { fail++; console.error(upErr); continue; }
      const { error: dbErr } = await supabase.from("partes_archivos").insert({
        part_id: parte.id, user_id: user.id, file_name: file.name, file_path: path,
        file_type: cat, mime_type: file.type, file_size: file.size,
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
    await new Promise(r => setTimeout(r, 100));
    
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
          <Button variant="ghost" size="icon" onClick={() => navigate("/partes")}>
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
              : <><Sparkles className="h-4 w-4" />Analizar con IA</>
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

      <Card className="glass-accented">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <p className="panel-kicker">Resultado del parte</p>
              <CardTitle>Cascada DJPMN</CardTitle>
            </div>
            <span className={cn("shrink-0 text-lg font-semibold tabular-nums sm:text-xl", sem.text)}>
              {cascade.dsj_pct >= 0 ? "+" : ""}{cascade.dsj_pct.toFixed(2)}%
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <CascadeView result={cascade} />
          <div className="mt-4 rounded-xl glass p-3 text-xs text-muted-foreground">
            Sube los archivos en cada categoría y pulsa <strong>Analizar con IA</strong> para rellenar automáticamente.
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="archivos" className="w-full">
        <TabsList className="grid w-full grid-cols-4 sm:w-auto sm:inline-flex">
          <TabsTrigger value="archivos">Archivos</TabsTrigger>
          <TabsTrigger value="manual">Datos manuales</TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
          <TabsTrigger value="calidad">Calidad</TabsTrigger>
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

        {/* ── TAB: Notas ──────────────────────────────────────────────────── */}
        <TabsContent value="notas" className="mt-4">
          <PartDetailNotas
            parte={parte}
            readOnly={readOnly}
            update={update}
          />
        </TabsContent>

        <TabsContent value="calidad" className="mt-4">
          <PartDetailCalidad date={parte.date} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
