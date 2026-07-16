import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { ChevronDown, LogOut, Map } from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";
import {
  NAV_GROUPS,
  WORKSPACES,
  WORKSPACE_DISPLAY_ORDER,
  workspaceDeRuta,
  type WorkspaceId,
} from "@/lib/workspaces";
import { cn } from "@/lib/utils";


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

// ─── Espacios de trabajo ─────────────────────────────────────────────────────
// Las 4 grandes secciones y su directorio de páginas (NAV_GROUPS) viven en
// src/lib/workspaces.ts (los comparten TopBar y el Mapa de la herramienta).
// "Económico" (jul 2026) ya no es una sección propia: sus páginas son el
// grupo "Económico" dentro de Dirección, sin conmutador aparte.
// Con varias secciones permitidas (admin), la sidebar pinta el ÁRBOL COMPLETO:
// cada sección es un bloque desplegable con todas sus páginas — nada queda
// escondido detrás de un conmutador. La sección de la ruta actual se abre
// sola; las demás se pliegan/despliegan a mano.
const navGroups = NAV_GROUPS;

export default function AppLayout() {
  // data-seccion en el wrapper de SidebarProvider: fija --seccion-acento (+
  // -texto/-suave, ver src/index.css) para TODA la página (sidebar, TopBar,
  // Outlet) según la gran sección de la ruta actual — las variables CSS
  // heredan por el árbol del DOM aunque este wrapper no sea un hijo directo
  // del contenedor flex de la sidebar. FASE 2 (jul 2026): solo Producción lo
  // consume de forma visible; el resto de secciones quedan listas para las
  // fases 3-4.
  const location = useLocation();
  const seccionActual = workspaceDeRuta(location.pathname);

  return (
    <SidebarProvider data-seccion={seccionActual}>
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

  // Árbol completo (admin): qué secciones están desplegadas. La de la ruta
  // actual se abre sola al navegar; las demás se pliegan/despliegan a mano.
  const [seccionesAbiertas, setSeccionesAbiertas] = useState<Partial<Record<WorkspaceId, boolean>>>(
    { [workspaceActual]: true },
  );
  useEffect(() => {
    setSeccionesAbiertas((prev) => (prev[workspaceActual] ? prev : { ...prev, [workspaceActual]: true }));
  }, [workspaceActual]);

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
                  <img
                    src="/logo.jpg"
                    alt="Herramienta Lasarte Cítricos S.L."
                    className="aspect-square size-10 shrink-0 object-contain"
                  />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold text-sidebar-foreground">Herramienta Lasarte</span>
                    <span className="truncate text-xs text-sidebar-foreground/55">Cítricos S.L.</span>
                  </div>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {/* Acceso fijo al mapa de la herramienta (todos los roles): el índice
              de secciones y páginas con su descripción. */}
          <SidebarGroup className="pb-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/mapa"}
                  tooltip="Mapa de la herramienta"
                >
                  <NavLink
                    to="/mapa"
                    onClick={closeMobileSidebar}
                    onMouseEnter={() => preloadRoute("/mapa")}
                  >
                    <Map />
                    <span>Mapa de la herramienta</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          {workspacesPermitidos.length > 1 ? (
            // ── Árbol completo (admin): una sección desplegable por espacio. ──
            WORKSPACE_DISPLAY_ORDER
              .map((id) => workspacesPermitidos.find((w) => w.id === id))
              .filter((ws): ws is NonNullable<typeof ws> => Boolean(ws))
              .map((ws) => {
                const WsIcon = ws.icon;
                const activo = ws.id === workspaceActual;
                const abierta = Boolean(seccionesAbiertas[ws.id]);
                const items = navGroups
                  .filter((group) => group.workspace === ws.id)
                  .flatMap((group) => group.items)
                  .filter((item) => (item.to === "/ventas/categoria-segunda" ? ventasCategoriaAccess.hasAccess : true));
                if (items.length === 0) return null;
                return (
                  <SidebarGroup
                    key={ws.id}
                    className={cn("py-1", activo && "border-l-2 border-seccion/50")}
                  >
                    {/* Sección activa: acento del workspace (--seccion-acento,
                        fijado por AppLayout vía data-seccion), no el
                        sidebar-primary genérico — FASE 2 del rediseño. */}
                    <button
                      type="button"
                      onClick={() => setSeccionesAbiertas((prev) => ({ ...prev, [ws.id]: !abierta }))}
                      aria-expanded={abierta}
                      title={ws.label}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                        activo
                          ? "text-seccion"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                      )}
                    >
                      <WsIcon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate text-left group-data-[collapsible=icon]:hidden">{ws.label}</span>
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[collapsible=icon]:hidden",
                          abierta ? "" : "-rotate-90",
                        )}
                      />
                    </button>
                    {abierta && (
                      <SidebarMenu>
                        {items.map((item) => {
                          const Icon = item.icon;
                          const active = item.match
                            ? item.match(location.pathname)
                            : location.pathname === item.to;
                          return (
                            <SidebarMenuItem key={item.to}>
                              <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                                <NavLink
                                  to={item.to}
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
                    )}
                  </SidebarGroup>
                );
              })
          ) : (
            // ── Un solo espacio (operario/ventas/rrhh): grupos planos de siempre. ──
            navGroups
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
              })
          )}

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
