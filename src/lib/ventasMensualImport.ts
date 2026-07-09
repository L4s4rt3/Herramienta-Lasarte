// src/lib/ventasMensualImport.ts
// Importador mensual de ventas (Comercial): reparte automaticamente los
// ficheros que exporta el ERP cada mes entre Categoria primera, Categoria
// segunda y Mercadona, y descarta lo que no es producto (europalets, cajas,
// portes...). Pensado para alimentar directamente useVentasCategoria(...).importWorkbook
// con el resultado de las categorias primera y segunda; Mercadona y los
// excluidos se muestran en el preview pero no se importan aqui.
//
// Ficheros de entrada (identificados por NOMBRE de fichero, ver
// detectVentasMensualFileKind):
//  - "...lineas detallado....xlsx"        -> base de lineas (fecha+cliente+articulo)
//  - "...metodos de confeccion....xlsx"   -> catalogo de metodos (fila TOTAL se ignora)
//  - "<CODIGO>.xlsx" (LN211.xlsx, ...)     -> referencias confeccionadas por ese metodo
//  - "...articulos....xlsx" / "...clientes....xlsx" -> ignorados (opcionales)
//
// Clasificacion de una referencia (ver resolverDominante): se acumulan los
// kilos de cada fichero de metodo agrupados por categoria (segun a que
// categoria pertenece el metodo de ese fichero); la categoria dominante de la
// referencia es la que suma mas kilos. Cuando hay mas de una categoria con
// kilos > 0 la referencia se expone en `ambiguas` para revision manual, pero
// SIEMPRE se clasifica igualmente por la dominante (nada se pierde en silencio).
import type { VentasCategoriaCatalogoProducto, VentasCategoriaLineaInput } from "@/lib/ventasCategoria";

export type VentasMensualCategoria = "primera" | "segunda" | "mercadona";

/**
 * Metodos de confeccion de categoria SEGUNDA. El dueño del proceso confirma
 * que este conjunto es FIJO mes a mes (no cambia salvo decision explicita):
 * que algun mes no aparezca el fichero de uno de estos codigos no importa,
 * simplemente no habra lineas de ese metodo ese mes. Se usa como valor por
 * defecto en la UI (editable, pero no hay que retocarlo cada import).
 */
export const METODOS_SEGUNDA_POR_DEFECTO = "LN211, LN314, LN210, LN560, L1020, L1511, LN551";

/** Alias explicito para el campo de texto editable en la UI. */
export const DEFAULT_SEGUNDA_CODIGOS = METODOS_SEGUNDA_POR_DEFECTO;

// Palabras/fragmentos que identifican lineas que NO son producto vendible
// (embalajes, transporte, comisiones...). Lista ampliable: normalizada sin
// acentos y en minuscula, se busca como palabra completa (o frase completa
// para las de varias palabras) dentro de "articulo + referencia".
const NO_PRODUCTO_KEYWORDS = [
  "europalet",
  "palet",
  "pale",
  "caja",
  "cajon",
  "comision",
  "transporte",
  "porte",
  "portes",
  "envase",
  "film",
  "saco",
  "malla vacia",
  "etiqueta",
  "fitosanitario",
] as const;

const NO_PRODUCTO_REGEX = NO_PRODUCTO_KEYWORDS.map((keyword) => ({
  keyword,
  regex: new RegExp(`\\b${keyword.replace(/ /g, "\\s+")}\\b`, "i"),
}));

export interface VentasMensualMetodoArchivo {
  /** Codigo de metodo, normalmente el nombre de fichero sin extension (LN211, MA5KGC...). */
  codigo: string;
  /** Filas de la hoja (incluyendo cabecera), tal como las devuelve XLSX.utils.sheet_to_json con header:1. */
  rows: unknown[][];
}

export interface VentasMensualInput {
  /** Filas de la hoja "...lineas detallado....xlsx". */
  lineasRows: unknown[][];
  /** Filas de la hoja "...metodos de confeccion....xlsx". */
  metodosCatalogoRows: unknown[][];
  /** Un fichero por cada codigo de metodo (LN211.xlsx, L1020.xlsx, MA5KGC.xlsx...). */
  metodoArchivos: VentasMensualMetodoArchivo[];
  /** Texto editable por el usuario con los codigos de categoria segunda, separados por comas. */
  segundaCodigos: string;
}

export interface VentasMensualExcluida {
  linea: VentasCategoriaLineaInput;
  motivo: string;
}

export interface VentasMensualAmbiguaCategoria {
  categoria: VentasMensualCategoria;
  kilos: number;
}

export interface VentasMensualAmbigua {
  referencia: string;
  categorias: VentasMensualAmbiguaCategoria[];
  dominante: VentasMensualCategoria;
}

export interface VentasMensualBucketTotales {
  lineas: number;
  kilos: number;
}

export interface VentasMensualClassifyResult {
  primera: VentasCategoriaLineaInput[];
  segunda: VentasCategoriaLineaInput[];
  mercadona: VentasCategoriaLineaInput[];
  excluidos: VentasMensualExcluida[];
  ambiguas: VentasMensualAmbigua[];
  catalogoPrimera: VentasCategoriaCatalogoProducto[];
  catalogoSegunda: VentasCategoriaCatalogoProducto[];
  totales: {
    primera: VentasMensualBucketTotales;
    segunda: VentasMensualBucketTotales;
    mercadona: VentasMensualBucketTotales;
    excluidos: VentasMensualBucketTotales;
  };
}

export type VentasMensualFileKind =
  | { kind: "lineas" }
  | { kind: "metodos-catalogo" }
  | { kind: "metodo"; codigo: string }
  | { kind: "ignorado" };

/**
 * Identifica que tipo de fichero es a partir de su nombre (sin depender del
 * contenido, para poder repartir los ficheros subidos antes de parsearlos).
 */
export function detectVentasMensualFileKind(filename: string): VentasMensualFileKind {
  const base = filename.replace(/\.[^./\\]+$/, "").trim();
  const normalized = normalizeTexto(base);

  if (normalized.includes("linea") && normalized.includes("detall")) {
    return { kind: "lineas" };
  }
  if (normalized.includes("metodo") && (normalized.includes("confeccion") || normalized.includes("confecc"))) {
    return { kind: "metodos-catalogo" };
  }
  if (normalized.includes("articulo") || normalized.includes("cliente")) {
    return { kind: "ignorado" };
  }
  if (/^[a-z0-9]+$/i.test(base)) {
    return { kind: "metodo", codigo: normalizeCodigo(base) };
  }
  return { kind: "ignorado" };
}

/** Convierte el texto editable de codigos de segunda en un set normalizado (mayusculas, sin espacios). */
export function parseSegundaCodigos(text: string): Set<string> {
  return new Set(
    text
      .split(",")
      .map((part) => normalizeCodigo(part))
      .filter((code) => code.length > 0),
  );
}

/** Categoria a la que pertenece un metodo: MA* siempre es Mercadona, luego la lista de segunda, el resto primera. */
export function categoriaDeMetodo(codigo: string, segundaCodigos: Set<string>): VentasMensualCategoria {
  const code = normalizeCodigo(codigo);
  if (code.startsWith("MA")) return "mercadona";
  if (segundaCodigos.has(code)) return "segunda";
  return "primera";
}

export function classifyVentasMensual(input: VentasMensualInput): VentasMensualClassifyResult {
  const segundaCodigos = parseSegundaCodigos(input.segundaCodigos);
  const catalogoRows = parseMetodosCatalogoRows(input.metodosCatalogoRows);

  const referenciaAcumulado = new Map<string, RefAcumulado>();
  input.metodoArchivos.forEach((archivo) => {
    const codigo = normalizeCodigo(archivo.codigo);
    const categoria = categoriaDeMetodo(codigo, segundaCodigos);
    parseMetodoArchivoRows(archivo.rows).forEach((fila) => {
      acumularReferencia(referenciaAcumulado, fila.referencia, codigo, categoria, fila.kilos);
    });
  });

  const referenciaInfo = new Map<string, { categoria: VentasMensualCategoria; metodo: string | null }>();
  const ambiguas: VentasMensualAmbigua[] = [];
  referenciaAcumulado.forEach((acumulado, referencia) => {
    const resuelto = resolverDominante(acumulado);
    referenciaInfo.set(referencia, { categoria: resuelto.categoria, metodo: resuelto.metodo });
    if (resuelto.categorias.length > 1) {
      ambiguas.push({ referencia, categorias: resuelto.categorias, dominante: resuelto.categoria });
    }
  });
  ambiguas.sort((a, b) => (b.categorias[0]?.kilos ?? 0) - (a.categorias[0]?.kilos ?? 0));

  const primera: VentasCategoriaLineaInput[] = [];
  const segunda: VentasCategoriaLineaInput[] = [];
  const mercadona: VentasCategoriaLineaInput[] = [];
  const excluidos: VentasMensualExcluida[] = [];

  parseLineasDetalladoRows(input.lineasRows).forEach((fila) => {
    const info = fila.referencia ? referenciaInfo.get(fila.referencia) : undefined;
    const lineaInput: VentasCategoriaLineaInput = {
      fecha: fila.fecha,
      cliente_codigo: fila.clienteCodigo,
      cliente_nombre: fila.clienteNombre,
      referencia: fila.referencia || null,
      articulo: fila.articulo,
      metodo_producto: info?.metodo ?? null,
      kilos: fila.kilos,
      pvp: fila.pvp,
      base_iva: fila.baseIva,
    };

    const motivo = motivoNoProducto(fila.articulo, fila.referencia, fila.kilos);
    if (motivo) {
      excluidos.push({ linea: lineaInput, motivo });
      return;
    }

    // Regla del dueño: lo que no es Mercadona ni categoria segunda dominante
    // (incluidas las referencias sin ningun fichero de metodo) va a primera.
    const categoria: VentasMensualCategoria = info?.categoria ?? "primera";
    if (categoria === "mercadona") mercadona.push(lineaInput);
    else if (categoria === "segunda") segunda.push(lineaInput);
    else primera.push(lineaInput);
  });

  const catalogoPrimera = catalogoRows.filter((row) => categoriaDeMetodo(row.metodo, segundaCodigos) === "primera");
  const catalogoSegunda = catalogoRows.filter((row) => categoriaDeMetodo(row.metodo, segundaCodigos) === "segunda");

  return {
    primera,
    segunda,
    mercadona,
    excluidos,
    ambiguas,
    catalogoPrimera,
    catalogoSegunda,
    totales: {
      primera: bucketTotales(primera),
      segunda: bucketTotales(segunda),
      mercadona: bucketTotales(mercadona),
      excluidos: { lineas: excluidos.length, kilos: sumKilos(excluidos.map((e) => e.linea)) },
    },
  };
}

// ─── Motivo de exclusion (no-producto) ────────────────────────────────────

function motivoNoProducto(articulo: string, referencia: string, kilos: number): string | null {
  if (!(kilos > 0)) return "Kilos no positivos";
  const texto = normalizeTexto(`${articulo} ${referencia}`);
  for (const { keyword, regex } of NO_PRODUCTO_REGEX) {
    if (regex.test(texto)) return `Contiene "${keyword}"`;
  }
  return null;
}

// ─── Acumulacion y resolucion de dominante por referencia ─────────────────

interface RefAcumulado {
  porCategoria: Map<VentasMensualCategoria, number>;
  porMetodo: Map<string, number>;
}

function acumularReferencia(
  map: Map<string, RefAcumulado>,
  referencia: string,
  metodo: string,
  categoria: VentasMensualCategoria,
  kilos: number,
): void {
  if (!referencia || !(kilos > 0)) return;
  const entry = map.get(referencia) ?? { porCategoria: new Map(), porMetodo: new Map() };
  entry.porCategoria.set(categoria, (entry.porCategoria.get(categoria) ?? 0) + kilos);
  entry.porMetodo.set(metodo, (entry.porMetodo.get(metodo) ?? 0) + kilos);
  map.set(referencia, entry);
}

function resolverDominante(acumulado: RefAcumulado): {
  categoria: VentasMensualCategoria;
  metodo: string | null;
  categorias: VentasMensualAmbiguaCategoria[];
} {
  const categorias = Array.from(acumulado.porCategoria.entries())
    .map(([categoria, kilos]) => ({ categoria, kilos }))
    .sort((a, b) => b.kilos - a.kilos);
  const metodos = Array.from(acumulado.porMetodo.entries()).sort((a, b) => b[1] - a[1]);

  return {
    categoria: categorias[0]?.categoria ?? "primera",
    metodo: metodos[0]?.[0] ?? null,
    categorias,
  };
}

// ─── Parseo de hojas ───────────────────────────────────────────────────────

interface LineaDetalladaFila {
  fecha: string;
  clienteCodigo: string;
  clienteNombre: string;
  referencia: string;
  articulo: string;
  kilos: number;
  pvp: number;
  baseIva: number;
}

function parseLineasDetalladoRows(rows: unknown[][]): LineaDetalladaFila[] {
  const headerIndex = findHeaderIndex(rows, ["fecha", "cliente", "articulo", "kilos"]);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex].map(normalizeHeader);
  const col = columnFinder(header);
  const fechaCol = col(["fecha"]);
  const clienteCol = col(["cliente"]);
  const clienteNombreCol = col(["denominacion-social", "denominacion"]);
  const referenciaCol = col(["referencia"]);
  const articuloCol = col(["articulo"]);
  const kilosCol = col(["kilos"]);
  const pvpCol = col(["pvp"]);
  const baseIvaCol = col(["base-iva"]);

  if (fechaCol == null || clienteCol == null || clienteNombreCol == null || articuloCol == null || kilosCol == null || baseIvaCol == null) {
    return [];
  }

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const fecha = parseFechaLineas(row[fechaCol]);
    const clienteCodigo = cellText(row[clienteCol]);
    const clienteNombre = cellText(row[clienteNombreCol]);
    const articulo = cellText(row[articuloCol]);

    if (!fecha || !clienteCodigo || !articulo) return [];

    return [{
      fecha,
      clienteCodigo,
      clienteNombre,
      referencia: referenciaCol == null ? "" : cellText(row[referenciaCol]),
      articulo,
      kilos: parseNumeroEs(row[kilosCol]),
      pvp: pvpCol == null ? 0 : parseNumeroEs(row[pvpCol]),
      baseIva: parseNumeroEs(row[baseIvaCol]),
    }];
  });
}

function parseMetodosCatalogoRows(rows: unknown[][]): VentasCategoriaCatalogoProducto[] {
  const headerIndex = findHeaderIndex(rows, ["metodo", "descripcion", "kilos"]);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex].map(normalizeHeader);
  const col = columnFinder(header);
  const metodoCol = col(["metodo"]);
  const descripcionCol = col(["descripcion"]);
  const lineasCol = col(["lineas"]);
  const kilosCol = col(["kilos"]);
  const baseIvaCol = col(["base-iva"]);

  if (metodoCol == null || kilosCol == null) return [];

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const metodo = cellText(row[metodoCol]);
    // La fila TOTAL del fichero de metodos de confeccion viene con el metodo vacio.
    if (!metodo || normalizeTexto(metodo) === "total") return [];

    const kilos = parseNumeroEs(row[kilosCol]);
    if (!(kilos > 0)) return [];

    return [{
      metodo,
      descripcion: descripcionCol == null ? "" : cellText(row[descripcionCol]),
      lineas: lineasCol == null ? 0 : Math.round(parseNumeroEs(row[lineasCol])),
      kilos,
      base_iva: baseIvaCol == null ? 0 : parseNumeroEs(row[baseIvaCol]),
    }];
  });
}

interface MetodoArchivoFila {
  referencia: string;
  kilos: number;
}

function parseMetodoArchivoRows(rows: unknown[][]): MetodoArchivoFila[] {
  const headerIndex = findHeaderIndex(rows, ["referencia", "articulo", "kilos"]);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex].map(normalizeHeader);
  const col = columnFinder(header);
  const referenciaCol = col(["referencia"]);
  const kilosCol = col(["kilos"]);

  if (referenciaCol == null || kilosCol == null) return [];

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const referencia = cellText(row[referenciaCol]);
    const kilos = parseNumeroEs(row[kilosCol]);
    if (!referencia || !(kilos > 0)) return [];
    return [{ referencia, kilos }];
  });
}

// ─── Utilidades numericas / fechas / texto ─────────────────────────────────

function bucketTotales(lineas: VentasCategoriaLineaInput[]): VentasMensualBucketTotales {
  return { lineas: lineas.length, kilos: sumKilos(lineas) };
}

function sumKilos(lineas: Array<{ kilos: number | null | undefined }>): number {
  return lineas.reduce((total, linea) => total + (Number(linea.kilos) || 0), 0);
}

function normalizeCodigo(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeTexto(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeHeader(value: unknown): string {
  return cellText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cellText(value: unknown): string {
  return String(value ?? "").trim();
}

function findHeaderIndex(rows: unknown[][], requiredHeaders: string[]): number {
  return rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return requiredHeaders.every((required) => headers.includes(normalizeHeader(required)));
  });
}

function columnFinder(header: string[]) {
  return (names: string[]): number | null => {
    const normalizedNames = names.map(normalizeHeader);
    const index = header.findIndex((value) => normalizedNames.includes(value));
    return index >= 0 ? index : null;
  };
}

function parseNumeroEs(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const text = cellText(value).replace(/€/g, "").replace(/\s/g, "");
  if (!text) return 0;

  const commaIndex = text.lastIndexOf(",");
  const dotIndex = text.lastIndexOf(".");
  let normalized = text;

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    const decimals = text.length - commaIndex - 1;
    normalized = decimals === 3 ? text.replace(/,/g, "") : text.replace(",", ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFechaLineas(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  const text = cellText(value);
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`;

  // El fichero de lineas detallado usa siempre formato español dia/mes/año.
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!slash) return null;

  const day = Number(slash[1]);
  const month = Number(slash[2]);
  const rawYear = Number(slash[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
