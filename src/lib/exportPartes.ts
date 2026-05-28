import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { computeCascade, CascadeInput, CascadeResult } from "./cascade";
import { formatDate, formatKg } from "./format";
import { PDF_THEME, drawExportHeader, drawExportFooter, drawKpiCard, pdfTableTheme } from "./exportTheme";
import { appendDictionarySheet, createWorkbook, excelText, saveWorkbook, splitExcelText } from "./exportWorkbook";

export interface ParteRow {
  id: string;
  date: string;
  estado: string;
  kg_produccion_calibrador?: number | null;
  kg_mujeres_calibrador?: number | null;
  kg_palets_brutos?: number | null;
  kg_palets_egipto?: number | null;
  kg_palets_campo?: number | null;
  kg_podrido_calibrador_auto?: number | null;
  kg_industria_manual?: number | null;
  kg_reciclado_malla_z1?: number | null;
  kg_reciclado_malla_z2?: number | null;
  kg_inventario_sin_alta?: number | null;
  kg_podrido_bolsa_basura?: number | null;
  kg_inventario_anterior_sin_alta?: number | null;
  notas_generales?: string | null;
  notas_inventario?: string | null;
  resumen_ia?: any;
}

function n(value: unknown): number {
  return Number(value) || 0;
}

function buildCascade(p: ParteRow): CascadeResult {
  const input: CascadeInput = {
    kg_produccion_calibrador: n(p.kg_produccion_calibrador),
    kg_mujeres_calibrador: n(p.kg_mujeres_calibrador),
    kg_palets_brutos: n(p.kg_palets_brutos) - n(p.kg_palets_egipto),
    kg_podrido_calibrador: n(p.kg_podrido_calibrador_auto),
    kg_industria_manual: n(p.kg_industria_manual),
    kg_reciclado_malla_z1: n(p.kg_reciclado_malla_z1),
    kg_reciclado_malla_z2: n(p.kg_reciclado_malla_z2),
    kg_inventario_sin_alta: n(p.kg_inventario_sin_alta),
    kg_podrido_bolsa_basura: n(p.kg_podrido_bolsa_basura),
    kg_inventario_anterior_sin_alta: n(p.kg_inventario_anterior_sin_alta),
  };
  return computeCascade(input);
}

function pct(part: number, total: number, digits = 1) {
  return total > 0 ? +((part / total) * 100).toFixed(digits) : 0;
}

function kg(value: number, digits = 0) {
  return +value.toFixed(digits);
}

function safePdf(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfDate(value: string | Date) {
  return safePdf(formatDate(value));
}

function pdfKg(value: number, digits = 0) {
  return safePdf(formatKg(value, digits));
}

function semLabel(s: "verde" | "amarillo" | "rojo"): string {
  return s === "verde" ? "[OK] <= 3%" : s === "amarillo" ? "[!] 3-5%" : "[X] > 5%";
}

function semColor(s: "verde" | "amarillo" | "rojo"): [number, number, number] {
  return s === "verde" ? PDF_THEME.success : s === "amarillo" ? PDF_THEME.warning : PDF_THEME.destructive;
}

function sanitizeRow(row: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? excelText(value, "IA fragmentos") : value]),
  );
}

function sheetFromRows(rows: Record<string, any>[], cols: number[]) {
  const safeRows = rows.map(sanitizeRow);
  const ws = safeRows.length > 0 ? XLSX.utils.json_to_sheet(safeRows) : XLSX.utils.aoa_to_sheet([["Sin datos"]]);
  ws["!cols"] = cols.map((wch) => ({ wch }));
  if (safeRows.length > 0) {
    const headers = Object.keys(safeRows[0]);
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: safeRows.length, c: headers.length - 1 } }),
    };
  }
  return ws;
}

function flattenProducto(partes: ParteRow[]) {
  return partes.flatMap((p) => {
    const rows = p.resumen_ia?.producto_detalle;
    if (!Array.isArray(rows)) return [];
    return rows.map((r: any) => ({
      Fecha: formatDate(p.date),
      Linea: r.linea ?? "",
      Producto: r.producto ?? "",
      "Formato caja": r.formato_caja ?? r.empaque ?? "",
      "Grupo destino": r.grupo_destino ?? "",
      "Kg": n(r.kg),
      "Cajas": n(r.n_cajas ?? r.cajas),
    }));
  });
}

function flattenPalets(partes: ParteRow[]) {
  return partes.flatMap((p) => {
    const rows = p.resumen_ia?.palets_detalle;
    if (!Array.isArray(rows)) return [];
    return rows.map((r: any) => ({
      Fecha: formatDate(p.date),
      Palet: r.palet_id ?? "",
      Producto: r.producto ?? "",
      Cliente: r.cliente ?? "",
      Destino: r.destino ?? "",
      Situacion: r.situacion ?? "",
      "Kg neto": n(r.kg_neto),
      "Cajas": n(r.n_cajas),
    }));
  });
}

export function exportPartesToExcel(partes: ParteRow[], from: string, to: string) {
  const enriched = partes.map((p) => ({ p, c: buildCascade(p) }));
  const wb = createWorkbook("Lasarte SAT - Informe de partes", "Control de produccion y DJPMN");

  const totalProd = enriched.reduce((s, { c }) => s + c.produccion_real, 0);
  const totalPalets = enriched.reduce((s, { c }) => s + c.palets_ajustados, 0);
  const totalDsj = enriched.reduce((s, { c }) => s + c.dsj, 0);
  const totalMermas = enriched.reduce((s, { c }) => s + c.mermas_totales, 0);
  const dsjPctGlobal = totalProd > 0 ? (totalDsj / totalProd) * 100 : 0;
  const nOk = enriched.filter(({ c }) => Math.abs(c.dsj_pct) <= 3).length;
  const nWarn = enriched.filter(({ c }) => Math.abs(c.dsj_pct) > 3 && Math.abs(c.dsj_pct) <= 5).length;
  const nCrit = enriched.filter(({ c }) => Math.abs(c.dsj_pct) > 5).length;
  const worst = enriched.reduce<typeof enriched[number] | null>(
    (acc, row) => (!acc || Math.abs(row.c.dsj_pct) > Math.abs(acc.c.dsj_pct) ? row : acc),
    null,
  );

  const portada = XLSX.utils.aoa_to_sheet([
    ["Lasarte SAT - Informe de control de produccion"],
    [`Periodo: ${formatDate(from)} - ${formatDate(to)}`],
    [`Generado: ${new Date().toLocaleString("es-ES")}`],
    [],
    ["Lectura ejecutiva", "Valor"],
    ["Partes incluidos", partes.length],
    ["Produccion real total (kg)", kg(totalProd, 2)],
    ["Palets alta ajustados (kg)", kg(totalPalets, 2)],
    ["DJPMN total (kg)", kg(totalDsj, 2)],
    ["DJPMN global (%)", +dsjPctGlobal.toFixed(3)],
    ["Mermas totales (kg)", kg(totalMermas, 2)],
    ["Dias OK", nOk],
    ["Dias a revisar", nWarn],
    ["Dias criticos", nCrit],
    ["Peor dia", worst ? `${formatDate(worst.p.date)} (${worst.c.dsj_pct.toFixed(2)}%)` : ""],
    [],
    ["Como leer el archivo"],
    ["Detalle diario", "Una fila por parte con los KPIs principales y semaforo."],
    ["Cascada DJPMN", "Misma estructura que se muestra en la herramienta."],
    ["Datos entrada", "Campos brutos usados para calcular la cascada."],
    ["Producto y palets", "Detalle extraido del analisis cuando existe."],
    ["Notas e IA", "Observaciones y analisis del parte."],
  ]);
  portada["!cols"] = [{ wch: 34 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, portada, "Portada");

  const detalleRows = enriched.map(({ p, c }) => ({
    Fecha: formatDate(p.date),
    Estado: p.estado,
    Semaforo: semLabel(c.semaforo),
    "Produccion real kg": kg(c.produccion_real, 2),
    "Palets ajustados kg": kg(c.palets_ajustados, 2),
    "Inventario final kg": kg(c.inventario_final, 2),
    "Diferencia bruta kg": kg(c.diferencia_bruta, 2),
    "Podrido manual kg": kg(c.podrido_manual, 2),
    "Mermas totales kg": kg(c.mermas_totales, 2),
    "DJPMN kg": kg(c.dsj, 2),
    "DJPMN %": +c.dsj_pct.toFixed(3),
    "Mermas % prod": +c.mermas_pct.toFixed(3),
    "Produccion vs palets kg": kg(c.produccion_real - c.palets_ajustados, 2),
    "Produccion vs palets %": +pct(c.produccion_real - c.palets_ajustados, c.produccion_real, 3).toFixed(3),
    "Abs DJPMN %": +Math.abs(c.dsj_pct).toFixed(3),
    "Notas generales": p.notas_generales ?? "",
  }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(detalleRows, [14, 16, 14, 18, 18, 18, 18, 18, 18, 14, 12, 14, 20, 18, 14, 45]), "Detalle diario");

  const cascadeRows = enriched.flatMap(({ p, c }) => [
    { Fecha: formatDate(p.date), Bloque: "Produccion real", Concepto: "Calibrador", Op: "=", "Kg": kg(c.produccion_calibrador, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Produccion real", Concepto: "Mujeres clase L", Op: "-", "Kg": kg(c.mujeres, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Produccion real", Concepto: "Reciclado malla Z1", Op: "-", "Kg": kg(c.reciclado_z1, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Produccion real", Concepto: "Reciclado malla Z2", Op: "-", "Kg": kg(c.reciclado_z2, 2), "Resultado": kg(c.produccion_real, 2) },
    { Fecha: formatDate(p.date), Bloque: "Palets e inventario", Concepto: "Palets alta bruto", Op: "=", "Kg": kg(c.palets_brutos, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Palets e inventario", Concepto: "Inventario dia anterior", Op: "-", "Kg": kg(c.inventario_anterior, 2), "Resultado": kg(c.palets_ajustados, 2) },
    { Fecha: formatDate(p.date), Bloque: "Mermas y DJPMN", Concepto: "Produccion real", Op: "=", "Kg": kg(c.produccion_real, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Mermas y DJPMN", Concepto: "Palets alta ajustados", Op: "-", "Kg": kg(c.palets_ajustados, 2), "Resultado": "" },
    { Fecha: formatDate(p.date), Bloque: "Mermas y DJPMN", Concepto: "Inventario final sin alta", Op: "-", "Kg": kg(c.inventario_final, 2), "Resultado": kg(c.diferencia_bruta, 2) },
    { Fecha: formatDate(p.date), Bloque: "Mermas y DJPMN", Concepto: "Podrido manual", Op: "-", "Kg": kg(c.podrido_manual, 2), "Resultado": kg(c.mermas_totales, 2) },
    { Fecha: formatDate(p.date), Bloque: "Resultado", Concepto: "DJPMN", Op: "=", "Kg": kg(c.dsj, 2), "Resultado": `${c.dsj_pct.toFixed(3)}%` },
  ]);
  XLSX.utils.book_append_sheet(wb, sheetFromRows(cascadeRows, [14, 22, 28, 8, 14, 16]), "Cascada DJPMN");

  const rawRows = enriched.map(({ p }) => ({
    Fecha: formatDate(p.date),
    "Calibrador kg": n(p.kg_produccion_calibrador),
    "Industria manual kg": n(p.kg_industria_manual),
    "Mujeres L kg": n(p.kg_mujeres_calibrador),
    "Reciclado Z1 kg": n(p.kg_reciclado_malla_z1),
    "Reciclado Z2 kg": n(p.kg_reciclado_malla_z2),
    "Palets brutos kg": n(p.kg_palets_brutos),
    "Palets Egipto kg": n(p.kg_palets_egipto),
    "Palets campo kg": n(p.kg_palets_campo),
    "Inventario anterior kg": n(p.kg_inventario_anterior_sin_alta),
    "Inventario final kg": n(p.kg_inventario_sin_alta),
    "Podrido calibrador kg": n(p.kg_podrido_calibrador_auto),
    "Podrido manual kg": n(p.kg_podrido_bolsa_basura),
  }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(rawRows, [14, 16, 18, 14, 16, 16, 16, 16, 16, 20, 18, 20, 18]), "Datos entrada");

  const productoRows = flattenProducto(partes);
  XLSX.utils.book_append_sheet(wb, sheetFromRows(productoRows, [14, 14, 36, 18, 18, 14, 12]), "Producto");

  const paletsRows = flattenPalets(partes);
  XLSX.utils.book_append_sheet(wb, sheetFromRows(paletsRows, [14, 16, 36, 24, 18, 18, 14, 12]), "Palets");

  const notasRows = partes.map((p) => ({
    Fecha: formatDate(p.date),
    Estado: p.estado,
    "Notas generales": p.notas_generales ?? "",
    "Notas inventario": p.notas_inventario ?? "",
    "Analisis IA": p.resumen_ia?.analisis ? String(p.resumen_ia.analisis) : "",
    "Resumen IA completo": p.resumen_ia ? excelText(JSON.stringify(p.resumen_ia)) : "",
  }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(notasRows, [14, 16, 55, 55, 70, 55]), "Notas e IA");

  const iaFragmentRows = partes.flatMap((p) => {
    const raw = p.resumen_ia ? JSON.stringify(p.resumen_ia, null, 2) : "";
    return splitExcelText(raw).map((fragmento, index, arr) => ({
      Fecha: formatDate(p.date),
      Campo: "resumen_ia",
      Fragmento: `${index + 1}/${arr.length}`,
      Texto: fragmento,
    }));
  });
  if (iaFragmentRows.length > 0) {
    XLSX.utils.book_append_sheet(wb, sheetFromRows(iaFragmentRows, [14, 18, 12, 100]), "IA fragmentos");
  }

  appendDictionarySheet(wb, [
    { Hoja: "Portada", Campo: "Lectura ejecutiva", Descripcion: "KPIs globales del rango exportado.", Uso: "Revision rapida de direccion." },
    { Hoja: "Detalle diario", Campo: "Una fila por parte", Descripcion: "Tabla principal para filtros, ordenaciones y tablas dinamicas.", Uso: "Trabajar con KPIs diarios." },
    { Hoja: "Detalle diario", Campo: "Abs DJPMN %", Descripcion: "Valor absoluto del descuadre porcentual.", Uso: "Ordenar por gravedad sin importar signo." },
    { Hoja: "Cascada DJPMN", Campo: "Bloque / Concepto / Op / Kg", Descripcion: "Cascada normalizada en formato largo.", Uso: "Crear pivots o auditar formula por parte." },
    { Hoja: "Datos entrada", Campo: "Campos brutos", Descripcion: "Datos originales usados para calcular la cascada.", Uso: "Auditoria y trazabilidad." },
    { Hoja: "Producto", Campo: "Producto, linea, grupo destino", Descripcion: "Detalle de producto cuando lo aporta el analisis.", Uso: "Cruzar produccion por producto y destino." },
    { Hoja: "Palets", Campo: "Palet, cliente, destino, kg neto", Descripcion: "Detalle de palets cuando lo aporta el analisis.", Uso: "Analisis de altas y salidas." },
    { Hoja: "Notas e IA", Campo: "Notas y resumen IA", Descripcion: "Texto operativo del parte. Los textos largos se fragmentan.", Uso: "Contexto de revision." },
  ]);

  saveWorkbook(wb, `partes_${from}_${to}.xlsx`);
}

function drawHeader(doc: jsPDF, pageIndex: number, from: string, to: string, title?: string) {
  drawExportHeader(doc, pageIndex, "Partes diarios", safePdf(`${pdfDate(from)} - ${pdfDate(to)}${title ? ` - ${title}` : ""}`));
}

function drawFooter(doc: jsPDF) {
  drawExportFooter(doc);
}

const PDF_TABLE_MARGIN = { top: 30, bottom: 18, left: 8, right: 8 };

function addAutoTablePageHeader(doc: jsPDF, pageIndexRef: { value: number }, from: string, to: string, title: string) {
  const pages = doc.getNumberOfPages();
  if (pages > pageIndexRef.value) {
    pageIndexRef.value = pages;
    drawHeader(doc, pageIndexRef.value, from, to, title);
    drawFooter(doc);
  }
}

export function exportPartesToPDF(partes: ParteRow[], from: string, to: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const enriched = partes.map((p) => ({ p, c: buildCascade(p) }));
  const pageIndex = { value: 1 };

  const totalProd = enriched.reduce((s, { c }) => s + c.produccion_real, 0);
  const totalPalets = enriched.reduce((s, { c }) => s + c.palets_ajustados, 0);
  const totalDsj = enriched.reduce((s, { c }) => s + c.dsj, 0);
  const totalMermas = enriched.reduce((s, { c }) => s + c.mermas_totales, 0);
  const dsjPctGlobal = totalProd > 0 ? (totalDsj / totalProd) * 100 : 0;
  const nOk = enriched.filter(({ c }) => Math.abs(c.dsj_pct) <= 3).length;
  const nWarn = enriched.filter(({ c }) => Math.abs(c.dsj_pct) > 3 && Math.abs(c.dsj_pct) <= 5).length;
  const nCrit = enriched.filter(({ c }) => Math.abs(c.dsj_pct) > 5).length;

  drawHeader(doc, pageIndex.value, from, to, "Resumen ejecutivo");

  doc.setFillColor(...PDF_THEME.cream);
  doc.roundedRect(8, 26, 281, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...PDF_THEME.primaryDark);
  doc.text("Informe de partes diarios - DJPMN", 148.5, 35, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.muted);
  doc.text(safePdf(`${partes.length} parte(s) - ${pdfDate(from)} al ${pdfDate(to)}`), 148.5, 40, { align: "center" });

  [
    { label: "PRODUCCION REAL", val: pdfKg(totalProd), sub: `${partes.length} partes` },
    { label: "PALETS AJUSTADOS", val: pdfKg(totalPalets), sub: "neto ajustado" },
    { label: "DJPMN TOTAL", val: pdfKg(totalDsj), sub: `${dsjPctGlobal >= 0 ? "+" : ""}${dsjPctGlobal.toFixed(2)}% global` },
    { label: "MERMAS TOTALES", val: pdfKg(totalMermas), sub: "podrido manual" },
    { label: "DIAS CRITICOS", val: `${nCrit}`, sub: "DJPMN > 5%" },
  ].forEach((k, i) => drawKpiCard(doc, 8 + i * 57, 48, 55, k.label, k.val, k.sub));

  const barY = 74;
  const totalSem = nOk + nWarn + nCrit;
  let x = 8;
  [
    { label: "OK", n: nOk, color: PDF_THEME.success },
    { label: "Revisar", n: nWarn, color: PDF_THEME.warning },
    { label: "Critico", n: nCrit, color: PDF_THEME.destructive },
  ].forEach((item) => {
    const width = totalSem > 0 && item.n > 0 ? Math.max(22, (item.n / totalSem) * 281) : 0;
    if (width <= 0) return;
    doc.setFillColor(...item.color);
    doc.roundedRect(x, barY, width, 14, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.white);
    doc.text(`${item.label} ${Math.round((item.n / totalSem) * 100)}%`, x + width / 2, barY + 9, { align: "center" });
    x += width + 1;
  });

  autoTable(doc, {
    startY: 94,
    head: [["Fecha", "Estado", "Prod. real", "Palets ajust.", "Diferencia", "Mermas", "DJPMN", "% DJPMN", "Semaforo"]],
    body: [
      ...enriched.map(({ p, c }) => [
        pdfDate(p.date),
        safePdf(p.estado),
        pdfKg(c.produccion_real),
        pdfKg(c.palets_ajustados),
        pdfKg(c.diferencia_bruta),
        pdfKg(c.mermas_totales),
        pdfKg(c.dsj),
        `${c.dsj_pct >= 0 ? "+" : ""}${c.dsj_pct.toFixed(2)}%`,
        semLabel(c.semaforo),
      ]),
      ["TOTAL", `${partes.length} partes`, pdfKg(totalProd), pdfKg(totalPalets), "", pdfKg(totalMermas), pdfKg(totalDsj), `${dsjPctGlobal >= 0 ? "+" : ""}${dsjPctGlobal.toFixed(2)}%`, ""],
    ],
    margin: PDF_TABLE_MARGIN,
    ...pdfTableTheme(),
    styles: { ...pdfTableTheme().styles, fontSize: 7, cellPadding: 2 },
    headStyles: { ...pdfTableTheme().headStyles, fontSize: 6.8 },
    columnStyles: {
      0: { cellWidth: 22 },
      8: { halign: "right" },
    },
    didParseCell: (data) => {
      if (data.column.index === 8 && data.section === "body") {
        const value = String((data.row.raw as string[])[8] ?? "");
        if (value.startsWith("[OK]")) data.cell.styles.textColor = PDF_THEME.success;
        if (value.startsWith("[!]")) data.cell.styles.textColor = PDF_THEME.warning;
        if (value.startsWith("[X]")) data.cell.styles.textColor = PDF_THEME.destructive;
      }
      if (data.row.index === enriched.length && data.section === "body") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = PDF_THEME.creamStrong;
      }
    },
    didDrawPage: () => addAutoTablePageHeader(doc, pageIndex, from, to, "Resumen ejecutivo"),
  });

  drawFooter(doc);

  enriched.forEach(({ p, c }) => {
    doc.addPage();
    pageIndex.value = doc.getNumberOfPages();
    const detailTitle = `Parte ${pdfDate(p.date)}`;
    drawHeader(doc, pageIndex.value, from, to, detailTitle);

    const sc = semColor(c.semaforo);
    doc.setFillColor(...PDF_THEME.cream);
    doc.roundedRect(8, 26, 281, 14, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...PDF_THEME.primaryDark);
    doc.text(`Parte diario - ${pdfDate(p.date)}`, 14, 35);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(`Estado: ${safePdf(p.estado)}`, 112, 35);
    doc.setFillColor(...sc);
    doc.roundedRect(232, 26, 57, 14, 2, 2, "F");
    doc.setTextColor(...PDF_THEME.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`${c.dsj_pct >= 0 ? "+" : ""}${c.dsj_pct.toFixed(2)}%`, 260.5, 34, { align: "center" });
    doc.setFontSize(6.5);
    doc.text("DJPMN", 260.5, 38, { align: "center" });

    [
      { label: "PROD. REAL", val: pdfKg(c.produccion_real), sub: "Calibrador - ajustes" },
      { label: "PALETS AJUST.", val: pdfKg(c.palets_ajustados), sub: "Alta neta" },
      { label: "MERMAS", val: pdfKg(c.mermas_totales), sub: "Podrido manual" },
      { label: "DJPMN", val: pdfKg(c.dsj), sub: semLabel(c.semaforo) },
    ].forEach((card, i) => drawKpiCard(doc, 8 + i * 70.5, 46, 68, card.label, card.val, card.sub));

    const cascadeRows = [
      ["Produccion real", "Calibrador", "=", pdfKg(c.produccion_calibrador)],
      ["Produccion real", "Mujeres clase L", "-", pdfKg(c.mujeres)],
      ["Produccion real", "Reciclado malla Z1", "-", pdfKg(c.reciclado_z1)],
      ["Produccion real", "Reciclado malla Z2", "-", pdfKg(c.reciclado_z2)],
      ["Produccion real", "Produccion real", "=", pdfKg(c.produccion_real)],
      ["Palets e inventario", "Palets alta bruto", "=", pdfKg(c.palets_brutos)],
      ["Palets e inventario", "Inv. dia anterior", "-", pdfKg(c.inventario_anterior)],
      ["Palets e inventario", "Palets alta ajustados", "=", pdfKg(c.palets_ajustados)],
      ["Mermas y DJPMN", "Produccion real", "=", pdfKg(c.produccion_real)],
      ["Mermas y DJPMN", "Palets alta ajustados", "-", pdfKg(c.palets_ajustados)],
      ["Mermas y DJPMN", "Inventario final sin alta", "-", pdfKg(c.inventario_final)],
      ["Mermas y DJPMN", "Diferencia bruta", "=", pdfKg(c.diferencia_bruta)],
      ["Mermas y DJPMN", "Podrido manual", "-", pdfKg(c.podrido_manual)],
      ["Mermas y DJPMN", "Mermas totales", "=", pdfKg(c.mermas_totales)],
      ["Resultado", "DJPMN", "=", `${pdfKg(c.dsj)} (${c.dsj_pct >= 0 ? "+" : ""}${c.dsj_pct.toFixed(2)}%)`],
    ];

    autoTable(doc, {
      startY: 72,
      head: [["Bloque", "Concepto", "Op.", "Valor"]],
      body: cascadeRows,
      margin: PDF_TABLE_MARGIN,
      ...pdfTableTheme(),
      styles: { ...pdfTableTheme().styles, fontSize: 7.2, cellPadding: 2.1 },
      headStyles: { ...pdfTableTheme().headStyles, fontSize: 6.8 },
      columnStyles: {
        0: { cellWidth: 48 },
        1: { cellWidth: 150 },
        2: { cellWidth: 12, halign: "center" },
        3: { cellWidth: 55, halign: "right", fontStyle: "bold" },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const raw = data.row.raw as string[];
        if (["Produccion real", "Palets alta ajustados", "Diferencia bruta", "Mermas totales", "DJPMN"].includes(raw[1])) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = raw[1] === "DJPMN" ? sc : PDF_THEME.creamStrong;
          if (raw[1] === "DJPMN") data.cell.styles.textColor = PDF_THEME.white;
        }
      },
      didDrawPage: () => addAutoTablePageHeader(doc, pageIndex, from, to, detailTitle),
    });

    const rawStartY = ((doc as any).lastAutoTable?.finalY ?? 72) + 6;
    const rawRows = [
      ["Calibrador", pdfKg(n(p.kg_produccion_calibrador)), "Base de produccion"],
      ["Industria manual", pdfKg(n(p.kg_industria_manual)), "Dato bruto registrado"],
      ["Mujeres clase L", pdfKg(n(p.kg_mujeres_calibrador)), "Resta en produccion real"],
      ["Reciclado malla Z1", pdfKg(n(p.kg_reciclado_malla_z1)), "Resta en produccion real"],
      ["Reciclado malla Z2", pdfKg(n(p.kg_reciclado_malla_z2)), "Resta en produccion real"],
      ["Palets brutos", pdfKg(n(p.kg_palets_brutos)), "Alta bruta"],
      ["Palets Egipto", pdfKg(n(p.kg_palets_egipto)), "Descontado del bruto"],
      ["Inv. dia anterior", pdfKg(n(p.kg_inventario_anterior_sin_alta)), "Ajuste de palets"],
      ["Inv. final sin alta", pdfKg(n(p.kg_inventario_sin_alta)), "Resta en diferencia bruta"],
      ["Podrido calibrador", pdfKg(n(p.kg_podrido_calibrador_auto)), "Dato informativo"],
      ["Podrido manual", pdfKg(n(p.kg_podrido_bolsa_basura)), "Merma usada en DJPMN"],
    ];

    autoTable(doc, {
      startY: rawStartY,
      head: [["Datos de entrada", "Valor", "Uso"]],
      body: rawRows,
      margin: PDF_TABLE_MARGIN,
      ...pdfTableTheme(),
      styles: { ...pdfTableTheme().styles, fontSize: 6.8, cellPadding: 1.8 },
      headStyles: { ...pdfTableTheme().headStyles, fontSize: 6.5 },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 45, halign: "right", fontStyle: "bold" },
        2: { cellWidth: 150 },
      },
      didDrawPage: () => addAutoTablePageHeader(doc, pageIndex, from, to, `${detailTitle} - datos entrada`),
    });

    let noteY = ((doc as any).lastAutoTable?.finalY ?? rawStartY) + 6;
    const noteBlocks = [
      { title: "Notas generales", text: p.notas_generales },
      { title: "Notas inventario", text: p.notas_inventario },
      { title: "Analisis IA", text: p.resumen_ia?.analisis ? String(p.resumen_ia.analisis) : "" },
    ].filter((block) => block.text);

    for (const block of noteBlocks) {
      if (noteY > 178) {
        doc.addPage();
        pageIndex.value = doc.getNumberOfPages();
        drawHeader(doc, pageIndex.value, from, to, `${detailTitle} - notas`);
        noteY = 28;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...PDF_THEME.primaryDark);
      doc.text(safePdf(block.title), 8, noteY);
      noteY += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...PDF_THEME.muted);
      const lines = doc.splitTextToSize(safePdf(block.text), 281);
      doc.text(lines, 8, noteY);
      noteY += lines.length * 3.4 + 4;
    }

    drawFooter(doc);
  });

  doc.save(`partes_${from}_${to}.pdf`);
}
