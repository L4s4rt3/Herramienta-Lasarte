// Datos del control de calidad de fruta de importación: lista, control
// individual con sus fotos, mutaciones (crear, duplicar, autoguardar, fotos,
// firma) y la generación/descarga del informe Word.
//
// Las fotos y la firma viven en el bucket "partes-archivos" bajo
// calidad-import/<control_id>/, igual que los adjuntos del resto de calidad.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { toast } from "@/hooks/use-toast";
import { fetchAllRows } from "@/lib/fetchAllRows";
import {
  nombreInformeCalidadImport,
  rowToControl,
  type CalidadImportControl,
  type CalidadImportFoto,
} from "@/lib/calidadImport";
import { generarInformeCalidadImportBlob, type ImagenInforme } from "@/lib/calidadImportDocx";
import { downloadBytes } from "@/lib/exportWorkbook";
import type { Json, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

const BUCKET = "partes-archivos";
const LOGO_PATH = "/branding/lasarte-logo-horizontal.jpg";

export const calidadImportListaKey = ["calidad-import-controles"] as const;
export const calidadImportControlKey = (id: string) => ["calidad-import-control", id] as const;

/** Fila de la lista: el control + cuántas fotos tiene. */
export interface ControlConFotos extends CalidadImportControl {
  num_fotos: number;
}

type FilaControl = Parameters<typeof rowToControl>[0];

// ─── Lista de controles ──────────────────────────────────────────────────────

export function useCalidadImportControles() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: calidadImportListaKey,
    queryFn: async (): Promise<ControlConFotos[]> => {
      // Sin acotar ⇒ fetchAllRows (PostgREST recorta a 1.000 en silencio).
      const filas = await fetchAllRows<FilaControl & { calidad_import_fotos: Array<{ count: number }> }>(
        (from, to) =>
          supabase
            .from("calidad_import_controles")
            .select("*, calidad_import_fotos(count)")
            .order("fecha", { ascending: false })
            .order("created_at", { ascending: false })
            .range(from, to) as never,
      );
      return filas.map((fila) => ({
        ...rowToControl(fila),
        num_fotos: fila.calidad_import_fotos?.[0]?.count ?? 0,
      }));
    },
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (user && query.error instanceof Error && !query.isFetching) {
      toast({ title: "Error cargando los controles", description: query.error.message, variant: "destructive" });
    }
  }, [user, query.error, query.isFetching]);

  return query;
}

// ─── Un control con sus fotos ────────────────────────────────────────────────

export interface ControlBundle {
  control: CalidadImportControl;
  fotos: CalidadImportFoto[];
  firmaUrl: string | null;
}

export function useCalidadImportControl(id: string | undefined) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: calidadImportControlKey(id ?? ""),
    queryFn: async (): Promise<ControlBundle> => {
      const [controlRes, fotosRes] = await Promise.all([
        supabase.from("calidad_import_controles").select("*").eq("id", id!).single(),
        supabase.from("calidad_import_fotos").select("*").eq("control_id", id!).order("orden").order("created_at"),
      ]);
      if (controlRes.error) throw controlRes.error;
      if (fotosRes.error) throw fotosRes.error;

      const control = rowToControl(controlRes.data as unknown as FilaControl);
      const fotos = await Promise.all(
        ((fotosRes.data ?? []) as unknown as CalidadImportFoto[]).map(async (foto) => {
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(foto.file_path, 60 * 60);
          return { ...foto, signedUrl: data?.signedUrl };
        }),
      );
      let firmaUrl: string | null = null;
      if (control.firma_path) {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrl(control.firma_path, 60 * 60);
        firmaUrl = data?.signedUrl ?? null;
      }
      return { control, fotos, firmaUrl };
    },
    enabled: Boolean(user) && Boolean(id),
  });

  useEffect(() => {
    if (user && query.error instanceof Error && !query.isFetching) {
      toast({ title: "Error cargando el control", description: query.error.message, variant: "destructive" });
    }
  }, [user, query.error, query.isFetching]);

  return query;
}

// ─── Serialización del patch (los arrays tipados → JSONB) ────────────────────

export type ControlPatch = Partial<
  Omit<CalidadImportControl, "id" | "user_id" | "created_at" | "updated_at">
>;

function patchARow(patch: ControlPatch): TablesUpdate<"calidad_import_controles"> {
  const { defectos_leves, defectos_graves, defectos_evolutivos, muestras_internas, ...resto } = patch;
  const row: TablesUpdate<"calidad_import_controles"> = { ...resto };
  if (defectos_leves !== undefined) row.defectos_leves = defectos_leves as unknown as Json;
  if (defectos_graves !== undefined) row.defectos_graves = defectos_graves as unknown as Json;
  if (defectos_evolutivos !== undefined) row.defectos_evolutivos = defectos_evolutivos as unknown as Json;
  if (muestras_internas !== undefined) row.muestras_internas = muestras_internas as unknown as Json;
  return row;
}

// ─── Mutaciones ──────────────────────────────────────────────────────────────

export function useCalidadImportMutations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const invalidar = (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: calidadImportListaKey });
    if (id) void queryClient.invalidateQueries({ queryKey: calidadImportControlKey(id) });
  };

  /** Crea un control nuevo (opcionalmente precargado) y devuelve su id. */
  const crearControl = useMutation({
    mutationFn: async (prefill?: ControlPatch): Promise<string> => {
      if (!user) throw new Error("Debes iniciar sesión.");
      // El evaluador se hereda del último control para no teclearlo cada vez.
      let evaluador = prefill?.evaluador ?? "";
      if (!evaluador) {
        const { data } = await supabase
          .from("calidad_import_controles")
          .select("evaluador")
          .neq("evaluador", "")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        evaluador = (data as { evaluador?: string } | null)?.evaluador ?? "";
      }
      const insert: TablesInsert<"calidad_import_controles"> = {
        ...patchARow(prefill ?? {}),
        evaluador,
        user_id: user.id,
      };
      const { data, error } = await supabase
        .from("calidad_import_controles")
        .insert(insert)
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: () => invalidar(),
    onError: (error: Error) =>
      toast({ title: "No se pudo crear el control", description: error.message, variant: "destructive" }),
  });

  /** Autoguardado del editor: parche parcial sobre el control. La caché del
   * control se actualiza EN SITIO (setQueryData) en vez de invalidarse: un
   * refetch en mitad de la escritura machacaría lo que se está tecleando. */
  const actualizarControl = useMutation({
    mutationFn: async (input: { id: string; patch: ControlPatch }) => {
      const { error } = await supabase
        .from("calidad_import_controles")
        .update(patchARow(input.patch))
        .eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      queryClient.setQueryData(
        calidadImportControlKey(input.id),
        (prev: ControlBundle | undefined) =>
          prev ? { ...prev, control: { ...prev.control, ...input.patch } } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: calidadImportListaKey });
    },
    onError: (error: Error) =>
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }),
  });

  /** Borra el control, sus fotos del storage y la firma. */
  const borrarControl = useMutation({
    mutationFn: async (control: CalidadImportControl) => {
      const { data: fotosData } = await supabase
        .from("calidad_import_fotos")
        .select("file_path")
        .eq("control_id", control.id);
      const paths = ((fotosData ?? []) as Array<{ file_path: string }>).map((f) => f.file_path);
      if (control.firma_path) paths.push(control.firma_path);
      if (paths.length > 0) {
        await supabase.storage.from(BUCKET).remove(paths).catch(() => undefined);
      }
      const { error } = await supabase.from("calidad_import_controles").delete().eq("id", control.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      toast({ title: "Control borrado" });
    },
    onError: (error: Error) =>
      toast({ title: "No se pudo borrar", description: error.message, variant: "destructive" }),
  });

  /** Sube fotos (comprimidas a JPEG ≤1600px) y las registra en orden. */
  const subirFotos = useMutation({
    mutationFn: async (input: { controlId: string; files: File[]; ordenDesde: number }) => {
      if (!user) throw new Error("Debes iniciar sesión.");
      for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        const { blob, extension, mime } = await comprimirFoto(file);
        // La 1ª carpeta DEBE ser el uid: la política de insert del bucket
        // exige (storage.foldername(name))[1] = auth.uid().
        const path = `${user.id}/calidad-import/${input.controlId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime });
        if (uploadError) throw uploadError;
        const { error } = await supabase.from("calidad_import_fotos").insert({
          control_id: input.controlId,
          user_id: user.id,
          file_name: file.name || `foto-${input.ordenDesde + i + 1}.jpg`,
          file_path: path,
          mime_type: mime,
          file_size: blob.size,
          orden: input.ordenDesde + i,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_data, input) => invalidar(input.controlId),
    onError: (error: Error) =>
      toast({ title: "No se pudieron subir las fotos", description: error.message, variant: "destructive" }),
  });

  const borrarFoto = useMutation({
    mutationFn: async (foto: CalidadImportFoto) => {
      await supabase.storage.from(BUCKET).remove([foto.file_path]).catch(() => undefined);
      const { error } = await supabase.from("calidad_import_fotos").delete().eq("id", foto.id);
      if (error) throw error;
      return foto;
    },
    onSuccess: (foto) => invalidar(foto.control_id),
    onError: (error: Error) =>
      toast({ title: "No se pudo borrar la foto", description: error.message, variant: "destructive" }),
  });

  /** Guarda la firma dibujada (PNG del canvas); null la borra. */
  const guardarFirma = useMutation({
    mutationFn: async (input: { control: CalidadImportControl; blob: Blob | null }) => {
      if (!user) throw new Error("Debes iniciar sesión.");
      if (input.control.firma_path) {
        await supabase.storage.from(BUCKET).remove([input.control.firma_path]).catch(() => undefined);
      }
      let firmaPath: string | null = null;
      if (input.blob) {
        // Misma regla que las fotos: la 1ª carpeta del path es el uid.
        firmaPath = `${user.id}/calidad-import/${input.control.id}/firma-${crypto.randomUUID()}.png`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(firmaPath, input.blob, { contentType: "image/png" });
        if (uploadError) throw uploadError;
      }
      const { error } = await supabase
        .from("calidad_import_controles")
        .update({ firma_path: firmaPath })
        .eq("id", input.control.id);
      if (error) throw error;
      return input.control.id;
    },
    onSuccess: (controlId) => invalidar(controlId),
    onError: (error: Error) =>
      toast({ title: "No se pudo guardar la firma", description: error.message, variant: "destructive" }),
  });

  return { crearControl, actualizarControl, borrarControl, subirFotos, borrarFoto, guardarFirma };
}

/** Campos que se copian al duplicar un control para la otra categoría del
 * mismo camión: producto e información general; medidas y fotos, no. */
export function prefillDuplicado(control: CalidadImportControl): ControlPatch {
  return {
    fecha: control.fecha,
    referencia: control.referencia,
    nuestra_ref: control.nuestra_ref,
    proveedor: control.proveedor,
    barco: control.barco,
    marca: control.marca,
    num_contenedor: control.num_contenedor,
    kg_total: control.kg_total,
    puc_orchard: control.puc_orchard,
    ggn: control.ggn,
    tipo_producto: control.tipo_producto,
    tipo_confeccion: control.tipo_confeccion,
    origen: control.origen,
    calibre: control.calibre,
    etiquetado: control.etiquetado,
    tratamientos: control.tratamientos,
    sticker: control.sticker,
    papel: control.papel,
    evaluador: control.evaluador,
  };
}

// ─── Fotos: compresión en el navegador ───────────────────────────────────────
// Las fotos del iPhone pesan 3-5 MB; para el informe (y la subida con la
// cobertura de la nave) basta JPEG a 1600px. Si el navegador no sabe
// decodificar el archivo (p.ej. un HEIC antiguo) se sube tal cual.

const FOTO_MAX_LADO = 1600;

async function comprimirFoto(file: File): Promise<{ blob: Blob; extension: string; mime: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, FOTO_MAX_LADO / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sin canvas 2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("canvas.toBlob devolvió null");
    return { blob, extension: "jpg", mime: "image/jpeg" };
  } catch {
    const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
    return { blob: file, extension, mime: file.type || "application/octet-stream" };
  }
}

// ─── Informe Word ────────────────────────────────────────────────────────────

async function blobAImagenInforme(blob: Blob, tipo: "jpg" | "png"): Promise<ImagenInforme> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  return { data: await blob.arrayBuffer(), width, height, tipo };
}

async function descargarDeStorage(path: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return data;
}

/**
 * Genera el .docx del control (cabecera con logo, 7 secciones, fotos y firma)
 * y dispara la descarga. Devuelve el nombre del archivo generado.
 */
export async function generarYDescargarInforme(control: CalidadImportControl, fotos: CalidadImportFoto[]): Promise<string> {
  // Logo corporativo (si falla la carga, el informe sale con "LASARTE" en texto).
  let logo: ImagenInforme | null = null;
  try {
    const respuesta = await fetch(LOGO_PATH);
    if (respuesta.ok) logo = await blobAImagenInforme(await respuesta.blob(), "jpg");
  } catch {
    logo = null;
  }

  const imagenes: ImagenInforme[] = [];
  for (const foto of [...fotos].sort((a, b) => a.orden - b.orden || (a.created_at ?? "").localeCompare(b.created_at ?? ""))) {
    const blob = await descargarDeStorage(foto.file_path);
    if (!blob) continue;
    try {
      imagenes.push(await blobAImagenInforme(blob, foto.mime_type === "image/png" ? "png" : "jpg"));
    } catch {
      // Foto que el navegador no sabe decodificar: se omite del informe.
    }
  }

  let firma: ImagenInforme | null = null;
  if (control.firma_path) {
    const blob = await descargarDeStorage(control.firma_path);
    if (blob) {
      try {
        firma = await blobAImagenInforme(blob, "png");
      } catch {
        firma = null;
      }
    }
  }

  const docxBlob = await generarInformeCalidadImportBlob(control, imagenes, firma, logo);
  const filename = nombreInformeCalidadImport(control);
  downloadBytes(new Uint8Array(await docxBlob.arrayBuffer()), filename);
  return filename;
}
