import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { CascadeView } from "@/components/CascadeView";
import { computeCascade } from "@/lib/cascade";
import { formatDate } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Lock, Unlock, Sparkles, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportPartesDialog } from "@/components/ExportPartesDialog";
import PartDetailArchivos from "@/components/PartDetailArchivos";
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

interface Archivo {
  id: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  uploaded_at: string;
}

export default function PartDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [parte, setParte] = useState<Parte | null>(null);
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const loadingRef = useRef(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadingCat, setUploadingCat] = useState<CategoryId | null>(null);

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

      if (!Number(p.kg_inventario_anterior_sin_alta)) {
        const { data: prev } = await supabase
          .from("partes_diarios")
          .select("kg_inventario_sin_alta, date")
          .eq("user_id", p.user_id)
          .lt("date", p.date)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (prev && Number(prev.kg_inventario_sin_alta) > 0) {
          await supabase.from("partes_diarios")
            .update({ kg_inventario_anterior_sin_alta: Number(prev.kg_inventario_sin_alta) })
            .eq("id", id);
          p.kg_inventario_anterior_sin_alta = Number(prev.kg_inventario_sin_alta);
        }
      }

      setParte(p as Parte);
      setArchivos((files ?? []) as Archivo[]);
      loadingRef.current = false;
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }, [id, navigate]);

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
    const payload: any = {
      notas_generales: parte.notas_generales,
      notas_inventario: parte.notas_inventario,
    };
    MANUAL_FIELDS.forEach((f) => (payload[f.key] = Number(parte[f.key] || 0)));
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
        kg_industria_manual: Number(parte.kg_industria_manual) || 0,
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

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/partes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-title">
              Parte ·{" "}
              <Link to="/calendario" className="text-primary hover:underline">
                {formatDate(parte.date)}
              </Link>
            </h1>
            <div className="mt-1"><StatusBadge estado={parte.estado} /></div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportPartesDialog defaultFrom={parte.date} defaultTo={parte.date} />
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
          <Button variant="outline" onClick={toggleEstado} className="glass glass-hover">
            {parte.estado === "Borrador"
              ? <><Lock className="h-4 w-4" />Cerrar</>
              : <><Unlock className="h-4 w-4" />Reabrir</>}
          </Button>
          <Button onClick={save} disabled={saving || readOnly} className="glass glass-hover">
            <Save className="h-4 w-4" />Guardar
          </Button>
        </div>
      </header>

      <Card className="glass-accented">
        <CardHeader>
          <p className="panel-kicker">Resultado del parte</p>
          <CardTitle>Cascada DJPMN</CardTitle>
        </CardHeader>
        <CardContent>
          <CascadeView result={cascade} />
          <div className="mt-4 rounded-xl glass p-3 text-xs text-muted-foreground">
            Sube los archivos en cada categoría y pulsa <strong>Analizar con IA</strong> para rellenar automáticamente.
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="archivos" className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
          <TabsTrigger value="archivos">Archivos</TabsTrigger>
          <TabsTrigger value="manual">Datos manuales</TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
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
            MANUAL_FIELDS={MANUAL_FIELDS}
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
      </Tabs>
    </div>
  );
}
