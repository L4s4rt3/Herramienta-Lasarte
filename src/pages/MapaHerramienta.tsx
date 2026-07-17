// src/pages/MapaHerramienta.tsx
// Mapa de la herramienta: todas las secciones y páginas que el rol puede ver,
// cada una con su descripción (la misma que muestran las migas del TopBar).
// Pensado para orientarse: "¿dónde estaba X?" se responde aquí de un vistazo.
// Fuentes únicas: WORKSPACES + NAV_GROUPS (lib/workspaces) y ROUTE_META (TopBar).
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTE_META } from "@/components/TopBar";
import { useAuth } from "@/contexts/AuthProvider";
import { useVentasCategoriaAccess } from "@/hooks/useVentasCategoria";
import { useComunicacionesCampoAccess } from "@/hooks/useComunicacionesCampo";
import { preloadRoute } from "@/lib/routePreload";
import { NAV_GROUPS, WORKSPACES, WORKSPACE_DISPLAY_ORDER } from "@/lib/workspaces";

export default function MapaHerramienta() {
  const { role } = useAuth();
  const ventasCategoriaAccess = useVentasCategoriaAccess();
  const comunicacionesCampoAccess = useComunicacionesCampoAccess();

  const secciones = WORKSPACE_DISPLAY_ORDER
    .map((id) => WORKSPACES.find((w) => w.id === id))
    .filter((ws): ws is NonNullable<typeof ws> => Boolean(ws && ws.allowedFor(role)))
    .map((ws) => ({
      ws,
      items: NAV_GROUPS
        .filter((group) => group.workspace === ws.id)
        .flatMap((group) => group.items)
        .filter((item) => {
          if (item.adminOnly) return role === "admin";
          if (item.to === "/ventas/categoria-segunda") return ventasCategoriaAccess.hasAccess;
          if (item.to === "/campo/comunicaciones") return comunicacionesCampoAccess.hasAccess;
          return true;
        }),
    }))
    .filter(({ items }) => items.length > 0);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">Orientación</p>
          <h1 className="page-title">Mapa de la herramienta</h1>
          <p className="page-subtitle">
            Todas las secciones y páginas que puedes ver, con lo que encontrarás en cada una.
            También puedes buscar cualquier página con Ctrl+K.
          </p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {secciones.map(({ ws, items }) => {
          const WsIcon = ws.icon;
          return (
            <Card key={ws.id} className="glass-accented overflow-hidden">
              <CardContent className="p-0">
                <Link
                  to={ws.home}
                  onMouseEnter={() => preloadRoute(ws.home)}
                  className="flex items-center gap-3 border-b border-[var(--glass-border)] px-4 py-3 transition-colors hover:bg-[var(--glass-bg-strong)]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-primary">
                    <WsIcon className="h-[18px] w-[18px]" />
                  </div>
                  <span className="flex-1 text-base font-semibold">{ws.label}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    Abrir panel <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
                <ul className="divide-y divide-[var(--glass-border)]">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const subtitle = ROUTE_META[item.to]?.subtitle;
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          onMouseEnter={() => preloadRoute(item.to)}
                          onFocus={() => preloadRoute(item.to)}
                          className="group flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--glass-bg-strong)]"
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{item.label}</span>
                            {subtitle && (
                              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{subtitle}</span>
                            )}
                          </span>
                          <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-primary" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
