/**
 * importBandejaAsistencia.ts — detección por CONTENIDO, para la Bandeja de
 * importación (/importar), del fichaje semanal de horas del personal (Excel
 * "SEMANA NN.xlsx" del programa de fichajes de RRHH): una fila por
 * (trabajador, día) con columna "Productor" (nombre engañoso: es el nombre
 * del TRABAJADOR, no un productor de fruta), "Actividad", "Fecha" y varios
 * tramos "HI"/"HF" (hora inicio/fin de cada pausa) más "HN"/"HE" (horas
 * normales/extra) y "Total" (importe, no horas).
 *
 * Vive en un módulo NUEVO y separado de src/lib/importBandeja.ts a propósito
 * (ese archivo lo está editando el dueño en paralelo para otra cosa): el tipo
 * union TipoArchivoBandeja vive allí y no se toca, así que este módulo
 * devuelve su propio resultado (AsistenciaHorasClasificado) que
 * src/pages/ImportarBandeja.tsx prueba SOLO cuando clasificarArchivoBandeja
 * devolvió "desconocido" (ver el jsdoc de ese archivo: el contenido de un
 * fichaje de horas no coincide con ningún parser de la cadena existente, así
 * que siempre cae en "desconocido" antes de llegar aquí).
 *
 * REUTILIZA por completo el parser semanal ya existente
 * (extractWeeklyAttendance de src/lib/asistenciaImport.ts, NO se toca): ese
 * parser ya sabe leer "nombre en una columna + fecha en otra columna, una
 * fila por combinación" sin importarle qué más haya en las columnas de en
 * medio (Actividad, HI, HF...), así que el fichaje de horas YA encaja en el
 * formato "semanal por columna de fecha" sin ningún cambio — lo único que
 * falta es (a) detectarlo por contenido para la bandeja (hoy esos archivos
 * caen todos en "desconocido": no hay ningún tipo de asistencia en la cadena
 * de importBandeja.ts) y (b) calcular el resumen de horas para la tarjeta,
 * ya que extractWeeklyAttendance solo extrae PRESENCIA (nombre presente ese
 * día), no las horas trabajadas — coherente con lo que el resto de la app
 * necesita: asistencia_detalle solo guarda presente/ausente, no horas (no
 * existe ninguna tabla de horas en el esquema).
 *
 * La cabecera exacta ("HI"/"HF"/"HN"/"HE") es justo lo que distingue este
 * formato de cualquier otro grid con una columna "Fecha" (p.ej. el export de
 * báscula, que tiene "Fecha"+"Lote"+"Kg Entrada" pero ningún HI/HF ni columna
 * de nombre de trabajador) y del informe de tamaños/clase por PRODUCTOR del
 * calibrador (que aunque también habla de "productor", no tiene ninguna fila
 * de cabecera con Fecha+HI+HF: usa secciones "Variedad:"/"(A) Extra 1").
 */
import { extractWeeklyAttendance, parseAttendanceDate, type WeeklyAttendanceDay } from "@/lib/asistenciaImport";

export interface AsistenciaHorasPayload {
  /** Mismo shape que produce extractWeeklyAttendance: lo consume directamente buildAttendanceRecords, sin reparsear. */
  dias: WeeklyAttendanceDay[];
  trabajadoresUnicos: number;
  fechaInicio: string;
  fechaFin: string;
  /** Suma de HN+HE (horas normales + extra) de las filas con nombre y fecha válidos; 0 si el archivo no trae esas columnas. */
  horasTotales: number;
}

export interface AsistenciaHorasClasificado {
  esAsistencia: true;
  fileName: string;
  /** Nº de registros (trabajador, día) leídos — mismo criterio de "n" que el resto de tarjetas de la bandeja. */
  n: number;
  motivo: string;
  payload: AsistenciaHorasPayload;
}

function normalizarCabecera(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

const RE_NOMBRE_COL = /\b(PRODUCTOR|NOMBRE|TRABAJADOR|OPERARIO|EMPLEADO)\b/;
const RE_FECHA_COL = /\b(FECHA|DIA)\b/;
const RE_HI_COL = /^H\.?I\.?$/;
const RE_HF_COL = /^H\.?F\.?$/;
const RE_HN_COL = /^H\.?N\.?$/;
const RE_HE_COL = /^H\.?E\.?$/;
const RE_HORAS_GENERICO_COL = /\bHORAS?\b/;

/** Nº de filas iniciales en las que se busca la cabecera del fichaje (siempre en las primeras filas del Excel real). */
const MAX_FILAS_CABECERA = 15;

interface CabeceraFichaje {
  fila: number;
  nombreCol: number;
  fechaCol: number;
  /** Columna a sumar para el resumen de horas: HN+HE si existen ambas (o la que exista), o una "Horas" genérica; null si no hay ninguna. */
  horasCols: number[];
}

/**
 * Localiza, en las primeras filas del grid, una cabecera con columna de
 * nombre (Productor/Nombre/Trabajador/Operario/Empleado) + columna de Fecha
 * + al menos un "HI" y un "HF" (la firma inequívoca del fichaje de horas:
 * ningún otro formato de la app combina esas cuatro cosas). Devuelve null si
 * no se encuentra en ninguna de esas filas.
 */
function localizarCabeceraFichaje(rows: unknown[][]): CabeceraFichaje | null {
  const limite = Math.min(rows.length, MAX_FILAS_CABECERA);
  for (let r = 0; r < limite; r++) {
    const row = rows[r] ?? [];
    const headers = row.map(normalizarCabecera);

    const nombreCol = headers.findIndex((h) => RE_NOMBRE_COL.test(h));
    const fechaCol = headers.findIndex((h) => RE_FECHA_COL.test(h));
    if (nombreCol === -1 || fechaCol === -1 || nombreCol === fechaCol) continue;

    const tieneHi = headers.some((h) => RE_HI_COL.test(h));
    const tieneHf = headers.some((h) => RE_HF_COL.test(h));
    if (!tieneHi || !tieneHf) continue;

    const hnCol = headers.findIndex((h) => RE_HN_COL.test(h));
    const heCol = headers.findIndex((h) => RE_HE_COL.test(h));
    const horasCols = [hnCol, heCol].filter((i) => i !== -1);
    if (horasCols.length === 0) {
      const genericoCol = headers.findIndex(
        (h) => RE_HORAS_GENERICO_COL.test(h) && !RE_HI_COL.test(h) && !RE_HF_COL.test(h),
      );
      if (genericoCol !== -1) horasCols.push(genericoCol);
    }

    return { fila: r, nombreCol, fechaCol, horasCols };
  }
  return null;
}

function aNumero(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Clasifica la primera hoja de un archivo de la bandeja como fichaje de
 * horas de personal, o devuelve null si no coincide (formato ajeno: ninguna
 * fila trae a la vez columna de nombre + Fecha + HI/HF).
 */
export function clasificarAsistenciaHoras(
  fileName: string,
  primeraHoja: unknown[][] | undefined | null,
  defaultYear: number = new Date().getFullYear(),
): AsistenciaHorasClasificado | null {
  if (!primeraHoja || primeraHoja.length < 2) return null;

  const cabecera = localizarCabeceraFichaje(primeraHoja);
  if (!cabecera) return null;

  // Reutiliza el parser semanal existente: ya sabe leer nombre+fecha por fila
  // sin que le importen las columnas HI/HF/HN/HE de en medio.
  const dias = extractWeeklyAttendance(primeraHoja, defaultYear);
  if (dias.length === 0) return null;

  const trabajadoresUnicos = new Set<string>();
  let registros = 0;
  for (const dia of dias) {
    registros += dia.names.length;
    for (const nombre of dia.names) trabajadoresUnicos.add(nombre.trim().toUpperCase());
  }

  const fechasOrdenadas = [...dias.map((d) => d.date)].sort();
  const fechaInicio = fechasOrdenadas[0];
  const fechaFin = fechasOrdenadas[fechasOrdenadas.length - 1];

  let horasTotales = 0;
  if (cabecera.horasCols.length > 0) {
    for (let i = cabecera.fila + 1; i < primeraHoja.length; i++) {
      const row = primeraHoja[i] ?? [];
      const nombre = row[cabecera.nombreCol];
      const fecha = parseAttendanceDate(row[cabecera.fechaCol], defaultYear);
      if (!fecha || !String(nombre ?? "").trim()) continue;
      for (const col of cabecera.horasCols) {
        const num = aNumero(row[col]);
        if (num !== null && num > 0) horasTotales += num;
      }
    }
  }
  horasTotales = Math.round(horasTotales * 10) / 10;

  const horasTexto = horasTotales > 0 ? `, ${horasTotales.toLocaleString("es-ES")} h totales` : "";

  return {
    esAsistencia: true,
    fileName,
    n: registros,
    motivo: `Fichaje de personal detectado: ${trabajadoresUnicos.size} trabajador(es), ${dias.length} día(s) (${fechaInicio} a ${fechaFin})${horasTexto}. Impórtalo desde RRHH → Asistencia (vista semanal) o confirma aquí para volcar la presencia directamente.`,
    payload: {
      dias,
      trabajadoresUnicos: trabajadoresUnicos.size,
      fechaInicio,
      fechaFin,
      horasTotales,
    },
  };
}
