/**
 * trazabilidadSelector.ts — lógica pura del selector de lotes de Trazabilidad
 * (rediseño 21-jul-2026: encontrar un lote era "un infierno" — tarjetas sin
 * orden útil ni filtros). El selector pasa a ser una tabla ordenable con
 * filtros de texto, estado y variedad; esta lib concentra el filtrado y la
 * ordenación para poder testearlos sin UI.
 */
import type { StockLoteRow } from "@/lib/entradasBascula";
import { normalizarTexto } from "@/lib/format";

export type EstadoFiltroLotes = "todos" | "camara" | "procesados";

export type LoteSortKey =
  | "lote"
  | "fecha_entrada"
  | "finca"
  | "articulo"
  | "kg_entrada"
  | "pct_procesado"
  | "kg_en_camara"
  | "dias_en_camara"
  | "pct_industria";

export interface FiltrosSelectorLotes {
  /** Texto libre: casa contra lote, finca, variedad, agricultor y notas del operario (normalizado sin acentos). */
  texto: string;
  estado: EstadoFiltroLotes;
  /** Variedad exacta (articulo) o "" = todas. */
  variedad: string;
}

/**
 * ¿La nota de lotes_dia la escribió el OPERARIO? Los imports históricos y las
 * reparaciones siembran notas boilerplate ("Import histórico de campaña",
 * "Procesado reconstruido desde Informe LOTE…") que serían puro ruido en la
 * búsqueda y en la ficha — se excluyen por prefijo.
 */
export function esNotaOperarioLote(nota: string | null | undefined): boolean {
  const texto = String(nota ?? "").trim();
  if (!texto) return false;
  return !/^(import histórico|import historico|histórico de campaña|historico de campaña|procesado reconstruido)/i.test(texto);
}

/** Variedades (articulo) distintas presentes en el stock, ordenadas alfabéticamente — opciones del filtro. */
export function variedadesDisponibles(filas: StockLoteRow[]): string[] {
  const set = new Set<string>();
  for (const f of filas) {
    if (f.articulo && f.articulo.trim()) set.add(f.articulo.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function filtrarLotesSelector(
  filas: StockLoteRow[],
  filtros: FiltrosSelectorLotes,
  /** Notas del operario por lote (concatenadas): permite buscar por síntoma ("densidad", "podrido") además de por lote/finca/variedad/agricultor. */
  notasPorLote?: Map<string, string>,
): StockLoteRow[] {
  const texto = normalizarTexto(filtros.texto).trim();
  return filas.filter((f) => {
    if (filtros.estado === "camara" && f.estado === "procesado") return false;
    if (filtros.estado === "procesados" && f.estado !== "procesado") return false;
    if (filtros.variedad && (f.articulo ?? "").trim() !== filtros.variedad) return false;
    if (!texto) return true;
    return (
      normalizarTexto(f.lote).includes(texto)
      || normalizarTexto(f.finca).includes(texto)
      || normalizarTexto(f.articulo).includes(texto)
      || normalizarTexto(f.agricultor).includes(texto)
      || normalizarTexto(notasPorLote?.get(f.lote) ?? "").includes(texto)
    );
  });
}

function pctProcesado(f: StockLoteRow): number {
  return f.kg_entrada > 0 ? f.kg_procesado / f.kg_entrada : 0;
}

/** Ordena SIN mutar. Empates: fecha de entrada desc y lote asc, para que el orden sea estable y predecible. */
export function ordenarLotesSelector(
  filas: StockLoteRow[],
  sortKey: LoteSortKey,
  dir: "asc" | "desc",
  /** % industria por lote (0..1) — solo necesario para sortKey "pct_industria"; sin dato = 0. */
  pctIndustriaPorLote?: Map<string, number>,
): StockLoteRow[] {
  const factor = dir === "asc" ? 1 : -1;
  const valor = (f: StockLoteRow): string | number => {
    switch (sortKey) {
      case "lote": return f.lote;
      case "fecha_entrada": return f.fecha_entrada;
      case "finca": return normalizarTexto(f.finca);
      case "articulo": return normalizarTexto(f.articulo);
      case "kg_entrada": return f.kg_entrada;
      case "pct_procesado": return pctProcesado(f);
      case "kg_en_camara": return f.kg_en_camara;
      case "dias_en_camara": return f.dias_en_camara;
      case "pct_industria": return pctIndustriaPorLote?.get(f.lote) ?? 0;
    }
  };
  return [...filas].sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    const cmp = typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb));
    return (cmp * factor)
      || b.fecha_entrada.localeCompare(a.fecha_entrada)
      || a.lote.localeCompare(b.lote);
  });
}

/** "2026-07-10" → "2026-07-09"/"2026-07-11" (delta en días, para navegar ← →). */
export function desplazarFecha(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + dias));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
