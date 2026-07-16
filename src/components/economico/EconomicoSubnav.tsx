// src/components/economico/EconomicoSubnav.tsx
// Mini-nav de las 5 páginas de "Económico" (FASE 3 del rediseño, auditoría de
// conexiones): pastillas de acceso cruzado Panel↔Facturación↔Costes↔Compra de
// fruta↔Precios, para que cada página enlace a las demás sin tener que volver
// primero a la portada. No sustituye a los accesos rápidos/enlaces contextuales
// ya existentes (p.ej. las tarjetas de EconomicoPanel o los avisos de "faltan
// tarifas" que enlazan a Precios): es un complemento compacto, siempre visible.
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const ECONOMICO_LINKS = [
  { to: "/economico", label: "Panel" },
  { to: "/economico/facturacion", label: "Facturación" },
  { to: "/economico/costes", label: "Costes" },
  { to: "/economico/fruta", label: "Compra de fruta" },
  { to: "/economico/precios", label: "Precios" },
] as const;

export function EconomicoSubnav() {
  const { pathname } = useLocation();

  return (
    <nav className="flex flex-wrap items-center gap-1.5" aria-label="Navegación de Económico">
      {ECONOMICO_LINKS.map(({ to, label }) => {
        const active = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-seccion/40 bg-seccion/10 text-seccion-texto"
                : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground hover:bg-[var(--glass-bg-strong)] hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
