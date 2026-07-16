// SortableColumn — patrón ColHead/SortIcon de cabecera de tabla ordenable.
// ColHead (th plano) lo usan PartesList.tsx y Productores.tsx (tabla del
// ranking); cada página mantiene su propio toggleSort local que llama al
// helper compartido con el defaultDir que le corresponde (ver más abajo),
// porque el orden inicial al cambiar de columna no es igual en ambas páginas.
// SortableTableHead (envuelve TableHead de shadcn) lo usa EntradasBascula.tsx,
// que también reutiliza toggleSort tal cual (con su defaultDir por defecto).
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { InfoTooltip } from "@/components/InfoTooltip";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

export function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ChevronUp className="h-3 w-3 text-primary" />
    : <ChevronDown className="h-3 w-3 text-primary" />;
}

export function ColHead<K extends string>({ label, sk, right, sortKey, sortDir, onToggle, info, className }: {
  label: string;
  sk: K;
  right?: boolean;
  sortKey: K;
  sortDir: SortDir;
  onToggle: (k: K) => void;
  info?: string;
  /** Clases extra para el <th> (p.ej. densidad de padding/tipografía propia de una tabla que no usa `.data-table`). */
  className?: string;
}) {
  return (
    <th
      className={cn(
        "cursor-pointer select-none whitespace-nowrap transition-colors hover:text-foreground",
        right && "text-right",
        className,
      )}
      onClick={() => onToggle(sk)}
    >
      <span className={cn("inline-flex items-center gap-1", right && "flex-row-reverse")}>
        {label}<SortIcon active={sortKey === sk} dir={sortDir} />
        {info && <InfoTooltip iconClassName="h-3 w-3">{info}</InfoTooltip>}
      </span>
    </th>
  );
}

/** Igual que ColHead pero renderiza un TableHead de shadcn (para páginas que usan <Table>). */
export function SortableTableHead<K extends string>({ label, sk, right, sortKey, sortDir, onToggle, info, className }: {
  label: string;
  sk: K;
  right?: boolean;
  sortKey: K;
  sortDir: SortDir;
  onToggle: (k: K) => void;
  info?: string;
  className?: string;
}) {
  return (
    <TableHead
      className={cn(
        "cursor-pointer select-none whitespace-nowrap transition-colors hover:text-foreground",
        right && "text-right",
        className,
      )}
      onClick={() => onToggle(sk)}
    >
      <span className={cn("inline-flex items-center gap-1", right && "flex-row-reverse")}>
        {label}<SortIcon active={sortKey === sk} dir={sortDir} />
        {info && <InfoTooltip iconClassName="h-3 w-3">{info}</InfoTooltip>}
      </span>
    </TableHead>
  );
}

/**
 * Helper genérico para alternar sortKey/sortDir: mismo clic invierte dirección,
 * clic distinto reinicia a `defaultDir` (constante o función de la nueva key;
 * por defecto "asc", pero cada página puede querer otra cosa —p.ej. "desc" para
 * ordenar por cantidad de mayor a menor al cambiar de columna).
 */
export function toggleSort<K extends string>(
  k: K,
  current: K,
  dir: SortDir,
  setKey: (k: K) => void,
  setDir: (d: SortDir) => void,
  defaultDir: SortDir | ((k: K) => SortDir) = "asc",
) {
  if (k === current) {
    setDir(dir === "asc" ? "desc" : "asc");
  } else {
    setKey(k);
    setDir(typeof defaultDir === "function" ? defaultDir(k) : defaultDir);
  }
}
