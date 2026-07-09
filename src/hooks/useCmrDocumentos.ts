/**
 * useCmrDocumentos — acceso al bucket privado "logistics-templates" (histórico
 * digitalizado de CMR/hojas de ruta, 2.859 + 176 ficheros) y a la tabla
 * public.cmr_documentos (metadatos de documentos subidos o generados desde la
 * app).
 *
 * IMPORTANTE: la tabla cmr_documentos NO existe todavia en
 * src/integrations/supabase/types.ts (infraestructura ya aplicada en la base
 * por el orquestador, pendiente solo de regenerar tipos). Mientras tanto se
 * usa el cast `SUPA` de mas abajo, copiando el patron exacto de
 * src/hooks/useMercadonaVentas.ts: cuando se regeneren los tipos, sustituir
 * los `as any` por `Tables<"cmr_documentos">` y eliminar el cast.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { idCortoStorage, parseArchivoNombre, sanearNombreArchivo } from "@/lib/cmrArchivo";

// Cast local: la tabla cmr_documentos aun no esta en el Database generado.
// Ver comentario de cabecera para el plan de retirada de este cast.
const SUPA = supabase as unknown as SupabaseClient<any>;

const BUCKET = "logistics-templates";
const PAGE_SIZE = 50;

export type CmrPrefijo = "cmr" | "route";
export type CmrTipo = "cmr" | "hoja_ruta";
export type CmrOrigen = "generado" | "subido";

export function prefijoDeTipo(tipo: CmrTipo): CmrPrefijo {
  return tipo === "cmr" ? "cmr" : "route";
}

const SUGERENCIAS_LISTADO_LIMITE = 1000;
const SUGERENCIAS_TOP = 50;

/**
 * Deriva listas candidatas de CLIENTES y TRANSPORTISTAS a partir de los
 * nombres de fichero del histórico digitalizado ("cmr/<hash>-PACO-CMR-10305-
 * COFRULY-LYON-ANTONIO-CANO.pdf", ver cabecera de src/lib/cmrArchivo.ts).
 *
 * Es best-effort y best-effort SOLO: parseArchivoNombre ya reduce el nombre a
 * una "etiqueta" legible (palabras separadas por espacio, sin el hash inicial
 * ni la extensión); a partir de ahí no hay forma fiable de saber qué palabras
 * son el cliente y cuáles el transportista (los guiones del nombre original
 * separan TODOS los tokens por igual, no solo los campos). La heurística
 * aplicada — quitar el token "CMR" y el número, y partir el resto por la
 * mitad (primera mitad -> cliente, segunda mitad -> transportista) — es
 * razonable para el patrón dominante observado ("<cliente 2 palabras>-
 * <transportista 2 palabras>") y sirve como sugerencia de autocompletado, no
 * como dato autoritativo.
 */
export function extraerCandidatosCmr(nombres: string[]): { clientes: string[]; transportistas: string[] } {
  const clientes = new Map<string, string>();
  const transportistas = new Map<string, string>();

  for (const nombre of nombres) {
    const { numero, etiqueta } = parseArchivoNombre(nombre, "cmr");
    if (!etiqueta) continue;

    const tokens = etiqueta
      .split(/\s+/)
      .filter(Boolean)
      .filter((t) => t.toUpperCase() !== "CMR")
      .filter((t) => !(numero && t === numero));
    if (tokens.length < 2) continue; // sin suficientes tokens para separar cliente/transportista

    const mitad = Math.ceil(tokens.length / 2);
    const cliente = tokens.slice(0, mitad).join(" ").trim();
    const transportista = tokens.slice(mitad).join(" ").trim();

    if (cliente && !clientes.has(cliente.toLowerCase())) clientes.set(cliente.toLowerCase(), cliente);
    if (transportista && !transportistas.has(transportista.toLowerCase())) {
      transportistas.set(transportista.toLowerCase(), transportista);
    }
  }

  const ordenar = (mapa: Map<string, string>) =>
    Array.from(mapa.values())
      .sort((a, b) => a.localeCompare(b, "es"))
      .slice(0, SUGERENCIAS_TOP);

  return { clientes: ordenar(clientes), transportistas: ordenar(transportistas) };
}

export interface CmrArchivoStorage {
  name: string;
  id: string | null;
  updated_at: string | null;
  created_at: string | null;
  metadata: { size?: number; mimetype?: string } | null;
}

export interface CmrDocumentoRow {
  id: string;
  user_id: string;
  tipo: CmrTipo;
  origen: CmrOrigen;
  numero: string | null;
  fecha: string | null;
  cliente: string | null;
  transportista: string | null;
  matricula: string | null;
  destino: string | null;
  notas: string | null;
  datos: Record<string, unknown> | null;
  archivo_path: string;
  archivo_nombre: string;
  created_at: string;
  updated_at: string;
}

export interface SubirDocumentoInput {
  file: File;
  tipo: CmrTipo;
  metadatos?: {
    numero?: string | null;
    fecha?: string | null;
    cliente?: string | null;
    transportista?: string | null;
    matricula?: string | null;
    destino?: string | null;
    notas?: string | null;
  };
}

export interface GuardarGeneradoInput {
  tipo: CmrTipo;
  datos: Record<string, unknown>;
  pdfBytes: Uint8Array;
  nombre: string;
  metadatos?: {
    numero?: string | null;
    fecha?: string | null;
    cliente?: string | null;
    transportista?: string | null;
    matricula?: string | null;
    destino?: string | null;
    notas?: string | null;
  };
}

/**
 * Listado paginado (50 en 50) del bucket "logistics-templates" bajo el
 * prefijo indicado ("cmr" o "route"), con búsqueda server-side opcional
 * (parámetro `search` de storage.list, que filtra por substring del nombre).
 */
export function useListarArchivoCmr(prefijo: CmrPrefijo, search: string) {
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ["cmr-archivo", prefijo, search, page],
    queryFn: async (): Promise<{ archivos: CmrArchivoStorage[]; hasMore: boolean }> => {
      const { data, error } = await supabase.storage.from(BUCKET).list(prefijo, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: search.trim() || undefined,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw toError(error);
      const archivos = (data ?? []) as CmrArchivoStorage[];
      return { archivos, hasMore: archivos.length === PAGE_SIZE };
    },
    placeholderData: (previous) => previous,
  });

  return {
    archivos: query.data?.archivos ?? [],
    hasMore: query.data?.hasMore ?? false,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    page,
    goToPage: setPage,
    nextPage: () => setPage((p) => (query.data?.hasMore ? p + 1 : p)),
    prevPage: () => setPage((p) => Math.max(0, p - 1)),
    resetPage: () => setPage(0),
  };
}

/**
 * Listas de CLIENTES y TRANSPORTISTAS candidatos, derivadas del histórico de
 * nombres de fichero en "logistics-templates/cmr" (ver extraerCandidatosCmr).
 * Pensado para sugerencias de autocompletado (datalist) en el formulario de
 * "Generar", no para datos exactos: el resultado se cachea 30 min porque no
 * necesita estar siempre al día.
 */
export function useSugerenciasCmr() {
  const query = useQuery({
    queryKey: ["cmr-sugerencias"],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).list("cmr", {
        limit: SUGERENCIAS_LISTADO_LIMITE,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw toError(error);
      const nombres = (data ?? []).map((f) => f.name);
      return extraerCandidatosCmr(nombres);
    },
    staleTime: 1000 * 60 * 30,
  });

  return {
    clientes: query.data?.clientes ?? [],
    transportistas: query.data?.transportistas ?? [],
    isLoading: query.isLoading,
  };
}

/** Filas de cmr_documentos para el tipo dado (metadatos de subidos/generados). */
export function useCmrDocumentosRegistrados(tipo: CmrTipo) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["cmr-documentos", tipo],
    queryFn: async (): Promise<CmrDocumentoRow[]> => {
      const { data, error } = await SUPA
        .from("cmr_documentos")
        .select("*")
        .eq("tipo", tipo)
        .order("created_at", { ascending: false });
      if (error) throw toError(error);
      return (data ?? []) as CmrDocumentoRow[];
    },
    enabled: Boolean(user),
  });

  const porPath = useMemo(() => {
    const map = new Map<string, CmrDocumentoRow>();
    for (const row of query.data ?? []) map.set(row.archivo_path, row);
    return map;
  }, [query.data]);

  return { documentos: query.data ?? [], porPath, isLoading: query.isLoading, error: query.error };
}

export function useCmrDocumentos() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  /** URL firmada de descarga/visualización (bucket privado, 60s de validez). */
  const urlDescarga = async (path: string): Promise<string> => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
    if (error) throw toError(error);
    if (!data?.signedUrl) throw new Error("No se pudo generar el enlace de descarga.");
    return data.signedUrl;
  };

  const subirDocumento = useMutation({
    mutationFn: async ({ file, tipo, metadatos }: SubirDocumentoInput) => {
      if (!user) throw new Error("Debes iniciar sesion para subir un documento.");
      const prefijo = prefijoDeTipo(tipo);
      const path = `${prefijo}/${idCortoStorage()}-${sanearNombreArchivo(file.name)}`;

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
      if (uploadError) throw toError(uploadError);

      const { error: insertError } = await SUPA.from("cmr_documentos").insert({
        user_id: user.id,
        tipo,
        origen: "subido",
        numero: metadatos?.numero ?? null,
        fecha: metadatos?.fecha ?? null,
        cliente: metadatos?.cliente ?? null,
        transportista: metadatos?.transportista ?? null,
        matricula: metadatos?.matricula ?? null,
        destino: metadatos?.destino ?? null,
        notas: metadatos?.notas ?? null,
        datos: null,
        archivo_path: path,
        archivo_nombre: file.name,
      });
      if (insertError) throw toError(insertError);

      return { path };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cmr-archivo", prefijoDeTipo(variables.tipo)] });
      queryClient.invalidateQueries({ queryKey: ["cmr-documentos", variables.tipo] });
    },
  });

  const guardarGenerado = useMutation({
    mutationFn: async ({ tipo, datos, pdfBytes, nombre, metadatos }: GuardarGeneradoInput) => {
      if (!user) throw new Error("Debes iniciar sesion para archivar el documento.");
      const prefijo = prefijoDeTipo(tipo);
      const path = `${prefijo}/generados-${idCortoStorage()}-${sanearNombreArchivo(nombre)}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, new Blob([pdfBytes], { type: "application/pdf" }), { contentType: "application/pdf" });
      if (uploadError) throw toError(uploadError);

      const { error: insertError } = await SUPA.from("cmr_documentos").insert({
        user_id: user.id,
        tipo,
        origen: "generado",
        numero: metadatos?.numero ?? null,
        fecha: metadatos?.fecha ?? null,
        cliente: metadatos?.cliente ?? null,
        transportista: metadatos?.transportista ?? null,
        matricula: metadatos?.matricula ?? null,
        destino: metadatos?.destino ?? null,
        notas: metadatos?.notas ?? null,
        datos,
        archivo_path: path,
        archivo_nombre: nombre,
      });
      if (insertError) throw toError(insertError);

      return { path };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cmr-archivo", prefijoDeTipo(variables.tipo)] });
      queryClient.invalidateQueries({ queryKey: ["cmr-documentos", variables.tipo] });
    },
  });

  return {
    urlDescarga,
    subirDocumento,
    guardarGenerado,
  };
}
