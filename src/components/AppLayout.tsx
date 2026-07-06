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
import { TOUR_STORAGE_KEY, getVisibleTourSteps } from "@/components/tour/tourSteps";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  match?: (path: string) => boolean;
};

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Dashboard",
    items: [
      { to: "/", label: "Panel de producción", icon: LayoutDashboard, match: (path) => path === "/" },
    ],
  },
  {
    label: "Operaciones diarias",
    items: [
      { to: "/calidad", label: "Calidad", icon: ClipboardCheck },
      { to: "/partes", label: "Partes", icon: FileText, match: (path) => path.startsWith("/partes") },
    ],
  },
  {
    label: "Producción",
    items: [
      { to: "/analisis/diario", label: "Análisis diario", icon: BarChart3 },
      { to: "/productores", label: "Productores", icon: Sprout },
    ],
  },
  {
    label: "Comercial",
    items: [
      { to: "/ventas/categoria-segunda", label: "Categoria segunda", icon: FileSpreadsheet },
    ],
  },
  {
    label: "Operaciones",
    items: [
      { to: "/costes/consumos", label: "Consumos", icon: Droplet },
      { to: "/costes/asistencia", label: "Asistencia", icon: Users },
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
  const { signOut, user } = useAuth();
  const ventasCategoriaAccess = useVentasCategoriaAccess();
  const { isMobile, setOpenMobile } = useSidebar();
  useDataWarmup();

  const navigate = useNavigate();
  const location = useLocation();

  const cmd = useCommandPalette();

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  function closeMobileSidebar() {
    if (isMobile) setOpenMobile(false);
  }

  const [tourOpen, setTourOpen] = useState(false);
  const tourSteps = getVisibleTourSteps(ventasCategoriaAccess.hasAccess);

  // Arranque automático la primera vez que un usuario autenticado entra a la app.
  useEffect(() => {
    if (!user) return;
    try {
      const seen = localStorage.getItem(TOUR_STORAGE_KEY);
      if (!seen) setTourOpen(true);
    } catch {
      // Si localStorage no está disponible simplemente no auto-arrancamos el tour.
    }
  }, [user]);

  // Relanzable desde el botón "Guía" del TopBar.
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
                    <span className="truncate font-semibold text-sidebar-foreground">Lasarte SAT</span>
                    <span className="truncate text-xs text-sidebar-foreground/55">Dashboard</span>
                  </div>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {navGroups.map((group) => {
            const visibleItems = group.items.filter((item) => (
              item.to !== "/ventas/categoria-segunda" || ventasCategoriaAccess.hasAccess
            ));
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
      {tourOpen && <TourGuiado steps={tourSteps} onFinish={() => setTourOpen(false)} />}
    </>
  );
}
