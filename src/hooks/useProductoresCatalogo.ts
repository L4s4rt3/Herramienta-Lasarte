/**
 * useProductoresCatalogo — catálogo global de productores (calidad_productores,
 * promocionada de "solo para Calidad" a fuente única de verdad para
 * entradas_bascula, lotes_dia y calidad_lotes) + alias aprendidos
 * (productores_alias, mismo patrón que trabajadores_alias /
 * src/hooks/useTrabajadoresAlias.ts) + la cola de "nombres sin vincular" para
 * la sección de administración en src/pages/Productores.tsx.
 *
 * IMPORTANTE: productores_alias y las columnas entradas_bascula.productor_id /
 * lotes_dia.productor_id vienen de supabase/migrations/
 * 20260714090000_productores_canonicos.sql, pendiente de aplicar por el
 * orquestador. Hasta que se aplique:
 *  - las queries de alias devuelven [] (tabla no existe: se detecta y degrada,
 *    `migracionPendiente` queda en true para que la página lo indique).
 *  - "nombres sin vincular" trata TODOS los nombres de entradas_bascula/
 *    lotes_dia como pendientes (no hay columna productor_id que filtrar
 *    todavía), que es la cola correcta: sin la migración no hay ningún
 *    nombre vinculado aún. calidad_lotes.productor_finca_id SÍ existe desde
 *    antes, así que ahí el filtro real ya funciona.
 * Cuando se aplique y se regeneren los tipos, sustituir el cast SUPA por
 * `Tables<"productores_alias">` y las columnas nuevas por sus tipos generados,
 * y quitar `esErrorTablaOColumnaInexistente` de aquí (ya no hará falta).
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { esErrorTablaOColumnaInexistente, normalizeProductorName } from "@/lib/productoresCanonicos";
import type { Tables } from "@/integrations/supabase/types";

// Cast local: productores_alias y las columnas productor_id aun no estan en
// el Database generado. Ver comentario de cabecera para el plan de retirada.
const SUPA = supabase as unknown as SupabaseClient<any>;

export type ProductorCatalogoRow = Tables<"calidad_productores">;

export interface ProductorAliasRow {
  id: string;
  productor_id: string;
  alias: string;
  alias_normalizado: string;
  origen: string;
  created_at: string;
}

export type FuentePendiente = "bascula" | "calibrador" | "calidad";

export interface NombrePendiente {
  /** Uno de los nombres crudos vistos para este normalizado (el primero encontrado). */
  nombre: string;
  normalizado: string;
  apariciones: number;
  fuentes: FuentePendiente[];
}

const FUENTES: Array<{ tabla: string; columna: string; idColumna: string; fuente: FuentePendiente }> = [
  { tabla: "entradas_bascula", columna: "agricultor", idColumna: "productor_id", fuente: "bascula" },
  { tabla: "lotes_dia", columna: "productor", idColumna: "productor_id", fuente: "calibrador" },
  { tabla: "calidad_lotes", columna: "productor_finca_nombre", idColumna: "productor_finca_id", fuente: "calidad" },
];

const LIMIT_FILAS = 50000;
const CHUNK = 200;

/**
 * Trae `columnas` de `tabla` donde `idColumna` es NULL. Si `idColumna` todavía
 * no existe (columna nueva sin migrar), degrada a traer TODAS las filas: sin
 * la migración no hay ningún vínculo, así que "todas" es la cola correcta.
 * Si la tabla en sí no existe, devuelve [].
 */
async function fetchFilasSinVincular(tabla: string, columnas: string, idColumna: string): Promise<any[]> {
  const conFiltro = await SUPA.from(tabla).select(columnas).is(idColumna, null).limit(LIMIT_FILAS);
  if (!conFiltro.error) return conFiltro.data ?? [];
  if (!esErrorTablaOColumnaInexistente(conFiltro.error)) throw toError(conFiltro.error);

  const sinFiltro = await SUPA.from(tabla).select(columnas).limit(LIMIT_FILAS);
  if (sinFiltro.error) {
    if (esErrorTablaOColumnaInexistente(sinFiltro.error)) return [];
    throw toError(sinFiltro.error);
  }
  return sinFiltro.data ?? [];
}

export function useProductoresCatalogo() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const catalogoKey = ["productores-catalogo"] as const;
  const aliasKey = ["productores-alias"] as const;
  const pendientesKey = ["productores-pendientes"] as const;

  const invalidarTodo = () => {
    queryClient.invalidateQueries({ queryKey: catalogoKey });
    queryClient.invalidateQueries({ queryKey: aliasKey });
    queryClient.invalidateQueries({ queryKey: pendientesKey });
  };

  const catalogoQuery = useQuery({
    queryKey: catalogoKey,
    queryFn: async (): Promise<ProductorCatalogoRow[]> => {
      const { data, error } = await supabase.from("calidad_productores").select("*").order("nombre", { ascending: true });
      if (error) throw toError(error);
      return (data ?? []) as ProductorCatalogoRow[];
    },
    enabled: Boolean(user),
  });

  const aliasQuery = useQuery({
    queryKey: aliasKey,
    queryFn: async (): Promise<{ rows: ProductorAliasRow[]; disponible: boolean }> => {
      const { data, error } = await SUPA.from("productores_alias").select("*");
      if (error) {
        if (esErrorTablaOColumnaInexistente(error)) {
          console.warn("useProductoresCatalogo: productores_alias aún no existe (migración 20260714090000 pendiente de aplicar).", error);
          return { rows: [], disponible: false };
        }
        throw toError(error);
      }
      return { rows: (data ?? []) as ProductorAliasRow[], disponible: true };
    },
    enabled: Boolean(user),
  });

  const pendientesQuery = useQuery({
    queryKey: pendientesKey,
    queryFn: async (): Promise<NombrePendiente[]> => {
      const porFuente = await Promise.all(
        FUENTES.map(async ({ tabla, columna, idColumna, fuente }) => {
          const filas = await fetchFilasSinVincular(tabla, columna, idColumna);
          const nombres = filas
            .map((f) => f[columna])
            .filter((v): v is string => typeof v === "string" && v.trim() !== "");
          return { fuente, nombres };
        }),
      );

      const map = new Map<string, NombrePendiente>();
      for (const { fuente, nombres } of porFuente) {
        for (const nombreCrudo of nombres) {
          const normalizado = normalizeProductorName(nombreCrudo);
          if (!normalizado) continue;
          const entry = map.get(normalizado) ?? { nombre: nombreCrudo, normalizado, apariciones: 0, fuentes: [] };
          entry.apariciones += 1;
          if (!entry.fuentes.includes(fuente)) entry.fuentes.push(fuente);
          map.set(normalizado, entry);
        }
      }
      return Array.from(map.values()).sort((a, b) => b.apariciones - a.apariciones);
    },
    enabled: Boolean(user),
  });

  const nombrePorProductorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of catalogoQuery.data ?? []) map.set(p.id, p.nombre);
    return map;
  }, [catalogoQuery.data]);

  const aliasPorNombreNormalizado = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of aliasQuery.data?.rows ?? []) map.set(a.alias_normalizado, a.productor_id);
    return map;
  }, [aliasQuery.data]);

  /** Crea un productor nuevo en el catálogo. */
  const crearProductor = useMutation({
    mutationFn: async (nombre: string): Promise<ProductorCatalogoRow> => {
      if (!user) throw new Error("Debes iniciar sesión para crear un productor.");
      const limpio = nombre.trim();
      if (!limpio) throw new Error("El nombre del productor no puede estar vacío.");
      const { data, error } = await supabase
        .from("calidad_productores")
        .insert({ user_id: user.id, nombre: limpio })
        .select("*")
        .single();
      if (error) throw toError(error);
      return data as ProductorCatalogoRow;
    },
    onSuccess: invalidarTodo,
  });

  /**
   * Asigna un nombre pendiente a un productor del catálogo: crea el alias y
   * actualiza retroactivamente las filas de las 3 fuentes cuyo texto
   * normalizado case con ese alias (idColumna todavía NULL).
   */
  const asignarNombreAProductor = useMutation({
    mutationFn: async (input: { productorId: string; nombreCrudo: string }) => {
      const alias = input.nombreCrudo.trim();
      if (!alias) throw new Error("El nombre a vincular no puede estar vacío.");
      const normalizado = normalizeProductorName(alias);
      if (!normalizado) throw new Error("El nombre a vincular no es válido.");

      const { error: aliasError } = await SUPA
        .from("productores_alias")
        .upsert(
          { productor_id: input.productorId, alias, alias_normalizado: normalizado, origen: "manual" },
          { onConflict: "alias_normalizado" },
        );
      if (aliasError) {
        if (esErrorTablaOColumnaInexistente(aliasError)) {
          throw new Error("La tabla productores_alias todavía no existe: aplica primero la migración 20260714090000_productores_canonicos.sql.");
        }
        throw toError(aliasError);
      }

      // Retroactivo: liga las filas ya existentes de las 3 fuentes cuyo
      // texto normalizado case exacto con este alias y aún no tengan id.
      for (const { tabla, columna, idColumna } of FUENTES) {
        const filas = await fetchFilasSinVincular(tabla, `id, ${columna}`, idColumna);
        const ids = filas
          .filter((f) => normalizeProductorName(f[columna]) === normalizado)
          .map((f) => f.id as string);
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const { error: updError } = await SUPA.from(tabla).update({ [idColumna]: input.productorId }).in("id", chunk);
          if (updError && !esErrorTablaOColumnaInexistente(updError)) throw toError(updError);
        }
      }
    },
    onSuccess: invalidarTodo,
  });

  /** Atajo: crea el productor y en el mismo paso vincula el nombre pendiente. */
  const crearProductorYVincular = useMutation({
    mutationFn: async (input: { nombre: string; nombreCrudo: string }) => {
      const nuevo = await crearProductor.mutateAsync(input.nombre);
      await asignarNombreAProductor.mutateAsync({ productorId: nuevo.id, nombreCrudo: input.nombreCrudo });
      return nuevo;
    },
    onSuccess: invalidarTodo,
  });

  return {
    productores: catalogoQuery.data ?? [],
    nombrePorProductorId,
    aliasPorNombreNormalizado,
    nombresPendientes: pendientesQuery.data ?? [],
    /** true si productores_alias todavía no existe (migración pendiente de aplicar). */
    migracionPendiente: aliasQuery.data ? !aliasQuery.data.disponible : false,
    isLoading: catalogoQuery.isLoading || aliasQuery.isLoading || pendientesQuery.isLoading,
    error: catalogoQuery.error ?? pendientesQuery.error ?? null,
    crearProductor,
    asignarNombreAProductor,
    crearProductorYVincular,
  };
}
