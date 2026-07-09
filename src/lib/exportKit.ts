// src/lib/exportKit.ts
// Motor de Excel CON MARCA para Herramienta Lasarte, basado en exceljs
// (a diferencia de exportWorkbook.ts, que usa xlsx/SheetJS community y no
// puede escribir estilos). Este archivo es la base de la migración por fases
// de todos los exports Excel hacia el sistema de diseño de
// docs/EXPORT_TEMPLATES_SPEC.md — NO sustituye a exportWorkbook.ts todavía:
// los exports que aún no se han migrado siguen usando createWorkbook /
// appendRowsSheet / saveWorkbook hasta que se porten explícitamente.
//
// El logo real (imagen) sigue viviendo en los PDF (ver exportTheme.ts). Aquí,
// en vez de incrustar una imagen, la "marca" es una fila de título con texto
// grande en azul corporativo ("LASARTE SAT") seguida del título del informe —
// más simple de mantener en Excel y perfectamente legible impreso o en pantalla.
import { Workbook } from "exceljs";
import type { Alignment, Borders, Fill, Worksheet } from "exceljs";
import { downloadBytes } from "./exportWorkbook";

// ─── Datos fiscales (placeholders — rellenar cuando se confirmen con el dueño) ──
// Se usan tal cual en el pie de todas las hojas generadas por este motor. Mantenerlos
// como constantes centralizadas permite un único punto de sustitución cuando se
// disponga de los datos reales.
// Datos fiscales reales tomados de la plantilla oficial del dueño (jul 2026).
export const LASARTE_FISCAL = {
  nombre: "Lasarte Cítricos S.L.",
  cif: "B14800304",
  direccion: "Ctra. Madrid-Cádiz km 461, 41400 Écija (Sevilla)",
  telefono: "{{TELEFONO}}",
  email: "{{EMAIL}}",
  web: "{{WEB}}",
};

// ─── Paleta del sistema de diseño LASARTE (spec §0.1) ──────────────────────────
export const LASARTE_COLORS = {
  azulPrincipal: "253A70",
  verdeAcento: "97C428",
  naranjaAcento: "F28C00",
  azulClaroFondo: "EEF3FA",
  verdeMuyClaro: "F3F8E8",
  grisTexto: "2E2E2E",
  grisMedio: "6B7280",
  grisLinea: "D9DEE8",
  grisFondo: "F7F8FA",
  rojoAlerta: "B42318",
  rojoFondo: "FFF1F0",
  blanco: "FFFFFF",
} as const;

// ─── Formatos numéricos españoles (spec §0.5) ──────────────────────────────────
// Códigos de formato de Excel: usan "." como marcador de decimal y "," como
// separador de miles EN EL CÓDIGO (es el mismo código en cualquier idioma);
// Excel los renderiza con los separadores del idioma del libro/usuario (en
// España: coma decimal, punto de miles), tal y como describe el spec.
export const FMT_FECHA = "dd/mm/yyyy";
export const FMT_FECHA_HORA = "dd/mm/yyyy hh:mm";
export const FMT_KG = '#,##0.00" kg"';
export const FMT_TH = '#,##0.00" T/h"';
export const FMT_L = '#,##0.00" L"';
export const FMT_LKG = '#,##0.000" L/kg"';
export const FMT_MLKG = '#,##0.000" mL/kg"';
export const FMT_KWH = '#,##0.00" kWh"';
export const FMT_EUR = '#,##0.00" €"';
export const FMT_EUR_KG = '#,##0.0000" €/kg"';
// Sin operador "%" real de Excel (que multiplicaría el valor x100): los datos
// de la app ya vienen expresados en unidades porcentuales (p.ej. 45,20), así
// que el signo "%" es un sufijo de texto, igual que "kg" o "€/kg".
export const FMT_PCT = '0.00" %"';
export const FMT_INT = "#,##0";

// ─── Clasificación / pie legal (spec §0.4) ─────────────────────────────────────
export type ClasificacionExport = "Interno" | "Confidencial" | "Dirección" | "RRHH";

export const CLASIFICACION_TEXTO: Record<ClasificacionExport, string> = {
  Interno: "Documento de uso interno de Herramienta Lasarte.",
  Confidencial: "Documento confidencial. Uso restringido a personal autorizado.",
  Dirección: "Documento interno de dirección. No distribuir sin autorización.",
  RRHH: "Documento confidencial. Contiene datos personales. Uso limitado a personal autorizado conforme RGPD/LOPDGDD.",
};

// ─── Metadatos comunes de exportación (spec §0.7) ──────────────────────────────
export interface LasarteExportMeta {
  titulo: string;
  periodo?: string;
  usuario?: string;
  centro?: string;
  filtros?: string;
  exportId?: string;
  clasificacion?: ClasificacionExport;
  /** Solo para tests deterministas; por defecto `new Date()`. */
  generadoEn?: Date;
}

/** Metadatos ya resueltos (con exportId/generadoEn garantizados) que maneja añadirHojaTabla. */
export type LasarteExportMetaResuelto = LasarteExportMeta & { exportId: string; generadoEn: Date };

export interface ExcelWorkbookCtx {
  workbook: Workbook;
  meta: LasarteExportMetaResuelto;
}

// ─── Columnas / tabla ───────────────────────────────────────────────────────────
export type ColumnaTipo = "texto" | "numero" | "fecha" | "fecha_hora";
export type ColumnaAlineacion = "left" | "center" | "right";

export interface ColumnaTabla {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
  align?: ColumnaAlineacion;
  tipo?: ColumnaTipo;
}

export interface HojaTablaOptions {
  nombreHoja: string;
  /** Título mostrado en la banda de marca; por defecto meta.titulo. */
  titulo?: string;
  columnas: ColumnaTabla[];
  filas: Record<string, unknown>[];
  /** Valores por columna (por `key`) para la fila de totales; se omite si no se pasa. */
  totales?: Record<string, unknown>;
  /** Congela la cabecera de tabla al hacer scroll. Por defecto `true`. */
  freeze?: boolean;
  /** Activa el autofiltro sobre la tabla. Por defecto `true` (si hay filas). */
  autofilter?: boolean;
}

// ─── Helpers puros (testeables sin abrir un Excel real) ────────────────────────

let exportIdCounter = 0;

/** Identificador de exportación legible y único dentro de la sesión: LST-AAAAMMDDHHMMSS-NNN. */
export function generarExportId(fecha = new Date()): string {
  exportIdCounter += 1;
  const stamp = fecha
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return `LST-${stamp}-${String(exportIdCounter).padStart(3, "0")}`;
}

/** Fecha+hora en formato español "dd/mm/aaaa hh:mm" para textos de pie/metadatos. */
export function formatearFechaHoraExportacion(fecha: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(fecha.getDate())}/${pad(fecha.getMonth() + 1)}/${fecha.getFullYear()} ${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

/** Alineación por defecto según el tipo de columna, salvo que se fuerce con `align`. */
export function resolverAlineacion(columna: ColumnaTabla): ColumnaAlineacion {
  if (columna.align) return columna.align;
  if (columna.tipo === "numero") return "right";
  if (columna.tipo === "fecha" || columna.tipo === "fecha_hora") return "center";
  return "left";
}

/** Formato numérico por defecto según el tipo de columna, salvo que se fuerce con `numFmt`. */
export function resolverNumFmt(columna: ColumnaTabla): string | undefined {
  if (columna.numFmt) return columna.numFmt;
  if (columna.tipo === "fecha") return FMT_FECHA;
  if (columna.tipo === "fecha_hora") return FMT_FECHA_HORA;
  if (columna.tipo === "numero") return FMT_INT;
  return undefined;
}

/** Proyecta una fila (objeto por clave) al orden de columnas dado. */
export function construirFilaOrdenada(columnas: ColumnaTabla[], fila: Record<string, unknown>): unknown[] {
  return columnas.map((columna) => fila[columna.key] ?? null);
}

export function construirFilasOrdenadas(columnas: ColumnaTabla[], filas: Record<string, unknown>[]): unknown[][] {
  return filas.map((fila) => construirFilaOrdenada(columnas, fila));
}

/** Fila de totales proyectada al orden de columnas; `null` si no hay totales. */
export function construirFilaTotales(
  columnas: ColumnaTabla[],
  totales: Record<string, unknown> | undefined,
): unknown[] | null {
  if (!totales) return null;
  return columnas.map((columna) => (columna.key in totales ? (totales[columna.key] ?? null) : null));
}

/** Línea de metadatos bajo la marca (spec §0.7), unida con separador visual "·". */
export function construirLineaMetadatos(meta: LasarteExportMetaResuelto): string {
  const partes: string[] = [];
  if (meta.centro) partes.push(`Centro: ${meta.centro}`);
  if (meta.periodo) partes.push(`Periodo: ${meta.periodo}`);
  partes.push(`Exportado por: ${meta.usuario ?? "—"}`);
  partes.push(`Fecha exportación: ${formatearFechaHoraExportacion(meta.generadoEn)}`);
  if (meta.filtros) partes.push(`Filtros: ${meta.filtros}`);
  partes.push(`Nº exportación: ${meta.exportId}`);
  return partes.join("  ·  ");
}

/** Líneas de pie (spec §0.4): datos fiscales, id/fecha de exportación y, si aplica, el texto legal de clasificación. */
export function construirLineasPie(meta: LasarteExportMetaResuelto): string[] {
  const lineas = [
    `LASARTE SAT · CIF: ${LASARTE_FISCAL.cif} · ${LASARTE_FISCAL.direccion} · Tel. ${LASARTE_FISCAL.telefono} · ${LASARTE_FISCAL.email} · ${LASARTE_FISCAL.web}`,
    `Documento generado desde Herramienta Lasarte · Exportación: ${meta.exportId} · ${formatearFechaHoraExportacion(meta.generadoEn)}`,
  ];
  if (meta.clasificacion) lineas.push(CLASIFICACION_TEXTO[meta.clasificacion]);
  return lineas;
}

// ─── Helpers de estilo exceljs ──────────────────────────────────────────────────

function argb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

function solidFill(hex: string): Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } };
}

function thinBorders(hex: string): Partial<Borders> {
  const side = { style: "thin" as const, color: { argb: argb(hex) } };
  return { top: side, left: side, bottom: side, right: side };
}

function centerAlign(horizontal: ColumnaAlineacion, wrapText = false): Partial<Alignment> {
  return { vertical: "middle", horizontal, wrapText };
}

// ─── API de alto nivel ──────────────────────────────────────────────────────────

/** Crea un libro exceljs con marca LASARTE y metadatos de exportación resueltos (exportId/generadoEn). */
export function crearLibroLasarte(meta: LasarteExportMeta): ExcelWorkbookCtx {
  const workbook = new Workbook();
  const generadoEn = meta.generadoEn ?? new Date();
  const exportId = meta.exportId ?? generarExportId(generadoEn);
  workbook.creator = "Herramienta Lasarte SAT";
  workbook.company = "Lasarte SAT";
  workbook.title = meta.titulo;
  workbook.created = generadoEn;
  workbook.modified = generadoEn;
  return { workbook, meta: { ...meta, exportId, generadoEn } };
}

/**
 * Añade una hoja con la banda de marca ("LASARTE SAT" + título + metadatos),
 * la tabla de datos con el estilo del sistema de diseño LASARTE (cabecera azul,
 * filas alternas, bordes, totales, formatos numéricos españoles) y el pie legal.
 */
export function añadirHojaTabla(ctx: ExcelWorkbookCtx, opts: HojaTablaOptions): Worksheet {
  const { workbook, meta } = ctx;
  const columnas = opts.columnas;
  const totalCols = Math.max(columnas.length, 1);
  const ws = workbook.addWorksheet(opts.nombreHoja);

  ws.columns = columnas.map((columna) => ({
    key: columna.key,
    width: columna.width ?? Math.max(columna.header.length + 4, 12),
  }));

  let rowIndex = 1;

  // Fila 1: marca "LASARTE SAT" (texto grande azul; el logo real va en PDF).
  const brandRow = ws.getRow(rowIndex);
  ws.mergeCells(rowIndex, 1, rowIndex, totalCols);
  brandRow.getCell(1).value = LASARTE_FISCAL.nombre;
  brandRow.getCell(1).font = { name: "Calibri", size: 18, bold: true, color: { argb: argb(LASARTE_COLORS.azulPrincipal) } };
  brandRow.getCell(1).alignment = centerAlign("left");
  brandRow.height = 26;
  rowIndex += 1;

  // Fila 2: título del informe.
  const titleRow = ws.getRow(rowIndex);
  ws.mergeCells(rowIndex, 1, rowIndex, totalCols);
  titleRow.getCell(1).value = opts.titulo ?? meta.titulo;
  titleRow.getCell(1).font = { name: "Calibri", size: 13, bold: true, color: { argb: argb(LASARTE_COLORS.grisTexto) } };
  titleRow.getCell(1).alignment = centerAlign("left");
  titleRow.height = 19;
  rowIndex += 1;

  // Fila 3: bloque de metadatos (centro, periodo, usuario, fecha, filtros, export id).
  const metaRow = ws.getRow(rowIndex);
  ws.mergeCells(rowIndex, 1, rowIndex, totalCols);
  metaRow.getCell(1).value = construirLineaMetadatos(meta);
  metaRow.getCell(1).font = { name: "Calibri", size: 9, color: { argb: argb(LASARTE_COLORS.grisMedio) } };
  metaRow.getCell(1).alignment = centerAlign("left");
  rowIndex += 1;

  // Fila 4 (opcional): etiqueta de clasificación, en rojo para que destaque también en B/N como texto.
  if (meta.clasificacion) {
    const classRow = ws.getRow(rowIndex);
    ws.mergeCells(rowIndex, 1, rowIndex, totalCols);
    classRow.getCell(1).value = `Clasificación: ${meta.clasificacion.toUpperCase()}`;
    classRow.getCell(1).font = { name: "Calibri", size: 9, bold: true, color: { argb: argb(LASARTE_COLORS.rojoAlerta) } };
    classRow.getCell(1).alignment = centerAlign("left");
    rowIndex += 1;
  }

  rowIndex += 1; // fila en blanco antes de la tabla

  // Cabecera de tabla.
  const headerRowNumber = rowIndex;
  const headerRow = ws.getRow(headerRowNumber);
  columnas.forEach((columna, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = columna.header;
    cell.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: argb(LASARTE_COLORS.blanco) } };
    cell.fill = solidFill(LASARTE_COLORS.azulPrincipal);
    cell.alignment = centerAlign("center", true);
    cell.border = thinBorders(LASARTE_COLORS.grisLinea);
  });
  headerRow.height = 20;
  rowIndex += 1;

  // Filas de datos (alternando blanco / gris muy claro).
  const filasOrdenadas = construirFilasOrdenadas(columnas, opts.filas);
  filasOrdenadas.forEach((valores, filaIdx) => {
    const row = ws.getRow(rowIndex);
    const esAlterna = filaIdx % 2 === 1;
    valores.forEach((valor, colIdx) => {
      const columna = columnas[colIdx];
      const cell = row.getCell(colIdx + 1);
      cell.value = valor as never;
      const numFmt = resolverNumFmt(columna);
      if (numFmt) cell.numFmt = numFmt;
      cell.alignment = centerAlign(resolverAlineacion(columna));
      cell.border = thinBorders(LASARTE_COLORS.grisLinea);
      if (esAlterna) cell.fill = solidFill(LASARTE_COLORS.grisFondo);
    });
    rowIndex += 1;
  });
  const lastDataRow = rowIndex - 1;
  const hayFilas = filasOrdenadas.length > 0;

  // Fila de totales (opcional): fondo verde muy claro, borde superior verde grueso, negrita.
  const totalesOrdenados = construirFilaTotales(columnas, opts.totales);
  if (totalesOrdenados) {
    const row = ws.getRow(rowIndex);
    totalesOrdenados.forEach((valor, colIdx) => {
      const columna = columnas[colIdx];
      const cell = row.getCell(colIdx + 1);
      cell.value = valor as never;
      const numFmt = resolverNumFmt(columna);
      if (numFmt) cell.numFmt = numFmt;
      cell.font = { name: "Calibri", size: 9, bold: true, color: { argb: argb(LASARTE_COLORS.grisTexto) } };
      cell.fill = solidFill(LASARTE_COLORS.verdeMuyClaro);
      cell.alignment = centerAlign(resolverAlineacion(columna));
      cell.border = {
        ...thinBorders(LASARTE_COLORS.grisLinea),
        top: { style: "medium", color: { argb: argb(LASARTE_COLORS.verdeAcento) } },
      };
    });
    rowIndex += 1;
  }

  rowIndex += 1; // fila en blanco antes del pie

  // Pie: datos fiscales, EXPORT_ID/fecha y (si aplica) texto legal de clasificación.
  construirLineasPie(meta).forEach((linea, idx) => {
    const row = ws.getRow(rowIndex);
    ws.mergeCells(rowIndex, 1, rowIndex, totalCols);
    const cell = row.getCell(1);
    cell.value = linea;
    cell.font = { name: "Calibri", size: idx === 2 ? 7.5 : 7, italic: idx === 2, color: { argb: argb(LASARTE_COLORS.grisMedio) } };
    cell.alignment = centerAlign("left", true);
    rowIndex += 1;
  });

  if (opts.autofilter !== false && hayFilas) {
    ws.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: lastDataRow, column: totalCols },
    };
  }

  const congelar = opts.freeze !== false;
  ws.views = [
    congelar
      ? { state: "frozen", ySplit: headerRowNumber, showGridLines: false }
      : { state: "normal", showGridLines: false },
  ];

  ws.pageSetup = { fitToWidth: 1, fitToHeight: 0, orientation: totalCols > 6 ? "landscape" : "portrait" };

  return ws;
}

/** Genera los bytes del libro (.xlsx) y dispara la descarga en el navegador. */
export async function descargarLibro(ctx: ExcelWorkbookCtx, filename: string): Promise<void> {
  const buffer = await ctx.workbook.xlsx.writeBuffer();
  downloadBytes(new Uint8Array(buffer), filename);
}
