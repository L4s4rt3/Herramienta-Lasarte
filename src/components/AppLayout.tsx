import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  LogOut,
  Citrus,
  Calculator,
  Droplet,
  Users,
  ChevronRight,
  TrendingDown,
  Warehouse,
  BarChart3,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useState } from "react";
import { cn } from "@/lib/utils";

// ─── Route metadata ────────────────────────────────────────────────────────────
const ROUTE_META: Record<string, { label: string; parent?: string; parentLabel?: string }> = {
  "/":                       { label: "Dashboard" },
  "/partes":                 { label: "Partes", parent: "/", parentLabel: "Dashboard" },
  "/dsj":                    { label: "Calculadora DJPMN", parent: "/", parentLabel: "Dashboard" },
  "/costes/consumos":        { label: "Consumos", parent: "/", parentLabel: "Dashboard" },
  "/costes/asistencia":      { label: "Asistencia", parent: "/", parentLabel: "Dashboard" },
  "/stock":                  { label: "Stock en cámara", parent: "/", parentLabel: "Dashboard" },
  "/productores":            { label: "Productores", parent: "/", parentLabel: "Dashboard" },
  "/analisis/calibres":      { label: "Calibres", parent: "/", parentLabel: "Dashboard" },
  "/analisis/informes":      { label: "Análisis Informes", parent: "/", parentLabel: "Dashboard" },
};

// ─── Top bar ───────────────────────────────────────────────────────────────────
function TopBar() {
  const location = useLocation();

  // Match route (handles dynamic segments like /partes/:id)
  const baseRoute = Object.keys(ROUTE_META)
    .filter((r) => location.pathname === r || location.pathname.startsWith(r + "/"))
    .sort((a, b) => b.length - a.length)[0];

  const meta = baseRoute ? ROUTE_META[baseRoute] : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {meta?.parent && (
            <>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink asChild>
                  <NavLink to={meta.parent}>{meta.parentLabel}</NavLink>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
            </>
          )}
          <BreadcrumbItem>
            <BreadcrumbPage>{meta?.label ?? "—"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

// ─── App Layout ────────────────────────────────────────────────────────────────
export default function AppLayout() {
  const { signOut, user } = useAuth();
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  // Track open state of "Costes" collapsible group
  const costesRoutes = ["/costes/consumos", "/costes/asistencia"];
  const isCostesActive = costesRoutes.some((r) => location.pathname.startsWith(r));
  const [costesOpen, setCostesOpen] = useState(isCostesActive);
  // User initials for avatar
  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  return (
    <SidebarProvider>
      {/* ── Sidebar ── */}
      <Sidebar collapsible="icon">

        {/* Logo / App name */}
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <NavLink to="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Citrus className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{t("app_name")}</span>
                    <span className="truncate text-xs text-muted-foreground">Citrus production</span>
                  </div>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>

          {/* ── Main nav ── */}
          <SidebarGroup>
            <SidebarGroupLabel>Navegación</SidebarGroupLabel>
            <SidebarMenu>

              {/* Dashboard */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === "/"} tooltip={t("dashboard")}>
                  <NavLink to="/" end>
                    <LayoutDashboard />
                    <span>{t("dashboard")}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Partes */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname.startsWith("/partes")}
                  tooltip={t("partes")}
                >
                  <NavLink to="/partes">
                    <FileText />
                    <span>{t("partes")}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Calculadora */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/dsj"}
                  tooltip="Calculadora DJPMN"
                >
                  <NavLink to="/dsj">
                    <Calculator />
                    <span>Calculadora DJPMN</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

            </SidebarMenu>
          </SidebarGroup>

          {/* ── Producción (collapsible group) ── */}
          <SidebarGroup>
            <SidebarGroupLabel>Producción</SidebarGroupLabel>
            <SidebarMenu>
              {/* Stock en cámara */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/stock"}
                  tooltip="Stock en cámara"
                >
                  <NavLink to="/stock">
                    <Warehouse />
                    <span>Stock en cámara</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Productores */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/productores"}
                  tooltip="Productores"
                >
                  <NavLink to="/productores">
                    <Users />
                    <span>Productores</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Análisis informes */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/analisis/informes"}
                  tooltip="Análisis Informes"
                >
                  <NavLink to="/analisis/informes">
                    <FileText />
                    <span>Análisis Informes</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Análisis calibres */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/analisis/calibres"}
                  tooltip="Calibres"
                >
                  <NavLink to="/analisis/calibres">
                    <BarChart3 />
                    <span>Calibres</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          {/* ── Costes (collapsible group) ── */}
          <SidebarGroup>
            <SidebarGroupLabel>Costes</SidebarGroupLabel>
            <SidebarMenu>
              <Collapsible
                open={costesOpen}
                onOpenChange={setCostesOpen}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip="Costes"
                      isActive={isCostesActive}
                      className={cn(isCostesActive && !costesOpen && "bg-sidebar-accent text-sidebar-accent-foreground font-medium")}
                    >
                      <TrendingDown />
                      <span>Costes</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={location.pathname === "/costes/consumos"}
                        >
                          <NavLink to="/costes/consumos">
                            <Droplet className="size-3.5" />
                            <span>Consumos</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={location.pathname === "/costes/asistencia"}
                        >
                          <NavLink to="/costes/asistencia">
                            <Users className="size-3.5" />
                            <span>Asistencia</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroup>

        </SidebarContent>

        {/* ── Footer: idioma + usuario + logout ── */}
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex flex-col gap-2 px-1 py-1">

                {/* Language switcher */}
                <div className="flex gap-1 group-data-[collapsible=icon]:hidden">
                  {(["es", "en"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1 text-xs font-medium uppercase transition-colors",
                        lang === l
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent"
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {/* User row */}
                <div className="flex items-center gap-2">
                  <Avatar className="size-7 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
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
                    title={t("logout")}
                    onClick={async () => {
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

        {/* Rail for resize hint */}
        <SidebarRail />
      </Sidebar>

      {/* ── Main content ── */}
      <SidebarInset>
        <TopBar />
        <div className="flex flex-1 flex-col gap-4 p-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
