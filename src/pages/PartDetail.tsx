import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { computeCascade } from "@/lib/cascade";
import { formatDate, formatKg } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Lock, Unlock, Upload, Trash2, Sparkles, FileText, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportPartesDialog } from "@/components/ExportPartesDialog";

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
      // Forzar refresco sin cache de Supabase
      const [{ data: p, error }, { data: files }] = await Promise.all([
        supabase.from("partes_diarios").select("*").eq("id", id).maybeSingle(),
        supabase.from("partes_archivos").select("*").eq("part_id", id).order("uploaded_at", { ascending: false }),
      ]);
      if (error) {
        console.error("[LOAD] Error cargando parte:", error);
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }
      if (!p) {
        console.error("[LOAD] Parte no encontrada");
        toast({ title: "Error", description: "Parte no encontrada", variant: "destructive" });
        navigate("/partes");
        return;
      }
      
      console.log("[LOAD] Datos actualizados:", {
        id: p.id,
        kg_produccion_calibrador: p.kg_produccion_calibrador,
        kg_mujeres_calibrador: p.kg_mujeres_calibrador,
        kg_palets_brutos: p.kg_palets_brutos,
        kg_podrido_calibrador_auto: p.kg_podrido_calibrador_auto,
        kg_industria_manual: p.kg_industria_manual,
        kg_reciclado_malla_z1: p.kg_reciclado_malla_z1,
        kg_reciclado_malla_z2: p.kg_reciclado_malla_z2,
        kg_inventario_sin_alta: p.kg_inventario_sin_alta,
        kg_podrido_bolsa_basura: p.kg_podrido_bolsa_basura,
      });
      
      // Forzar actualización creando una nueva referencia del objeto
      setParte(p as Parte);
      setArchivos((files ?? []) as Archivo[]);
      loadingRef.current = false;
    } catch (e) {
      console.error("[LOAD] Exception:", e);
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
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
          <Button
            variant="default"
            onClick={analyze}
            disabled={analyzing || archivos.length === 0}
          >
            {analyzing
              ? <><Loader2 className="h-4 w-4 animate-spin" />Analizando…</>
              : <><Sparkles className="h-4 w-4" />Analizar con IA</>
            }
          </Button>
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
            Sube los archivos en cada categoría y pulsa <strong>Analizar con IA</strong> para rellenar automáticamente.
          </p>
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
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Archivos del parte</CardTitle>
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
                            if (e.target.files && e.target.files.length > 0) handleUpload(c.id, e.target.files);
                            e.target.value = "";
                          }}
                        />
                        <Button asChild size="sm" variant="outline" className="w-full cursor-pointer" disabled={readOnly || uploadingCat === c.id}>
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
                              <button onClick={() => handleDeleteFile(a)} className="text-muted-foreground hover:text-destructive" aria-label="Eliminar">
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
                Sube los informes Excel y fotos en su categoría. Luego pulsa <strong>Analizar con IA</strong> para extraer los datos automáticamente.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB: Datos manuales ─────────────────────────────────────────── */}
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
            <CardHeader><CardTitle className="text-lg">Datos automáticos (IA)</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
              {[
                ["Producción calibrador", parte.kg_produccion_calibrador],
                ["Mujeres (L)", parte.kg_mujeres_calibrador],
                ["Palets alta (bruto)", parte.kg_palets_brutos],
                ["Podrido calibrador", parte.kg_podrido_calibrador_auto],
                ["Inv. día anterior", parte.kg_inventario_anterior_sin_alta],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between border-b py-1">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="tabular-nums">{formatKg(Number(val))}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB: Notas ──────────────────────────────────────────────────── */}
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
