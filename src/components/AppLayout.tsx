import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  ClipboardCheck,
  LogOut,
  Citrus,
  Droplet,
  FileSpreadsheet,
  Users,
  BarChart3,
  Sprout,
  ShoppingCart,
  Truck,
  UserRound,
  CalendarOff,
  AlertTriangle,
  Plane,
  Banknote,
  Euro,
  Receipt,
  Tags,
  Mail,
  Building2,
  Upload,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";


import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { TopBar } from "@/components/TopBar";
import { CommandPalette, useCommandPalette } from "@/components/CommandPalette";
import { ChatBot } from "@/components/ChatBot";
import { useDataWarmup } from "@/hooks/useDataWarmup";
import { useVentasCategoriaAccess } from "@/hooks/useVentasCategoria";
import { preloadRoute } from "@/lib/routePreload";
import { TourGuiado } from "@/components/tour/TourGuiado";
import { getVisibleTourSteps, tourStorageKey } from "@/components/tour/tourSteps";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  match?: (path: string) => boolean;
};

// ─── Espacios de trabajo ─────────────────────────────────────────────────────
// La herramienta se organiza en 4 grandes secciones; cada rol ve las suyas y
// los admins navegan entre todas con el conmutador "Secciones" de la sidebar.
// El espacio activo se deduce de la ruta; la sidebar solo pinta sus grupos.
export type WorkspaceId = "direccion" | "produccion" | "comercial" | "rrhh" | "economico";

export const WORKSPACES: Array<{
  id: WorkspaceId;
  label: string;
  icon: typeof LayoutDashboard;
  home: string;
  matches: (path: string) => boolean;
  allowedFor: (role: string | null) => boolean;
}> = [
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
    home: "/",
    matches: () => true,
    allowedFor: (role) => role === "admin" || role === "operario",
  },
];

export function workspaceDeRuta(path: string): WorkspaceId {
  return (WORKSPACES.find((w) => w.matches(path)) ?? WORKSPACES[WORKSPACES.length - 1]).id;
}

const navGroups: Array<{ label: string; workspace: WorkspaceId; items: NavItem[] }> = [
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
      { to: "/", label: "Panel de producción", icon: LayoutDashboard, match: (path) => path === "/" },
    ],
  },
  {
    label: "Operaciones diarias",
    workspace: "produccion",
    items: [
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
      { to: "/mercadona", label: "Mercadona", icon: ShoppingCart },
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
      { to: "/comercial/mercadona", label: "Mercadona", icon: ShoppingCart },
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
      { to: "/rrhh/mercadona", label: "Mercadona", icon: ShoppingCart },
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

export default function AppLayout() {
  return (
    <SidebarProvider>
      <AppLayoutContent />
    </SidebarProvider>
  );
}

function AppLayoutContent() {
  const { signOut, user, role } = useAuth();
  const ventasCategoriaAccess = useVentasCategoriaAccess();
  const { isMobile, setOpenMobile } = useSidebar();
  useDataWarmup();

  const navigate = useNavigate();
  const location = useLocation();
  // Espacio de trabajo activo (deducido de la ruta) y espacios permitidos al rol.
  const workspaceActual = workspaceDeRuta(location.pathname);
  const workspacesPermitidos = WORKSPACES.filter((w) => w.allowedFor(role));

  const cmd = useCommandPalette();

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  function closeMobileSidebar() {
    if (isMobile) setOpenMobile(false);
  }

  const [tourOpen, setTourOpen] = useState(false);
  const tourSteps = getVisibleTourSteps(workspaceActual, { hasVentasCategoriaAccess: ventasCategoriaAccess.hasAccess });

  // Arranque automático la primera vez que un usuario autenticado entra a un
  // espacio de trabajo. Cada espacio tiene su propio tour y su propia clave de
  // localStorage, así que esto se dispara una vez por espacio (y por usuario).
  useEffect(() => {
    if (!user || tourSteps.length === 0) return;
    try {
      const seen = localStorage.getItem(tourStorageKey(workspaceActual));
      if (!seen) setTourOpen(true);
    } catch {
      // Si localStorage no está disponible simplemente no auto-arrancamos el tour.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, workspaceActual]);

  // Relanzable desde el botón "Guía" del TopBar: arranca el tour del espacio actual.
  useEffect(() => {
    function handleStartTour() {
      setTourOpen(true);
    }
    window.addEventListener("lasarte:start-tour", handleStartTour);
    return () => window.removeEventListener("lasarte:start-tour", handleStartTour);
  }, []);

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild className="h-14">
                <NavLink to="/" onClick={closeMobileSidebar}>
                  <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-[var(--glass-shadow-lg)]">
                    <Citrus className="size-5" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold text-sidebar-foreground">Lasarte Cítricos S.L.</span>
                    <span className="truncate text-xs text-sidebar-foreground/55">Dashboard</span>
                  </div>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {/* Conmutador de grandes secciones (si el rol tiene más de una). */}
          {workspacesPermitidos.length > 1 ? (
            <SidebarGroup>
              <SidebarGroupLabel>Secciones</SidebarGroupLabel>
              <SidebarMenu>
                {workspacesPermitidos.map((ws) => {
                  const WsIcon = ws.icon;
                  const activo = ws.id === workspaceActual;
                  return (
                    <SidebarMenuItem key={ws.id}>
                      <SidebarMenuButton asChild isActive={activo} tooltip={ws.label}>
                        <NavLink
                          to={ws.home}
                          onClick={closeMobileSidebar}
                          onMouseEnter={() => preloadRoute(ws.home)}
                          className={activo ? "font-semibold" : undefined}
                        >
                          <WsIcon />
                          <span>{ws.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ) : null}

          {navGroups
            // Solo se pintan los grupos del espacio activo, y solo si el rol
            // puede estar en ese espacio (la URL ya la vigila RoleRoute).
            .filter((group) => {
              if (group.workspace !== workspaceActual) return false;
              const ws = WORKSPACES.find((w) => w.id === group.workspace);
              return ws ? ws.allowedFor(role) : false;
            })
            .map((group) => {
            // El acceso por espacio ya se resolvió arriba; a nivel de item solo
            // queda el mecanismo histórico de Categoría segunda (allowlist/rol).
            const visibleItems = group.items.filter((item) => {
              if (item.to === "/ventas/categoria-segunda") return ventasCategoriaAccess.hasAccess;
              return true;
            });
            // Un grupo sin items visibles (p.ej. "Comercial" sin acceso) no pinta ni su etiqueta.
            if (visibleItems.length === 0) return null;
            return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = item.match
                    ? item.match(location.pathname)
                    : location.pathname === item.to;

                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <NavLink
                          to={item.to}
                          end={item.to === "/"}
                          data-tour={item.to}
                          onClick={closeMobileSidebar}
                          onFocus={() => preloadRoute(item.to)}
                          onMouseEnter={() => preloadRoute(item.to)}
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
            );
          })}

        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex flex-col gap-3 px-1 py-1">


                <div className="flex items-center gap-2 rounded-xl border border-sidebar-border/65 bg-sidebar-accent/35 p-2">
                  <Avatar className="size-8 shrink-0">
                    <AvatarFallback className="bg-sidebar-primary/15 text-sidebar-primary text-xs font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
                    {user?.email}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    title="Cerrar sesión"
                    onClick={async () => {
                      closeMobileSidebar();
                      await signOut();
                      navigate("/auth");
                    }}
                  >
                    <LogOut className="size-4" />
                  </Button>
                </div>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <TopBar />
        <div className="flex min-w-0 flex-1 flex-col px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 animate-slideIn sm:px-5 sm:py-5 lg:px-8">
          <Outlet />
        </div>
      </SidebarInset>
      <CommandPalette open={cmd.open} onOpenChange={cmd.setOpen} />
      <ChatBot />
      {tourOpen && (
        <TourGuiado
          steps={tourSteps}
          storageKey={tourStorageKey(workspaceActual)}
          onFinish={() => setTourOpen(false)}
        />
      )}
    </>
  );
}
