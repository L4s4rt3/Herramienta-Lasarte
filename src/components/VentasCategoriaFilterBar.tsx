import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import type { VentasCategoriaFilterOptions } from "@/lib/ventasCategoria";

const ALL_FILTER_VALUE = "__all__";

interface FilterValues {
  campana: string;
  mes: string;
  cliente: string;
  metodo: string;
  articulo: string;
}

interface VentasCategoriaFilterBarProps {
  filters: FilterValues;
  filterOptions: VentasCategoriaFilterOptions;
  onChange: (key: keyof FilterValues, value: string) => void;
  onClear: () => void;
  activeCount: number;
}

export function VentasCategoriaFilterBar({ filters, filterOptions, onChange, onClear, activeCount }: VentasCategoriaFilterBarProps) {
  return (
    <div className="section-toolbar flex-col items-stretch">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Filtros</h2>
          <p className="text-xs text-muted-foreground">
            {activeCount > 0
              ? `${activeCount} filtro${activeCount === 1 ? "" : "s"} activo${activeCount === 1 ? "" : "s"}`
              : "Sin filtros — mostrando todos los datos"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="min-h-9 gap-1.5 self-start md:min-h-0 md:self-auto" disabled={activeCount === 0} onClick={onClear}>
          <X className="h-3.5 w-3.5" />
          Limpiar
        </Button>
      </div>
      <div className="mt-3 grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campana</Label>
          <Select value={filters.campana || ALL_FILTER_VALUE} onValueChange={(v) => onChange("campana", v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger className="min-h-10"><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>Todas</SelectItem>
              {filterOptions.campanas.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mes</Label>
          <Select value={filters.mes || ALL_FILTER_VALUE} onValueChange={(v) => onChange("mes", v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger className="min-h-10"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
              {filterOptions.meses.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cliente</Label>
          <Select value={filters.cliente || ALL_FILTER_VALUE} onValueChange={(v) => onChange("cliente", v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger className="min-h-10"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
              {filterOptions.clientes.map((c) => (
                <SelectItem key={c.codigo} value={c.codigo}>{c.nombre} - {c.codigo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Producto</Label>
          <Select value={filters.metodo || ALL_FILTER_VALUE} onValueChange={(v) => onChange("metodo", v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger className="min-h-10"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
              {filterOptions.metodos.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Artículo</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="min-h-10 pl-8"
              value={filters.articulo}
              onChange={(e) => onChange("articulo", e.target.value)}
              placeholder="Buscar texto..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
