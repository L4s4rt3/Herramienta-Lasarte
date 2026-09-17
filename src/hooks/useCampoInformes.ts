// Campo → Informe de finca: los datos de la pantalla.
//
// Junta las tres piezas que hacen falta para que el informe salga con un botón:
//   1. lo que se guarda del informe (la visita, los puntos, las capturas),
//   2. lo que YA está en la base y no se vuelve a teclear (parcelas, calibre,
//      curvas, entradas de báscula y clasificación del calibrador),
//   3. la generación del .docx, que se entrega con la lib compartida
//      (compartir en el móvil, descargar en escritorio).
//
// LAS IMÁGENES van al bucket "partes-archivos" bajo
// <uid>/campo-informes/<informe_id>/, con el uid como PRIMERA carpeta: es lo
// que exige la política de insert del bucket (lo mismo que calidad-import).
//
// PAGINACIÓN: la clasificación de una finca grande pasa de 1.000 filas y
// PostgREST recorta en silencio. Se pide con fetchAllRows y orden estable.
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { blobAImagenInforme, cargarLogoInforme, DOCX_MIME, entregarArchivo } from "@/lib/entregarArchivo";
import {
  armarInformeCampo, type ClasifFincaInput, type EntradaFincaInput, type ImagenInforme,
  type InformeCampo, type InformeCampoRow, type PuntoMuestreo,
} from "@/lib/campoInforme";
import { informeCampoDocxBlob, nombreInformeCampo, type ImagenDelInforme } from "@/lib/campoInformeDocx";
import { fetchCampoCalibre, fetchCampoParcelas } from "@/hooks/useCampoParcelas";

const BUCKET = "partes-archivos";

export const CAMPO_INFORMES_KEY = ["campo_informes"] as const;
const detalleKey = (id: string) => ["campo_informe", id] as const;
const fincaKey = (finca: string) => ["campo_informe_finca", finca] as const;

/**
 * Las tres tablas del informe todavía no están en el Database generado
 * (src/integrations/supabase/types.ts lo está tocando otra rama y regenerarlo
 * se llevaría por delante su trabajo), así que se accede con un cliente laxo
 * —mismo apaño que useCampoParcelas— pero tipando el resultado en los bordes:
 * cada consulta declara qué forma espera y de ahí para arriba todo va tipado.
 */
interface ConsultaSinTipar<T> extends PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  select: (columnas: string) => ConsultaSinTipar<T>;
  insert: (filas: unknown) => ConsultaSinTipar<T>;
  update: (cambios: unknown) => ConsultaSinTipar<T>;
  delete: () => ConsultaSinTipar<T>;
  eq: (columna: string, valor: unknown) => ConsultaSinTipar<T>;
  order: (columna: string, opciones?: { ascending?: boolean }) => ConsultaSinTipar<T>;
  single: () => PromiseLike<{ data: T | null; error: { message: string } | null }>;
}

const tabla = <T>(nombre: string): ConsultaSinTipar<T> =>
  (supabase as unknown as { from: <U>(t: string) => ConsultaSinTipar<U> }).from<T>(nombre);

// ─── Lista de informes ───────────────────────────────────────────────────────

export function useCampoInformes() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CAMPO_INFORMES_KEY,
    queryFn: async (): Promise<InformeCampoRow[]> => {
      const { data, error } = await tabla<InformeCampoRow>("campo_informes")
        .select("id, finca, fecha_visita, personal, apoyo_tecnico, semana_muestreo, objetivo_mm, objetivo_nota, horizonte_semana, antecedentes, contexto, conclusion, estado")
        .order("fecha_visita", { ascending: false })
        .order("id");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ ...r, objetivo_mm: Number(r.objetivo_mm) }));
    },
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });

  const crear = useMutation({
    mutationFn: async (nuevo: Partial<InformeCampoRow> & { finca: string }): Promise<string> => {
      const { data, error } = await tabla<{ id: string }>("campo_informes").insert(nuevo).select("id").single();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("El informe no se creó.");
      return data.id;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CAMPO_INFORMES_KEY }),
  });

  const guardar = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: Partial<InformeCampoRow> }) => {
      const { error } = await tabla<InformeCampoRow>("campo_informes").update(cambios).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      void queryClient.invalidateQueries({ queryKey: CAMPO_INFORMES_KEY });
      void queryClient.invalidateQueries({ queryKey: detalleKey(v.id) });
    },
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      // Las imágenes del almacén no se van solas con el borrado en cascada.
      const { data } = await tabla<{ file_path: string }>("campo_informe_imagenes").select("file_path").eq("informe_id", id);
      const paths = (data ?? []).map((i) => i.file_path);
      if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths).catch(() => undefined);
      const { error } = await tabla<InformeCampoRow>("campo_informes").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CAMPO_INFORMES_KEY }),
  });

  return {
    informes: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    crear: crear.mutateAsync,
    guardar: guardar.mutateAsync,
    borrar: borrar.mutateAsync,
    guardando: guardar.isPending || crear.isPending,
  };
}

// ─── Un informe: sus puntos y sus imágenes ───────────────────────────────────

export interface DetalleInforme {
  puntos: PuntoMuestreo[];
  imagenes: ImagenInforme[];
}

export function useDetalleInforme(informeId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: detalleKey(informeId ?? "—"),
    queryFn: async (): Promise<DetalleInforme> => {
      const [puntos, imagenes] = await Promise.all([
        tabla<PuntoMuestreo>("campo_informe_puntos").select("id, codigo, mm, lat, lon, semana, nota, orden").eq("informe_id", informeId!).order("orden"),
        tabla<ImagenInforme>("campo_informe_imagenes").select("id, tipo, punto_id, file_path, file_name, pie, orden").eq("informe_id", informeId!).order("orden"),
      ]);
      if (puntos.error) throw new Error(puntos.error.message);
      if (imagenes.error) throw new Error(imagenes.error.message);
      return {
        puntos: (puntos.data ?? []).map((p) => ({
          ...p, mm: Number(p.mm),
          lat: p.lat == null ? null : Number(p.lat),
          lon: p.lon == null ? null : Number(p.lon),
        })),
        imagenes: imagenes.data ?? [],
      };
    },
    enabled: Boolean(user) && Boolean(informeId),
    staleTime: 60_000,
  });

  const invalidar = useCallback(() => {
    if (informeId) void queryClient.invalidateQueries({ queryKey: detalleKey(informeId) });
  }, [informeId, queryClient]);

  const guardarPunto = useMutation({
    mutationFn: async (punto: Omit<PuntoMuestreo, "id"> & { id?: string }) => {
      const fila = {
        informe_id: informeId, codigo: punto.codigo, mm: punto.mm, lat: punto.lat, lon: punto.lon,
        semana: punto.semana, nota: punto.nota, orden: punto.orden,
      };
      const { error } = punto.id
        ? await tabla<PuntoMuestreo>("campo_informe_puntos").update(fila).eq("id", punto.id)
        : await tabla<PuntoMuestreo>("campo_informe_puntos").insert(fila);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidar,
  });

  const borrarPunto = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tabla<PuntoMuestreo>("campo_informe_puntos").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidar,
  });

  const subirImagen = useMutation({
    mutationFn: async ({ archivo, tipo, puntoId, pie }: { archivo: File; tipo: ImagenInforme["tipo"]; puntoId?: string | null; pie?: string | null }) => {
      const { data: sesion } = await supabase.auth.getUser();
      const uid = sesion.user?.id;
      if (!uid) throw new Error("Sin sesión: vuelve a entrar.");
      const ext = (archivo.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      // El uid PRIMERO: la política de insert del bucket lo exige.
      const path = `${uid}/campo-informes/${informeId}/${tipo}-${Date.now()}.${ext}`;
      const { error: subida } = await supabase.storage.from(BUCKET).upload(path, archivo, { contentType: archivo.type, upsert: true });
      if (subida) throw new Error(subida.message);
      const { error } = await tabla<ImagenInforme>("campo_informe_imagenes").insert({
        informe_id: informeId, tipo, punto_id: puntoId ?? null, file_path: path,
        file_name: archivo.name, mime_type: archivo.type, file_size: archivo.size,
        pie: pie ?? null, orden: Date.now() % 100000,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidar,
  });

  const borrarImagen = useMutation({
    mutationFn: async (imagen: ImagenInforme) => {
      await supabase.storage.from(BUCKET).remove([imagen.file_path]).catch(() => undefined);
      const { error } = await tabla<ImagenInforme>("campo_informe_imagenes").delete().eq("id", imagen.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidar,
  });

  return {
    puntos: query.data?.puntos ?? [],
    imagenes: query.data?.imagenes ?? [],
    isLoading: query.isLoading,
    guardarPunto: guardarPunto.mutateAsync,
    borrarPunto: borrarPunto.mutateAsync,
    subirImagen: subirImagen.mutateAsync,
    borrarImagen: borrarImagen.mutateAsync,
    trabajando: guardarPunto.isPending || borrarPunto.isPending || subirImagen.isPending || borrarImagen.isPending,
  };
}

// ─── Lo que ya está en la base y no se vuelve a teclear ──────────────────────

export interface DatosDeLaFinca {
  entradas: EntradaFincaInput[];
  clasif: ClasifFincaInput[];
}

/** Entregas de la finca y clasificación del calibrador de sus lotes. */
export async function fetchDatosDeFinca(finca: string): Promise<DatosDeLaFinca> {
  const entradas = await fetchAllRows<EntradaFincaInput & { id: string }>((from, to) =>
    supabase.from("entradas_bascula").select("id, finca, lote, fecha, articulo, kg_entrada")
      .ilike("finca", finca).order("fecha").order("id").range(from, to));
  const lotes = [...new Set(entradas.map((e) => e.lote).filter(Boolean))];
  if (lotes.length === 0) return { entradas, clasif: [] };

  // De 200 en 200: un .in() con cientos de códigos hace una URL enorme.
  const clasif: ClasifFincaInput[] = [];
  for (let i = 0; i < lotes.length; i += 200) {
    const trozo = lotes.slice(i, i + 200);
    const filas = await fetchAllRows<ClasifFincaInput & { id: string }>((from, to) =>
      supabase.from("clasificacion_lote").select("id, lote_codigo_base, grupo_destino, clase, producto, peso_kg")
        .in("lote_codigo_base", trozo).order("id").range(from, to));
    clasif.push(...filas.map((f) => ({ ...f, peso_kg: f.peso_kg == null ? null : Number(f.peso_kg) })));
  }
  return { entradas: entradas.map((e) => ({ ...e, kg_entrada: e.kg_entrada == null ? null : Number(e.kg_entrada) })), clasif };
}

export function useDatosDeFinca(finca: string | null) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: fincaKey(finca ?? "—"),
    queryFn: () => fetchDatosDeFinca(finca!),
    enabled: Boolean(user) && Boolean(finca),
    staleTime: 10 * 60_000,
  });
  return { entradas: query.data?.entradas ?? [], clasif: query.data?.clasif ?? [], isLoading: query.isLoading };
}

// ─── El informe armado, listo para pintar y para generar ─────────────────────

export function useInformeArmado(
  informe: InformeCampoRow | null,
  puntos: PuntoMuestreo[],
  imagenes: ImagenInforme[],
): InformeCampo | null {
  const { user } = useAuth();
  const parcelas = useQuery({ queryKey: ["campo_parcelas"], queryFn: fetchCampoParcelas, enabled: Boolean(user), staleTime: 30 * 60_000 });
  const calibre = useQuery({ queryKey: ["campo_calibre"], queryFn: fetchCampoCalibre, enabled: Boolean(user), staleTime: 30 * 60_000 });
  const { entradas, clasif } = useDatosDeFinca(informe?.finca ?? null);

  return useMemo(() => {
    if (!informe) return null;
    return armarInformeCampo({
      informe,
      parcelas: parcelas.data ?? [],
      medidas: calibre.data?.medidas ?? [],
      curvas: calibre.data?.curvas ?? [],
      puntos, imagenes, entradas, clasif,
    });
  }, [informe, parcelas.data, calibre.data, puntos, imagenes, entradas, clasif]);
}

// ─── Generar y entregar el documento ─────────────────────────────────────────

/**
 * Descarga las capturas del almacén, monta el .docx y lo entrega. Devuelve el
 * nombre del archivo, o null si se canceló la hoja de compartir del móvil.
 */
export async function generarYEntregarInformeCampo(armado: InformeCampo, imagenes: ImagenInforme[]): Promise<string | null> {
  const logo = await cargarLogoInforme();

  const listas: ImagenDelInforme[] = [];
  for (const img of [...imagenes].sort((a, b) => a.orden - b.orden)) {
    const { data } = await supabase.storage.from(BUCKET).download(img.file_path);
    if (!data) continue;
    try {
      const medida = await blobAImagenInforme(data, img.file_name.toLowerCase().endsWith(".png") ? "png" : "jpg");
      listas.push({ ...medida, id: img.id, clase: img.tipo, punto_id: img.punto_id, pie: img.pie });
    } catch {
      // Imagen que el navegador no sabe decodificar: se omite, no se rompe el informe.
    }
  }

  const blob = await informeCampoDocxBlob(armado, { logo, imagenes: listas });
  const filename = nombreInformeCampo(armado);
  const via = await entregarArchivo(blob, filename, DOCX_MIME);
  return via === "cancelado" ? null : filename;
}
