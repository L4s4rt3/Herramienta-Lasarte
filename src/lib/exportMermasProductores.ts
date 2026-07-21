/**
 * exportMermasProductores — el informe de decisión de agosto (pedido del
 * dueño, 21-jul-2026): % de podrido y mermas de cada LOTE → FINCA → PRODUCTOR
 * para decidir hacia dónde se dirige la empresa. Excel con marca LASARTE
 * (exportKit), 3 hojas:
 *
 *   - "Productores": una fila por productor (canónico) con kg entrada,
 *     procesado conciliado, merma natural, podrido total y % de cada uno.
 *   - "Por finca": lo mismo por par productor-finca (autofiltro).
 *   - "Detalle lotes": una fila por lote con todos los componentes y su
 *     FUENTE (podrido real de Informe LOTE vs prorrateo vs sin dato), % a
 *     industria y notas del operario.
 *
 * Los kg procesados vienen CONCILIADOS (src/lib/conciliacionKg.ts vía
 * useMermaLotes) y el podrido prefiere el dato REAL del Informe LOTE — la
 * cobertura de informes reales se refleja por grupo ("lotes con podrido
 * real") para saber cuánto del número es medido y cuánto estimado. Los lotes
 * sin merma calculable (parciales/pendientes) se cuentan aparte y sus kg NO
 * entran en los porcentajes: un hueco no es un 0.
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

export interface FilaMermaExport {
  productor: string;
  finca: string;
  articulo: string | null;
  lote: string;
  fechaEntrada: string;
  diasEnCamara: number | null;
  kgEntrada: number;
  /** kg procesados CONCILIADOS del lote. */
  kgCalibrador: number;
  /** null = lote sin merma calculable todavía (parcial/pendiente). */
  mermaNaturalKg: number | null;
  mermaNaturalEstimadaKg: number | null;
  podridoPreCalibradorKg: number | null;
  podridoCalibradorKg: number | null;
  /** "real" (Informe LOTE) | "prorrateo" | "desconocido". */
  podridoCalibradorFuente: string;
  podridoManualKg: number | null;
  /** 0..1 o null si sin dato. */
  pctIndustria: number | null;
  notas: string | null;
}

export interface GrupoMermaExport {
  productor: string;
  /** Solo en la agrupación por finca. */
  finca?: string;
  nLotes: number;
  /** Lotes cuyo mermaNaturalKg es null (parciales): fuera de los %. */
  nLotesSinMerma: number;
  /** Lotes con podrido REAL del Informe LOTE (cobertura de la medición). */
  nLotesPodridoReal: number;
  /** Σ solo de los lotes CON merma calculable (base de los %). */
  kgEntrada: number;
  kgCalibrador: number;
  mermaKg: number;
  pctMerma: number | null;
  podridoKg: number;
  pctPodrido: number | null;
  /** Σ pérdida total (merma + podrido) y su % sobre entrada. */
  perdidaKg: number;
  pctPerdida: number | null;
}

function agrupa(filas: FilaMermaExport[], clave: (f: FilaMermaExport) => string, conFinca: boolean): GrupoMermaExport[] {
  const map = new Map<string, GrupoMermaExport>();
  for (const f of filas) {
    const key = clave(f);
    let g = map.get(key);
    if (!g) {
      g = {
        productor: f.productor,
        ...(conFinca ? { finca: f.finca } : {}),
        nLotes: 0, nLotesSinMerma: 0, nLotesPodridoReal: 0,
        kgEntrada: 0, kgCalibrador: 0, mermaKg: 0, pctMerma: null,
        podridoKg: 0, pctPodrido: null, perdidaKg: 0, pctPerdida: null,
      };
      map.set(key, g);
    }
    g.nLotes += 1;
    if (f.podridoCalibradorFuente === "real") g.nLotesPodridoReal += 1;
    if (f.mermaNaturalKg == null) {
      g.nLotesSinMerma += 1;
      continue; // parcial: sus kg no entran en la base de los porcentajes
    }
    const podrido = (f.podridoCalibradorKg ?? 0) + (f.podridoManualKg ?? 0) + (f.podridoPreCalibradorKg ?? 0);
    g.kgEntrada += f.kgEntrada;
    g.kgCalibrador += f.kgCalibrador;
    g.mermaKg += Math.max(0, f.mermaNaturalKg);
    g.podridoKg += podrido;
    g.perdidaKg += Math.max(0, f.mermaNaturalKg) + podrido;
  }
  const grupos = Array.from(map.values());
  for (const g of grupos) {
    if (g.kgEntrada > 0) {
      g.pctMerma = (g.mermaKg / g.kgEntrada) * 100;
      g.pctPodrido = (g.podridoKg / g.kgEntrada) * 100;
      g.pctPerdida = (g.perdidaKg / g.kgEntrada) * 100;
    }
  }
  return grupos.sort((a, b) => (b.pctPerdida ?? -1) - (a.pctPerdida ?? -1) || b.kgEntrada - a.kgEntrada);
}

/** Agregaciones puras (testeables): por productor y por productor-finca, ordenadas por % de pérdida total desc. */
export function agruparMermasExport(filas: FilaMermaExport[]): { porProductor: GrupoMermaExport[]; porFinca: GrupoMermaExport[] } {
  return {
    porProductor: agrupa(filas, (f) => f.productor, false),
    porFinca: agrupa(filas, (f) => `${f.productor}::${f.finca}`, true),
  };
}

const COLS_GRUPO = (conFinca: boolean): ColumnaTabla[] => [
  { header: "Productor", key: "productor", width: 42 },
  ...(conFinca ? [{ header: "Finca", key: "finca", width: 30 } as ColumnaTabla] : []),
  { header: "Lotes", key: "nLotes", tipo: "numero", numFmt: FMT_INT, width: 9 },
  { header: "Sin merma calc.", key: "nLotesSinMerma", tipo: "numero", numFmt: FMT_INT, width: 14 },
  { header: "Con podrido real", key: "nLotesPodridoReal", tipo: "numero", numFmt: FMT_INT, width: 15 },
  { header: "Kg entrada", key: "kgEntrada", tipo: "numero", numFmt: FMT_KG, width: 16 },
  { header: "Kg calibrador (conc.)", key: "kgCalibrador", tipo: "numero", numFmt: FMT_KG, width: 19 },
  { header: "Merma kg", key: "mermaKg", tipo: "numero", numFmt: FMT_KG, width: 14 },
  { header: "% merma", key: "pctMerma", tipo: "numero", numFmt: FMT_PCT, width: 10 },
  { header: "Podrido kg", key: "podridoKg", tipo: "numero", numFmt: FMT_KG, width: 14 },
  { header: "% podrido", key: "pctPodrido", tipo: "numero", numFmt: FMT_PCT, width: 10 },
  { header: "Pérdida kg", key: "perdidaKg", tipo: "numero", numFmt: FMT_KG, width: 14 },
  { header: "% pérdida", key: "pctPerdida", tipo: "numero", numFmt: FMT_PCT, width: 10 },
];

const COLS_DETALLE: ColumnaTabla[] = [
  { header: "Productor", key: "productor", width: 36 },
  { header: "Finca", key: "finca", width: 26 },
  { header: "Variedad", key: "articulo", width: 24 },
  { header: "Lote", key: "lote", width: 12 },
  { header: "Entrada", key: "fechaEntrada", width: 12 },
  { header: "Días cámara", key: "diasEnCamara", tipo: "numero", numFmt: FMT_INT, width: 11 },
  { header: "Kg entrada", key: "kgEntrada", tipo: "numero", numFmt: FMT_KG, width: 15 },
  { header: "Kg calibrador (conc.)", key: "kgCalibrador", tipo: "numero", numFmt: FMT_KG, width: 18 },
  { header: "Merma natural kg", key: "mermaNaturalKg", tipo: "numero", numFmt: FMT_KG, width: 16 },
  { header: "Natural estimada kg", key: "mermaNaturalEstimadaKg", tipo: "numero", numFmt: FMT_KG, width: 17 },
  { header: "Podrido pre-calib. kg", key: "podridoPreCalibradorKg", tipo: "numero", numFmt: FMT_KG, width: 18 },
  { header: "Podrido calibrador kg", key: "podridoCalibradorKg", tipo: "numero", numFmt: FMT_KG, width: 18 },
  { header: "Fuente podrido", key: "podridoCalibradorFuente", width: 13 },
  { header: "Podrido manual kg", key: "podridoManualKg", tipo: "numero", numFmt: FMT_KG, width: 16 },
  { header: "% industria", key: "pctIndustriaPct", tipo: "numero", numFmt: FMT_PCT, width: 11 },
  { header: "Notas del operario", key: "notas", width: 60 },
];

/** Genera y descarga el Excel. `usuario` para el pie de marca Lasarte. */
export async function exportarMermasProductores(filas: FilaMermaExport[], usuario: string | null): Promise<void> {
  const { porProductor, porFinca } = agruparMermasExport(filas);

  const ctx = crearLibroLasarte({
    titulo: "Podrido y mermas por productor, finca y lote",
    periodo: "Campaña completa (lotes procesados)",
    usuario,
    clasificacion: "Interno",
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Productores",
    titulo: "Totales por productor (% de pérdida desc)",
    columnas: COLS_GRUPO(false),
    filas: porProductor as unknown as Record<string, unknown>[],
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Por finca",
    titulo: "Desglose productor → finca",
    columnas: COLS_GRUPO(true),
    filas: porFinca as unknown as Record<string, unknown>[],
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Detalle lotes",
    titulo: "Una fila por lote procesado",
    columnas: COLS_DETALLE,
    filas: filas.map((f) => ({
      ...f,
      pctIndustriaPct: f.pctIndustria != null ? f.pctIndustria * 100 : null,
    })) as unknown as Record<string, unknown>[],
  });

  await descargarLibro(ctx, buildLasarteFilename("Mermas_Podrido_Productores", "xlsx"));
}
