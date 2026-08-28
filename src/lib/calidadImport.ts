// Control de calidad de fruta de IMPORTACIÓN (contenedores/camiones de fuera,
// p.ej. la naranja de Sudáfrica vía Uria Export). Tipos, constantes y derivados
// del control que rellena calidad desde el móvil; el informe Word que sale de
// aquí replica el "REPORTE DE CALIDAD FRUTA IMPORTACIÓN" que se hacía a mano.
//
// Criterio de datos: los campos de valor son texto libre (la evaluadora escribe
// "80 CAJAS" o "(11-200)") y lo DERIVABLE no se guarda: % de zumo e índice de
// madurez se calculan aquí a partir de lo medido.
import type { Json } from "@/integrations/supabase/types";

export type CalidadImportEstado = "borrador" | "completado";

/** Un defecto con su porcentaje, tal como va al informe ("RAMEADO" / "4"). */
export interface DefectoImport {
  tipo: string;
  pct: string;
}

/** Una muestra de calidad interna: lo MEDIDO. % zumo e IM se derivan. */
export interface MuestraInterna {
  peso_fruta: string;
  peso_zumo: string;
  brix: string;
  acidez: string;
}

export interface CalidadImportControl {
  id: string;
  user_id: string;
  fecha: string;
  estado: CalidadImportEstado;
  // 1. Información del producto
  referencia: string;
  nuestra_ref: string;
  proveedor: string;
  barco: string;
  marca: string;
  num_contenedor: string;
  kg_total: string;
  puc_orchard: string;
  ggn: string;
  tipo_producto: string;
  tipo_confeccion: string;
  origen: string;
  calibre: string;
  // 2. Información general
  etiquetado: string;
  tratamientos: string;
  clasificacion: string;
  temperatura: string;
  paletizacion: string;
  peso_medio_cajas: string;
  sticker: string;
  papel: string;
  // 3. Defectos no evolutivos
  muestreo_no_evolutivos: string;
  defectos_leves: DefectoImport[];
  defectos_graves: DefectoImport[];
  obs_no_evolutivos: string;
  // 4. Defectos evolutivos
  muestreo_evolutivos: string;
  defectos_evolutivos: DefectoImport[];
  obs_evolutivos: string;
  // 5. Calidad interna
  muestras_internas: MuestraInterna[];
  // 7. Realiza
  evaluador: string;
  firma_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalidadImportFoto {
  id: string;
  control_id: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  orden: number;
  created_at?: string;
  signedUrl?: string;
}

// ─── Referencias de calidad interna (las que imprime el informe) ─────────────
export const REF_PCT_ZUMO = ">40/42%";
export const REF_BRIX = "10/16";
export const REF_ACIDEZ = "0.7/1.1";
export const REF_INDICE_MADUREZ = "10/18";

// Sugerencias de defectos habituales: chips de un toque en el móvil. La lista
// es abierta (siempre se puede teclear otro).
export const DEFECTOS_NO_EVOLUTIVOS_SUGERIDOS = [
  "RAMEADO",
  "CICATRIZ",
  "TRIP",
  "DEFORMACIÓN",
  "SALTAMONTES",
  "GOLPE",
  "MANCHA",
  "ROZADURA",
  "OLEOCELOSIS",
  "COCHINILLA",
] as const;

export const DEFECTOS_EVOLUTIVOS_SUGERIDOS = [
  "PODRIDO",
  "PINCHAZO",
  "RAJADO",
  "MOHO",
  "BLANDO",
  "DESHIDRATADO",
] as const;

export const CLASIFICACIONES_SUGERIDAS = ["CAT 1", "CAT 2"] as const;

// ─── Conversión fila BD ↔ modelo ─────────────────────────────────────────────

function jsonADefectos(value: Json): DefectoImport[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const registro = item as Record<string, Json | undefined>;
    return [{ tipo: String(registro.tipo ?? ""), pct: String(registro.pct ?? "") }];
  });
}

function jsonAMuestras(value: Json): MuestraInterna[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const registro = item as Record<string, Json | undefined>;
    return [{
      peso_fruta: String(registro.peso_fruta ?? ""),
      peso_zumo: String(registro.peso_zumo ?? ""),
      brix: String(registro.brix ?? ""),
      acidez: String(registro.acidez ?? ""),
    }];
  });
}

/** Fila cruda de calidad_import_controles → modelo tipado (JSONB validado). */
export function rowToControl(row: {
  [K in keyof CalidadImportControl]: K extends "defectos_leves" | "defectos_graves" | "defectos_evolutivos" | "muestras_internas"
    ? Json
    : K extends "estado" ? string
    : CalidadImportControl[K];
}): CalidadImportControl {
  return {
    ...row,
    estado: row.estado === "completado" ? "completado" : "borrador",
    defectos_leves: jsonADefectos(row.defectos_leves),
    defectos_graves: jsonADefectos(row.defectos_graves),
    defectos_evolutivos: jsonADefectos(row.defectos_evolutivos),
    muestras_internas: jsonAMuestras(row.muestras_internas),
  };
}

// ─── Derivados de calidad interna ────────────────────────────────────────────

/** Número de un texto tolerante ("12,2", " 12.2 ", "948") o null si no lo es. */
export function parseNumeroFlexible(value: string): number | null {
  const limpio = value.trim().replace(",", ".");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// El informe usa punto decimal ("12.6"), igual que los Word de la evaluadora.
function redondear1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** % de zumo de una muestra (peso_zumo / peso_fruta), a 1 decimal, o "". */
export function pctZumo(muestra: Pick<MuestraInterna, "peso_fruta" | "peso_zumo">): string {
  const fruta = parseNumeroFlexible(muestra.peso_fruta);
  const zumo = parseNumeroFlexible(muestra.peso_zumo);
  if (fruta === null || zumo === null || fruta <= 0) return "";
  return redondear1((zumo / fruta) * 100);
}

/** Índice de madurez (brix / acidez), a 1 decimal, o "". */
export function indiceMadurez(muestra: Pick<MuestraInterna, "brix" | "acidez">): string {
  const brix = parseNumeroFlexible(muestra.brix);
  const acidez = parseNumeroFlexible(muestra.acidez);
  if (brix === null || acidez === null || acidez <= 0) return "";
  return redondear1(brix / acidez);
}

// ─── Textos combinados para el informe ───────────────────────────────────────
// Con varias muestras el informe imprime los valores unidos por "/", igual que
// hacía la evaluadora a mano ("948/1264", "42/40.3").

export function unirValores(valores: string[]): string {
  const conContenido = valores.map((v) => v.trim()).filter((v) => v !== "");
  return conContenido.join("/");
}

export function tiposDefectosTexto(defectos: DefectoImport[]): string {
  return defectos.map((d) => d.tipo.trim()).filter((t) => t !== "").join(" / ");
}

export function pctsDefectosTexto(defectos: DefectoImport[]): string {
  return defectos
    .filter((d) => d.tipo.trim() !== "")
    .map((d) => d.pct.trim() || "-")
    .join(" / ");
}

// ─── Nombre de archivo del informe ───────────────────────────────────────────
// Mismo patrón que los Word que ya circulaban:
// "CONTROL CALIDAD 1184057-26082701 CAT 1.docx"
export function nombreInformeCalidadImport(control: Pick<CalidadImportControl, "referencia" | "nuestra_ref" | "clasificacion">): string {
  const referencia = [control.referencia.trim(), control.nuestra_ref.trim()]
    .filter((parte) => parte !== "")
    .join("-");
  const partes = ["CONTROL CALIDAD", referencia, control.clasificacion.trim()]
    .filter((parte) => parte !== "")
    .join(" ");
  // Sin caracteres prohibidos en nombres de archivo (la "/" de un calibre p.ej.).
  return `${partes.replace(/[\\/:*?"<>|]+/g, "-")}.docx`;
}

// ─── Progreso del control (para la lista y la cabecera del editor) ───────────

export interface SeccionEstado {
  numero: number;
  titulo: string;
  completa: boolean;
}

export function estadoSecciones(control: CalidadImportControl, numFotos: number): SeccionEstado[] {
  const hayTexto = (...campos: string[]) => campos.some((c) => c.trim() !== "");
  return [
    { numero: 1, titulo: "Información del producto", completa: hayTexto(control.referencia, control.nuestra_ref, control.proveedor, control.tipo_producto, control.origen, control.calibre) },
    { numero: 2, titulo: "Información general", completa: hayTexto(control.etiquetado, control.clasificacion, control.temperatura, control.paletizacion, control.peso_medio_cajas) },
    { numero: 3, titulo: "Defectos no evolutivos", completa: hayTexto(control.muestreo_no_evolutivos, control.obs_no_evolutivos) || control.defectos_leves.length > 0 || control.defectos_graves.length > 0 },
    { numero: 4, titulo: "Defectos evolutivos", completa: hayTexto(control.muestreo_evolutivos, control.obs_evolutivos) || control.defectos_evolutivos.length > 0 },
    { numero: 5, titulo: "Calidad interna", completa: control.muestras_internas.some((m) => hayTexto(m.peso_fruta, m.peso_zumo, m.brix, m.acidez)) },
    { numero: 6, titulo: "Registro fotográfico", completa: numFotos > 0 },
    { numero: 7, titulo: "Realiza", completa: hayTexto(control.evaluador) },
  ];
}
