import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  FileText,
  ClipboardCheck,
  BarChart3,
  Sprout,
  Droplet,
  FileSpreadsheet,
  Users,
  Plus,
  Loader2,
  ShoppingCart,
  Truck,
  UserRound,
  CalendarOff,
  AlertTriangle,
  Plane,
  Banknote,
  Mail,
} from "lucide-react";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useAuth } from "@/contexts/AuthProvider";
import { useVentasCategoriaAccess } from "@/hooks/useVentasCategoria";

// Rutas del espacio Comercial: solo visibles para "ventas" y "admin".
const VENTAS_Y_ADMIN_ONLY = new Set(["/comercial", "/comercial/ventas-mes", "/ventas/categoria-primera", "/comercial/mercadona", "/cmr"]);

// Las 5 secciones que puede ver el rol "ventas" (ver RoleRoute.tsx). Para ese
// rol la paleta solo debe ofrecer estas, ni el resto de la operativa interna.
const VENTAS_ALLOWED = new Set([
  "/comercial",
  "/comercial/ventas-mes",
  "/ventas/categoria-segunda",
  "/ventas/categoria-primera",
  "/comercial/mercadona",
  "/cmr",
]);

const PAGES = [
  { to: "/produccion", label: "Panel de producción", icon: LayoutDashboard, keywords: "panel inicio dashboard produccion" },
  { to: "/calidad", label: "Jornada de Calidad", icon: ClipboardCheck, keywords: "calidad lotes notas aerobotics finca productor" },
  { to: "/partes", label: "Partes diarios", icon: FileText, keywords: "partes produccion diario" },
  { to: "/analisis/diario", label: "Análisis diario", icon: BarChart3, keywords: "analisis diario lotes calibres" },
  { to: "/productores", label: "Productores", icon: Sprout, keywords: "productores proveedores origen eficiencia" },
  { to: "/direccion", label: "Panel de dirección", icon: LayoutDashboard, keywords: "direccion jefe global resumen produccion comercial rrhh economico" },
  { to: "/comercial", label: "Panel comercial", icon: ShoppingCart, keywords: "comercial panel dashboard ventas resumen" },
  { to: "/mercadona", label: "Mercadona (planta)", icon: ShoppingCart, keywords: "mercadona produccion planta aprovechamiento cliente principal" },
  { to: "/comercial/mercadona", label: "Mercadona (ventas)", icon: ShoppingCart, keywords: "mercadona ventas comercial facturacion cliente principal" },
  { to: "/ventas/categoria-segunda", label: "Categoría segunda", icon: FileSpreadsheet, keywords: "ventas comercial categoria segunda clientes productos precios" },
  { to: "/ventas/categoria-primera", label: "Categoría primera", icon: FileSpreadsheet, keywords: "ventas comercial categoria primera clientes productos precios" },
  { to: "/cmr", label: "CMR y Hojas de ruta", icon: Truck, keywords: "cmr hojas de ruta transporte logistica" },
  { to: "/costes/consumos", label: "Consumos", icon: Droplet, keywords: "consumos costes agua energia gasoil" },
  { to: "/costes/asistencia", label: "Asistencia diaria (RRHH)", icon: Users, keywords: "rrhh asistencia pasar lista trabajadores turnos" },
  { to: "/rrhh", label: "Panel de RRHH", icon: UserRound, keywords: "rrhh panel dashboard resumen asistencia rendimiento comparativa" },
  { to: "/rrhh/personas", label: "Plantilla (RRHH)", icon: UserRound, keywords: "rrhh plantilla trabajadores fichas categoria antiguedad" },
  { to: "/rrhh/ausencias", label: "Ausencias y bajas (RRHH)", icon: CalendarOff, keywords: "rrhh ausencias faltas bajas justificantes" },
  { to: "/rrhh/amonestaciones", label: "Amonestaciones (RRHH)", icon: AlertTriangle, keywords: "rrhh amonestaciones sanciones documento firmado" },
  { to: "/rrhh/vacaciones", label: "Vacaciones y horas (RRHH)", icon: Plane, keywords: "rrhh vacaciones dias horas bolsa saldo" },
  { to: "/rrhh/nominas", label: "Nóminas (RRHH)", icon: Banknote, keywords: "rrhh nominas salario mensual" },
  { to: "/rrhh/comunicaciones", label: "Comunicaciones (RRHH)", icon: Mail, keywords: "rrhh comunicaciones correos emails avisos horas vacaciones" },
  { to: "/rrhh/mercadona", label: "Mercadona (facturas)", icon: ShoppingCart, keywords: "rrhh mercadona facturas precios kg" },
  { to: "/economico", label: "Panel económico", icon: Banknote, keywords: "economico euros facturacion costes margen admin" },
  { to: "/economico/facturacion", label: "Facturación (Económico)", icon: Banknote, keywords: "economico facturacion base iva mercadona euros" },
  { to: "/economico/costes", label: "Costes (Económico)", icon: Banknote, keywords: "economico costes consumos coste por kg euros" },
  { to: "/economico/precios", label: "Precios (Económico)", icon: Banknote, keywords: "economico precios tarifas agua luz gasoil" },
];

// Modo economico: exclusivo de admins.
const ECONOMICO_ADMIN_ONLY = new Set([
  "/direccion",
  "/economico",
  "/economico/facturacion",
  "/economico/costes",
  "/economico/precios",
]);

// Secciones de RRHH (datos personales): solo roles rrhh y admin. La
// asistencia diaria pertenece a RRHH desde jul 2026.
const RRHH_Y_ADMIN_ONLY = new Set([
  "/rrhh",
  "/costes/asistencia",
  "/rrhh/personas",
  "/rrhh/ausencias",
  "/rrhh/amonestaciones",
  "/rrhh/vacaciones",
  "/rrhh/nominas",
  "/rrhh/comunicaciones",
  "/rrhh/mercadona",
]);

const ACTIONS = [
  { id: "nueva-calidad", label: "Crear notas de calidad", icon: ClipboardCheck, to: "/calidad" },
  { id: "nuevo-parte", label: "Crear nuevo parte", icon: Plus, to: "/partes" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: searchResults, isLoading } = useGlobalSearch(searchQuery);
  const { role } = useAuth();
  const ventasCategoriaAccess = useVentasCategoriaAccess();
  const isVentas = role === "ventas";
  // El rol rrhh vive solo en su espacio (igual que ventas en el suyo).
  const isRrhh = role === "rrhh";
  const visiblePages = PAGES.filter((page) => {
    // El rol "ventas" solo debe ver sus 5 secciones comerciales en la paleta.
    if (isVentas) return VENTAS_ALLOWED.has(page.to);
    if (isRrhh) return RRHH_Y_ADMIN_ONLY.has(page.to);
    if (page.to === "/ventas/categoria-segunda") return ventasCategoriaAccess.hasAccess;
    // Categoria primera, Edeka y CMR son solo para admin y ventas.
    if (VENTAS_Y_ADMIN_ONLY.has(page.to)) return role === "admin";
    // El caso rrhh ya retorno arriba; aqui solo puede quedar admin/operario.
    if (RRHH_Y_ADMIN_ONLY.has(page.to)) return role === "admin";
    if (ECONOMICO_ADMIN_ONLY.has(page.to)) return role === "admin";
    return true;
  });
  // "Crear notas de calidad" / "Crear nuevo parte" llevan a secciones fuera
  // del alcance de "ventas" y "rrhh" (/calidad, /partes): no se ofrecen ahí.
  const visibleActions = isVentas || isRrhh ? [] : ACTIONS;
  // Los resultados de búsqueda global (partes, productores) también quedan
  // fuera del alcance de esos roles; se ocultan en vez de filtrar
  // useGlobalSearch (hook fuera de alcance) para no tocar su firma/consultas.
  const visibleSearchResults = isVentas || isRrhh ? [] : searchResults;

  const handleSelect = useCallback(
    (to: string) => {
      onOpenChange(false);
      setSearchQuery("");
      navigate(to);
    },
    [navigate, onOpenChange]
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar páginas, acciones..." value={searchQuery} onValueChange={setSearchQuery} />
      <CommandList>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Buscando...
          </div>
        ) : null}
        {visibleSearchResults && visibleSearchResults.length > 0 && (
          <>
            <CommandGroup heading="Resultados">
              {visibleSearchResults.map((result) => {
                const Icon = result.type === "parte" ? FileText : Sprout;
                return (
                  <CommandItem
                    key={`${result.type}-${result.id}`}
                    className="flex-wrap gap-x-2 gap-y-1"
                    onSelect={() => handleSelect(result.to)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{result.label}</span>
                    <span className="w-full truncate pl-6 text-xs text-muted-foreground sm:ml-auto sm:w-auto sm:pl-0">
                      {result.subtitle}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        {searchQuery && searchQuery.length >= 2 && (!visibleSearchResults || visibleSearchResults.length === 0) ? (
          <CommandEmpty>Sin resultados para "{searchQuery}".</CommandEmpty>
        ) : null}
        {(!searchQuery || searchQuery.length < 2) && (
          <>{visibleActions.length > 0 && (
          <><CommandGroup heading="Acciones rápidas">
          {visibleActions.map((action) => (
            <CommandItem
              key={action.id}
              onSelect={() => handleSelect(action.to)}
            >
              <action.icon className="mr-2 h-4 w-4" />
              <span>{action.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator /></>
        )}
        <CommandGroup heading="Navegación">
          {visiblePages.map((page) => (
            <CommandItem
              key={page.to}
              onSelect={() => handleSelect(page.to)}
              keywords={page.keywords.split(" ")}
            >
              <page.icon className="mr-2 h-4 w-4" />
              <span>{page.label}</span>
            </CommandItem>
          ))}
          </CommandGroup></>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    // El botón "Buscar" del TopBar abre la paleta con este evento.
    const openFromButton = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener("lasarte:open-search", openFromButton);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("lasarte:open-search", openFromButton);
    };
  }, []);

  return { open, setOpen };
}
