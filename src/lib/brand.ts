// src/lib/brand.ts
// Identidad corporativa única y configurable por entorno (marca blanca).
//
// Todos los textos/rutas de identidad que antes vivían repartidos en
// exportKit.ts (LASARTE_FISCAL), cmrPdf.ts (LASARTE_EMPRESA), reportKit.ts
// (REPORT_BRAND) y exportTheme.ts (EXPORT_FOOTER_TEXT, logo) salen de aquí.
// Cada campo lee su variable VITE_BRAND_* y cae al valor Lasarte si no está
// definida: sin .env de marca, la app es byte a byte la de siempre (y los
// tests que asertan la marca siguen pasando). Con un .env de plantilla
// (ver plantilla/.env.plantilla) la misma base de código se convierte en un
// producto de marca blanca sin tocar ningún otro fichero.

const env = import.meta.env as Record<string, string | undefined>;

const texto = (clave: string, defecto: string): string => {
  const valor = env[clave];
  return valor && valor.trim() !== "" ? valor : defecto;
};

export const BRAND = {
  /** Razón social completa; aparece en pies fiscales, PDFs, metadatos Excel. */
  razonSocial: texto("VITE_BRAND_RAZON_SOCIAL", "Lasarte Cítricos S.L."),
  /** Nombre corto de marca para textos coloquiales ("formato de X", asistente). */
  nombreCorto: texto("VITE_BRAND_NOMBRE_CORTO", "Lasarte"),
  cif: texto("VITE_BRAND_CIF", "B14800304"),
  /** Dirección (vía) y población separadas: el CMR las imprime en líneas distintas. */
  direccion: texto("VITE_BRAND_DIRECCION", "Ctra. Madrid-Cádiz km 461"),
  poblacion: texto("VITE_BRAND_POBLACION", "41400 Écija (Sevilla)"),
  /** Plaza de expedición por defecto en CMR / hoja de ruta. */
  origenExpedicion: texto("VITE_BRAND_ORIGEN_EXPEDICION", "ÉCIJA"),
  telefono: texto("VITE_BRAND_TELEFONO", "{{TELEFONO}}"),
  email: texto("VITE_BRAND_EMAIL", "{{EMAIL}}"),
  web: texto("VITE_BRAND_WEB", "{{WEB}}"),
  /** Nombre de la aplicación (sidebar, document.title). */
  appNombre: texto("VITE_BRAND_APP_NOMBRE", "Herramienta Lasarte"),
  /** Segunda línea bajo el nombre en el sidebar. */
  appSubtitulo: texto("VITE_BRAND_APP_SUBTITULO", "Cítricos S.L."),
  /** Título HTML/document.title por defecto (pestaña del navegador). */
  appTitulo: texto("VITE_BRAND_APP_TITULO", "Herramienta Lasarte Cítricos S.L."),
  /** Descripción corta de la app (login, meta description). */
  appDescripcion: texto("VITE_BRAND_APP_DESCRIPCION", "Control de producción citrícola"),
  /** Subtítulo genérico de informes ("Herramienta de control operativo"). */
  herramientaDescripcion: texto("VITE_BRAND_HERRAMIENTA", "Herramienta de control operativo"),
  /** Prefijo de los nombres de fichero exportados (`X_Modulo_fecha.xlsx`). */
  filePrefix: texto("VITE_BRAND_FILE_PREFIX", "Lasarte"),
  /** Nombre del asistente conversacional. */
  asistente: texto("VITE_BRAND_ASISTENTE", "Vadim"),
  /** Logo horizontal (login + cabeceras PDF/Excel). Sustituir el fichero o la ruta. */
  logoHorizontal: texto("VITE_BRAND_LOGO_HORIZONTAL", "/branding/lasarte-logo-horizontal.jpg"),
  /** Relación de aspecto ancho/alto del logo horizontal. */
  logoHorizontalAspect:
    Number(env.VITE_BRAND_LOGO_ASPECT ?? "") > 0 ? Number(env.VITE_BRAND_LOGO_ASPECT) : 900 / 357,
  /** Logo cuadrado del sidebar. */
  logoSidebar: texto("VITE_BRAND_LOGO_SIDEBAR", "/logo.jpg"),
} as const;

/** Dirección en una sola línea, como la usan los pies fiscales de Excel/PDF. */
export const BRAND_DIRECCION_COMPLETA = `${BRAND.direccion}, ${BRAND.poblacion}`;
