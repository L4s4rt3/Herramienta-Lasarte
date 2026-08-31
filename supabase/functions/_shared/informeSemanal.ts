/**
 * informeSemanal.ts — lib PURA (sin red) del informe semanal automático.
 *
 * Contenido pedido por el dueño (10-08-2026): kg producidos, podrido,
 * trabajadores al día, kg por trabajador y zona, y % de podrido por productor
 * y finca y por día de la semana. Sin cuenta económica: los euros viven en
 * "Económico → Rentabilidad del día".
 *
 * Cada día se calcula con computeRentabilidadDia (la MISMA función pura que
 * usa la página de Rentabilidad) y de ella se usan SOLO los kg: total, por
 * destino y podrido real — la clase "(J)" del calibrador, mismo criterio que
 * mermaLote.ts. Regla de la casa: un hueco se enseña como hueco ("sin datos"),
 * JAMÁS se rellena con una media ni un número inventado. Texto determinista,
 * cero LLM.
 *
 * Pendiente consciente (no se aproxima con otra fórmula): la MERMA natural de
 * cámara y el STOCK requieren la maquinaria de mermaLote.ts/entradasBascula.ts
 * (conciliación de kg incluida); se añadirán portando esas mismas funciones,
 * no con un cálculo paralelo que pueda divergir.
 *
 * VIVE EN _shared (patrón fotoLotesCoherencia): lo importa la edge function
 * informe-semanal (Deno) y lo prueba vitest desde src/lib/informeSemanal.test.ts.
 */
import {
  DESTINO_LABEL,
  DESTINOS_ORDEN,
  type DestinoRentabilidad,
  type RentabilidadDia,
} from "./rentabilidadDia.ts";
import type { MermaLote } from "./mermaLote.ts";

// ---------------------------------------------------------------------------
// Semanas ISO (sin date-fns: la edge function no carga dependencias para esto)
// ---------------------------------------------------------------------------

export interface SemanaIso {
  anio: number;
  semana: number;
}

const DIA_MS = 86_400_000;

function aFechaUtc(fechaISO: string): Date {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function aISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Semana ISO-8601 de una fecha YYYY-MM-DD (equivale a getISOWeek/getISOWeekYear de date-fns). */
export function semanaIsoDe(fechaISO: string): SemanaIso {
  const d = aFechaUtc(fechaISO);
  // Jueves de la semana de la fecha: fija el año ISO.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const anio = d.getUTCFullYear();
  const inicioAnio = new Date(Date.UTC(anio, 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / DIA_MS + 1) / 7);
  return { anio, semana };
}

/** Las 7 fechas (lunes..domingo) de una semana ISO. */
export function fechasSemanaIso(anio: number, semana: number): string[] {
  // El 4 de enero está siempre en la semana 1 del año ISO.
  const enero4 = new Date(Date.UTC(anio, 0, 4));
  const lunesSemana1 = new Date(enero4.getTime() - ((enero4.getUTCDay() || 7) - 1) * DIA_MS);
  const lunes = new Date(lunesSemana1.getTime() + (semana - 1) * 7 * DIA_MS);
  return Array.from({ length: 7 }, (_, i) => aISO(new Date(lunes.getTime() + i * DIA_MS)));
}

/** Semana ISO anterior a la de la fecha dada (la que cubre el informe del martes). */
export function semanaIsoAnterior(hoyISO: string): SemanaIso {
  const hoy = aFechaUtc(hoyISO);
  const lunes = new Date(hoy.getTime() - ((hoy.getUTCDay() || 7) - 1) * DIA_MS);
  return semanaIsoDe(aISO(new Date(lunes.getTime() - 7 * DIA_MS)));
}

// ---------------------------------------------------------------------------
// Entrada y resultado del informe
// ---------------------------------------------------------------------------

/** Lo que la edge function reúne de cada día de la semana. */
export interface DiaInformeSemanal {
  fecha: string;
  /** null = día sin filas de Informe LOTE (no se calibró o falta importar). */
  rentabilidad: RentabilidadDia | null;
  /** Presentes en asistencia_detalle ese día. */
  presentes: number;
  /** Presentes por zona de trabajadores (clave = zona, "Sin zona" para null). */
  presentesPorZona: Record<string, number>;
  /** Lotes del día sin entrada de báscula con su clave de 8 dígitos. */
  lotesSinEntrada: string[];
  /** Entradas de fruta en báscula ese día. */
  kgEntradaBascula: number;
  numEntradasBascula: number;
}

export interface OpcionesInformeSemanal {
  anio: number;
  semana: number;
  /** finca de báscula por clave de lote (8 dígitos), para el desglose por productor y finca. */
  fincaPorLote?: Map<string, string | null>;
  /** Merma de los lotes terminados esta semana (seleccionarMermaSemana). null/ausente = no calculada. */
  mermaSemana?: MermaSemanaInforme | null;
  /** Foto del stock en cámara A DÍA DE HOY (buildStockEntradas). null/ausente = no calculado. */
  stock?: StockInforme | null;
  /** Kg calibrados en la MISMA semana ISO de la campaña anterior. null/ausente = sin dato. */
  kgMismaSemanaCampanaAnterior?: number | null;
}

// ---------------------------------------------------------------------------
// Merma de los lotes terminados en la semana + foto del stock
// ---------------------------------------------------------------------------

/** Un lote terminado esta semana, con la MISMA merma que la pestaña "Mermas y coste". */
export interface LoteMermaSemana {
  lote: string;
  agricultor: string | null;
  finca: string | null;
  kgEntrada: number;
  /** Merma natural CON SIGNO (báscula − calibrador − ajuste), de mermaLote.ts. */
  mermaNaturalKg: number | null;
  pctMerma: number | null;
  diasEnCamara: number | null;
  /** true = el calibrador pesó MÁS que la báscula: dato a revisar, no merma. */
  calibradorSuperaEntrada: boolean;
}

export interface MermaSemanaInforme {
  nLotes: number;
  kgEntrada: number;
  /** Σ merma natural CON SIGNO de los lotes de la semana. */
  kgMerma: number;
  pctMerma: number | null;
  nConDatoARevisar: number;
  /** De mayor a menor % de merma. */
  lotes: LoteMermaSemana[];
}

/** Resumen del stock del hook de Entradas (buildStockEntradas), lo que enseña el informe. */
export interface StockInforme {
  kgEnCamara: number;
  kgEnCamaraFirme: number;
  kgProbablementeTerminados: number;
  lotesProbablementeTerminados: number;
  lotesPendientes: number;
  lotesParciales: number;
  antiguedadMaxDias: number;
}

/**
 * Filtra de los MermaLote de TODA la campaña (computeMermaLotes, los mismos
 * números que la pestaña "Mermas y coste") los lotes TERMINADOS cuya última
 * fecha de procesado (conciliada) cayó dentro de la semana del informe.
 * Los cerrados sin_registro nunca entran (su merma es null a propósito).
 */
export function seleccionarMermaSemana(
  lotes: MermaLote[],
  ultimaFechaPorLote: Map<string, string | null>,
  fechaInicio: string,
  fechaFin: string,
  datosPorLote: Map<string, { agricultor: string | null; finca: string | null }>,
): MermaSemanaInforme {
  const delaSemana = lotes.filter((l) => {
    if (l.estado !== "procesado" || l.cerradoSinRegistro || l.mermaNaturalKg == null) return false;
    const ultima = ultimaFechaPorLote.get(l.lote) ?? null;
    return ultima != null && ultima >= fechaInicio && ultima <= fechaFin;
  });

  const filas: LoteMermaSemana[] = delaSemana.map((l) => ({
    lote: l.lote,
    agricultor: datosPorLote.get(l.lote)?.agricultor ?? null,
    finca: datosPorLote.get(l.lote)?.finca ?? null,
    kgEntrada: l.kgEntrada,
    mermaNaturalKg: l.mermaNaturalKg,
    pctMerma: l.pctMermaSobreEntrada,
    diasEnCamara: l.diasEnCamara,
    calibradorSuperaEntrada: l.calibradorSuperaEntrada,
  }));
  filas.sort((a, b) => (b.pctMerma ?? -1e12) - (a.pctMerma ?? -1e12));

  const kgEntrada = filas.reduce((s, l) => s + l.kgEntrada, 0);
  const kgMerma = filas.reduce((s, l) => s + (l.mermaNaturalKg ?? 0), 0);
  return {
    nLotes: filas.length,
    kgEntrada,
    kgMerma,
    pctMerma: kgEntrada > 0 ? (kgMerma / kgEntrada) * 100 : null,
    nConDatoARevisar: filas.filter((l) => l.calibradorSuperaEntrada).length,
    lotes: filas,
  };
}

/** Agregado de podrido/industria por productor y finca (semana completa). */
export interface ProductorFincaPodrido {
  productor: string;
  finca: string;
  kg: number;
  kgPodrido: number;
  pctPodrido: number | null;
  kgIndustria: number;
  pctIndustria: number | null;
}

export interface InformeSemanal {
  anio: number;
  semana: number;
  fechaInicio: string;
  fechaFin: string;
  dias: DiaInformeSemanal[];
  diasConProduccion: number;
  /** Kg calibrados de la semana (Informes LOTE). */
  kgTotal: number;
  kgPorDestino: Record<DestinoRentabilidad, number>;
  /** Podrido REAL de la semana: clase (J) del calibrador (+ muestras), en kg y %. */
  kgPodrido: number;
  pctPodrido: number | null;
  kgIndustria: number;
  pctIndustria: number | null;
  /** Entradas de fruta por báscula en la semana. */
  kgEntradaBascula: number;
  numEntradasBascula: number;
  /** Media de presentes en los días CON producción. null si ningún día tiene asistencia. */
  presentesMedios: number | null;
  /** kg calibrados / Σ presentes de los días con producción Y asistencia. null sin asistencia. */
  kgPorPersonaDia: number | null;
  /** Presentes medios por zona en los días con producción (ordenado de más a menos). */
  presentesPorZona: Array<{ zona: string; presentesMedios: number }>;
  /** Podrido por productor y finca, ordenado por kg de podrido (de más a menos). */
  podridoPorProductor: ProductorFincaPodrido[];
  /** Merma de los lotes terminados esta semana. null = no calculada. */
  mermaSemana: MermaSemanaInforme | null;
  /** Foto del stock en cámara a la fecha de generación. null = no calculado. */
  stock: StockInforme | null;
  /** Kg de la misma semana ISO de la campaña anterior (comparativa). null = sin dato. */
  kgMismaSemanaCampanaAnterior: number | null;
  /** Datos que faltan / calidad del dato — la sección más valiosa del correo. */
  avisos: string[];
}

// ---------------------------------------------------------------------------
// Formato es-ES (local a este módulo: sin dependencia de src/lib/format)
// ---------------------------------------------------------------------------

const NF_ENTERO = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const NF_DECIMAL = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function fmtKg(v: number): string {
  return `${NF_ENTERO.format(Math.round(v))} kg`;
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${NF_DECIMAL.format(v)} %`;
}

const DIAS_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "lunes 04/08" — etiqueta corta de un día del informe. */
export function etiquetaDia(fechaISO: string): string {
  const d = aFechaUtc(fechaISO);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${DIAS_SEMANA[(d.getUTCDay() || 7) - 1]} ${dd}/${mm}`;
}

/** "4–10 de agosto de 2026" — rango humano de la semana. */
export function etiquetaRango(fechaInicio: string, fechaFin: string): string {
  const a = aFechaUtc(fechaInicio);
  const b = aFechaUtc(fechaFin);
  const mesA = MESES[a.getUTCMonth()];
  const mesB = MESES[b.getUTCMonth()];
  if (mesA === mesB && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()}–${b.getUTCDate()} de ${mesB} de ${b.getUTCFullYear()}`;
  }
  return `${a.getUTCDate()} de ${mesA} – ${b.getUTCDate()} de ${mesB} de ${b.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Agregación semanal
// ---------------------------------------------------------------------------

const MAX_LOTES_EN_AVISO = 8;
export const SIN_ZONA = "Sin zona";
const SIN_PRODUCTOR = "(sin productor)";
const SIN_FINCA = "(sin finca)";

function destinosVacios(): Record<DestinoRentabilidad, number> {
  const out = {} as Record<DestinoRentabilidad, number>;
  for (const d of DESTINOS_ORDEN) out[d] = 0;
  return out;
}

export function computeInformeSemanal(
  dias: DiaInformeSemanal[],
  opciones: OpcionesInformeSemanal,
): InformeSemanal {
  const ordenados = [...dias].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const fechas = fechasSemanaIso(opciones.anio, opciones.semana);
  const fincaPorLote = opciones.fincaPorLote ?? new Map<string, string | null>();

  const inf: InformeSemanal = {
    anio: opciones.anio,
    semana: opciones.semana,
    fechaInicio: fechas[0],
    fechaFin: fechas[6],
    dias: ordenados,
    diasConProduccion: 0,
    kgTotal: 0,
    kgPorDestino: destinosVacios(),
    kgPodrido: 0,
    pctPodrido: null,
    kgIndustria: 0,
    pctIndustria: null,
    kgEntradaBascula: 0,
    numEntradasBascula: 0,
    presentesMedios: null,
    kgPorPersonaDia: null,
    presentesPorZona: [],
    podridoPorProductor: [],
    mermaSemana: opciones.mermaSemana ?? null,
    stock: opciones.stock ?? null,
    kgMismaSemanaCampanaAnterior: opciones.kgMismaSemanaCampanaAnterior ?? null,
    avisos: [],
  };

  const diasSinAsistencia: string[] = [];
  const diasBasculaSinInforme: string[] = [];
  const lotesSinEntrada: string[] = [];
  const zonaAcc = new Map<string, number>();
  let diasConAsistencia = 0;
  let sumaPresentes = 0;
  let kgConAsistencia = 0;

  // productor|finca -> agregado de la semana
  const porProductorFinca = new Map<string, ProductorFincaPodrido>();

  for (const dia of ordenados) {
    inf.kgEntradaBascula += dia.kgEntradaBascula;
    inf.numEntradasBascula += dia.numEntradasBascula;

    const r = dia.rentabilidad;
    if (!r || r.kgTotal <= 0) {
      // Día sin calibrado. Entre semana y con entradas en báscula, puede ser
      // simplemente que no se calibró — o que falta importar el informe: avisar.
      const esLaborable = (aFechaUtc(dia.fecha).getUTCDay() || 7) <= 5;
      if (esLaborable && dia.numEntradasBascula > 0) diasBasculaSinInforme.push(dia.fecha);
      continue;
    }

    inf.diasConProduccion += 1;
    inf.kgTotal += r.kgTotal;
    for (const d of DESTINOS_ORDEN) inf.kgPorDestino[d] += r.kgPorDestino[d];

    if (dia.presentes === 0) {
      diasSinAsistencia.push(dia.fecha);
    } else {
      diasConAsistencia += 1;
      sumaPresentes += dia.presentes;
      kgConAsistencia += r.kgTotal;
      for (const [zona, n] of Object.entries(dia.presentesPorZona)) {
        zonaAcc.set(zona, (zonaAcc.get(zona) ?? 0) + n);
      }
    }

    for (const l of dia.lotesSinEntrada) {
      if (!lotesSinEntrada.includes(l)) lotesSinEntrada.push(l);
    }

    // Podrido por productor y finca: mismos kg por destino que calcula la
    // página, agregados por (productor, finca de báscula del lote).
    for (const l of r.lotes) {
      const productor = (l.productor ?? "").trim() || SIN_PRODUCTOR;
      const finca = (l.loteBase ? fincaPorLote.get(l.loteBase) : null)?.trim() || SIN_FINCA;
      const clave = `${productor}|${finca}`;
      let acc = porProductorFinca.get(clave);
      if (!acc) {
        acc = { productor, finca, kg: 0, kgPodrido: 0, pctPodrido: null, kgIndustria: 0, pctIndustria: null };
        porProductorFinca.set(clave, acc);
      }
      acc.kg += l.kg;
      acc.kgPodrido += (l.kgPorDestino.podrido ?? 0) + (l.kgPorDestino.muestra ?? 0);
      acc.kgIndustria += l.kgPorDestino.industria ?? 0;
    }
  }

  inf.kgPodrido = inf.kgPorDestino.podrido + inf.kgPorDestino.muestra;
  inf.kgIndustria = inf.kgPorDestino.industria;
  if (inf.kgTotal > 0) {
    inf.pctPodrido = (inf.kgPodrido / inf.kgTotal) * 100;
    inf.pctIndustria = (inf.kgIndustria / inf.kgTotal) * 100;
  }

  if (diasConAsistencia > 0) {
    inf.presentesMedios = sumaPresentes / diasConAsistencia;
    inf.kgPorPersonaDia = sumaPresentes > 0 ? kgConAsistencia / sumaPresentes : null;
  }
  inf.presentesPorZona = [...zonaAcc.entries()]
    .map(([zona, total]) => ({ zona, presentesMedios: total / Math.max(1, diasConAsistencia) }))
    .sort((a, b) => b.presentesMedios - a.presentesMedios);

  for (const acc of porProductorFinca.values()) {
    if (acc.kg <= 0) continue;
    acc.pctPodrido = (acc.kgPodrido / acc.kg) * 100;
    acc.pctIndustria = (acc.kgIndustria / acc.kg) * 100;
  }
  inf.podridoPorProductor = [...porProductorFinca.values()]
    .filter((a) => a.kg > 0)
    .sort((a, b) => b.kgPodrido - a.kgPodrido);

  // --- Datos que faltan / calidad del dato -------------------------------
  const avisos: string[] = [];

  if (inf.diasConProduccion === 0) {
    avisos.push(
      "Ningún día de la semana tiene Informes LOTE del calibrador cargados. Si se calibró, importa los informes en /importar.",
    );
  }

  if (diasSinAsistencia.length > 0) {
    const etiquetas = diasSinAsistencia.map(etiquetaDia).join(", ");
    avisos.push(
      diasSinAsistencia.length === inf.diasConProduccion
        ? `La asistencia de la semana no está cargada (se vuelca los lunes): sin presentes no hay kg por trabajador. Días: ${etiquetas}.`
        : `Hay producción sin asistencia marcada (ese día no se puede calcular kg por trabajador): ${etiquetas}.`,
    );
  }

  if (lotesSinEntrada.length > 0) {
    avisos.push(
      `Lote(s) calibrados SIN entrada de báscula con su código: ${lotesSinEntrada.slice(0, MAX_LOTES_EN_AVISO).join(", ")}${lotesSinEntrada.length > MAX_LOTES_EN_AVISO ? "…" : ""} — su productor/finca puede salir incompleto.`,
    );
  }

  if (diasBasculaSinInforme.length > 0) {
    avisos.push(
      `Día(s) laborable(s) con entradas en báscula pero sin Informe LOTE: ${diasBasculaSinInforme.map(etiquetaDia).join(", ")}. Si ese día se calibró, falta importar el informe.`,
    );
  }

  if ((inf.mermaSemana?.nConDatoARevisar ?? 0) > 0) {
    avisos.push(
      `${inf.mermaSemana!.nConDatoARevisar} lote(s) terminados esta semana con el calibrador pesando MÁS que la báscula: dato a revisar en Entradas → Mermas y coste, no es merma real.`,
    );
  }

  inf.avisos = avisos;
  return inf;
}

// ---------------------------------------------------------------------------
// Render del correo (determinista, sin LLM)
// ---------------------------------------------------------------------------

function escaparHtml(texto: string): string {
  // .replace con regex global y no .replaceAll: el typecheck del frontend
  // compila esta lib compartida con lib ES2020.
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function asuntoInformeSemanal(inf: InformeSemanal): string {
  if (inf.diasConProduccion === 0) {
    return `Informe semanal ${inf.semana}/${inf.anio} — sin datos de producción`;
  }
  return `Informe semanal ${inf.semana}/${inf.anio} — ${fmtKg(inf.kgTotal)} · podrido ${fmtPct(inf.pctPodrido)}`;
}

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

function fmtPersonas(v: number | null): string {
  return v == null ? "—" : NF_DECIMAL.format(v);
}

export function renderInformeSemanalHtml(inf: InformeSemanal): string {
  const rango = etiquetaRango(inf.fechaInicio, inf.fechaFin);

  const avisosHtml = inf.avisos.length > 0
    ? seccion("Datos que faltan", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fdf6e3;border:1px solid #e8d9a0;border-radius:10px;">
        ${inf.avisos.map((a) => `<tr><td style="padding:9px 14px;font-size:13px;color:#7a5c12;line-height:1.5;">• ${escaparHtml(a)}</td></tr>`).join("")}
      </table>`)
    : seccion("Datos que faltan", `<p style="margin:0;font-size:13px;color:#1d7a3c;">Semana completa: asistencia e informes en orden.</p>`);

  const filasDias = inf.dias
    .filter((d) => (d.rentabilidad?.kgTotal ?? 0) > 0 || d.kgEntradaBascula > 0)
    .map((d) => {
      const r = d.rentabilidad;
      if (!r || r.kgTotal <= 0) {
        return `<tr>
          <td ${TD}>${escaparHtml(etiquetaDia(d.fecha))}</td>
          <td ${TD_NUM}>${d.kgEntradaBascula > 0 ? fmtKg(d.kgEntradaBascula) : "—"}</td>
          <td ${TD_NUM}>—</td><td ${TD_NUM}>—</td><td ${TD_NUM}>—</td><td ${TD_NUM}>—</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e7e9f1;font-size:12px;color:#6e7488;text-align:right;">sin calibrado</td>
        </tr>`;
      }
      const kgPersona = d.presentes > 0 ? fmtKg(r.kgTotal / d.presentes) : "—";
      return `<tr>
        <td ${TD}>${escaparHtml(etiquetaDia(d.fecha))}</td>
        <td ${TD_NUM}>${d.kgEntradaBascula > 0 ? fmtKg(d.kgEntradaBascula) : "—"}</td>
        <td ${TD_NUM}>${fmtKg(r.kgTotal)}</td>
        <td ${TD_NUM}>${fmtPct(r.pctPodrido)}</td>
        <td ${TD_NUM}>${fmtPct(r.pctIndustria)}</td>
        <td ${TD_NUM}>${d.presentes > 0 ? d.presentes : "—"}</td>
        <td ${TD_NUM}>${kgPersona}</td>
      </tr>`;
    })
    .join("");

  const filasDestinos = DESTINOS_ORDEN
    .filter((d) => inf.kgPorDestino[d] > 0)
    .map((d) => `<tr>
      <td ${TD}>${escaparHtml(DESTINO_LABEL[d])}</td>
      <td ${TD_NUM}>${fmtKg(inf.kgPorDestino[d])}</td>
      <td ${TD_NUM}>${inf.kgTotal > 0 ? fmtPct((inf.kgPorDestino[d] / inf.kgTotal) * 100) : "—"}</td>
    </tr>`)
    .join("");

  const filasProductores = inf.podridoPorProductor
    .map((p) => `<tr>
      <td ${TD}>${escaparHtml(p.productor)}<br><span style="color:#6e7488;font-size:12px;">${escaparHtml(p.finca)}</span></td>
      <td ${TD_NUM}>${fmtKg(p.kg)}</td>
      <td ${TD_NUM}>${fmtKg(p.kgPodrido)}</td>
      <td ${TD_NUM}>${(p.pctPodrido ?? 0) > 5 ? `<span style="color:#b4232a;font-weight:700;">${fmtPct(p.pctPodrido)}</span>` : fmtPct(p.pctPodrido)}</td>
      <td ${TD_NUM}>${fmtPct(p.pctIndustria)}</td>
    </tr>`)
    .join("");

  const filasZonas = inf.presentesPorZona
    .map((z) => `<tr>
      <td ${TD}>${escaparHtml(z.zona)}</td>
      <td ${TD_NUM}>${NF_DECIMAL.format(z.presentesMedios)}</td>
    </tr>`)
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escaparHtml(asuntoInformeSemanal(inf))}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f8;font-family:Arial,Helvetica,sans-serif;color:#30354a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Informe semanal automático · semana ${inf.semana}/${inf.anio}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2f4f8;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 32px rgba(31,42,94,.11);">
        <tr><td style="height:6px;background:#22295c;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:25px 36px 20px;border-bottom:1px solid #e7e9f1;">
          <p style="margin:0 0 4px;color:#6e7488;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;">Lasarte Cítricos SL · Informe semanal automático</p>
          <h1 style="margin:0;color:#22295c;font-size:24px;line-height:1.25;">Semana ${inf.semana}/${inf.anio} · ${escaparHtml(rango)}</h1>
        </td></tr>

        <tr><td style="padding:24px 36px 0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              ${kpi("Kg producidos", fmtKg(inf.kgTotal), `${inf.diasConProduccion} día(s) de calibrado${inf.kgMismaSemanaCampanaAnterior != null && inf.kgMismaSemanaCampanaAnterior > 0 ? ` · campaña pasada: ${fmtKg(inf.kgMismaSemanaCampanaAnterior)}` : ""}`)}
              <td style="width:10px;">&nbsp;</td>
              ${kpi("Podrido real", fmtPct(inf.pctPodrido), `${fmtKg(inf.kgPodrido)} · clase (J) del calibrador`)}
              <td style="width:10px;">&nbsp;</td>
              ${kpi("Trabajadores/día", fmtPersonas(inf.presentesMedios), inf.kgPorPersonaDia != null ? `${fmtKg(inf.kgPorPersonaDia)} por persona y día` : "sin asistencia cargada")}
              ${inf.stock ? `<td style="width:10px;">&nbsp;</td>${kpi("Stock en cámara", fmtKg(inf.stock.kgEnCamara), `${inf.stock.lotesPendientes + inf.stock.lotesParciales} lote(s) con fruta pendiente`)}` : ""}
            </tr>
          </table>
        </td></tr>

        ${avisosHtml}

        ${seccion("El día a día", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><th ${TH}>Día</th><th ${TH_NUM}>Entradas báscula</th><th ${TH_NUM}>Calibrado</th><th ${TH_NUM}>Podrido</th><th ${TH_NUM}>Industria</th><th ${TH_NUM}>Presentes</th><th ${TH_NUM}>Kg/persona</th></tr>
          ${filasDias || `<tr><td ${TD} colspan="7">Sin movimiento en toda la semana.</td></tr>`}
        </table>`)}

        ${seccion("Podrido por productor y finca", filasProductores
          ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><th ${TH}>Productor · finca</th><th ${TH_NUM}>Calibrado</th><th ${TH_NUM}>Podrido kg</th><th ${TH_NUM}>Podrido %</th><th ${TH_NUM}>Industria %</th></tr>
          ${filasProductores}
        </table>`
          : `<p style="margin:0;font-size:13px;color:#6e7488;">Sin lotes calibrados esta semana.</p>`)}

        ${inf.mermaSemana ? seccion("Merma de los lotes terminados esta semana", inf.mermaSemana.nLotes > 0
          ? `<p style="margin:0 0 8px;font-size:13px;color:#30354a;">${inf.mermaSemana.nLotes} lote(s) · ${fmtKg(inf.mermaSemana.kgEntrada)} de entrada · merma ${fmtKg(inf.mermaSemana.kgMerma)} (${fmtPct(inf.mermaSemana.pctMerma)}). Misma cuenta que «Entradas → Mermas y coste» (báscula − calibrador − ajuste, con la conciliación de kg).</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><th ${TH}>Lote</th><th ${TH_NUM}>Entrada</th><th ${TH_NUM}>Días cámara</th><th ${TH_NUM}>Merma kg</th><th ${TH_NUM}>Merma %</th></tr>
          ${inf.mermaSemana.lotes.map((l) => `<tr>
            <td ${TD}>${escaparHtml(l.lote)}<br><span style="color:#6e7488;font-size:12px;">${escaparHtml(l.agricultor ?? "—")}${l.finca ? ` · ${escaparHtml(l.finca)}` : ""}</span></td>
            <td ${TD_NUM}>${fmtKg(l.kgEntrada)}</td>
            <td ${TD_NUM}>${l.diasEnCamara ?? "—"}</td>
            <td ${TD_NUM}>${l.mermaNaturalKg != null ? fmtKg(l.mermaNaturalKg) : "—"}${l.calibradorSuperaEntrada ? " ⚠" : ""}</td>
            <td ${TD_NUM}>${(l.pctMerma ?? 0) > 5 ? `<span style="color:#b4232a;font-weight:700;">${fmtPct(l.pctMerma)}</span>` : fmtPct(l.pctMerma)}</td>
          </tr>`).join("")}
        </table>`
          : `<p style="margin:0;font-size:13px;color:#6e7488;">Ningún lote terminó de procesarse esta semana: sin merma nueva que contar.</p>`) : ""}

        ${inf.stock ? seccion("Stock en cámara (a día de hoy)", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td ${TD}>En cámara (total)</td><td ${TD_NUM}><strong>${fmtKg(inf.stock.kgEnCamara)}</strong></td></tr>
          <tr><td ${TD}>· Firme (lotes claramente a medias)</td><td ${TD_NUM}>${fmtKg(inf.stock.kgEnCamaraFirme)}</td></tr>
          <tr><td ${TD}>· En lotes probablemente terminados (${inf.stock.lotesProbablementeTerminados})</td><td ${TD_NUM}>${fmtKg(inf.stock.kgProbablementeTerminados)}</td></tr>
          <tr><td ${TD}>Lotes sin empezar / a medias</td><td ${TD_NUM}>${inf.stock.lotesPendientes} / ${inf.stock.lotesParciales}</td></tr>
          <tr><td ${TD}>Lote sin terminar más antiguo</td><td ${TD_NUM}>${inf.stock.antiguedadMaxDias} día(s)</td></tr>
        </table>
        <p style="margin:8px 0 0;font-size:12px;color:#6e7488;">Misma cuenta que la pestaña Stock de Entradas (conciliación de kg, señales de cámara y cierres incluidos).</p>`) : ""}

        ${seccion("Dónde fueron los kilos", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><th ${TH}>Destino</th><th ${TH_NUM}>Kilos</th><th ${TH_NUM}>% semana</th></tr>
          ${filasDestinos || `<tr><td ${TD} colspan="3">Sin kilos calibrados.</td></tr>`}
        </table>`)}

        ${inf.presentesPorZona.length > 0 ? seccion("Trabajadores por zona (media/día)", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><th ${TH}>Zona</th><th ${TH_NUM}>Presentes medios</th></tr>
          ${filasZonas}
        </table>`) : ""}

        <tr><td style="padding:26px 36px 24px;">
          <p style="margin:0;font-size:11px;color:#858a9b;line-height:1.6;">
            Generado automáticamente desde los datos de la herramienta (Informes LOTE del calibrador, báscula y asistencia), con las mismas funciones de cálculo que las páginas de la herramienta.
            El podrido es el REAL medido por el calibrador (clase J); las muestras cuentan como podrido a efectos de aprovechamiento.
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

/** Versión texto plano (multipart) del mismo informe. */
export function renderInformeSemanalTexto(inf: InformeSemanal): string {
  const lineas: string[] = [];
  lineas.push(`INFORME SEMANAL ${inf.semana}/${inf.anio} · ${etiquetaRango(inf.fechaInicio, inf.fechaFin)}`);
  lineas.push("");
  lineas.push(`Kg producidos: ${fmtKg(inf.kgTotal)} en ${inf.diasConProduccion} día(s)${inf.kgMismaSemanaCampanaAnterior != null && inf.kgMismaSemanaCampanaAnterior > 0 ? ` (misma semana de la campaña pasada: ${fmtKg(inf.kgMismaSemanaCampanaAnterior)})` : ""}`);
  lineas.push(`Podrido real: ${fmtKg(inf.kgPodrido)} (${fmtPct(inf.pctPodrido)}) · industria ${fmtPct(inf.pctIndustria)}`);
  lineas.push(`Trabajadores: ${fmtPersonas(inf.presentesMedios)} de media/día${inf.kgPorPersonaDia != null ? ` · ${fmtKg(inf.kgPorPersonaDia)} por persona y día` : ""}`);
  lineas.push(`Entradas de báscula: ${fmtKg(inf.kgEntradaBascula)} en ${inf.numEntradasBascula} entrada(s)`);
  lineas.push("");
  if (inf.avisos.length > 0) {
    lineas.push("DATOS QUE FALTAN:");
    for (const a of inf.avisos) lineas.push(`- ${a}`);
    lineas.push("");
  }
  lineas.push("Día a día (entradas · calibrado · podrido · presentes · kg/persona):");
  for (const d of inf.dias) {
    const r = d.rentabilidad;
    if (!r || r.kgTotal <= 0) {
      if (d.kgEntradaBascula > 0) lineas.push(`  ${etiquetaDia(d.fecha)}: entradas ${fmtKg(d.kgEntradaBascula)} · sin calibrado`);
      continue;
    }
    const kgPersona = d.presentes > 0 ? fmtKg(r.kgTotal / d.presentes) : "—";
    lineas.push(`  ${etiquetaDia(d.fecha)}: ${d.kgEntradaBascula > 0 ? fmtKg(d.kgEntradaBascula) : "—"} · ${fmtKg(r.kgTotal)} · ${fmtPct(r.pctPodrido)} · ${d.presentes > 0 ? d.presentes : "—"} presentes · ${kgPersona}`);
  }
  lineas.push("");
  if (inf.podridoPorProductor.length > 0) {
    lineas.push("Podrido por productor y finca (calibrado · podrido kg · podrido % · industria %):");
    for (const p of inf.podridoPorProductor) {
      lineas.push(`  ${p.productor} · ${p.finca}: ${fmtKg(p.kg)} · ${fmtKg(p.kgPodrido)} · ${fmtPct(p.pctPodrido)} · ${fmtPct(p.pctIndustria)}`);
    }
    lineas.push("");
  }
  if (inf.mermaSemana) {
    if (inf.mermaSemana.nLotes > 0) {
      lineas.push(`Merma de los lotes terminados esta semana: ${inf.mermaSemana.nLotes} lote(s) · entrada ${fmtKg(inf.mermaSemana.kgEntrada)} · merma ${fmtKg(inf.mermaSemana.kgMerma)} (${fmtPct(inf.mermaSemana.pctMerma)})`);
      for (const l of inf.mermaSemana.lotes) {
        lineas.push(`  ${l.lote} (${l.agricultor ?? "—"}${l.finca ? ` · ${l.finca}` : ""}): entrada ${fmtKg(l.kgEntrada)} · merma ${l.mermaNaturalKg != null ? fmtKg(l.mermaNaturalKg) : "—"} (${fmtPct(l.pctMerma)})${l.calibradorSuperaEntrada ? " [dato a revisar]" : ""}`);
      }
    } else {
      lineas.push("Merma: ningún lote terminó de procesarse esta semana.");
    }
    lineas.push("");
  }
  if (inf.stock) {
    lineas.push(`Stock en cámara (hoy): ${fmtKg(inf.stock.kgEnCamara)} (firme ${fmtKg(inf.stock.kgEnCamaraFirme)} · probablemente terminados ${fmtKg(inf.stock.kgProbablementeTerminados)} en ${inf.stock.lotesProbablementeTerminados} lote(s)) · ${inf.stock.lotesPendientes} pendientes / ${inf.stock.lotesParciales} parciales · más antiguo ${inf.stock.antiguedadMaxDias} día(s)`);
    lineas.push("");
  }
  if (inf.presentesPorZona.length > 0) {
    lineas.push("Trabajadores por zona (media/día):");
    for (const z of inf.presentesPorZona) lineas.push(`  ${z.zona}: ${NF_DECIMAL.format(z.presentesMedios)}`);
  }
  return lineas.join("\n");
}
