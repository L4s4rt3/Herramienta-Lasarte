/**
 * historicoProduccion.ts — parser del export "Informe PRODUCCION" del
 * calibrador (informe de TODA la campaña, no el parte del día): cabecera
 * decorativa (título, filtros, resumen) + una tabla con una fila por PASADA
 * de lote (un lote puede tener varias filas, incluso en días distintos).
 *
 * La cabecera de la tabla se localiza por TEXTO (tolerante a que cambie el
 * orden de columnas): busca la fila que contenga "Nombre del Lote", "Peso
 * (kg)" y "Tiempo de Inicio" y mapea el resto de índices desde ahí. NO se
 * asume ninguna posición fija (verificado contra el export real: cabeceras
 * en celdas combinadas, con el texto solo en la primera celda del rango).
 *
 * "Tiempo de Inicio" es un datetime de Excel: hay que leer el workbook con
 * `XLSX.read(buffer, { cellDates: true })` (mismo patrón que
 * EntradasBascula.tsx/Asistencia.tsx) para que llegue como `Date` y se pueda
 * reutilizar `parseFechaBascula` (misma técnica de conversión que el resto
 * del repo: getFullYear/getMonth/getDate LOCALES sobre el Date que ya
 * construyó xlsx — no se reinventa la conversión de serial a mano).
 *
 * La fila de TOTALES al final de la tabla (recuento de lotes, productores,
 * variedades, Σkg…) se reconoce porque su celda de "Nombre del Lote" es un
 * NÚMERO (recuento), nunca texto: se descarta en silencio, no cuenta como
 * fila inválida.
 */
import { parseFechaBascula } from "@/lib/entradasBascula";

export interface FilaInformeProduccion {
  /** Texto crudo tal cual viene del informe (puede traer "+", texto pegado, sin código de 8 dígitos, etc.). */
  lote_codigo: string;
  /** ISO "YYYY-MM-DD", derivada de "Tiempo de Inicio" (solo la fecha; la hora se ignora para agrupar por día). */
  fecha: string;
  productor: string | null;
  productor_codigo: string | null;
  /** Columna "Variedad". */
  producto: string | null;
  kg: number;
  toneladas_hora: number | null;
  /** "Hora de la Máquina" convertida a minutos. */
  duracion_min: number | null;
}

export interface ParseInformeProduccionResult {
  filas: FilaInformeProduccion[];
  descartadas: Array<{ fila: number; motivo: string }>;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function toText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function toKg(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * "Hora de la Máquina" a minutos: normalmente texto "HH:MM:SS" (verificado
 * contra el export real: SIEMPRE así en las filas de detalle), pero se
 * tolera también una fracción de día (número, formato datetime de Excel sin
 * cellDates) por si un futuro export cambia el formato de la celda.
 */
export function parseDuracionMinutos(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value * 24 * 60;
  }
  const text = String(value ?? "").trim();
  const m = text.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const horas = Number(m[1]);
  const minutos = Number(m[2]);
  const segundos = Number(m[3]);
  return horas * 60 + minutos + segundos / 60;
}

/**
 * Parsea las filas (header:1, raw:true, workbook leído con cellDates:true)
 * del "Informe PRODUCCION" del calibrador. Localiza la cabecera de tabla por
 * texto y mapea columnas por nombre (normalizado, sin acentos).
 */
export function parseInformeProduccionRows(rows: unknown[][]): ParseInformeProduccionResult {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return headers.includes("nombre del lote") && headers.includes("peso (kg)") && headers.includes("tiempo de inicio");
  });

  if (headerIndex === -1) {
    return {
      filas: [],
      descartadas: [{ fila: 0, motivo: "No se encontró la cabecera (Nombre del Lote / Peso (kg) / Tiempo de Inicio)" }],
    };
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const col = (...names: string[]) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  };

  const iLote = col("nombre del lote");
  const iProductorCodigo = col("codigo del productor", "código del productor");
  const iProductorNombre = col("nombre del productor");
  const iVariedad = col("variedad");
  const iTiempoInicio = col("tiempo de inicio");
  const iHoraMaquina = col("hora de la maquina", "hora de la máquina");
  const iPesoKg = col("peso (kg)");
  const iToneladasHora = col("toneladas / hora");

  const filas: FilaInformeProduccion[] = [];
  const descartadas: Array<{ fila: number; motivo: string }> = [];

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const filaNum = headerIndex + offset + 2; // 1-based, como lo ve el usuario en Excel
    const vacia = row.every((cell) => cell == null || String(cell).trim() === "");
    if (vacia) return;

    const loteCrudo = iLote === -1 ? null : row[iLote];
    // Fila de TOTALES/resumen final: su "Nombre del Lote" es un número
    // (recuento de lotes), nunca texto. Se descarta en silencio (no es una
    // fila de datos inválida, es el pie de tabla del propio informe).
    if (typeof loteCrudo === "number") return;

    const lote = toText(loteCrudo);
    if (!lote) {
      descartadas.push({ fila: filaNum, motivo: "Sin código de lote" });
      return;
    }

    const fecha = iTiempoInicio === -1 ? null : parseFechaBascula(row[iTiempoInicio]);
    if (!fecha) {
      descartadas.push({ fila: filaNum, motivo: "Sin fecha reconocible (Tiempo de Inicio)" });
      return;
    }

    const kg = iPesoKg === -1 ? null : toKg(row[iPesoKg]);
    if (kg == null || kg <= 0) {
      descartadas.push({ fila: filaNum, motivo: "Sin kg de peso" });
      return;
    }

    const toneladasHoraRaw = iToneladasHora === -1 ? null : toKg(row[iToneladasHora]);

    filas.push({
      lote_codigo: lote,
      fecha,
      productor: iProductorNombre === -1 ? null : toText(row[iProductorNombre]),
      productor_codigo: iProductorCodigo === -1 ? null : toText(row[iProductorCodigo]),
      producto: iVariedad === -1 ? null : toText(row[iVariedad]),
      kg,
      toneladas_hora: toneladasHoraRaw,
      duracion_min: iHoraMaquina === -1 ? null : parseDuracionMinutos(row[iHoraMaquina]),
    });
  });

  return { filas, descartadas };
}

// ─── Resumen (preview de import y script de validación) ─────────────────────

export interface ResumenInformeProduccion {
  filasValidas: number;
  filasDescartadas: number;
  descartadasPorMotivo: Record<string, number>;
  kgTotal: number;
  lotesDistintos: number;
  fechaDesde: string | null;
  fechaHasta: string | null;
  fechasDistintas: number;
}

export function resumirInformeProduccion(resultado: ParseInformeProduccionResult): ResumenInformeProduccion {
  const { filas, descartadas } = resultado;
  const fechas = filas.map((f) => f.fecha).sort();
  const lotes = new Set(filas.map((f) => f.lote_codigo));
  const fechasSet = new Set(fechas);
  const descartadasPorMotivo: Record<string, number> = {};
  for (const d of descartadas) {
    descartadasPorMotivo[d.motivo] = (descartadasPorMotivo[d.motivo] ?? 0) + 1;
  }
  return {
    filasValidas: filas.length,
    filasDescartadas: descartadas.length,
    descartadasPorMotivo,
    kgTotal: filas.reduce((s, f) => s + f.kg, 0),
    lotesDistintos: lotes.size,
    fechaDesde: fechas[0] ?? null,
    fechaHasta: fechas[fechas.length - 1] ?? null,
    fechasDistintas: fechasSet.size,
  };
}

// ─── Resumen DECLARADO por el propio informe (cabecera decorativa) ──────────
// El informe trae su propio "Cantidad de Lotes: 1187" / "Peso (kg):
// 20.255.407,69 (...)*" en las primeras ~15 filas (antes de la tabla), en
// celdas combinadas (la etiqueta y el valor pueden no ser celdas contiguas).
// Se usa solo para comparar en la previsualización del import: si no se
// encuentra, ambos quedan `null` (no bloquea el import).

function primerNumeroEnFila(row: unknown[], desde: number): number | null {
  for (let i = desde; i < row.length; i++) {
    const cell = row[i];
    if (typeof cell === "number" && Number.isFinite(cell)) return cell;
    if (typeof cell === "string") {
      const m = cell.trim().match(/^(-?[\d.]*\d,\d+|-?\d+)/);
      if (m) {
        const numText = m[1].includes(",") ? m[1].replace(/\./g, "").replace(",", ".") : m[1];
        const num = Number(numText);
        if (Number.isFinite(num)) return num;
      }
    }
  }
  return null;
}

export interface ResumenDeclaradoInforme {
  lotesDeclarados: number | null;
  kgDeclarados: number | null;
}

/** Busca "Cantidad de Lotes:" y "Peso (kg):" en las primeras filas (cabecera decorativa) y extrae el primer número a su derecha en la misma fila. */
export function extraerResumenDeclaradoInforme(rows: unknown[][]): ResumenDeclaradoInforme {
  let lotesDeclarados: number | null = null;
  let kgDeclarados: number | null = null;
  for (const row of rows.slice(0, 20)) {
    for (let i = 0; i < row.length; i++) {
      const label = normalizeHeader(row[i]);
      if (lotesDeclarados == null && label.startsWith("cantidad de lotes")) {
        lotesDeclarados = primerNumeroEnFila(row, i + 1);
      }
      if (kgDeclarados == null && (label.startsWith("peso (kg)") || label.startsWith("peso(kg)"))) {
        kgDeclarados = primerNumeroEnFila(row, i + 1);
      }
    }
  }
  return { lotesDeclarados, kgDeclarados };
}
