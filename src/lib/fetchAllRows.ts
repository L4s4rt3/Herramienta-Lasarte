/**
 * fetchAllRows — pagina un SELECT de Supabase/PostgREST más allá del
 * "max-rows" del servidor (1.000 filas por defecto).
 *
 * POR QUÉ EXISTE (bug de producción, jul 2026): PostgREST recorta CUALQUIER
 * respuesta al max-rows configurado en el servidor, sea cual sea el
 * `.limit(N)` que pida el cliente — `.limit(20000)` en supabase-js NO puede
 * superar ese tope. El servidor simplemente ignora el exceso y devuelve como
 * mucho max-rows filas, EN SILENCIO (sin error, sin warning: `error` sale
 * `null` y `data` trae justo max-rows elementos). Tras importar el histórico
 * de campaña varias tablas superaron las 1.000 filas (entradas_bascula,
 * lotes_dia, palets_dia, lote_clasificacion...) y el `.limit(N grande)` que ya
 * existía en varios hooks dejó de ser una protección real: recortaba el
 * resultado sin que nadie se enterase (stock mal calculado, paneles con
 * datos incompletos). La ÚNICA forma de traer más de max-rows filas de una
 * tabla es paginar con `.range(from, to)` en un bucle, pidiendo páginas de
 * `pageSize` (<= max-rows) hasta que una página vuelva incompleta (esa es la
 * señal de "ya no hay más filas": no hace falta un COUNT aparte).
 *
 * REGLA DEL PROYECTO: cualquier SELECT que no esté acotado POR DISEÑO (un
 * `.eq` de un id concreto, un `.in` de pocos elementos, `.maybeSingle()`, una
 * paginación propia ya existente, un filtro a un solo día...) y que por tanto
 * PUEDA devolver más de 1.000 filas DEBE usar `fetchAllRows`. Un `.limit(N)`
 * con N > 1000 NO sirve como protección: dice "he pedido 20000" pero el
 * servidor sigue recortando a 1.000 en silencio — da una falsa sensación de
 * seguridad. Antes de añadir un SELECT nuevo sin filtro que lo acote con
 * certeza por debajo de 1.000 filas, usar este helper.
 *
 * REQUISITO DE CORRECCIÓN — orden estable: `buildQuery` DEBE aplicar un
 * `.order(...)` determinista, idealmente por la clave primaria (columna
 * `id`) o incluyéndola como desempate, ANTES de que `fetchAllRows` llame a
 * `.range()`. Sin un orden estable, cada página se pide sobre una foto
 * potencialmente distinta de la tabla: Postgres no garantiza el mismo orden
 * entre dos ejecuciones sucesivas de la misma consulta si no se lo pides
 * explícitamente. Eso puede DUPLICAR una fila que "avanza" de página entre
 * una llamada y la siguiente, o SALTARSE una que "retrocede". Ordenar por una
 * columna no única (p. ej. `created_at`, `fecha`) tiene el mismo riesgo si
 * puede haber empates: añade `id` como columna de desempate para que el
 * orden total sea único.
 */

export interface FetchAllRowsPage<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Error TRANSITORIO de Supabase/PostgREST: merece reintento, no aborto.
 * Caso real (2026-08-03): con lote_clasificacion en 224k filas, una página de
 * fetchAllRows (o un insert del import histórico) pilló a Postgres en pleno
 * checkpoint y murió por "canceling statement due to statement timeout"
 * (código 57014) — el import entero abortó. Un error de datos (constraint,
 * RLS, columna inexistente...) NO es transitorio y debe seguir abortando.
 */
export function esErrorTransitorioSupabase(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "57014") return true; // statement timeout
  return typeof e.message === "string" && /statement timeout|failed to fetch|fetch failed|network/i.test(e.message);
}

const REINTENTOS_PAGINA = 3;
const ESPERA_REINTENTO_MS = 1500;

/**
 * @param buildQuery Construye la consulta para la página [from, to] (ambos
 *   inclusive, como espera `.range()` de supabase-js). Debe incluir un
 *   `.order()` estable — ver cabecera.
 * @param pageSize Tamaño de página. No debe superar el max-rows del servidor
 *   (1.000 por defecto en PostgREST/Supabase); el valor por defecto de este
 *   helper ya respeta ese límite.
 * @returns Todas las filas de todas las páginas, concatenadas.
 * @throws El primer error que devuelva `buildQuery`, tal cual lo entregó el
 *   cliente de Supabase (sin envolver): el llamador decide si lo pasa por
 *   `toError` u otro tratamiento.
 */
export async function fetchAllRows<T>(
  // El resultado de la página se acepta con filas `unknown`: el llamador fija
  // T (la forma que ESPERA de su select) y el cliente tipado de supabase-js
  // infiere la suya del string del select; casarlas fila a fila obligaría a
  // repetir el tipo dos veces. Desde el 02-09-2026 los hooks usan el cliente
  // tipado (antes un `SupabaseClient<any>` lo tapaba todo), y aquí es donde
  // se encuentra esa costura.
  buildQuery: (from: number, to: number) => PromiseLike<FetchAllRowsPage<unknown>>,
  pageSize = 1000,
): Promise<T[]> {
  if (pageSize <= 0) throw new Error("fetchAllRows: pageSize debe ser > 0");

  const allRows: T[] = [];
  let from = 0;

  for (;;) {
    const to = from + pageSize - 1;
    let { data, error } = await buildQuery(from, to);
    // Reintento solo de errores transitorios (timeout 57014 / red): una página
    // que muere con la BD ocupada no debe tirar la lectura entera. Cualquier
    // otro error se lanza a la primera, como siempre.
    for (let intento = 1; error && esErrorTransitorioSupabase(error) && intento < REINTENTOS_PAGINA; intento++) {
      await new Promise((r) => setTimeout(r, ESPERA_REINTENTO_MS * intento));
      ({ data, error } = await buildQuery(from, to));
    }
    if (error) throw error;

    const page = (data ?? []) as T[];
    allRows.push(...page);

    // Página incompleta (o vacía) = no hay más filas. No hace falta un COUNT
    // aparte: si la página trae menos de pageSize, era la última.
    if (page.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

// ─── Escritura con reintentos (insert/update/upsert) ────────────────────────
// Mismo motivo que la paginación de arriba: un statement timeout de la BD en
// pleno checkpoint no debe abortar una escritura entera. Vivía solo en
// useHistoricoImport.ts (caso real 2026-08-03: 3 informes de lote insertados
// y la mutación entera abortada por "canceling statement due to statement
// timeout"); se mueve aquí (junto a esErrorTransitorioSupabase, que ya vivía
// en este archivo) para que otros consumidores con el mismo riesgo —el cierre
// automático de lotes completos en useEntradasBascula.ts, refuerzo
// 2026-08-03: hasta 819 UPDATE de golpe en tandas— no dupliquen la lógica.
// useHistoricoImport.ts reexporta/importa desde aquí sin cambiar su
// comportamiento.

const REINTENTOS_ESCRITURA = 3;
const ESPERA_REINTENTO_ESCRITURA_MS = 2000;

/**
 * Ejecuta una escritura supabase (insert/update/upsert) reintentándola ante
 * errores TRANSITORIOS (ver esErrorTransitorioSupabase más arriba). Devuelve
 * el ÚLTIMO resultado (con su error si agotó reintentos): el caller conserva
 * su manejo de error de siempre. PostgREST no es transaccional entre chunks,
 * pero cada escritura individual sí es atómica, así que reintentar un chunk
 * fallido no duplica filas.
 */
export async function escribirConReintentos<R extends { error: { code?: string; message?: string } | null }>(
  hacer: () => PromiseLike<R>,
): Promise<R> {
  let resultado = await hacer();
  for (let intento = 1; resultado.error && esErrorTransitorioSupabase(resultado.error) && intento < REINTENTOS_ESCRITURA; intento++) {
    await new Promise((r) => setTimeout(r, ESPERA_REINTENTO_ESCRITURA_MS * intento));
    resultado = await hacer();
  }
  return resultado;
}
