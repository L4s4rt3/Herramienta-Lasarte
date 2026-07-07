// src/components/RoleRoute.tsx
// Guard de rol para el árbol de rutas protegidas: el rol "ventas" (Juanvi)
// solo debe poder llegar a sus 5 secciones comerciales. Cualquier otra ruta
// (incluida "/") lo manda a /ventas/categoria-segunda, su home. Admin y
// operario no están restringidos aquí (operario ya se filtra en la propia
// página/hook, p.ej. useVentasCategoriaAccess).
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthProvider";

export const VENTAS_HOME = "/ventas/categoria-segunda";

export const VENTAS_ALLOWED_PATHS = [
  VENTAS_HOME,
  "/ventas/categoria-primera",
  "/mercadona",
  "/edeka",
  "/cmr",
] as const;

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
  // La RLS de la base ya bloquea los datos; esto evita ademas pantallas de
  // "acceso restringido" a quien llegue por URL directa.
  if (location.pathname.startsWith("/rrhh") && role !== "admin" && role !== "rrhh") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
