/**
 * exportInformeProductoresFincas — Excel con marca LASARTE (exportKit) del
 * informe "Entradas por productor y finca" (ver informeProductoresFincas.ts):
 *
 *   - Hoja "Productores": una fila por productor con sus totales.
 *   - Hoja "Por finca": una fila por par productor-finca (filtrable por
 *     productor con el autofiltro — el desglose productor → fincas que pide
 *     el listado del ERP, en formato tabla plana ordenada).
 *   - Hoja "Detalle": una fila por entrada de báscula del periodo.
 */
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_INT,
  FMT_KG,
  FMT_PCT,
  type ColumnaTabla,
} from "./exportKit";
import { buildLasarteFilename } from "./reportKit";
import { formatDate } from "./format";
import type { InformeProductoresFincas } from "./informeProductoresFincas";

export interface DetalleEntradaExport {
  fecha: string;
  lote: string;
  productor: string;
  finca: string | null;
  parcela: string | null;
  articulo: string | null;
  envases: number | null;
  kg: number;
}

// Fecha "YYYY-MM-DD" anclada al mediodía local (evita el desplazamiento de
// zona horaria de `new Date("YYYY-MM-DD")`, que en España cae en UTC
// medianoche). Mismo helper local que exportConsumo.ts.
function parseFechaISO(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return null;
}

function pct(parte: number, total: number): number {
  return total > 0 ? +((parte / total) * 100).toFixed(2) : 0;
}

export async function exportInformeProductoresFincasExcel(opts: {
  informe: InformeProductoresFincas;
  detalle: DetalleEntradaExport[];
  desde: string;
  hasta: string;
  usuario?: string;
}): Promise<void> {
  const { informe, detalle, desde, hasta, usuario } = opts;

  const ctx = crearLibroLasarte({
    titulo: "Entradas por productor y finca",
    periodo: `${formatDate(desde)} - ${formatDate(hasta)}`,
    usuario,
    clasificacion: "Interno",
  });

  // ─── Hoja 1: totales por productor ────────────────────────────────────────
  const productoresColumnas: ColumnaTabla[] = [
    { header: "Productor", key: "productor", width: 46 },
    { header: "Nº fincas", key: "nFincas", tipo: "numero", width: 11 },
    { header: "Nº entradas", key: "nEntradas", tipo: "numero", width: 12 },
    { header: "Envases", key: "envases", tipo: "numero", width: 11 },
    { header: "Kilos entrada", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 17 },
    { header: "% s/ total", key: "pctTotal", tipo: "numero", numFmt: FMT_PCT, width: 11 },
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "Productores",
    titulo: "Totales por productor",
    columnas: productoresColumnas,
    filas: informe.productores.map((p) => ({
      productor: p.nombre,
      nFincas: p.fincas.length,
      nEntradas: p.nEntradas,
      envases: p.envases,
      kg: p.kg,
      pctTotal: pct(p.kg, informe.totalKg),
    })),
    totales: {
      productor: `TOTAL (${informe.productores.length} productores)`,
      nFincas: informe.nFincas,
      nEntradas: informe.totalEntradas,
      envases: informe.totalEnvases,
      kg: informe.totalKg,
      pctTotal: informe.totalKg > 0 ? 100 : 0,
    },
  });

  // ─── Hoja 2: desglose productor → finca (una fila por par) ────────────────
  const fincasColumnas: ColumnaTabla[] = [
    { header: "Productor", key: "productor", width: 46 },
    { header: "Finca", key: "finca", width: 30 },
    { header: "Nº entradas", key: "nEntradas", tipo: "numero", width: 12 },
    { header: "Envases", key: "envases", tipo: "numero", width: 11 },
    { header: "Kilos entrada", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 17 },
    { header: "% s/ productor", key: "pctProductor", tipo: "numero", numFmt: FMT_PCT, width: 14 },
    { header: "Última entrada", key: "ultimaFecha", tipo: "fecha", width: 15 },
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "Por finca",
    titulo: "Fincas de cada productor",
    columnas: fincasColumnas,
    filas: informe.productores.flatMap((p) =>
      p.fincas.map((f) => ({
        productor: p.nombre,
        finca: f.finca,
        nEntradas: f.nEntradas,
        envases: f.envases,
        kg: f.kg,
        pctProductor: pct(f.kg, p.kg),
        ultimaFecha: parseFechaISO(f.ultimaFecha),
      })),
    ),
    totales: {
      productor: "TOTAL",
      finca: `${informe.nFincas} fincas`,
      nEntradas: informe.totalEntradas,
      envases: informe.totalEnvases,
      kg: informe.totalKg,
    },
  });

  // ─── Hoja 3: detalle de entradas ──────────────────────────────────────────
  const detalleColumnas: ColumnaTabla[] = [
    { header: "Fecha", key: "fecha", tipo: "fecha", width: 12 },
    { header: "Lote", key: "lote", width: 12 },
    { header: "Productor", key: "productor", width: 46 },
    { header: "Finca", key: "finca", width: 26 },
    { header: "Parcela", key: "parcela", width: 26 },
    { header: "Artículo", key: "articulo", width: 24 },
    { header: "Envases", key: "envases", tipo: "numero", numFmt: FMT_INT, width: 10 },
    { header: "Kilos entrada", key: "kg", tipo: "numero", numFmt: FMT_KG, width: 16 },
  ];
  añadirHojaTabla(ctx, {
    nombreHoja: "Detalle",
    titulo: "Detalle de entradas del periodo",
    columnas: detalleColumnas,
    filas: detalle.map((d) => ({
      fecha: parseFechaISO(d.fecha),
      lote: d.lote,
      productor: d.productor,
      finca: d.finca ?? "",
      parcela: d.parcela ?? "",
      articulo: d.articulo ?? "",
      envases: d.envases ?? 0,
      kg: d.kg,
    })),
    totales: {
      productor: `TOTAL (${detalle.length} entradas)`,
      envases: informe.totalEnvases,
      kg: informe.totalKg,
    },
  });

  await descargarLibro(ctx, buildLasarteFilename("Entradas_por_productor", "xlsx", { from: desde, to: hasta }));
}
