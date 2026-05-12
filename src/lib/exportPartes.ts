import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { computeCascade, CascadeInput, CascadeResult } from "./cascade";
import { formatDate, formatKg, formatPct } from "./format";

export interface ParteRow {
  id: string;
  date: string;
  estado: string;
  kg_produccion_calibrador?: number | null;
  kg_mujeres_calibrador?: number | null;
  kg_palets_brutos?: number | null;
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

function buildCascade(p: ParteRow): CascadeResult {
  const input: CascadeInput = {
    kg_produccion_calibrador: Number(p.kg_produccion_calibrador) || 0,
    kg_mujeres_calibrador: Number(p.kg_mujeres_calibrador) || 0,
    kg_palets_brutos: Number(p.kg_palets_brutos) || 0,
    kg_podrido_calibrador: Number(p.kg_podrido_calibrador_auto) || 0,
    kg_industria_manual: Number(p.kg_industria_manual) || 0,
    kg_reciclado_malla_z1: Number(p.kg_reciclado_malla_z1) || 0,
    kg_reciclado_malla_z2: Number(p.kg_reciclado_malla_z2) || 0,
    kg_inventario_sin_alta: Number(p.kg_inventario_sin_alta) || 0,
    kg_podrido_bolsa_basura: Number(p.kg_podrido_bolsa_basura) || 0,
    kg_inventario_anterior_sin_alta: Number(p.kg_inventario_anterior_sin_alta) || 0,
  };
  return computeCascade(input);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL
// ─────────────────────────────────────────────────────────────────────────────

export function exportPartesToExcel(partes: ParteRow[], from: string, to: string) {
  const enriched = partes.map((p) => ({ p, c: buildCascade(p) }));
  const wb = XLSX.utils.book_new();

  // ── Hoja 1: Resumen ejecutivo ─────────────────────────────────────────────
  const totalProd     = enriched.reduce((s, { c }) => s + c.produccion_real, 0);
  const totalPalets   = enriched.reduce((s, { c }) => s + c.palets_ajustados, 0);
  const totalDsj      = enriched.reduce((s, { c }) => s + c.dsj, 0);
  const totalMermas   = enriched.reduce((s, { c }) => s + c.mermas_totales, 0);
  const dsjPctGlobal  = totalProd ? (totalDsj / totalProd) * 100 : 0;
  const nAlerta       = enriched.filter(({ c }) => Math.abs(c.dsj_pct) > 5).length;
  const nAmarillo     = enriched.filter(({ c }) => Math.abs(c.dsj_pct) > 3 && Math.abs(c.dsj_pct) <= 5).length;
  const nOk           = enriched.filter(({ c }) => Math.abs(c.dsj_pct) <= 3).length;

  const resumenAOA: (string | number)[][] = [
    ["HERRAMIENTA LASARTE - INFORME DE PARTES DIARIOS"],
    [`Periodo: ${formatDate(from)}  -  ${formatDate(to)}`],
    [`Generado: ${new Date().toLocaleString("es-ES")}`],
    [],
    ["RESUMEN GLOBAL"],
    ["Indicador", "Valor"],
    ["Nº de partes", partes.length],
    ["Producción real total (kg)", +totalProd.toFixed(2)],
    ["Palets alta ajustados (kg)", +totalPalets.toFixed(2)],
    ["DJPMN total (kg)", +totalDsj.toFixed(2)],
    ["DJPMN global (%)", +dsjPctGlobal.toFixed(3)],
    ["Mermas totales (kg)", +totalMermas.toFixed(2)],
    [],
    ["DISTRIBUCIÓN POR SEMÁFORO"],
    ["Semáforo", "Nº partes", "%"],
    ["[OK] Verde  (< 1%)", nOk,       +(partes.length ? nOk / partes.length * 100 : 0).toFixed(1)],
    ["[!] Amarillo (1-3%)", nAmarillo, +(partes.length ? nAmarillo / partes.length * 100 : 0).toFixed(1)],
    ["[X] Rojo   (> 3%)", nAlerta,   +(partes.length ? nAlerta / partes.length * 100 : 0).toFixed(1)],
    [],
    ["DISTRIBUCIÓN POR ESTADO"],
    ["Estado", "Nº partes", "%"],
    ...["Borrador", "Analizado", "Con descuadre", "Validado"].map((e) => {
      const n = partes.filter((p) => p.estado === e).length;
      return [e, n, +(partes.length ? n / partes.length * 100 : 0).toFixed(1)];
    }),
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenAOA);
  wsResumen["!cols"] = [{ wch: 38 }, { wch: 22 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  // ── Hoja 2: Detalle por parte ─────────────────────────────────────────────
  const headers = [
    "Fecha", "Estado",
    "Calib. (kg)", "Industria (kg)", "Mujeres L (kg)", "Recic. Z1 (kg)", "Recic. Z2 (kg)",
    "Prod. Real (kg)",
    "Palets brutos (kg)", "Inv. ant. (kg)", "Inv. final (kg)", "Palets ajust. (kg)",
    "Dif. bruta (kg)",
    "Podrido cal. (kg)", "Podrido manual (kg)", "Mermas total (kg)",
    "DJPMN (kg)", "DJPMN (%)", "Semáforo",
    "Notas generales", "Notas inventario",
  ];

  const detalleRows = enriched.map(({ p, c }) => [
    formatDate(p.date),
    p.estado,
    Number(p.kg_produccion_calibrador) || 0,
    Number(p.kg_industria_manual) || 0,
    Number(p.kg_mujeres_calibrador) || 0,
    Number(p.kg_reciclado_malla_z1) || 0,
    Number(p.kg_reciclado_malla_z2) || 0,
    +c.produccion_real.toFixed(2),
    Number(p.kg_palets_brutos) || 0,
    Number(p.kg_inventario_anterior_sin_alta) || 0,
    Number(p.kg_inventario_sin_alta) || 0,
    +c.palets_ajustados.toFixed(2),
    +c.diferencia_bruta.toFixed(2),
    Number(p.kg_podrido_calibrador_auto) || 0,
    Number(p.kg_podrido_bolsa_basura) || 0,
    +c.mermas_totales.toFixed(2),
    +c.dsj.toFixed(2),
    +c.dsj_pct.toFixed(3),
    c.semaforo === "verde" ? "[OK]" : c.semaforo === "amarillo" ? "[!] Revisar" : "[X] Critico",
    p.notas_generales ?? "",
    p.notas_inventario ?? "",
  ]);

  const totalsRow: (string | number)[] = [
    "TOTAL", `${partes.length} partes`,
    enriched.reduce((s, { p }) => s + (Number(p.kg_produccion_calibrador) || 0), 0),
    enriched.reduce((s, { p }) => s + (Number(p.kg_industria_manual) || 0), 0),
    enriched.reduce((s, { p }) => s + (Number(p.kg_mujeres_calibrador) || 0), 0),
    enriched.reduce((s, { p }) => s + (Number(p.kg_reciclado_malla_z1) || 0), 0),
    enriched.reduce((s, { p }) => s + (Number(p.kg_reciclado_malla_z2) || 0), 0),
    +totalProd.toFixed(2),
    enriched.reduce((s, { p }) => s + (Number(p.kg_palets_brutos) || 0), 0),
    "", "",
    +totalPalets.toFixed(2),
    "",
    enriched.reduce((s, { p }) => s + (Number(p.kg_podrido_calibrador_auto) || 0), 0),
    enriched.reduce((s, { p }) => s + (Number(p.kg_podrido_bolsa_basura) || 0), 0),
    +totalMermas.toFixed(2),
    +totalDsj.toFixed(2),
    +dsjPctGlobal.toFixed(3),
    "", "", "",
  ];

  const wsDetalle = XLSX.utils.aoa_to_sheet([headers, ...detalleRows, totalsRow]);
  wsDetalle["!cols"] = [
    { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 13 },
    { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
    { wch: 14 }, { wch: 15 }, { wch: 16 }, { wch: 15 },
    { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 32 }, { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle partes");

  // ── Hoja 3: Cascada (cada parte en columna) ───────────────────────────────
  const cascadeRows: (string | number)[][] = [
    ["CASCADA DJPMN POR PARTE"],
    [],
    ["Concepto", "Op.", ...enriched.map(({ p }) => formatDate(p.date))],
    ["Estado", "",    ...enriched.map(({ p }) => p.estado)],
    [],
    ["-- PRODUCCION --", "", ...enriched.map(() => "")],
    ["Calibrador (kg)",          "=", ...enriched.map(({ c }) => +c.produccion_calibrador.toFixed(2))],
    ["+ Industria manual (kg)",  "+", ...enriched.map(({ c }) => +c.industria_manual.toFixed(2))],
    ["- Mujeres L (kg)",         "-", ...enriched.map(({ c }) => +c.mujeres.toFixed(2))],
    ["- Reciclado Z1 (kg)",      "-", ...enriched.map(({ c }) => +c.reciclado_z1.toFixed(2))],
    ["- Reciclado Z2 (kg)",      "-", ...enriched.map(({ c }) => +c.reciclado_z2.toFixed(2))],
    ["= PRODUCCION REAL (kg)",   "=", ...enriched.map(({ c }) => +c.produccion_real.toFixed(2))],
    [],
    ["-- PALETS --", "", ...enriched.map(() => "")],
    ["Palets brutos (kg)",       "",  ...enriched.map(({ c }) => +c.palets_brutos.toFixed(2))],
    ["- Inv. dia anterior (kg)", "-", ...enriched.map(({ c }) => +c.inventario_anterior.toFixed(2))],
    ["- Inv. final sin alta (kg)","-", ...enriched.map(({ c }) => +c.inventario_final.toFixed(2))],
    ["= PALETS AJUSTADOS (kg)",  "=", ...enriched.map(({ c }) => +c.palets_ajustados.toFixed(2))],
    [],
    ["-- DJPMN --", "", ...enriched.map(() => "")],
    ["Diferencia bruta (kg)",    "=", ...enriched.map(({ c }) => +c.diferencia_bruta.toFixed(2))],
    ["- Podrido calibrador (kg)","-", ...enriched.map(({ c }) => +c.podrido_calibrador.toFixed(2))],
    ["- Podrido manual (kg)",    "-", ...enriched.map(({ c }) => +c.podrido_manual.toFixed(2))],
    ["= MERMAS TOTALES (kg)",    "=", ...enriched.map(({ c }) => +c.mermas_totales.toFixed(2))],
    ["DJPMN (kg)",               "=", ...enriched.map(({ c }) => +c.dsj.toFixed(2))],
    ["DJPMN (%)",                "",  ...enriched.map(({ c }) => +c.dsj_pct.toFixed(3))],
    ["Semáforo",                 "",  ...enriched.map(({ c }) =>
      c.semaforo === "verde" ? "✓ OK" : c.semaforo === "amarillo" ? "⚠ Revisar" : "✗ Crítico"
    )],
  ];
  const wsCascada = XLSX.utils.aoa_to_sheet(cascadeRows);
  wsCascada["!cols"] = [{ wch: 32 }, { wch: 5 }, ...enriched.map(() => ({ wch: 14 }))];
  XLSX.utils.book_append_sheet(wb, wsCascada, "Cascada");

  // ── Hoja 4: Notas y análisis IA ───────────────────────────────────────────
  const ia = partes.map((p) => ({
    Fecha: formatDate(p.date),
    Estado: p.estado,
    "Notas generales": p.notas_generales ?? "",
    "Notas inventario": p.notas_inventario ?? "",
    "Análisis IA": p.resumen_ia?.analisis ? String(p.resumen_ia.analisis) : "",
    "Resumen IA (raw)": p.resumen_ia ? JSON.stringify(p.resumen_ia) : "",
  }));
  const wsIA = XLSX.utils.json_to_sheet(ia);
  wsIA["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 50 }, { wch: 50 }, { wch: 60 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsIA, "Notas e IA");

  XLSX.writeFile(wb, `partes_${from}_${to}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────────────

const C_VERDE  = [30, 70, 50]   as [number, number, number];
const C_NARANJA = [218, 101, 0] as [number, number, number];
const C_CREMA  = [252, 248, 240] as [number, number, number];
const C_GRIS   = [110, 110, 110] as [number, number, number];
const C_WHITE  = [255, 255, 255] as [number, number, number];
const C_SEM_OK    = [34, 120, 74]  as [number, number, number];
const C_SEM_WARN  = [174,  97,   9] as [number, number, number];
const C_SEM_ERROR = [168,  32,  32] as [number, number, number];

function semColor(s: "verde" | "amarillo" | "rojo"): [number, number, number] {
  return s === "verde" ? C_SEM_OK : s === "amarillo" ? C_SEM_WARN : C_SEM_ERROR;
}
function semLabel(s: "verde" | "amarillo" | "rojo"): string {
  return s === "verde" ? "[OK] < 1%" : s === "amarillo" ? "[!] Revisar 1-3%" : "[X] Critico > 3%";
}

export function exportPartesToPDF(partes: ParteRow[], from: string, to: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const enriched = partes.map((p) => ({ p, c: buildCascade(p) }));

  const totalProd    = enriched.reduce((s, { c }) => s + c.produccion_real, 0);
  const totalPalets  = enriched.reduce((s, { c }) => s + c.palets_ajustados, 0);
  const totalDsj     = enriched.reduce((s, { c }) => s + c.dsj, 0);
  const totalMermas  = enriched.reduce((s, { c }) => s + c.mermas_totales, 0);
  const dsjPctGlobal = totalProd ? (totalDsj / totalProd) * 100 : 0;
  const nAlerta      = enriched.filter(({ c }) => Math.abs(c.dsj_pct) > 5).length;

  let pageIndex = 0;

  function drawPageHeader(title?: string) {
    // Top bar
    doc.setFillColor(...C_VERDE);
    doc.rect(0, 0, 297, 14, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...C_WHITE);
    doc.text("HERRAMIENTA LASARTE", 8, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(`${formatDate(from)} - ${formatDate(to)}`, 8, 13);
    doc.text(`Generado: ${new Date().toLocaleString("es-ES")}`, 200, 9);
    doc.text(`Pág. ${pageIndex}`, 289, 13, { align: "right" });
    if (title) {
      doc.setFontSize(7);
      doc.setTextColor(...C_GRIS);
      doc.text(title, 289, 9, { align: "right" });
    }
  }

  // ── Página 1: Portada + KPIs + Tabla resumen ─────────────────────────────
  pageIndex++;
  drawPageHeader("Resumen ejecutivo");

  // Título
  doc.setFillColor(...C_CREMA);
  doc.roundedRect(8, 17, 281, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...C_VERDE);
  doc.text("Informe de Partes Diarios - DJPMN", 148.5, 26, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...C_GRIS);
  doc.text(`${partes.length} parte(s) · ${formatDate(from)} al ${formatDate(to)}`, 148.5, 31, { align: "center" });

  // KPI cards (5 tarjetas)
  const kpis = [
    { label: "PRODUCCIÓN REAL", val: formatKg(totalProd),    sub: `${partes.length} partes` },
    { label: "PALETS AJUSTADOS",val: formatKg(totalPalets),  sub: "neto ajustado" },
    { label: "DJPMN TOTAL",     val: formatKg(totalDsj),     sub: `${dsjPctGlobal >= 0 ? "+" : ""}${dsjPctGlobal.toFixed(2)}% global` },
    { label: "MERMAS TOTALES",  val: formatKg(totalMermas),  sub: "podrido + natural" },
    { label: "PARTES CRÍTICOS", val: `${nAlerta}`,           sub: "DJPMN > 3%" },
  ];

  kpis.forEach((k, i) => {
    const x = 8 + i * 57;
    doc.setFillColor(...C_WHITE);
    doc.setDrawColor(...C_NARANJA);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, 36, 55, 20, 1.5, 1.5, "FD");
    // accent top bar
    doc.setFillColor(...C_NARANJA);
    doc.rect(x, 36, 55, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(...C_GRIS);
    doc.text(k.label, x + 27.5, 41.5, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...C_VERDE);
    doc.text(k.val, x + 27.5, 49, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...C_GRIS);
    doc.text(k.sub, x + 27.5, 53.5, { align: "center" });
  });

  // Tabla resumen de todos los partes
  autoTable(doc, {
    startY: 59,
    head: [[
      "Fecha", "Estado",
      "Prod. Real (kg)", "Palets Ajust. (kg)",
      "Dif. Bruta (kg)", "Podrido Cal. (kg)", "Podrido Manual (kg)",
      "Mermas (kg)", "DJPMN (kg)", "DJPMN (%)", "Semáforo",
    ]],
    body: [
      ...enriched.map(({ p, c }) => [
        formatDate(p.date),
        p.estado,
        formatKg(c.produccion_real),
        formatKg(c.palets_ajustados),
        formatKg(c.diferencia_bruta),
        formatKg(c.podrido_calibrador),
        formatKg(c.podrido_manual),
        formatKg(c.mermas_totales),
        formatKg(c.dsj),
        `${c.dsj_pct >= 0 ? "+" : ""}${c.dsj_pct.toFixed(2)}%`,
        semLabel(c.semaforo),
      ]),
      // Fila de totales
      [
        "TOTAL", `${partes.length} partes`,
        formatKg(totalProd), formatKg(totalPalets),
        "", "", "",
        formatKg(totalMermas), formatKg(totalDsj),
        `${dsjPctGlobal >= 0 ? "+" : ""}${dsjPctGlobal.toFixed(2)}%`,
        "",
      ],
    ],
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: C_VERDE, textColor: C_WHITE, fontStyle: "bold", fontSize: 6.5 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 22 },
      8: { halign: "right" },
      9: { halign: "right" },
    },
    alternateRowStyles: { fillColor: [250, 248, 244] },
    didParseCell: (data) => {
      // Semáforo en color
      if (data.column.index === 10 && data.section === "body") {
        const v = String((data.row.raw as string[])[10] ?? "");
        if (v.startsWith("[OK]")) data.cell.styles.textColor = C_SEM_OK;
        else if (v.startsWith("[!]")) data.cell.styles.textColor = C_SEM_WARN;
        else if (v.startsWith("[X]")) data.cell.styles.textColor = C_SEM_ERROR;
      }
      // Fila total en negrita
      const isTotal = data.row.index === enriched.length && data.section === "body";
      if (isTotal) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [238, 234, 224];
      }
    },
    didDrawPage: () => {
      // autoTable puede crear páginas extra; les añadimos cabecera
      const pages = doc.getNumberOfPages();
      if (pages > pageIndex) {
        pageIndex++;
        drawPageHeader("Resumen ejecutivo (cont.)");
      }
    },
  });

  // ── Una página por parte: cascada detallada ───────────────────────────────
  enriched.forEach(({ p, c }) => {
    doc.addPage();
    pageIndex++;
    drawPageHeader(`Parte · ${formatDate(p.date)}`);

    // Encabezado del parte
    doc.setFillColor(...C_CREMA);
    doc.roundedRect(8, 17, 281, 13, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...C_VERDE);
    doc.text(`Parte diario - ${formatDate(p.date)}`, 14, 25);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C_GRIS);
    doc.text(`Estado: ${p.estado}`, 110, 25);

    // Semáforo box (esquina derecha)
    const sc = semColor(c.semaforo);
    doc.setFillColor(...sc);
    doc.roundedRect(232, 17, 57, 13, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...C_WHITE);
    doc.text(`${c.dsj_pct >= 0 ? "+" : ""}${c.dsj_pct.toFixed(2)}%`, 260.5, 25, { align: "center" });
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.text("DJPMN", 260.5, 28.5, { align: "center" });

    // Cascada (tabla izquierda) + KPIs (derecha)
    const cascadeBody: (string | [string, object])[][] = [
      ["Produccion calibrador",        "=", formatKg(c.produccion_calibrador)],
      ["+ Industria / Citricos manual","+", formatKg(c.industria_manual)],
      ["- Mujeres clase L",            "-", formatKg(c.mujeres)],
      ["- Reciclado malla Z1",         "-", formatKg(c.reciclado_z1)],
      ["- Reciclado malla Z2",         "-", formatKg(c.reciclado_z2)],
      ["PRODUCCION REAL",              "=", formatKg(c.produccion_real)],
      ["Palets alta (bruto)",          "",  formatKg(c.palets_brutos)],
      ["- Inv. dia anterior (en palets)","-",formatKg(c.inventario_anterior)],
      ["- Inventario final sin alta",  "-", formatKg(c.inventario_final)],
      ["PALETS ALTA AJUSTADOS",        "=", formatKg(c.palets_ajustados)],
      ["DIFERENCIA BRUTA",             "=", formatKg(c.diferencia_bruta)],
      ["- Podrido calibrador",         "-", formatKg(c.podrido_calibrador)],
      ["- Podrido manual (bolsa basura)","-",formatKg(c.podrido_manual)],
      ["MERMAS TOTALES",               "=", formatKg(c.mermas_totales)],
      ["DJPMN",                        "=", `${formatKg(c.dsj)}  (${c.dsj_pct >= 0 ? "+" : ""}${c.dsj_pct.toFixed(2)}%)`],
    ];

    const emphRows = new Set([5, 9, 10, 13, 14]);

    autoTable(doc, {
      startY: 33,
      tableWidth: 155,
      head: [["Concepto", "Op.", "Valor (kg)"]],
      body: cascadeBody as any,
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: C_VERDE, textColor: C_WHITE, fontStyle: "bold", fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 12, halign: "center", textColor: C_GRIS as any },
        2: { cellWidth: 43, halign: "right", fontStyle: "bold" },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (emphRows.has(data.row.index)) {
          data.cell.styles.fillColor = [238, 234, 224];
          data.cell.styles.fontStyle = "bold";
        }
        if (data.row.index === 14) {
          data.cell.styles.fillColor = sc;
          data.cell.styles.textColor = C_WHITE;
        }
      },
    });

    // Panel de datos brutos (derecha)
    const panelX = 168;
    let panelY = 33;
    const panelW = 121;

    function miniCard(label: string, val: string, color: [number,number,number] = C_VERDE) {
      doc.setFillColor(248, 245, 240);
      doc.setDrawColor(210, 205, 195);
      doc.setLineWidth(0.3);
      doc.roundedRect(panelX, panelY, panelW, 14, 1.5, 1.5, "FD");
      // accent left
      doc.setFillColor(...color);
      doc.rect(panelX, panelY, 2, 14, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...C_GRIS);
      doc.text(label.toUpperCase(), panelX + 5, panelY + 5);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...color);
      doc.text(val, panelX + panelW - 4, panelY + 11, { align: "right" });
      panelY += 16;
    }

    miniCard("Producción real",    formatKg(c.produccion_real),    C_VERDE);
    miniCard("Palets ajustados",   formatKg(c.palets_ajustados),   C_NARANJA);
    miniCard("Diferencia bruta",   formatKg(c.diferencia_bruta),   C_GRIS);
    miniCard("Mermas totales",     formatKg(c.mermas_totales),     C_GRIS);
    miniCard("DJPMN",              formatKg(c.dsj),                sc);
    panelY += 2;

    // Semáforo grande en el panel
    doc.setFillColor(...sc);
    doc.roundedRect(panelX, panelY, panelW, 18, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...C_WHITE);
    doc.text(`${c.dsj_pct >= 0 ? "+" : ""}${c.dsj_pct.toFixed(2)}%`, panelX + panelW / 2, panelY + 9, { align: "center" });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(semLabel(c.semaforo), panelX + panelW / 2, panelY + 15, { align: "center" });
    panelY += 22;

    // Datos de entrada brutos
    const rawFields: [string, number | null | undefined][] = [
      ["Calibrador",   p.kg_produccion_calibrador],
      ["Industria",    p.kg_industria_manual],
      ["Mujeres (L)",  p.kg_mujeres_calibrador],
      ["Recic. Z1",    p.kg_reciclado_malla_z1],
      ["Recic. Z2",    p.kg_reciclado_malla_z2],
      ["Palets brutos",p.kg_palets_brutos],
      ["Inv. anterior",p.kg_inventario_anterior_sin_alta],
      ["Inv. final",   p.kg_inventario_sin_alta],
      ["Podrido cal.", p.kg_podrido_calibrador_auto],
      ["Podrido man.", p.kg_podrido_bolsa_basura],
    ];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...C_VERDE);
    doc.text("DATOS DE ENTRADA", panelX, panelY + 3);
    panelY += 6;
    doc.setLineWidth(0.2);
    rawFields.forEach(([label, val]) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...C_GRIS);
      doc.text(label, panelX + 2, panelY);
      doc.setTextColor(...C_VERDE);
      doc.setFont("helvetica", "bold");
      doc.text(formatKg(Number(val) || 0), panelX + panelW - 2, panelY, { align: "right" });
      doc.setDrawColor(220, 215, 205);
      doc.line(panelX, panelY + 1.5, panelX + panelW, panelY + 1.5);
      panelY += 7;
    });

    // Notas y análisis IA
    let notaY = (doc as any).lastAutoTable.finalY + 5;
    notaY = Math.max(notaY, 33 + 5 * 16 + 22 + 6 * 7 + 14);

    const hasNotas = p.notas_generales || p.notas_inventario;
    const hasIA = p.resumen_ia?.analisis;

    if (hasNotas || hasIA) {
      doc.setDrawColor(...C_VERDE);
      doc.setLineWidth(0.3);
      doc.line(8, notaY, 162, notaY);
      notaY += 4;

      if (p.notas_generales) {
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...C_VERDE);
        doc.text("Notas generales:", 8, notaY);
        notaY += 4;
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C_GRIS);
        const lines = doc.splitTextToSize(p.notas_generales, 154);
        doc.text(lines, 8, notaY);
        notaY += lines.length * 4 + 3;
      }
      if (p.notas_inventario) {
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...C_VERDE);
        doc.text("Notas inventario:", 8, notaY);
        notaY += 4;
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C_GRIS);
        const lines = doc.splitTextToSize(p.notas_inventario, 154);
        doc.text(lines, 8, notaY);
        notaY += lines.length * 4 + 3;
      }
      if (hasIA) {
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...C_NARANJA);
        doc.text("Análisis IA:", 8, notaY);
        notaY += 4;
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C_GRIS);
        const lines = doc.splitTextToSize(String(p.resumen_ia.analisis), 154);
        doc.text(lines, 8, notaY);
      }
    }
  });

  doc.save(`partes_${from}_${to}.pdf`);
}
