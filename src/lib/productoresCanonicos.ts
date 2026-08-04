/**
 * productoresCanonicos — lógica pura para la identidad canónica de
 * productores (catálogo global calidad_productores + alias productores_alias,
 * ver supabase/migrations/20260714090000_productores_canonicos.sql).
 *
 * El productor es texto libre en 3 sitios sin FK común hasta esa migración:
 *   - entradas_bascula.agricultor
 *   - lotes_dia.productor
 *   - calidad_lotes.productor_finca_nombre (ya tenía productor_finca_id)
 *
 * Este módulo no toca Supabase: solo resuelve claves de agrupación y detecta
 * discrepancias a partir de datos ya cargados, para poder testearlo sin red
 * (ver productoresCanonicos.test.ts) y para que useProductores.ts /
 * TrazabilidadLote.tsx no dupliquen la misma regla.
 */
import { normalizarTexto } from "@/lib/format";

/**
 * Normaliza un nombre de productor para comparar/agrupar: minúsculas + sin
 * tildes + trim (mismo criterio que normalizeNombre en
 * src/hooks/useProductores.ts, que es normalizarTexto con trim:true). Se
 * define aquí de forma independiente (en vez de importar normalizeNombre) para
 * que este módulo no dependa de useProductores.ts y evitar un ciclo, ya que
 * useProductores.ts sí importa de aquí.
 */
export function normalizeProductorName(value: string | null | undefined): string {
  return normalizarTexto(value, { trim: true });
}

// ─── El precalibrado: cuenta para el CRUCE de kg, no para el productor (revisado 2026-07-16) ─
// El precalibrado es "una forma que tenemos en la empresa de volver a usar una
// naranja que se aparta" (textual del dueño): fruta que se aparta y se vuelve
// a pasar por el calibrador. Esas segundas pasadas se registran en lotes_dia
// con productor "PRECALIBRADO" (código 65) y códigos de lote tipo
// "PREC DIA 08/11/25" (sin código de 8 dígitos: no casa con ningún lote) o
// compuestos "25110707+25110606" (SÍ traen un código real de lote); sus
// palets ("NAR NAVELINA PREC1", "NAVEL POWEL PRECALIBRADO"…) son almacenaje
// interno, no venta.
//
// REGLA REVISADA (verificado contra la BD real, jul-2026: de TODOS los lotes
// con alguna pasada de procesado, 837 tienen pasadas SOLO de productor real,
// 52 SOLO de productor PRECALIBRADO, y CERO lotes tienen pasadas de AMBOS
// tipos a la vez). Como ningún lote mezcla una pasada real y una de
// precalibrado, contar la pasada PREC que trae un código de lote real NUNCA
// puede duplicar kg con los datos actuales — y para esos 52 lotes esa pasada
// PREC es su ÚNICO registro de procesado: excluirla dejaba el lote como
// "sin procesar" (stock fantasma) cuando en realidad sí se procesó. Por eso:
//   - CRUCE de kg procesado por lote (stock: useEntradasBascula.procesadosQuery;
//     mermas: useMermaLotes / mermaLote.ts): cuentan TODAS las pasadas de
//     lotes_dia con código de lote real (8 dígitos reconocibles), INCLUIDAS
//     las de productor PRECALIBRADO. Ya NO se filtra por esProductorPrecalibrado
//     aquí. Las pasadas sin código reconocible ("PREC DIA 08/11/25") de todos
//     modos no casan con ningún lote, así que no hay nada que excluir para
//     esas.
//   - RANKINGS/dossiers de productores (useProductores, computeProductoresHistorico
//     en useMercadonaLotes.ts): SIGUEN excluyendo el pseudo-productor
//     PRECALIBRADO — no es un productor real, esto no cambia. OJO: el
//     backfill del catálogo pudo crear "PRECALIBRADO" en calidad_productores —
//     NO se borra de BD, solo se excluye de las agregaciones con este predicado.
//   - Sus palets (PREC/PRE1/PRE2) siguen siendo movimiento interno, no venta:
//     se muestran aparte ("palets internos de precalibrado") en Expedición,
//     nunca sumados a kg/clientes de venta — esto tampoco cambia.
//   - En Trazabilidad las pasadas de precalibrado se ven con la etiqueta
//     informativa "precalibrado" (ya no "no cuenta"), y AHORA SÍ suman en
//     kgProcesado, coherente con el cruce de stock/mermas.
// Límite conocido y aceptado: las filas con "PREC" dentro de un código
// compuesto pero productor REAL ("26042411+PREC 26063001+…") siguen contando
// para su lote principal (primera pasada mezclada con la reintroducción) —
// esto ya contaba antes y sigue igual.

/**
 * true si el nombre de productor es el pseudo-productor "PRECALIBRADO"
 * (comparación exacta tras normalizar mayúsculas/tildes/espacios). Un nombre
 * que solo CONTIENE el texto (p. ej. "PRECALIBRADOS S.L.") no casa: la regla
 * es para el pseudo-productor del calibrador, no un patrón difuso.
 */
export function esProductorPrecalibrado(nombre: string | null | undefined): boolean {
  return normalizarTexto(nombre, { trim: true }) === "precalibrado";
}

/**
 * true si el producto de un palet es precalibrado (almacenaje interno, no
 * venta). Valores reales en palets_dia (verificados jul 2026): la familia con
 * C — "NAR NAVELINA PREC1", "NAR LANE LATE PREC2", "NAVEL POWEL PRECALIBRADO",
 * "SALUSTIANA PRECALIBRADO 6/7/8" — y la variante sin C — "NAR LANE LATE
 * PRE1"/"PRE2" — que es la misma cosa (mismo criterio que esPaletMercadona en
 * mercadonaAprovechamiento.ts, que ya trataba PRE1/PRE2/PREC1/PRECALIBRADO
 * como precalibrado). El regex exige límite de palabra y dígito pegado (o la
 * palabra suelta "prec", o el prefijo "precalibrad"): "PRECIOSA" o "PREMIUM"
 * NO casan.
 */
export function esPaletPrecalibrado(producto: string | null | undefined): boolean {
  const texto = normalizarTexto(producto, { trim: true });
  return /\bprec?\d+\b|\bprec\b|\bprecalibrad/.test(texto);
}

// ─── El precalibrado por el lado de las ENTRADAS: circuito cerrado interno ──
// (cierre definitivo de la regla, jul-2026). Además de las pasadas PREC del
// calibrador (arriba) y los palets internos (esPaletPrecalibrado, abajo), la
// báscula registra el propio MOVIMIENTO al almacén de precalibrado como si
// fuera una entrada normal: 278 filas de entradas_bascula (764.846 kg) con
// agricultor tipo "LASARTE ALMACEN PRECALIBRADO..." y finca "PREC 1 ALMACEN"/
// "PREC 2 ALMACEN" (16 combinaciones reales verificadas). Evidencia de que es
// un circuito cerrado, no fruta de campo: las 52 pasadas PREC del calibrador
// con código de lote real casan EXCLUSIVAMENTE con estas 278 entradas
// internas (0 casan con lotes de campo). 226 de las 278 no tienen ninguna
// pasada — si se contaran como entrada normal serían stock fantasma eterno en
// cámara. Regla del dueño (textual): el precalibrado "no cuenta para la
// entrada ni stock".
//
// Por eso `esEntradaPrecalibrado` (usada por useEntradasBascula.ts) EXCLUYE
// estas filas del dataset principal (stock, listas, KPIs, entradasPorDia) y
// de cualquier coste de compra de fruta (useCosteFruta en useEconomico.ts):
// no son una compra ni fruta que entra por primera vez, es la misma fruta que
// ya se contó en su entrada original volviendo a pasar por el almacén. Esto
// NO contradice la regla de esta mañana sobre las pasadas PREC del
// calibrador (arriba): esas pasadas siguen contando en el cruce de kg
// procesado — simplemente, al excluir aquí la ENTRADA interna, ese lote deja
// de generar stock/coste para nadie (no había nadie más que lo reclamara).
//
// Criterio (estricto a propósito, para no cazar fincas/agricultores
// legítimos — ver tests con las 16 variantes reales y contraejemplos como
// finca "El Precioso" o agricultor "PRECISA S.L."):
//   - agricultor: normalizado contiene "almacen" seguido de "precal" (el
//     patrón real "LASARTE ALMACEN PRECAL..."). Exige la palabra "almacen"
//     pegada a "precal", no solo "precal" suelto (evitaría cazar un
//     agricultor real que se llamara "Precales" o similar) ni solo "almacen"
//     suelto (una finca legítima puede llamarse "almacén" a secas).
//   - finca: normalizada casa /\bprec\s*\d\b/ (la palabra "prec" pegada a un
//     dígito, con límite de palabra: "precioso" NO casa porque tras "prec" no
//     viene un espacio+dígito) Y ADEMÁS contiene la palabra "almacen" — las
//     dos condiciones a la vez, para no cazar por casualidad una finca de
//     campo que use "PREC" como abreviatura de otra cosa.
const AGRICULTOR_ALMACEN_PRECAL = /\balmacen\s*precal/;
const FINCA_PREC_DIGITO = /\bprec\s*\d\b/;
const FINCA_ALMACEN = /\balmacen\b/;

export interface EntradaPrecalibradoInput {
  agricultor?: string | null;
  finca?: string | null;
}

/**
 * true si esta entrada de báscula es el MOVIMIENTO INTERNO al almacén de
 * precalibrado (fruta ya entrada que se aparta para volver a pasarla), no
 * una entrada nueva de campo. Ver la nota de evidencia justo arriba.
 */
export function esEntradaPrecalibrado(entrada: EntradaPrecalibradoInput): boolean {
  const agricultor = normalizarTexto(entrada.agricultor, { trim: true });
  if (AGRICULTOR_ALMACEN_PRECAL.test(agricultor)) return true;
  const finca = normalizarTexto(entrada.finca, { trim: true });
  return FINCA_PREC_DIGITO.test(finca) && FINCA_ALMACEN.test(finca);
}

// ─── CAMPO/CIT: fruta comprada que no se procesa en la central (decisión del dueño, 2026-07-16) ─
// Los lotes cuyo artículo de báscula lleva "CAMPO/CIT" son fruta comprada
// que se deriva directamente a Cítrica / venta de campo, sin pasar nunca por
// el calibrador de la central. Evidencia verificada en BD (jul-2026): 13
// lotes / 304.090 kg repartidos en 3 variantes reales de `articulo` —
// "SALUSTIANA CAMPO/CIT" (×10), "NAVELINA CAMPO/CIT" (×2), "LANE LATE
// CAMPO/CIT" (×1) — y CERO pasadas de calibrador (lotes_dia) en toda la
// campaña para esos 13 lotes: coherente con que nunca entran a planta.
//
// Decisión del dueño (textual, 2026-07-16): estos lotes NO cuentan como
// stock (nunca van a procesarse aquí, no tiene sentido que se acumulen para
// siempre como "pendientes en cámara") NI como merma/forfait (no es una
// pérdida: la fruta se vendió por otro canal, no se pudrió ni se descontó en
// el calibrador) — PERO su coste de compra SÍ es real (se pagó al
// agricultor) y debe verse en Económico como una categoría propia, separada
// del resto de compra de fruta que sí se procesa en la central.
//
// Criterio (estricto a propósito, mismo espíritu que el resto de predicados
// de este módulo): el artículo normalizado debe contener "campo" seguido de
// "/cit", tolerando espacios alrededor de la barra ("CAMPO/CIT", "CAMPO /
// CIT", "CAMPO/ CIT"...) y con límite de palabra en ambos lados — "NARANJA
// CAMPO GRANDE" (sin "/cit") o "CITRICA" a secas (sin "campo/" delante) NO
// casan.
const ARTICULO_CAMPO_CIT = /\bcampo\s*\/\s*cit\b/;

export interface EntradaCampoCitInput {
  articulo?: string | null;
}

/**
 * true si el artículo de esta entrada de báscula es "... CAMPO/CIT": fruta
 * comprada que se deriva a Cítrica sin procesarse en la central. Ver la nota
 * de evidencia justo arriba.
 */
export function esEntradaCampoCit(entrada: EntradaCampoCitInput): boolean {
  const articulo = normalizarTexto(entrada.articulo, { trim: true });
  return ARTICULO_CAMPO_CIT.test(articulo);
}

// ─── Movimientos internos de almacén registrados como "agricultor" ──────────
// (2026-08-03, encargo del dueño: "la sección de productores no está enlazada
// correctamente, cada vez hay más productores que no se enlazan y perdemos
// información valiosa; haz que se enlacen siempre correctamente").
//
// Además del precalibrado (arriba), la báscula registra OTRO circuito cerrado
// interno: fruta ya entrada que se aparta en CONFECCIÓN (fábrica) o queda
// como SOBRANTE de un volcado y se re-registra en báscula para poder volver a
// procesarla, con el campo "agricultor" puesto al índice interno del
// movimiento en vez de a un productor real. Evidencia verificada en BD
// (jul-2026): 13 entradas de julio sin productor_id con estos textos reales —
// "Confección.. 7", "Confección.. 3", "Confección.. 4", "Confección.. 1",
// "Confección.. 2", "Confección.. 6", "Sobrante.... 12", "Sobrante.... 5".
// Es el MISMO patrón que el precalibrado: los meses anteriores no salían en
// el diagnóstico como "sin vincular" porque el backfill de
// 20260714090000_productores_canonicos.sql sembró el catálogo con CUALQUIER
// nombre distinto de las 3 fuentes, sin distinguir movimiento interno de
// productor real — así que ya tenían un "productor" fantasma con ese mismo
// texto, colado en rankings/dossiers/coste de fruta.
//
// Mismo tratamiento que esProductorPrecalibrado: no es un productor real,
// fuera de rankings/dossiers/coste de fruta por productor, no debe generar
// una fila en la cola de "nombres sin vincular" (useProductoresCatalogo.ts) y
// tampoco debe disparar la auto-creación de un productor canónico nuevo (ver
// el espejo SQL es_movimiento_interno_productor en la migración
// 20260803100000_productores_autocreacion.sql). Su pasada de calibrador con
// código de lote real (si la tiene) SIGUE contando como procesado igual que
// el precalibrado: el cruce de kg procesado no filtra por nombre de
// productor (ver la nota de "El precalibrado" arriba), así que no hace falta
// tocar nada ahí.
//
// Criterio (tolerante a variaciones de puntuación e índice, estricto en la
// palabra): tras normalizar, el texto ENTERO (ancla ^…$, no una sub-cadena)
// debe ser "confeccion" o "sobrante" + uno o más puntos + el índice numérico
// del movimiento — así un productor real que casualmente mencionara esas
// palabras de pasada no casaría (no se ha visto ningún caso así, pero el
// ancla lo evita por diseño, mismo espíritu que el resto de predicados de
// este módulo).
const AGRICULTOR_MOVIMIENTO_INTERNO = /^(?:confeccion|sobrante)\.+\s*\d+$/;

/**
 * true si `nombre` es el pseudo-productor de un movimiento interno de
 * almacén (confección/sobrante que se re-registra en báscula), no un
 * productor real. Ver la nota de evidencia justo arriba.
 */
export function esAgricultorMovimientoInterno(nombre: string | null | undefined): boolean {
  const texto = normalizarTexto(nombre, { trim: true });
  return AGRICULTOR_MOVIMIENTO_INTERNO.test(texto);
}

// ─── Enlace garantizado: auto-creación de productor canónico nuevo ─────────
// (2026-08-03, mismo encargo del dueño de arriba). El backfill de
// 20260714090000_productores_canonicos.sql solo liga nombres EXACTOS ya
// vistos en ese momento; desde entonces, un agricultor REAL que no tuviera
// alias se quedaba con productor_id NULL para siempre — hasta que un admin
// lo asignaba a mano desde la cola de "nombres sin vincular". Con cosecha
// nueva entran productores nuevos cada semana: la cola crecía sin parar.
//
// La solución vive en el trigger SQL de entradas_bascula (ver migración
// 20260803100000_productores_autocreacion.sql: extiende
// asignar_productor_id_entradas_bascula para que, si el alias no resuelve,
// CREE el productor canónico + su alias de origen automáticamente, marcado
// `creado_automaticamente` para que la cola de revisión lo destaque). Se
// eligió entradas_bascula (no lotes_dia/calidad_lotes) porque es el ORIGEN
// principal de identidad del productor (ver 20260721120000_productores_codigo_erp.sql);
// lotes_dia sigue SIN crear alias por nombre propio (decisión de
// 20260730100000_vinculacion_por_lote.sql): su "productor" suele ser la
// FINCA, que puede pertenecer a varios productores reales (caso "LA
// TORRECILLA"), así que crear un canónico a partir de ese texto seguiría
// siendo arriesgado — su respaldo por evidencia del lote ya hereda el
// productor_id resuelto aquí.
//
// `debeCrearProductorAutomaticamente` es el ESPEJO en JS de la condición que
// evalúa ese trigger (mismo criterio, mantener sincronizados si cambia
// cualquiera de los dos): sirve para poder testear la lógica en frío sin
// tocar Supabase, y por si algún flujo cliente necesita anticipar la
// decisión (p. ej. para no ofrecer "crear alias" en la UI si ya se va a
// auto-crear solo).
export interface AutoAltaProductorInput {
  agricultor: string | null | undefined;
  /** productor_id ya resuelto en la fila (columna productor_id directa), si lo hay. */
  productorIdDirecto?: string | null;
  /** Alias ya aprendidos (productores_alias), normalizado -> productor_id. */
  aliasPorNombreNormalizado: Map<string, string>;
}

/**
 * true si esta fila de entradas_bascula.agricultor debería disparar la
 * auto-creación de un productor canónico nuevo: no hay id ya resuelto (ni
 * directo en la fila ni por alias existente), el nombre normalizado no está
 * vacío, y no es ni el circuito de precalibrado (esEntradaPrecalibrado, solo
 * el lado del agricultor: no se conoce la finca en este punto) ni un
 * movimiento interno de confección/sobrante (esAgricultorMovimientoInterno).
 */
export function debeCrearProductorAutomaticamente(input: AutoAltaProductorInput): boolean {
  if (input.productorIdDirecto) return false;
  const normalizado = normalizeProductorName(input.agricultor);
  if (!normalizado) return false;
  if (input.aliasPorNombreNormalizado.has(normalizado)) return false;
  if (esEntradaPrecalibrado({ agricultor: input.agricultor, finca: null })) return false;
  if (esAgricultorMovimientoInterno(input.agricultor)) return false;
  return true;
}

export interface FilaAutoAltaSimulada {
  agricultor: string | null | undefined;
}

export interface ResultadoAutoAltaSimulada {
  /** id asignado a la fila: el recién creado, el ya existente por alias, o "" si no se resolvió (interno/vacío). */
  productorId: string;
  /** true SOLO en la fila que disparó la creación del productor (la primera vez que se ve ese nombre normalizado). */
  creado: boolean;
}

/**
 * Simula en memoria, fila a fila y en orden, el comportamiento idempotente
 * del trigger de auto-creación (ver la nota de arriba): la primera fila con
 * un nombre normalizado nuevo crea el productor + su alias; cualquier fila
 * posterior con el mismo normalizado (aunque cambien mayúsculas/espacios)
 * resuelve por ese alias sin crear un duplicado. Solo para tests — el
 * comportamiento real vive en el trigger de BD.
 */
export function simularAutoAltaProductores(filas: FilaAutoAltaSimulada[]): ResultadoAutoAltaSimulada[] {
  const aliasPorNombreNormalizado = new Map<string, string>();
  let siguienteId = 1;
  return filas.map(({ agricultor }) => {
    const normalizado = normalizeProductorName(agricultor);
    const existente = normalizado ? aliasPorNombreNormalizado.get(normalizado) : undefined;
    if (existente) return { productorId: existente, creado: false };
    if (!debeCrearProductorAutomaticamente({ agricultor, aliasPorNombreNormalizado })) {
      return { productorId: "", creado: false };
    }
    const id = `auto-${siguienteId++}`;
    if (normalizado) aliasPorNombreNormalizado.set(normalizado, id);
    return { productorId: id, creado: true };
  });
}

export interface ResolucionProductor {
  /**
   * Clave de agrupación estable: "id:<uuid>" si se resolvió un productor_id
   * (directo en la fila o vía alias), o "nombre:<texto crudo>" si no — el
   * mismo criterio (texto crudo, SIN normalizar) que usaba useProductores
   * antes del catálogo, para que la agrupación no cambie ni un poco cuando
   * no hay ningún productor vinculado todavía.
   */
  key: string;
  /** id del productor canónico si se resolvió (directo o por alias), null si no. */
  productorId: string | null;
}

/**
 * Resuelve la clave de agrupación de una fila con nombre de productor en
 * texto libre (entradas_bascula.agricultor / lotes_dia.productor / etc).
 *
 * Prioridad:
 *   1. `productorIdDirecto`: la propia fila ya trae el id resuelto (columna
 *      productor_id/productor_finca_id, poblada por el trigger o el backfill
 *      de la migración, o por una asignación manual desde la cola de
 *      revisión).
 *   2. Alias aprendido: `nombreCrudo` normalizado casa con un
 *      alias_normalizado de productores_alias.
 *   3. Fallback: el texto crudo tal cual, sin normalizar — así, si
 *      `aliasPorNombreNormalizado` está vacío (tabla aún no existe o sin
 *      alias sembrados) y ninguna fila trae productor_id, el resultado es
 *      IDÉNTICO al agrupado por texto crudo de antes del catálogo.
 */
export function resolveProductorGroupKey(
  nombreCrudo: string,
  productorIdDirecto: string | null | undefined,
  aliasPorNombreNormalizado: Map<string, string>,
): ResolucionProductor {
  if (productorIdDirecto) {
    return { key: `id:${productorIdDirecto}`, productorId: productorIdDirecto };
  }
  const normalizado = normalizeProductorName(nombreCrudo);
  const aliasId = normalizado ? aliasPorNombreNormalizado.get(normalizado) : undefined;
  if (aliasId) {
    return { key: `id:${aliasId}`, productorId: aliasId };
  }
  return { key: `nombre:${nombreCrudo}`, productorId: null };
}

export interface ProductorReferencia {
  id: string | null | undefined;
  nombre: string | null | undefined;
}

/**
 * True si dos referencias de productor del mismo lote (p. ej. la entrada de
 * báscula y su procesado en el calibrador) apuntan a productores distintos.
 *
 * Si ambas traen id resuelto, compara por id (fuente de verdad). Si no,
 * compara el texto normalizado (mismo criterio que el resto de cruces
 * calidad↔productor de la app). Si falta cualquiera de los dos nombres no hay
 * información suficiente para avisar: se considera que coincide (sin aviso),
 * para no generar falsos positivos con datos incompletos.
 */
export function productorNoCoincide(a: ProductorReferencia, b: ProductorReferencia): boolean {
  const nombreA = (a.nombre ?? "").trim();
  const nombreB = (b.nombre ?? "").trim();
  if (!nombreA || !nombreB) return false;
  if (a.id && b.id) return a.id !== b.id;
  return normalizeProductorName(nombreA) !== normalizeProductorName(nombreB);
}

/**
 * Detecta si un error de Supabase/PostgREST corresponde a una tabla o columna
 * que todavía no existe (la migración 20260714090000_productores_canonicos.sql
 * no se ha aplicado aún): permite degradar en vez de romper la página.
 * Mismo criterio que TABLE_MISSING_CODES/COLUMN_MISSING_CODES de
 * useMercadonaVentas.ts, centralizado aquí para reutilizarlo en
 * useProductoresCatalogo.ts y useTrazabilidadLote.ts.
 */
export function esErrorTablaOColumnaInexistente(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  const MISSING_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);
  if (record.code && MISSING_CODES.has(record.code)) return true;
  const message = (record.message ?? "").toLowerCase();
  return (
    message.includes("does not exist")
    || message.includes("could not find the table")
    || message.includes("could not find the")
  );
}
