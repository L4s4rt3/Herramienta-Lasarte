/**
 * informeLote.ts — parser PURO (sin acceso a red) del "Informe LOTE" del
 * calibrador ("Totales de Calidad  Clase Tamaño Por Producto"): un informe por
 * PASADA de lote individual, con el desglose completo Producto (de confección)
 * -> Calidad -> Clase/Grupo -> Tamaño de esa pasada.
 *
 * ─── Formato REAL (verificado contra los 2 archivos reales del dueño,
 * "Informe 26043013.xlsx" y "Informe 26042912.xlsx", jul 2026 — ver el script
 * de validación del scratchpad que reproduce sus cifras exactas: 23.802,50 kg
 * con 256,73 kg de podrido (J) el primero, 10,70 kg el segundo) ─────────────
 *
 *   - Cabecera en PARES etiqueta→valor (etiqueta en una celda, valor en la
 *     PRIMERA celda no vacía a su derecha en la MISMA fila; en los archivos
 *     reales: col 0→15 y col 32→47, pero NO se asume ninguna columna fija):
 *     "Commodity" (la variedad de fruta), "Productor / Código"
 *     ("INVERMARMELO / 71" — se separa por el ÚLTIMO " / "), "Nombre del
 *     Lote" (puede ser COMPUESTO: "26042912+26042911"), "Peso de Fruta
 *     Promedio (g)" y "Toneladas / Hora" como texto es-ES "14,89 (14,89)*",
 *     "Fecha y Hora de Comienzo" como SERIAL de Excel (46218.47 =
 *     2026-07-15; con cellDates:true llega como Date — parseFechaBascula de
 *     entradasBascula.ts cubre ambos casos), "Tiempo Lote" "HH:MM:SS".
 *   - NO hay kg total del lote en la cabecera: el kg del informe es la Σ de
 *     "Peso (kg)" de las filas de dato (la fila "Total del Lote:" del pie
 *     trae un total redondeado ligeramente distinto y NO se usa).
 *   - Secciones anidadas: "Producto:" (producto de CONFECCIÓN, muchas por
 *     archivo) → "Calidad:" → "Clase:" (valor "(A) Extra 1") con "Grupo de
 *     Clasificación:" en la misma fila → cabecera de mini-tabla
 *     "Tamaño|Piezas|% Piezas|Peso (kg)|% Peso|Cartons|% Cartons" (columnas
 *     localizadas por TEXTO en cada sección, nunca por índice fijo) → filas
 *     de dato con Tamaño "(NN) …" (regex /^\(\d+\)/, misma técnica que
 *     calidadReferencias.ts).
 *   - Tras las filas de dato de cada clase hay una FILA SUBTOTAL idéntica
 *     pero SIN etiqueta de Tamaño (celda vacía + Peso numérico): se salta en
 *     silencio (sus valores son la suma de las filas ya capturadas). Las
 *     filas "Total de Calidad:", "Total del Producto:" y "Total del Lote:"
 *     también se saltan (son pies de sección, no datos).
 *   - Los porcentajes vienen como FRACCIONES (0..1), y se guardan tal cual
 *     (misma convención que la edge function analizar-lote-excel y que
 *     lote_clasificacion en BD).
 *
 * Un lote puede tener VARIOS informes (pasadas en días distintos, incluidas
 * micro-pasadas de pocos kg): la identidad de un informe es (lote de 8
 * dígitos, fecha de comienzo), NUNCA solo el lote — el dedup del import
 * (useHistoricoImport.ts, planImportInformesLote) se apoya en eso.
 *
 * Limitación conocida: en lotes COMPUESTOS ("A+B") normalizarLoteCodigo
 * acredita todo el informe al PRIMER código de 8 dígitos (convención A del
 * repo, ver src/lib/loteCodigo.ts) — igual que ya hacen lotes_dia/mermaLote
 * con las pasadas compuestas del calibrador.
 *
 * NOTA sobre la edge function supabase/functions/analizar-lote-excel/index.ts:
 * fue la referencia inicial del formato, pero el archivo REAL difiere de lo
 * que esa función espera (cabecera en pares por contenido, filas subtotal sin
 * etiqueta, "Producto:" como sección repetida…). Este parser sigue el formato
 * REAL verificado; la edge function queda como está (parsea la variante que
 * le llega vía partes_archivos).
 */
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { parseFechaBascula } from "@/lib/entradasBascula";

/** Fila de Tamaño ("(01) CITRICA", "(13) 1/36", …): misma técnica que RE_TAMANO de calidadReferencias.ts. */
const RE_TAMANO = /^\(\d+\)/;
/** Etiquetas de pie de sección: sus filas traen números pero NO son datos (subtotales ya incluidos en las filas capturadas). */
const RE_TOTAL = /^Total (de Calidad|del Producto|del Lote):?$/i;

export interface FilaClasificacionInforme {
  /** Producto de CONFECCIÓN de la sección ("MDNA 3KG D-PACK CAL 4/5", "INDUSTRIA", …), no la variedad de fruta. */
  producto: string;
  calidad: string | null;
  /** Texto completo de la clase tal cual el informe ("(A) Extra 1", "(J) Podrido"). */
  clase: string;
  grupoDestino: string | null;
  tamano: string;
  piezas: number | null;
  /** Fracción 0..1, tal cual el informe (misma convención que lote_clasificacion.pct_piezas). */
  pctPiezas: number | null;
  pesoKg: number;
  pctPeso: number | null;
  cartons: number | null;
  pctCartons: number | null;
}

export interface InformeLote {
  /** Texto crudo de "Nombre del Lote" (puede ser compuesto "26042912+26042911"). */
  loteCodigo: string;
  /** Convención A del repo (primer grupo de 8 dígitos, ver loteCodigo.ts). `null` si el texto no trae ninguno. */
  loteCodigoNormalizado: string | null;
  productorNombre: string | null;
  productorCodigo: string | null;
  /** "Commodity" de la cabecera: la variedad de fruta ("VALENCIA DELTA"), no el producto de confección. */
  variedad: string | null;
  /** ISO "YYYY-MM-DD" de "Fecha y Hora de Comienzo" (la fecha del PROCESADO de esta pasada). `null` si no se pudo leer. */
  fechaComienzo: string | null;
  toneladasHora: number | null;
  pesoFrutaPromedioG: number | null;
  /** "Tiempo Lote" (HH:MM:SS) en minutos. */
  duracionLoteMin: number | null;
  /** Σ pesoKg de TODAS las filas de dato: el kg total procesado que acredita este informe (no hay total fiable en cabecera). */
  kgTotal: number;
  /** Σ pesoKg de las filas cuya clase contiene "podrido" (case-insensitive; normalmente "(J) Podrido"). Un 0 con informe presente es un 0 REAL. */
  kgPodrido: number;
  clasificacion: FilaClasificacionInforme[];
}

export interface ParseInformeLoteResult {
  /** `null` si el archivo no es un Informe LOTE reconocible (ver descartadas para el motivo). */
  informe: InformeLote | null;
  /**
   * Motivos de descarte del archivo entero (si `informe` es null) y avisos de
   * filas/estructura no reconocida (aunque el parse haya ido bien): nunca se
   * ocultan, para poder revisar el Excel si el formato real difiere.
   */
  descartadas: string[];
}

function cellStr(row: unknown[] | undefined, idx: number): string {
  const v = row?.[idx];
  return v == null ? "" : String(v).trim();
}

/** Primer índice de columna > `desde` cuya celda no está vacía tras trim, o -1. */
function indiceSiguienteNoVacio(row: unknown[], desde: number): number {
  for (let c = desde + 1; c < row.length; c += 1) {
    if (cellStr(row, c) !== "") return c;
  }
  return -1;
}

/** Valor CRUDO de la primera celda no vacía a la derecha de la celda cuyo texto es exactamente `etiqueta` (par etiqueta→valor de la cabecera). `undefined` si la etiqueta no está en la fila. */
function valorTrasEtiqueta(row: unknown[], etiqueta: string): unknown {
  for (let c = 0; c < row.length; c += 1) {
    if (cellStr(row, c) === etiqueta) {
      const idx = indiceSiguienteNoVacio(row, c);
      return idx === -1 ? null : row[idx];
    }
  }
  return undefined;
}

/**
 * Número de una celda que puede venir como number crudo o como texto es-ES
 * con decoración: "14,89 (14,89)*" → 14.89. Misma técnica que
 * parseLeadingSpanishNumber de la edge function analizar-lote-excel.
 */
export function numeroEsCelda(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).trim().match(/^(-?[\d.,]+)/);
  if (!m) return null;
  let s = m[1];
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** "HH:MM:SS" (las horas pueden superar 24: "18:30:10") a minutos. */
export function hhmmssAMinutos(v: unknown): number | null {
  const m = String(v ?? "").trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
}

/**
 * Parsea las filas crudas de la hoja (`XLSX.utils.sheet_to_json(ws, {header:1,
 * raw:true, defval:null})`, workbook leído con o sin cellDates) de UN
 * "Informe LOTE" del calibrador. Ver la cabecera del archivo para el formato.
 */
export function parseInformeLoteRows(rows: unknown[][]): ParseInformeLoteResult {
  const descartadas: string[] = [];

  // ─── Cabecera: pares etiqueta→valor, se deja de buscar al llegar a la tabla ──
  let loteCodigo: string | null = null;
  let productorNombre: string | null = null;
  let productorCodigo: string | null = null;
  let variedad: string | null = null;
  let fechaComienzo: string | null = null;
  let toneladasHora: number | null = null;
  let pesoFrutaPromedioG: number | null = null;
  let duracionLoteMin: number | null = null;

  for (const row of rows) {
    if ((row ?? []).some((c) => cellStr([c], 0) === "Producto:")) break;
    const r = row ?? [];

    const lote = valorTrasEtiqueta(r, "Nombre del Lote");
    if (lote !== undefined && lote !== null && loteCodigo == null) loteCodigo = String(lote).trim() || null;

    const prod = valorTrasEtiqueta(r, "Productor / Código");
    if (prod !== undefined && prod !== null && productorNombre == null) {
      const s = String(prod).trim();
      const idx = s.lastIndexOf(" / ");
      if (idx === -1) {
        productorNombre = s || null;
      } else {
        productorNombre = s.slice(0, idx).trim() || null;
        productorCodigo = s.slice(idx + 3).trim() || null;
      }
    }

    const comm = valorTrasEtiqueta(r, "Commodity");
    if (comm !== undefined && comm !== null && variedad == null) variedad = String(comm).trim() || null;

    const fecha = valorTrasEtiqueta(r, "Fecha y Hora de Comienzo");
    if (fecha !== undefined && fecha !== null && fechaComienzo == null) fechaComienzo = parseFechaBascula(fecha);

    const tph = valorTrasEtiqueta(r, "Toneladas / Hora");
    if (tph !== undefined && tph !== null && toneladasHora == null) toneladasHora = numeroEsCelda(tph);

    const pfp = valorTrasEtiqueta(r, "Peso de Fruta Promedio (g)");
    if (pfp !== undefined && pfp !== null && pesoFrutaPromedioG == null) pesoFrutaPromedioG = numeroEsCelda(pfp);

    const tl = valorTrasEtiqueta(r, "Tiempo Lote");
    if (tl !== undefined && tl !== null && duracionLoteMin == null) duracionLoteMin = hhmmssAMinutos(tl);
  }

  if (!loteCodigo) {
    return {
      informe: null,
      descartadas: ["No parece un Informe LOTE del calibrador: no se encontró 'Nombre del Lote' en la cabecera."],
    };
  }
  if (!fechaComienzo) {
    descartadas.push("No se pudo leer 'Fecha y Hora de Comienzo' (el import necesita la fecha para colgar el informe de su parte).");
  }

  // ─── Tabla: secciones Producto -> Calidad -> Clase/Grupo -> mini-tabla ─────
  const clasificacion: FilaClasificacionInforme[] = [];
  let producto: string | null = null;
  let calidad: string | null = null;
  let clase: string | null = null;
  let grupo: string | null = null;
  // Columnas de la mini-tabla actual (localizadas por texto en su cabecera; -1 = esa columna no existe en esta sección).
  let enTabla = false;
  let cTamano = -1;
  let cPiezas = -1;
  let cPctPiezas = -1;
  let cPeso = -1;
  let cPctPeso = -1;
  let cCartons = -1;
  let cPctCartons = -1;

  const num = (row: unknown[], col: number): number | null => (col === -1 ? null : numeroEsCelda(row[col]));

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];

    // Etiquetas de sección/pie: se buscan en CUALQUIER celda de la fila.
    let esEtiqueta = false;
    for (let c = 0; c < row.length; c += 1) {
      const s = cellStr(row, c);
      if (s === "Producto:") {
        const idx = indiceSiguienteNoVacio(row, c);
        producto = idx === -1 ? null : cellStr(row, idx) || null;
        calidad = null;
        clase = null;
        grupo = null;
        enTabla = false;
        if (producto == null) descartadas.push(`Fila ${i + 1}: 'Producto:' sin valor asociado.`);
        esEtiqueta = true;
        break;
      }
      if (s === "Calidad:") {
        const idx = indiceSiguienteNoVacio(row, c);
        calidad = idx === -1 ? null : cellStr(row, idx) || null;
        enTabla = false;
        esEtiqueta = true;
        break;
      }
      if (s === "Clase:") {
        const idx = indiceSiguienteNoVacio(row, c);
        clase = idx === -1 ? null : cellStr(row, idx) || null;
        const g = valorTrasEtiqueta(row, "Grupo de Clasificación:");
        grupo = g === undefined || g === null ? null : String(g).trim() || null;
        enTabla = false;
        if (clase == null) descartadas.push(`Fila ${i + 1}: 'Clase:' sin valor asociado, sus filas se descartarán.`);
        esEtiqueta = true;
        break;
      }
      if (RE_TOTAL.test(s)) {
        // Pie de sección ("Total de Calidad:", "Total del Producto:", "Total
        // del Lote:"): sus números son sumas de lo ya capturado, se ignoran.
        enTabla = false;
        esEtiqueta = true;
        break;
      }
      if (s === "Tamaño") {
        // Cabecera de la mini-tabla: localizar TODAS las columnas por texto.
        cTamano = c;
        cPiezas = cPctPiezas = cPeso = cPctPeso = cCartons = cPctCartons = -1;
        for (let k = c + 1; k < row.length; k += 1) {
          const h = cellStr(row, k);
          if (h === "Piezas") cPiezas = k;
          else if (h === "% Piezas") cPctPiezas = k;
          else if (h === "Peso (kg)") cPeso = k;
          else if (h === "% Peso") cPctPeso = k;
          else if (h === "Cartons") cCartons = k;
          else if (h === "% Cartons") cPctCartons = k;
        }
        if (cPeso === -1) {
          descartadas.push(`Fila ${i + 1}: cabecera 'Tamaño' sin columna 'Peso (kg)', la sección se descarta.`);
          enTabla = false;
        } else {
          enTabla = true;
        }
        esEtiqueta = true;
        break;
      }
    }
    if (esEtiqueta || !enTabla) continue;

    const tamano = cellStr(row, cTamano);
    if (RE_TAMANO.test(tamano)) {
      if (!producto || !clase) {
        descartadas.push(`Fila ${i + 1}: fila de tamaño '${tamano}' fuera de una sección Producto/Clase, descartada.`);
        continue;
      }
      const pesoKg = num(row, cPeso);
      if (pesoKg == null) {
        descartadas.push(`Fila ${i + 1}: fila de tamaño '${tamano}' sin 'Peso (kg)' numérico, descartada.`);
        continue;
      }
      clasificacion.push({
        producto,
        calidad,
        clase,
        grupoDestino: grupo,
        tamano,
        piezas: num(row, cPiezas),
        pctPiezas: num(row, cPctPiezas),
        pesoKg,
        pctPeso: num(row, cPctPeso),
        cartons: num(row, cCartons),
        pctCartons: num(row, cPctCartons),
      });
      continue;
    }

    // Fila SUBTOTAL de la clase: sin etiqueta de Tamaño pero con Peso numérico
    // (duplica la suma de las filas ya capturadas) -> se salta en silencio.
    if (tamano === "") continue;

    // Cualquier otra cosa con texto en la columna de Tamaño es estructura no
    // reconocida: se avisa (nunca se oculta) por si el formato real difiere.
    descartadas.push(`Fila ${i + 1}: texto no reconocido en la columna de Tamaño ('${tamano}'), fila ignorada.`);
  }

  if (clasificacion.length === 0) {
    descartadas.push("No se encontró ninguna fila de Tamaño con 'Peso (kg)' (¿es realmente un Informe LOTE?).");
  }

  const kgTotal = clasificacion.reduce((s, f) => s + f.pesoKg, 0);
  const kgPodrido = clasificacion.reduce(
    (s, f) => s + (f.clase.toLowerCase().includes("podrido") ? f.pesoKg : 0),
    0,
  );

  return {
    informe: {
      loteCodigo,
      loteCodigoNormalizado: normalizarLoteCodigo(loteCodigo),
      productorNombre,
      productorCodigo,
      variedad,
      fechaComienzo,
      toneladasHora,
      pesoFrutaPromedioG,
      duracionLoteMin,
      kgTotal,
      kgPodrido,
      clasificacion,
    },
    descartadas,
  };
}
