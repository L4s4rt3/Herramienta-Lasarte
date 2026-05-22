import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  LogOut,
  Citrus,
  Calculator,
  Droplet,
  Users,
  BarChart3,
  Sun,
  Moon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";
import { useTheme } from "@/contexts/ThemeProvider";
import { useI18n } from "@/lib/i18n";
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
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { TopBar } from "@/components/TopBar";

// ─── App Layout ────────────────────────────────────────────────────────────────
export default function AppLayout() {
  const { signOut, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

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

          {/* ── Producción ── */}
          <SidebarGroup>
            <SidebarGroupLabel>Producción</SidebarGroupLabel>
            <SidebarMenu>
              {/* Análisis diario */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/analisis/diario"}
                  tooltip="Análisis Diario"
                >
                  <NavLink to="/analisis/diario">
                    <BarChart3 />
                    <span>Análisis Diario</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          {/* ── Consumos y asistencia ── */}
          <SidebarGroup>
            <SidebarGroupLabel>Operaciones</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/costes/consumos"}
                  tooltip="Consumos"
                >
                  <NavLink to="/costes/consumos">
                    <Droplet />
                    <span>Consumos</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/costes/asistencia"}
                  tooltip="Asistencia"
                >
                  <NavLink to="/costes/asistencia">
                    <Users />
                    <span>Asistencia</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

        </SidebarContent>

        {/* ── Footer: idioma + usuario + logout ── */}
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex flex-col gap-2 px-1 py-1">

                {/* Language switcher + theme toggle */}
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
                  <button
                    onClick={toggleTheme}
                    className="flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium transition-colors text-sidebar-foreground/60 hover:bg-sidebar-accent"
                    title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
                  >
                    {theme === "dark" ? (
                      <Sun className="size-4" />
                    ) : (
                      <Moon className="size-4" />
                    )}
                  </button>
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
        <div className="flex flex-1 flex-col gap-4 p-4 animate-fadeIn">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
