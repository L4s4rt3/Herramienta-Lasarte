import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Camera,
  Check,
  ChevronDown,
  Circle,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import {
  useCalidadHistoricoRango,
  useCalidadJornadaDia,
  useCalidadJornadaMutaciones,
} from "@/hooks/useCalidadJornada";
import { today } from "@/lib/format";
import {
  CALIDAD_OPTIONS,
  DEFECTO_OPTIONS,
  attachmentCountMap,
  buildCalidadComentarioSugerido,
  buildComentarioCalidad,
  buildLotesParaImportar,
  calidadSummary,
  canValidateCalidadLote,
  createCalidadDraftReport,
  exportCalidadToExcel,
  exportCalidadToPDF,
  extractDocxText,
  findCalidadHistoricoSimilar,
  formatCalidadDate,
  formatHoraCorta,
  formatKgCantidad,
  isCalidadLoteLocked,
  normalizeCalidadName,
  reopenCalidadLote,
  sameCalidadName,
  sameLoteCodigo,
  splitComentarioCalidad,
  validateCalidadLote,
  type CalidadAdjunto,
  type CalidadEstado,
  type CalidadInformeEstado,
  type CalidadJornada,
  type CalidadLote,
  type CalidadProductor,
  type LoteDiaImportable,
} from "@/lib/calidad";
import { cn } from "@/lib/utils";
import { SelectorPeriodo } from "@/components/SelectorPeriodo";
import { CalidadHistoricoTab } from "@/components/calidad/CalidadHistoricoTab";
import { CalidadAdjuntoThumb } from "@/components/calidad/CalidadAdjuntoThumb";
import { PartFilePreviewDialog, type PreviewableArchivo } from "@/components/PartFilePreviewDialog";

const RESPONSABLES = ["Eusebio Rodríguez"] as const;

const QUALITY_STYLES: Record<CalidadEstado, string> = {
  Excelente: "border-success/40 bg-success/10 text-success",
  Bueno: "border-success/40 bg-success/10 text-success",
  Regular: "border-warning/40 bg-warning/10 text-warning",
  Deficiente: "border-warning/40 bg-warning/10 text-warning",
  Pésimo: "border-destructive/40 bg-destructive/10 text-destructive",
};

const QUALITY_BAR: Record<CalidadEstado, string> = {
  Excelente: "bg-success",
  Bueno: "bg-success/80",
  Regular: "bg-warning",
  Deficiente: "bg-warning/80",
  Pésimo: "bg-destructive",
};

type LoteFiltro = "todos" | "revisar" | "validados" | "borrador";

const LOTE_FILTROS: { value: LoteFiltro; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "revisar", label: "Revisar" },
  { value: "validados", label: "Validados" },
  { value: "borrador", label: "Borrador" },
];

function esLoteRevisar(lote: CalidadLote) {
  return lote.calidad === "Regular" || lote.calidad === "Deficiente" || lote.calidad === "Pésimo";
}

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

function currentHora() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function emptyLote(jornada: CalidadJornada, userId: string, index: number, overrides: Partial<{
  numero_lote: string;
  productor_finca_nombre: string;
  producto: string;
  variedad: string;
  cantidad: string;
  hora: string | null;
}> = {}) {
  return {
    jornada_id: jornada.id,
    user_id: userId,
    fecha: jornada.fecha,
    numero_lote: overrides.numero_lote ?? "",
    productor_finca_id: null,
    productor_finca_nombre: overrides.productor_finca_nombre ?? "",
    producto: overrides.producto ?? "Naranja",
    variedad: overrides.variedad ?? "",
    cantidad: overrides.cantidad ?? "",
    hora: overrides.hora ?? currentHora(),
    aerobotics_realizado: false,
    calidad: "Regular" as CalidadEstado,
    defectos: [],
    defecto_otro: "",
    observacion: "",
    accion_recomendada: "",
    informe_estado: "borrador" as CalidadInformeEstado,
    informe_generado: "",
    ia_calidad: null,
    ia_defectos: [],
    ia_resumen: "",
    ia_accion_recomendada: "",
    validado_at: null,
    validado_by: null,
    reabierto_at: null,
    reabierto_by: null,
    motivo_reapertura: "",
    created_at: new Date(Date.now() + index).toISOString(),
    updated_at: new Date(Date.now() + index).toISOString(),
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
  const [lotesDia, setLotesDia] = useState<LoteDiaImportable[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comentarioDraft, setComentarioDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [productorPickerOpen, setProductorPickerOpen] = useState(false);
  const [productorSearch, setProductorSearch] = useState("");
  const [loteFiltro, setLoteFiltro] = useState<LoteFiltro>("todos");
  const [tab, setTab] = useState<"jornada" | "historico">("jornada");
  const [previewArchivo, setPreviewArchivo] = useState<PreviewableArchivo | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wordInputRef = useRef<HTMLInputElement | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autosaveTimerRef = useRef<number | null>(null);
  // Recuerda la última fecha ya volcada a estado local editable, para no
  // pisar ediciones en curso (autoguardado con debounce, lote seleccionado...)
  // cuando una mutación (addLote, deleteLote...) invalida y refresca el
  // bundle del día en segundo plano. Ver cabecera de useCalidadJornada.ts.
  const syncedFechaRef = useRef<string | null>(null);

  const { data: diaData, isLoading: loading } = useCalidadJornadaDia(fecha);
  const { data: historicoRango = [], isLoading: historicoLoading } = useCalidadHistoricoRango(tab === "historico");
  const {
    invalidate,
    updateJornadaMutation,
    updateLoteMutation,
    insertProductorMutation,
    deleteProductorMutation,
    insertLoteMutation,
    insertLotesBatchMutation,
    deleteLoteMutation,
    uploadAdjuntosMutation,
    deleteAdjuntoMutation,
  } = useCalidadJornadaMutaciones();

  const attachmentCounts = useMemo(() => attachmentCountMap(adjuntos), [adjuntos]);
  const summary = useMemo(() => calidadSummary(lotes, attachmentCounts), [lotes, attachmentCounts]);
  const validadosCount = useMemo(() => lotes.filter((lote) => isCalidadLoteLocked(lote)).length, [lotes]);
  const filteredLotes = useMemo(() => {
    switch (loteFiltro) {
      case "revisar":
        return lotes.filter((lote) => esLoteRevisar(lote));
      case "validados":
        return lotes.filter((lote) => isCalidadLoteLocked(lote));
      case "borrador":
        return lotes.filter((lote) => !isCalidadLoteLocked(lote));
      default:
        return lotes;
    }
  }, [lotes, loteFiltro]);
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

  // Vuelca el bundle del día (jornada/lotes/adjuntos/lotesDia/productores/
  // historicalLotes) a estado local editable, igual que hacía el `load()`
  // original — pero SOLO la primera vez que llega para cada `fecha`. Las
  // mutaciones (addLote, saveLote...) ya aplican su propio update optimista
  // sobre el estado local; si este efecto se repitiera en cada refetch que
  // dispara `invalidate()`, pisaría ediciones en curso de otros lotes (o el
  // campo "Responsable" sin guardar) con la última foto del servidor.
  useEffect(() => {
    if (!diaData || syncedFechaRef.current === fecha) return;
    syncedFechaRef.current = fecha;
    setProductores(diaData.productores);
    setHistoricalLotes(diaData.historicalLotes);
    setJornada(diaData.jornada);
    setResponsable(diaData.jornada.responsable || "");
    setResponsableCustom(
      RESPONSABLES.includes(diaData.jornada.responsable as typeof RESPONSABLES[number]) ? "" : diaData.jornada.responsable || "",
    );
    setLotes(diaData.lotes);
    setAdjuntos(diaData.adjuntos);
    setLotesDia(diaData.lotesDia);
    setSelectedId((current) => (current && diaData.lotes.some((lote) => lote.id === current) ? current : diaData.lotes[0]?.id ?? null));
  }, [diaData, fecha]);

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
    scheduleAutosave({ ...selected, ...patch });
  }

  async function persistLote(lote: CalidadLote) {
    if (!user) return;
    setAutosaveStatus("saving");
    try {
      const payload = {
        numero_lote: lote.numero_lote.trim(),
        productor_finca_id: lote.productor_finca_id,
        productor_finca_nombre: lote.productor_finca_nombre.trim(),
        producto: lote.producto.trim(),
        variedad: lote.variedad.trim(),
        cantidad: lote.cantidad.trim(),
        hora: lote.hora || null,
        aerobotics_realizado: lote.aerobotics_realizado,
        calidad: lote.calidad,
        defectos: lote.defectos,
        defecto_otro: lote.defecto_otro,
        observacion: lote.observacion.trim(),
        accion_recomendada: lote.accion_recomendada.trim(),
        informe_estado: lote.informe_estado,
        informe_generado: lote.informe_generado,
        ia_calidad: lote.ia_calidad,
        ia_defectos: lote.ia_defectos,
        ia_resumen: lote.ia_resumen,
        ia_accion_recomendada: lote.ia_accion_recomendada,
        validado_at: lote.validado_at,
        validado_by: lote.validado_by,
        reabierto_at: lote.reabierto_at,
        reabierto_by: lote.reabierto_by,
        motivo_reapertura: lote.motivo_reapertura,
      };
      const saved = await updateLoteMutation.mutateAsync({ id: lote.id, payload });
      setLotes((items) => items.map((item) => (item.id === saved.id ? saved : item)));
      setAutosaveStatus("saved");
    } catch (error) {
      setAutosaveStatus("error");
    }
  }

  function scheduleAutosave(nextLote: CalidadLote) {
    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistLote(nextLote);
    }, 2000);
  }

  async function ensureProductor(nombre: string) {
    if (!user) return null;
    const trimmed = normalizeCalidadName(nombre);
    if (!trimmed) return null;
    const existing = productores.find((productor) => !isHistoricalProductorId(productor.id) && sameCalidadName(productor.nombre, trimmed));
    if (existing) return existing;

    const created = await insertProductorMutation.mutateAsync({ userId: user.id, nombre: trimmed });
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
      await deleteProductorMutation.mutateAsync(productor.id);
      setProductores((items) => items.filter((item) => item.id !== productor.id));
      if (selected?.productor_finca_id === productor.id || sameCalidadName(selected?.productor_finca_nombre ?? "", productor.nombre)) {
        patchSelected({ productor_finca_id: null, productor_finca_nombre: "" });
      }
      toast({ title: "Productor/Finca borrado", description: productor.nombre });
    } catch (error) {
      toast({ title: "Error borrando productor", description: errorMessage(error), variant: "destructive" });
    }
  }

  async function addLote(overrides?: Partial<{
    numero_lote: string;
    productor_finca_nombre: string;
    producto: string;
    variedad: string;
    cantidad: string;
    hora: string | null;
  }>) {
    if (!jornada || !user) return null;
    setSaving(true);
    try {
      const created = await insertLoteMutation.mutateAsync(emptyLote(jornada, user.id, lotes.length, overrides));
      setLotes((items) => [...items, created]);
      setSelectedId(created.id);
      return created;
    } catch (error) {
      toast({ title: "Error creando lote", description: errorMessage(error), variant: "destructive" });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function duplicateSelectedLote() {
    if (!selected) return;
    const created = await addLote({
      productor_finca_nombre: selected.productor_finca_nombre,
      producto: selected.producto,
      variedad: selected.variedad,
      hora: currentHora(),
    });
    if (created) {
      toast({ title: "Lote duplicado", description: "Productor, finca y producto copiados. Completa lote y box." });
    }
  }

  /** Importa como lotes de calidad los lotes del parte del día que aún no existan (por numero_lote). */
  async function importarLotesDelParte() {
    if (!jornada || !user) return;
    const nuevos = buildLotesParaImportar(lotesDia, lotes);
    if (nuevos.length === 0) {
      toast({ title: "Todos los lotes ya estaban", description: "No hay lotes nuevos que importar del parte de este día." });
      return;
    }
    setImporting(true);
    try {
      const payload = nuevos.map((lote, index) => emptyLote(jornada, user.id, lotes.length + index, lote));
      const created = await insertLotesBatchMutation.mutateAsync(payload);
      setLotes((items) => [...items, ...created]);
      if (created.length > 0 && !selectedId) setSelectedId(created[0].id);
      toast({ title: `${created.length} lote${created.length === 1 ? "" : "s"} importado${created.length === 1 ? "" : "s"}` });
    } catch (error) {
      toast({ title: "Error importando lotes", description: errorMessage(error), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  /** Al elegir un lote_codigo sugerido, rellena campos vacíos del lote seleccionado. */
  function applyLoteDiaSuggestion(codigo: string) {
    if (!selected) return;
    const match = lotesDia.find((lote) => sameLoteCodigo(lote.lote_codigo, codigo));
    patchSelected({
      numero_lote: codigo,
      productor_finca_nombre: selected.productor_finca_nombre || normalizeCalidadName(match?.productor ?? ""),
      producto: selected.producto || normalizeCalidadName(match?.producto ?? ""),
      cantidad: selected.cantidad || formatKgCantidad(match?.kg_peso_total ?? null),
      hora: selected.hora || formatHoraCorta(match?.hora_inicio ?? null),
    });
  }

  async function saveJornada() {
    if (!jornada) return;
    setSaving(true);
    try {
      await updateJornadaMutation.mutateAsync({ id: jornada.id, responsable });
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
        defecto_otro: selected.defecto_otro,
        observacion: selected.observacion.trim(),
        accion_recomendada: selected.accion_recomendada.trim(),
        informe_estado: selected.informe_estado,
        informe_generado: selected.informe_generado,
        ia_calidad: selected.ia_calidad,
        ia_defectos: selected.ia_defectos,
        ia_resumen: selected.ia_resumen,
        ia_accion_recomendada: selected.ia_accion_recomendada,
        validado_at: selected.validado_at,
        validado_by: selected.validado_by,
        reabierto_at: selected.reabierto_at,
        reabierto_by: selected.reabierto_by,
        motivo_reapertura: selected.motivo_reapertura,
      };
      const saved = await updateLoteMutation.mutateAsync({ id: selected.id, payload });
      setLotes((items) => items.map((lote) => (lote.id === saved.id ? saved : lote)));
      // Guardado explícito (a diferencia del autoguardado con debounce que
      // también usa updateLoteMutation): aquí sí se invalida el bundle del
      // día. Ver la cabecera de useCalidadJornada.ts para el porqué.
      invalidate();
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
      await deleteLoteMutation.mutateAsync({ id: lote.id, filePaths: paths });
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
      const created = await uploadAdjuntosMutation.mutateAsync({
        files: fileList,
        userId: user.id,
        jornadaId: jornada.id,
        loteId: selected.id,
        cleanFileName,
      });
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
      await deleteAdjuntoMutation.mutateAsync({ id: adjunto.id, filePath: adjunto.file_path });
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

  function reopenSelectedLote() {
    if (!selected || !user) return;
    const reopened = reopenCalidadLote(selected, user.id, new Date().toISOString());
    patchSelected({
      informe_estado: reopened.informe_estado,
      reabierto_at: reopened.reabierto_at,
      reabierto_by: reopened.reabierto_by,
      validado_at: reopened.validado_at,
      validado_by: reopened.validado_by,
    });
    void persistLote({ ...selected, ...reopened });
    toast({ title: "Lote reabierto", description: "Ya puedes editar el lote de nuevo." });
  }

  if (loading) {
    return (
      <div className="page-shell">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full sm:w-72" />
        <Skeleton className="h-96" />
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
          {autosaveStatus !== "idle" && (
            <span className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium", autosaveStatus === "saving" && "border-warning/40 bg-warning/10 text-warning", autosaveStatus === "saved" && "border-success/40 bg-success/10 text-success", autosaveStatus === "error" && "border-destructive/40 bg-destructive/10 text-destructive")}>
              {autosaveStatus === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
              {autosaveStatus === "saving" ? "Guardando..." : autosaveStatus === "saved" ? "Guardado" : "Error al guardar"}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="glass glass-hover" disabled={!jornada || lotes.length === 0}>
                <Download className="h-4 w-4" />
                Exportar
                <ChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => jornada && exportCalidadToPDF(jornada, lotes, adjuntos, { mode: "borrador" }).catch((e) => toast({ title: "Error al exportar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }))}>
                <FileText className="h-4 w-4" />
                PDF borrador
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => jornada && exportCalidadToPDF(jornada, lotes, adjuntos, { mode: "oficial" }).catch((e) => toast({ title: "Error al exportar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }))}
                disabled={!lotes.some((l) => l.informe_estado === "validado")}
              >
                <FileText className="h-4 w-4" />
                PDF oficial
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => jornada && exportCalidadToExcel(jornada, lotes, adjuntos).catch((e) => toast({ title: "Error al exportar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }))}>
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="glass glass-hover" onClick={saveJornada} disabled={saving || !jornada}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar jornada
          </Button>
        </div>
      </header>

      <Card className="glass-accented">
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
            <div className="space-y-2">
              <Label htmlFor="fecha-calidad" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fecha
              </Label>
              <div className="flex items-center gap-2">
                <SelectorPeriodo
                  bare
                  value={{ modo: "dia", desde: fecha, hasta: fecha }}
                  onChange={(next) => changeDate(next.desde)}
                  canNavigateNext={fecha < today()}
                />
              </div>
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
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Lotes", value: String(summary.total), tone: "" },
              { label: "Aerobotics", value: `${summary.aerobotics}/${summary.total}`, tone: "" },
              { label: "Bueno", value: String(summary.byQuality.Excelente + summary.byQuality.Bueno), tone: "text-success" },
              { label: "Revisar", value: String(summary.byQuality.Regular + summary.byQuality.Deficiente + summary.byQuality.Pésimo), tone: "text-warning" },
            ].map((stat) => (
              <div key={stat.label} className="glass rounded-xl p-3">
                <p className="panel-kicker mb-1">{stat.label}</p>
                <p className={cn("text-2xl font-semibold tabular-nums", stat.tone)}>{stat.value}</p>
              </div>
            ))}
          </div>

          {summary.total > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="panel-kicker">Distribución de calidad</p>
                <span className="text-xs text-muted-foreground">{summary.total} lote{summary.total !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
                {CALIDAD_OPTIONS.map((q) => {
                  const n = summary.byQuality[q];
                  if (n === 0) return null;
                  return <div key={q} className={QUALITY_BAR[q]} style={{ width: `${(n / summary.total) * 100}%` }} title={`${q}: ${n}`} />;
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {CALIDAD_OPTIONS.map((q) => (
                  <span key={q} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className={cn("h-2 w-2 rounded-full", QUALITY_BAR[q])} />
                    {q} · {summary.byQuality[q]}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "jornada" | "historico")} className="space-y-5">
        <TabsList className="glass w-full justify-start sm:w-auto">
          <TabsTrigger value="jornada">Jornada</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="jornada" className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.86fr)_minmax(0,1.5fr)]">
        <Card className={cn("glass", selected && "hidden xl:block")}>
          <CardHeader className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="panel-kicker">
                  Lotes ({summary.total}) · {validadosCount}/{summary.total} validados
                </p>
                <CardTitle className="text-xl">Notas del dia</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="glass glass-hover"
                        onClick={importarLotesDelParte}
                        disabled={importing || !jornada || lotesDia.length === 0}
                      >
                        {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Importar lotes del parte
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {lotesDia.length === 0 && (
                    <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                      No hay parte de producción para {formatCalidadDate(fecha)} todavía.
                    </TooltipContent>
                  )}
                </Tooltip>
                <Button size="sm" onClick={() => addLote()} disabled={saving || !jornada} className="glass glass-hover">
                  <Plus className="h-4 w-4" />
                  Añadir
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-primary/10 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Al abrir un parte de {formatCalidadDate(fecha)}, estas notas apareceran en su pestaña de Calidad.
            </div>
            {lotes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {LOTE_FILTROS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setLoteFiltro(f.value)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-all",
                      loteFiltro === f.value
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground hover:border-primary/25",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {lotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-primary/25 bg-[var(--glass-bg)] p-5 text-center">
                <Search className="mx-auto h-6 w-6 text-primary" />
                <p className="mt-2 text-sm font-medium">Sin lotes todavia</p>
                <p className="mt-1 text-xs text-muted-foreground">Crea el primer lote y empieza a tomar notas.</p>
              </div>
            ) : filteredLotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-primary/25 bg-[var(--glass-bg)] p-5 text-center">
                <p className="text-sm font-medium">Sin lotes en este filtro</p>
                <p className="mt-1 text-xs text-muted-foreground">Prueba con otro filtro rápido.</p>
              </div>
            ) : (
              filteredLotes.map((lote) => {
                const active = selected?.id === lote.id;
                const index = lotes.findIndex((item) => item.id === lote.id);
                const locked = isCalidadLoteLocked(lote);
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
                          {locked ? (
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Validado" />
                          ) : (
                            <Circle className="h-2 w-2 shrink-0 fill-muted-foreground/40 text-muted-foreground/40" aria-label="Borrador" />
                          )}
                          <p className="truncate text-sm font-semibold">{lote.productor_finca_nombre || "Productor/Finca pendiente"}</p>
                          <Badge variant="outline" className={cn("shrink-0", QUALITY_STYLES[lote.calidad])}>
                            {lote.calidad}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {lote.numero_lote || "Sin lote"} · {lote.variedad || lote.producto || "Sin producto"} · {lote.cantidad || "Sin box"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {lote.aerobotics_realizado && (
                            <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
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

        <Card className={cn("glass-accented", !selected && "hidden xl:block")}>
          {selected ? (
            <>
              <CardHeader className="gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" className="shrink-0 xl:hidden" onClick={() => setSelectedId(null)} aria-label="Volver a la lista">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                      <p className="panel-kicker">Ficha de lote</p>
                      <CardTitle className="text-xl">
                        {selected.numero_lote ? `Lote ${selected.numero_lote}` : "Nuevo lote"}
                      </CardTitle>
                    </div>
                    {isCalidadLoteLocked(selected) && (
                      <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                        <Lock className="mr-1 h-3 w-3" />
                        Validado
                      </Badge>
                    )}
                    {selected.informe_estado === "reabierto" && (
                      <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                        Reabierto
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="hidden glass glass-hover sm:inline-flex" onClick={duplicateSelectedLote} disabled={saving}>
                      <Copy className="h-4 w-4" />
                      Duplicar
                    </Button>
                    {!isCalidadLoteLocked(selected) && (
                      <Button variant="outline" className="hidden glass glass-hover sm:inline-flex" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                        Fotos
                      </Button>
                    )}
                    {!isCalidadLoteLocked(selected) && (
                      <Button variant="outline" className="hidden glass glass-hover text-destructive hover:text-destructive sm:inline-flex" onClick={() => deleteLote(selected)} disabled={saving}>
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                      </Button>
                    )}
                    {isCalidadLoteLocked(selected) && (
                      <Button variant="outline" className="glass glass-hover" onClick={reopenSelectedLote}>
                        <History className="h-4 w-4" />
                        Reabrir edicion
                      </Button>
                    )}
                    {selected.informe_estado !== "validado" && selected.informe_estado !== "reabierto" && selected.informe_estado !== "generado" && (
                      <Button variant="outline" className="glass glass-hover" onClick={() => {
                        const photoCount = attachmentCounts[selected.id] ?? 0;
                        const report = createCalidadDraftReport(selected, photoCount, historicalLotes);
                        patchSelected({
                          informe_estado: "generado",
                          informe_generado: report.informe,
                          ia_resumen: report.informe,
                          ia_accion_recomendada: report.accion_recomendada,
                        });
                        toast({ title: "Informe generado", description: "Revisa el texto y valida cuando estes listo." });
                      }}>
                        <FileText className="h-4 w-4" />
                        Generar informe
                      </Button>
                    )}
                    {/* Un informe reabierto debe poder VOLVER a validarse tras la
                        edición (antes se quedaba sin salida: ni generar ni validar). */}
                    {(selected.informe_estado === "generado" || selected.informe_estado === "reabierto") && (
                      <Button className="glass glass-hover" onClick={() => {
                        const photoCount = attachmentCounts[selected.id] ?? 0;
                        const validation = canValidateCalidadLote(selected, photoCount);
                        if (!validation.ok) {
                          toast({ title: "No se puede validar", description: validation.reason ?? "", variant: "destructive" });
                          return;
                        }
                        if (!user) return;
                        const validated = validateCalidadLote(selected, user.id, new Date().toISOString());
                        patchSelected({
                          informe_estado: validated.informe_estado,
                          validado_at: validated.validado_at,
                          validado_by: validated.validado_by,
                        });
                        void persistLote({ ...selected, ...validated });
                        toast({ title: "Informe validado", description: "El lote queda bloqueado como oficial." });
                      }}>
                        <BadgeCheck className="h-4 w-4" />
                        Validar informe
                      </Button>
                    )}
                    {!isCalidadLoteLocked(selected) && (
                      <Button className="glass glass-hover" onClick={saveLote} disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Guardar lote
                      </Button>
                    )}
                    {!isCalidadLoteLocked(selected) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="icon" className="glass glass-hover sm:hidden" aria-label="Más acciones">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={duplicateSelectedLote} disabled={saving}>
                            <Copy className="h-4 w-4" />
                            Duplicar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                            <Camera className="h-4 w-4" />
                            Fotos
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => deleteLote(selected)} disabled={saving} className="text-destructive focus:text-destructive">
                            <Trash2 className="h-4 w-4" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf,.xlsx,.xls,.doc,.docx" multiple className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
                <input ref={wordInputRef} type="file" accept=".docx,.txt" className="hidden" onChange={(event) => importComentarioFile(event.target.files)} />
              </CardHeader>
              <CardContent className="space-y-6">
                <section className="grid gap-4 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="numero-lote">Lote</Label>
                    <Input
                      id="numero-lote"
                      list="lotes-dia-sugeridos"
                      value={selected.numero_lote}
                      onChange={(event) => patchSelected({ numero_lote: event.target.value })}
                      onBlur={(event) => {
                        const value = event.target.value.trim();
                        if (value) applyLoteDiaSuggestion(value);
                      }}
                      placeholder="26041704"
                      className={glassInputClassName()}
                      disabled={isCalidadLoteLocked(selected)}
                    />
                    <datalist id="lotes-dia-sugeridos">
                      {lotesDia.map((lote) => (
                        lote.lote_codigo ? <option key={lote.lote_codigo} value={lote.lote_codigo} /> : null
                      ))}
                    </datalist>
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
                    <TimeGlassPicker id="hora-lote" value={formatHoraCorta(selected.hora) ?? ""} onChange={(value) => patchSelected({ hora: value || null })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="producto-lote">Producto</Label>
                    <Input id="producto-lote" value={selected.producto} onChange={(event) => patchSelected({ producto: event.target.value })} className={glassInputClassName()} disabled={isCalidadLoteLocked(selected)} />
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor="variedad-lote">Variedad</Label>
                    <Input id="variedad-lote" value={selected.variedad} onChange={(event) => patchSelected({ variedad: event.target.value })} placeholder="Navel Powell" className={glassInputClassName()} disabled={isCalidadLoteLocked(selected)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cantidad-lote">Box</Label>
                    <Input id="cantidad-lote" value={selected.cantidad} onChange={(event) => patchSelected({ cantidad: event.target.value })} placeholder="64 Box" className={glassInputClassName()} disabled={isCalidadLoteLocked(selected)} />
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
                          disabled={isCalidadLoteLocked(selected)}
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
                      {DEFECTO_OPTIONS.map((defecto) => {
                        const checked = selected.defectos.includes(defecto);
                        return (
                          <button
                            key={defecto}
                            type="button"
                            onClick={() => toggleDefecto(defecto)}
                            disabled={isCalidadLoteLocked(selected)}
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
                    {selected.defectos.includes("Otro") && (
                      <div className="pt-2">
                        <Label htmlFor="defecto-otro" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Describe el defecto
                        </Label>
                        <Input
                          id="defecto-otro"
                          value={selected.defecto_otro}
                          onChange={(event) => patchSelected({ defecto_otro: event.target.value })}
                          placeholder="Describe el defecto manualmente..."
                          className={glassInputClassName()}
                          disabled={isCalidadLoteLocked(selected)}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-xl border border-primary/15 bg-primary/6 p-4">
                    <div className="min-w-0">
                      <Label htmlFor="aerobotics-lote" className="text-base font-semibold">
                        Aerobotics
                      </Label>
                      <p className="mt-1 text-xs text-muted-foreground">Confirmar si se ha realizado para este lote.</p>
                    </div>
                    <Switch id="aerobotics-lote" checked={selected.aerobotics_realizado} onCheckedChange={(checked) => patchSelected({ aerobotics_realizado: checked })} disabled={isCalidadLoteLocked(selected)} />
                  </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="comentario-lote">Comentario / observaciones</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" className="glass glass-hover" onClick={() => wordInputRef.current?.click()} disabled={isCalidadLoteLocked(selected)}>
                          <FileText className="h-4 w-4" />
                          Word
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="glass glass-hover" onClick={generateComentario} disabled={isCalidadLoteLocked(selected)}>
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
                      disabled={isCalidadLoteLocked(selected)}
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
                              {lote.variedad || lote.producto || "Sin variedad"} - {lote.cantidad || "Sin box"} - {formatHoraCorta(lote.hora) || "Sin hora"}
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
                          <button
                            type="button"
                            className="block w-full"
                            onClick={() => {
                              setPreviewArchivo(adjunto);
                              setPreviewOpen(true);
                            }}
                            aria-label={`Ver ${adjunto.file_name}`}
                          >
                            <CalidadAdjuntoThumb adjunto={adjunto} />
                          </button>
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
                <Button className="mt-5 glass glass-hover" onClick={() => addLote()} disabled={!jornada || saving}>
                  <Plus className="h-4 w-4" />
                  Añadir primer lote
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {summary.byQuality.Deficiente + summary.byQuality.Pésimo > 0 && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
            <AlertTriangle className="h-5 w-5 text-warning" />
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
        </TabsContent>

        <TabsContent value="historico">
          <CalidadHistoricoTab lotes={historicoRango} loading={historicoLoading} />
        </TabsContent>
      </Tabs>

      <PartFilePreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} archivo={previewArchivo} />
    </div>
  );
}
