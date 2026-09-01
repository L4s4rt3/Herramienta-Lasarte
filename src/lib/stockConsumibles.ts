// Stock de consumibles: tipos y derivados puros del módulo /consumibles.
// El inventario vive en la tabla stock_consumibles (ver la migración
// 20260901120000_stock_consumibles.sql): esta capa no guarda estados, solo
// deriva (valor = stock × precio, familias ordenadas, avisos pendientes).
import type { Tables } from "@/integrations/supabase/types";

export type StockConsumible = Tables<"stock_consumibles">;
export type StockConsumibleHistorial = Tables<"stock_consumibles_historial">;

/** Orden de familias tal y como venía la plantilla del conteo (el Excel). */
export const FAMILIAS_ORDEN = [
  "Alveolos",
  "Asa",
  "Bandas",
  "Envase",
  "Camisa",
  "Cantonera",
  "Corbata",
  "Etiqueta C2C",
  "Cubres",
  "Etiquetas",
  "Fleje",
  "Gas",
  "Gasoil",
  "Grapas",
  "Malla",
  "Palet",
  "Papel Seda",
  "Post cosecha",
  "Stiker",
  "VIRUTA",
] as const;

export function ordenFamilia(familia: string): number {
  const idx = (FAMILIAS_ORDEN as readonly string[]).indexOf(familia);
  return idx === -1 ? FAMILIAS_ORDEN.length : idx;
}

const formatoStock = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
const formatoEuros = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatStock(n: number): string {
  return formatoStock.format(n);
}

export function formatEuros(n: number): string {
  return `${formatoEuros.format(n)} €`;
}

/** Valor del artículo en €, o null si no tiene precio registrado. */
export function valorItem(item: Pick<StockConsumible, "stock" | "precio_unitario">): number | null {
  if (item.precio_unitario === null || item.precio_unitario === undefined) return null;
  return item.stock * Number(item.precio_unitario);
}

/** Artículos con algo por confirmar del conteo (nota PENDIENTE/CONFIRMAR/Sin contar). */
export function esPendiente(item: Pick<StockConsumible, "nota">): boolean {
  const nota = item.nota ?? "";
  return nota.includes("PENDIENTE") || nota.includes("CONFIRMAR") || nota.startsWith("Sin contar");
}

/** Búsqueda sin tildes ni mayúsculas ("carton" encuentra "Cartón"). */
export function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
