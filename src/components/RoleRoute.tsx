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
  // Rutas absorbidas por el rediseño 13-08-2026: siguen aquí porque redirigen
  // a su pestaña y el rol tiene que poder ATRAVESARLAS. Si se quitan, un
  // enlace guardado a /ventas/categoria-primera manda a "ventas" a su home en
  // vez de a la pestaña que pedía.
  "/ventas/categoria-primera",
  "/comercial/mercadona",
  "/comercial/ventas-mes",
  "/cmr",
  "/mapa",
] as const;

// Rutas reservadas al admin. Espejo de los items adminOnly de NAV_GROUPS
// (src/lib/workspaces.ts) más las rutas de la sección Datos, que no cuelgan de
// un prefijo común.
// "/costes/consumos" y "/historico" ya no son páginas: redirigen a su pestaña
// dentro de /economico/costes y /importar. Se quedan listadas para que un
// enlace viejo de un operario siga topando con el mismo muro que antes, en vez
// de colarse por la redirección.
export const ADMIN_ONLY_PATHS = [
  "/costes/consumos",
  "/limpieza",
  "/historico",
  "/importar",
  "/datos",
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

  // El rol rrhh vive SOLO en su espacio (Planta es del rol basico): fuera de
  // sus rutas se le devuelve a su home, igual que al rol ventas. El mapa de la
  // herramienta es de todos los roles.
  //
  // Mercadona es la excepcion desde el rediseño 13-08-2026: /rrhh/mercadona y
  // /comercial/mercadona servian el MISMO componente en dos URLs, y al fundirse
  // en /comercial/mercadona rrhh se habria quedado sin una pagina que SI tenia.
  // La variante completa (kg, facturas y precios) es justo la que rrhh usaba.
  const esMercadona = location.pathname.startsWith("/comercial/mercadona")
    || location.pathname.startsWith("/rrhh/mercadona");
  if (role === "rrhh" && !esRutaRrhh && !esMercadona && location.pathname !== "/mapa") {
    return <Navigate to={RRHH_HOME} replace />;
  }

  // Consumos, limpieza de box e importar histórico: solo admin. Prefijo con
  // "/" para no arrastrar rutas hermanas (p.ej. /costes/asistencia no cae
  // bajo /costes/consumos).
  const esRutaSoloAdmin = ADMIN_ONLY_PATHS.some(
    (p) => location.pathname === p || location.pathname.startsWith(p + "/"),
  );
  if (esRutaSoloAdmin && role !== "admin") {
    return <Navigate to="/" replace />;
  }

  // Las paginas economicas (precios, facturacion, margen) y el panel de
  // direccion son exclusivos de admins. Desde jul 2026 "economico" ya no es
  // un workspace propio (vive dentro de Direccion en src/lib/workspaces.ts),
  // pero este gate sigue siendo por prefijo de ruta y no depende de eso.
  if ((location.pathname.startsWith("/economico") || location.pathname.startsWith("/direccion")) && role !== "admin") {
    return <Navigate to="/" replace />;
  }

  // El espacio Comercial (categorias, CMR, panel) es de admin y ventas; el
  // operario usa la Mercadona de planta (/mercadona, sin facturacion).
  //
  // Mercadona queda FUERA de este muro para el rol rrhh: al fundirse las tres
  // rutas en una, /comercial/mercadona es la unica puerta a la variante
  // completa (kg, facturas y precios) que rrhh ya tenia en /rrhh/mercadona.
  // Sin esta excepcion, la fusion le habria quitado una pagina en silencio.
  const esRutaComercial =
    location.pathname.startsWith("/comercial") ||
    location.pathname.startsWith("/ventas") ||
    location.pathname.startsWith("/cmr");
  // Se dice quién PUEDE, no quién no: con la excepción metida en la condición
  // de la ruta, el operario se colaba también en la Mercadona con euros.
  const puedeComercial =
    role === "admin" || role === "ventas" || (role === "rrhh" && esMercadona);
  if (esRutaComercial && !puedeComercial) {
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
