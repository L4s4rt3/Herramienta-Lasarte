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
} from "lucide-react";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useVentasCategoriaAccess } from "@/hooks/useVentasCategoria";

const PAGES = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, keywords: "panel inicio dashboard" },
  { to: "/calidad", label: "Jornada de Calidad", icon: ClipboardCheck, keywords: "calidad lotes notas aerobotics finca productor" },
  { to: "/partes", label: "Partes diarios", icon: FileText, keywords: "partes produccion diario" },
  { to: "/analisis/diario", label: "Análisis diario", icon: BarChart3, keywords: "analisis diario lotes calibres" },
  { to: "/productores", label: "Productores", icon: Sprout, keywords: "productores proveedores origen" },
  { to: "/ventas/categoria-segunda", label: "Categoria segunda", icon: FileSpreadsheet, keywords: "ventas comercial categoria segunda clientes productos precios" },
  { to: "/costes/consumos", label: "Consumos", icon: Droplet, keywords: "consumos costes agua energia gasoil" },
  { to: "/costes/asistencia", label: "Asistencia", icon: Users, keywords: "asistencia trabajadores turnos" },
];

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
  const ventasCategoriaAccess = useVentasCategoriaAccess();
  const visiblePages = PAGES.filter((page) => (
    page.to !== "/ventas/categoria-segunda" || ventasCategoriaAccess.hasAccess
  ));

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
        {searchResults && searchResults.length > 0 && (
          <>
            <CommandGroup heading="Resultados">
              {searchResults.map((result) => {
                const Icon = result.type === "parte" ? FileText : Sprout;
                return (
                  <CommandItem
                    key={`${result.type}-${result.id}`}
                    onSelect={() => handleSelect(result.to)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{result.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {result.subtitle}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        {searchQuery && searchQuery.length >= 2 && (!searchResults || searchResults.length === 0) ? (
          <CommandEmpty>Sin resultados para "{searchQuery}".</CommandEmpty>
        ) : null}
        {(!searchQuery || searchQuery.length < 2) && (
          <><CommandGroup heading="Acciones rápidas">
          {ACTIONS.map((action) => (
            <CommandItem
              key={action.id}
              onSelect={() => handleSelect(action.to)}
            >
              <action.icon className="mr-2 h-4 w-4" />
              <span>{action.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
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
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return { open, setOpen };
}
