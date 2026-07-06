import * as XLSX from "xlsx";
import { strFromU8, strToU8, unzipSync, Zip, ZipPassThrough } from "fflate";
import { toast } from "@/hooks/use-toast";

export const EXCEL_CELL_MAX = 32000;
const LASARTE_LOGO_PATH = "/branding/lasarte-logo-horizontal.jpg";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Bloque de cabecera dimensionado para el logo horizontal nuevo (ratio 900x357 ~= 2,52:1),
// apuntando a ~7,5 cm de ancho x ~2,97 cm de alto.
const LOGO_BLOCK_COL_WIDTHS = [9, 9, 11, 11];
const LOGO_BLOCK_COL_COUNT = LOGO_BLOCK_COL_WIDTHS.length;
const LOGO_ROW_HEIGHT_PT = 84;
const LOGO_WIDTH_EMU = 2700000;
const LOGO_HEIGHT_EMU = 1071000;

const TEMPLATE_STYLE = {
  title: 2,
  header: 3,
  text: 4,
  number: 5,
};
const FFLATE_U8 = strToU8("").constructor as Uint8ArrayConstructor;

export function createWorkbook(title: string, subject: string) {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: title,
    Subject: subject,
    Author: "Herramienta Lasarte SAT",
    Company: "Lasarte SAT",
  };
  return wb;
}

export function excelText(value: unknown, overflowSheetName = "Texto largo"): string {
  const text = String(value ?? "");
  if (text.length <= EXCEL_CELL_MAX) return text;
  return `${text.slice(0, EXCEL_CELL_MAX - 90)}\n\n[Texto recortado por limite de Excel. Ver hoja ${overflowSheetName}.]`;
}

export function splitExcelText(value: unknown, chunkSize = 30000): string[] {
  const text = String(value ?? "");
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

type ExcelRow = Record<string, unknown>;

export function sanitizeExcelRow(row: ExcelRow, overflowSheetName?: string) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "string"
        ? excelText(value, overflowSheetName)
        : Array.isArray(value) || (value && typeof value === "object" && !(value instanceof Date))
          ? excelText(JSON.stringify(value), overflowSheetName)
          : value,
    ]),
  );
}

function emptyRow(cols: number) {
  return Array.from({ length: cols }, () => null);
}

function normalizeColumns(cols: number[], minCols: number) {
  const width = Math.max(minCols, LOGO_BLOCK_COL_COUNT);
  const normalized = cols.length >= width
    ? [...cols]
    : [...cols, ...Array.from({ length: width - cols.length }, () => 16)];
  for (let index = 0; index < LOGO_BLOCK_COL_COUNT; index += 1) {
    normalized[index] = LOGO_BLOCK_COL_WIDTHS[index];
  }
  return normalized;
}

function headersFromRows(rows: ExcelRow[]) {
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  return headers.length > 0 ? headers : ["Sin datos"];
}

export function appendAoaSheet(
  wb: XLSX.WorkBook,
  name: string,
  rows: (string | number | boolean | null)[][],
  cols: number[],
) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const width = Math.max(cols.length, rows[0]?.length ?? 1, LOGO_BLOCK_COL_COUNT);
  ws["!cols"] = normalizeColumns(cols, width).map((wch) => ({ wch }));
  ws["!rows"] = rows.map((_, index) => ({ hpt: index === 0 ? LOGO_ROW_HEIGHT_PT : 18 }));
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: LOGO_BLOCK_COL_COUNT - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: width - 1 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}

export function appendRowsSheet(
  wb: XLSX.WorkBook,
  name: string,
  rows: ExcelRow[],
  cols: number[],
  options: { overflowSheetName?: string; freezeHeader?: boolean } = {},
) {
  const safeRows = rows.map((row) => sanitizeExcelRow(row, options.overflowSheetName));
  const headers = headersFromRows(safeRows);
  const visualColCount = Math.max(headers.length, LOGO_BLOCK_COL_COUNT);
  const body = safeRows.length > 0
    ? safeRows.map((row) => headers.map((header) => row[header] ?? ""))
    : [[""]];
  const sheetRows = [
    emptyRow(visualColCount),
    [name, ...emptyRow(visualColCount - 1)],
    headers,
    ...body,
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws["!cols"] = normalizeColumns(cols, visualColCount).map((wch) => ({ wch }));
  ws["!rows"] = [
    { hpt: LOGO_ROW_HEIGHT_PT },
    { hpt: 24 },
    { hpt: 19 },
    ...body.map(() => ({ hpt: 18 })),
  ];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: LOGO_BLOCK_COL_COUNT - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: visualColCount - 1 } },
  ];
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: sheetRows.length - 1, c: headers.length - 1 } }),
  };
  if (options.freezeHeader) {
    ws["!freeze"] = { xSplit: 0, ySplit: 3 };
  }
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}

export function appendDictionarySheet(
  wb: XLSX.WorkBook,
  rows: Array<{ Hoja: string; Campo: string; Descripcion: string; Uso?: string }>,
) {
  return appendRowsSheet(wb, "Diccionario", rows, [22, 28, 64, 36], { freezeHeader: true });
}

export function saveWorkbook(wb: XLSX.WorkBook, filename: string) {
  // No es fire-and-forget silencioso: si la generación/descarga falla, se avisa al usuario
  // en vez de dar por bueno el export.
  void saveWorkbookAsync(wb, filename).catch((err) => {
    console.error("Error al generar el Excel:", err);
    toast({
      title: "No se pudo generar el Excel",
      description: "Revisa los datos e inténtalo de nuevo.",
      variant: "destructive",
    });
  });
}

export async function saveWorkbookAsync(wb: XLSX.WorkBook, filename: string) {
  const logoBytes = await loadLasarteLogoBytes();
  const bytes = buildWorkbookXlsxBytes(wb, { logoBytes });
  downloadBytes(bytes, filename);
}

export function buildWorkbookXlsxBytes(
  wb: XLSX.WorkBook,
  options: { logoBytes?: Uint8Array } = {},
) {
  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
  const zip = unzipSync(new Uint8Array(raw));
  zip["xl/styles.xml"] = strToU8(buildLasarteStylesXml());
  addContentTypes(zip, wb.SheetNames.length);

  wb.SheetNames.forEach((_, index) => {
    const sheetNumber = index + 1;
    const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`;
    const xml = zip[sheetPath] ? strFromU8(zip[sheetPath]) : "";
    if (!xml) return;

    zip[sheetPath] = strToU8(styleWorksheetXml(injectWorksheetDrawing(xml, sheetNumber)));
    addWorksheetRelationship(zip, sheetNumber);
    if (options.logoBytes) addDrawing(zip, sheetNumber, options.logoBytes);
  });

  return zipFiles(zip);
}

async function loadLasarteLogoBytes() {
  if (typeof fetch !== "function") return undefined;
  try {
    const response = await fetch(LASARTE_LOGO_PATH);
    if (!response.ok) return undefined;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return undefined;
  }
}

function downloadBytes(bytes: Uint8Array, filename: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildLasarteStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="12"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="20"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="12"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF102030"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF9BB8D8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE6B8B7"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FFD9E2EC"/></top><bottom style="thin"><color rgb="FFD9E2EC"/></bottom><diagonal/></border>
    <border><left/><right/><top style="medium"><color rgb="FFBFC9D4"/></top><bottom style="thin"><color rgb="FFD9E2EC"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="3" fontId="4" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>
</styleSheet>`;
}

function addContentTypes(zip: Record<string, Uint8Array>, sheetCount: number) {
  const path = "[Content_Types].xml";
  let xml = strFromU8(zip[path]);
  if (!xml.includes('Extension="jpeg"')) {
    xml = xml.replace("</Types>", '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
  }
  for (let index = 1; index <= sheetCount; index++) {
    const override = `<Override PartName="/xl/drawings/drawing${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
    if (!xml.includes(`PartName="/xl/drawings/drawing${index}.xml"`)) {
      xml = xml.replace("</Types>", `${override}</Types>`);
    }
  }
  zip[path] = strToU8(xml);
}

function injectWorksheetDrawing(xml: string, sheetNumber: number) {
  if (xml.includes("<drawing ")) return xml;
  const drawing = `<drawing r:id="rIdLasarteLogo${sheetNumber}"/>`;
  if (xml.includes("<pageMargins")) return xml.replace("<pageMargins", `${drawing}<pageMargins`);
  return xml.replace("</worksheet>", `${drawing}</worksheet>`);
}

function styleWorksheetXml(xml: string) {
  // El grupo (\/?) captura celdas auto-cerradas (<c r="E4"/>) para no corromper el XML.
  return xml.replace(/<c\b([^>]*?)r="([A-Z]+)(\d+)"([^>]*?)(\/?)>/g, (_match, before, col, rowText, after, selfClose) => {
    const row = Number(rowText);
    const attrs = `${before}r="${col}${rowText}"${after}`;
    const style = row === 2
      ? TEMPLATE_STYLE.title
      : row === 3
        ? TEMPLATE_STYLE.header
        : row >= 4
          ? isNumericCell(attrs) ? TEMPLATE_STYLE.number : TEMPLATE_STYLE.text
          : 1;
    return `<c${setXmlAttribute(attrs, "s", String(style))}${selfClose}>`;
  });
}

function isNumericCell(attrs: string) {
  return !/\bt="(?:s|str|inlineStr|b|d)"/.test(attrs);
}

function setXmlAttribute(attrs: string, name: string, value: string) {
  const trimmed = attrs.trim();
  if (new RegExp(`\\b${name}="`).test(trimmed)) {
    return ` ${trimmed.replace(new RegExp(`\\b${name}="[^"]*"`), `${name}="${value}"`)}`;
  }
  return ` ${trimmed} ${name}="${value}"`;
}

function addWorksheetRelationship(zip: Record<string, Uint8Array>, sheetNumber: number) {
  const dir = "xl/worksheets/_rels";
  const path = `${dir}/sheet${sheetNumber}.xml.rels`;
  const relationship = `<Relationship Id="rIdLasarteLogo${sheetNumber}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${sheetNumber}.xml"/>`;
  const base = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const current = zip[path] ? strFromU8(zip[path]) : base;
  const xml = current.includes(`rIdLasarteLogo${sheetNumber}`)
    ? current
    : current.replace("</Relationships>", `${relationship}</Relationships>`);
  zip[path] = strToU8(xml);
}

function addDrawing(zip: Record<string, Uint8Array>, sheetNumber: number, logoBytes: Uint8Array) {
  const logoPath = `xl/media/lasarte-sat-logo-${sheetNumber}.jpeg`;
  zip[logoPath] = toFflateBytes(logoBytes);
  zip[`xl/drawings/drawing${sheetNumber}.xml`] = strToU8(buildLogoDrawingXml(sheetNumber));
  zip[`xl/drawings/_rels/drawing${sheetNumber}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/lasarte-sat-logo-${sheetNumber}.jpeg"/>
</Relationships>`);
}

function toFflateBytes(data: Uint8Array) {
  return data instanceof FFLATE_U8 ? data : new FFLATE_U8(data);
}

function zipFiles(files: Record<string, Uint8Array>) {
  const chunks: Uint8Array[] = [];
  let streamError: Error | null = null;
  const archive = new Zip((err, chunk) => {
    if (err) {
      streamError = err;
      return;
    }
    if (chunk) chunks.push(chunk);
  });

  for (const [path, data] of Object.entries(files)) {
    const entry = new ZipPassThrough(path);
    archive.add(entry);
    entry.push(toFflateBytes(data), true);
  }

  archive.end();
  if (streamError) throw streamError;

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new FFLATE_U8(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function buildLogoDrawingXml(_sheetNumber: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:ext cx="${LOGO_WIDTH_EMU}" cy="${LOGO_HEIGHT_EMU}"/>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="2" name="Logo Lasarte SAT"/>
        <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1" cstate="print"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_WIDTH_EMU}" cy="${LOGO_HEIGHT_EMU}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
}
