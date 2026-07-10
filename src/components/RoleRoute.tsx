// src/components/RoleRoute.tsx
// Guard de rol para el árbol de rutas protegidas: el rol "ventas" (Juanvi)
// solo debe poder llegar a su espacio comercial. Cualquier otra ruta lo manda
// a /comercial (el panel comercial, su dashboard). Admin y operario no están
// restringidos aquí (operario ya se filtra en la propia página/hook,
// p.ej. useVentasCategoriaAccess).
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthProvider";
import type { Role } from "@/contexts/AuthProvider";

export const VENTAS_HOME = "/comercial";
export const RRHH_HOME = "/rrhh";

export const VENTAS_ALLOWED_PATHS = [
  VENTAS_HOME,
  "/ventas/categoria-segunda",
  "/ventas/categoria-primera",
  "/comercial/mercadona",
  "/cmr",
] as const;

/** Home de cada rol: su dashboard. "/" redirige aquí (ver RoleHome). */
export function homeForRole(role: Role): string {
  switch (role) {
    case "admin":
      return "/direccion";
    case "ventas":
      return VENTAS_HOME;
    case "rrhh":
      return RRHH_HOME;
    default:
      // operario / rol básico: el panel de producción.
      return "/produccion";
  }
}

function isAllowedForVentas(pathname: string): boolean {
  return VENTAS_ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default function RoleRoute() {
  const { role, loading } = useAuth();
  const location = useLocation();

  // Mientras el rol todavía se está resolviendo, no redirigir en falso:
  // se espera (spinner) a saber si es "ventas" antes de decidir.
  if (loading || role === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (role === "ventas" && !isAllowedForVentas(location.pathname)) {
    return <Navigate to={VENTAS_HOME} replace />;
  }

  // Las secciones de RRHH (datos personales sensibles) solo para rrhh y admin.
  // La asistencia diaria (/costes/asistencia y su comparativa) pertenece a RRHH
  // desde jul 2026: los operarios ya no pasan lista. La RLS de la base ya
  // bloquea los datos sensibles; esto evita ademas pantallas de "acceso
  // restringido" a quien llegue por URL directa.
  const esRutaRrhh = location.pathname.startsWith("/rrhh") || location.pathname.startsWith("/costes/asistencia");
  if (esRutaRrhh && role !== "admin" && role !== "rrhh") {
    return <Navigate to="/" replace />;
  }

  // El rol rrhh vive SOLO en su espacio (Produccion es del rol basico): fuera
  // de sus rutas se le devuelve a su home, igual que al rol ventas.
  if (role === "rrhh" && !esRutaRrhh) {
    return <Navigate to={RRHH_HOME} replace />;
  }

  // El modo economico (precios, facturacion, margen) y el panel de direccion
  // son exclusivos de admins.
  if ((location.pathname.startsWith("/economico") || location.pathname.startsWith("/direccion")) && role !== "admin") {
    return <Navigate to="/" replace />;
  }

  // El espacio Comercial (Mercadona completa con facturacion, categorias,
  // Edeka, CMR) es de admin y ventas; operario/rrhh usan la Mercadona de
  // produccion (/mercadona, sin facturacion).
  const esRutaComercial =
    location.pathname.startsWith("/comercial") ||
    location.pathname.startsWith("/ventas") ||
    location.pathname.startsWith("/cmr");
  if (esRutaComercial && role !== "admin" && role !== "ventas") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

/**
 * Elemento de la ruta "/": la home de cada rol es su dashboard
 * (admin → dirección, ventas → comercial, rrhh → RRHH, operario → producción).
 * Los roles ventas/rrhh normalmente ya llegan redirigidos por RoleRoute antes
 * de montar esto; se cubren igualmente por si el guard cambia.
 */
export function RoleHome() {
  const { role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <Navigate to={homeForRole(role)} replace />;
}
