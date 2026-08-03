/**
 * importBandeja.ts — clasificador PURO (sin red) de un archivo soltado en la
 * futura "bandeja de importación unificada": dado el nombre y las hojas ya
 * leídas de un Excel, decide qué tipo de archivo del repo es y devuelve el
 * resultado del parser correspondiente (para que el consumidor no tenga que
 * reparsear).
 *
 * ORDEN de la cadena de clasificación (crítico, no reordenar sin pensar los
 * solapamientos):
 *
 *   0. Extensión: .doc/.docx/.txt (diarios de calidad viejos, sin parser) y
 *      cualquier cosa que no sea .xlsx/.xls (o que no se haya podido leer como
 *      Excel) se descartan antes de tocar ningún parser.
 *
 *   1. CONTENIDO de la PRIMERA hoja, contra los parsers "de detalle" del
 *      repo, cada uno con su validez estricta. Informe LOTE (calibrador, un
 *      lote) va ANTES que el informe de productor (calibrador, un productor
 *      con varias variedades) porque son los dos únicos formatos que
 *      comparten vocabulario ("Clase:", "(X) Nombre", "Tamaño"/"Peso (kg)")
 *      pero difieren en la cabecera que los identifica sin ambigüedad
 *      ("Nombre del Lote" vs "Variedad:"/"Nombre del Productor"): dejarlos
 *      competir por contenido en vez de por nombre de archivo es lo que evita
 *      que uno se cuele como el otro.
 *
 *   2. Si nada del paso 1 reclama el archivo: Mercadona semanal, que necesita
 *      TODAS las hojas (una semana por hoja en el formato histórico) y el año
 *      que pasa el caller.
 *
 *   3. Si tampoco: detección por NOMBRE de archivo (importador mensual de
 *      Comercial). Esta va la ÚLTIMA a propósito: su patrón de "archivo de
 *      método" es un nombre alfanumérico puro (LN211.xlsx, MA5KGC.xlsx...) que
 *      también matchea el nombre de un Informe LOTE real ("26051504.xlsx" —
 *      convención AAMMDDNN, solo dígitos). El contenido manda: un Informe LOTE
 *      ya se habrá reclamado a sí mismo en el paso 1 antes de llegar aquí, así
 *      que solo caen en "ventas-metodo" los archivos cuyo contenido no coincide
 *      con ningún formato conocido.
 *
 *   4. Nada de lo anterior → "desconocido".
 *
 * Caso especial del Informe LOTE con "pasada vacía" (el calibrador generó el
 * Excel pero no llegó a procesar nada: cabecera con lote válido, 0 filas de
 * clasificación): NO se reclama como match fuerte en el paso 1 — se deja
 * pendiente y se sigue probando el resto de la cadena (por si el archivo en
 * realidad es otra cosa con esa cabecera coincidiendo por azar). Si nada más
 * lo reclama, se devuelve igualmente como "informe-lote" con n=0, para que la
 * bandeja lo enseñe y lo descarte explícitamente en vez de darlo por
 * "desconocido" sin explicación.
 *
 * Cada parser de la cadena de contenido se envuelve en try/catch: un parser
 * que lance con un grid ajeno (formato inesperado) no debe tumbar la
 * clasificación, simplemente se pasa al siguiente candidato.
 */
import { parseInformeLoteRows } from "@/lib/informeLote";
import { parseInformeTamanosClases } from "@/lib/calidadReferencias";
import { parseInformeProduccionRows } from "@/lib/historicoProduccion";
import { parseInformePaletsRows } from "@/lib/historicoPalets";
import { parseEntradasBasculaRows, parseStockLotesRows } from "@/lib/entradasBascula";
import { parseRegistroCamaraExternaRows } from "@/lib/camarasExternas";
import { parseMermaCamaraRows } from "@/lib/mermaCamaraImport";
import { parseMercadonaWorkbook, type SheetRows } from "@/lib/mercadonaVentas";
import { detectVentasMensualFileKind } from "@/lib/ventasMensualImport";

export type TipoArchivoBandeja =
  | "informe-lote"
  | "informe-produccion"
  | "palets-campana"
  | "bascula-entradas"
  | "stock-lotes"
  | "camaras-externas"
  | "merma-camara"
  | "informe-productor"
  | "mercadona-semanal"
  | "ventas-lineas"
  | "ventas-metodos-catalogo"
  | "ventas-metodo"
  | "no-soportado"
  | "desconocido";

export const TIPO_BANDEJA_LABEL: Record<TipoArchivoBandeja, string> = {
  "informe-lote": "Informe LOTE (calibrador)",
  "informe-produccion": "Informe PRODUCCIÓN (campaña)",
  "palets-campana": "Histórico de palets (campaña)",
  "bascula-entradas": "Entradas de báscula",
  "stock-lotes": "Stock de lotes (báscula)",
  "camaras-externas": "Registro de cámara externa",
  "merma-camara": "Merma de cámara (manual)",
  "informe-productor": "Informe de tamaños/clase por productor",
  "mercadona-semanal": "Ventas semanales Mercadona",
  "ventas-lineas": "Ventas mensuales — líneas detalladas",
  "ventas-metodos-catalogo": "Ventas mensuales — catálogo de métodos",
  "ventas-metodo": "Ventas mensuales — archivo de método",
  "no-soportado": "No soportado",
  "desconocido": "Desconocido",
};

export interface ArchivoClasificado {
  fileName: string;
  tipo: TipoArchivoBandeja;
  /** Por qué se clasificó así (o por qué no) — SIEMPRE con texto, la UI lo enseña. */
  motivo: string;
  /** Unidades útiles detectadas (filas, semanas, registros...) para el resumen. */
  n: number;
  /** Resultado del parser correspondiente (el consumidor lo castea por tipo; evita reparsear). */
  payload?: unknown;
  /** Solo para tipo "ventas-metodo": el código del método deducido del nombre (p.ej. "LN211"). */
  codigoMetodo?: string;
}

export interface EntradaBandeja {
  fileName: string;
  /** Grids por hoja: XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null}), workbook leído con cellDates:true. null si el archivo no es un Excel legible. */
  sheets: Record<string, unknown[][]> | null;
  /** Año para el parser de Mercadona (la página pasará el año actual). */
  anio: number;
}

/** Ejecuta `fn` y traga cualquier excepción (formato ajeno al parser probado): devuelve `null` en vez de tumbar la clasificación. */
function intentar<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Nº de filas con al menos una celda no vacía (sirve de "n" aproximado cuando la clasificación es por nombre, sin parseo de contenido). */
function contarFilasNoVacias(rows: unknown[][] | undefined): number {
  if (!rows) return 0;
  return rows.filter((row) => (row ?? []).some((c) => c != null && String(c).trim() !== "")).length;
}

/**
 * Clasifica un archivo soltado en la bandeja según el contrato descrito en la
 * cabecera de este fichero. Función PURA: no hace ninguna llamada de red, solo
 * inspecciona `entrada`.
 */
export function clasificarArchivoBandeja(entrada: EntradaBandeja): ArchivoClasificado {
  const { fileName, sheets, anio } = entrada;

  // ─── 0. Extensión ──────────────────────────────────────────────────────────
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  const ext = extMatch ? extMatch[1].toLowerCase() : "";

  if (ext === "doc" || ext === "docx" || ext === "txt") {
    return {
      fileName,
      tipo: "no-soportado",
      n: 0,
      motivo: "Los diarios de calidad se importan desde Calidad sobre su lote (el .doc antiguo no tiene parser).",
    };
  }
  if (sheets === null) {
    return {
      fileName,
      tipo: "no-soportado",
      n: 0,
      motivo: "No se pudo leer el archivo como Excel (¿está corrupto o no es realmente un .xlsx/.xls?).",
    };
  }
  if (ext !== "xlsx" && ext !== "xls") {
    return {
      fileName,
      tipo: "no-soportado",
      n: 0,
      motivo: `Extensión ".${ext || "?"}" no soportada: la bandeja solo importa Excel (.xlsx/.xls).`,
    };
  }

  const primeraClave = Object.keys(sheets)[0];
  const primeraHoja: unknown[][] = primeraClave ? sheets[primeraClave] : [];

  // ─── 1. Contenido de la primera hoja, cadena de parsers de detalle ─────────

  // 1a. Informe LOTE (calibrador, una pasada de un lote). Ver cabecera: un
  // informe no-null con clasificación vacía NO se reclama aún — se deja
  // pendiente por si algo más abajo en la cadena reclama el archivo primero.
  let pendienteLoteVacio: ArchivoClasificado | null = null;
  const resLote = intentar(() => parseInformeLoteRows(primeraHoja));
  if (resLote && resLote.informe) {
    const inf = resLote.informe;
    if (inf.clasificacion.length > 0 && inf.kgTotal > 0) {
      return {
        fileName,
        tipo: "informe-lote",
        n: inf.clasificacion.length,
        motivo: `Informe LOTE del calibrador: lote ${inf.loteCodigoNormalizado ?? inf.loteCodigo}${inf.productorNombre ? ` (${inf.productorNombre})` : ""}, ${inf.clasificacion.length} filas de clasificación, ${inf.kgTotal.toFixed(1)} kg.`,
        payload: resLote,
      };
    }
    pendienteLoteVacio = {
      fileName,
      tipo: "informe-lote",
      n: 0,
      motivo: "Informe LOTE con 0 filas de clasificación (pasada vacía): se descartará",
      payload: resLote,
    };
  }

  // 1b. Informe de tamaños/clase por PRODUCTOR (calibrador, varias variedades).
  const resProductor = intentar(() => parseInformeTamanosClases(primeraHoja));
  if (resProductor && resProductor.productor && resProductor.variedades.length > 0) {
    return {
      fileName,
      tipo: "informe-productor",
      n: resProductor.variedades.length,
      motivo: `Informe de tamaños/clase por productor: ${resProductor.productor}, ${resProductor.variedades.length} variedad(es).`,
      payload: resProductor,
    };
  }

  // 1c. Informe PRODUCCIÓN (toda la campaña, una fila por pasada de lote).
  const resProduccion = intentar(() => parseInformeProduccionRows(primeraHoja));
  if (resProduccion && resProduccion.filas.length > 0) {
    return {
      fileName,
      tipo: "informe-produccion",
      n: resProduccion.filas.length,
      motivo: `Informe PRODUCCIÓN del calibrador: ${resProduccion.filas.length} filas (pasadas de lote) de toda la campaña.`,
      payload: resProduccion,
    };
  }

  // 1d. Histórico de PALETS (toda la campaña, una fila por palet).
  const resPalets = intentar(() => parseInformePaletsRows(primeraHoja));
  if (resPalets && resPalets.filas.length > 0) {
    return {
      fileName,
      tipo: "palets-campana",
      n: resPalets.filas.length,
      motivo: `Histórico de palets: ${resPalets.filas.length} filas de la campaña.`,
      payload: resPalets,
    };
  }

  // 1e. Entradas de BÁSCULA (una fila por entrada de camión).
  const resBascula = intentar(() => parseEntradasBasculaRows(primeraHoja));
  if (resBascula && resBascula.entradas.length > 0) {
    return {
      fileName,
      tipo: "bascula-entradas",
      n: resBascula.entradas.length,
      motivo: `Export de báscula: ${resBascula.entradas.length} entradas de fruta.`,
      payload: resBascula,
    };
  }

  // 1f. Informe de STOCK de lotes ("APROVECHAMIENTO STOCK LOTES"): sirve para
  // DOS cosas (sembrar el stock inicial de arranque o conciliar la cámara
  // contra lo que ya hay en la app); la bandeja hace el SEMBRADO por defecto.
  const resStock = intentar(() => parseStockLotesRows(primeraHoja));
  if (resStock && resStock.lotes.length > 0) {
    return {
      fileName,
      tipo: "stock-lotes",
      n: resStock.lotes.length,
      motivo: `Informe de stock de lotes: ${resStock.lotes.length} lotes con existencias. Este archivo sirve para dos cosas (sembrar el stock inicial o conciliar la cámara); la bandeja lo usa para SEMBRAR.`,
      payload: resStock,
    };
  }

  // 1g. Registro de CÁMARA EXTERNA (Guadex/Zamexfruit/...).
  const resCamaras = intentar(() => parseRegistroCamaraExternaRows(primeraHoja));
  if (resCamaras && resCamaras.registros.length > 0) {
    return {
      fileName,
      tipo: "camaras-externas",
      n: resCamaras.registros.length,
      motivo: `Registro de cámara externa${resCamaras.procedencia ? ` (${resCamaras.procedencia})` : ""}: ${resCamaras.registros.length} camiones.`,
      payload: resCamaras,
    };
  }

  // 1h. MERMA de cámara (registro manual "Merma fruta camaras.xlsx").
  const resMerma = intentar(() => parseMermaCamaraRows(primeraHoja));
  if (resMerma && resMerma.registros.length > 0) {
    return {
      fileName,
      tipo: "merma-camara",
      n: resMerma.registros.length,
      motivo: `Registro de merma de cámara: ${resMerma.registros.length} camiones con peso inicial/final.`,
      payload: resMerma,
    };
  }

  // Ninguno de los parsers de detalle reclamó el archivo con fuerza: si el
  // Informe LOTE dejó una "pasada vacía" pendiente, es lo más parecido a un
  // match real (cabecera de lote válida) — se devuelve ahora.
  if (pendienteLoteVacio) return pendienteLoteVacio;

  // ─── 2. Mercadona semanal (necesita TODAS las hojas + el año) ──────────────
  const resMercadona = intentar(() => parseMercadonaWorkbook(sheets as Record<string, SheetRows>, anio, fileName));
  if (resMercadona && resMercadona.semanas.length > 0) {
    return {
      fileName,
      tipo: "mercadona-semanal",
      n: resMercadona.semanas.length,
      motivo: `Ventas Mercadona: ${resMercadona.semanas.length} semana(s) detectada(s) en el libro.`,
      payload: resMercadona,
    };
  }

  // ─── 3. Ventas mensuales (Comercial), detección por NOMBRE de archivo ──────
  // A propósito la última: su patrón "archivo de método" (nombre alfanumérico
  // puro) también matchea el nombre de un Informe LOTE ("26051504.xlsx"), pero
  // esos ya habrán ganado por CONTENIDO en el paso 1 antes de llegar aquí.
  const kind = detectVentasMensualFileKind(fileName);
  const nHoja = contarFilasNoVacias(primeraHoja);
  if (kind.kind === "lineas") {
    return {
      fileName,
      tipo: "ventas-lineas",
      n: nHoja,
      motivo: "Ventas mensuales: fichero de líneas detalladas (fecha + cliente + artículo), identificado por su nombre.",
      payload: primeraHoja,
    };
  }
  if (kind.kind === "metodos-catalogo") {
    return {
      fileName,
      tipo: "ventas-metodos-catalogo",
      n: nHoja,
      motivo: "Ventas mensuales: catálogo de métodos de confección, identificado por su nombre.",
      payload: primeraHoja,
    };
  }
  if (kind.kind === "metodo") {
    return {
      fileName,
      tipo: "ventas-metodo",
      n: nHoja,
      motivo: `Ventas mensuales: archivo de método "${kind.codigo}" (referencias confeccionadas por ese método), identificado por su nombre.`,
      payload: primeraHoja,
      codigoMetodo: kind.codigo,
    };
  }

  // ─── 4. Nada coincide ───────────────────────────────────────────────────────
  return {
    fileName,
    tipo: "desconocido",
    n: 0,
    motivo: "No coincide con ningún formato conocido (Informe LOTE/PRODUCCIÓN, palets, báscula, stock, cámaras, merma, productor, Mercadona o ventas mensuales).",
  };
}
