/**
 * cierreMensual.ts — lib PURA (sin red) del cierre mensual automático.
 *
 * El día 1 de cada mes, la edge function cierre-mensual manda el resumen del
 * mes CERRADO: entradas, calibrado por destino, podrido, kg por persona,
 * merma de los lotes terminados en el mes, ventas a Mercadona y la foto del
 * stock — con la comparación contra el mes anterior al lado, porque un número
 * solo no dice si el mes fue bueno.
 *
 * Mismas reglas de la casa que el informe semanal: cada cifra sale de la
 * MISMA función pura que usa la app (computeRentabilidadDia, computeMermaLotes
 * vía campanaEdge, seleccionarMermaSemana con el rango del mes), los huecos se
 * enseñan como huecos y el texto es determinista, cero LLM.
 *
 * VIVE EN _shared (patrón informeSemanal): lo importa la edge function
 * cierre-mensual (Deno) y lo prueba vitest desde src/lib/cierreMensual.test.ts.
 */
import {
  DESTINO_LABEL,
  DESTINOS_ORDEN,
  type DestinoRentabilidad,
} from "./rentabilidadDia.ts";
import { fmtKg, type MermaSemanaInforme, type StockInforme } from "./informeSemanal.ts";

// ---------------------------------------------------------------------------
// Meses
// ---------------------------------------------------------------------------

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export interface MesRef {
  anio: number;
  mes: number;
}

/** Primer y último día (ISO) de un mes. */
export function rangoMes(anio: number, mes: number): { desde: string; hasta: string } {
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return { desde, hasta: `${anio}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}` };
}

/** El mes anterior al de la fecha dada (el que cubre el correo del día 1). */
export function mesAnteriorDe(fechaISO: string): MesRef {
  const [y, m] = fechaISO.split("-").map(Number);
  return m === 1 ? { anio: y - 1, mes: 12 } : { anio: y, mes: m - 1 };
}

export function mesAnteriorA(ref: MesRef): MesRef {
  return ref.mes === 1 ? { anio: ref.anio - 1, mes: 12 } : { anio: ref.anio, mes: ref.mes - 1 };
}

export function etiquetaMes(ref: MesRef): string {
  return `${MESES[ref.mes - 1]} de ${ref.anio}`;
}

// ---------------------------------------------------------------------------
// Entrada y resultado
// ---------------------------------------------------------------------------

/** Los agregados de UN mes, ya calculados por la edge con las libs de la casa. */
export interface MesDatos {
  anio: number;
  mes: number;
  kgEntrada: number;
  numEntradas: number;
  diasConProduccion: number;
  kgCalibrado: number;
  kgPorDestino: Record<DestinoRentabilidad, number>;
  kgPodrido: number;
  kgIndustria: number;
  /** Σ presentes de los días con producción y asistencia (para kg/persona). */
  sumaPresentes: number;
  kgConAsistencia: number;
  /** Kg vendidos a Mercadona en el mes (erp_palet, pesada real). */
  kgMercadona: number;
  /** Merma de los lotes TERMINADOS en el mes (seleccionarMermaSemana con el rango del mes). */
  merma: MermaSemanaInforme | null;
}

export interface CierreMensual {
  actual: MesDatos;
  anterior: MesDatos | null;
  stock: StockInforme | null;
  pctPodrido: number | null;
  pctIndustria: number | null;
  kgPorPersonaDia: number | null;
  pctMercadona: number | null;
  avisos: string[];
}

function pctDe(parte: number, total: number): number | null {
  return total > 0 ? (parte / total) * 100 : null;
}

export function computeCierreMensual(
  actual: MesDatos,
  anterior: MesDatos | null,
  stock: StockInforme | null,
): CierreMensual {
  const avisos: string[] = [];
  if (actual.diasConProduccion === 0) {
    avisos.push("Ningún día del mes tiene Informes LOTE del calibrador cargados. Si se calibró, falta importar.");
  }
  if (actual.kgCalibrado > 0 && actual.sumaPresentes === 0) {
    avisos.push("El mes no tiene asistencia cargada: sin presentes no hay kg por persona.");
  }
  if ((actual.merma?.nConDatoARevisar ?? 0) > 0) {
    avisos.push(
      `${actual.merma!.nConDatoARevisar} lote(s) terminados en el mes con el calibrador pesando MÁS que la báscula: dato a revisar, no merma real.`,
    );
  }
  return {
    actual,
    anterior,
    stock,
    pctPodrido: pctDe(actual.kgPodrido, actual.kgCalibrado),
    pctIndustria: pctDe(actual.kgIndustria, actual.kgCalibrado),
    kgPorPersonaDia: actual.sumaPresentes > 0 ? actual.kgConAsistencia / actual.sumaPresentes : null,
    pctMercadona: pctDe(actual.kgMercadona, actual.kgCalibrado),
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

const NF_ENTERO = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const NF_DECIMAL = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${NF_DECIMAL.format(v)} %`;
}

/** "+12,3 %" / "−4,1 %" / "—" — variación de un mes contra el anterior. */
export function fmtVariacion(actual: number, anterior: number | null | undefined): string {
  if (anterior == null || anterior <= 0) return "—";
  const pct = ((actual - anterior) / anterior) * 100;
  const signo = pct >= 0 ? "+" : "−";
  return `${signo}${NF_DECIMAL.format(Math.abs(pct))} %`;
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function asuntoCierreMensual(c: CierreMensual): string {
  const ref = { anio: c.actual.anio, mes: c.actual.mes };
  if (c.actual.diasConProduccion === 0) {
    return `Cierre de ${etiquetaMes(ref)} — sin datos de producción`;
  }
  return `Cierre de ${etiquetaMes(ref)} — ${fmtKg(c.actual.kgCalibrado)} calibrados · podrido ${fmtPct(c.pctPodrido)}`;
}

// ---------------------------------------------------------------------------
// Render (mismo lenguaje visual que el informe semanal)
// ---------------------------------------------------------------------------

const TD = 'style="padding:7px 10px;border-bottom:1px solid #e7e9f1;font-size:13px;color:#30354a;"';
const TD_NUM = 'style="padding:7px 10px;border-bottom:1px solid #e7e9f1;font-size:13px;color:#30354a;text-align:right;white-space:nowrap;"';
const TH = 'style="padding:7px 10px;border-bottom:2px solid #22295c;font-size:11px;color:#6e7488;text-transform:uppercase;letter-spacing:.6px;text-align:left;"';
const TH_NUM = 'style="padding:7px 10px;border-bottom:2px solid #22295c;font-size:11px;color:#6e7488;text-transform:uppercase;letter-spacing:.6px;text-align:right;"';

function seccion(titulo: string, cuerpo: string): string {
  return `<tr><td style="padding:22px 36px 0;">
    <h2 style="margin:0 0 10px;color:#22295c;font-size:16px;">${escaparHtml(titulo)}</h2>
    ${cuerpo}
  </td></tr>`;
}

function kpi(etiqueta: string, valor: string, pie: string): string {
  return `<td style="padding:12px 14px;background:#eef0f8;border-radius:12px;vertical-align:top;">
    <p style="margin:0;color:#6e7488;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;">${escaparHtml(etiqueta)}</p>
    <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#22295c;">${escaparHtml(valor)}</p>
    <p style="margin:4px 0 0;color:#6e7488;font-size:12px;">${escaparHtml(pie)}</p>
  </td>`;
}

const MAX_LOTES_MERMA = 10;

export function renderCierreMensualHtml(c: CierreMensual): string {
  const a = c.actual;
  const ant = c.anterior;
  const refMes = etiquetaMes({ anio: a.anio, mes: a.mes });

  const avisosHtml = c.avisos.length > 0
    ? seccion("Datos que faltan", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fdf6e3;border:1px solid #e8d9a0;border-radius:10px;">
        ${c.avisos.map((x) => `<tr><td style="padding:9px 14px;font-size:13px;color:#7a5c12;line-height:1.5;">• ${escaparHtml(x)}</td></tr>`).join("")}
      </table>`)
    : "";

  const filaComparada = (concepto: string, actual: string, anterior: string, variacion: string): string => `<tr>
    <td ${TD}>${escaparHtml(concepto)}</td>
    <td ${TD_NUM}><strong>${escaparHtml(actual)}</strong></td>
    <td ${TD_NUM}>${escaparHtml(anterior)}</td>
    <td ${TD_NUM}>${escaparHtml(variacion)}</td>
  </tr>`;

  const antPctPodrido = ant ? pct0(ant.kgPodrido, ant.kgCalibrado) : null;
  const antKgPersona = ant && ant.sumaPresentes > 0 ? ant.kgConAsistencia / ant.sumaPresentes : null;
  const antPctMdna = ant ? pct0(ant.kgMercadona, ant.kgCalibrado) : null;

  const comparativa = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr><th ${TH}>Concepto</th><th ${TH_NUM}>${escaparHtml(refMes)}</th><th ${TH_NUM}>Mes anterior</th><th ${TH_NUM}>Variación</th></tr>
    ${filaComparada("Entradas de báscula", `${fmtKg(a.kgEntrada)} (${NF_ENTERO.format(a.numEntradas)})`, ant ? `${fmtKg(ant.kgEntrada)} (${NF_ENTERO.format(ant.numEntradas)})` : "—", fmtVariacion(a.kgEntrada, ant?.kgEntrada))}
    ${filaComparada("Kg calibrados", fmtKg(a.kgCalibrado), ant ? fmtKg(ant.kgCalibrado) : "—", fmtVariacion(a.kgCalibrado, ant?.kgCalibrado))}
    ${filaComparada("Días con producción", String(a.diasConProduccion), ant ? String(ant.diasConProduccion) : "—", "")}
    ${filaComparada("Podrido real", fmtPct(c.pctPodrido), fmtPct(antPctPodrido), "")}
    ${filaComparada("Kg por persona y día", c.kgPorPersonaDia != null ? fmtKg(c.kgPorPersonaDia) : "—", antKgPersona != null ? fmtKg(antKgPersona) : "—", "")}
    ${filaComparada("Vendido a Mercadona", `${fmtKg(a.kgMercadona)} (${fmtPct(c.pctMercadona)})`, ant ? `${fmtKg(ant.kgMercadona)} (${fmtPct(antPctMdna)})` : "—", fmtVariacion(a.kgMercadona, ant?.kgMercadona))}
    ${a.merma && ant?.merma ? filaComparada("Merma lotes terminados", fmtPct(a.merma.pctMerma), fmtPct(ant.merma.pctMerma), "") : ""}
  </table>`;

  const filasDestinos = DESTINOS_ORDEN
    .filter((d) => a.kgPorDestino[d] > 0)
    .map((d) => `<tr>
      <td ${TD}>${escaparHtml(DESTINO_LABEL[d])}</td>
      <td ${TD_NUM}>${fmtKg(a.kgPorDestino[d])}</td>
      <td ${TD_NUM}>${a.kgCalibrado > 0 ? fmtPct((a.kgPorDestino[d] / a.kgCalibrado) * 100) : "—"}</td>
      <td ${TD_NUM}>${ant ? fmtVariacion(a.kgPorDestino[d], ant.kgPorDestino[d]) : "—"}</td>
    </tr>`)
    .join("");

  const merma = a.merma;
  const mermaHtml = merma
    ? (merma.nLotes > 0
      ? `<p style="margin:0 0 8px;font-size:13px;color:#30354a;">${merma.nLotes} lote(s) terminados en el mes · ${fmtKg(merma.kgEntrada)} de entrada · merma ${fmtKg(merma.kgMerma)} (${fmtPct(merma.pctMerma)}). Misma cuenta que «Entradas → Mermas y coste».</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr><th ${TH}>Lote</th><th ${TH_NUM}>Entrada</th><th ${TH_NUM}>Días cámara</th><th ${TH_NUM}>Merma kg</th><th ${TH_NUM}>Merma %</th></tr>
      ${merma.lotes.slice(0, MAX_LOTES_MERMA).map((l) => `<tr>
        <td ${TD}>${escaparHtml(l.lote)}<br><span style="color:#6e7488;font-size:12px;">${escaparHtml(l.agricultor ?? "—")}${l.finca ? ` · ${escaparHtml(l.finca)}` : ""}</span></td>
        <td ${TD_NUM}>${fmtKg(l.kgEntrada)}</td>
        <td ${TD_NUM}>${l.diasEnCamara ?? "—"}</td>
        <td ${TD_NUM}>${l.mermaNaturalKg != null ? fmtKg(l.mermaNaturalKg) : "—"}${l.calibradorSuperaEntrada ? " ⚠" : ""}</td>
        <td ${TD_NUM}>${(l.pctMerma ?? 0) > 5 ? `<span style="color:#b4232a;font-weight:700;">${fmtPct(l.pctMerma)}</span>` : fmtPct(l.pctMerma)}</td>
      </tr>`).join("")}
    </table>${merma.lotes.length > MAX_LOTES_MERMA ? `<p style="margin:6px 0 0;font-size:12px;color:#6e7488;">…y ${merma.lotes.length - MAX_LOTES_MERMA} lote(s) más con menos merma.</p>` : ""}`
      : `<p style="margin:0;font-size:13px;color:#6e7488;">Ningún lote terminó de procesarse este mes.</p>`)
    : "";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escaparHtml(asuntoCierreMensual(c))}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f8;font-family:Arial,Helvetica,sans-serif;color:#30354a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Cierre mensual automático · ${escaparHtml(refMes)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2f4f8;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 32px rgba(31,42,94,.11);">
        <tr><td style="height:6px;background:#22295c;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:25px 36px 20px;border-bottom:1px solid #e7e9f1;">
          <p style="margin:0 0 4px;color:#6e7488;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;">Lasarte Cítricos SL · Cierre mensual automático</p>
          <h1 style="margin:0;color:#22295c;font-size:24px;line-height:1.25;">${escaparHtml(refMes[0].toUpperCase() + refMes.slice(1))}</h1>
        </td></tr>

        <tr><td style="padding:24px 36px 0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              ${kpi("Kg calibrados", fmtKg(a.kgCalibrado), `${a.diasConProduccion} día(s) de calibrado`)}
              <td style="width:10px;">&nbsp;</td>
              ${kpi("Podrido real", fmtPct(c.pctPodrido), `${fmtKg(a.kgPodrido)} · clase (J) del calibrador`)}
              <td style="width:10px;">&nbsp;</td>
              ${kpi("Mercadona", fmtPct(c.pctMercadona), `${fmtKg(a.kgMercadona)} vendidos (pesada real del ERP)`)}
              ${c.stock ? `<td style="width:10px;">&nbsp;</td>${kpi("Stock en cámara", fmtKg(c.stock.kgEnCamara), `${c.stock.lotesPendientes + c.stock.lotesParciales} lote(s) con fruta pendiente`)}` : ""}
            </tr>
          </table>
        </td></tr>

        ${avisosHtml}

        ${seccion("El mes contra el anterior", comparativa)}

        ${seccion("Dónde fueron los kilos", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><th ${TH}>Destino</th><th ${TH_NUM}>Kilos</th><th ${TH_NUM}>% mes</th><th ${TH_NUM}>vs mes anterior</th></tr>
          ${filasDestinos || `<tr><td ${TD} colspan="4">Sin kilos calibrados.</td></tr>`}
        </table>`)}

        ${merma ? seccion("Merma de los lotes terminados en el mes", mermaHtml) : ""}

        ${c.stock ? seccion("Stock en cámara (al cierre)", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td ${TD}>En cámara (total)</td><td ${TD_NUM}><strong>${fmtKg(c.stock.kgEnCamara)}</strong></td></tr>
          <tr><td ${TD}>· Firme (lotes claramente a medias)</td><td ${TD_NUM}>${fmtKg(c.stock.kgEnCamaraFirme)}</td></tr>
          <tr><td ${TD}>· En lotes probablemente terminados (${c.stock.lotesProbablementeTerminados})</td><td ${TD_NUM}>${fmtKg(c.stock.kgProbablementeTerminados)}</td></tr>
          <tr><td ${TD}>Lotes sin empezar / a medias</td><td ${TD_NUM}>${c.stock.lotesPendientes} / ${c.stock.lotesParciales}</td></tr>
          <tr><td ${TD}>Lote sin terminar más antiguo</td><td ${TD_NUM}>${c.stock.antiguedadMaxDias} día(s)</td></tr>
        </table>`) : ""}

        <tr><td style="padding:26px 36px 24px;">
          <p style="margin:0;font-size:11px;color:#858a9b;line-height:1.6;">
            Generado automáticamente el día 1 con las mismas funciones de cálculo que las páginas de la herramienta
            (Informes LOTE, báscula, asistencia, pesadas del ERP y la conciliación de kg).
            Cuando falta un dato se dice — nunca se estima en silencio.
          </p>
        </td></tr>
        <tr><td style="height:6px;background:#93c13d;font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function pct0(parte: number, total: number): number | null {
  return total > 0 ? (parte / total) * 100 : null;
}

/** Versión texto plano (multipart) del mismo cierre. */
export function renderCierreMensualTexto(c: CierreMensual): string {
  const a = c.actual;
  const ant = c.anterior;
  const lineas: string[] = [];
  lineas.push(`CIERRE MENSUAL · ${etiquetaMes({ anio: a.anio, mes: a.mes }).toUpperCase()}`);
  lineas.push("");
  lineas.push(`Entradas de báscula: ${fmtKg(a.kgEntrada)} en ${a.numEntradas} entrada(s)${ant ? ` (mes anterior ${fmtKg(ant.kgEntrada)}, ${fmtVariacion(a.kgEntrada, ant.kgEntrada)})` : ""}`);
  lineas.push(`Kg calibrados: ${fmtKg(a.kgCalibrado)} en ${a.diasConProduccion} día(s)${ant ? ` (mes anterior ${fmtKg(ant.kgCalibrado)}, ${fmtVariacion(a.kgCalibrado, ant.kgCalibrado)})` : ""}`);
  lineas.push(`Podrido real: ${fmtKg(a.kgPodrido)} (${fmtPct(c.pctPodrido)})`);
  lineas.push(`Kg por persona y día: ${c.kgPorPersonaDia != null ? fmtKg(c.kgPorPersonaDia) : "—"}`);
  lineas.push(`Mercadona: ${fmtKg(a.kgMercadona)} (${fmtPct(c.pctMercadona)} de lo calibrado)`);
  if (a.merma) {
    lineas.push(a.merma.nLotes > 0
      ? `Merma de lotes terminados: ${a.merma.nLotes} lote(s) · ${fmtKg(a.merma.kgMerma)} (${fmtPct(a.merma.pctMerma)})`
      : "Merma: ningún lote terminó de procesarse este mes.");
  }
  if (c.stock) {
    lineas.push(`Stock en cámara al cierre: ${fmtKg(c.stock.kgEnCamara)} · lote más antiguo ${c.stock.antiguedadMaxDias} día(s)`);
  }
  if (c.avisos.length > 0) {
    lineas.push("");
    lineas.push("DATOS QUE FALTAN:");
    for (const x of c.avisos) lineas.push(`- ${x}`);
  }
  lineas.push("");
  lineas.push("Destinos del mes:");
  for (const d of DESTINOS_ORDEN) {
    if (a.kgPorDestino[d] <= 0) continue;
    lineas.push(`  ${DESTINO_LABEL[d]}: ${fmtKg(a.kgPorDestino[d])}${a.kgCalibrado > 0 ? ` (${fmtPct((a.kgPorDestino[d] / a.kgCalibrado) * 100)})` : ""}`);
  }
  return lineas.join("\n");
}
