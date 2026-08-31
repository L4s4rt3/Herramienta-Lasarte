// Datos del control de calidad de fruta de importación: lista, control
// individual con sus fotos, mutaciones (crear, duplicar, autoguardar, fotos,
// firma), sincronización offline, refresco en vivo y la generación/entrega
// del informe Word.
//
// Las fotos y la firma viven en el bucket "partes-archivos" bajo
// <uid>/calidad-import/<control_id>/ (la política de insert del bucket exige
// el uid como primera carpeta), igual que los adjuntos del resto de calidad.
//
// OFFLINE: si no hay red, los cambios van al outbox local (localStorage +
// IndexedDB para blobs, ver lib/calidadImportOffline) y se suben solos al
// volver la conexión. EN VIVO: un canal de Supabase Realtime invalida las
// consultas cuando cualquier usuario cambia un control o sus fotos.
import { useEffect, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { toast } from "@/hooks/use-toast";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { today } from "@/lib/format";
import {
  nombreInformeCalidadImport,
  rowToControl,
  type CalidadImportControl,
  type CalidadImportFoto,
} from "@/lib/calidadImport";
import { generarInformeCalidadImportBlob, type ImagenInforme } from "@/lib/calidadImportDocx";
import {
  cachearControl,
  cachearLista,
  controlCacheado,
  controlesPendientes,
  controlPendiente,
  encolarControl,
  encolarFotoPendiente,
  esErrorDeRed,
  fotosPendientes,
  listaCacheada,
  quitarControlCacheado,
  quitarControlPendiente,
  quitarFotoPendiente,
  sinConexion,
  type FotoPendiente,
} from "@/lib/calidadImportOffline";
import type { Json, TablesInsert } from "@/integrations/supabase/types";

const BUCKET = "partes-archivos";
const LOGO_PATH = "/branding/lasarte-logo-horizontal.jpg";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const calidadImportListaKey = ["calidad-import-controles"] as const;
export const calidadImportControlKey = (id: string) => ["calidad-import-control", id] as const;
const CONTROL_KEY_PREFIX = ["calidad-import-control"] as const;

/** Fila de la lista: el control + cuántas fotos tiene. */
export interface ControlConFotos extends CalidadImportControl {
  num_fotos: number;
}

type FilaControl = Parameters<typeof rowToControl>[0];

// ─── Modelo ↔ fila de BD ─────────────────────────────────────────────────────

export type ControlPatch = Partial<
  Omit<CalidadImportControl, "id" | "user_id" | "created_at" | "updated_at">
>;

function patchARow(patch: ControlPatch): Record<string, unknown> {
  const { defectos_leves, defectos_graves, defectos_evolutivos, muestras_internas, ...resto } = patch;
  const row: Record<string, unknown> = { ...resto };
  if (defectos_leves !== undefined) row.defectos_leves = defectos_leves as unknown as Json;
  if (defectos_graves !== undefined) row.defectos_graves = defectos_graves as unknown as Json;
  if (defectos_evolutivos !== undefined) row.defectos_evolutivos = defectos_evolutivos as unknown as Json;
  if (muestras_internas !== undefined) row.muestras_internas = muestras_internas as unknown as Json;
  return row;
}

/** Fila COMPLETA para upsert (el formato que guarda el outbox offline). */
function controlARowCompleta(control: CalidadImportControl): Record<string, unknown> & { id: string; user_id: string } {
  const { created_at: _c, updated_at: _u, ...resto } = control;
  return {
    ...patchARow(resto),
    id: control.id,
    user_id: control.user_id,
    firma_path: control.firma_path,
  } as Record<string, unknown> & { id: string; user_id: string };
}

/** Control recién nacido (también sirve para crearlo sin conexión). */
export function controlNuevo(id: string, userId: string, prefill?: ControlPatch): CalidadImportControl {
  return {
    id,
    user_id: userId,
    fecha: today(),
    fecha_descarga: null,
    estado: "borrador",
    referencia: "",
    nuestra_ref: "",
    proveedor: "",
    barco: "",
    marca: "",
    num_contenedor: "",
    kg_total: "",
    puc_orchard: "",
    ggn: "",
    tipo_producto: "",
    tipo_confeccion: "",
    origen: "",
    calibre: "",
    etiquetado: "",
    tratamientos: "",
    clasificacion: "",
    temperatura: "",
    paletizacion: "",
    peso_medio_cajas: "",
    sticker: "",
    papel: "",
    muestreo_no_evolutivos: "",
    defectos_leves: [],
    defectos_graves: [],
    obs_no_evolutivos: "",
    muestreo_evolutivos: "",
    defectos_evolutivos: [],
    obs_evolutivos: "",
    muestras_internas: [],
    obs_calidad_interna: "",
    evaluador: "",
    firma_path: null,
    conclusion: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...prefill,
  };
}

// ─── Lista de controles ──────────────────────────────────────────────────────

function mergeConPendientes(base: ControlConFotos[]): ControlConFotos[] {
  const porId = new Map(base.map((c) => [c.id, c]));
  for (const entry of controlesPendientes()) {
    const parseado = rowToControl(entry.row as unknown as FilaControl);
    const previo = porId.get(parseado.id);
    porId.set(parseado.id, { ...parseado, num_fotos: previo?.num_fotos ?? 0 });
  }
  return [...porId.values()].sort(
    (a, b) => b.fecha.localeCompare(a.fecha) || (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
}

export function useCalidadImportControles() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: calidadImportListaKey,
    queryFn: async (): Promise<ControlConFotos[]> => {
      try {
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
        const parseadas = filas.map((fila) => ({
          ...rowToControl(fila),
          num_fotos: fila.calidad_import_fotos?.[0]?.count ?? 0,
        }));
        cachearLista(parseadas);
        return mergeConPendientes(parseadas);
      } catch (error) {
        // Sin red: última lista vista + lo pendiente de subir.
        if (esErrorDeRed(error)) {
          return mergeConPendientes((listaCacheada() ?? []) as ControlConFotos[]);
        }
        throw error;
      }
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

function fotoPendienteAFoto(pendiente: FotoPendiente): CalidadImportFoto {
  return {
    id: `pendiente-${pendiente.key}`,
    control_id: pendiente.controlId,
    file_name: pendiente.fileName,
    file_path: `pendiente/${pendiente.key}`,
    mime_type: pendiente.mime,
    file_size: pendiente.blob.size,
    orden: pendiente.orden,
    signedUrl: URL.createObjectURL(pendiente.blob),
    blobLocal: pendiente.blob,
  };
}

async function bundleOffline(id: string): Promise<ControlBundle> {
  const cacheado = controlCacheado<ControlBundle>(id);
  const pendiente = controlPendiente(id);
  const control = pendiente
    ? rowToControl(pendiente.row as unknown as FilaControl)
    : cacheado?.control;
  if (!control) throw new Error("Este control no está disponible sin conexión.");
  const pendientes = await fotosPendientes(id);
  const fotos = [
    ...(cacheado?.fotos ?? []),
    ...pendientes.filter((p) => p.tipo === "foto").map(fotoPendienteAFoto),
  ];
  const firmaPendiente = pendientes.find((p) => p.tipo === "firma");
  return {
    control,
    fotos,
    firmaUrl: firmaPendiente ? URL.createObjectURL(firmaPendiente.blob) : (cacheado?.firmaUrl ?? null),
  };
}

export function useCalidadImportControl(id: string | undefined) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: calidadImportControlKey(id ?? ""),
    queryFn: async (): Promise<ControlBundle> => {
      try {
        const [controlRes, fotosRes] = await Promise.all([
          supabase.from("calidad_import_controles").select("*").eq("id", id!).maybeSingle(),
          supabase.from("calidad_import_fotos").select("*").eq("control_id", id!).order("orden").order("created_at"),
        ]);
        if (controlRes.error) throw controlRes.error;
        if (fotosRes.error) throw fotosRes.error;
        // Recién creado offline: todavía no está en la base.
        if (!controlRes.data) return bundleOffline(id!);

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
        const bundle: ControlBundle = { control, fotos, firmaUrl };
        cachearControl(id!, bundle);
        // Puede haber fotos locales aún sin subir: se enseñan junto a las subidas.
        const pendientes = await fotosPendientes(id!);
        if (pendientes.length > 0) {
          return {
            ...bundle,
            fotos: [...fotos, ...pendientes.filter((p) => p.tipo === "foto").map(fotoPendienteAFoto)],
            firmaUrl: pendientes.find((p) => p.tipo === "firma")
              ? URL.createObjectURL(pendientes.find((p) => p.tipo === "firma")!.blob)
              : firmaUrl,
          };
        }
        return bundle;
      } catch (error) {
        if (esErrorDeRed(error)) return bundleOffline(id!);
        throw error;
      }
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

// ─── Mutaciones ──────────────────────────────────────────────────────────────

export function useCalidadImportMutations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const invalidar = (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: calidadImportListaKey });
    if (id) void queryClient.invalidateQueries({ queryKey: calidadImportControlKey(id) });
  };

  /** Crea un control nuevo (opcionalmente precargado) y devuelve su id.
   * El id nace en el cliente: sin conexión el control se crea igual y el
   * outbox lo sube después. */
  const crearControl = useMutation({
    mutationFn: async (prefill?: ControlPatch): Promise<{ id: string; offline: boolean }> => {
      if (!user) throw new Error("Debes iniciar sesión.");
      // El evaluador se hereda del último control para no teclearlo cada vez.
      let evaluador = prefill?.evaluador ?? "";
      if (!evaluador && !sinConexion()) {
        try {
          const { data } = await supabase
            .from("calidad_import_controles")
            .select("evaluador")
            .neq("evaluador", "")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          evaluador = (data as { evaluador?: string } | null)?.evaluador ?? "";
        } catch {
          evaluador = "";
        }
      }
      const control = controlNuevo(crypto.randomUUID(), user.id, { ...prefill, evaluador });
      const row = controlARowCompleta(control);
      if (sinConexion()) {
        encolarControl(row);
        cachearControl(control.id, { control, fotos: [], firmaUrl: null });
        return { id: control.id, offline: true };
      }
      const { error } = await supabase
        .from("calidad_import_controles")
        .insert(row as unknown as TablesInsert<"calidad_import_controles">);
      if (error) {
        if (esErrorDeRed(error)) {
          encolarControl(row);
          cachearControl(control.id, { control, fotos: [], firmaUrl: null });
          return { id: control.id, offline: true };
        }
        throw error;
      }
      return { id: control.id, offline: false };
    },
    onSuccess: () => invalidar(),
    onError: (error: Error) =>
      toast({ title: "No se pudo crear el control", description: error.message, variant: "destructive" }),
  });

  /** Autoguardado del editor: guarda el control COMPLETO. Online contra la
   * base; sin red, al outbox (y se sube solo al volver la conexión). La caché
   * del control se actualiza EN SITIO (setQueryData) en vez de invalidarse: un
   * refetch en mitad de la escritura machacaría lo que se está tecleando. */
  const actualizarControl = useMutation({
    mutationFn: async (control: CalidadImportControl): Promise<{ offline: boolean }> => {
      const row = controlARowCompleta(control);
      if (sinConexion()) {
        encolarControl(row);
        return { offline: true };
      }
      const { error } = await supabase
        .from("calidad_import_controles")
        .upsert(row as unknown as TablesInsert<"calidad_import_controles">);
      if (error) {
        if (esErrorDeRed(error)) {
          encolarControl(row);
          return { offline: true };
        }
        throw error;
      }
      quitarControlPendiente(control.id);
      return { offline: false };
    },
    onSuccess: (_resultado, control) => {
      queryClient.setQueryData(
        calidadImportControlKey(control.id),
        (prev: ControlBundle | undefined) => (prev ? { ...prev, control } : prev),
      );
      const cacheado = controlCacheado<ControlBundle>(control.id);
      if (cacheado) cachearControl(control.id, { ...cacheado, control });
      void queryClient.invalidateQueries({ queryKey: calidadImportListaKey });
    },
    onError: (error: Error) =>
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }),
  });

  /** Borra el control, sus fotos del storage y lo pendiente local. */
  const borrarControl = useMutation({
    mutationFn: async (control: CalidadImportControl) => {
      quitarControlPendiente(control.id);
      quitarControlCacheado(control.id);
      for (const pendiente of await fotosPendientes(control.id)) {
        await quitarFotoPendiente(pendiente.key);
      }
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

  /** Sube fotos (comprimidas a JPEG ≤1600px). Sin red se guardan en el móvil
   * (IndexedDB) y se suben solas al recuperar conexión. */
  const subirFotos = useMutation({
    mutationFn: async (input: { controlId: string; files: File[]; ordenDesde: number }): Promise<{ offline: boolean }> => {
      if (!user) throw new Error("Debes iniciar sesión.");
      let offline = false;
      for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        const { blob, extension, mime } = await comprimirFoto(file);
        const key = crypto.randomUUID();
        const pendiente: FotoPendiente = {
          key,
          controlId: input.controlId,
          userId: user.id,
          fileName: file.name || `foto-${input.ordenDesde + i + 1}.${extension}`,
          mime,
          orden: input.ordenDesde + i,
          tipo: "foto",
          blob,
        };
        if (sinConexion()) {
          await encolarFotoPendiente(pendiente);
          offline = true;
          continue;
        }
        try {
          await subirFotoAlServidor(pendiente, extension);
        } catch (error) {
          if (esErrorDeRed(error)) {
            await encolarFotoPendiente(pendiente);
            offline = true;
          } else {
            throw error;
          }
        }
      }
      return { offline };
    },
    onSuccess: (resultado, input) => {
      invalidar(input.controlId);
      if (resultado.offline) {
        toast({ title: "Fotos guardadas en el móvil", description: "Se subirán solas cuando vuelva la conexión." });
      }
    },
    onError: (error: Error) =>
      toast({ title: "No se pudieron subir las fotos", description: error.message, variant: "destructive" }),
  });

  const borrarFoto = useMutation({
    mutationFn: async (foto: CalidadImportFoto) => {
      // Foto aún sin subir: solo hay que quitarla del outbox local.
      if (foto.id.startsWith("pendiente-")) {
        await quitarFotoPendiente(foto.id.slice("pendiente-".length));
        return foto;
      }
      await supabase.storage.from(BUCKET).remove([foto.file_path]).catch(() => undefined);
      const { error } = await supabase.from("calidad_import_fotos").delete().eq("id", foto.id);
      if (error) throw error;
      return foto;
    },
    onSuccess: (foto) => invalidar(foto.control_id),
    onError: (error: Error) =>
      toast({ title: "No se pudo borrar la foto", description: error.message, variant: "destructive" }),
  });

  /** Guarda la firma dibujada (PNG del canvas); sin red, al outbox. */
  const guardarFirma = useMutation({
    mutationFn: async (input: { control: CalidadImportControl; blob: Blob }): Promise<{ offline: boolean }> => {
      if (!user) throw new Error("Debes iniciar sesión.");
      const pendiente: FotoPendiente = {
        key: crypto.randomUUID(),
        controlId: input.control.id,
        userId: user.id,
        fileName: "firma.png",
        mime: "image/png",
        orden: 0,
        tipo: "firma",
        blob: input.blob,
      };
      if (sinConexion()) {
        await encolarFotoPendiente(pendiente);
        return { offline: true };
      }
      try {
        await subirFirmaAlServidor(pendiente, input.control.firma_path);
        return { offline: false };
      } catch (error) {
        if (esErrorDeRed(error)) {
          await encolarFotoPendiente(pendiente);
          return { offline: true };
        }
        throw error;
      }
    },
    onSuccess: (resultado, input) => {
      invalidar(input.control.id);
      if (resultado.offline) {
        toast({ title: "Firma guardada en el móvil", description: "Se subirá sola cuando vuelva la conexión." });
      }
    },
    onError: (error: Error) =>
      toast({ title: "No se pudo guardar la firma", description: error.message, variant: "destructive" }),
  });

  return { crearControl, actualizarControl, borrarControl, subirFotos, borrarFoto, guardarFirma };
}

async function subirFotoAlServidor(pendiente: FotoPendiente, extension?: string) {
  const ext = extension ?? (pendiente.mime === "image/png" ? "png" : "jpg");
  // La 1ª carpeta DEBE ser el uid (política de insert del bucket). La clave
  // local como nombre hace el reintento idempotente.
  const path = `${pendiente.userId}/calidad-import/${pendiente.controlId}/${pendiente.key}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, pendiente.blob, { contentType: pendiente.mime, upsert: true });
  if (uploadError) throw uploadError;
  const { error } = await supabase.from("calidad_import_fotos").insert({
    control_id: pendiente.controlId,
    user_id: pendiente.userId,
    file_name: pendiente.fileName,
    file_path: path,
    mime_type: pendiente.mime,
    file_size: pendiente.blob.size,
    orden: pendiente.orden,
  });
  // Path duplicado = reintento de algo ya subido: no es un error.
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
}

async function subirFirmaAlServidor(pendiente: FotoPendiente, firmaAnterior: string | null) {
  if (firmaAnterior) {
    await supabase.storage.from(BUCKET).remove([firmaAnterior]).catch(() => undefined);
  }
  const path = `${pendiente.userId}/calidad-import/${pendiente.controlId}/firma-${pendiente.key}.png`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, pendiente.blob, { contentType: "image/png", upsert: true });
  if (uploadError) throw uploadError;
  const { error } = await supabase
    .from("calidad_import_controles")
    .update({ firma_path: path })
    .eq("id", pendiente.controlId);
  if (error) throw error;
}

/** Campos que se copian al duplicar un control para la otra categoría del
 * mismo camión: producto e información general; medidas y fotos, no. */
export function prefillDuplicado(control: CalidadImportControl): ControlPatch {
  return {
    fecha: control.fecha,
    fecha_descarga: control.fecha_descarga,
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

// ─── Sincronización offline + refresco en vivo ───────────────────────────────

let sincronizando = false;

/** Sube todo lo pendiente (controles → fotos → firma). Devuelve cuántos. */
export async function sincronizarPendientes(): Promise<number> {
  if (sinConexion() || sincronizando) return 0;
  sincronizando = true;
  let subidos = 0;
  try {
    for (const entry of controlesPendientes()) {
      const { error } = await supabase
        .from("calidad_import_controles")
        .upsert(entry.row as unknown as TablesInsert<"calidad_import_controles">);
      if (error) {
        if (esErrorDeRed(error)) return subidos; // sin red otra vez: se reintenta luego
        continue; // otro error (p.ej. permisos): se conserva y no bloquea el resto
      }
      quitarControlPendiente(entry.row.id);
      subidos += 1;
    }
    for (const pendiente of await fotosPendientes()) {
      try {
        if (pendiente.tipo === "firma") {
          await subirFirmaAlServidor(pendiente, null);
        } else {
          await subirFotoAlServidor(pendiente);
        }
        await quitarFotoPendiente(pendiente.key);
        subidos += 1;
      } catch (error) {
        if (esErrorDeRed(error)) return subidos;
        // otro error: se conserva para revisarlo con conexión estable
      }
    }
    return subidos;
  } finally {
    sincronizando = false;
  }
}

function suscribirOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** true si el navegador cree tener conexión (reactivo a online/offline). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    suscribirOnline,
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
    () => true,
  );
}

/**
 * Móntalo en las páginas del módulo: al entrar y al recuperar conexión sube
 * lo pendiente, y se suscribe a Realtime para que cualquier cambio de
 * cualquier usuario refresque la lista y los controles abiertos al momento.
 */
export function useCalidadImportSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const online = useOnline();

  useEffect(() => {
    if (!user || !online) return;
    void sincronizarPendientes().then((subidos) => {
      if (subidos > 0) {
        toast({ title: "Cambios sincronizados", description: "Lo guardado sin conexión ya está subido." });
        void queryClient.invalidateQueries({ queryKey: calidadImportListaKey });
        void queryClient.invalidateQueries({ queryKey: CONTROL_KEY_PREFIX });
      }
    });
  }, [user, online, queryClient]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("calidad-import-en-vivo")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calidad_import_controles" },
        () => {
          void queryClient.invalidateQueries({ queryKey: calidadImportListaKey });
          void queryClient.invalidateQueries({ queryKey: CONTROL_KEY_PREFIX });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calidad_import_fotos" },
        () => {
          void queryClient.invalidateQueries({ queryKey: calidadImportListaKey });
          void queryClient.invalidateQueries({ queryKey: CONTROL_KEY_PREFIX });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  return { online };
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

/** En iPhone/iPad y Android la hoja de compartir nativa es el camino cómodo
 * (Mail/WhatsApp/Guardar en Archivos) Y el fiable: la descarga de blobs en
 * una PWA instalada en iOS falla en silencio. En escritorio, descarga normal. */
async function entregarDocx(blob: Blob, filename: string): Promise<"compartido" | "descargado" | "cancelado"> {
  const esMovil = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const file = new File([blob], filename, { type: DOCX_MIME });
  if (esMovil && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "compartido";
    } catch (error) {
      // Cancelar la hoja de compartir no es un fallo: no forzar la descarga.
      if (error instanceof Error && error.name === "AbortError") return "cancelado";
      // Cualquier otro fallo: se intenta la descarga clásica.
    }
  }
  // MIME de Word explícito: con el genérico (o el de Excel) el visor del
  // iPhone no sabía abrir el informe.
  const url = URL.createObjectURL(new Blob([blob], { type: DOCX_MIME }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revocar al momento aborta la descarga en iOS/Safari: se le da margen.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "descargado";
}

/**
 * Genera el .docx del control (cabecera con logo, secciones rellenadas, fotos
 * y firma) y lo entrega: hoja de compartir en el móvil, descarga en escritorio.
 * Devuelve el nombre del archivo generado, o null si se canceló el compartir.
 */
export async function generarYDescargarInforme(
  control: CalidadImportControl,
  fotos: CalidadImportFoto[],
): Promise<string | null> {
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
    // Las fotos aún sin subir traen su blob local: sirven también sin red.
    const blob = foto.blobLocal ?? (await descargarDeStorage(foto.file_path));
    if (!blob) continue;
    try {
      imagenes.push(await blobAImagenInforme(blob, foto.mime_type === "image/png" ? "png" : "jpg"));
    } catch {
      // Foto que el navegador no sabe decodificar: se omite del informe.
    }
  }

  let firma: ImagenInforme | null = null;
  const firmaPendiente = (await fotosPendientes(control.id)).find((p) => p.tipo === "firma");
  const firmaBlob = firmaPendiente?.blob ?? (control.firma_path ? await descargarDeStorage(control.firma_path) : null);
  if (firmaBlob) {
    try {
      firma = await blobAImagenInforme(firmaBlob, "png");
    } catch {
      firma = null;
    }
  }

  const docxBlob = await generarInformeCalidadImportBlob(control, imagenes, firma, logo);
  const filename = nombreInformeCalidadImport(control);
  const via = await entregarDocx(docxBlob, filename);
  return via === "cancelado" ? null : filename;
}
