// Espacios de trabajo de la herramienta: las grandes secciones, quién puede ver
// cada una, a qué sección pertenece cada ruta y el directorio de páginas de
// cada una (NAV_GROUPS). Lo consumen AppLayout (sidebar), TopBar (chip de
// sección y migas), la home por rol y el Mapa de la herramienta.
//
// ─── Rediseño 13-08-2026: de 38 entradas de menú a 25 ────────────────────────
//
// EL PROBLEMA. Había tres rutas de Mercadona (dos servían el MISMO componente),
// dos páginas de importar, una "Categoría primera" que era literalmente
// "Categoría segunda" con otro filtro, y /calibrador y /productores
// respondiendo a la misma pregunta ("cuánto aprovecha cada productor") con
// cifras distintas porque bebían de sitios distintos.
//
// EL CRITERIO. El que ya estaba escrito en la herramienta: cada página responde
// a UNA pregunta. Lo que compartía pregunta se fundió en pestañas de una sola
// página; nada se ha eliminado.
//
// LAS URLS NO CAMBIAN. Hay ~120 enlaces internos cableados (23 solo a
// /trazabilidad). Renombrar rutas los habría roto todos sin ganar nada: lo que
// cambia es el ÁRBOL y las fusiones. Cada página absorbida redirige a su
// pestaña dentro de la superviviente (ver src/App.tsx), así que ningún enlace
// guardado ni ningún deep-link deja de funcionar.
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Citrus,
  ClipboardCheck,
  Brush,
  Database,
  Euro,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Receipt,
  Send,
  ShoppingCart,
  Sprout,
  Tags,
  Truck,
  Upload,
  UserRound,
  Users,
  Waypoints,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type WorkspaceId =
  | "direccion"
  | "planta"
  | "analisis"
  | "comercial"
  | "economico"
  | "rrhh"
  | "datos";

export interface Workspace {
  id: WorkspaceId;
  label: string;
  icon: LucideIcon;
  home: string;
  matches: (path: string) => boolean;
  allowedFor: (role: string | null) => boolean;
}

export const WORKSPACES: Workspace[] = [
  {
    // Panel de dirección: la vista global, solo para el jefe.
    id: "direccion",
    label: "Dirección",
    icon: Building2,
    home: "/direccion",
    matches: (p) => p.startsWith("/direccion"),
    allowedFor: (role) => role === "admin",
  },
  {
    // Económico vuelve a ser sección propia (jul 2026 estaba fundido dentro de
    // Dirección): con Dirección reducida a su panel, tenerlo escondido detrás
    // de otra sección solo añadía un clic.
    id: "economico",
    label: "Económico",
    icon: Euro,
    home: "/economico",
    matches: (p) => p.startsWith("/economico") || p.startsWith("/costes/consumos"),
    allowedFor: (role) => role === "admin",
  },
  {
    id: "comercial",
    label: "Comercial",
    icon: ShoppingCart,
    home: "/comercial",
    matches: (p) => p.startsWith("/comercial") || p.startsWith("/ventas") || p.startsWith("/cmr"),
    allowedFor: (role) => role === "admin" || role === "ventas",
  },
  {
    id: "rrhh",
    label: "RRHH",
    icon: UserRound,
    home: "/rrhh",
    matches: (p) => p.startsWith("/rrhh") || p.startsWith("/costes/asistencia"),
    allowedFor: (role) => role === "admin" || role === "rrhh",
  },
  {
    // Análisis: mirar hacia atrás. Cada página es un EJE distinto sobre los
    // mismos datos (día, lote, productor, cliente), no una copia con otro
    // filtro.
    id: "analisis",
    label: "Análisis",
    icon: BarChart3,
    home: "/analisis/diario",
    matches: (p) =>
      p.startsWith("/analisis") || p.startsWith("/trazabilidad") ||
      p.startsWith("/productores") || p.startsWith("/calibrador") ||
      p.startsWith("/mercadona"),
    // El operario también, igual que antes: estas cuatro páginas vivían dentro
    // de "Producción" y las veía. Sacarlas a sección propia es una decisión de
    // ORDEN, no de permisos — quitarle el acceso de paso habría sido colar un
    // cambio que nadie pidió.
    allowedFor: (role) => role === "admin" || role === "operario",
  },
  {
    id: "datos",
    label: "Datos",
    icon: Database,
    home: "/datos/fuentes",
    matches: (p) => p.startsWith("/datos") || p.startsWith("/importar") || p.startsWith("/historico"),
    allowedFor: (role) => role === "admin",
  },
  {
    // Planta va la última: es el espacio por defecto (matches comodín) y el del
    // rol básico. Es el día a día, lo que pasa HOY en la nave.
    id: "planta",
    label: "Planta",
    icon: Citrus,
    home: "/produccion",
    matches: () => true,
    allowedFor: (role) => role === "admin" || role === "operario",
  },
];

/** Orden de presentación en la sidebar (WORKSPACES ordena por prioridad de matching). */
export const WORKSPACE_DISPLAY_ORDER: WorkspaceId[] = [
  "direccion",
  "planta",
  "analisis",
  "comercial",
  "economico",
  "rrhh",
  "datos",
];

export function workspaceDeRuta(path: string): WorkspaceId {
  return (WORKSPACES.find((w) => w.matches(path)) ?? WORKSPACES[WORKSPACES.length - 1]).id;
}

// ─── Directorio de páginas por sección ──────────────────────────────────────
// Única fuente para el árbol de la sidebar (AppLayout), la paleta de comandos y
// el Mapa de la herramienta. El acceso por rol se decide en quien lo consume
// (allowedFor de la sección + los casos especiales por RPC).

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  match?: (path: string) => boolean;
  /**
   * Solo el rol admin ve este ítem (sidebar, paleta y mapa) y su ruta
   * (RoleRoute.ADMIN_ONLY_PATHS debe listarla también).
   */
  adminOnly?: boolean;
}

export const NAV_GROUPS: Array<{ label: string; workspace: WorkspaceId; items: NavItem[] }> = [
  {
    label: "Dirección",
    workspace: "direccion",
    items: [
      { to: "/direccion", label: "Panel de dirección", icon: LayoutDashboard, match: (p) => p === "/direccion" },
    ],
  },
  {
    // ── PLANTA: qué está pasando hoy en la nave ──
    label: "Planta",
    workspace: "planta",
    items: [
      { to: "/produccion", label: "Panel de planta", icon: LayoutDashboard, match: (p) => p === "/produccion" },
      { to: "/partes", label: "Parte del día", icon: FileText, match: (p) => p.startsWith("/partes") },
      { to: "/entradas", label: "Entradas y stock", icon: Truck },
      { to: "/calidad", label: "Calidad", icon: ClipboardCheck },
      { to: "/limpieza", label: "Limpieza de box", icon: Brush, adminOnly: true },
    ],
  },
  {
    // Comunicaciones de campaña: exclusiva de Jesús (jesus@lasartesat.es) y
    // admin. Solo se pinta si la RPC can_access_comunicaciones_campo da true
    // (lo filtran AppLayout, CommandPalette y MapaHerramienta).
    label: "Campo",
    workspace: "planta",
    items: [
      { to: "/campo/comunicaciones", label: "Comunicaciones de campaña", icon: Send },
    ],
  },
  {
    // ── ANÁLISIS: los cuatro ejes sobre los mismos datos ──
    // Desde el 13-08-2026 los cuatro leen la MISMA fuente (clasificacion_lote,
    // el volcado del calibrador). Antes /productores y /calibrador daban cifras
    // distintas para la misma pregunta; por eso /calibrador es hoy una pestaña
    // de Productores y no una página aparte.
    label: "Análisis",
    workspace: "analisis",
    items: [
      { to: "/analisis/diario", label: "Por día", icon: BarChart3 },
      { to: "/trazabilidad", label: "Por lote", icon: Waypoints },
      { to: "/productores", label: "Por productor", icon: Sprout, match: (p) => p.startsWith("/productores") || p.startsWith("/calibrador") },
      { to: "/mercadona", label: "Por cliente (Mercadona)", icon: ShoppingCart },
    ],
  },
  {
    // ── COMERCIAL ──
    label: "Comercial",
    workspace: "comercial",
    items: [
      { to: "/comercial", label: "Panel comercial", icon: LayoutDashboard, match: (p) => p === "/comercial" },
      { to: "/comercial/mercadona", label: "Mercadona", icon: ShoppingCart },
      // Antes eran dos páginas idénticas (primera y segunda) más el importador
      // mensual: ahora una con selector de categoría y pestaña de importación.
      { to: "/ventas/categoria-segunda", label: "Ventas por categoría", icon: FileSpreadsheet, match: (p) => p.startsWith("/ventas") || p === "/comercial/ventas-mes" },
      { to: "/cmr", label: "CMR y hojas de ruta", icon: Truck },
    ],
  },
  {
    // ── ECONÓMICO ──
    // Costes absorbe lo que estaba repartido en cuatro páginas (Costes,
    // Consumos, CMV y Coste por producto) más Compra de fruta: todas
    // contestaban "cuánto cuesta", cada una por un eje distinto.
    label: "Económico",
    workspace: "economico",
    items: [
      { to: "/economico", label: "Panel económico", icon: Euro, match: (p) => p === "/economico" },
      { to: "/economico/rentabilidad", label: "Rentabilidad del día", icon: BarChart3 },
      { to: "/economico/costes", label: "Costes", icon: Wallet, match: (p) => p.startsWith("/economico/costes") || p.startsWith("/economico/cmv") || p.startsWith("/economico/productos") || p.startsWith("/economico/fruta") || p.startsWith("/costes/consumos") },
      { to: "/economico/facturacion", label: "Facturación", icon: Receipt },
      { to: "/economico/precios", label: "Tarifas", icon: Tags },
    ],
  },
  {
    // ── RRHH ──
    // Plantilla absorbe ausencias, amonestaciones, vacaciones y comunicaciones:
    // los cuatro son el expediente de la MISMA persona, y tenerlos en páginas
    // separadas obligaba a buscar al mismo trabajador cuatro veces.
    label: "RRHH",
    workspace: "rrhh",
    items: [
      { to: "/rrhh", label: "Panel de RRHH", icon: LayoutDashboard, match: (p) => p === "/rrhh" },
      { to: "/costes/asistencia", label: "Asistencia", icon: Users, match: (p) => p.startsWith("/costes/asistencia") },
      { to: "/rrhh/personas", label: "Plantilla", icon: UserRound, match: (p) => p.startsWith("/rrhh/personas") || p.startsWith("/rrhh/ausencias") || p.startsWith("/rrhh/amonestaciones") || p.startsWith("/rrhh/vacaciones") || p.startsWith("/rrhh/comunicaciones") },
      { to: "/rrhh/nominas", label: "Nóminas", icon: Wallet },
    ],
  },
  {
    // ── DATOS: por dónde entra todo y si está entrando ──
    // "Estado de las fuentes" es nueva (13-08-2026): es la página que habría
    // avisado de que el registro de cámaras externas llevaba 78 días sin
    // actualizarse sin que nadie se enterase.
    label: "Datos",
    workspace: "datos",
    items: [
      { to: "/datos/fuentes", label: "Estado de las fuentes", icon: AlertTriangle },
      { to: "/importar", label: "Importar", icon: Upload, match: (p) => p.startsWith("/importar") || p.startsWith("/historico") },
    ],
  },
];
