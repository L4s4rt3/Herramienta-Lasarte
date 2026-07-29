/**
 * TablaLotesStock — tabla de lotes de stock COMPARTIDA (reordenación de
 * secciones 2026-07-28, pieza 3 de 4): antes vivía implementada dos veces,
 * como tabla de GESTIÓN en Entradas (con Estado y acciones cerrar/reabrir/
 * borrar) y como SELECTOR en Trazabilidad (con % Ind. e iconos de nota).
 *
 * Diseño: este componente es la MAQUINARIA única (cabecera ordenable
 * pegajosa, zebra, fila clicable con id/resaltado) y recibe las columnas
 * como especificación (`ColumnaLotes[]`). Las 4 columnas que son idénticas
 * en ambos usos (Entrada · Finca · Variedad · Kg entrada) se construyen con
 * `columnasComunesLotes(variante)` — una sola definición, con la variante
 * visual exacta de cada página ("gestion" = filas con padding normal,
 * "selector" = filas compactas py-2). El resto de columnas (Lote, Procesado,
 * En cámara, Días, Estado, Acciones, % Ind.) SIGUEN definidas en su página:
 * difieren de verdad (kg vs %, semáforo de días vs texto plano…) y forzarlas
 * aquí sería una API de banderas peor que la duplicación que sustituye.
 *
 * Regla de fidelidad: cero cambios visibles — las clases de celda de cada
 * variante son las que tenía cada página, copiadas literalmente.
 */
import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead, type SortDir } from "@/components/SortableColumn";
import { cn } from "@/lib/utils";
import { formatDate, formatKgCompact as formatKg } from "@/lib/format";
import type { StockLoteRow } from "@/lib/entradasBascula";

export interface ColumnaLotes<SK extends string> {
  /** Identificador estable de la columna (key de React). */
  id: string;
  label: string;
  /** Clave de ordenación; sin ella la cabecera es un TableHead plano (p. ej. "Acciones"). */
  sk?: SK;
  right?: boolean;
  /** Tooltip de la cabecera (InfoTooltip de SortableTableHead). */
  info?: string;
  headClassName?: string;
  /** Contenido de la celda. */
  render: (fila: StockLoteRow, index: number) => ReactNode;
  /** Clases del <td>: string fija o dependiente de la fila (p. ej. semáforo de días). */
  cellClassName?: string | ((fila: StockLoteRow) => string);
}

interface TablaLotesStockProps<SK extends string> {
  filas: StockLoteRow[];
  columnas: Array<ColumnaLotes<SK>>;
  sortKey: SK;
  sortDir: SortDir;
  onToggleSort: (k: SK) => void;
  onRowClick?: (fila: StockLoteRow) => void;
  /** id del <tr> (para scroll/resaltado por ?lote= en Entradas). */
  rowId?: (fila: StockLoteRow) => string | undefined;
  /** Clases extra del <tr> además de la zebra compartida (hover, resaltado, tamaño de texto). */
  rowClassName?: (fila: StockLoteRow, index: number) => string | undefined;
  /** Clases de la fila de cabecera (el selector de Trazabilidad usa text-xs). */
  headerRowClassName?: string;
}

export function TablaLotesStock<SK extends string>({
  filas, columnas, sortKey, sortDir, onToggleSort, onRowClick, rowId, rowClassName, headerRowClassName,
}: TablaLotesStockProps<SK>) {
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-[var(--glass-bg-solid)] backdrop-blur-xl">
        <TableRow className={headerRowClassName}>
          {columnas.map((c) => c.sk ? (
            <SortableTableHead
              key={c.id}
              label={c.label}
              sk={c.sk}
              right={c.right}
              info={c.info}
              className={c.headClassName}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            />
          ) : (
            <TableHead key={c.id} className={cn(c.right && "text-right", c.headClassName)}>{c.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {filas.map((fila, i) => (
          <TableRow
            key={fila.lote}
            id={rowId?.(fila)}
            onClick={onRowClick ? () => onRowClick(fila) : undefined}
            className={cn(
              onRowClick && "cursor-pointer",
              i % 2 === 1 && "bg-[var(--glass-bg)]/40",
              rowClassName?.(fila, i),
            )}
          >
            {columnas.map((c) => (
              <TableCell
                key={c.id}
                className={typeof c.cellClassName === "function" ? c.cellClassName(fila) : c.cellClassName}
              >
                {c.render(fila, i)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Las 4 columnas idénticas en ambos usos, con la variante visual EXACTA que
 * tenía cada página: "gestion" (Entradas, padding normal, kg en negrita) y
 * "selector" (Trazabilidad, filas compactas py-2).
 */
export function columnasComunesLotes<SK extends string>(variante: "gestion" | "selector"): Array<ColumnaLotes<SK>> {
  const compacta = variante === "selector";
  return [
    {
      id: "entrada",
      label: "Entrada",
      sk: "fecha_entrada" as SK,
      render: (f) => formatDate(f.fecha_entrada),
      cellClassName: compacta
        ? "whitespace-nowrap py-2 tabular-nums text-muted-foreground"
        : "whitespace-nowrap text-muted-foreground",
    },
    {
      id: "finca",
      label: "Finca",
      sk: "finca" as SK,
      render: (f) => f.finca ?? "—",
      cellClassName: compacta ? "max-w-44 truncate py-2" : "max-w-[180px] truncate",
    },
    {
      id: "variedad",
      label: "Variedad",
      sk: "articulo" as SK,
      render: (f) => f.articulo ?? "—",
      cellClassName: compacta
        ? "max-w-44 truncate py-2 text-xs text-muted-foreground"
        : "max-w-[160px] truncate text-muted-foreground",
    },
    {
      id: "kg_entrada",
      label: "Kg entrada",
      sk: "kg_entrada" as SK,
      right: true,
      render: (f) => formatKg(f.kg_entrada),
      cellClassName: compacta ? "py-2 text-right tabular-nums" : "text-right tabular-nums font-medium",
    },
  ];
}
