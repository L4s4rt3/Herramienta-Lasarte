/**
 * parsers.ts — Parser de informes Excel del calibrador Spectrim.
 *
 * Tres informes soportados:
 *  1. Informe_produccion.xlsx  → lotes con productor, kg, T/h, duración, peso fruta
 *  2. palets_*.xlsx            → palets con Sit (S=cámara, F=facturado), cliente, destino
 *  3. Informe_producto.xlsx    → producto empacado por línea (kg, cajas, formato)
 *  4. Informe_tamaños*.xlsx    → calibres (piezas, kg, %) con clase y grupo destino
 */
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de resultado
// ─────────────────────────────────────────────────────────────────────────────

export interface LoteProduccion {
  lote_codigo: string | null;
  productor: string | null;
  producto: string | null;
  kg_peso_total: number;
  toneladas_hora: number | null;
  duracion_min: number | null;
  peso_fruta_promedio_g: number | null;
  hora_inicio: string | null;
}

export interface PaletRow {
  palet_id: string | null;
  producto: string | null;
  cliente: string | null;
  destino: string | null;
  kg_neto: number;
  /** S = en cámara, F = facturado, null = ficticio/industria */
  situacion: "S" | "F" | null;
  n_cajas: number | null;
}

export interface ProductoEmpacado {
  linea: string | null;
  producto: string | null;
  formato_caja: string | null;
  kg: number;
  cajas: number | null;
  grupo_destino: string | null;
}

export interface CalibreRow {
  calibre: string;
  piezas: number;
  kg: number;
  pct: number;
  clase: string | null;
  grupo_destino: string | null;
}

export interface ParsedProduccion {
  tipo: "produccion";
  lotes: LoteProduccion[];
  /** Suma total de kg de todos los lotes */
  kg_total: number;
  /** T/h promedio ponderado por duración */
  tph_promedio: number | null;
}

export interface ParsedPalets {
  tipo: "palets";
  palets: PaletRow[];
  /** Suma Netos donde Sit = "S" (en cámara) */
  kg_camara: number;
  /** Suma Netos donde Sit = "F" (facturado) */
  kg_facturado: number;
  /** Suma Netos donde Sit = null (ficticio: reciclado, industria) */
  kg_ficticio: number;
  /** Total bruto (camara + facturado) */
  kg_total_bruto: number;
}

export interface ParsedProducto {
  tipo: "producto";
  lineas: ProductoEmpacado[];
  kg_exportacion: number;
  kg_mercado: number;
  kg_industria: number;
  kg_total: number;
}

export interface ParsedCalibres {
  tipo: "calibres";
  calibres: CalibreRow[];
  kg_exportacion: number;
  kg_mercado: number;
  kg_industria: number;
  kg_total: number;
}

export type ParsedInforme =
  | ParsedProduccion
  | ParsedPalets
  | ParsedProducto
  | ParsedCalibres;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseWorkbook(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        resolve(wb);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/** Convierte una hoja a array de objetos con claves normalizadas (lowercase, sin tildes) */
function sheetToRows(sheet: XLSX.WorkSheet): Record<string, any>[] {
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: null,
    raw: false,
  });
  return raw.map((row) => {
    const normalized: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      const key = k
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_")
        .trim();
      normalized[key] = v;
    }
    return normalized;
  });
}

function num(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const parsed = parseFloat(String(v).replace(",", "."));
  return isNaN(parsed) ? 0 : parsed;
}

function str(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Detecta si una cadena contiene alguna de las palabras clave (case-insensitive) */
function contains(v: any, ...keywords: string[]): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).toLowerCase();
  return keywords.some((k) => s.includes(k.toLowerCase()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detectar tipo de informe por nombre de archivo y contenido
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
  const name = fileName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (name.includes("produccion") || name.includes("produccion")) return "produccion";
  if (name.includes("palet")) return "palets";
  if (name.includes("producto") && !name.includes("tamano") && !name.includes("calibre"))
    return "producto";
  if (name.includes("tamano") || name.includes("calibre") || name.includes("clase"))
    return "calibres";

  // Fallback: mirar columnas de la primera hoja
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(firstSheet);
  if (rows.length === 0) return "desconocido";
  const keys = Object.keys(rows[0]).join(" ");
  if (keys.includes("toneladas") || keys.includes("t/h") || keys.includes("productor"))
    return "produccion";
  if (keys.includes("sit") || keys.includes("neto")) return "palets";
  if (keys.includes("calibre") || keys.includes("tamano")) return "calibres";
  if (keys.includes("linea") || keys.includes("formato")) return "producto";

  return "desconocido";
}

// ─────────────────────────────────────────────────────────────────────────────
// M1.A — Parser Informe_produccion.xlsx
// ─────────────────────────────────────────────────────────────────────────────
// Columnas esperadas (nombre aproximado, se normaliza):
//   Lote, Productor, Producto, Peso(kg) / Peso total, T/h / Toneladas hora,
//   Hora maquina / Hora inicio, Duracion / Tiempo, Peso fruta / Peso pieza

export function parseInformeProduccion(
  wb: XLSX.WorkBook
): ParsedProduccion {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(sheet);

  const lotes: LoteProduccion[] = [];

  for (const row of rows) {
    // Buscar columna de kg — acepta varias variantes de nombre
    const kgRaw =
      row["peso_total"] ??
      row["peso(kg)"] ??
      row["peso_kg"] ??
      row["kg"] ??
      row["total_peso"] ??
      row["peso"];
    const kg = num(kgRaw);
    if (kg <= 0) continue; // fila vacía o sin producción

    const tph =
      row["toneladas_hora"] ??
      row["t/h"] ??
      row["th"] ??
      row["t_h"] ??
      row["velocidad"] ??
      null;

    const duracion =
      row["duracion"] ??
      row["tiempo"] ??
      row["duracion_min"] ??
      row["minutos"] ??
      null;

    const pesoPieza =
      row["peso_fruta"] ??
      row["peso_pieza"] ??
      row["peso_medio"] ??
      row["peso_promedio"] ??
      row["gramos"] ??
      null;

    const horaInicio =
      row["hora_inicio"] ??
      row["hora_maquina"] ??
      row["hora"] ??
      null;

    const productor =
      str(row["productor"]) ??
      str(row["agricultor"]) ??
      str(row["proveedor"]) ??
      null;

    const lote =
      str(row["lote"]) ??
      str(row["cod_lote"]) ??
      str(row["codigo_lote"]) ??
      null;

    const producto =
      str(row["producto"]) ??
      str(row["variedad"]) ??
      str(row["tipo"]) ??
      null;

    lotes.push({
      lote_codigo: lote,
      productor,
      producto,
      kg_peso_total: kg,
      toneladas_hora: tph !== null ? num(tph) : null,
      duracion_min: duracion !== null ? num(duracion) : null,
      peso_fruta_promedio_g: pesoPieza !== null ? num(pesoPieza) : null,
      hora_inicio: horaInicio !== null ? str(horaInicio) : null,
    });
  }

  const kg_total = lotes.reduce((s, l) => s + l.kg_peso_total, 0);

  // T/h promedio ponderado por duración (o simple si no hay duración)
  let tph_promedio: number | null = null;
  const lotesConTph = lotes.filter((l) => l.toneladas_hora !== null && l.toneladas_hora > 0);
  if (lotesConTph.length > 0) {
    const totalTiempo = lotesConTph.reduce((s, l) => s + (l.duracion_min ?? 1), 0);
    tph_promedio =
      totalTiempo > 0
        ? lotesConTph.reduce(
            (s, l) => s + (l.toneladas_hora ?? 0) * (l.duracion_min ?? 1),
            0
          ) / totalTiempo
        : lotesConTph.reduce((s, l) => s + (l.toneladas_hora ?? 0), 0) /
          lotesConTph.length;
  }

  return { tipo: "produccion", lotes, kg_total, tph_promedio };
}

// ─────────────────────────────────────────────────────────────────────────────
// M1.B — Parser palets_*.xlsx
// ─────────────────────────────────────────────────────────────────────────────
// Columnas esperadas:
//   Palet/ID palet, Producto, Cliente, Destino, Neto/Kg neto, Sit (S/F/null)
//   Cajas / N cajas

export function parsePalets(wb: XLSX.WorkBook): ParsedPalets {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(sheet);

  const palets: PaletRow[] = [];

  for (const row of rows) {
    const kgRaw =
      row["neto"] ??
      row["kg_neto"] ??
      row["kg_netos"] ??
      row["netos"] ??
      row["peso_neto"] ??
      row["kg"];
    const kg = num(kgRaw);
    // Incluir incluso palets con kg=0 si tienen ID (pueden ser ficticios)
    if (kg <= 0 && !row["palet"] && !row["id_palet"]) continue;

    const sitRaw = str(
      row["sit"] ??
        row["situacion"] ??
        row["estado_palet"] ??
        row["estado"] ??
        null
    );
    let situacion: "S" | "F" | null = null;
    if (sitRaw) {
      if (sitRaw.toUpperCase() === "S") situacion = "S";
      else if (sitRaw.toUpperCase() === "F") situacion = "F";
    }

    palets.push({
      palet_id:
        str(row["palet"] ?? row["id_palet"] ?? row["num_palet"] ?? row["n_palet"]) ??
        null,
      producto:
        str(row["producto"] ?? row["descripcion"] ?? row["articulo"]) ?? null,
      cliente:
        str(row["cliente"] ?? row["razon_social"] ?? row["nombre_cliente"]) ?? null,
      destino:
        str(row["destino"] ?? row["grupo"] ?? row["mercado"]) ?? null,
      kg_neto: kg,
      situacion,
      n_cajas:
        row["cajas"] !== undefined || row["n_cajas"] !== undefined
          ? num(row["cajas"] ?? row["n_cajas"])
          : null,
    });
  }

  const kg_camara = palets
    .filter((p) => p.situacion === "S")
    .reduce((s, p) => s + p.kg_neto, 0);
  const kg_facturado = palets
    .filter((p) => p.situacion === "F")
    .reduce((s, p) => s + p.kg_neto, 0);
  const kg_ficticio = palets
    .filter((p) => p.situacion === null)
    .reduce((s, p) => s + p.kg_neto, 0);

  return {
    tipo: "palets",
    palets,
    kg_camara,
    kg_facturado,
    kg_ficticio,
    kg_total_bruto: kg_camara + kg_facturado,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// M1.C — Parser Informe_producto.xlsx
// ─────────────────────────────────────────────────────────────────────────────

const GRUPOS_EXPORTACION = ["exportacion", "export", "ext"];
const GRUPOS_MERCADO = ["mercado", "nacional", "int", "interior"];
const GRUPOS_INDUSTRIA = ["industria", "ind"];

function clasificarGrupo(
  grupo: string | null
): "exportacion" | "mercado" | "industria" | "otro" {
  if (!grupo) return "otro";
  const g = grupo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (GRUPOS_EXPORTACION.some((k) => g.includes(k))) return "exportacion";
  if (GRUPOS_MERCADO.some((k) => g.includes(k))) return "mercado";
  if (GRUPOS_INDUSTRIA.some((k) => g.includes(k))) return "industria";
  return "otro";
}

export function parseInformeProducto(wb: XLSX.WorkBook): ParsedProducto {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(sheet);

  const lineas: ProductoEmpacado[] = [];

  for (const row of rows) {
    const kgRaw =
      row["kg"] ??
      row["kilos"] ??
      row["peso"] ??
      row["total_kg"] ??
      row["kg_total"];
    const kg = num(kgRaw);
    if (kg <= 0) continue;

    const grupoRaw =
      str(row["grupo"] ?? row["destino"] ?? row["mercado"] ?? row["grupo_destino"]) ??
      null;

    lineas.push({
      linea: str(row["linea"] ?? row["linea_envasado"] ?? row["maquina"]) ?? null,
      producto: str(row["producto"] ?? row["descripcion"] ?? row["articulo"]) ?? null,
      formato_caja:
        str(row["formato"] ?? row["formato_caja"] ?? row["tipo_caja"]) ?? null,
      kg,
      cajas:
        row["cajas"] !== undefined ? num(row["cajas"]) : null,
      grupo_destino: grupoRaw,
    });
  }

  const kg_exportacion = lineas
    .filter((l) => clasificarGrupo(l.grupo_destino) === "exportacion")
    .reduce((s, l) => s + l.kg, 0);
  const kg_mercado = lineas
    .filter((l) => clasificarGrupo(l.grupo_destino) === "mercado")
    .reduce((s, l) => s + l.kg, 0);
  const kg_industria = lineas
    .filter((l) => clasificarGrupo(l.grupo_destino) === "industria")
    .reduce((s, l) => s + l.kg, 0);
  const kg_total = lineas.reduce((s, l) => s + l.kg, 0);

  return {
    tipo: "producto",
    lineas,
    kg_exportacion,
    kg_mercado,
    kg_industria,
    kg_total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// M1.D — Parser Informe_tamaños*.xlsx  (calibres y clase/calidad)
// ─────────────────────────────────────────────────────────────────────────────

export function parseInformeCalibres(wb: XLSX.WorkBook): ParsedCalibres {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(sheet);

  const calibres: CalibreRow[] = [];

  for (const row of rows) {
    const calibreRaw =
      str(row["calibre"] ?? row["tamano"] ?? row["talla"] ?? row["codigo_calibre"]) ??
      null;
    if (!calibreRaw) continue;

    const kgRaw =
      row["kg"] ??
      row["kilos"] ??
      row["peso_kg"] ??
      row["peso"] ??
      row["total_kg"];
    const kg = num(kgRaw);

    const pct = num(
      row["pct"] ??
        row["porcentaje"] ??
        row["%"] ??
        row["pct_total"] ??
        0
    );

    const piezas = num(
      row["piezas"] ??
        row["unidades"] ??
        row["n_piezas"] ??
        0
    );

    const clase =
      str(row["clase"] ?? row["calidad"] ?? row["extra"]) ?? null;
    const grupo =
      str(row["grupo"] ?? row["destino"] ?? row["mercado"] ?? row["grupo_destino"]) ??
      null;

    calibres.push({
      calibre: calibreRaw,
      piezas,
      kg,
      pct,
      clase,
      grupo_destino: grupo,
    });
  }

  const kg_exportacion = calibres
    .filter((c) => clasificarGrupo(c.grupo_destino) === "exportacion")
    .reduce((s, c) => s + c.kg, 0);
  const kg_mercado = calibres
    .filter((c) => clasificarGrupo(c.grupo_destino) === "mercado")
    .reduce((s, c) => s + c.kg, 0);
  const kg_industria = calibres
    .filter((c) => clasificarGrupo(c.grupo_destino) === "industria")
    .reduce((s, c) => s + c.kg, 0);
  const kg_total = calibres.reduce((s, c) => s + c.kg, 0);

  return {
    tipo: "calibres",
    calibres,
    kg_exportacion,
    kg_mercado,
    kg_industria,
    kg_total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point — detecta y parsea automáticamente
// ─────────────────────────────────────────────────────────────────────────────

export async function parseInforme(file: File): Promise<ParsedInforme | null> {
  try {
    const wb = await parseWorkbook(file);
    const tipo = detectarTipoInforme(file.name, wb);

    switch (tipo) {
      case "produccion":
        return parseInformeProduccion(wb);
      case "palets":
        return parsePalets(wb);
      case "producto":
        return parseInformeProducto(wb);
      case "calibres":
        return parseInformeCalibres(wb);
      default:
        return null;
    }
  } catch (err) {
    console.error("parseInforme error:", err);
    return null;
  }
}
