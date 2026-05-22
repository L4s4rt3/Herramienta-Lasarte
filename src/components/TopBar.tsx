import { NavLink, useLocation } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

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
  "/analisis/diario":        { label: "Análisis Diario", parent: "/", parentLabel: "Dashboard" },
  "/calendario":             { label: "Calendario", parent: "/", parentLabel: "Dashboard" },
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

export { TopBar, ROUTE_META };
