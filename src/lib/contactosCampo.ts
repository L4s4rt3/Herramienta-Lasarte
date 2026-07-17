// src/lib/contactosCampo.ts
// Lógica pura de "Comunicaciones de campaña" (agenda de agricultores y
// proveedores de Jesús): validación de emails sueltos pegados a mano y parser
// tolerante del Excel de contactos (localiza las columnas nombre/email/tipo
// por cabecera con normalizarTexto; las filas sin email válido se descartan
// con su motivo, nunca en silencio).
import { normalizarTexto } from "@/lib/format";

export type ContactoCampoTipo = "agricultor" | "proveedor";

export interface ContactoCampoImportado {
  nombre: string;
  email: string;
  tipo: ContactoCampoTipo;
  notas: string | null;
}

export interface ContactoCampoDescartado {
  /** Número de fila de la hoja (1-based, como lo ve el usuario en Excel). */
  fila: number;
  motivo: string;
}

export interface ParseContactosCampoResult {
  contactos: ContactoCampoImportado[];
  descartados: ContactoCampoDescartado[];
}

/** Mismo criterio que la Edge Function enviar-comunicacion (EMAIL_RE). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function esEmailValido(value: string | null | undefined): boolean {
  return EMAIL_RE.test(String(value ?? "").trim());
}

/** Clave canónica de un email: trim + minúsculas (los emails son case-insensitive en la práctica). */
export function normalizarEmail(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Trocea un texto pegado a mano ("a@b.com, c@d.com; e@f.com") en emails.
 * Acepta comas, puntos y comas, espacios y saltos de línea como separadores.
 */
export function parseEmailsManuales(texto: string): { validos: string[]; invalidos: string[] } {
  const piezas = String(texto ?? "")
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const vistos = new Set<string>();
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const pieza of piezas) {
    if (!esEmailValido(pieza)) {
      invalidos.push(pieza);
      continue;
    }
    const clave = normalizarEmail(pieza);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    validos.push(clave);
  }
  return { validos, invalidos };
}

// ─── Parser del Excel de contactos ───────────────────────────────────────────

const CABECERAS_EMAIL = ["email", "e-mail", "correo", "correo electronico", "mail", "direccion de correo"];
const CABECERAS_NOMBRE = ["nombre", "contacto", "agricultor", "proveedor", "razon social", "empresa", "nombre y apellidos"];
const CABECERAS_TIPO = ["tipo", "categoria", "clase", "grupo"];
const CABECERAS_NOTAS = ["notas", "observaciones", "comentarios", "nota"];

function celdaTexto(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function coincideCabecera(celda: unknown, candidatas: string[]): boolean {
  const normalizada = normalizarTexto(celdaTexto(celda), { trim: true });
  if (!normalizada) return false;
  return candidatas.some((c) => normalizada === c || normalizada.startsWith(c + " ") || normalizada.includes(c));
}

interface ColumnasDetectadas {
  headerRow: number;
  nombre: number | null;
  email: number;
  tipo: number | null;
  notas: number | null;
}

/**
 * Busca la fila de cabecera en las primeras filas de la hoja: la primera que
 * tenga una celda de email reconocible. Si además hay columna de nombre/tipo/
 * notas, se apuntan; ninguna es obligatoria salvo el email.
 */
function detectarColumnasPorCabecera(rows: unknown[][]): ColumnasDetectadas | null {
  const maxFilas = Math.min(rows.length, 10);
  for (let r = 0; r < maxFilas; r++) {
    const row = rows[r] ?? [];
    let email: number | null = null;
    let nombre: number | null = null;
    let tipo: number | null = null;
    let notas: number | null = null;
    for (let c = 0; c < row.length; c++) {
      const celda = row[c];
      if (email == null && coincideCabecera(celda, CABECERAS_EMAIL)) { email = c; continue; }
      if (nombre == null && coincideCabecera(celda, CABECERAS_NOMBRE)) { nombre = c; continue; }
      if (tipo == null && coincideCabecera(celda, CABECERAS_TIPO)) { tipo = c; continue; }
      if (notas == null && coincideCabecera(celda, CABECERAS_NOTAS)) { notas = c; continue; }
    }
    if (email != null) return { headerRow: r, email, nombre, tipo, notas };
  }
  return null;
}

/**
 * Sin cabecera reconocible: detecta la columna de email por CONTENIDO (la que
 * más celdas con pinta de email tenga) y usa como nombre la primera columna
 * de texto distinta de la de email.
 */
function detectarColumnasPorContenido(rows: unknown[][]): ColumnasDetectadas | null {
  const maxFilas = Math.min(rows.length, 30);
  const conteoEmails = new Map<number, number>();
  for (let r = 0; r < maxFilas; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (esEmailValido(celdaTexto(row[c]))) {
        conteoEmails.set(c, (conteoEmails.get(c) ?? 0) + 1);
      }
    }
  }
  let email: number | null = null;
  let mejor = 0;
  for (const [col, n] of conteoEmails) {
    if (n > mejor) { mejor = n; email = col; }
  }
  if (email == null) return null;

  // Nombre: primera columna != email con texto no vacío en alguna fila.
  let nombre: number | null = null;
  for (let r = 0; r < maxFilas && nombre == null; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (c === email) continue;
      const texto = celdaTexto(row[c]);
      if (texto && !esEmailValido(texto)) { nombre = c; break; }
    }
  }
  // headerRow -1: no hay cabecera, los datos empiezan en la fila 0.
  return { headerRow: -1, email, nombre, tipo: null, notas: null };
}

/** Mapea el texto libre de la columna tipo a agricultor/proveedor; null si no se reconoce. */
export function parseTipoContacto(value: unknown): ContactoCampoTipo | null {
  const normalizado = normalizarTexto(celdaTexto(value), { trim: true });
  if (!normalizado) return null;
  if (normalizado.includes("agri") || normalizado.includes("productor")) return "agricultor";
  if (normalizado.includes("prove")) return "proveedor";
  return null;
}

/**
 * Parsea las filas crudas de la hoja de contactos (XLSX.utils.sheet_to_json
 * con header:1). Tolerante: localiza las columnas por cabecera (y si no hay
 * cabecera, por contenido); las filas sin email válido se descartan con
 * motivo; los emails repetidos dentro del fichero se quedan con la primera
 * aparición. Si una fila no trae nombre se usa la parte local del email.
 *
 * @param tipoPorDefecto Tipo asignado a las filas sin columna/valor de tipo
 *   reconocible (elegible en la UI antes de confirmar).
 */
export function parseContactosCampoRows(
  rows: unknown[][],
  tipoPorDefecto: ContactoCampoTipo = "agricultor",
): ParseContactosCampoResult {
  const contactos: ContactoCampoImportado[] = [];
  const descartados: ContactoCampoDescartado[] = [];
  if (!Array.isArray(rows) || rows.length === 0) return { contactos, descartados };

  const columnas = detectarColumnasPorCabecera(rows) ?? detectarColumnasPorContenido(rows);
  if (!columnas) {
    descartados.push({ fila: 1, motivo: "No se encontró ninguna columna de email en la hoja." });
    return { contactos, descartados };
  }

  const vistos = new Set<string>();
  for (let r = columnas.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const fila = r + 1; // 1-based, como lo ve el usuario en Excel.

    const esFilaVacia = row.every((celda) => !celdaTexto(celda));
    if (esFilaVacia) continue;

    const emailCrudo = celdaTexto(row[columnas.email]);
    if (!emailCrudo) {
      descartados.push({ fila, motivo: "Sin email." });
      continue;
    }
    if (!esEmailValido(emailCrudo)) {
      descartados.push({ fila, motivo: `Email no válido: "${emailCrudo}".` });
      continue;
    }
    const email = normalizarEmail(emailCrudo);
    if (vistos.has(email)) {
      descartados.push({ fila, motivo: `Email repetido en el fichero: ${email}.` });
      continue;
    }
    vistos.add(email);

    const nombreCrudo = columnas.nombre != null ? celdaTexto(row[columnas.nombre]) : "";
    const nombre = nombreCrudo || email.split("@")[0];
    const tipo = (columnas.tipo != null ? parseTipoContacto(row[columnas.tipo]) : null) ?? tipoPorDefecto;
    const notas = columnas.notas != null ? celdaTexto(row[columnas.notas]) || null : null;

    contactos.push({ nombre, email, tipo, notas });
  }

  return { contactos, descartados };
}
