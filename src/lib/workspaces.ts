// Espacios de trabajo de la herramienta: las 5 grandes secciones, quién puede
// ver cada una, a qué sección pertenece cada ruta y el directorio de páginas
// de cada una (NAV_GROUPS). Lo consumen AppLayout (sidebar), TopBar (chip de
// sección y migas), la home por rol y el Mapa de la herramienta.
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Building2,
  CalendarOff,
  Citrus,
  ClipboardCheck,
  Droplet,
  Euro,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Mail,
  Plane,
  Receipt,
  ShoppingCart,
  Sprout,
  Tags,
  Truck,
  Upload,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

export type WorkspaceId = "direccion" | "produccion" | "comercial" | "rrhh" | "economico";

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
    // Panel de direccion: vista global de todas las areas, solo para el jefe (admin).
    id: "direccion",
    label: "Dirección",
    icon: Building2,
    home: "/direccion",
    matches: (p) => p.startsWith("/direccion"),
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
    id: "economico",
    label: "Económico",
    icon: Euro,
    home: "/economico",
    matches: (p) => p.startsWith("/economico"),
    allowedFor: (role) => role === "admin",
  },
  {
    // Produccion va la ultima: es el espacio por defecto (matches comodin).
    // Es el espacio del rol basico (operario); rrhh vive solo en su espacio.
    id: "produccion",
    label: "Producción",
    icon: Citrus,
    home: "/produccion",
    matches: () => true,
    allowedFor: (role) => role === "admin" || role === "operario",
  },
];

/** Orden de presentación en la sidebar (WORKSPACES ordena por prioridad de matching). */
export const WORKSPACE_DISPLAY_ORDER: WorkspaceId[] = [
  "direccion",
  "produccion",
  "comercial",
  "rrhh",
  "economico",
];

export function workspaceDeRuta(path: string): WorkspaceId {
  return (WORKSPACES.find((w) => w.matches(path)) ?? WORKSPACES[WORKSPACES.length - 1]).id;
}

// ─── Directorio de páginas por sección ──────────────────────────────────────
// Única fuente para el árbol de la sidebar (AppLayout) y el Mapa de la
// herramienta. El acceso por rol se decide en quien lo consume (allowedFor de
// la sección + el caso especial de Categoría segunda).

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  match?: (path: string) => boolean;
}

export const NAV_GROUPS: Array<{ label: string; workspace: WorkspaceId; items: NavItem[] }> = [
  {
    label: "Dirección",
    workspace: "direccion",
    items: [
      { to: "/direccion", label: "Panel de dirección", icon: LayoutDashboard, match: (path) => path === "/direccion" },
    ],
  },
  {
    label: "Dashboard",
    workspace: "produccion",
    items: [
      { to: "/produccion", label: "Panel de producción", icon: LayoutDashboard, match: (path) => path === "/produccion" },
    ],
  },
  {
    label: "Operaciones diarias",
    workspace: "produccion",
    items: [
      { to: "/entradas", label: "Entradas de fruta", icon: Truck },
      { to: "/calidad", label: "Calidad", icon: ClipboardCheck },
      { to: "/partes", label: "Partes", icon: FileText, match: (path) => path.startsWith("/partes") },
    ],
  },
  {
    label: "Producción",
    workspace: "produccion",
    items: [
      { to: "/analisis/diario", label: "Análisis diario", icon: BarChart3 },
      { to: "/productores", label: "Productores", icon: Sprout },
      // Variante de produccion: sin facturacion (la completa vive en Comercial).
      { to: "/mercadona", label: "Mercadona (planta)", icon: ShoppingCart },
    ],
  },
  {
    label: "Operaciones",
    workspace: "produccion",
    items: [
      { to: "/costes/consumos", label: "Consumos", icon: Droplet },
    ],
  },
  {
    label: "Comercial",
    workspace: "comercial",
    items: [
      { to: "/comercial", label: "Panel comercial", icon: LayoutDashboard, match: (path) => path === "/comercial" },
      { to: "/comercial/mercadona", label: "Mercadona (ventas)", icon: ShoppingCart },
      { to: "/comercial/ventas-mes", label: "Ventas del mes", icon: Upload },
      { to: "/ventas/categoria-segunda", label: "Categoría segunda", icon: FileSpreadsheet },
      { to: "/ventas/categoria-primera", label: "Categoría primera", icon: FileSpreadsheet },
      { to: "/cmr", label: "CMR y Hojas de ruta", icon: Truck },
    ],
  },
  {
    // La asistencia diaria (pasar lista + importaciones) vive aqui desde jul
    // 2026: los operarios ya no la ven; el resto de su informacion vive
    // repartida en Ausencias (faltas), Plantilla (personas) y Vacaciones.
    label: "RRHH",
    workspace: "rrhh",
    items: [
      { to: "/rrhh", label: "Panel de RRHH", icon: LayoutDashboard, match: (path) => path === "/rrhh" },
      { to: "/costes/asistencia", label: "Asistencia diaria", icon: Users },
      { to: "/rrhh/personas", label: "Plantilla", icon: UserRound },
      { to: "/rrhh/ausencias", label: "Ausencias y bajas", icon: CalendarOff },
      { to: "/rrhh/amonestaciones", label: "Amonestaciones", icon: AlertTriangle },
      { to: "/rrhh/vacaciones", label: "Vacaciones y horas", icon: Plane },
      { to: "/rrhh/nominas", label: "Nóminas", icon: Banknote },
      { to: "/rrhh/comunicaciones", label: "Comunicaciones", icon: Mail },
      { to: "/rrhh/mercadona", label: "Mercadona (facturas)", icon: ShoppingCart },
    ],
  },
  {
    label: "Económico",
    workspace: "economico",
    items: [
      { to: "/economico", label: "Panel económico", icon: Euro, match: (path) => path === "/economico" },
      { to: "/economico/facturacion", label: "Facturación", icon: Receipt },
      { to: "/economico/costes", label: "Costes", icon: Droplet },
      { to: "/economico/precios", label: "Precios", icon: Tags },
    ],
  },
];
