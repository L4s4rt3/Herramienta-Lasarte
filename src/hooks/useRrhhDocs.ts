/**
 * useRrhhDocs — acceso a las tablas rrhh_amonestaciones / rrhh_nominas y al
 * bucket privado "rrhh-docs" (documentos firmados / nóminas escaneadas).
 *
 * IMPORTANTE: estas tablas NO existen todavia en src/integrations/supabase/types.ts
 * (infraestructura pendiente de aplicar por el orquestador). Se usa el mismo
 * patron que src/hooks/useMercadonaVentas.ts / useCmrDocumentos.ts: cast local
 * `SUPA` a SupabaseClient<any>. Cuando se apliquen las migraciones y se
 * regeneren los tipos, sustituir los `as any`/`SUPA` por `Tables<"rrhh_...">`.
 *
 * RLS: estas tablas solo son visibles/editables por RRHH y administración.
 * Si el usuario actual no tiene el rol correspondiente, Postgres devuelve un
 * error de permiso (42501) o PostgREST oculta la tabla (PGRST301/401) — en
 * ambos casos se detecta con `isPermissionError` y la pagina degrada
 * mostrando el aviso "Solo RRHH y administración" en vez de un error crudo.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
// Worker de pdfjs empaquetado por Vite como asset propio (?url) en vez de
// dejar que pdfjs intente cargarlo desde un CDN: así funciona en dev y en el
// build de producción sin configuración adicional de Vite.
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage, toError } from "@/lib/errorMessage";
import { idCortoStorage, sanearNombreArchivo } from "@/lib/cmrArchivo";
import { casarPaginaConTrabajador, type PaginaNomina, type TrabajadorNominaCandidato } from "@/lib/nominasPdf";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Cast local: las tablas rrhh_* aun no estan en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

const BUCKET = "rrhh-docs";

const PERMISSION_ERROR_CODES = new Set(["42501", "PGRST301", "PGRST302"]);

/** Distingue "sin permiso RLS" (degradar con aviso) de otros errores (relanzar). */
export function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; status?: number };
  if (record.code && PERMISSION_ERROR_CODES.has(record.code)) return true;
  if (record.status === 401 || record.status === 403) return true;
  const message = (record.message ?? "").toLowerCase();
  return (
    message.includes("permission denied") ||
    message.includes("row-level security") ||
    message.includes("row level security")
  );
}

export interface TrabajadorActivo {
  id: string;
  nombre: string;
  activo: boolean;
}

/** Lista de trabajadores activos, para los selects "persona" de ambas secciones. */
export function useTrabajadoresActivos() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["rrhh-trabajadores-activos"],
    queryFn: async (): Promise<TrabajadorActivo[]> => {
      const { data, error } = await supabase
        .from("trabajadores")
        .select("id, nombre, activo")
        .eq("activo", true)
        .order("nombre", { ascending: true });
      if (error) throw toError(error);
      return (data ?? []) as TrabajadorActivo[];
    },
    enabled: Boolean(user),
  });

  return { trabajadores: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

// ─── Amonestaciones ──────────────────────────────────────────────────────────

export type RrhhGravedad = "leve" | "grave" | "muy_grave";

export interface RrhhAmonestacionRow {
  id: string;
  user_id: string;
  trabajador_id: string;
  fecha: string;
  motivo: string;
  gravedad: RrhhGravedad;
  archivo_path: string | null;
  archivo_nombre: string | null;
  notas: string | null;
  created_at: string;
}

export interface NuevaAmonestacionInput {
  trabajador_id: string;
  fecha: string;
  motivo: string;
  gravedad: RrhhGravedad;
  notas: string | null;
  file: File | null;
}

export function useRrhhAmonestaciones() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["rrhh-amonestaciones"] as const;

  const query = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<RrhhAmonestacionRow[]> => {
      const { data, error } = await SUPA
        .from("rrhh_amonestaciones")
        .select("*")
        .order("fecha", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RrhhAmonestacionRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(query.error);

  const crear = useMutation({
    mutationFn: async (input: NuevaAmonestacionInput) => {
      if (!user) throw new Error("Debes iniciar sesion para registrar una amonestacion.");

      let archivo_path: string | null = null;
      let archivo_nombre: string | null = null;
      if (input.file) {
        const path = `amonestaciones/${idCortoStorage()}-${sanearNombreArchivo(input.file.name)}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, input.file);
        if (uploadError) throw toError(uploadError);
        archivo_path = path;
        archivo_nombre = input.file.name;
      }

      const { error } = await SUPA.from("rrhh_amonestaciones").insert({
        user_id: user.id,
        trabajador_id: input.trabajador_id,
        fecha: input.fecha,
        motivo: input.motivo,
        gravedad: input.gravedad,
        notas: input.notas,
        archivo_path,
        archivo_nombre,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const eliminar = useMutation({
    mutationFn: async (row: RrhhAmonestacionRow) => {
      if (row.archivo_path) {
        // Best-effort: si falla el borrado del storage no bloqueamos el borrado de la fila.
        await supabase.storage.from(BUCKET).remove([row.archivo_path]).catch(() => undefined);
      }
      const { error } = await SUPA.from("rrhh_amonestaciones").delete().eq("id", row.id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    amonestaciones: query.data ?? [],
    isLoading: query.isLoading,
    sinPermiso,
    crear,
    eliminar,
  };
}

// ─── Nominas ─────────────────────────────────────────────────────────────────

export interface RrhhNominaRow {
  id: string;
  user_id: string;
  trabajador_id: string;
  anio: number;
  mes: number;
  archivo_path: string;
  archivo_nombre: string;
  notas: string | null;
  created_at: string;
}

export interface SubirNominaInput {
  trabajador_id: string;
  anio: number;
  mes: number;
  notas: string | null;
  file: File;
}

const TEXTO_PREVIEW_MAX = 220;

/**
 * Lee el PDF en el navegador (pdfjs-dist) y devuelve una fila por página con
 * el mejor trabajador casado (ver casarPaginaConTrabajador en nominasPdf.ts).
 * Se ejecuta al elegir el archivo, ANTES de subir nada, para poder mostrar y
 * revisar la cola de asignación en RrhhNominas.tsx.
 */
export async function analizarPdfNominas(
  file: File,
  trabajadores: readonly TrabajadorNominaCandidato[],
): Promise<PaginaNomina[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const documento = await pdfjsLib.getDocument({ data: bytes }).promise;

  const paginas: PaginaNomina[] = [];
  for (let numeroPagina = 1; numeroPagina <= documento.numPages; numeroPagina++) {
    const pagina = await documento.getPage(numeroPagina);
    const contenido = await pagina.getTextContent();
    const texto = contenido.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const resultado = casarPaginaConTrabajador(texto, trabajadores);
    paginas.push({
      indice: numeroPagina - 1,
      trabajadorId: resultado.trabajadorId,
      confianza: resultado.confianza,
      textoPreview: texto.slice(0, TEXTO_PREVIEW_MAX),
    });
  }

  return paginas;
}

export interface AsignacionPaginaNomina {
  paginaIndice: number;
  trabajadorId: string;
}

export interface ImportarNominasPdfInput {
  file: File;
  anio: number;
  mes: number;
  asignaciones: AsignacionPaginaNomina[];
}

export interface ImportarNominasPdfError {
  paginaIndice: number;
  mensaje: string;
}

export interface ImportarNominasPdfResumen {
  asignadas: number;
  errores: ImportarNominasPdfError[];
}

export function useRrhhNominas(anio: number) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["rrhh-nominas", anio] as const;

  const query = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<RrhhNominaRow[]> => {
      const { data, error } = await SUPA
        .from("rrhh_nominas")
        .select("*")
        .eq("anio", anio);
      if (error) throw error;
      return (data ?? []) as RrhhNominaRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(query.error);

  const porTrabajadorYMes = useMemo(() => {
    const map = new Map<string, RrhhNominaRow>();
    for (const row of query.data ?? []) map.set(`${row.trabajador_id}-${row.mes}`, row);
    return map;
  }, [query.data]);

  /** Sube el archivo a storage y hace upsert por (trabajador_id, anio, mes). */
  const subir = useMutation({
    mutationFn: async (input: SubirNominaInput) => {
      if (!user) throw new Error("Debes iniciar sesion para subir una nomina.");
      const path = `nominas/${idCortoStorage()}-${sanearNombreArchivo(input.file.name)}`;

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, input.file);
      if (uploadError) throw toError(uploadError);

      // Si ya habia una nomina para ese mes, borramos el archivo antiguo del storage
      // (best-effort) para no dejar huerfanos tras el upsert.
      const existente = porTrabajadorYMes.get(`${input.trabajador_id}-${input.mes}`);
      if (existente?.archivo_path) {
        await supabase.storage.from(BUCKET).remove([existente.archivo_path]).catch(() => undefined);
      }

      const { error } = await SUPA.from("rrhh_nominas").upsert(
        {
          user_id: user.id,
          trabajador_id: input.trabajador_id,
          anio: input.anio,
          mes: input.mes,
          archivo_path: path,
          archivo_nombre: input.file.name,
          notas: input.notas,
        },
        { onConflict: "trabajador_id,anio,mes" },
      );
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rrhh-nominas"] });
    },
  });

  const eliminar = useMutation({
    mutationFn: async (row: RrhhNominaRow) => {
      await supabase.storage.from(BUCKET).remove([row.archivo_path]).catch(() => undefined);
      const { error } = await SUPA.from("rrhh_nominas").delete().eq("id", row.id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rrhh-nominas"] });
    },
  });

  /**
   * Importación masiva: recorta del PDF fuente (pdf-lib) cada página ya
   * asignada a un trabajador, la sube como PDF de 1 página y hace upsert por
   * (trabajador_id, anio, mes) — igual que `subir`, pero en lote. Ninguna
   * página falla en silencio: los errores por página se acumulan en el
   * resumen en vez de abortar el resto del lote.
   */
  const importarNominasPdf = useMutation({
    mutationFn: async (input: ImportarNominasPdfInput): Promise<ImportarNominasPdfResumen> => {
      if (!user) throw new Error("Debes iniciar sesion para importar nominas.");
      if (input.asignaciones.length === 0) {
        throw new Error("No hay ninguna pagina asignada para importar.");
      }

      const bytes = new Uint8Array(await input.file.arrayBuffer());
      const documentoOrigen = await PDFDocument.load(bytes);

      let asignadas = 0;
      const errores: ImportarNominasPdfError[] = [];

      for (const asignacion of input.asignaciones) {
        try {
          const documentoNuevo = await PDFDocument.create();
          const [paginaCopiada] = await documentoNuevo.copyPages(documentoOrigen, [asignacion.paginaIndice]);
          documentoNuevo.addPage(paginaCopiada);
          const pdfBytes = await documentoNuevo.save();
          const blob = new Blob([pdfBytes], { type: "application/pdf" });

          const nombreArchivo = `nomina-${input.anio}-${String(input.mes).padStart(2, "0")}.pdf`;
          const path = `nominas/${idCortoStorage()}-${sanearNombreArchivo(nombreArchivo)}`;

          const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob);
          if (uploadError) throw toError(uploadError);

          // Best-effort: si ya habia una nomina para ese trabajador/mes, borramos
          // el archivo antiguo del storage para no dejar huerfanos tras el upsert.
          const existente = porTrabajadorYMes.get(`${asignacion.trabajadorId}-${input.mes}`);
          if (existente?.archivo_path) {
            await supabase.storage.from(BUCKET).remove([existente.archivo_path]).catch(() => undefined);
          }

          const { error } = await SUPA.from("rrhh_nominas").upsert(
            {
              user_id: user.id,
              trabajador_id: asignacion.trabajadorId,
              anio: input.anio,
              mes: input.mes,
              archivo_path: path,
              archivo_nombre: nombreArchivo,
              notas: null,
            },
            { onConflict: "trabajador_id,anio,mes" },
          );
          if (error) throw toError(error);

          asignadas++;
        } catch (err) {
          errores.push({ paginaIndice: asignacion.paginaIndice, mensaje: errorMessage(err) });
        }
      }

      return { asignadas, errores };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rrhh-nominas"] });
    },
  });

  return {
    nominas: query.data ?? [],
    porTrabajadorYMes,
    isLoading: query.isLoading,
    sinPermiso,
    subir,
    eliminar,
    importarNominasPdf,
  };
}

/** URL firmada de descarga/visualizacion (bucket privado, 60s de validez). */
export async function urlFirmada(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error) throw toError(error);
  if (!data?.signedUrl) throw new Error("No se pudo generar el enlace de descarga.");
  return data.signedUrl;
}
