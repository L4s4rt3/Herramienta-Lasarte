/**
 * clasificacionDetalleCompacta.ts — contrato entre la RPC
 * `lote_clasificacion_detalle_por_partes(p_part_ids uuid[])` y el cliente.
 *
 * POR QUÉ EXISTE (regla del proyecto, ver la cabecera de fetchAllRows.ts):
 * `lote_clasificacion` va por 256.000 filas y PostgREST devuelve como mucho
 * 1.000 por petición, así que traer el detalle de un rango largo con SELECT
 * paginado son cientos de peticiones ENCADENADAS — la página se quedaba
 * cargando minutos. La RPC agrega en servidor y devuelve un ESCALAR jsonb, que
 * el max-rows no recorta: toda la campaña cabe en unas pocas llamadas
 * (medido 06-ago-2026: 60 partes ≈ 66.000 filas en 945 ms).
 *
 * El jsonb viene como ARRAYS POSICIONALES, no objetos: las claves repetidas
 * eran ~la mitad de los bytes de la respuesta. Ese ahorro tiene un precio —
 * si alguien cambia el orden de las columnas en la migración de la RPC y no
 * aquí, los datos se mezclan en silencio (el productor acabaría en `producto`
 * y nadie vería un error). `CLASIF_DETALLE_COLUMNAS` fija ese orden y el test
 * lo comprueba contra el SQL real de la migración: ese es el candado.
 */

/** Orden EXACTO de los campos dentro de cada array de la RPC. No reordenar sin tocar la migración. */
export const CLASIF_DETALLE_COLUMNAS = [
  "lote_codigo",
  "lote_codigo_base",
  "productor",
  "producto",
  "calidad",
  "clase",
  "grupo_destino",
  "tamano",
  "piezas",
  "pct_piezas",
  "peso_kg",
  "pct_peso",
  "cartons",
  "pct_cartons",
  "part_id",
] as const;

/** Misma forma que devolvía el SELECT paginado, para que el consumidor no note el cambio. */
export interface ClasifDetalleFila {
  lote_codigo: string | null;
  lote_codigo_base: string | null;
  productor: string | null;
  producto: string | null;
  calidad: string | null;
  clase: string | null;
  grupo_destino: string | null;
  tamano: string | null;
  piezas: number | null;
  pct_piezas: number | null;
  peso_kg: number | null;
  pct_peso: number | null;
  cartons: number | null;
  pct_cartons: number | null;
  part_id: string;
}

function aTexto(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : String(valor);
}

function aNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convierte la respuesta de la RPC (array de arrays posicionales) en filas.
 * Tolera `null`/formato ajeno devolviendo [] en vez de reventar: un fallo del
 * detalle no debe tumbar toda la página, el consumidor ya avisa si falta.
 * Descarta filas sin `part_id`, que es lo único que no puede ser nulo.
 */
export function mapClasifDetalleCompacto(payload: unknown): ClasifDetalleFila[] {
  if (!Array.isArray(payload)) return [];
  const filas: ClasifDetalleFila[] = [];
  for (const cruda of payload) {
    if (!Array.isArray(cruda)) continue;
    const partId = aTexto(cruda[14]);
    if (!partId) continue;
    filas.push({
      lote_codigo: aTexto(cruda[0]),
      lote_codigo_base: aTexto(cruda[1]),
      productor: aTexto(cruda[2]),
      producto: aTexto(cruda[3]),
      calidad: aTexto(cruda[4]),
      clase: aTexto(cruda[5]),
      grupo_destino: aTexto(cruda[6]),
      tamano: aTexto(cruda[7]),
      piezas: aNumero(cruda[8]),
      pct_piezas: aNumero(cruda[9]),
      peso_kg: aNumero(cruda[10]),
      pct_peso: aNumero(cruda[11]),
      cartons: aNumero(cruda[12]),
      pct_cartons: aNumero(cruda[13]),
      part_id: partId,
    });
  }
  return filas;
}
