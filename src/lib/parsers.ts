/**
 * parsers.ts — Parser de informes Excel del calibrador Spectrim.
 *
 * Campos capturados por informe:
 *
 * PRODUCCIÓN: ID Lote, Nombre Lote, Código Productor, Nombre Productor,
 *   Variedad, Tiempo Inicio, Hora Máquina, Peso(kg), T/h, Peso Fruta Promedio(g)
 *
 * PRODUCTO: Producto, Empaque, Empaques, Peso(kg), Fruta
 *
 * TAMAÑOS/CALIBRES: Variedad, Clase, Grupo, Peso(kg), Tamaños
 *   + agrupación por Tipo (Exportación / Mujeres / No exportación / No comercial)
 *
 * PALETS: Producto, Fecha, Cliente, Kg Netos
 */
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// MODO DIAGNÓSTICO
// Actívalo con ?debug=parsers en la URL para ver en consola las claves reales
// ─────────────────────────────────────────────────────────────────────────────
const DEBUG = typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("debug");

function debug(label: string, data: any) {
  if (DEBUG) console.log(`[PARSER:${label}]`, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DE SALIDA
// ─────────────────────────────────────────────────────────────────────────────

/** Un lote del informe de producción con todos los campos del Spectrim */
export interface LoteProduccion {
  id_lote: string | null;            // ID del Lote
  nombre_lote: string | null;        // Nombre del Lote
  codigo_productor: string | null;   // Código del Productor
  nombre_productor: string | null;   // Nombre del Productor
  variedad: string | null;           // Variedad
  tiempo_inicio: string | null;      // Tiempo de Inicio
  hora_maquina: string | null;       // Hora de la Máquina
  kg_peso_total: number;             // Peso (kg)
  toneladas_hora: number | null;     // Toneladas / Hora
  peso_fruta_promedio_g: number | null; // Peso de Fruta Promedio (g)

  // Alias legacy para compatibilidad con código existente
  lote_codigo: string | null;        // = id_lote
  productor: string | null;          // = nombre_productor
  producto: string | null;           // = variedad
  hora_inicio: string | null;        // = tiempo_inicio
  duracion_min: number | null;       // si existe en el Excel
}

/** Una fila del informe de producto empacado */
export interface ProductoEmpacado {
  producto: string | null;           // Producto
  empaque: string | null;            // Empaque
  empaques: number | null;           // Empaques (cantidad)
  kg: number;                        // Peso (kg)
  fruta: string | null;              // Fruta

  // Legacy
  linea: string | null;
  formato_caja: string | null;
  cajas: number | null;
  grupo_destino: string | null;
}

/** Una fila del informe de calibres / tamaños */
export interface CalibreRow {
  variedad: string | null;           // Variedad
  clase: string | null;              // Clase
  grupo: string | null;              // Grupo (Exportación, Mujeres, etc.)
  kg: number;                        // Peso (kg)
  tamanos: string | null;            // Tamaños (lista separada por comas)

  // Legacy
  calibre: string;
  piezas: number;
  pct: number;
  grupo_destino: string | null;
}

/** Agrupación de tamaños por tipo de clasificación */
export interface TipoClasificacion {
  tipo: "Exportación" | "Mujeres" | "No exportación" | "No comercial" | string;
  kg: number;
  tamanos: string[];                 // lista de tamaños/calibres
}

/** Una fila del informe de palets */
export interface PaletRow {
  producto: string | null;           // Producto
  fecha: string | null;              // Fecha
  cliente: string | null;            // Cliente
  kg_neto: number;                   // Kg netos

  // Legacy
  palet_id: string | null;
  destino: string | null;
  situacion: "S" | "F" | null;
  n_cajas: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DE RESULTADO PARSEADO
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedProduccion {
  tipo: "produccion";
  lotes: LoteProduccion[];
  kg_total: number;
  tph_promedio: number | null;
  /** Columnas brutas detectadas — para diagnóstico */
  _columnas_detectadas?: string[];
}

export interface ParsedPalets {
  tipo: "palets";
  palets: PaletRow[];
  kg_camara: number;
  kg_facturado: number;
  kg_ficticio: number;
  kg_total_bruto: number;
  _columnas_detectadas?: string[];
}

export interface ParsedProducto {
  tipo: "producto";
  lineas: ProductoEmpacado[];
  kg_exportacion: number;
  kg_mercado: number;
  kg_industria: number;
  kg_total: number;
  _columnas_detectadas?: string[];
}

export interface ParsedCalibres {
  tipo: "calibres";
  calibres: CalibreRow[];
  tipos_clasificacion: TipoClasificacion[];
  kg_exportacion: number;
  kg_mercado: number;
  kg_industria: number;
  kg_total: number;
  _columnas_detectadas?: string[];
}

export type ParsedInforme =
  | ParsedProduccion
  | ParsedPalets
  | ParsedProducto
  | ParsedCalibres;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

function parseWorkbook(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        resolve(wb);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Convierte una hoja en array de objetos. Las claves se normalizan a:
 * minúsculas · sin tildes · espacios→_ · caracteres especiales eliminados
 * Además guarda la clave original en _orig_<clave> para diagnóstico.
 */
function sheetToRows(sheet: XLSX.WorkSheet): Record<string, any>[] {
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: null,
    raw: false,
  });
  return raw.map((row) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      // Clave normalizada
      const norm = k
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")   // quita tildes
        .replace(/[^\w\s]/g, "")            // quita puntuación
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .trim();
      out[norm] = v;
      // También guardamos versión con espacios para matching flexible
      out[`_raw_${norm}`] = k; // nombre original (para diagnóstico)
    }
    return out;
  });
}

function num(v: any): number {
  if (v === null || v === undefined || v === "" || v === "-") return 0;
  const s = String(v).trim();
  // Detect format: if has both . and , determine which is decimal
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let cleaned: string;

  if (hasComma && hasDot) {
    // Both present: last one is the decimal separator
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Format: 1.234,56 (European: dot=thousands, comma=decimal)
      cleaned = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Format: 1,234.56 (English: comma=thousands, dot=decimal)
      cleaned = s.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    // Only comma: could be decimal (3,5) or thousands (1,234)
    // If exactly 3 digits after comma, treat as thousands; otherwise decimal
    const afterComma = s.split(",")[1];
    if (afterComma && afterComma.length === 3 && s.split(",").length === 2) {
      cleaned = s.replace(",", ""); // thousands separator
    } else {
      cleaned = s.replace(",", "."); // decimal separator
    }
  } else {
    // Only dots or no separators — treat as-is (dot is decimal)
    cleaned = s;
  }

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function str(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "-" || s === "N/A" ? null : s;
}

/**
 * Busca el valor de una columna intentando múltiples variantes del nombre.
 * Devuelve el primer match encontrado o undefined.
 */
function col(row: Record<string, any>, ...keys: string[]): any {
  for (const k of keys) {
    const norm = k
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .trim();
    if (row[norm] !== undefined && row[norm] !== null) return row[norm];
    // También buscar sin guiones bajos (palabras pegadas)
    const noUnd = norm.replace(/_/g, "");
    for (const rk of Object.keys(row)) {
      if (rk.replace(/_/g, "") === noUnd) return row[rk];
    }
  }
  return undefined;
}

function normGrupo(g: string | null): "exportacion" | "mercado" | "industria" | "otro" {
  if (!g) return "otro";
  const s = g.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes("export") || s.includes("ext")) return "exportacion";
  if (s.includes("mercado") || s.includes("nac") || s.includes("int") || s.includes("interior")) return "mercado";
  if (s.includes("ind") || s.includes("industria")) return "industria";
  if (s.includes("mujer") || s.includes("mujeres")) return "mercado"; // mujeres cuenta como mercado
  return "otro";
}


// ─────────────────────────────────────────────────────────────────────────────
// DETECCIÓN DE TIPO DE INFORME
// ─────────────────────────────────────────────────────────────────────────────

export type TipoInforme =
  | "produccion"
  | "palets"
  | "producto"
  | "calibres"
  | "desconocido";

export function detectarTipoInforme(
  fileName: string,
  wb: XLSX.WorkBook
): TipoInforme {
  const name = fileName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Por nombre de archivo (más fiable)
  if (name.includes("produccion") || name.includes("lote")) return "produccion";
  if (name.includes("palet")) return "palets";
  if (name.includes("producto") && !name.includes("tamano") && !name.includes("calibre") && !name.includes("clase")) return "producto";
  if (name.includes("tamano") || name.includes("calibre") || name.includes("clase") || name.includes("calidad") || name.includes("variedad")) return "calibres";

  // Fallback por contenido de columnas
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(sheet);
  if (rows.length === 0) return "desconocido";

  const keys = Object.keys(rows[0]).join(" ");
  debug("COLUMNAS_DETECTADAS", { fileName, keys, sheetNames: wb.SheetNames });

  if (keys.includes("productor") || keys.includes("toneladas") || keys.includes("t_h") || keys.includes("id_lote") || keys.includes("lote") || keys.includes("nombre_del_lote")) return "produccion";
  if (keys.includes("sit") || keys.includes("palet_id") || keys.includes("palet") || (keys.includes("neto") && keys.includes("cliente")) || (keys.includes("peso") && keys.includes("destino"))) return "palets";
  if (keys.includes("variedad") || keys.includes("calibre") || keys.includes("tamano") || keys.includes("clase")) return "calibres";
  if (keys.includes("empaque") || keys.includes("empaques") || keys.includes("fruta")) return "producto";

  return "desconocido";
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER A: Informe de Producción
// Campos: ID Lote, Nombre Lote, Código Productor, Nombre Productor,
//         Variedad, Tiempo Inicio, Hora Máquina, Peso(kg), T/h, Peso Fruta(g)
// ─────────────────────────────────────────────────────────────────────────────

export function parseInformeProduccion(wb: XLSX.WorkBook): ParsedProduccion {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(sheet);

  if (rows.length > 0) {
    debug("PRODUCCION_COLUMNAS", Object.keys(rows[0]).filter(k => !k.startsWith("_raw")));
    debug("PRODUCCION_PRIMERA_FILA", rows[0]);
  }

  const lotes: LoteProduccion[] = [];

  for (const row of rows) {
    // ── Peso (kg) — campo obligatorio para incluir la fila ──
    const kgRaw = col(row,
      "Peso (kg)", "Peso(kg)", "peso_kg", "Peso kg", "peso",
      "Peso total", "peso_total", "Total Kg", "total_kg",
      "kg", "kilos", "Kilos", "Peso Kg"
    );
    const kg = num(kgRaw);
    if (kg <= 0) continue;

    // ── ID del Lote (puede ser "Unnamed: 0" en Spectrim) ──
    const idLote = str(col(row,
      "Unnamed: 0", "unnamed_0",
      "ID", "id", "ID Lote", "id_lote", "Id Lote",
      "Número de Lote", "numero_lote", "Nº Lote", "n_lote",
      "Lote ID", "lote_id", "Cod Lote", "cod_lote",
      "Bins", "bins"
    ));

    // ── Nombre del Lote ──
    const nombreLote = str(col(row,
      "Lote", "lote", "Nombre Lote", "nombre_lote",
      "Nombre del Lote", "nombre_del_lote",
      "Descripción Lote", "descripcion_lote",
      "Lote Descripcion", "lote_descripcion"
    )) ?? idLote; // si no hay nombre, usa el ID

    // ── Código del Productor ──
    const codProductor = str(col(row,
      "Código del Productor", "codigo_del_productor",
      "Código Productor", "codigo_productor", "Cod Productor", "cod_productor",
      "Código Agricultor", "codigo_agricultor", "Cod. Agric", "cod_agric",
      "Cod Proveedor", "cod_proveedor", "ID Productor", "id_productor",
      "Productor ID", "productor_id", "Nº Productor", "n_productor"
    ));

    // ── Nombre del Productor ──
    const nombreProductor = str(col(row,
      "Nombre del Productor", "nombre_del_productor",
      "Productor", "productor",
      "Nombre Productor", "nombre_productor",
      "Agricultor", "agricultor",
      "Nombre Agricultor", "nombre_agricultor",
      "Proveedor", "proveedor",
      "Nombre Proveedor", "nombre_proveedor",
      "Razón Social", "razon_social"
    ));

    // ── Variedad ──
    const variedad = str(col(row,
      "Variedad", "variedad",
      "Tipo", "tipo",
      "Producto", "producto",
      "Especie", "especie",
      "Denominación", "denominacion",
      "Descripción Variedad", "descripcion_variedad"
    ));

    // ── Tiempo de Inicio ──
    const tiempoInicio = str(col(row,
      "Tiempo de Inicio", "tiempo_de_inicio", "tiempo_inicio",
      "Inicio", "inicio",
      "Hora Inicio", "hora_inicio",
      "Hora de Inicio", "hora_de_inicio",
      "Comienzo", "comienzo",
      "Start", "start"
    ));

    // ── Hora de la Máquina ──
    const horaMaquina = str(col(row,
      "Hora de la Máquina", "hora_de_la_maquina", "hora_maquina",
      "Hora Máquina", "hora_maquina",
      "Tiempo Máquina", "tiempo_maquina",
      "Hora Calibrador", "hora_calibrador",
      "Machine Time", "machine_time",
      "Duración", "duracion", "Tiempo", "tiempo"
    ));

    // ── Toneladas / Hora ──
    const tphRaw = col(row,
      "Toneladas / Hora", "toneladas_hora", "toneladas__hora",
      "Toneladas", "toneladas",
      "T/h", "t_h", "Th", "th",
      "Ton/h", "ton_h",
      "Velocidad", "velocidad",
      "Rendimiento", "rendimiento",
      "Kg/h", "kg_h"
    );

    // ── Peso de Fruta Promedio (g) ──
    const pesoPiezaRaw = col(row,
      "Peso de Fruta Promedio (g)", "peso_de_fruta_promedio_g",
      "Peso de Fruta Promedio g", "peso_de_fruta_promedio_g",
      "Peso Fruta Promedio", "peso_fruta_promedio",
      "Peso Fruta", "peso_fruta",
      "Peso Pieza", "peso_pieza",
      "Peso Medio", "peso_medio",
      "Gramos", "gramos", "g",
      "Avg Weight", "avg_weight",
      "Peso Promedio Fruta", "peso_promedio_fruta"
    );

    // ── Duración ──
    const duracionRaw = col(row,
      "Duración", "duracion", "Duración (min)", "duracion_min",
      "Minutos", "minutos", "Tiempo (min)", "tiempo_min",
      "Duration", "duration"
    );

    lotes.push({
      id_lote:                  idLote,
      nombre_lote:              nombreLote,
      codigo_productor:         codProductor,
      nombre_productor:         nombreProductor,
      variedad:                 variedad,
      tiempo_inicio:            tiempoInicio,
      hora_maquina:             horaMaquina,
      kg_peso_total:            kg,
      toneladas_hora:           tphRaw !== undefined ? num(tphRaw) || null : null,
      peso_fruta_promedio_g:    pesoPiezaRaw !== undefined ? num(pesoPiezaRaw) || null : null,

      // Aliases legacy
      lote_codigo:              idLote ?? nombreLote,
      productor:                nombreProductor,
      producto:                 variedad,
      hora_inicio:              tiempoInicio,
      duracion_min:             duracionRaw !== undefined ? num(duracionRaw) || null : null,
    });
  }

  const kg_total = lotes.reduce((s, l) => s + l.kg_peso_total, 0);

  // T/h promedio ponderado por duración
  let tph_promedio: number | null = null;
  const conTph = lotes.filter(l => l.toneladas_hora !== null && l.toneladas_hora > 0);
  if (conTph.length > 0) {
    const totalMin = conTph.reduce((s, l) => s + (l.duracion_min ?? 1), 0);
    tph_promedio = totalMin > 0
      ? conTph.reduce((s, l) => s + (l.toneladas_hora as number) * (l.duracion_min ?? 1), 0) / totalMin
      : conTph.reduce((s, l) => s + (l.toneladas_hora as number), 0) / conTph.length;
  }

  return {
    tipo: "produccion",
    lotes,
    kg_total,
    tph_promedio,
    _columnas_detectadas: rows.length > 0
      ? Object.keys(rows[0]).filter(k => !k.startsWith("_raw"))
      : [],
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// PARSER B: Palets
// Campos: Producto, Fecha, Cliente, Kg Netos
// ─────────────────────────────────────────────────────────────────────────────

export function parsePalets(wb: XLSX.WorkBook): ParsedPalets {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(sheet);

  if (rows.length > 0) {
    debug("PALETS_COLUMNAS", Object.keys(rows[0]).filter(k => !k.startsWith("_raw")));
    debug("PALETS_PRIMERA_FILA", rows[0]);
  }

  const palets: PaletRow[] = [];

  for (const row of rows) {
    // ── Kg Netos — campo obligatorio ──
    const kgRaw = col(row,
      "Kg netos", "kg_netos", "Kg Netos",
      "Neto", "neto", "Netos", "netos",
      "Kg Neto", "kg_neto",
      "Peso Neto", "peso_neto",
      "Peso", "peso",
      "Kg", "kg", "Kilos", "kilos",
      "Peso kg", "peso_kg"
    );
    const kg = num(kgRaw);
    // Incluir filas con ID aunque kg=0 (palets ficticios)
    const hasPaletId = col(row,
      "Palet", "palet", "ID Palet", "id_palet",
      "Palet ID", "palet_id",
      "Número Palet", "numero_palet", "N Palet", "n_palet"
    );
    if (kg <= 0 && !hasPaletId) continue;

    // ── Producto ──
    const producto = str(col(row,
      "Producto", "producto",
      "Descripción", "descripcion",
      "Artículo", "articulo",
      "Descripción Producto", "descripcion_producto",
      "Nombre Producto", "nombre_producto"
    ));

    // ── Fecha ──
    const fecha = str(col(row,
      "Fecha", "fecha",
      "Fecha Alta", "fecha_alta",
      "Fecha Palet", "fecha_palet",
      "Fecha Creación", "fecha_creacion",
      "Date", "date",
      "Fecha Empaque", "fecha_empaque"
    ));

    // ── Cliente ──
    const cliente = str(col(row,
      "Cliente", "cliente",
      "Nombre Cliente", "nombre_cliente",
      "Razón Social", "razon_social",
      "Destinatario", "destinatario",
      "Customer", "customer",
      "Productor", "productor"
    ));

    // ── Situación (S/F) — para stock ──
    const sitRaw = str(col(row,
      "Sit", "sit",
      "Situación", "situacion",
      "Estado Palet", "estado_palet",
      "Estado", "estado"
    ));
    let situacion: "S" | "F" | null = null;
    if (sitRaw) {
      if (sitRaw.toUpperCase() === "S") situacion = "S";
      else if (sitRaw.toUpperCase() === "F") situacion = "F";
    }

    // ── ID Palet ──
    const paletId = str(col(row,
      "Palet", "palet",
      "ID Palet", "id_palet",
      "Palet ID", "palet_id",
      "Num Palet", "num_palet",
      "Nº Palet", "n_palet",
      "Código Palet", "codigo_palet"
    ));

    // ── Destino ──
    const destino = str(col(row,
      "Destino", "destino",
      "Grupo", "grupo",
      "Mercado", "mercado",
      "Tipo Destino", "tipo_destino"
    ));

    // ── Cajas ──
    const cajasRaw = col(row,
      "Cajas", "cajas",
      "N Cajas", "n_cajas",
      "Número Cajas", "numero_cajas",
      "Bultos", "bultos"
    );

    palets.push({
      producto,
      fecha,
      cliente,
      kg_neto: kg,
      // Legacy
      palet_id:   paletId,
      destino:    destino,
      situacion,
      n_cajas:    cajasRaw !== undefined ? num(cajasRaw) || null : null,
    });
  }

  const kg_camara    = palets.filter(p => p.situacion === "S").reduce((s, p) => s + p.kg_neto, 0);
  const kg_facturado = palets.filter(p => p.situacion === "F").reduce((s, p) => s + p.kg_neto, 0);
  const kg_ficticio  = palets.filter(p => p.situacion === null).reduce((s, p) => s + p.kg_neto, 0);

  return {
    tipo: "palets",
    palets,
    kg_camara,
    kg_facturado,
    kg_ficticio,
    kg_total_bruto: kg_camara + kg_facturado,
    _columnas_detectadas: rows.length > 0
      ? Object.keys(rows[0]).filter(k => !k.startsWith("_raw"))
      : [],
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// PARSER C: Informe de Producto Empacado
// Campos: Producto, Empaque, Empaques, Peso(kg), Fruta
// ─────────────────────────────────────────────────────────────────────────────

export function parseInformeProducto(wb: XLSX.WorkBook): ParsedProducto {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(sheet);

  if (rows.length > 0) {
    debug("PRODUCTO_COLUMNAS", Object.keys(rows[0]).filter(k => !k.startsWith("_raw")));
    debug("PRODUCTO_PRIMERA_FILA", rows[0]);
  }

  const lineas: ProductoEmpacado[] = [];

  for (const row of rows) {
    // ── Peso (kg) — campo obligatorio ──
    const kgRaw = col(row,
      "Peso (kg)", "Peso(kg)", "peso_kg", "Peso kg",
      "kg", "kg_total", "total_kg",
      "kilos", "Kilos",
      "Peso", "peso"
    );
    const kg = num(kgRaw);
    if (kg <= 0) continue;

    // ── Producto ──
    const producto = str(col(row,
      "Producto", "producto",
      "Descripción", "descripcion",
      "Artículo", "articulo",
      "Nombre Producto", "nombre_producto",
      "Referencia", "referencia"
    ));

    // ── Empaque ──
    const empaque = str(col(row,
      "Empaque", "empaque",
      "Tipo Empaque", "tipo_empaque",
      "Formato", "formato",
      "Formato Caja", "formato_caja",
      "Tipo Caja", "tipo_caja",
      "Envase", "envase",
      "Packaging", "packaging"
    ));

    // ── Empaques (cantidad) ──
    const empaquesRaw = col(row,
      "Empaques", "empaques",
      "Nº Empaques", "n_empaques",
      "Cantidad Empaques", "cantidad_empaques",
      "Cajas", "cajas",
      "Bultos", "bultos",
      "Unidades", "unidades",
      "Units", "units"
    );

    // ── Fruta ──
    const fruta = str(col(row,
      "Fruta", "fruta",
      "Tipo Fruta", "tipo_fruta",
      "Especie", "especie",
      "Variedad Fruta", "variedad_fruta",
      "Variedad", "variedad",
      "Calibre", "calibre"
    ));

    // ── Grupo / Destino (para clasificación) ──
    const grupoRaw = str(col(row,
      "Grupo", "grupo",
      "Destino", "destino",
      "Mercado", "mercado",
      "Grupo Destino", "grupo_destino",
      "Clasificación", "clasificacion",
      "Tipo", "tipo"
    ));

    // ── Línea ──
    const linea = str(col(row,
      "Línea", "linea",
      "Línea Envasado", "linea_envasado",
      "Máquina", "maquina",
      "Line", "line"
    ));

    lineas.push({
      producto,
      empaque,
      empaques:    empaquesRaw !== undefined ? num(empaquesRaw) || null : null,
      kg,
      fruta,
      // Legacy
      linea,
      formato_caja: empaque,
      cajas:        empaquesRaw !== undefined ? num(empaquesRaw) || null : null,
      grupo_destino: grupoRaw,
    });
  }

  const clasificar = (g: string | null) => normGrupo(g);
  const kg_exportacion = lineas.filter(l => clasificar(l.grupo_destino) === "exportacion").reduce((s, l) => s + l.kg, 0);
  const kg_mercado     = lineas.filter(l => clasificar(l.grupo_destino) === "mercado").reduce((s, l) => s + l.kg, 0);
  const kg_industria   = lineas.filter(l => clasificar(l.grupo_destino) === "industria").reduce((s, l) => s + l.kg, 0);
  const kg_total       = lineas.reduce((s, l) => s + l.kg, 0);

  return {
    tipo: "producto",
    lineas,
    kg_exportacion,
    kg_mercado,
    kg_industria,
    kg_total,
    _columnas_detectadas: rows.length > 0
      ? Object.keys(rows[0]).filter(k => !k.startsWith("_raw"))
      : [],
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// PARSER D: Informe de Tamaños / Calibres / Clase y Calidad
// Campos: Variedad, Clase, Grupo, Peso(kg), Tamaños
// + Agrupación por Tipo: Exportación / Mujeres / No exportación / No comercial
// ─────────────────────────────────────────────────────────────────────────────

/** Detecta el tipo de clasificación a partir del valor del grupo/tipo */
function detectarTipoClasificacion(valor: string | null): string {
  if (!valor) return "Otro";
  const v = valor.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (v.includes("exportac") || v.includes("export") || v.includes("ext")) return "Exportación";
  if (v.includes("mujer")) return "Mujeres";
  if (v.includes("no_exportac") || v.includes("no exportac") || v.includes("no export")) return "No exportación";
  if (v.includes("no_comerc") || v.includes("no comerc") || v.includes("industria") || v.includes("ind")) return "No comercial";
  if (v.includes("mercado") || v.includes("nac") || v.includes("interior") || v.includes("int")) return "Mercado";
  return valor; // conservar el valor original si no se reconoce
}

export function parseInformeCalibres(wb: XLSX.WorkBook): ParsedCalibres {
  // Puede tener varias hojas — intentamos parsear todas y unir
  const todasLasFilas: Record<string, any>[] = [];
  const columnasDetectadas: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = sheetToRows(sheet);
    if (rows.length > 0) {
      debug(`CALIBRES_HOJA_${sheetName}`, Object.keys(rows[0]).filter(k => !k.startsWith("_raw")));
      if (columnasDetectadas.length === 0) {
        columnasDetectadas.push(...Object.keys(rows[0]).filter(k => !k.startsWith("_raw")));
      }
      todasLasFilas.push(...rows);
    }
  }

  if (todasLasFilas.length > 0) {
    debug("CALIBRES_PRIMERA_FILA", todasLasFilas[0]);
  }

  const calibres: CalibreRow[] = [];

  for (const row of todasLasFilas) {
    // ── Variedad — campo clave ──
    const variedadRaw = str(col(row,
      "Variedad", "variedad",
      "Especie", "especie",
      "Tipo Fruta", "tipo_fruta",
      "Producto", "producto",
      "Descripción", "descripcion"
    ));

    // ── Clase ──
    const claseRaw = str(col(row,
      "Clase", "clase",
      "Calidad", "calidad",
      "Categoría", "categoria",
      "Category", "category",
      "Extra", "extra",
      "Tipo Clase", "tipo_clase"
    ));

    // ── Grupo (Exportación, Mujeres, etc.) ──
    const grupoRaw = str(col(row,
      "Grupo", "grupo",
      "Destino", "destino",
      "Tipo", "tipo",
      "Clasificación", "clasificacion",
      "Mercado", "mercado",
      "Grupo Destino", "grupo_destino",
      "Denominación", "denominacion"
    ));

    // ── Peso (kg) ──
    const kgRaw = col(row,
      "Peso (kg)", "Peso(kg)", "peso_kg", "Peso kg",
      "kg", "kilos", "Kilos",
      "Peso", "peso",
      "Total kg", "total_kg"
    );
    const kg = num(kgRaw);

    // ── Tamaños — puede ser un campo con lista de calibres ──
    const tamanosRaw = str(col(row,
      "Tamaños", "tamanos",
      "Tamaño", "tamano",
      "Calibre", "calibre",
      "Calibres", "calibres",
      "Talla", "talla",
      "Tallas", "tallas",
      "Sizes", "sizes",
      "Size", "size"
    ));

    // ── Piezas ──
    const piezasRaw = col(row,
      "Piezas", "piezas",
      "Cantidad", "cantidad",
      "Unidades", "unidades",
      "Units", "units"
    );

    // ── % ──
    const pctRaw = col(row,
      "%", "pct", "porcentaje",
      "Porcentaje", "Pct Total", "pct_total",
      "Percent", "percent"
    );

    // Solo incluir filas que tengan al menos variedad o calibre o kg
    const tieneDatos = variedadRaw || tamanosRaw || kg > 0;
    if (!tieneDatos) continue;

    // El "calibre" legacy es la variedad o el tamaño, lo que esté disponible
    const calibreLegacy = tamanosRaw ?? variedadRaw ?? "—";

    calibres.push({
      variedad:      variedadRaw,
      clase:         claseRaw,
      grupo:         grupoRaw,
      kg,
      tamanos:       tamanosRaw,
      // Legacy
      calibre:       calibreLegacy,
      piezas:        piezasRaw !== undefined ? num(piezasRaw) : 0,
      pct:           pctRaw !== undefined ? num(pctRaw) : 0,
      grupo_destino: grupoRaw,
    });
  }

  // ── Agrupar por Tipo de clasificación ──
  const tiposMap: Record<string, { kg: number; tamanos: Set<string> }> = {};
  const TIPOS_ORDEN = ["Exportación", "Mujeres", "No exportación", "No comercial", "Mercado", "Otro"];

  for (const c of calibres) {
    const tipo = detectarTipoClasificacion(c.grupo);
    if (!tiposMap[tipo]) tiposMap[tipo] = { kg: 0, tamanos: new Set() };
    tiposMap[tipo].kg += c.kg;
    if (c.tamanos) tiposMap[tipo].tamanos.add(c.tamanos);
    if (c.variedad) tiposMap[tipo].tamanos.add(c.variedad);
  }

  const tipos_clasificacion: TipoClasificacion[] = Object.entries(tiposMap)
    .map(([tipo, v]) => ({
      tipo,
      kg: v.kg,
      tamanos: Array.from(v.tamanos).filter(Boolean),
    }))
    .sort((a, b) => {
      const ia = TIPOS_ORDEN.indexOf(a.tipo);
      const ib = TIPOS_ORDEN.indexOf(b.tipo);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  // Totales por destino
  const kg_exportacion = calibres
    .filter(c => normGrupo(c.grupo) === "exportacion")
    .reduce((s, c) => s + c.kg, 0);
  const kg_mercado = calibres
    .filter(c => normGrupo(c.grupo) === "mercado")
    .reduce((s, c) => s + c.kg, 0);
  const kg_industria = calibres
    .filter(c => normGrupo(c.grupo) === "industria")
    .reduce((s, c) => s + c.kg, 0);
  const kg_total = calibres.reduce((s, c) => s + c.kg, 0);

  return {
    tipo: "calibres",
    calibres,
    tipos_clasificacion,
    kg_exportacion,
    kg_mercado,
    kg_industria,
    kg_total,
    _columnas_detectadas: columnasDetectadas,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT — detecta y parsea automáticamente
// ─────────────────────────────────────────────────────────────────────────────

export async function parseInforme(file: File): Promise<ParsedInforme | null> {
  try {
    const wb = await parseWorkbook(file);
    const tipo = detectarTipoInforme(file.name, wb);

    debug("TIPO_DETECTADO", { file: file.name, tipo });

    switch (tipo) {
      case "produccion": return parseInformeProduccion(wb);
      case "palets":     return parsePalets(wb);
      case "producto":   return parseInformeProducto(wb);
      case "calibres":   return parseInformeCalibres(wb);
      default:
        console.warn(`[PARSER] No se reconoció el tipo para: ${file.name}`);
        return null;
    }
  } catch (err) {
    console.error("[PARSER] Error procesando", file.name, err);
    return null;
  }
}
