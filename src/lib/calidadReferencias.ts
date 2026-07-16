/**
 * calidadReferencias — parser PURO (sin acceso a red) del informe "Totales de
 * Tamaños, Clase y Calidad por Variedad" que el calibrador exporta filtrado
 * por productor, y utilidades de porcentaje sobre el resultado.
 *
 * Alimenta `calidad_referencias_productor` (ver supabase/migrations/
 * 20260715120000_calidad_referencias_productor.sql): referencias de podrido
 * REAL medido en el calibrador, por productor y variedad. El simulador de
 * src/pages/EconomicoFruta.tsx las usa como 2º nivel de prioridad (después
 * del % de pérdida medido de los lotes procesados del productor —
 * src/lib/forfait.ts — y antes del podrido no pesado ASUMIDO,
 * PCT_PODRIDO_NO_PESADO_DEFECTO).
 *
 * ─── Formato del informe (verificado con los 2 archivos reales del dueño,
 * MORATALLA y INVERMARMELO TAMAÑOS CLASE Y CALIDAD POR VARIEDAD.xlsx, jul
 * 2026 — ver el script de validación que reproduce sus cifras exactas) ──────
 *   - Una fila "Filtros" trae en alguna celda el texto libre "Nombre del
 *     Productor es 'X'\nFecha de Lote es entre ...": de ahí se extrae el
 *     nombre del productor tal cual se filtró el informe.
 *   - Una o más secciones "Variedad:" (el nombre está en la primera celda no
 *     vacía a la derecha, en la MISMA fila — no en una columna fija).
 *   - Dentro de cada Variedad, secciones de Clase: una fila con una celda que
 *     matchea EXACTAMENTE "(letra mayúscula)" + texto, p. ej. "(A) Extra 1",
 *     "(J) Podrido" — el patrón de una sola letra mayúscula entre paréntesis
 *     es lo que distingue una Clase de una fila de Tamaño ("(01) CITRICA",
 *     dos dígitos). Unas pocas filas después aparece la cabecera de columnas
 *     ("Tamaño" / "Peso (kg)" entre otras) y luego las filas de Tamaño con el
 *     peso de esa clase; el kg de la clase es la suma de esas filas.
 *
 * NO se depende de columnas fijas en ningún punto (varían de una sección a
 * otra incluso dentro del mismo archivo): todo se localiza por
 * contenido/regex, barriendo celdas fila a fila.
 */
import { normalizarTexto } from "@/lib/format";

function cellStr(row: unknown[] | undefined, idx: number): string {
  const v = row?.[idx];
  return v == null ? "" : String(v).trim();
}

/** Primer índice de columna >= `desde` cuya celda no está vacía tras trim, o `null` si no hay ninguna. */
function indiceSiguienteNoVacio(row: unknown[], desde: number): number | null {
  for (let c = desde; c < row.length; c += 1) {
    if (cellStr(row, c) !== "") return c;
  }
  return null;
}

const RE_CLASE = /^\(([A-Z])\)\s*(.*)$/;
const RE_TAMANO = /^\(\d+\)/;
const RE_PRODUCTOR = /Nombre del Productor es\s+['’]([^'’]+)['’]/i;
/** Nº de filas hacia delante en que se busca la cabecera "Tamaño"/"Peso (kg)" tras una fila de Clase. */
const VENTANA_CABECERA = 15;

export interface ClaseKg {
  /** Letra de la clase ("A".."L", tal cual el informe). */
  codigo: string;
  /** Texto de la clase sin el prefijo "(X) ", p. ej. "Extra 1", "Podrido". */
  nombre: string;
  kg: number;
}

export interface VariedadInforme {
  variedad: string;
  /** Σ kg de todas las clases de esta variedad. */
  kgTotal: number;
  /** Σ kg de la(s) clase(s) cuyo nombre contiene "podrido" (case/acentos-insensitive; normalmente solo "(J) Podrido"). */
  kgPodrido: number;
  /** Clave = código de clase ("A".."L"). */
  kgPorClase: Map<string, ClaseKg>;
}

export interface InformeTamanosClases {
  /** Nombre del productor tal cual aparece en el filtro del informe. `null` si no se pudo extraer (Excel con formato inesperado). */
  productor: string | null;
  variedades: VariedadInforme[];
  /** Σ kgTotal de todas las variedades. */
  kgTotal: number;
  /** Σ kgPodrido de todas las variedades. */
  kgPodrido: number;
  /**
   * Avisos de estructura no reconocida (fila de Clase sin cabecera cercana,
   * "Variedad:" sin valor, clase repetida, productor no encontrado…): nunca
   * se ocultan, para que quien importe el informe pueda revisar el Excel si
   * algo no cuadra con lo esperado.
   */
  descartadas: string[];
}

/** % de kgPodrido sobre kgTotal, o 0 si kgTotal <= 0 (evita dividir por 0; no debería darse con un informe real). */
export function pctPodridoVariedad(v: Pick<VariedadInforme, "kgTotal" | "kgPodrido">): number {
  return v.kgTotal > 0 ? (v.kgPodrido / v.kgTotal) * 100 : 0;
}

/**
 * Parsea las filas crudas de la hoja (p. ej. `XLSX.utils.sheet_to_json(ws,
 * {header:1, raw:true, defval:null})`) del informe "Totales de Tamaños,
 * Clase y Calidad por Variedad" filtrado por un único productor.
 */
export function parseInformeTamanosClases(rows: unknown[][]): InformeTamanosClases {
  const descartadas: string[] = [];

  // ─── Productor: primera celda de todo el informe que matchea el patrón ──
  let productor: string | null = null;
  búsquedaProductor: for (const row of rows) {
    for (const cell of row ?? []) {
      if (cell == null) continue;
      const m = RE_PRODUCTOR.exec(String(cell));
      if (m) {
        productor = m[1].trim();
        break búsquedaProductor;
      }
    }
  }
  if (!productor) {
    descartadas.push("No se encontró 'Nombre del Productor' en la fila de Filtros del informe.");
  }

  const variedades: VariedadInforme[] = [];
  let actual: VariedadInforme | null = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];

    // ─── "Variedad:" (nombre en la primera celda no vacía a la derecha) ──
    let colVariedadLabel = -1;
    for (let c = 0; c < row.length; c += 1) {
      if (cellStr(row, c) === "Variedad:") {
        colVariedadLabel = c;
        break;
      }
    }
    if (colVariedadLabel >= 0) {
      const idxValor = indiceSiguienteNoVacio(row, colVariedadLabel + 1);
      if (idxValor == null) {
        descartadas.push(`Fila ${i + 1}: 'Variedad:' sin valor asociado, descartada.`);
      } else {
        if (actual) variedades.push(actual);
        actual = { variedad: cellStr(row, idxValor), kgTotal: 0, kgPodrido: 0, kgPorClase: new Map() };
      }
      continue;
    }

    // ─── Clase: "(X) Nombre" (X = una sola letra mayúscula) ──────────────
    let claseMatch: { codigo: string; nombre: string } | null = null;
    for (let c = 0; c < row.length; c += 1) {
      const m = RE_CLASE.exec(cellStr(row, c));
      if (m) {
        claseMatch = { codigo: m[1], nombre: m[2].trim() };
        break;
      }
    }
    if (!claseMatch) continue;

    if (!actual) {
      descartadas.push(`Fila ${i + 1}: clase '(${claseMatch.codigo}) ${claseMatch.nombre}' encontrada antes de cualquier 'Variedad:', descartada.`);
      continue;
    }

    // Cabecera de columnas ("Tamaño" / "Peso (kg)") en alguna de las próximas filas.
    let tamanoCol = -1;
    let pesoCol = -1;
    let headerRow = -1;
    for (let h = i + 1; h < Math.min(rows.length, i + 1 + VENTANA_CABECERA); h += 1) {
      const hr = rows[h] ?? [];
      let tCol = -1;
      let pCol = -1;
      for (let c = 0; c < hr.length; c += 1) {
        const norm = normalizarTexto(cellStr(hr, c), { trim: true });
        if (norm === "tamano") tCol = c;
        if (norm === "peso (kg)") pCol = c;
      }
      if (tCol >= 0 && pCol >= 0) {
        tamanoCol = tCol;
        pesoCol = pCol;
        headerRow = h;
        break;
      }
    }
    if (headerRow < 0) {
      descartadas.push(`Fila ${i + 1}: clase '(${claseMatch.codigo}) ${claseMatch.nombre}' sin cabecera 'Tamaño'/'Peso (kg)' cercana, descartada.`);
      continue;
    }

    // Filas de Tamaño ("(01) CITRICA", "(02) 9/130", …) inmediatamente
    // después de la cabecera: se suma su Peso (kg) hasta la primera fila que
    // no matchee el patrón (fin de la sección de Clase, sea la fila de
    // totales, un espaciador o la siguiente Clase/Variedad).
    let kgClase = 0;
    for (let r = headerRow + 1; r < rows.length; r += 1) {
      const dr = rows[r] ?? [];
      if (!RE_TAMANO.test(cellStr(dr, tamanoCol))) break;
      const n = Number(dr[pesoCol]);
      kgClase += Number.isFinite(n) ? n : 0;
    }

    const existente = actual.kgPorClase.get(claseMatch.codigo);
    if (existente) {
      descartadas.push(`Fila ${i + 1}: clase '(${claseMatch.codigo})' repetida en la variedad '${actual.variedad}', se suma al valor ya visto.`);
      existente.kg += kgClase;
    } else {
      actual.kgPorClase.set(claseMatch.codigo, { codigo: claseMatch.codigo, nombre: claseMatch.nombre, kg: kgClase });
    }
  }
  if (actual) variedades.push(actual);

  for (const v of variedades) {
    let total = 0;
    let podrido = 0;
    for (const c of v.kgPorClase.values()) {
      total += c.kg;
      if (normalizarTexto(c.nombre, { trim: true }).includes("podrido")) podrido += c.kg;
    }
    v.kgTotal = total;
    v.kgPodrido = podrido;
  }

  const kgTotal = variedades.reduce((s, v) => s + v.kgTotal, 0);
  const kgPodrido = variedades.reduce((s, v) => s + v.kgPodrido, 0);

  return { productor, variedades, kgTotal, kgPodrido, descartadas };
}
