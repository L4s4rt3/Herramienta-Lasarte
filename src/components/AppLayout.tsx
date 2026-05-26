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
  Sprout,
  Sun,
  Moon,
  CalendarDays,
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

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  match?: (path: string) => boolean;
};

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Control",
    items: [
      { to: "/", label: "Control de producción", icon: LayoutDashboard, match: (path) => path === "/" },
      { to: "/calendario", label: "Calendario", icon: CalendarDays },
      { to: "/partes", label: "Partes diarios", icon: FileText, match: (path) => path.startsWith("/partes") },
      { to: "/dsj", label: "Calculadora DJPMN", icon: Calculator },
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
    label: "Operaciones",
    items: [
      { to: "/costes/consumos", label: "Consumos", icon: Droplet },
      { to: "/costes/asistencia", label: "Asistencia", icon: Users },
    ],
  },
];

export default function AppLayout() {
  const { signOut, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild className="h-14">
                <NavLink to="/">
                  <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-orange-950/25">
                    <Citrus className="size-5" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold text-sidebar-foreground">{t("app_name")}</span>
                    <span className="truncate text-xs text-sidebar-foreground/55">Control de producción</span>
                  </div>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {navGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.match
                    ? item.match(location.pathname)
                    : location.pathname === item.to;

                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <NavLink to={item.to} end={item.to === "/"}>
                          <Icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex flex-col gap-3 px-1 py-1">
                <div className="flex gap-1 rounded-lg bg-sidebar-accent/55 p-1 group-data-[collapsible=icon]:hidden">
                  {(["es", "en"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold uppercase transition-colors",
                        lang === l
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/80"
                      )}
                    >
                      {l}
                    </button>
                  ))}
                  <button
                    onClick={toggleTheme}
                    className="flex items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/80"
                    title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
                  >
                    {theme === "dark" ? (
                      <Sun className="size-4" />
                    ) : (
                      <Moon className="size-4" />
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2 rounded-lg border border-sidebar-border/65 bg-sidebar-accent/35 p-2">
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

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <TopBar />
        <div className="flex flex-1 flex-col px-4 py-5 animate-fadeIn sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
