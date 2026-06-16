import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  Camera,
  Check,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { today } from "@/lib/format";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  CALIDAD_OPTIONS,
  attachmentCountMap,
  buildCalidadComentarioSugerido,
  buildComentarioCalidad,
  calidadSummary,
  exportCalidadToExcel,
  exportCalidadToPDF,
  extractDocxText,
  findCalidadHistoricoSimilar,
  formatCalidadDate,
  normalizeCalidadName,
  sameCalidadName,
  splitComentarioCalidad,
  type CalidadAdjunto,
  type CalidadEstado,
  type CalidadJornada,
  type CalidadLote,
  type CalidadProductor,
} from "@/lib/calidad";
import { cn } from "@/lib/utils";

const DEFECTOS = ["Rameado", "Golpe", "Podrido", "Mancha", "Calibre irregular", "Color bajo", "Piel blanda", "Falta presion"];
const RESPONSABLES = ["Eusebio Rodríguez"] as const;

const QUALITY_STYLES: Record<CalidadEstado, string> = {
  Bueno: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  Regular: "border-amber-500/35 bg-amber-500/14 text-amber-700 dark:text-amber-300",
  Deficiente: "border-orange-500/35 bg-orange-500/14 text-orange-700 dark:text-orange-300",
  Rechazado: "border-red-500/35 bg-red-500/12 text-red-700 dark:text-red-300",
};

function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
}

function cleanFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function glassInputClassName(extra?: string) {
  return cn(
    "h-10 rounded-xl border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-shadow)] backdrop-blur-xl focus:border-primary/45 focus:ring-primary/20",
    "[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70",
    extra,
  );
}

function isHistoricalProductorId(id: string | null | undefined) {
  return Boolean(id?.startsWith("db-"));
}

function productorIdForDatabase(id: string | null | undefined) {
  return id && !isHistoricalProductorId(id) ? id : null;
}

function DateGlassPicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="glass glass-hover h-11 w-full justify-start gap-2 rounded-xl border-[var(--glass-border-accent)] bg-[var(--glass-bg-strong)] px-3 font-semibold"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-primary/75" />
          <span className="tabular-nums">{value ? format(parseISO(value), "dd MMM yyyy", { locale: es }) : "Seleccionar..."}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 glass-accented" align="start">
        <Calendar
          mode="single"
          selected={value ? parseISO(value) : undefined}
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

const QUICK_TIMES = ["06:00", "07:00", "08:00", "09:00", "10:00", "12:00", "14:00", "16:00", "18:00"];

function normalizeTimeInput(input: string) {
  const clean = input.trim();
  if (!clean) return "";

  const colonMatch = clean.match(/^(\d{1,2}):([0-5]\d)$/);
  if (colonMatch) {
    const hour = Number(colonMatch[1]);
    if (hour <= 23) return `${String(hour).padStart(2, "0")}:${colonMatch[2]}`;
  }

  const digits = clean.replace(/\D/g, "");
  if (digits.length === 3 || digits.length === 4) {
    const padded = digits.padStart(4, "0");
    const hour = Number(padded.slice(0, 2));
    const minute = Number(padded.slice(2, 4));
    if (hour <= 23 && minute <= 59) return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
  }

  return null;
}

function TimeGlassPicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit(next: string) {
    const normalized = normalizeTimeInput(next);
    if (normalized === "") {
      setDraft("");
      onChange("");
      return;
    }
    if (normalized) {
      setDraft(normalized);
      onChange(normalized);
    }
  }

  function updateDraft(next: string) {
    setDraft(next);

    const digits = next.replace(/\D/g, "");
    if (digits.length >= 4) {
      const normalized = normalizeTimeInput(next);
      if (normalized) {
        setDraft(normalized);
        onChange(normalized);
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-primary/75" />
        <Input
          id={id}
          value={draft}
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={() => commit(draft)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(draft);
              setOpen(false);
            }
          }}
          placeholder="0600"
          inputMode="numeric"
          maxLength={5}
          className={glassInputClassName("pl-9 pr-10 font-semibold tabular-nums")}
        />
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg p-0 text-muted-foreground hover:text-foreground"
          >
            <Clock className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-72 glass-accented p-3" align="start">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hora de comienzo</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {QUICK_TIMES.map((time) => (
                <Button
                  key={time}
                  type="button"
                  variant={value === time ? "default" : "outline"}
                  size="sm"
                  className="glass glass-hover h-9 tabular-nums"
                  onClick={() => {
                    commit(time);
                    setOpen(false);
                  }}
                >
                  {time}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              onBlur={() => commit(draft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit(draft);
                  setOpen(false);
                }
              }}
              placeholder="0600"
              inputMode="numeric"
              maxLength={5}
              className={glassInputClassName("font-semibold tabular-nums")}
            />
            <Button type="button" variant="outline" className="glass glass-hover" onClick={() => commit("")}>
              Limpiar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function emptyLote(jornada: CalidadJornada, userId: string, index: number) {
  return {
    jornada_id: jornada.id,
    user_id: userId,
    fecha: jornada.fecha,
    numero_lote: "",
    productor_finca_id: null,
    productor_finca_nombre: "",
    producto: "Naranja",
    variedad: "",
    cantidad: "",
    hora: null,
    aerobotics_realizado: false,
    calidad: "Regular" as CalidadEstado,
    defectos: [],
    observacion: "",
    accion_recomendada: "",
    created_at: new Date(Date.now() + index).toISOString(),
  };
}

export default function CalidadJornadaPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDate = searchParams.get("fecha") || today();
  const [fecha, setFecha] = useState(initialDate);
  const [responsable, setResponsable] = useState("");
  const [responsableCustom, setResponsableCustom] = useState("");
  const [jornada, setJornada] = useState<CalidadJornada | null>(null);
  const [lotes, setLotes] = useState<CalidadLote[]>([]);
  const [historicalLotes, setHistoricalLotes] = useState<CalidadLote[]>([]);
  const [productores, setProductores] = useState<CalidadProductor[]>([]);
  const [adjuntos, setAdjuntos] = useState<CalidadAdjunto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comentarioDraft, setComentarioDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [productorPickerOpen, setProductorPickerOpen] = useState(false);
  const [productorSearch, setProductorSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wordInputRef = useRef<HTMLInputElement | null>(null);

  const attachmentCounts = useMemo(() => attachmentCountMap(adjuntos), [adjuntos]);
  const summary = useMemo(() => calidadSummary(lotes, attachmentCounts), [lotes, attachmentCounts]);
  const selected = useMemo(() => lotes.find((lote) => lote.id === selectedId) ?? lotes[0] ?? null, [lotes, selectedId]);
  const selectedAdjuntos = useMemo(() => adjuntos.filter((adjunto) => adjunto.lote_id === selected?.id), [adjuntos, selected?.id]);
  const selectedHistoricalSimilar = useMemo(
    () => (selected ? findCalidadHistoricoSimilar(selected, historicalLotes) : []),
    [historicalLotes, selected],
  );
  const responsableSelectValue = RESPONSABLES.includes(responsable as typeof RESPONSABLES[number]) ? responsable : "otro";
  const productorOptions = useMemo(() => {
    const byName = new Map<string, CalidadProductor>();
    for (const productor of productores) {
      const normalized = normalizeCalidadName(productor.nombre);
      if (!normalized) continue;
      const key = normalized.toLocaleLowerCase("es");
      const existing = byName.get(key);
      if (!existing || isHistoricalProductorId(existing.id) || !isHistoricalProductorId(productor.id)) {
        byName.set(key, { ...productor, nombre: normalized });
      }
    }
    return [...byName.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [productores]);
  const canCreateProductor = normalizeCalidadName(productorSearch).length > 0
    && !productorOptions.some((productor) => sameCalidadName(productor.nombre, productorSearch));

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [{ data: calidadProductoresData }, { data: parteProductoresData }, jornadaResponse, historicoResponse] = await Promise.all([
        supabase.from("calidad_productores" as any).select("*").order("nombre", { ascending: true }),
        supabase.from("lotes_dia" as any).select("productor").not("productor", "is", null).limit(5000),
        supabase.from("calidad_jornadas" as any).select("*").eq("fecha", fecha).maybeSingle(),
        supabase
          .from("calidad_lotes" as any)
          .select("*")
          .eq("user_id", user.id)
          .lt("fecha", fecha)
          .order("fecha", { ascending: false })
          .limit(300),
      ]);

      let currentJornada = jornadaResponse.data as CalidadJornada | null;
      if (jornadaResponse.error) throw jornadaResponse.error;
      if (historicoResponse.error) throw historicoResponse.error;

      if (!currentJornada) {
        const fallbackResponsible = "Eusebio Rodríguez";
        const { data: inserted, error } = await supabase
          .from("calidad_jornadas" as any)
          .insert({ user_id: user.id, fecha, responsable: fallbackResponsible })
          .select("*")
          .single();
        if (error) throw error;
        currentJornada = inserted as CalidadJornada;
      }

      const { data: lotesData, error: lotesError } = await supabase
        .from("calidad_lotes" as any)
        .select("*")
        .eq("jornada_id", currentJornada.id)
        .order("created_at", { ascending: true });
      if (lotesError) throw lotesError;

      const loadedLotes = (lotesData ?? []) as CalidadLote[];
      let loadedAdjuntos: CalidadAdjunto[] = [];
      if (loadedLotes.length > 0) {
        const { data: adjuntosData, error: adjuntosError } = await supabase
          .from("calidad_adjuntos" as any)
          .select("*")
          .in("lote_id", loadedLotes.map((lote) => lote.id))
          .order("created_at", { ascending: false });
        if (adjuntosError) throw adjuntosError;

        loadedAdjuntos = await Promise.all(
          ((adjuntosData ?? []) as CalidadAdjunto[]).map(async (adjunto) => {
            if (!adjunto.mime_type?.startsWith("image/")) return adjunto;
            const { data } = await supabase.storage.from("partes-archivos").createSignedUrl(adjunto.file_path, 60 * 60);
            return { ...adjunto, signedUrl: data?.signedUrl };
          }),
        );
      }

      const calidadProductores = (calidadProductoresData ?? []) as CalidadProductor[];
      const importedProductores = ((parteProductoresData ?? []) as Array<{ productor: string | null }>).flatMap((row) => {
        const nombre = normalizeCalidadName(row.productor ?? "");
        return nombre ? [{ id: `db-${nombre}`, nombre }] : [];
      });
      setProductores([...calidadProductores, ...importedProductores]);
      setHistoricalLotes((historicoResponse.data ?? []) as CalidadLote[]);
      setJornada(currentJornada);
      setResponsable(currentJornada.responsable || "");
      setResponsableCustom(RESPONSABLES.includes(currentJornada.responsable as typeof RESPONSABLES[number]) ? "" : currentJornada.responsable || "");
      setLotes(loadedLotes);
      setAdjuntos(loadedAdjuntos);
      setSelectedId((current) => (current && loadedLotes.some((lote) => lote.id === current) ? current : loadedLotes[0]?.id ?? null));
    } catch (error) {
      toast({ title: "Error cargando Calidad", description: errorMessage(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fecha, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setComentarioDraft(selected ? buildComentarioCalidad(selected) : "");
  }, [selected?.id]);

  function changeDate(nextDate: string) {
    setFecha(nextDate);
    setSearchParams({ fecha: nextDate });
    setSelectedId(null);
  }

  function patchSelected(patch: Partial<CalidadLote>) {
    if (!selected) return;
    setLotes((items) => items.map((lote) => (lote.id === selected.id ? { ...lote, ...patch } : lote)));
  }

  async function ensureProductor(nombre: string) {
    if (!user) return null;
    const trimmed = normalizeCalidadName(nombre);
    if (!trimmed) return null;
    const existing = productores.find((productor) => !isHistoricalProductorId(productor.id) && sameCalidadName(productor.nombre, trimmed));
    if (existing) return existing;

    const { data, error } = await supabase
      .from("calidad_productores" as any)
      .insert({ user_id: user.id, nombre: trimmed })
      .select("*")
      .single();
    if (error) throw error;
    const created = data as CalidadProductor;
    setProductores((items) => [...items, created].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
    return created;
  }

  async function createAndSelectProductor(nombre: string) {
    try {
      const productor = await ensureProductor(nombre);
      if (!productor) return;
      patchSelected({ productor_finca_id: productorIdForDatabase(productor.id), productor_finca_nombre: productor.nombre });
      setProductorSearch("");
      setProductorPickerOpen(false);
      toast({ title: "Productor/Finca guardado", description: productor.nombre });
    } catch (error) {
      toast({ title: "Error guardando productor", description: errorMessage(error), variant: "destructive" });
    }
  }

  function selectProductor(productor: CalidadProductor) {
    patchSelected({ productor_finca_id: productorIdForDatabase(productor.id), productor_finca_nombre: productor.nombre });
    setProductorSearch("");
    setProductorPickerOpen(false);
  }

  async function deleteProductor(productor: CalidadProductor) {
    if (isHistoricalProductorId(productor.id)) {
      toast({ title: "Nombre historico", description: "Este nombre viene de lotes ya importados y no se puede borrar desde Calidad." });
      return;
    }

    try {
      const { error } = await supabase.from("calidad_productores" as any).delete().eq("id", productor.id);
      if (error) throw error;
      setProductores((items) => items.filter((item) => item.id !== productor.id));
      if (selected?.productor_finca_id === productor.id || sameCalidadName(selected?.productor_finca_nombre ?? "", productor.nombre)) {
        patchSelected({ productor_finca_id: null, productor_finca_nombre: "" });
      }
      toast({ title: "Productor/Finca borrado", description: productor.nombre });
    } catch (error) {
      toast({ title: "Error borrando productor", description: errorMessage(error), variant: "destructive" });
    }
  }

  async function addLote() {
    if (!jornada || !user) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("calidad_lotes" as any)
        .insert(emptyLote(jornada, user.id, lotes.length))
        .select("*")
        .single();
      if (error) throw error;
      const created = data as CalidadLote;
      setLotes((items) => [...items, created]);
      setSelectedId(created.id);
    } catch (error) {
      toast({ title: "Error creando lote", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveJornada() {
    if (!jornada) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("calidad_jornadas" as any)
        .update({ responsable, estado: "guardada" })
        .eq("id", jornada.id);
      if (error) throw error;
      setJornada({ ...jornada, responsable, estado: "guardada" });
      toast({ title: "Jornada guardada", description: "Las anotaciones de calidad quedan disponibles para el parte de ese dia." });
    } catch (error) {
      toast({ title: "Error guardando jornada", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveLote() {
    if (!selected) return;
    setSaving(true);
    try {
      const productor = await ensureProductor(selected.productor_finca_nombre);
      const payload = {
        numero_lote: selected.numero_lote.trim(),
        productor_finca_id: productorIdForDatabase(productor?.id ?? selected.productor_finca_id),
        productor_finca_nombre: selected.productor_finca_nombre.trim(),
        producto: selected.producto.trim(),
        variedad: selected.variedad.trim(),
        cantidad: selected.cantidad.trim(),
        hora: selected.hora || null,
        aerobotics_realizado: selected.aerobotics_realizado,
        calidad: selected.calidad,
        defectos: selected.defectos,
        observacion: selected.observacion.trim(),
        accion_recomendada: selected.accion_recomendada.trim(),
      };
      const { data, error } = await supabase.from("calidad_lotes" as any).update(payload).eq("id", selected.id).select("*").single();
      if (error) throw error;
      const saved = data as CalidadLote;
      setLotes((items) => items.map((lote) => (lote.id === saved.id ? saved : lote)));
      toast({ title: "Lote guardado", description: selected.numero_lote ? `Lote ${selected.numero_lote}` : "Anotacion actualizada" });
    } catch (error) {
      toast({ title: "Error guardando lote", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteLote(lote: CalidadLote) {
    setSaving(true);
    try {
      const files = adjuntos.filter((adjunto) => adjunto.lote_id === lote.id);
      const paths = files.map((file) => file.file_path).filter(Boolean);
      if (paths.length > 0) await supabase.storage.from("partes-archivos").remove(paths);
      const { error } = await supabase.from("calidad_lotes" as any).delete().eq("id", lote.id);
      if (error) throw error;
      setLotes((items) => items.filter((item) => item.id !== lote.id));
      setAdjuntos((items) => items.filter((item) => item.lote_id !== lote.id));
      setSelectedId((current) => (current === lote.id ? null : current));
      toast({ title: "Lote eliminado" });
    } catch (error) {
      toast({ title: "Error eliminando lote", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || !selected || !user || !jornada) return;
    const fileList = Array.from(files);
    if (fileList.length === 0) return;
    setUploading(true);
    try {
      const created: CalidadAdjunto[] = [];
      for (const file of fileList) {
        const path = `${user.id}/calidad/${jornada.id}/${selected.id}/${crypto.randomUUID()}-${cleanFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from("partes-archivos").upload(path, file);
        if (uploadError) throw uploadError;
        const { data, error } = await supabase
          .from("calidad_adjuntos" as any)
          .insert({ lote_id: selected.id, user_id: user.id, file_name: file.name, file_path: path, mime_type: file.type, file_size: file.size })
          .select("*")
          .single();
        if (error) throw error;
        const adjunto = data as CalidadAdjunto;
        if (adjunto.mime_type?.startsWith("image/")) {
          const { data: signed } = await supabase.storage.from("partes-archivos").createSignedUrl(adjunto.file_path, 60 * 60);
          created.push({ ...adjunto, signedUrl: signed?.signedUrl });
        } else {
          created.push(adjunto);
        }
      }
      setAdjuntos((items) => [...created, ...items]);
      toast({ title: `${created.length} adjunto(s) subido(s)` });
    } catch (error) {
      toast({ title: "Error subiendo adjunto", description: errorMessage(error), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteAdjunto(adjunto: CalidadAdjunto) {
    try {
      await supabase.storage.from("partes-archivos").remove([adjunto.file_path]);
      const { error } = await supabase.from("calidad_adjuntos" as any).delete().eq("id", adjunto.id);
      if (error) throw error;
      setAdjuntos((items) => items.filter((item) => item.id !== adjunto.id));
      toast({ title: "Adjunto eliminado" });
    } catch (error) {
      toast({ title: "Error eliminando adjunto", description: errorMessage(error), variant: "destructive" });
    }
  }

  function toggleDefecto(defecto: string) {
    if (!selected) return;
    const next = selected.defectos.includes(defecto)
      ? selected.defectos.filter((item) => item !== defecto)
      : [...selected.defectos, defecto];
    patchSelected({ defectos: next });
  }

  function patchComentario(value: string) {
    setComentarioDraft(value);
    const fields = splitComentarioCalidad(value);
    patchSelected(fields);
  }

  async function importComentarioFile(files: FileList | null) {
    const file = files?.[0];
    if (!file || !selected) return;

    try {
      const lowerName = file.name.toLowerCase();
      let text = "";
      if (lowerName.endsWith(".docx")) {
        text = extractDocxText(new Uint8Array(await file.arrayBuffer()));
      } else if (lowerName.endsWith(".txt")) {
        text = await file.text();
      } else {
        throw new Error("Importa un Word en formato .docx o un archivo .txt.");
      }

      patchComentario(text);
      toast({ title: "Comentario importado", description: file.name });
    } catch (error) {
      toast({ title: "Error importando Word", description: errorMessage(error), variant: "destructive" });
    } finally {
      if (wordInputRef.current) wordInputRef.current.value = "";
    }
  }

  function generateComentario() {
    if (!selected) return;
    const photoCount = attachmentCounts[selected.id] ?? 0;
    patchComentario(buildCalidadComentarioSugerido(selected, historicalLotes, photoCount));
    toast({
      title: "Comentario generado",
      description: selectedHistoricalSimilar.length > 0
        ? `Comparado con ${selectedHistoricalSimilar.length} registro(s) historico(s).`
        : "Sin historico similar previo, usando datos del lote y calidad.",
    });
  }

  if (loading) {
    return (
      <div className="page-shell">
        <div className="flex min-h-[42vh] items-center justify-center">
          <div className="flex items-center gap-3 rounded-xl glass-accented px-5 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Cargando jornada de calidad...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">Departamento de Calidad</p>
          <h1 className="page-title">Jornada de Calidad</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Notas de lotes para informes diarios, conectadas con el parte de la misma fecha.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="glass glass-hover" onClick={() => jornada && exportCalidadToPDF(jornada, lotes, adjuntos)} disabled={!jornada || lotes.length === 0}>
            <Download className="h-4 w-4" />
            PDF
          </Button>
          <Button variant="outline" className="glass glass-hover" onClick={() => jornada && exportCalidadToExcel(jornada, lotes, adjuntos)} disabled={!jornada || lotes.length === 0}>
            <FileSpreadsheet className="h-4 w-4" />
            Excel
          </Button>
          <Button className="glass glass-hover" onClick={saveJornada} disabled={saving || !jornada}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar jornada
          </Button>
        </div>
      </header>

      <Card className="glass-accented">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-[minmax(180px,0.7fr)_minmax(240px,1fr)_repeat(4,minmax(120px,0.6fr))]">
          <div className="space-y-2">
            <Label htmlFor="fecha-calidad" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Fecha
            </Label>
            <DateGlassPicker id="fecha-calidad" value={fecha} onChange={changeDate} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="responsable-calidad" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Responsable
            </Label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Select
                value={responsableSelectValue}
                onValueChange={(value) => {
                  if (value === "otro") {
                    setResponsable(responsableCustom || "");
                    return;
                  }
                  setResponsable(value);
                  setResponsableCustom("");
                }}
              >
                <SelectTrigger id="responsable-calidad" className="glass glass-hover">
                  <SelectValue placeholder="Responsable" />
                </SelectTrigger>
                <SelectContent>
                  {RESPONSABLES.map((persona) => (
                    <SelectItem key={persona} value={persona}>{persona}</SelectItem>
                  ))}
                  <SelectItem value="otro">Otra persona</SelectItem>
                </SelectContent>
              </Select>
              {responsableSelectValue === "otro" && (
                <Input
                  value={responsableCustom}
                  onChange={(event) => {
                    setResponsableCustom(event.target.value);
                    setResponsable(event.target.value);
                  }}
                  placeholder="Nombre responsable"
                  className={glassInputClassName()}
                />
              )}
            </div>
          </div>
          {[
            { label: "Lotes", value: summary.total },
            { label: "Aerobotics", value: summary.aerobotics },
            { label: "Bueno", value: summary.byQuality.Bueno },
            { label: "Regular", value: summary.byQuality.Regular },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-primary/10 bg-[var(--glass-bg)] px-4 py-3 shadow-[var(--glass-shadow)]">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{stat.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.86fr)_minmax(0,1.5fr)]">
        <Card className="glass">
          <CardHeader className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="panel-kicker">Lotes ({summary.total})</p>
                <CardTitle className="text-xl">Notas del dia</CardTitle>
              </div>
              <Button size="sm" onClick={addLote} disabled={saving || !jornada} className="glass glass-hover">
                <Plus className="h-4 w-4" />
                Añadir
              </Button>
            </div>
            <div className="rounded-xl border border-primary/10 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Al abrir un parte de {formatCalidadDate(fecha)}, estas notas apareceran en su pestaña de Calidad.
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {lotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-primary/25 bg-[var(--glass-bg)] p-5 text-center">
                <Search className="mx-auto h-6 w-6 text-primary" />
                <p className="mt-2 text-sm font-medium">Sin lotes todavia</p>
                <p className="mt-1 text-xs text-muted-foreground">Crea el primer lote y empieza a tomar notas.</p>
              </div>
            ) : (
              lotes.map((lote, index) => {
                const active = selected?.id === lote.id;
                return (
                  <button
                    key={lote.id}
                    type="button"
                    onClick={() => setSelectedId(lote.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition-all hover:border-primary/30 hover:bg-primary/5",
                      active ? "border-primary/40 bg-primary/8 shadow-[var(--glass-shadow)]" : "border-border/70 bg-[var(--glass-bg)]",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-semibold">{lote.productor_finca_nombre || "Productor/Finca pendiente"}</p>
                          <Badge variant="outline" className={cn("shrink-0", QUALITY_STYLES[lote.calidad])}>
                            {lote.calidad}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {lote.numero_lote || "Sin lote"} · {lote.variedad || lote.producto || "Sin producto"} · {lote.cantidad || "Sin cantidad"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {lote.aerobotics_realizado && (
                            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                              Aerobotics
                            </Badge>
                          )}
                          {(attachmentCounts[lote.id] ?? 0) > 0 && (
                            <Badge variant="outline" className="border-primary/20 bg-primary/8">
                              {attachmentCounts[lote.id]} foto(s)
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="glass-accented">
          {selected ? (
            <>
              <CardHeader className="gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="panel-kicker">Ficha de lote</p>
                    <CardTitle className="text-xl">
                      {selected.numero_lote ? `Lote ${selected.numero_lote}` : "Nuevo lote"}
                    </CardTitle>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="glass glass-hover" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                      Fotos
                    </Button>
                    <Button variant="outline" className="glass glass-hover text-destructive hover:text-destructive" onClick={() => deleteLote(selected)} disabled={saving}>
                      <Trash2 className="h-4 w-4" />
                      Eliminar
                    </Button>
                    <Button className="glass glass-hover" onClick={saveLote} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Guardar lote
                    </Button>
                  </div>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf,.xlsx,.xls,.doc,.docx" multiple className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
                <input ref={wordInputRef} type="file" accept=".docx,.txt" className="hidden" onChange={(event) => importComentarioFile(event.target.files)} />
              </CardHeader>
              <CardContent className="space-y-6">
                <section className="grid gap-4 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="numero-lote">Lote</Label>
                    <Input id="numero-lote" value={selected.numero_lote} onChange={(event) => patchSelected({ numero_lote: event.target.value })} placeholder="26041704" className={glassInputClassName()} />
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor="productor-finca">Productor/Finca</Label>
                    <Popover open={productorPickerOpen} onOpenChange={setProductorPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          id="productor-finca"
                          type="button"
                          variant="outline"
                          className="glass glass-hover h-10 w-full justify-between rounded-xl px-3 text-left font-normal"
                        >
                          <span className={cn("truncate", !selected.productor_finca_nombre && "text-muted-foreground")}>
                            {selected.productor_finca_nombre || "Elegir productor/finca"}
                          </span>
                          <Search className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-0" align="start">
                        <Command shouldFilter>
                          <CommandInput
                            placeholder="Buscar o escribir nuevo productor/finca..."
                            value={productorSearch}
                            onValueChange={setProductorSearch}
                          />
                          <CommandList>
                            <CommandEmpty>
                              <div className="space-y-3 p-3 text-center">
                                <p className="text-sm text-muted-foreground">No aparece ese productor/finca.</p>
                                {canCreateProductor && (
                                  <Button size="sm" className="glass glass-hover" onClick={() => createAndSelectProductor(productorSearch)}>
                                    <Plus className="h-4 w-4" />
                                    Crear "{normalizeCalidadName(productorSearch)}"
                                  </Button>
                                )}
                              </div>
                            </CommandEmpty>
                            <CommandGroup heading="Productores/Fincas">
                              {productorOptions.map((productor) => (
                                <div key={productor.id} className="flex items-center gap-1 rounded-xl">
                                  <CommandItem
                                    value={productor.nombre}
                                    onSelect={() => selectProductor(productor)}
                                    className="min-w-0 flex-1 rounded-xl"
                                  >
                                    <Check className={cn("mr-2 h-4 w-4", sameCalidadName(selected.productor_finca_nombre, productor.nombre) ? "opacity-100" : "opacity-0")} />
                                    <span className="truncate">{productor.nombre}</span>
                                  </CommandItem>
                                  {!isHistoricalProductorId(productor.id) && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="mr-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                      title="Borrar productor/finca"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void deleteProductor(productor);
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </CommandGroup>
                            {canCreateProductor && (
                              <CommandGroup heading="Nuevo">
                                <CommandItem value={`crear-${productorSearch}`} onSelect={() => createAndSelectProductor(productorSearch)} className="rounded-xl">
                                  <Plus className="mr-2 h-4 w-4" />
                                  Crear "{normalizeCalidadName(productorSearch)}"
                                </CommandItem>
                              </CommandGroup>
                            )}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hora-lote">Hora</Label>
                    <TimeGlassPicker id="hora-lote" value={selected.hora ?? ""} onChange={(value) => patchSelected({ hora: value || null })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="producto-lote">Producto</Label>
                    <Input id="producto-lote" value={selected.producto} onChange={(event) => patchSelected({ producto: event.target.value })} className={glassInputClassName()} />
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor="variedad-lote">Variedad</Label>
                    <Input id="variedad-lote" value={selected.variedad} onChange={(event) => patchSelected({ variedad: event.target.value })} placeholder="Navel Powell" className={glassInputClassName()} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cantidad-lote">Cantidad</Label>
                    <Input id="cantidad-lote" value={selected.cantidad} onChange={(event) => patchSelected({ cantidad: event.target.value })} placeholder="64 Box" className={glassInputClassName()} />
                  </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="space-y-3 rounded-xl border border-border/70 bg-[var(--glass-bg)] p-4">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Calidad</Label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {CALIDAD_OPTIONS.map((quality) => (
                        <button
                          key={quality}
                          type="button"
                          onClick={() => patchSelected({ calidad: quality })}
                          className={cn(
                            "min-h-10 rounded-xl border px-3 text-sm font-semibold transition-all",
                            selected.calidad === quality ? QUALITY_STYLES[quality] : "border-border/70 bg-background/70 text-muted-foreground hover:border-primary/30",
                          )}
                        >
                          {quality}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {DEFECTOS.map((defecto) => {
                        const checked = selected.defectos.includes(defecto);
                        return (
                          <button
                            key={defecto}
                            type="button"
                            onClick={() => toggleDefecto(defecto)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                              checked ? "border-primary/35 bg-primary/10 text-primary" : "border-border/75 bg-background/70 text-muted-foreground hover:border-primary/30",
                            )}
                          >
                            {defecto}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-xl border border-primary/15 bg-primary/6 p-4">
                    <div className="min-w-0">
                      <Label htmlFor="aerobotics-lote" className="text-base font-semibold">
                        Aerobotics
                      </Label>
                      <p className="mt-1 text-xs text-muted-foreground">Confirmar si se ha realizado para este lote.</p>
                    </div>
                    <Switch id="aerobotics-lote" checked={selected.aerobotics_realizado} onCheckedChange={(checked) => patchSelected({ aerobotics_realizado: checked })} />
                  </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="comentario-lote">Comentario / observaciones</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" className="glass glass-hover" onClick={() => wordInputRef.current?.click()}>
                          <FileText className="h-4 w-4" />
                          Word
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="glass glass-hover" onClick={generateComentario}>
                          <Sparkles className="h-4 w-4" />
                          Generar
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      id="comentario-lote"
                      value={comentarioDraft}
                      onChange={(event) => patchComentario(event.target.value)}
                      placeholder="Como entra el lote, incidencias, calibre, color...\n\nAccion recomendada: Separar, revisar en linea, avisar al productor..."
                      className="min-h-36"
                    />
                  </div>

                  <div className="rounded-xl border border-border/70 bg-[var(--glass-bg)] p-4">
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold">Historico similar</p>
                    </div>
                    {selectedHistoricalSimilar.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">Sin registros similares previos.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {selectedHistoricalSimilar.map((lote) => (
                          <div key={lote.id} className="rounded-lg border border-border/60 bg-background/60 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-muted-foreground">{formatCalidadDate(lote.fecha)}</p>
                              <Badge variant="outline" className={cn("shrink-0", QUALITY_STYLES[lote.calidad])}>
                                {lote.calidad}
                              </Badge>
                            </div>
                            <p className="mt-1 truncate text-sm font-medium">{lote.productor_finca_nombre || "Sin productor/finca"}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {lote.variedad || lote.producto || "Sin variedad"} - {lote.cantidad || "Sin box"} - {lote.hora || "Sin hora"}
                            </p>
                            {(lote.observacion || lote.accion_recomendada) && (
                              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                {buildComentarioCalidad(lote)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Adjuntos</p>
                      <p className="text-xs text-muted-foreground">Fotos o documentos del lote.</p>
                    </div>
                    <Button variant="outline" size="sm" className="glass glass-hover" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      <ImageIcon className="h-4 w-4" />
                      Añadir
                    </Button>
                  </div>
                  {selectedAdjuntos.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 bg-[var(--glass-bg)] p-4 text-sm text-muted-foreground">
                      Todavia no hay adjuntos para este lote.
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {selectedAdjuntos.map((adjunto) => (
                        <div key={adjunto.id} className="overflow-hidden rounded-xl border border-border/70 bg-background/70">
                          {adjunto.signedUrl ? (
                            <img src={adjunto.signedUrl} alt={adjunto.file_name} className="h-32 w-full object-cover" />
                          ) : (
                            <div className="flex h-32 items-center justify-center bg-primary/6">
                              <ImageIcon className="h-7 w-7 text-primary" />
                            </div>
                          )}
                          <div className="flex items-center gap-2 p-2">
                            <p className="min-w-0 flex-1 truncate text-xs font-medium">{adjunto.file_name}</p>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteAdjunto(adjunto)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex min-h-[480px] items-center justify-center">
              <div className="max-w-sm text-center">
                <BadgeCheck className="mx-auto h-10 w-10 text-primary" />
                <h2 className="mt-4 text-xl font-semibold">Prepara la jornada</h2>
                <p className="mt-2 text-sm text-muted-foreground">Añade un lote para empezar a registrar las notas de calidad del dia.</p>
                <Button className="mt-5 glass glass-hover" onClick={addLote} disabled={!jornada || saving}>
                  <Plus className="h-4 w-4" />
                  Añadir primer lote
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {summary.byQuality.Deficiente + summary.byQuality.Rechazado > 0 && (
        <Card className="glass border-orange-500/25 bg-orange-500/6">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Hay lotes con incidencia</p>
              <p className="text-xs text-muted-foreground">Quedaran visibles en el parte de {formatCalidadDate(fecha)} para que el informe no pierda contexto.</p>
            </div>
            <Button variant="outline" className="glass glass-hover" asChild>
              <Link to={`/partes?fecha=${fecha}`}>Ir a partes</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
