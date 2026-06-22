export interface VentasCategoriaAjuste {
  comision_pct?: number | null;
  comision_cent_kg?: number | null;
  transporte_pct?: number | null;
  transporte_cent_kg?: number | null;
}

export interface VentasCategoriaLineaInput {
  fecha: string;
  cliente_codigo: string;
  cliente_nombre: string;
  referencia?: string | null;
  articulo: string;
  metodo_producto?: string | null;
  kilos: number | null | undefined;
  pvp?: number | null;
  base_iva: number | null | undefined;
}

export interface VentasCategoriaLinea extends VentasCategoriaLineaInput {
  campana: string;
  mes: string;
  kilos: number;
  pvp: number;
  base_iva: number;
  pm_venta: number;
}

export interface VentasCategoriaCatalogoProducto {
  metodo: string;
  descripcion: string;
  lineas: number;
  kilos: number;
  base_iva: number;
}

export interface VentasCategoriaResumen {
  kilos: number;
  base_iva: number;
  pm_venta: number;
  clientes: number;
  productos: number;
  articulos: number;
}

export interface VentasCategoriaAggregateRow {
  key: string;
  kilos: number;
  base_iva: number;
  pm_venta: number;
  lineas: number;
}

export interface VentasCategoriaClienteRow extends VentasCategoriaAggregateRow {
  cliente_codigo: string;
  cliente_nombre: string;
}

export interface VentasCategoriaProductoRow extends VentasCategoriaAggregateRow {
  metodo_producto: string;
}

export interface VentasCategoriaArticuloRow extends VentasCategoriaAggregateRow {
  articulo: string;
  referencia: string | null;
}

export interface VentasCategoriaMensualClienteRow extends VentasCategoriaClienteRow {
  mes: string;
}

export interface VentasCategoriaMensualProductoRow extends VentasCategoriaProductoRow {
  mes: string;
}

export interface VentasCategoriaAggregation {
  resumen: VentasCategoriaResumen;
  clientes: VentasCategoriaClienteRow[];
  productos: VentasCategoriaProductoRow[];
  articulos: VentasCategoriaArticuloRow[];
  mensualCliente: VentasCategoriaMensualClienteRow[];
  mensualProducto: VentasCategoriaMensualProductoRow[];
}

export interface ValidateVentasCategoriaImportInput {
  lineas: VentasCategoriaLinea[];
  catalogo: VentasCategoriaCatalogoProducto[];
  toleranceKg?: number;
  toleranceBaseIva?: number;
}

export interface VentasCategoriaImportValidation {
  status: "ok" | "warning";
  lineasDetectadas: number;
  clientesUnicos: number;
  productosCatalogo: number;
  kilosLineas: number;
  kilosCatalogo: number;
  baseIvaLineas: number;
  baseIvaCatalogo: number;
  diferenciaKilos: number;
  diferenciaBaseIva: number;
  articulosSinClasificar: number;
  issues: string[];
}

export type VentasCategoriaWorkbookRows = Record<string, unknown[][]>;

export interface ParseVentasCategoriaWorkbookResult {
  lineas: VentasCategoriaLinea[];
  catalogo: VentasCategoriaCatalogoProducto[];
  validation: VentasCategoriaImportValidation;
}

export interface VentasCategoriaFilterSourceRow {
  campana?: string | null;
  mes?: string | null;
  cliente_codigo?: string | null;
  cliente_nombre?: string | null;
  metodo_producto?: string | null;
  kilos?: number | null;
}

export interface VentasCategoriaClienteFilterOption {
  codigo: string;
  nombre: string;
  kilos: number;
}

export interface VentasCategoriaFilterOptions {
  lineas: number;
  campanas: string[];
  meses: string[];
  clientes: VentasCategoriaClienteFilterOption[];
  metodos: string[];
}

export function calcularCampanaVentas(fecha: string): string {
  const { year, month } = parseDateParts(fecha);
  const startYear = month >= 9 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}${String(endYear).slice(-2)}`;
}

export function calcularMesVentas(fecha: string): string {
  const { year, month } = parseDateParts(fecha);
  return `${year}-${pad2(month)}`;
}

export function calcularPmVenta(baseIva: number | null | undefined, kilos: number | null | undefined): number {
  const kg = finiteOrZero(kilos);
  if (kg <= 0) return 0;
  return finiteOrZero(baseIva) / kg;
}

export function calcularPrecioReal(pmVenta: number | null | undefined, ajuste: VentasCategoriaAjuste = {}): number {
  const pm = finiteOrZero(pmVenta);
  const comisionPct = pm * (finiteOrZero(ajuste.comision_pct) / 100);
  const transportePct = pm * (finiteOrZero(ajuste.transporte_pct) / 100);
  const comisionCentKg = finiteOrZero(ajuste.comision_cent_kg) / 100;
  const transporteCentKg = finiteOrZero(ajuste.transporte_cent_kg) / 100;
  return Math.max(0, pm - comisionPct - transportePct - comisionCentKg - transporteCentKg);
}

export function normalizeVentasCategoriaLinea(input: VentasCategoriaLineaInput): VentasCategoriaLinea {
  const kilos = finiteOrZero(input.kilos);
  const baseIva = finiteOrZero(input.base_iva);
  return {
    ...input,
    referencia: input.referencia?.trim() || null,
    metodo_producto: input.metodo_producto?.trim() || null,
    kilos,
    pvp: finiteOrZero(input.pvp),
    base_iva: baseIva,
    campana: calcularCampanaVentas(input.fecha),
    mes: calcularMesVentas(input.fecha),
    pm_venta: calcularPmVenta(baseIva, kilos),
  };
}

export function aggregateVentasCategoria(lineas: VentasCategoriaLinea[]): VentasCategoriaAggregation {
  const resumen = lineas.reduce(
    (acc, linea) => {
      acc.kilos += linea.kilos;
      acc.base_iva += linea.base_iva;
      acc.clientesSet.add(linea.cliente_codigo);
      acc.productosSet.add(linea.metodo_producto || "Sin clasificar");
      acc.articulosSet.add(articleKey(linea));
      return acc;
    },
    {
      kilos: 0,
      base_iva: 0,
      clientesSet: new Set<string>(),
      productosSet: new Set<string>(),
      articulosSet: new Set<string>(),
    },
  );

  return {
    resumen: {
      kilos: resumen.kilos,
      base_iva: resumen.base_iva,
      pm_venta: calcularPmVenta(resumen.base_iva, resumen.kilos),
      clientes: resumen.clientesSet.size,
      productos: resumen.productosSet.size,
      articulos: resumen.articulosSet.size,
    },
    clientes: sortByKilosDesc(Array.from(groupLines(lineas, clientKey, buildClientRow).values())),
    productos: sortByKilosDesc(Array.from(groupLines(lineas, productKey, buildProductRow).values())),
    articulos: sortByKilosDesc(Array.from(groupLines(lineas, articleKey, buildArticleRow).values())),
    mensualCliente: sortByMonthAndKilos(Array.from(groupLines(lineas, monthlyClientKey, buildMonthlyClientRow).values())),
    mensualProducto: sortByMonthAndKilos(Array.from(groupLines(lineas, monthlyProductKey, buildMonthlyProductRow).values())),
  };
}

export function validateVentasCategoriaImport(input: ValidateVentasCategoriaImportInput): VentasCategoriaImportValidation {
  const toleranceKg = input.toleranceKg ?? 0.01;
  const toleranceBaseIva = input.toleranceBaseIva ?? 0.01;
  const kilosLineas = sum(input.lineas, (row) => row.kilos);
  const kilosCatalogo = sum(input.catalogo, (row) => finiteOrZero(row.kilos));
  const baseIvaLineas = sum(input.lineas, (row) => row.base_iva);
  const baseIvaCatalogo = sum(input.catalogo, (row) => finiteOrZero(row.base_iva));
  const diferenciaKilos = roundNumber(kilosLineas - kilosCatalogo);
  const diferenciaBaseIva = roundNumber(baseIvaLineas - baseIvaCatalogo);
  const articulosSinClasificar = input.lineas.filter((row) => !row.metodo_producto).length;
  const clientesUnicos = new Set(input.lineas.map((row) => row.cliente_codigo)).size;
  const issues: string[] = [];

  if (Math.abs(diferenciaKilos) > toleranceKg) {
    issues.push(`Diferencia de kilos entre lineas y catalogo: ${diferenciaKilos}`);
  }

  if (Math.abs(diferenciaBaseIva) > toleranceBaseIva) {
    issues.push(`Diferencia de base IVA entre lineas y catalogo: ${diferenciaBaseIva}`);
  }

  if (articulosSinClasificar > 0) {
    issues.push(`${articulosSinClasificar} lineas sin metodo de catalogo clasificado`);
  }

  if (input.lineas.length === 0) {
    issues.push("No se han detectado lineas diarias importables");
  }

  return {
    status: issues.length === 0 ? "ok" : "warning",
    lineasDetectadas: input.lineas.length,
    clientesUnicos,
    productosCatalogo: input.catalogo.length,
    kilosLineas: roundNumber(kilosLineas),
    kilosCatalogo: roundNumber(kilosCatalogo),
    baseIvaLineas: roundNumber(baseIvaLineas),
    baseIvaCatalogo: roundNumber(baseIvaCatalogo),
    diferenciaKilos,
    diferenciaBaseIva,
    articulosSinClasificar,
    issues,
  };
}

export function parseVentasCategoriaWorkbookRows(sheets: VentasCategoriaWorkbookRows): ParseVentasCategoriaWorkbookResult {
  const baseSheet = findSheetRows(sheets, ["Base diaria", "cliente y producto", "lineas"]);
  const catalogSheet = findSheetRows(sheets, ["Productos catalogo", "Top productos catalogo", "productos"]);
  const lineas = parseBaseDiariaRows(baseSheet);
  const catalogo = parseCatalogoRows(catalogSheet);

  return {
    lineas,
    catalogo,
    validation: validateVentasCategoriaImport({ lineas, catalogo }),
  };
}

export function buildVentasCategoriaFilterOptions(rows: VentasCategoriaFilterSourceRow[]): VentasCategoriaFilterOptions {
  const campanas = new Set<string>();
  const meses = new Set<string>();
  const metodos = new Set<string>();
  const clientes = new Map<string, VentasCategoriaClienteFilterOption>();

  rows.forEach((row) => {
    const campana = cellText(row.campana);
    const mes = cellText(row.mes);
    const metodo = cellText(row.metodo_producto);
    const codigo = cellText(row.cliente_codigo);
    const nombre = cellText(row.cliente_nombre);

    if (campana) campanas.add(campana);
    if (mes) meses.add(mes);
    if (metodo) metodos.add(metodo);
    if (codigo) {
      const current = clientes.get(codigo) ?? { codigo, nombre, kilos: 0 };
      current.nombre = current.nombre || nombre;
      current.kilos += finiteOrZero(row.kilos);
      clientes.set(codigo, current);
    }
  });

  return {
    lineas: rows.length,
    campanas: Array.from(campanas).sort((a, b) => b.localeCompare(a)),
    meses: Array.from(meses).sort((a, b) => b.localeCompare(a)),
    clientes: Array.from(clientes.values()).sort((a, b) => b.kilos - a.kilos || a.nombre.localeCompare(b.nombre)),
    metodos: Array.from(metodos).sort((a, b) => a.localeCompare(b)),
  };
}

function parseBaseDiariaRows(rows: unknown[][]): VentasCategoriaLinea[] {
  const headerIndex = findHeaderIndex(rows, ["fecha", "cliente", "articulo", "kilos"]);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex].map(normalizeHeader);
  const col = columnFinder(header);
  const fechaCol = col(["fecha"]);
  const campanaCol = col(["campana"]);
  const mesCol = col(["mes-etiqueta", "mes"]);
  const clienteCol = col(["cliente"]);
  const clienteNombreCol = col(["cliente-nombre", "denominacion-social"]);
  const referenciaCol = col(["referencia"]);
  const articuloCol = col(["articulo"]);
  const metodoCol = col(["grupo-producto", "metodo-producto", "metodo"]);
  const kilosCol = col(["kilos"]);
  const pvpCol = col(["pvp"]);
  const baseIvaCol = col(["base-iva-bruto", "base-iva"]);

  if (fechaCol == null || clienteCol == null || clienteNombreCol == null || articuloCol == null || kilosCol == null || baseIvaCol == null) {
    return [];
  }

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const mes = mesCol == null ? "" : cellText(row[mesCol]);
    const fecha = parseVentasDate(row[fechaCol], mes);
    const clienteCodigo = cellText(row[clienteCol]);
    const clienteNombre = cellText(row[clienteNombreCol]);
    const articulo = cellText(row[articuloCol]);
    const kilos = parseVentasNumber(row[kilosCol]);
    const baseIva = parseVentasNumber(row[baseIvaCol]);

    if (!fecha || !clienteCodigo || !clienteNombre || !articulo || kilos <= 0) {
      return [];
    }

    const normalized = normalizeVentasCategoriaLinea({
      fecha,
      cliente_codigo: clienteCodigo,
      cliente_nombre: clienteNombre,
      referencia: referenciaCol == null ? null : cellText(row[referenciaCol]),
      articulo,
      metodo_producto: metodoFromGroup(cellTextAt(row, metodoCol)),
      kilos,
      pvp: parseVentasNumber(cellTextAt(row, pvpCol)),
      base_iva: baseIva,
    });

    if (campanaCol != null && cellText(row[campanaCol])) {
      normalized.campana = cellText(row[campanaCol]);
    }
    if (mes) {
      normalized.mes = mes;
    }

    return [normalized];
  });
}

function parseCatalogoRows(rows: unknown[][]): VentasCategoriaCatalogoProducto[] {
  const headerIndex = findHeaderIndex(rows, ["metodo", "descripcion", "kilos", "base-iva"]);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex].map(normalizeHeader);
  const col = columnFinder(header);
  const metodoCol = col(["metodo"]);
  const descripcionCol = col(["descripcion"]);
  const lineasCol = col(["lineas"]);
  const kilosCol = col(["kilos"]);
  const baseIvaCol = col(["base-iva"]);

  if (metodoCol == null || descripcionCol == null || kilosCol == null || baseIvaCol == null) {
    return [];
  }

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const metodo = cellText(row[metodoCol]);
    const descripcion = cellText(row[descripcionCol]);
    const kilos = parseVentasNumber(row[kilosCol]);

    if (!metodo || kilos <= 0) {
      return [];
    }

    return [{
      metodo,
      descripcion,
      lineas: lineasCol == null ? 0 : Math.round(parseVentasNumber(row[lineasCol])),
      kilos,
      base_iva: parseVentasNumber(row[baseIvaCol]),
    }];
  });
}

function groupLines<T extends VentasCategoriaAggregateRow>(
  lineas: VentasCategoriaLinea[],
  getKey: (linea: VentasCategoriaLinea) => string,
  buildRow: (linea: VentasCategoriaLinea, key: string) => T,
): Map<string, T> {
  const grouped = new Map<string, T>();
  lineas.forEach((linea) => {
    const key = getKey(linea);
    const row = grouped.get(key) ?? buildRow(linea, key);
    row.kilos += linea.kilos;
    row.base_iva += linea.base_iva;
    row.lineas += 1;
    row.pm_venta = calcularPmVenta(row.base_iva, row.kilos);
    grouped.set(key, row);
  });
  return grouped;
}

function buildClientRow(linea: VentasCategoriaLinea, key: string): VentasCategoriaClienteRow {
  return {
    key,
    cliente_codigo: linea.cliente_codigo,
    cliente_nombre: linea.cliente_nombre,
    kilos: 0,
    base_iva: 0,
    pm_venta: 0,
    lineas: 0,
  };
}

function buildProductRow(linea: VentasCategoriaLinea, key: string): VentasCategoriaProductoRow {
  return {
    key,
    metodo_producto: linea.metodo_producto || "Sin clasificar",
    kilos: 0,
    base_iva: 0,
    pm_venta: 0,
    lineas: 0,
  };
}

function buildArticleRow(linea: VentasCategoriaLinea, key: string): VentasCategoriaArticuloRow {
  return {
    key,
    articulo: linea.articulo,
    referencia: linea.referencia ?? null,
    kilos: 0,
    base_iva: 0,
    pm_venta: 0,
    lineas: 0,
  };
}

function buildMonthlyClientRow(linea: VentasCategoriaLinea, key: string): VentasCategoriaMensualClienteRow {
  return {
    ...buildClientRow(linea, key),
    mes: linea.mes,
  };
}

function buildMonthlyProductRow(linea: VentasCategoriaLinea, key: string): VentasCategoriaMensualProductoRow {
  return {
    ...buildProductRow(linea, key),
    mes: linea.mes,
  };
}

function clientKey(linea: VentasCategoriaLinea): string {
  return linea.cliente_codigo;
}

function productKey(linea: VentasCategoriaLinea): string {
  return linea.metodo_producto || "Sin clasificar";
}

function articleKey(linea: VentasCategoriaLinea): string {
  return `${linea.referencia ?? ""}|${linea.articulo}`;
}

function monthlyClientKey(linea: VentasCategoriaLinea): string {
  return `${linea.mes}|${linea.cliente_codigo}`;
}

function monthlyProductKey(linea: VentasCategoriaLinea): string {
  return `${linea.mes}|${linea.metodo_producto || "Sin clasificar"}`;
}

function sortByKilosDesc<T extends { kilos: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => b.kilos - a.kilos);
}

function sortByMonthAndKilos<T extends { mes: string; kilos: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.mes.localeCompare(b.mes) || b.kilos - a.kilos);
}

function sum<T>(rows: T[], getValue: (row: T) => number): number {
  return rows.reduce((total, row) => total + getValue(row), 0);
}

function findSheetRows(sheets: VentasCategoriaWorkbookRows, preferredNames: string[]): unknown[][] {
  const entries = Object.entries(sheets);
  const match = entries.find(([name]) => {
    const normalized = normalizeHeader(name);
    return preferredNames.some((preferred) => normalized.includes(normalizeHeader(preferred)));
  });
  return match?.[1] ?? [];
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

function parseVentasDate(value: unknown, mesHint = ""): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  const text = cellText(value);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`;
  }

  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!slash) return null;

  const first = Number(slash[1]);
  const second = Number(slash[2]);
  const rawYear = Number(slash[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const hintMonth = Number(mesHint.match(/^\d{4}-(\d{2})$/)?.[1] ?? 0);
  let month = first;
  let day = second;

  if (hintMonth > 0) {
    if (hintMonth === first) {
      month = first;
      day = second;
    } else if (hintMonth === second) {
      month = second;
      day = first;
    }
  } else if (first > 12) {
    month = second;
    day = first;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseVentasNumber(value: unknown): number {
  const text = cellText(value)
    .replace(/€/g, "")
    .replace(/\s/g, "")
    .replace(/%/g, "");

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

function metodoFromGroup(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  return text.split("-")[0].trim() || text;
}

function normalizeHeader(value: unknown): string {
  return cellText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cellTextAt(row: unknown[], index: number | null | undefined): string {
  return index == null ? "" : cellText(row[index]);
}

function cellText(value: unknown): string {
  return String(value ?? "").trim();
}

function finiteOrZero(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function roundNumber(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseDateParts(fecha: string): { year: number; month: number; day: number } {
  const match = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Fecha invalida: ${fecha}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
