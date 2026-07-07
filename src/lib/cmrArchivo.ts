// src/lib/cmrArchivo.ts
// Utilidades puras (sin dependencias de Supabase/React) para la pestaña
// "Archivo" de CMR y Hojas de ruta: interpretar los nombres de fichero del
// histórico digitalizado en el bucket "logistics-templates" y filtrar/buscar
// sobre la página ya cargada en cliente.
//
// Patrón de nombres observado en el bucket:
//   cmr/  "<12 hex>-PACO-CMR-10305-COFRULY-LYON-ANTONIO-CANO.pdf"
//         "<hex>-PACO-CMR-7495-DELTA-BLAU-SOCAFNA.pdf"
//         "<hex>-2020-2021-KOLLAGMBH-PASCAL-LOGISTIC.pdf" (sin "CMR-<numero>")
//   route/ "<12 hex>-URIA-BILBAO-GENARO.xls"
//          "<hex>-FRUTAS-DIEGO-MARTINEZ-TRILLO.xls"
//          "<hex>-DHL-TRAIL-FRUITS.xls"
//
// parseArchivoNombre es best-effort y NUNCA lanza: ante un nombre inesperado
// simplemente degrada la etiqueta al nombre completo sin extensión.

export interface ArchivoNombreParseado {
  /** Número de CMR si el nombre trae el patrón "CMR-<dígitos>"; null si no aplica o no aparece. */
  numero: string | null;
  /** Etiqueta legible: el nombre sin el hash hex inicial ni la extensión, con guiones -> espacios. */
  etiqueta: string;
  /** Extensión en minúsculas, sin el punto (p.ej. "pdf", "xls"). Cadena vacía si no tiene. */
  extension: string;
}

// Hash inicial: 8-40 caracteres hexadecimales seguidos de un guion. Se acepta
// un rango amplio porque el enunciado dice "12 hex" pero conviene ser
// tolerante ante variaciones reales del histórico.
const HASH_PREFIX_RE = /^[0-9a-fA-F]{8,40}-/;
const CMR_NUMERO_RE = /\bCMR-(\d+)\b/i;

/**
 * Extrae de un nombre de fichero del bucket la información legible para
 * mostrar en la lista de Archivo. `prefijo` se acepta por simetría con el
 * resto de la API (listarArchivo/urlDescarga) aunque hoy no cambia el
 * parseo: se documenta por si en el futuro "route/" necesita reglas propias.
 */
export function parseArchivoNombre(name: string, _prefijo?: "cmr" | "route"): ArchivoNombreParseado {
  try {
    const raw = String(name ?? "").trim();
    if (!raw) return { numero: null, etiqueta: "", extension: "" };

    const extMatch = /\.([a-zA-Z0-9]+)$/.exec(raw);
    const extension = extMatch ? extMatch[1].toLowerCase() : "";
    const sinExtension = extMatch ? raw.slice(0, raw.length - extMatch[0].length) : raw;

    const sinHash = HASH_PREFIX_RE.test(sinExtension)
      ? sinExtension.slice(sinExtension.indexOf("-") + 1)
      : sinExtension;

    const numeroMatch = CMR_NUMERO_RE.exec(sinHash);
    const numero = numeroMatch ? numeroMatch[1] : null;

    const etiqueta = (sinHash || sinExtension || raw)
      .split(/[-_]+/)
      .filter(Boolean)
      .join(" ")
      .trim();

    return { numero, etiqueta: etiqueta || raw, extension };
  } catch {
    return { numero: null, etiqueta: String(name ?? ""), extension: "" };
  }
}

export interface ArchivoListado {
  name: string;
  id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  metadata?: { size?: number } | null;
}

/**
 * Filtro de texto libre client-side sobre la página de resultados ya
 * cargada: compara contra la etiqueta legible, el número de CMR y el nombre
 * crudo del fichero (por si el usuario pega el nombre completo).
 */
export function filtrarArchivos<T extends ArchivoListado>(archivos: T[], search: string): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return archivos;
  return archivos.filter((archivo) => {
    const { numero, etiqueta } = parseArchivoNombre(archivo.name);
    return (
      etiqueta.toLowerCase().includes(q) ||
      (numero ?? "").toLowerCase().includes(q) ||
      archivo.name.toLowerCase().includes(q)
    );
  });
}

/** Sanea un nombre de archivo para usarlo en un path de storage (sin espacios ni acentos). */
export function sanearNombreArchivo(name: string): string {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Id corto (sin guiones) para prefijar paths de storage, análogo a crypto.randomUUID(). */
export function idCortoStorage(): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return uuid.replace(/-/g, "").slice(0, 12);
}
