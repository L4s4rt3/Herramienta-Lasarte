/**
 * analisis.ts — Motor de análisis diario para Herramienta Lasarte.
 *
 * Toma los 4 informes parseados y produce un AnalisisDia completo:
 *   - KPIs calculados (% exportación, rechazo, T/h, top calibre…)
 *   - Alertas automáticas con nivel de severidad
 *   - Estructura lista para renderizar en AnalisisDashboard
 *   - JSON para guardar en partes_diarios.resumen_analisis
 */
import type {
  ParsedProduccion,
  ParsedPalets,
  ParsedProducto,
  ParsedCalibres,
  LoteProduccion,
  PaletRow,
  ProductoEmpacado,
  CalibreRow,
} from "./parsers";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de salida
// ─────────────────────────────────────────────────────────────────────────────

export interface KpiDia {
  kg_calibrador: number;         // total entrada calibrador
  kg_exportacion: number;        // kg con destino exportación
  kg_mercado: number;            // kg con destino mercado
  kg_industria: number;          // kg a industria
  kg_rechazo: number;            // kg sin clasificar / desecho
  pct_exportacion: number;       // % sobre kg_calibrador
  pct_mercado: number;
  pct_industria: number;
  pct_rechazo: number;
  tph_promedio: number | null;   // T/h ponderado
  tph_min: number | null;        // T/h mínimo (lote más lento)
  tph_max: number | null;        // T/h máximo (lote más rápido)
  n_lotes: number;
  n_productores: number;
  peso_fruta_avg_g: number | null;
  top_calibre: string | null;    // calibre con más kg
  top_calibre_pct: number;       // % sobre total calibres
  n_palets: number;
  kg_camara: number;
  kg_facturado: number;
  top_producto: string | null;   // producto con más empaques
  top_producto_kg: number;
}

export type AlertaSeveridad = "info" | "warning" | "danger";

export interface Alerta {
  id: string;
  severidad: AlertaSeveridad;
  titulo: string;
  detalle: string;
  valor?: number;
  umbral?: number;
}

export interface ProductorResumen {
  productor: string;
  kg_total: number;
  n_lotes: number;
  tph_avg: number | null;
  peso_fruta_avg_g: number | null;
}

export interface CalibreResumen {
  calibre: string;
  piezas: number;
  kg: number;
  pct_total: number;
  pct_export: number;   // % de ese calibre que va a exportación
  clase: string | null;
  grupo_destino: string | null;
}

export interface ClienteResumen {
  cliente: string;
  n_palets: number;
  kg_total: number;
  productos: string[];  // productos distintos
}

export interface ProductoResumen {
  producto: string;
  kg: number;
  n_empaques: number;
  grupo_destino: string | null;
}

export interface AnalisisDia {
  // Fecha del análisis (ISO)
  fecha_analisis: string;

  // KPIs principales
  kpis: KpiDia;

  // Alertas calculadas
  alertas: Alerta[];

  // Desgloses para tablas y gráficos
  productores: ProductorResumen[];
  calibres: CalibreResumen[];
  clientes: ClienteResumen[];
  top_productos: ProductoResumen[];

  // Series para gráficos
  serie_calibres: { name: string; export: number; mercado: number; industria: number; total: number }[];
  serie_destinos: { name: string; value: number; color: string }[];
  serie_tph_por_lote: { lote: string; productor: string; tph: number }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

const n = (v: any): number => Number(v) || 0;

function normGrupo(g: string | null): "exportacion" | "mercado" | "industria" | "otro" {
  if (!g) return "otro";
  const s = g.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes("export") || s.includes("ext")) return "exportacion";
  if (s.includes("mercado") || s.includes("nac") || s.includes("int")) return "mercado";
  if (s.includes("ind")) return "industria";
  return "otro";
}

// Umbrales configurables
const UMBRAL_RECHAZO_WARNING = 3;   // % rechazo que activa warning
const UMBRAL_RECHAZO_DANGER  = 6;   // % rechazo que activa danger
const UMBRAL_EXPORT_MIN      = 60;  // % exportación por debajo → warning
const UMBRAL_TPH_MIN         = 12;  // T/h por debajo → warning de eficiencia
const UMBRAL_TPH_DROP        = 20;  // % caída de T/h respecto a max → warning
const COLORES_DESTINO = {
  exportacion: "#22c55e",
  mercado:     "#3b82f6",
  industria:   "#f59e0b",
  rechazo:     "#ef4444",
};

// ─────────────────────────────────────────────────────────────────────────────
// Función principal: computeAnalisis
// ─────────────────────────────────────────────────────────────────────────────

export function computeAnalisis(
  produccion: ParsedProduccion | null,
  palets: ParsedPalets | null,
  producto: ParsedProducto | null,
  calibres: ParsedCalibres | null,
): AnalisisDia {
  const alertas: Alerta[] = [];
  const now = new Date().toISOString();

  // ── 1. KPIs base de producción ─────────────────────────────────────────

  const kg_calibrador =
    produccion?.kg_total ??
    producto?.kg_total ??
    calibres?.kg_total ?? 0;

  // kg por destino — preferimos calibres (más granular) > producto > cero
  const fuente_destinos = calibres ?? producto;
  const kg_exportacion = fuente_destinos?.kg_exportacion ?? 0;
  const kg_mercado     = fuente_destinos?.kg_mercado ?? 0;
  const kg_industria   = fuente_destinos?.kg_industria ?? 0;
  const kg_clasificado = kg_exportacion + kg_mercado + kg_industria;
  const kg_rechazo     = Math.max(0, kg_calibrador - kg_clasificado);

  const pct = (v: number) => kg_calibrador > 0 ? (v / kg_calibrador) * 100 : 0;
  const pct_exportacion = pct(kg_exportacion);
  const pct_mercado     = pct(kg_mercado);
  const pct_industria   = pct(kg_industria);
  const pct_rechazo     = pct(kg_rechazo);

  // ── 2. T/h ────────────────────────────────────────────────────────────

  const lotes = produccion?.lotes ?? [];
  const lotesConTph = lotes.filter((l) => l.toneladas_hora && l.toneladas_hora > 0);

  let tph_promedio: number | null = null;
  let tph_min: number | null = null;
  let tph_max: number | null = null;

  if (lotesConTph.length > 0) {
    const tphVals = lotesConTph.map((l) => l.toneladas_hora as number);
    tph_min = Math.min(...tphVals);
    tph_max = Math.max(...tphVals);
    const totalMin = lotesConTph.reduce((s, l) => s + (l.duracion_min ?? 1), 0);
    tph_promedio = totalMin > 0
      ? lotesConTph.reduce((s, l) => s + (l.toneladas_hora as number) * (l.duracion_min ?? 1), 0) / totalMin
      : tphVals.reduce((a, b) => a + b, 0) / tphVals.length;
  }

  // ── 3. Productores ────────────────────────────────────────────────────

  const mapProductores: Record<string, { kg: number; lotes: LoteProduccion[] }> = {};
  for (const l of lotes) {
    const key = l.productor ?? "Sin productor";
    if (!mapProductores[key]) mapProductores[key] = { kg: 0, lotes: [] };
    mapProductores[key].kg += l.kg_peso_total;
    mapProductores[key].lotes.push(l);
  }

  const productores: ProductorResumen[] = Object.entries(mapProductores).map(([p, d]) => {
    const con_tph = d.lotes.filter((l) => l.toneladas_hora && l.toneladas_hora > 0);
    const tph_avg = con_tph.length > 0
      ? con_tph.reduce((s, l) => s + (l.toneladas_hora as number), 0) / con_tph.length
      : null;
    const con_peso = d.lotes.filter((l) => l.peso_fruta_promedio_g && l.peso_fruta_promedio_g > 0);
    const peso_avg = con_peso.length > 0
      ? con_peso.reduce((s, l) => s + (l.peso_fruta_promedio_g as number), 0) / con_peso.length
      : null;
    return {
      productor: p,
      kg_total: d.kg,
      n_lotes: d.lotes.length,
      tph_avg,
      peso_fruta_avg_g: peso_avg,
    };
  }).sort((a, b) => b.kg_total - a.kg_total);

  // ── 4. Calibres ───────────────────────────────────────────────────────

  const rawCalibs = calibres?.calibres ?? [];
  const calibresMap: Record<string, { piezas: number; kg: number; export: number; clase: string | null; grupo: string | null }> = {};
  for (const c of rawCalibs) {
    if (!calibresMap[c.calibre]) calibresMap[c.calibre] = { piezas: 0, kg: 0, export: 0, clase: c.clase, grupo: c.grupo_destino };
    calibresMap[c.calibre].piezas += c.piezas;
    calibresMap[c.calibre].kg += c.kg;
    if (normGrupo(c.grupo_destino) === "exportacion") calibresMap[c.calibre].export += c.kg;
  }
  const kg_total_calibres = Object.values(calibresMap).reduce((s, v) => s + v.kg, 0);

  const calibresArr: CalibreResumen[] = Object.entries(calibresMap).map(([cal, d]) => ({
    calibre: cal,
    piezas: d.piezas,
    kg: d.kg,
    pct_total: kg_total_calibres > 0 ? (d.kg / kg_total_calibres) * 100 : 0,
    pct_export: d.kg > 0 ? (d.export / d.kg) * 100 : 0,
    clase: d.clase,
    grupo_destino: d.grupo,
  })).sort((a, b) => b.kg - a.kg);

  const top_calibre = calibresArr[0]?.calibre ?? null;
  const top_calibre_pct = calibresArr[0]?.pct_total ?? 0;

  // ── 5. Clientes (desde palets) ────────────────────────────────────────

  const mapClientes: Record<string, { n: number; kg: number; productos: Set<string> }> = {};
  for (const p of (palets?.palets ?? [])) {
    if (!p.cliente) continue;
    const key = p.cliente;
    if (!mapClientes[key]) mapClientes[key] = { n: 0, kg: 0, productos: new Set() };
    mapClientes[key].n += 1;
    mapClientes[key].kg += p.kg_neto;
    if (p.producto) mapClientes[key].productos.add(p.producto);
  }
  const clientes: ClienteResumen[] = Object.entries(mapClientes).map(([c, d]) => ({
    cliente: c,
    n_palets: d.n,
    kg_total: d.kg,
    productos: Array.from(d.productos),
  })).sort((a, b) => b.kg_total - a.kg_total);

  // ── 6. Top productos ─────────────────────────────────────────────────

  const mapProductos: Record<string, { kg: number; n: number; grupo: string | null }> = {};
  for (const l of (producto?.lineas ?? [])) {
    const key = l.producto ?? "Sin nombre";
    if (!mapProductos[key]) mapProductos[key] = { kg: 0, n: 0, grupo: l.grupo_destino };
    mapProductos[key].kg += l.kg;
    mapProductos[key].n += l.cajas ?? 1;
  }
  const top_productos: ProductoResumen[] = Object.entries(mapProductos).map(([p, d]) => ({
    producto: p,
    kg: d.kg,
    n_empaques: d.n,
    grupo_destino: d.grupo,
  })).sort((a, b) => b.kg - a.kg);

  const top_producto = top_productos[0]?.producto ?? null;
  const top_producto_kg = top_productos[0]?.kg ?? 0;

  // ── 7. Series para gráficos ───────────────────────────────────────────

  // Barras calibres (top 12 por kg)
  const serie_calibres = calibresArr.slice(0, 12).map((c) => {
    // Distribuir kg según pct_export y proporción mercado/industria del total
    const kg_exp = c.kg * (c.pct_export / 100);
    const resto = c.kg - kg_exp;
    const ratio_ind = kg_total_calibres > 0 ? kg_industria / kg_calibrador : 0;
    const kg_ind = Math.min(resto, resto * ratio_ind);
    const kg_mer = resto - kg_ind;
    return {
      name: c.calibre,
      export: +kg_exp.toFixed(1),
      mercado: +kg_mer.toFixed(1),
      industria: +kg_ind.toFixed(1),
      total: +c.kg.toFixed(1),
    };
  });

  // Pie de destinos
  const serie_destinos = [
    { name: "Exportación", value: +kg_exportacion.toFixed(1), color: COLORES_DESTINO.exportacion },
    { name: "Mercado",     value: +kg_mercado.toFixed(1),     color: COLORES_DESTINO.mercado },
    { name: "Industria",   value: +kg_industria.toFixed(1),   color: COLORES_DESTINO.industria },
    ...(kg_rechazo > 0 ? [{ name: "Rechazo", value: +kg_rechazo.toFixed(1), color: COLORES_DESTINO.rechazo }] : []),
  ].filter((d) => d.value > 0);

  // T/h por lote (para miniChart en detalle de productores)
  const serie_tph_por_lote = lotesConTph.map((l) => ({
    lote: l.lote_codigo ?? "—",
    productor: l.productor ?? "—",
    tph: +(l.toneladas_hora as number).toFixed(2),
  }));

  // ── 8. Alertas ────────────────────────────────────────────────────────

  // 8a. % rechazo
  if (pct_rechazo >= UMBRAL_RECHAZO_DANGER) {
    alertas.push({
      id: "rechazo_alto",
      severidad: "danger",
      titulo: "Rechazo elevado",
      detalle: `${pct_rechazo.toFixed(1)}% de la producción sin clasificar o fuera de mercado — umbral crítico ${UMBRAL_RECHAZO_DANGER}%`,
      valor: pct_rechazo,
      umbral: UMBRAL_RECHAZO_DANGER,
    });
  } else if (pct_rechazo >= UMBRAL_RECHAZO_WARNING) {
    alertas.push({
      id: "rechazo_warning",
      severidad: "warning",
      titulo: "Rechazo por encima de umbral",
      detalle: `${pct_rechazo.toFixed(1)}% — revisar calibres fuera de rango comercial`,
      valor: pct_rechazo,
      umbral: UMBRAL_RECHAZO_WARNING,
    });
  }

  // 8b. % exportación bajo
  if (kg_calibrador > 0 && pct_exportacion < UMBRAL_EXPORT_MIN && pct_exportacion > 0) {
    alertas.push({
      id: "export_bajo",
      severidad: "warning",
      titulo: "Rendimiento comercial bajo",
      detalle: `Solo el ${pct_exportacion.toFixed(1)}% fue a exportación — mínimo esperado ${UMBRAL_EXPORT_MIN}%`,
      valor: pct_exportacion,
      umbral: UMBRAL_EXPORT_MIN,
    });
  }

  // 8c. T/h mínima
  if (tph_min !== null && tph_min < UMBRAL_TPH_MIN) {
    const lentosNames = lotesConTph
      .filter((l) => (l.toneladas_hora as number) < UMBRAL_TPH_MIN)
      .map((l) => l.productor ?? l.lote_codigo ?? "lote")
      .join(", ");
    alertas.push({
      id: "tph_bajo",
      severidad: "warning",
      titulo: "Eficiencia de máquina baja",
      detalle: `Lotes con T/h < ${UMBRAL_TPH_MIN}: ${lentosNames}`,
      valor: tph_min,
      umbral: UMBRAL_TPH_MIN,
    });
  }

  // 8d. Caída de T/h entre lotes (>20% del máximo)
  if (tph_max !== null && tph_min !== null && tph_max > 0) {
    const drop = ((tph_max - (tph_min ?? 0)) / tph_max) * 100;
    if (drop >= UMBRAL_TPH_DROP) {
      alertas.push({
        id: "tph_variacion",
        severidad: "info",
        titulo: "Variación de T/h entre lotes",
        detalle: `Diferencia de ${drop.toFixed(0)}% entre el lote más rápido (${tph_max.toFixed(1)}) y el más lento (${tph_min?.toFixed(1)})`,
        valor: drop,
        umbral: UMBRAL_TPH_DROP,
      });
    }
  }

  // 8e. Calibre dominante muy concentrado
  if (top_calibre_pct > 60) {
    alertas.push({
      id: "calibre_concentrado",
      severidad: "info",
      titulo: `Alta concentración en calibre ${top_calibre}`,
      detalle: `${top_calibre_pct.toFixed(1)}% de la producción en un solo calibre — dependencia de demanda`,
      valor: top_calibre_pct,
    });
  }

  // 8f. Sin datos de producción
  if (kg_calibrador === 0) {
    alertas.push({
      id: "sin_datos",
      severidad: "info",
      titulo: "Datos incompletos",
      detalle: "No se importó el Informe_produccion — algunos KPIs no están disponibles",
    });
  }

  // ── 9. Ensamblado final ───────────────────────────────────────────────

  const kpis: KpiDia = {
    kg_calibrador,
    kg_exportacion,
    kg_mercado,
    kg_industria,
    kg_rechazo,
    pct_exportacion: +pct_exportacion.toFixed(1),
    pct_mercado:     +pct_mercado.toFixed(1),
    pct_industria:   +pct_industria.toFixed(1),
    pct_rechazo:     +pct_rechazo.toFixed(1),
    tph_promedio:    tph_promedio !== null ? +tph_promedio.toFixed(2) : null,
    tph_min:         tph_min !== null ? +tph_min.toFixed(2) : null,
    tph_max:         tph_max !== null ? +tph_max.toFixed(2) : null,
    n_lotes:         lotes.length,
    n_productores:   productores.length,
    peso_fruta_avg_g: produccion
      ? (() => {
          const con = lotes.filter((l) => l.peso_fruta_promedio_g && l.peso_fruta_promedio_g > 0);
          return con.length > 0 ? +(con.reduce((s, l) => s + (l.peso_fruta_promedio_g as number), 0) / con.length).toFixed(0) : null;
        })()
      : null,
    top_calibre,
    top_calibre_pct: +top_calibre_pct.toFixed(1),
    n_palets:        palets?.palets.length ?? 0,
    kg_camara:       palets?.kg_camara ?? 0,
    kg_facturado:    palets?.kg_facturado ?? 0,
    top_producto,
    top_producto_kg,
  };

  return {
    fecha_analisis: now,
    kpis,
    alertas,
    productores,
    calibres: calibresArr,
    clientes,
    top_productos: top_productos.slice(0, 10),
    serie_calibres,
    serie_destinos,
    serie_tph_por_lote,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsear múltiples ficheros y construir el análisis de una vez
// ─────────────────────────────────────────────────────────────────────────────
import type { ParsedInforme } from "./parsers";

export function computeAnalisisDesdeInformes(informes: ParsedInforme[]): AnalisisDia {
  const produccion = informes.find((i) => i.tipo === "produccion") as ParsedProduccion | undefined;
  const palets     = informes.find((i) => i.tipo === "palets")     as ParsedPalets     | undefined;
  const producto   = informes.find((i) => i.tipo === "producto")   as ParsedProducto   | undefined;
  const calibres   = informes.find((i) => i.tipo === "calibres")   as ParsedCalibres   | undefined;

  return computeAnalisis(
    produccion ?? null,
    palets     ?? null,
    producto   ?? null,
    calibres   ?? null,
  );
}
