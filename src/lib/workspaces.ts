// Espacios de trabajo de la herramienta: las 5 grandes secciones, quién puede
// ver cada una y a qué sección pertenece cada ruta. Lo consumen AppLayout
// (sidebar), TopBar (chip de sección y migas) y la home por rol.
import { Building2, Citrus, Euro, ShoppingCart, UserRound, type LucideIcon } from "lucide-react";

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
