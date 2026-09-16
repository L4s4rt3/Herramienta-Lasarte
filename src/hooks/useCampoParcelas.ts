// La ficha de campo de cada parcela: hectáreas, variedad y contorno.
//
// De dónde sale: la tabla campo_parcelas, que carga
// scripts/aerobotics-cargar-parcelas.mjs con los shapefiles que Aerobotics deja
// descargar (la API de ellos es de pago y está descartada). Ver la cabecera de
// la migración 20260916083404_campo_parcelas.sql.
//
// EL ENLACE CON LA BÁSCULA ES FRÁGIL A PROPÓSITO. Aerobotics llama a las cosas
// por el nombre del campo ("TORRECILLA POWELL") y la báscula por el suyo ("La
// Torrecilla Navel Powell"). El cargador propone y guarda con qué confianza; la
// app SOLO usa para calcular las que están "clara" o "confirmada". Una parcela
// "probable" enseña su ficha, pero no se le calculan kilos por hectárea: una
// división sobre un emparejamiento dudoso es un número inventado.
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { esErrorTablaOColumnaInexistente } from "@/lib/productoresCanonicos";
// La forma de la fila vive con las funciones que la usan (src/lib/campoParcelas.ts),
// que son puras y tienen pruebas; aquí solo se trae de la base.
import type { CampoParcelaRow, CurvaCrecimiento, MedidaCalibre } from "@/lib/campoParcelas";

export type { CampoParcelaRow, CurvaCrecimiento, EmparejadoEstado, MedidaCalibre } from "@/lib/campoParcelas";

const COLUMNAS =
  "id, origen, origen_finca_id, origen_finca_nombre, nombre, hectareas, cultivo, variedad, plantacion, patron, contorno, centro_lon, centro_lat, finca, parcela, emparejado_estado, emparejado_puntuacion, emparejado_nota";

/**
 * campo_parcelas todavía no está en el Database generado (src/integrations/
 * supabase/types.ts lo está tocando otra rama, y regenerarlo se llevaría por
 * delante su trabajo). Se tipa aquí, igual que se hizo con las columnas nuevas
 * de entradas_bascula.
 */
interface ClienteSinTipar<T> {
  from: (tabla: string) => {
    select: (columnas: string) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  };
}

/** Lee una tabla que aún no está en el Database generado. Sin migración: lista vacía. */
async function leerTabla<T>(tabla: string, columnas: string): Promise<T[]> {
  const { data, error } = await (supabase as unknown as ClienteSinTipar<T>).from(tabla).select(columnas);
  if (error) {
    if (esErrorTablaOColumnaInexistente(error)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

export const CAMPO_PARCELAS_KEY = ["campo_parcelas"] as const;

export async function fetchCampoParcelas(): Promise<CampoParcelaRow[]> {
  // Migración sin aplicar: la página funciona igual, sin ficha de campo.
  const data = await leerTabla<CampoParcelaRow>("campo_parcelas", COLUMNAS);
  return data.map((r) => ({
    ...r,
    hectareas: r.hectareas == null ? null : Number(r.hectareas),
    centro_lon: r.centro_lon == null ? null : Number(r.centro_lon),
    centro_lat: r.centro_lat == null ? null : Number(r.centro_lat),
    emparejado_puntuacion: r.emparejado_puntuacion == null ? null : Number(r.emparejado_puntuacion),
    contorno: Array.isArray(r.contorno) ? r.contorno : [],
  }));
}

export function useCampoParcelas() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: CAMPO_PARCELAS_KEY,
    queryFn: fetchCampoParcelas,
    enabled: Boolean(user),
    staleTime: 30 * 60_000,
  });
  return { fichas: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

// ─── El calibre en el campo ─────────────────────────────────────────────────
// Se piden aparte de las parcelas porque solo hacen falta al ABRIR una: la
// lista no los usa y son 344 filas que no tiene sentido traerse para nada.

export const CAMPO_CALIBRE_KEY = ["campo_calibre"] as const;

export async function fetchCampoCalibre(): Promise<{ medidas: MedidaCalibre[]; curvas: CurvaCrecimiento[] }> {
  const [medidas, curvas] = await Promise.all([
    leerTabla<MedidaCalibre>(
      "campo_calibre_medidas",
      "id, finca_nombre, bloque, variedad, semana, mm, tipo, mm_previsto, previsto_en, parcela_id",
    ),
    leerTabla<CurvaCrecimiento>(
      "campo_curvas_crecimiento",
      "id, finca_nombre, variedad, floracion_semana, ventana, ventana_desde, ventana_hasta, crecimiento, fuente",
    ),
  ]);
  return {
    medidas: medidas.map((m) => ({
      ...m,
      mm: Number(m.mm),
      mm_previsto: m.mm_previsto == null ? null : Number(m.mm_previsto),
    })),
    curvas: curvas.map((c) => ({ ...c, crecimiento: c.crecimiento ?? {} })),
  };
}

export function useCampoCalibre(activo = true) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: CAMPO_CALIBRE_KEY,
    queryFn: fetchCampoCalibre,
    enabled: Boolean(user) && activo,
    staleTime: 30 * 60_000,
  });
  return {
    medidas: query.data?.medidas ?? [],
    curvas: query.data?.curvas ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
