/**
 * mermaLote.ts — merma natural, podrido (real/estimado) y coste real por
 * LOTE (PURO, sin acceso a red). Complementa a entradasBascula.ts (stock en
 * cámara) con lo que pasa DESPUÉS de que un lote entra por báscula.
 *
 * ─── Los tres números, y por qué NO se solapan ──────────────────────────────
 *
 * 1. MERMA NATURAL (medida): kg que entraron por báscula pero nunca llegaron
 *    a pesar en el calibrador. Es la diferencia báscula − calibrador − ajuste
 *    de stock, y CONTIENE dos componentes (modelo del dueño, 21-jul-2026):
 *      a) la merma de cámara (deshidratación; real si hay registro, estimada
 *         por tasa × días si no), y
 *      b) el PODRIDO PRE-CALIBRADOR: fruta retirada ANTES de entrar a la
 *         máquina. El dueño lo saca por DOS sitios y pesa los dos
 *         (confirmado 06-ago-2026):
 *           · la bolsa/contenedor de la tría → kg_podrido_bolsa_basura,
 *             que se apunta a diario, y
 *           · las BATEAS de la tría → kg_podrido_bateas, que se llenan
 *             durante varios días y se pesan al vaciarlas.
 *         Los dos son MEDICIONES de (b), no pérdidas aparte: ninguno se suma
 *         nunca encima de la merma medida (estaría dentro dos veces). Por eso
 *         `podridoPreCalibradorKg` (el trozo de la merma que no explica la
 *         deshidratación) se ASUME por resta y estas dos pesadas sirven solo
 *         para contrastarlo.
 * 2. PODRIDO DE CALIBRADOR: kg que SÍ pasaron por el calibrador — incluidos
 *    en `kgCalibrador` — y que la máquina descartó.
 *
 * Pérdida total = merma medida (cámara + podrido pre-calibrador) + podrido de
 * calibrador: cada kg cuenta exactamente una vez.
 *
 * Fuera de este módulo hay UNA excepción deliberada: el DSJ del día
 * (src/lib/cascade.ts) sí descuenta el podrido de la bolsa de su balance,
 * como aproximación a esta pérdida mientras no se pueda medir por lote. Está
 * razonado en la cabecera de cascade.ts; no es un criterio que deba copiarse
 * aquí.
 *
 * ─── Solo procesados tienen merma ───────────────────────────────────────────
 * Un lote "parcial" o "pendiente" (ver estadoLotePorProcesado en
 * entradasBascula.ts) no tiene mermaNaturalKg calculable: todavía puede
 * seguir vaciándose desde cámara, así que restar ahora mezclaría cámara
 * (fruta que AÚN no ha pasado) con merma real. mermaNaturalKg es `null` en
 * ese caso ("pendiente" en la UI), nunca 0.
 *
 * ─── El precalibrado SÍ cuenta para kgCalibrador (revisado 2026-07-16) ──────
 * El precalibrado es fruta apartada que se vuelve a pasar por el calibrador.
 * Sus filas de lotes_dia llegan con productor "PRECALIBRADO" y a veces con
 * códigos compuestos ("25110707+25110606") que normalizan (primer grupo de
 * 8 dígitos) al código de un lote real.
 *
 * Verificado contra la BD real (jul-2026): de todos los lotes con alguna
 * pasada de procesado, 837 tienen pasadas SOLO de productor real, 52 SOLO de
 * productor PRECALIBRADO, y CERO lotes tienen pasadas de ambos tipos a la
 * vez. Como ningún lote mezcla una pasada real y una de precalibrado, sumar
 * la pasada PREC que trae un código de lote real a kgCalibrador NUNCA puede
 * duplicar kg con los datos actuales — y para esos 52 lotes esa pasada PREC
 * es su ÚNICO registro de procesado: excluirla (como se hacía hasta la
 * revisión anterior) los dejaba "sin procesar" (stock fantasma, p. ej. lote
 * 25103101) cuando en realidad sí se procesaron.
 *
 * Por eso computeMermaLotes cuenta TODAS las filas de lotesDia con código de
 * lote reconocible, sea el productor el que sea: useMermaLotes YA NO filtra
 * por esProductorPrecalibrado antes de llamar aquí (ver el hook). Las filas
 * de precalibrado SIN código de 8 dígitos ("PREC DIA 08/11/25") de todos
 * modos no casan con ningún lote (normalizarLoteCodigo devuelve null), así
 * que no hay nada que excluir para esas.
 *
 * Límite conocido y aceptado: las filas con "PREC" dentro de un código
 * compuesto pero productor REAL ("26042411+PREC 26063001+…") siguen contando
 * para su lote principal (primera pasada mezclada con la reintroducción) —
 * esto ya contaba antes y sigue igual.
 *
 * ─── Fuente del podrido de calibrador: real vs prorrateo ────────────────────
 * Cuando el lote tiene "Informe LOTE" (filas en lote_clasificacion — se
 * detecta por la simple PRESENCIA de cualquier fila para ese lote, sea cual
 * sea su clase) se usa la suma REAL de la(s) clase(s) que contengan
 * "Podrido" (puede ser 0 si el informe no tiene ninguna fila de esa clase:
 * sigue siendo un 0 REAL, no una ausencia de dato). El resto se ESTIMA por
 * prorrateo: kg_podrido_calibrador_auto del parte × (kg del lote en ese parte
 * / Σ kg de TODOS los lotes de ese parte). El podrido MANUAL (bolsa de
 * basura) no se registra nunca por lote en origen, así que SIEMPRE es
 * prorrateo, exista o no Informe LOTE.
 *
 * COBERTURA (no la fijes por escrito, crece con cada import): eran ~28 de 398
 * lotes en jul-2026 y son 937 de 1.321 (71 %) a 06-ago-2026. La UI la enseña
 * calculada en vivo (pestaña "Mermas y coste" de EntradasBascula.tsx), que es
 * la única cifra en la que hay que fiarse.
 *
 * Limitación conocida y asumida (no se intenta corregir con lógica extra no
 * pedida): si en un mismo parte conviven un lote con Informe LOTE real y
 * otros sin él, el prorrateo de los segundos sigue usando el
 * kg_podrido_calibrador_auto ENTERO del parte como numerador (no se resta la
 * porción ya explicada por el informe real de otro lote). Medido en la BD el
 * 06-ago-2026, tras subir la cobertura al 71 %: de los 79 partes con dato de
 * podrido solo 13 son MIXTOS, el 92,8 % de las pasadas ya tiene informe y
 * apenas 1.198 kg de 38.787 (3,1 %) se reparten por este camino — el sesgo
 * sigue siendo marginal, ahora por el motivo contrario (casi todo es real).
 * Por eso se documenta en vez de enmascararlo. La propiedad de conservación
 * (ver test) solo se cumple cuando NINGÚN lote del parte tiene informe real.
 *
 * ─── Coste y pérdidas en € ───────────────────────────────────────────────────
 * costeTotalLote reutiliza `importeEntradaFruta` de economico.ts (no se
 * reimplementa la regla importe_total vs suma de componentes). Si no hay
 * coste (costeTotalLote <= 0), `sinCoste=true` y todos los €/kg y pérdidas
 * son `null` (no 0: "no lo sabemos" es distinto de "no hay pérdida").
 *
 * mermaNaturalKg puede salir NEGATIVO (el calibrador pesó más que la
 * báscula: error de pesaje, no una merma negativa real). Se expone el dato
 * tal cual con el flag `calibradorSuperaEntrada` para que se revise, pero
 * para el cálculo en € se usa max(0, merma) — una "merma negativa" no puede
 * generar una pérdida negativa (un beneficio) en el informe de costes.
 *
 * ─── Desglose de la merma medida: natural esperada vs podrido pre-calibrador ─
 * El dueño lleva a mano un Excel de mermas de cámara (peso inicial/final,
 * días de almacén, % merma) para separar, dentro de mermaNaturalKg, cuánto es
 * deshidratación esperada por el tiempo en cámara y cuánto es el resto.
 * TASA_MERMA_NATURAL_DIA (0,0513%/día) sale de ese registro (60 camiones,
 * 53–80 días). Por lote:
 *   - `diasEnCamara`: fecha de entrada → ÚLTIMA fecha de procesado del lote
 *     (de lotes_dia vía partes_diarios.date). `null` si falta cualquier
 *     fecha (no se inventa un valor).
 *   - `mermaNaturalEstimadaKg = min(max(0, mermaNaturalKg), kgEntrada × TASA ×
 *     diasEnCamara)`: el `min` es la garantía de que la estimación NUNCA
 *     supera la merma realmente medida (una fruta no puede "perder" más de
 *     lo que se pesó de menos).
 *   - `podridoPreCalibradorKg = max(0, mermaNaturalKg) − mermaNaturalEstimadaKg`:
 *     el resto.
 *
 *     Decisión del dueño (2026-07-15): antes de llegar al calibrador también
 *     se quita podrido en un contenedor que NO se pesa a diario. Lo que hasta
 *     entonces se llamaba "diferencia sin justificar" (una anomalía a
 *     revisar) se ASUME ahora como podrido de ese contenedor pre-calibrador:
 *     no es un error de pesaje ni una merma extra, es podrido real que nunca
 *     llegó a pasar por el calibrador y por tanto nunca se pudo medir por
 *     lote. Es una ASUNCIÓN del dueño (por eso se etiqueta "asumido" en la
 *     UI, un tono distinto de "real" y de "≈ estimado"), no una medición
 *     directa; se sigue calculando exactamente igual (mismo TASA, mismo
 *     `min`/resta) — solo cambia el nombre y qué significa el número.
 * Ambos son `null` si el lote no está procesado, si mermaNaturalKg es
 * negativo (calibradorSuperaEntrada) o si diasEnCamara es null: el desglose
 * "no calculable" nunca se disfraza de 0. Cuando sí se calculan, la suma de
 * los dos es EXACTA (sin redondeos) igual a max(0, mermaNaturalKg).
 *
 * ─── La resta se queda CIEGA a final de campaña (10-ago-2026) ───────────────
 * Medido sobre los 909 lotes de la campaña 2025/26: `podridoPreCalibradorKg`
 * colapsa a 0 en cuanto la conciliación atribuye al lote casi toda su entrada
 * (no queda hueco que restar). Lotes con residuo colapsado: 0 de octubre a
 * mayo, 19 en junio (18,8 % de los kg), 41 en julio (48,8 %) y 8 en agosto
 * (87,8 %). En la ventana 25-jul → 3-ago la resta ASUME 2.546 kg donde se
 * PESARON 24.086 (bolsa + bateas): 9,5 veces menos. Consecuencia práctica: los
 * productores cuya fruta pasa por línea al final de campaña salen
 * artificialmente bien en cualquier ranking de pérdida.
 *
 * La respuesta NO es sumar las pesadas (estarían dos veces: ya están dentro de
 * la merma medida) ni repartirlas por lote (imposible: la batea se llena varios
 * días y el dueño confirmó el 10-ago-2026 que "no hay forma de saber de qué
 * lote hay x kg ni de qué día hay x kg"). Se añade una REFERENCIA paralela por
 * mes de proceso — `TASA_PODRIDO_PRE_CALIBRADOR_MES` →
 * `podridoPreCalibradorEsperadoKg` / `podridoPreCalibradorNoVistoKg` /
 * `podridoPreCalibradorSinMargen` — que NO entra en ninguna pérdida, ningún € ni
 * ningún total existente: la invariante de conservación de arriba y todas las
 * fórmulas siguen intactas, y los agregados de Económico/forfait/Dashboard no
 * cambian ni un kg. Sirve para SEÑALAR el hueco, que es lo que no se podía
 * hacer antes. Sustituir la resta por la tasa sería otra decisión (cambiaría
 * todos los € aguas abajo) y no se ha tomado.
 *
 * ─── La foto de stock NEGATIVA no se resta (revisado 28-ago-2026) ───────────
 * `kg_ajuste_stock` es la "foto de stock": kg contados fuera de los partes al
 * conciliar con el informe de la báscula (ver eventosLote.ts). Doce lotes de la
 * campaña 2025/26 la traen NEGATIVA, y nueve de ellos con una firma
 * inconfundible: el ajuste es exactamente −(kg de su primera pasada), esa
 * pasada es de código SIMPLE, el calibrador les atribuyó entre el 100 % y el
 * 163 % de su entrada, y los doce se crearon el mismo día (13-jul-2026) por el
 * mismo import.
 *
 * Es decir: ese negativo es la forma ANTIGUA de cancelar una sobre-atribución
 * del calibrador. Pero `conciliarKgProcesados` (conciliacionKg.ts) ya corrige
 * eso por su cuenta — capa cada lote a su capacidad y derrama el exceso a sus
 * hermanos — y de hecho IGNORA el negativo (`kg_preasignado: Math.max(0, …)`).
 * Aplicar los dos arreglos a la vez descontaba el mismo exceso DOS VECES: como
 * la merma es entrada − procesado − ajuste, un ajuste negativo la SUMA, y
 * salían mermas imposibles (26042712: 34.778 kg sobre 20.580 kg de entrada,
 * el 169 %).
 *
 * Desde el 28-ago-2026 se aplica aquí el MISMO criterio que la conciliación:
 * `kgAjuste = max(0, kg_ajuste_stock)`. Con eso los doce lotes pasan a dar
 * mermas del 0 % al 6,6 %, dentro de la banda normal de la campaña. El valor
 * CRUDO se sigue exponiendo en `kgAjusteBruto` (con signo) para que nadie
 * pierda de vista que la báscula contó de menos: la contradicción
 * "pasada vs foto de stock" de cicloVidaLote.ts NO depende de este módulo y
 * sigue marcando esos lotes para comprobación física.
 *
 * ─── Cierre manual de lote (entradas_bascula.cerrado_at) ────────────────────
 * Hay lotes que se quedan a ~94% para siempre (el hueco es justo ese podrido
 * pre-calibrador no pesado + la merma natural) y sin cierre manual quedarían
 * "parcial" eternamente sin que su merma se pudiera nunca calcular. Cuando el
 * dueño marca `cerrado_at` (migración 20260715090000, columna opcional: ver
 * `EntradaLoteInput.cerrado_at`), el lote se trata como "procesado" aunque no
 * llegue al umbral normal (ver `estadoLotePorProcesado` en
 * entradasBascula.ts) y su desglose (natural estimada / podrido
 * pre-calibrador) se calcula exactamente igual que cualquier otro lote
 * procesado. El flag `cerradoManualmente` en el resultado es solo informativo
 * (para que la UI lo indique), no cambia ninguna fórmula.
 *
 * ─── Modo del cierre: con_analisis vs sin_registro (2026-07-16) ────────────
 * `cerrado_at` por sí solo no dice SI el hueco es pérdida real. Evidencia
 * verificada en BD: de 174 lotes activos antiguos, 53 tienen procesado
 * PARCIAL bajo su código (el hueco restante SÍ es plausible como pérdida) —
 * pero 121 (2,48 M kg) no tienen NINGÚN registro de procesado bajo su código
 * (pasaron bajo códigos compuestos que acreditan a OTRO lote, o se vendieron
 * sin procesar en la central). Cerrar esos 121 con el modo "pérdida real"
 * metería 2,5 M kg de merma/podrido FICTICIA en Económico.
 *
 * `entradas_bascula.cierre_modo` (migración
 * 20260716120000_entradas_bascula_cierre_modo.sql, ver `EntradaLoteInput.cierre_modo`)
 * distingue los dos casos:
 *   - `"con_analisis"` (o `null` con `cerrado_at` relleno, compat con cierres
 *     anteriores a esta columna): comportamiento ORIGINAL sin cambios — el
 *     hueco se reclasifica como merma natural + podrido pre-calibrador.
 *   - `"sin_registro"`: el lote sale del stock igual (no se va a procesar más
 *     bajo este código, `estadoLotePorProcesado` no cambia — ver
 *     entradasBascula.ts) pero se EXCLUYE por completo del análisis de
 *     mermas/podrido/pérdida de ESTE módulo y del forfait (forfait.ts):
 *     `cerradoSinRegistro=true` y TODOS los campos derivados de merma/podrido
 *     /pérdida salen `null` (nunca 0 — "no se puede sostener con datos" es
 *     distinto de "no hay pérdida"). `kgEntrada`/`kgCalibrador`/coste siguen
 *     calculándose (informativos, para que la ficha del lote pueda explicar
 *     qué pasó), pero ningún agregado (`agregarMermaLotes`, `forfait.ts`) los
 *     cuenta — se exponen aparte en `nLotesCerradosSinRegistro`/
 *     `kgCerradosSinRegistro` para poder informar sin mezclarlos.
 */

import { normalizarLoteCodigo } from "./loteCodigo.ts";
import { diffDias, estadoLotePorProcesado, type CierreModo, type StockEstado } from "./entradasBascula.ts";
import { importeEntradaFruta } from "./economico.ts";

/**
 * "desconocido" (import histórico de campaña, jul 2026): un parte SIN dato de
 * podrido (ambas columnas de ParteMermaInput a `null`, ver más abajo) no
 * puede prorratear nada — ni siquiera un 0, que sería un dato real
 * falseado. Solo aplica al podrido de CALIBRADOR cuando el lote no tiene
 * Informe LOTE real (si lo tiene, "real" manda siempre, esté el parte
 * desconocido o no: ver `podridoCalibradorFuente` más abajo). El podrido
 * MANUAL no tiene fuente "real" nunca, así que para él "desconocido" es
 * simplemente que `podridoManualKg` salga `null` (ver `MermaLote`).
 */
export type FuentePodrido = "real" | "prorrateo" | "desconocido";

/**
 * Tasa de merma natural esperada por kg·día en cámara (fracción, no %).
 * Derivada del registro manual del dueño "Merma fruta camaras" (recalibrada
 * 27-jul-2026 con 60 camiones re-pesados, 53–80 días de cámara): media
 * ponderada por kg·día 0,0513%/día. OJO, la tasa NO es estable en el tiempo:
 * los camiones salidos hasta el 17-jul daban 0,0466%/día y los del 20–24-jul
 * 0,0592%/día (la fruta se degrada más rápido a final de campaña) — esta
 * constante es el agregado y puede quedarse corta para estancias largas de
 * verano. Histórico de recalibraciones: 18 camiones → 0,0553%; 39 → 0,0466%;
 * 60 → 0,0513%. Si se recalibra con más datos, actualizar aquí.
 */
export const TASA_MERMA_NATURAL_DIA = 0.000513;

/**
 * Umbral por debajo del cual se considera que la RESTA del podrido
 * pre-calibrador ha colapsado ("lote SIN MARGEN"): `podridoPreCalibradorKg` menor
 * que este % de la entrada. No es un 0 físico, es la resta sin hueco.
 */
export const UMBRAL_SIN_MARGEN_PODRIDO = 0.001;

/**
 * Tasa de PODRIDO PRE-CALIBRADOR esperada por MES DE PROCESO, como fracción de
 * los kg que pasaron por el calibrador (no de la entrada: la medición con la
 * que se calibró está tomada sobre kg procesados).
 *
 * ─── Por qué hace falta una tasa y no basta la resta ────────────────────────
 * `podridoPreCalibradorKg` se deduce por resta (merma medida − deshidratación
 * esperada). Medido el 10-ago-2026 sobre los 909 lotes de la campaña 2025/26,
 * esa resta se queda SIN HUECO a partir de junio: en cuanto la conciliación
 * atribuye al lote casi toda su entrada, la merma medida es mínima, la
 * deshidratación se la come entera y el residuo sale 0 aunque la fruta podrida
 * exista y se esté pesando. Lotes con residuo colapsado por mes: 0 de octubre
 * a mayo, 19 en junio (18,8 % de los kg), 41 en julio (48,8 %) y 8 en agosto
 * (87,8 %). Esta tasa es la referencia con la que contrastar ese residuo.
 *
 * ─── Procedencia de cada mes (NO son todos iguales de fiables) ──────────────
 *   - oct-may: el propio residuo del módulo en los meses SIN ningún lote
 *     sin margen, así que ahí la resta sí mide. Medido 10-ago-2026 (% sobre kg
 *     procesados): oct 3,02 · nov 2,65 · dic 2,50 · ene 2,68 · feb 2,78 ·
 *     mar 2,56 · abr 2,11 · may 2,33.
 *   - jul-ago: MEDICIÓN DIRECTA, la única que existe. Del 22-jul al 3-ago-2026
 *     se pesaron 30.700 kg de bateas (5 vaciados) + 6.580 kg de bolsa = 37.280
 *     kg sobre 787.530 kg procesados = 4,73 %.
 *   - jun: INTERPOLADO entre mayo (2,33 %) y julio (4,73 %). No hay medición.
 *   - sep: sin dato (la campaña arranca en octubre); se toma la de octubre, el
 *     mes contiguo con fruta igual de temprana.
 * La tendencia creciente es coherente con la de la merma de cámara, que sube
 * de 0,0466 %/día hasta el 17-jul a 0,0592 %/día del 20 al 24-jul: a final de
 * campaña la fruta se degrada más y se tría más.
 *
 * OJO: la batea se llena durante VARIOS días y no se puede repartir ni por
 * lote ni por día (confirmado por el dueño el 10-ago-2026: "se ha pesado
 * siempre, solo se apuntaba a veces, y no hay forma de saber de qué lote hay x
 * kg ni de qué día hay x kg"). Por eso esta tasa NO sustituye a la resta ni se
 * suma a ningún total: alimenta campos PARALELOS (`podridoPreCalibradorEsperadoKg`
 * y `podridoPreCalibradorNoVistoKg`) para poder señalar dónde el residuo se
 * queda corto. Si se recalibra con más pesadas, actualizar aquí.
 */
export const TASA_PODRIDO_PRE_CALIBRADOR_MES: Readonly<Record<string, number>> = {
  "01": 0.0268,
  "02": 0.0278,
  "03": 0.0256,
  "04": 0.0211,
  "05": 0.0233,
  "06": 0.0350, // interpolado may-jul
  "07": 0.0473, // medido 22/07-03/08
  "08": 0.0473, // medido 22/07-03/08
  "09": 0.0302, // sin dato: se toma octubre
  "10": 0.0302,
  "11": 0.0265,
  "12": 0.0250,
};

/** Tasa usada cuando no se conoce el mes de proceso: el nivel estable de octubre a marzo. */
export const TASA_PODRIDO_PRE_CALIBRADOR_DEFECTO = 0.027;

/**
 * Tasa esperada de podrido pre-calibrador para la fecha en que el lote pasó
 * por línea (ver TASA_PODRIDO_PRE_CALIBRADOR_MES). Con fecha desconocida o no
 * parseable devuelve `TASA_PODRIDO_PRE_CALIBRADOR_DEFECTO` — nunca 0, que
 * afirmaría que no hubo tría.
 */
export function tasaPodridoPreCalibradorMes(fechaProceso: string | null | undefined): number {
  const mes = /^\d{4}-(\d{2})-\d{2}/.exec(String(fechaProceso ?? ""))?.[1];
  return (mes ? TASA_PODRIDO_PRE_CALIBRADOR_MES[mes] : undefined) ?? TASA_PODRIDO_PRE_CALIBRADOR_DEFECTO;
}

// ─── Entradas (datos crudos, tal como salen de Supabase) ────────────────────

export interface EntradaLoteInput {
  lote: string;
  fecha: string;
  kg_entrada: number;
  kg_ajuste_stock: number | null;
  importe_compra: number | null;
  coste_recoleccion: number | null;
  importe_transporte: number | null;
  importe_comision: number | null;
  importe_total: number | null;
  /**
   * Cierre manual del lote (entradas_bascula.cerrado_at, migración
   * 20260715090000_entradas_bascula_cierre_manual.sql, columna opcional que
   * puede no existir aún en BD): no-null trata el lote como "procesado"
   * (ver estadoLotePorProcesado) aunque no llegue al umbral normal —
   * el hueco báscula−calibrador−ajuste se reclasifica como merma natural +
   * podrido pre-calibrador igual que cualquier lote procesado. Opcional para
   * no romper llamadas existentes; `undefined`/`null` = comportamiento normal.
   */
  cerrado_at?: string | null;
  /**
   * entradas_bascula.cierre_modo (migración
   * 20260716120000_entradas_bascula_cierre_modo.sql, columna opcional que
   * puede no existir aún en BD). Solo tiene efecto si `cerrado_at` está
   * relleno (ver cabecera del archivo): `"sin_registro"` excluye el lote de
   * TODO el análisis de merma/podrido/pérdida; `"con_analisis"` o `null`
   * (compat con cierres anteriores a esta columna) mantiene el comportamiento
   * original. Opcional para no romper llamadas existentes.
   */
  cierre_modo?: CierreModo | null;
  /** Merma REAL de cámara (entradas_bascula.merma_camara_kg, del registro manual de las cámaras): cuando existe, el componente "natural" del desglose es este dato medido en vez de tasa × días. Opcional para no romper llamadas existentes. */
  merma_camara_kg?: number | null;
}

/** Fila de lotes_dia con lo mínimo necesario: código de lote (sin normalizar), kg y el parte al que pertenece. */
export interface LoteDiaKgInput {
  lote_codigo: string | null;
  kg_peso_total: number | null;
  part_id: string;
}

/** Fila de lote_clasificacion: la presencia de CUALQUIER fila para un lote indica que tiene Informe LOTE. */
export interface ClasificacionLoteInput {
  lote_codigo: string | null;
  clase: string | null;
  peso_kg: number | null;
}

/**
 * Fila de la vista agregada `lote_clasificacion_podrido_agg` (migración
 * 20260717120000_vistas_agregadas_clasificacion.sql): un lote8 por fila, con
 * el podrido ya sumado en el servidor. Sustituye la descarga íntegra de
 * lote_clasificacion (300k+ filas tras el import masivo de informes de lote,
 * jul-2026) por, como mucho, unas pocas miles de filas — una por lote.
 */
export interface PodridoAggRow {
  lote8: string | null;
  kg_podrido: number | null;
  n_filas: number | null;
}

/**
 * Adapta las filas de `lote_clasificacion_podrido_agg` a `ClasificacionLoteInput[]`
 * SIN cambiar el resultado de `computeMermaLotes`: éste solo necesita, por
 * lote, (a) que exista AL MENOS una fila (informeLotes: presencia) y (b) la
 * suma de kg de la(s) clase(s) "Podrido" (podridoRealPorLote). Basta con UNA
 * fila sintética por lote8, con clase "Podrido" y peso_kg = kg_podrido (0 si
 * el informe no tenía ninguna fila de esa clase, que sigue siendo un 0 real,
 * no una ausencia de informe), para reproducir exactamente esos dos usos —
 * no hace falta reconstruir las filas originales fila a fila.
 */
export function mapPodridoAggToClasificacionInput(rows: PodridoAggRow[]): ClasificacionLoteInput[] {
  return rows
    .filter((r) => r.lote8 && (r.n_filas ?? 0) > 0)
    .map((r) => ({
      lote_codigo: r.lote8,
      clase: "Podrido",
      peso_kg: Number(r.kg_podrido) || 0,
    }));
}

/**
 * Parte con los dos contadores de podrido que existen por DÍA/PARTE (nunca
 * por lote). `null` en cualquiera de los dos SOLO significa "no hay dato de
 * ese parte" (p. ej. un día importado del histórico de campaña, jul 2026,
 * que no trae podrido del calibrador): NO se confunde con un 0 real. Cuando
 * AMBAS columnas son `null` para un parte, sus lotes prorratean `null`
 * ("desconocido", ver `FuentePodrido`) en vez de 0.
 */
export interface ParteMermaInput {
  part_id: string;
  kg_podrido_calibrador_auto: number | null;
  kg_podrido_bolsa_basura: number | null;
  /** Fecha del parte (partes_diarios.date), para diasEnCamara (última fecha de procesado del lote). Opcional: si falta, diasEnCamara queda null para los lotes cuyo procesado pase por este parte. */
  date?: string | null;
}
// NOTA sobre partes_diarios.kg_podrido_bateas (corrección del dueño,
// 2026-07-29): la batea NO es de un solo día — se va llenando VARIOS días y
// se pesa al vaciarla, así que su kg pertenece a todos los lotes desde el
// vaciado anterior y NO se puede prorratear por día/lote (la primera versión
// lo prorrateaba como el podrido manual y se retiró aquí mismo). La única
// estimación por lote del podrido pre-calibrador sigue siendo la de siempre:
// entrada − merma natural − procesado (podridoPreCalibradorKg). La pesada de
// bateas queda como dato del PARTE del día del vaciado: contraste agregado.

// ─── Resultado por lote ──────────────────────────────────────────────────────

export interface MermaLote {
  lote: string;
  estado: StockEstado;
  /** Fecha de entrada por báscula (entradas_bascula.fecha): permite a las páginas filtrar/agrupar el conjunto por periodo. */
  fecha: string;
  /** true si el lote tiene entradas_bascula.cerrado_at relleno (cierre manual del dueño): informativo, no cambia ninguna fórmula, solo para que la UI lo indique (badge "Cerrado a mano"). */
  cerradoManualmente: boolean;
  /**
   * true si `cerradoManualmente` Y `cierre_modo === "sin_registro"` (ver
   * cabecera del archivo): el procesado de este lote no consta bajo su
   * código, así que TODOS los campos de merma/podrido/pérdida de abajo son
   * `null` (no se calculan, no un 0) y ningún agregado (`agregarMermaLotes`,
   * `forfait.ts`) lo cuenta. `kgEntrada`/`kgCalibrador`/coste siguen siendo
   * los valores reales (informativos), no se anulan.
   */
  cerradoSinRegistro: boolean;

  kgEntrada: number;
  /** Foto de stock EFECTIVA: `max(0, kg_ajuste_stock)` — un negativo no resta (ver cabecera del archivo). Es la que entra en todas las fórmulas de abajo. */
  kgAjuste: number;
  /** Foto de stock CRUDA, con signo, tal como está en entradas_bascula. Negativa = la báscula contó menos de lo que muestran los partes; se expone para no esconder el dato aunque no se reste. */
  kgAjusteBruto: number;
  /** Σ kg_peso_total de los lotes_dia de este lote (cruce exacto por normalizarLoteCodigo). */
  kgCalibrador: number;

  /** kgEntrada − kgCalibrador − kgAjuste, CON SIGNO. `null` si el lote no está "procesado" (pendiente/parcial). */
  mermaNaturalKg: number | null;
  /** true si mermaNaturalKg < 0 (el calibrador pesó más que la báscula): dato a revisar, no se oculta. */
  calibradorSuperaEntrada: boolean;
  /** mermaNaturalKg / kgEntrada × 100, CON SIGNO (igual criterio que mermaNaturalKg). `null` si mermaNaturalKg es null o kgEntrada <= 0. Es el "% Merma" del Excel manual del dueño. */
  pctMermaSobreEntrada: number | null;

  /** Días desde la fecha de entrada por báscula hasta la ÚLTIMA fecha en que el calibrador procesó parte de este lote. `null` si falta la fecha de entrada o no hay ningún parte con fecha para este lote. */
  diasEnCamara: number | null;
  /**
   * min(max(0, mermaNaturalKg), kgEntrada × TASA_MERMA_NATURAL_DIA × diasEnCamara):
   * la parte de la merma medida que se explica solo por el tiempo en cámara
   * (deshidratación esperada), acotada a nunca superar la merma realmente
   * medida (el `min` es justo esa garantía). `null` si el lote no está
   * procesado, si mermaNaturalKg es negativo (calibradorSuperaEntrada) o si
   * diasEnCamara es null (desglose no calculable, nunca se inventa un valor).
   */
  mermaNaturalEstimadaKg: number | null;
  /** costePorKg × mermaNaturalEstimadaKg. `null` si sinCoste o mermaNaturalEstimadaKg es null. */
  mermaNaturalEstimadaEur: number | null;
  /**
   * max(0, mermaNaturalKg) − mermaNaturalEstimadaKg: podrido de un
   * contenedor pre-calibrador que NO se pesa a diario (ASUMIDO por el dueño,
   * decisión 2026-07-15 — antes se llamaba "diferencia sin justificar"). Es
   * una asunción, no una medición directa por lote, por eso se etiqueta
   * "asumido" en la UI. INVARIANTE de conservación:
   * mermaNaturalEstimadaKg + podridoPreCalibradorKg === max(0, mermaNaturalKg)
   * exacto (sin redondeos intermedios). Mismas condiciones de `null` que
   * mermaNaturalEstimadaKg.
   */
  podridoPreCalibradorKg: number | null;
  /** true si el componente "natural" del desglose es la merma REAL de cámara registrada (no la estimación tasa × días): la ficha lo etiqueta "real" en vez de "≈ estimado". */
  mermaCamaraReal: boolean;
  /** costePorKg × podridoPreCalibradorKg. `null` si sinCoste o podridoPreCalibradorKg es null. */
  podridoPreCalibradorEur: number | null;

  /**
   * kgCalibrador × `tasaPodridoPreCalibradorMes(última fecha de procesado)`: el
   * podrido de tría que CABRÍA ESPERAR para el mes en que este lote pasó por
   * línea (ver TASA_PODRIDO_PRE_CALIBRADOR_MES). Es una REFERENCIA paralela, no
   * entra en ninguna pérdida ni en ningún €: sirve para contrastar el residuo
   * `podridoPreCalibradorKg`. `null` si no se conoce la última fecha de
   * procesado o el lote no pasó kg por el calibrador (no se inventa un mes).
   */
  podridoPreCalibradorEsperadoKg: number | null;
  /**
   * max(0, esperado − asumido): los kg de podrido de tría que la resta NO ve.
   * `null` si falta cualquiera de los dos. Nunca negativo: si el residuo supera
   * lo esperado, no falta nada que señalar (es 0).
   */
  podridoPreCalibradorNoVistoKg: number | null;
  /**
   * Lote SIN MARGEN: la resta colapsó (`podridoPreCalibradorKg` por debajo de
   * `UMBRAL_SIN_MARGEN_PODRIDO` × entrada) mientras la tasa del mes esperaba
   * más. Su "0 de podrido pre-calibrador" NO es un 0 físico y la UI debe
   * marcarlo — es el motivo por el que un productor cuya fruta se procesó a
   * final de campaña sale artificialmente bien.
   */
  podridoPreCalibradorSinMargen: boolean;

  /**
   * `null` SOLO si NINGÚN parte que tocó este lote traía dato de podrido de
   * calibrador (todos con AMBAS columnas a null) y el lote no tiene Informe
   * LOTE real: "desconocido", no 0 (ver `ParteMermaInput`/`FuentePodrido`).
   * Si el lote se repartió entre partes con dato y partes sin dato, aquí va
   * la suma de los que SÍ tenían (lo conocido) y `podridoDesconocido` queda
   * `true` para no perder que falta información.
   */
  podridoCalibradorKg: number | null;
  podridoCalibradorFuente: FuentePodrido;
  /** Siempre estimado por prorrateo (no existe por lote en origen). Mismo criterio de `null` que `podridoCalibradorKg` (no hay fuente "real" para el manual). */
  podridoManualKg: number | null;
  /** true si `podridoCalibradorKg` y/o `podridoManualKg` incluyen algún parte sin dato (total o parcialmente desconocido): la UI debe marcarlo ("sin dato"), no tratarlo como si fuera completo. */
  podridoDesconocido: boolean;

  /** importeEntradaFruta(entrada) — el coste de compra ya contabilizado en Económico. */
  costeTotalLote: number;
  /** true si costeTotalLote <= 0: sin coste conocido, no se puede valorar en €. */
  sinCoste: boolean;
  /** costeTotalLote / kgEntrada, o null si sinCoste o kgEntrada <= 0. */
  costePorKg: number | null;

  /** costePorKg × max(0, mermaNaturalKg). `null` si sinCoste o mermaNaturalKg es null (lote no procesado). */
  perdidaMermaEur: number | null;
  /** costePorKg × (podridoCalibradorKg + podridoManualKg), tratando `null` (desconocido) como 0 en esta cuenta en € — ver `podridoDesconocido`. `null` si sinCoste. */
  perdidaPodridoEur: number | null;
  /** Suma de las dos anteriores (tratando null como 0 solo cuando la otra sí existe). `null` si sinCoste. */
  perdidaTotalEur: number | null;
  /** perdidaTotalEur / costeTotalLote × 100. `null` si sinCoste. */
  pctPerdidaSobreCoste: number | null;
}

// ─── Cálculo puro ────────────────────────────────────────────────────────────

export function computeMermaLotes(
  entradas: EntradaLoteInput[],
  lotesDia: LoteDiaKgInput[],
  clasificacionPodrido: ClasificacionLoteInput[],
  partes: ParteMermaInput[],
  /**
   * kg CONCILIADOS por lote (src/lib/conciliacionKg.ts, reglas del dueño
   * 21-jul-2026): el calibrador atribuye cada pasada al primer código de su
   * nombre, así que la suma cruda infla unos lotes (647 con proc > entrada →
   * "merma negativa") y deja a sus hermanos como merma/stock fantasma. Con
   * este mapa, kgCalibrador y la última fecha de procesado salen del reparto
   * conciliado (multi-códigos, reciclaje neto, PREC acotado, excesos
   * derramados) y la merma natural por lote pasa a ser creíble. El PRORRATEO
   * de podrido del parte sigue usando las cuotas crudas por día (la
   * conciliación no reparte por parte, y el podrido real del Informe LOTE —
   * la fuente preferida — no se ve afectado). Sin el mapa, comportamiento
   * original.
   */
  conciliadoPorLote?: Map<string, { kg: number; ultimaFecha: string | null }>,
): MermaLote[] {
  // --- 1. Kg por lote y por parte (numerador del prorrateo) + total del parte
  //         (denominador: TODOS los lotes del parte, tengan o no código
  //         reconocible) + kgCalibrador total por lote + última fecha de
  //         procesado por lote (para diasEnCamara: fecha del parte más
  //         reciente que tocó ese lote). ---
  const partePorId = new Map(partes.map((p) => [p.part_id, p]));
  const kgLotePorParte = new Map<string, Map<string, number>>(); // part_id -> (lote -> kg)
  const totalKgPorParte = new Map<string, number>(); // part_id -> Σ kg (todas las filas)
  const kgCalibradorPorLote = new Map<string, number>();
  const ultimaFechaProcesadoPorLote = new Map<string, string>();

  for (const row of lotesDia) {
    const kgRaw = Number(row.kg_peso_total) || 0;
    totalKgPorParte.set(row.part_id, (totalKgPorParte.get(row.part_id) ?? 0) + kgRaw);

    const lote = normalizarLoteCodigo(row.lote_codigo);
    if (!lote) continue; // sin código reconocible: cuenta en el denominador del parte, no se puede atribuir a un lote.
    const mapaParte = kgLotePorParte.get(row.part_id) ?? new Map<string, number>();
    kgLotePorParte.set(row.part_id, mapaParte);
    mapaParte.set(lote, (mapaParte.get(lote) ?? 0) + kgRaw);
    kgCalibradorPorLote.set(lote, (kgCalibradorPorLote.get(lote) ?? 0) + kgRaw);

    const fechaParte = partePorId.get(row.part_id)?.date ?? null;
    if (fechaParte) {
      const actual = ultimaFechaProcesadoPorLote.get(lote);
      if (!actual || fechaParte > actual) ultimaFechaProcesadoPorLote.set(lote, fechaParte);
    }
  }

  // --- 2. Prorrateo de podrido (auto + manual) parte a parte, con la MISMA
  //         cuota (kg del lote en el parte / kg total del parte) para ambos.
  //         Cada contador (auto/manual) es INDEPENDIENTE por null: si el
  //         parte trae `null` en esa columna, su cuota no se suma a la suma
  //         "conocida" del lote y el lote queda marcado con al menos una
  //         contribución desconocida para ese contador (ver `*Desconocido`
  //         más abajo) — nunca se trata el null como 0. ---
  const podridoAutoProrrateoPorLote = new Map<string, number>(); // solo partes con dato
  const podridoManualProrrateoPorLote = new Map<string, number>(); // solo partes con dato
  const loteConAutoDesconocido = new Set<string>();
  const loteConAutoConocido = new Set<string>();
  const loteConManualDesconocido = new Set<string>();
  const loteConManualConocido = new Set<string>();

  for (const [partId, mapaParte] of kgLotePorParte) {
    const denom = totalKgPorParte.get(partId) ?? 0;
    if (denom <= 0) continue; // el parte no aporta a ningún lote (sin kg positivo registrado).
    const parte = partePorId.get(partId);
    const autoRaw = parte?.kg_podrido_calibrador_auto;
    const manualRaw = parte?.kg_podrido_bolsa_basura;
    for (const [lote, kg] of mapaParte) {
      const cuota = kg / denom;
      if (autoRaw == null) {
        loteConAutoDesconocido.add(lote);
      } else {
        loteConAutoConocido.add(lote);
        podridoAutoProrrateoPorLote.set(lote, (podridoAutoProrrateoPorLote.get(lote) ?? 0) + Number(autoRaw) * cuota);
      }
      if (manualRaw == null) {
        loteConManualDesconocido.add(lote);
      } else {
        loteConManualConocido.add(lote);
        podridoManualProrrateoPorLote.set(lote, (podridoManualProrrateoPorLote.get(lote) ?? 0) + Number(manualRaw) * cuota);
      }
    }
  }

  // --- 3. Informe LOTE real: presencia (cualquier clase) => informe existe;
  //         suma de filas de clase "Podrido" (case-insensitive) => valor real
  //         (puede ser 0 si el informe no tiene esa clase). ---
  const informeLotes = new Set<string>();
  const podridoRealPorLote = new Map<string, number>();
  for (const row of clasificacionPodrido) {
    const lote = normalizarLoteCodigo(row.lote_codigo);
    if (!lote) continue;
    informeLotes.add(lote);
    if ((row.clase ?? "").toLowerCase().includes("podrido")) {
      const kg = Number(row.peso_kg) || 0;
      podridoRealPorLote.set(lote, (podridoRealPorLote.get(lote) ?? 0) + kg);
    }
  }

  // --- 4. Componer por lote (a partir de las entradas de báscula, que son
  //         las que traen el coste). ---
  return entradas.map((entrada): MermaLote => {
    const lote = normalizarLoteCodigo(entrada.lote) ?? entrada.lote;
    const kgEntrada = Number(entrada.kg_entrada) || 0;
    // Un ajuste NEGATIVO no resta: la conciliación ya corrige la
    // sobre-atribución del calibrador y restarlo aquí la contaría dos veces
    // (ver "La foto de stock NEGATIVA no se resta" en la cabecera).
    const kgAjusteBruto = Number(entrada.kg_ajuste_stock) || 0;
    const kgAjuste = Math.max(0, kgAjusteBruto);
    // Con conciliación: el kg del reparto (ausente en el mapa = 0 conciliado,
    // no "sin dato" — la conciliación cubre todas las entradas). Sin ella, la
    // suma cruda de siempre.
    const kgCalibrador = conciliadoPorLote
      ? conciliadoPorLote.get(lote)?.kg ?? 0
      : kgCalibradorPorLote.get(lote) ?? 0;
    const cerradoManualmente = Boolean(entrada.cerrado_at);
    // "sin_registro" (ver cabecera): NULL de cierre_modo con cerrado_at
    // relleno es compat con cierres anteriores a esta columna y se trata
    // como "con_analisis" (comportamiento original, sin cambios).
    const cerradoSinRegistro = cerradoManualmente && entrada.cierre_modo === "sin_registro";

    const kgProcesadoTotal = kgCalibrador + kgAjuste;
    // cerradoManualmente fuerza "procesado" aunque no llegue al umbral normal:
    // el hueco se reclasifica como merma (ver cabecera del archivo).
    const estado = estadoLotePorProcesado(kgEntrada, kgProcesadoTotal, cerradoManualmente);

    const mermaNaturalKg = estado === "procesado" ? kgEntrada - kgCalibrador - kgAjuste : null;
    const calibradorSuperaEntrada = mermaNaturalKg != null && mermaNaturalKg < 0;
    const pctMermaSobreEntrada = mermaNaturalKg != null && kgEntrada > 0 ? (mermaNaturalKg / kgEntrada) * 100 : null;

    // diasEnCamara: fecha de entrada -> última fecha de procesado conocida
    // para este lote (de cualquier parte que lo haya tocado, procesado del
    // todo o no). null si falta cualquiera de las dos fechas.
    // Con conciliación, la fecha del reparto (los kg derramados heredan la
    // del donante); la cruda queda de respaldo si el reparto no trae fecha.
    const ultimaFechaProcesado = conciliadoPorLote?.get(lote)?.ultimaFecha
      ?? ultimaFechaProcesadoPorLote.get(lote)
      ?? null;
    const diasEnCamara = entrada.fecha && ultimaFechaProcesado
      ? diffDias(entrada.fecha, ultimaFechaProcesado)
      : null;

    // Desglose natural estimada / diferencia sin justificar: solo cuando hay
    // merma medida NO negativa (lote procesado, calibrador no supera la
    // entrada) y se conocen los días en cámara. El `min` es la garantía de
    // que la estimación nunca supere lo realmente medido; la resta exacta
    // sobre ese mismo `min` mantiene la conservación sin redondeos.
    // Con merma de cámara REAL registrada (entradas_bascula.merma_camara_kg,
    // del registro manual de las cámaras — 21-jul-2026), el componente
    // "natural" es el dato MEDIDO en vez de tasa × días (misma garantía min).
    const mermaCamaraReal = entrada.merma_camara_kg != null ? Math.max(0, Number(entrada.merma_camara_kg) || 0) : null;
    let mermaNaturalEstimadaKg: number | null = null;
    let podridoPreCalibradorKg: number | null = null;
    if (mermaNaturalKg != null && !calibradorSuperaEntrada && (diasEnCamara != null || mermaCamaraReal != null)) {
      const mermaMedida = Math.max(0, mermaNaturalKg);
      const estimadaMax = mermaCamaraReal ?? kgEntrada * TASA_MERMA_NATURAL_DIA * (diasEnCamara ?? 0);
      mermaNaturalEstimadaKg = Math.min(mermaMedida, estimadaMax);
      podridoPreCalibradorKg = mermaMedida - mermaNaturalEstimadaKg;
    }

    // Referencia por MES DE PROCESO (ver TASA_PODRIDO_PRE_CALIBRADOR_MES): no
    // toca ninguna fórmula de arriba ni ningún €, solo permite ver dónde el
    // residuo se queda corto. Base = kg que pasaron por el calibrador (es
    // sobre kg procesados como se calibró la tasa); mes = el de la ÚLTIMA
    // fecha de procesado, que es cuando esa fruta pasó por la tría.
    const podridoPreCalibradorEsperadoKg = ultimaFechaProcesado != null && kgCalibrador > 0
      ? kgCalibrador * tasaPodridoPreCalibradorMes(ultimaFechaProcesado)
      : null;
    const podridoPreCalibradorNoVistoKg = podridoPreCalibradorEsperadoKg != null && podridoPreCalibradorKg != null
      ? Math.max(0, podridoPreCalibradorEsperadoKg - podridoPreCalibradorKg)
      : null;
    const podridoPreCalibradorSinMargen = podridoPreCalibradorKg != null
      && podridoPreCalibradorEsperadoKg != null
      && podridoPreCalibradorKg < kgEntrada * UMBRAL_SIN_MARGEN_PODRIDO
      && podridoPreCalibradorEsperadoKg > podridoPreCalibradorKg;

    // Informe LOTE real manda siempre para el calibrador, tenga o no el
    // parte dato de podrido (un informe real no depende del prorrateo).
    // Si NO hay informe: "desconocido" solo cuando NINGÚN parte que tocó el
    // lote traía dato (auto conocido=0 aportantes); si hay una mezcla de
    // partes con y sin dato, se suma lo conocido y se marca `podridoDesconocido`.
    const tieneInforme = informeLotes.has(lote);
    const autoTotalmenteDesconocido = !tieneInforme && loteConAutoDesconocido.has(lote) && !loteConAutoConocido.has(lote);
    const manualTotalmenteDesconocido = loteConManualDesconocido.has(lote) && !loteConManualConocido.has(lote);

    const podridoCalibradorKg: number | null = tieneInforme
      ? (podridoRealPorLote.get(lote) ?? 0)
      : autoTotalmenteDesconocido
        ? null
        : (podridoAutoProrrateoPorLote.get(lote) ?? 0);
    const podridoCalibradorFuente: FuentePodrido = tieneInforme
      ? "real"
      : autoTotalmenteDesconocido
        ? "desconocido"
        : "prorrateo";
    const podridoManualKg: number | null = manualTotalmenteDesconocido ? null : (podridoManualProrrateoPorLote.get(lote) ?? 0);

    // Mezcla parcial (algunos partes del lote con dato, otros sin él): la
    // cifra ya solo suma lo conocido, pero hay que dejar constancia de que
    // falta información aunque el número no salga `null`.
    const podridoDesconocido =
      podridoCalibradorKg == null
      || podridoManualKg == null
      || (!tieneInforme && loteConAutoDesconocido.has(lote) && loteConAutoConocido.has(lote))
      || (loteConManualDesconocido.has(lote) && loteConManualConocido.has(lote));

    const costeTotalLote = importeEntradaFruta({
      fecha: entrada.fecha,
      kg_entrada: kgEntrada,
      importe_compra: entrada.importe_compra,
      coste_recoleccion: entrada.coste_recoleccion,
      importe_transporte: entrada.importe_transporte,
      importe_comision: entrada.importe_comision,
      importe_total: entrada.importe_total,
    });
    const sinCoste = !(costeTotalLote > 0);
    const costePorKg = !sinCoste && kgEntrada > 0 ? costeTotalLote / kgEntrada : null;

    let perdidaMermaEur: number | null = null;
    let perdidaPodridoEur: number | null = null;
    let perdidaTotalEur: number | null = null;
    let pctPerdidaSobreCoste: number | null = null;
    let mermaNaturalEstimadaEur: number | null = null;
    let podridoPreCalibradorEur: number | null = null;

    if (costePorKg != null) {
      perdidaMermaEur = mermaNaturalKg != null ? costePorKg * Math.max(0, mermaNaturalKg) : null;
      // podridoDesconocido (null) se trata como 0 SOLO en esta cuenta en €:
      // no hay forma honesta de valorar en euros lo que no se sabe en kg, así
      // que la pérdida en € queda subestimada para esos lotes a propósito
      // (documentado); `podridoDesconocido` es la señal para que la UI/el
      // agregado lo marquen en vez de darlo por completo.
      // SOLO el podrido del calibrador: el manual sale ANTES del calibrador y
      // ya está dentro de la merma medida (modelo del dueño, 21-jul-2026) —
      // sumarlo aquí lo contaría dos veces.
      perdidaPodridoEur = costePorKg * (podridoCalibradorKg ?? 0);
      perdidaTotalEur = (perdidaMermaEur ?? 0) + perdidaPodridoEur;
      pctPerdidaSobreCoste = costeTotalLote > 0 ? (perdidaTotalEur / costeTotalLote) * 100 : null;
      mermaNaturalEstimadaEur = mermaNaturalEstimadaKg != null ? costePorKg * mermaNaturalEstimadaKg : null;
      podridoPreCalibradorEur = podridoPreCalibradorKg != null ? costePorKg * podridoPreCalibradorKg : null;
    }

    // "sin_registro" (ver cabecera del archivo): se anula TODO lo derivado de
    // merma/podrido/pérdida (null, no 0 — "excluido" es distinto de "sin
    // pérdida") DESPUÉS de calcularlo todo con el criterio normal de arriba,
    // para no bifurcar la lógica de cálculo en dos caminos que puedan
    // divergir con el tiempo. kgEntrada/kgCalibrador/kgAjuste/coste NO se
    // tocan (siguen siendo datos reales, útiles para que la ficha del lote
    // explique qué pasó); `estado` tampoco cambia (el criterio de stock es el
    // mismo en cualquier modo, ver estadoLotePorProcesado).
    if (cerradoSinRegistro) {
      return {
        lote,
        estado,
        fecha: entrada.fecha,
        cerradoManualmente,
        cerradoSinRegistro,
        kgEntrada,
        kgAjuste,
      kgAjusteBruto,
        kgCalibrador,
        mermaNaturalKg: null,
        calibradorSuperaEntrada: false,
        pctMermaSobreEntrada: null,
        diasEnCamara,
        mermaNaturalEstimadaKg: null,
        mermaNaturalEstimadaEur: null,
        podridoPreCalibradorKg: null,
        mermaCamaraReal: false,
        podridoPreCalibradorEur: null,
        // Excluido del análisis (ver cabecera): tampoco se le señala nada.
        podridoPreCalibradorEsperadoKg: null,
        podridoPreCalibradorNoVistoKg: null,
        podridoPreCalibradorSinMargen: false,
        podridoCalibradorKg: null,
        podridoCalibradorFuente: "desconocido",
        podridoManualKg: null,
        podridoDesconocido: false,
        costeTotalLote,
        sinCoste,
        costePorKg,
        perdidaMermaEur: null,
        perdidaPodridoEur: null,
        perdidaTotalEur: null,
        pctPerdidaSobreCoste: null,
      };
    }

    return {
      lote,
      estado,
      fecha: entrada.fecha,
      cerradoManualmente,
      cerradoSinRegistro,
      kgEntrada,
      kgAjuste,
      kgAjusteBruto,
      kgCalibrador,
      mermaNaturalKg,
      calibradorSuperaEntrada,
      pctMermaSobreEntrada,
      diasEnCamara,
      mermaNaturalEstimadaKg,
      mermaNaturalEstimadaEur,
      podridoPreCalibradorKg,
      mermaCamaraReal: mermaCamaraReal != null,
      podridoPreCalibradorEur,
      podridoPreCalibradorEsperadoKg,
      podridoPreCalibradorNoVistoKg,
      podridoPreCalibradorSinMargen,
      podridoCalibradorKg,
      podridoCalibradorFuente,
      podridoManualKg,
      podridoDesconocido,
      costeTotalLote,
      sinCoste,
      costePorKg,
      perdidaMermaEur,
      perdidaPodridoEur,
      perdidaTotalEur,
      pctPerdidaSobreCoste,
    };
  });
}

// ─── Agregados ────────────────────────────────────────────────────────────────

export interface MermaLotesAgregado {
  nLotes: number;
  nProcesados: number;
  /** Pendientes + parciales: sin merma calculable todavía. */
  nPendientesOParciales: number;
  nSinCoste: number;
  /** Lotes con calibradorSuperaEntrada=true (dato a revisar). */
  nConDatoARevisar: number;

  /** Σ kg_entrada de los lotes procesados (denominador de la merma media ponderada). */
  kgEntradaProcesados: number;
  /**
   * Denominador del % de PÉRDIDA TOTAL (ver pctPerdidaTotalDeAgregado).
   * Decisión del dueño 06-ago-2026 ("el podrido de lotes a medio procesar
   * cuenta"): los totales de podrido incluyen lotes que todavía no han
   * terminado, así que el denominador tiene que incluirlos también o el % sale
   * inflado. Para un lote TERMINADO se cuenta toda su entrada (ya se arriesgó
   * entera); para uno a medias, solo los kg que YA han pasado por el
   * calibrador — el resto sigue en cámara y todavía no ha podido perderse.
   */
  kgBaseParaPctPerdida: number;
  /** Nº de lotes NO terminados que aportan podrido a los totales (los que hacen que kgBaseParaPctPerdida > kgEntradaProcesados). */
  nLotesSinTerminarConPodrido: number;
  /** Σ mermaNaturalKg CON SIGNO de los lotes procesados (sin clamp: refleja la media real, no la pérdida en €). */
  kgMermaNaturalTotal: number;
  /** Σ merma / Σ entrada de procesados, en %. `null` si no hay procesados. */
  mermaMediaPonderadaPct: number | null;

  /** Σ mermaNaturalEstimadaKg (null tratado como 0): la fracción de la merma medida que explican solo los días en cámara. */
  kgNaturalEstimadaTotal: number;
  /** Σ podridoPreCalibradorKg (null tratado como 0): podrido de un contenedor pre-calibrador no pesado a diario, ASUMIDO por el dueño (decisión 2026-07-15; antes "diferencia sin justificar"). */
  kgPodridoPreCalibradorTotal: number;
  /** € de kgNaturalEstimadaTotal. */
  eurNaturalEstimadaTotal: number;
  /** € de kgPodridoPreCalibradorTotal. */
  eurPodridoPreCalibradorTotal: number;
  /** Lotes procesados con merma medida no negativa pero sin diasEnCamara conocido: no se pudo desglosar natural/sin-justificar (no es un 0, es "no calculable"). */
  nSinDesglosePosible: number;

  /**
   * Σ `podridoPreCalibradorEsperadoKg`: el podrido de tría que cabría esperar
   * por la tasa del mes de proceso de cada lote. REFERENCIA, no se suma a
   * ninguna pérdida — comparar con `kgPodridoPreCalibradorTotal` (el residuo).
   */
  kgPodridoPreCalibradorEsperado: number;
  /** Σ `podridoPreCalibradorNoVistoKg`: cuánto podrido de tría NO ve la resta en este agregado. */
  kgPodridoPreCalibradorNoVisto: number;
  /** Lotes SIN MARGEN (ver `podridoPreCalibradorSinMargen`): su 0 de pre-calibrador no es físico. */
  nLotesSinMargenPodrido: number;
  /** Σ kgCalibrador de esos lotes sin margen: la base sobre la que el agregado está infravalorado. */
  kgProcesadoSinMargen: number;

  /** Podrido de calibrador con fuente "real" (Informe LOTE) vs "prorrateo" (estimado) — SIEMPRE separados. */
  kgPodridoCalibradorReal: number;
  kgPodridoCalibradorEstimado: number;
  /** Podrido manual: siempre estimado (no existe por lote en origen). */
  kgPodridoManualEstimado: number;
  /** Lotes con `podridoDesconocido=true` (algún parte sin dato de podrido, típicamente días del histórico de campaña importado): sus € de podrido están SUBESTIMADOS (ver `perdidaPodridoEur`), la UI debe marcarlos "sin dato". */
  nLotesPodridoDesconocido: number;

  /** € de pérdida por merma (nunca es "estimado": es una resta exacta sobre lotes procesados con coste). */
  eurPerdidaMermaTotal: number;
  /** € de pérdida por podrido de calibrador, separados por la misma fuente real/estimado que el kg. */
  eurPerdidaPodridoCalibradorReal: number;
  eurPerdidaPodridoCalibradorEstimado: number;
  /** € de pérdida por podrido manual: siempre estimado. */
  eurPerdidaPodridoManualEstimado: number;
  /** Suma de las cuatro anteriores — se expone junto a ellas, nunca en su lugar (real y estimado quedan siempre visibles por separado). */
  eurPerdidaTotal: number;

  /** Σ costeTotalLote de los lotes con coste conocido (para relativizar eurPerdidaTotal). */
  costeTotalConCoste: number;
  /** eurPerdidaTotal / costeTotalConCoste × 100. `null` si costeTotalConCoste <= 0. */
  pctPerdidaTotalSobreCoste: number | null;

  /**
   * Lotes con `cerradoSinRegistro=true` (ver cabecera del archivo): EXCLUIDOS
   * de todos los campos de arriba (nProcesados, kg/€ de merma y podrido,
   * costeTotalConCoste…), expuestos aparte para poder informar sin
   * mezclarlos con el resto del análisis.
   */
  nLotesCerradosSinRegistro: number;
  /** Σ kgEntrada de esos lotes (para el pie informativo "N lotes / Y kg excluidos"). */
  kgCerradosSinRegistro: number;
}

export function agregarMermaLotes(lotes: MermaLote[]): MermaLotesAgregado {
  const cerradosSinRegistro = lotes.filter((l) => l.cerradoSinRegistro);
  // "procesados" para TODO el análisis de merma/podrido excluye los cerrados
  // sin registro (ver cabecera del archivo): aunque su `estado` siga siendo
  // "procesado" (el criterio de stock no cambia según el modo), no tienen
  // merma/podrido calculable y no deben diluir la media ni los totales.
  const procesados = lotes.filter((l) => l.estado === "procesado" && !l.cerradoSinRegistro);
  const kgEntradaProcesados = procesados.reduce((s, l) => s + l.kgEntrada, 0);
  const kgMermaNaturalTotal = procesados.reduce((s, l) => s + (l.mermaNaturalKg ?? 0), 0);

  const kgNaturalEstimadaTotal = lotes.reduce((s, l) => s + (l.mermaNaturalEstimadaKg ?? 0), 0);
  const kgPodridoPreCalibradorTotal = lotes.reduce((s, l) => s + (l.podridoPreCalibradorKg ?? 0), 0);
  const eurNaturalEstimadaTotal = lotes.reduce((s, l) => s + (l.mermaNaturalEstimadaEur ?? 0), 0);
  const eurPodridoPreCalibradorTotal = lotes.reduce((s, l) => s + (l.podridoPreCalibradorEur ?? 0), 0);
  // "No se pudo desglosar" se pregunta por el RESULTADO, no por una de sus
  // condiciones: desde que la merma REAL de cámara (merma_camara_kg) permite
  // desglosar un lote sin días en cámara conocidos, mirar solo `diasEnCamara`
  // contaba como no calculable un lote que sí tiene su desglose hecho.
  const nSinDesglosePosible = procesados.filter(
    (l) => !l.calibradorSuperaEntrada && l.mermaNaturalKg != null && l.mermaNaturalEstimadaKg == null,
  ).length;

  // Referencia por mes de proceso (ver TASA_PODRIDO_PRE_CALIBRADOR_MES). Mismo
  // criterio de recorrido que kgPodridoPreCalibradorTotal (todos los lotes,
  // null tratado como 0): los cerrados sin registro ya traen null en estos
  // campos, así que quedan fuera solos.
  const lotesSinMargen = lotes.filter((l) => l.podridoPreCalibradorSinMargen);
  const kgPodridoPreCalibradorEsperado = lotes.reduce((s, l) => s + (l.podridoPreCalibradorEsperadoKg ?? 0), 0);
  const kgPodridoPreCalibradorNoVisto = lotes.reduce((s, l) => s + (l.podridoPreCalibradorNoVistoKg ?? 0), 0);

  // Lotes SIN terminar que ya han dejado podrido (decisión del dueño
  // 06-ago-2026: ese podrido cuenta aunque el lote siga en marcha). Sus kg ya
  // pasados por línea entran en el denominador del % — ver
  // `kgBaseParaPctPerdida`. Los cerrados sin registro nunca cuentan.
  const sinTerminarConPodrido = lotes.filter((l) =>
    l.estado !== "procesado"
    && !l.cerradoSinRegistro
    && ((l.podridoCalibradorKg ?? 0) > 0 || (l.podridoManualKg ?? 0) > 0),
  );
  const kgBaseParaPctPerdida = kgEntradaProcesados
    + sinTerminarConPodrido.reduce((s, l) => s + Math.max(0, l.kgCalibrador), 0);

  const podridoCalibradorReal = lotes.filter((l) => l.podridoCalibradorFuente === "real");
  const podridoCalibradorEstimado = lotes.filter((l) => l.podridoCalibradorFuente === "prorrateo");

  const kgPodridoCalibradorReal = podridoCalibradorReal.reduce((s, l) => s + (l.podridoCalibradorKg ?? 0), 0);
  const kgPodridoCalibradorEstimado = podridoCalibradorEstimado.reduce((s, l) => s + (l.podridoCalibradorKg ?? 0), 0);
  const kgPodridoManualEstimado = lotes.reduce((s, l) => s + (l.podridoManualKg ?? 0), 0);
  const nLotesPodridoDesconocido = lotes.filter((l) => l.podridoDesconocido).length;

  const eurPerdidaMermaTotal = lotes.reduce((s, l) => s + (l.perdidaMermaEur ?? 0), 0);
  const eurPerdidaPodridoCalibradorReal = podridoCalibradorReal.reduce(
    (s, l) => s + (l.costePorKg != null ? l.costePorKg * (l.podridoCalibradorKg ?? 0) : 0),
    0,
  );
  const eurPerdidaPodridoCalibradorEstimado = podridoCalibradorEstimado.reduce(
    (s, l) => s + (l.costePorKg != null ? l.costePorKg * (l.podridoCalibradorKg ?? 0) : 0),
    0,
  );
  const eurPerdidaPodridoManualEstimado = lotes.reduce(
    (s, l) => s + (l.costePorKg != null ? l.costePorKg * (l.podridoManualKg ?? 0) : 0),
    0,
  );
  // El podrido MANUAL no se suma aquí (corrección 06-ago-2026, confirmada por
  // el dueño: esa fruta se aparta ANTES de entrar al calibrador, así que ya
  // está dentro de `mermaNaturalKg` = entrada − calibrador y por tanto dentro
  // de eurPerdidaMermaTotal). Sumarlo la contaba dos veces: era la única
  // fórmula del módulo que se desviaba del modelo de la cabecera y del
  // `perdidaPodridoEur` por lote, y hacía que este total no fuera la suma de
  // los `perdidaTotalEur` de sus lotes. Se sigue exponiendo aparte
  // (`eurPerdidaPodridoManualEstimado`) como DESGLOSE de la merma, nunca como
  // sumando adicional.
  const eurPerdidaTotal = eurPerdidaMermaTotal
    + eurPerdidaPodridoCalibradorReal
    + eurPerdidaPodridoCalibradorEstimado;

  // Excluye también los cerrados sin registro del denominador de
  // pctPerdidaTotalSobreCoste: su coste es real, pero incluirlo aquí (con
  // pérdida 0 forzada) diluiría el % de pérdida del resto sin motivo.
  const costeTotalConCoste = lotes
    .filter((l) => !l.sinCoste && !l.cerradoSinRegistro)
    .reduce((s, l) => s + l.costeTotalLote, 0);

  return {
    nLotes: lotes.length,
    nProcesados: procesados.length,
    // Reconciliación: nLotes === nProcesados + nPendientesOParciales +
    // nLotesCerradosSinRegistro (los cerrados sin registro tienen estado
    // "procesado" pero ya no están en `procesados`, así que hay que
    // restarlos aparte para no contarlos también aquí).
    nPendientesOParciales: lotes.length - procesados.length - cerradosSinRegistro.length,
    nSinCoste: lotes.filter((l) => l.sinCoste).length,
    nConDatoARevisar: lotes.filter((l) => l.calibradorSuperaEntrada).length,

    kgEntradaProcesados,
    kgBaseParaPctPerdida,
    nLotesSinTerminarConPodrido: sinTerminarConPodrido.length,
    kgMermaNaturalTotal,
    mermaMediaPonderadaPct: kgEntradaProcesados > 0 ? (kgMermaNaturalTotal / kgEntradaProcesados) * 100 : null,

    kgNaturalEstimadaTotal,
    kgPodridoPreCalibradorTotal,
    eurNaturalEstimadaTotal,
    eurPodridoPreCalibradorTotal,
    nSinDesglosePosible,

    kgPodridoPreCalibradorEsperado,
    kgPodridoPreCalibradorNoVisto,
    nLotesSinMargenPodrido: lotesSinMargen.length,
    kgProcesadoSinMargen: lotesSinMargen.reduce((s, l) => s + Math.max(0, l.kgCalibrador), 0),

    kgPodridoCalibradorReal,
    kgPodridoCalibradorEstimado,
    kgPodridoManualEstimado,
    nLotesPodridoDesconocido,

    eurPerdidaMermaTotal,
    eurPerdidaPodridoCalibradorReal,
    eurPerdidaPodridoCalibradorEstimado,
    eurPerdidaPodridoManualEstimado,
    eurPerdidaTotal,

    costeTotalConCoste,
    pctPerdidaTotalSobreCoste: costeTotalConCoste > 0 ? (eurPerdidaTotal / costeTotalConCoste) * 100 : null,

    nLotesCerradosSinRegistro: cerradosSinRegistro.length,
    kgCerradosSinRegistro: cerradosSinRegistro.reduce((s, l) => s + l.kgEntrada, 0),
  };
}

/**
 * Explicación CANÓNICA del "podrido pre-calibrador" para tooltips de la UI
 * (única fuente, 2026-07-28: antes vivía copiada en EntradasBascula y
 * TrazabilidadLote y ya habían divergido — una mencionaba las bateas y la
 * otra no).
 */
export const INFO_PODRIDO_PRE_CALIBRADOR =
  "Podrido retirado en la tría, antes de pasar por el calibrador: sale por la bolsa/contenedor que se pesa a diario y por las bateas que se pesan al vaciarlas. Por lote es SIEMPRE una estimación a partir de los pesos (entrada − merma natural − procesado), porque ninguna de las dos pesadas se puede repartir por lote — las bateas además se llenan durante varios días, así que su kg ni siquiera es del día en que se apuntó. Las dos quedan como contraste agregado del parte, nunca se suman encima de esta cifra. AVISO: cuando el procesado cubre casi toda la entrada esa resta se queda sin hueco y sale 0 aunque sí hubiera podrido (pasa sobre todo de junio en adelante); en esos lotes la cifra es un suelo y se marca como «sin margen», con la referencia esperada del mes al lado.";

/**
 * % de pérdida total (merma natural clampada + podrido de calibrador real y
 * estimado) sobre los kg de entrada de los lotes procesados de un agregado.
 * Fórmula ÚNICA (2026-07-28) compartida por la tira de ficha del dossier,
 * PerdidaFrutaCard y la columna "% Pérdida" del ranking de /productores —
 * antes vivía copiada a mano en cada sitio. `null` si el agregado no tiene
 * lotes procesados.
 *
 * El podrido MANUAL ya NO entra (corrección 06-ago-2026, confirmada por el
 * dueño: se aparta antes del calibrador, así que `kgMermaNaturalTotal` ya lo
 * contiene). Antes se sumaba aparte "como informativo" y eso lo contaba dos
 * veces, inflando el % de pérdida de cada productor.
 */
export function pctPerdidaTotalDeAgregado(agregado: MermaLotesAgregado | null): number | null {
  if (!agregado || agregado.kgBaseParaPctPerdida <= 0) return null;
  const podridoTotalKg = agregado.kgPodridoCalibradorReal + agregado.kgPodridoCalibradorEstimado;
  const naturalKg = Math.max(0, agregado.kgMermaNaturalTotal);
  // Denominador que incluye los kg ya pasados de los lotes sin terminar que
  // aportan podrido al numerador (decisión del dueño 06-ago-2026): antes el
  // numerador los contaba y el denominador no, y el % salía inflado.
  return ((naturalKg + podridoTotalKg) / agregado.kgBaseParaPctPerdida) * 100;
}

// ─── Filtro por periodo (para Económico: € solo tienen sentido acotados a un rango) ─

/**
 * Lotes cuya `fecha` (entrada por báscula) cae en [desde, hasta] (ambos
 * incluidos, comparación de strings ISO "YYYY-MM-DD", igual criterio que el
 * resto de queries por rango de fecha del repo). Se usa para las secciones de
 * Económico, que necesitan acotar € al periodo elegido en la página; las
 * páginas de producción (Trazabilidad/Entradas) no filtran por periodo, ven
 * el conjunto completo.
 */
export function mermaLotesEnPeriodo(lotes: MermaLote[], desde: string, hasta: string): MermaLote[] {
  return lotes.filter((l) => l.fecha >= desde && l.fecha <= hasta);
}

/** fecha ISO + n días, sin depender de la zona horaria (aritmética UTC pura). */
function sumarDiasIso(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/**
 * Lotes PROCESADOS cuya ÚLTIMA fecha de procesado cae en [desde, hasta]. Es
 * el filtro correcto para las vistas "de la semana de línea" (p. ej. la carta
 * de mermas/podrido de Mercadona · Producción): con las cámaras externas un
 * lote entra en mayo y pasa por línea en julio, así que filtrar por fecha de
 * ENTRADA (mermaLotesEnPeriodo, el criterio de Económico) contaría la merma
 * en la semana equivocada. La última fecha de procesado no está en MermaLote
 * como campo propio, pero es exacta por construcción: fecha de entrada +
 * diasEnCamara (así se calculó diasEnCamara, ver computeMermaLotes). Los
 * lotes sin diasEnCamara (sin fecha de parte conocida) no se pueden situar en
 * el tiempo y quedan fuera — nunca se adivina.
 */
export function mermaLotesProcesadosEnPeriodo(lotes: MermaLote[], desde: string, hasta: string): MermaLote[] {
  return lotes.filter((l) => {
    if (l.estado !== "procesado" || l.diasEnCamara == null) return false;
    const fin = sumarDiasIso(l.fecha, l.diasEnCamara);
    return fin >= desde && fin <= hasta;
  });
}

// ─── Ranking por productor (kg o €, según lo pida el consumidor) ────────────
// La resolución de la CLAVE de agrupación (id del catálogo vía alias, o texto
// crudo si no hay vínculo) vive en productoresCanonicos.ts (resolveProductorGroupKey)
// porque necesita el mapa de alias cargado de Supabase; esta función solo
// agrega kg/€ ya resueltos por esa clave, para que ni EntradasBascula.tsx
// (kg, sin €) ni EconomicoCostes.tsx (€) reimplementen el agrupado/orden.

export interface ItemPerdidaProductor {
  /** Clave de agrupación (ver resolveProductorGroupKey en productoresCanonicos.ts): "id:<uuid>" o "nombre:<texto crudo>". */
  productorKey: string;
  /** Nombre a mostrar (canónico del catálogo si se resolvió id, si no el texto crudo de esta fila). */
  productorLabel: string;
  kgEntrada: number;
  kgPerdido: number;
  /** `null` si el lote no tiene coste conocido (sinCoste): no se sustituye por 0 para no falsear el ranking en €. */
  eurPerdido: number | null;
}

export interface RankingProductor {
  key: string;
  label: string;
  kgEntrada: number;
  kgPerdido: number;
  /** `null` solo si NINGÚN lote del grupo tenía coste conocido. */
  eurPerdido: number | null;
  nLotes: number;
}

/** Agrupa por `productorKey`, sumando kg/€; el orden de entrada no importa, el resultado no viene ordenado (cada consumidor ordena por el criterio que le interese: kg o €). */
export function agruparPerdidaPorProductor(items: ItemPerdidaProductor[]): RankingProductor[] {
  const map = new Map<string, RankingProductor>();
  for (const item of items) {
    const acc = map.get(item.productorKey) ?? {
      key: item.productorKey,
      label: item.productorLabel,
      kgEntrada: 0,
      kgPerdido: 0,
      eurPerdido: null,
      nLotes: 0,
    };
    acc.kgEntrada += item.kgEntrada;
    acc.kgPerdido += item.kgPerdido;
    if (item.eurPerdido != null) acc.eurPerdido = (acc.eurPerdido ?? 0) + item.eurPerdido;
    acc.nLotes += 1;
    map.set(item.productorKey, acc);
  }
  return Array.from(map.values());
}
