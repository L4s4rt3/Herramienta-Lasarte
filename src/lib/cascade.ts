/**
 * Modelo DSJ — Cascada de producción citrícola Lasarte SAT.
 *
 * Producción real = Calibrador + Industria manual − Mujeres(L) − Reciclado Z1 − Reciclado Z2
 * Palets ajustados = Palets brutos − Inventario sin alta de D-1
 * Diferencia bruta = Producción real − Palets ajustados − Inventario final sin alta (D)
 * Mermas totales = Podrido calibrador + Podrido manual (bolsa basura)
 * DSJ = Diferencia bruta − Mermas totales
 * % DSJ = DSJ / Producción real
 *
 * M3 — Destino de fruta (opcional, desde Informe_producto + Informe_tamaños):
 *   Rendimiento comercial = kg_exportacion / produccion_real
 */

export interface CascadeInput {
  // Automáticos (desde archivos / production_runs / gstock)
  kg_produccion_calibrador: number;
  kg_mujeres_calibrador: number;
  kg_palets_brutos: number;
  kg_podrido_calibrador: number;
  // Manuales (5 campos del operario)
  kg_industria_manual: number;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  kg_inventario_sin_alta: number;
  kg_podrido_bolsa_basura: number;
  // Arrastre
  kg_inventario_anterior_sin_alta: number;

  // M3 — Destino de fruta (opcionales, desde informes Excel)
  kg_exportacion?: number;
  kg_mercado?: number;
  kg_industria_destino?: number;  // industria generada (distinto de industria_manual)

  // M6 — Eficiencia de máquina (opcional, desde Informe_produccion)
  tph_promedio?: number;
}

export interface CascadeResult {
  produccion_calibrador: number;
  industria_manual: number;
  mujeres: number;
  reciclado_z1: number;
  reciclado_z2: number;
  produccion_real: number;

  palets_brutos: number;
  inventario_anterior: number;
  palets_ajustados: number;

  inventario_final: number;
  diferencia_bruta: number;

  podrido_calibrador: number;
  podrido_manual: number;
  mermas_totales: number;

  dsj: number;
  dsj_pct: number;
  semaforo: "verde" | "amarillo" | "rojo";

  // M3 — Destino de fruta
  kg_exportacion: number;
  kg_mercado: number;
  kg_industria_destino: number;
  /** Producción real − exportación − mercado − industria = pérdida real no justificada */
  kg_perdida_real: number;
  /** kg exportación / producción real · 100 */
  rendimiento_comercial_pct: number;
  /** true si tenemos datos de destino de los informes */
  tiene_datos_destino: boolean;

  // M6 — Eficiencia de máquina
  tph_promedio: number | null;
}

export function computeCascade(input: CascadeInput): CascadeResult {
  const n = (v: number | undefined) => Number(v) || 0;

  const produccion_calibrador = n(input.kg_produccion_calibrador);
  const industria_manual = n(input.kg_industria_manual);
  const mujeres = n(input.kg_mujeres_calibrador);
  const reciclado_z1 = n(input.kg_reciclado_malla_z1);
  const reciclado_z2 = n(input.kg_reciclado_malla_z2);

  const produccion_real =
    produccion_calibrador + industria_manual - mujeres - reciclado_z1 - reciclado_z2;

  const palets_brutos = n(input.kg_palets_brutos);
  const inventario_anterior = n(input.kg_inventario_anterior_sin_alta);
  const inventario_final = n(input.kg_inventario_sin_alta);
  const palets_ajustados = palets_brutos - inventario_anterior;

  const diferencia_bruta = produccion_real - palets_ajustados - inventario_final;

  const podrido_calibrador = n(input.kg_podrido_calibrador);
  const podrido_manual = n(input.kg_podrido_bolsa_basura);
  const mermas_totales = podrido_calibrador + podrido_manual;

  const dsj = diferencia_bruta - mermas_totales;
  const dsj_pct = produccion_real > 0 ? (dsj / produccion_real) * 100 : 0;

  const abs = Math.abs(dsj_pct);
  const semaforo: "verde" | "amarillo" | "rojo" =
    abs <= 3 ? "verde" : abs <= 5 ? "amarillo" : "rojo";

  // M3 — Destino de fruta
  const tiene_datos_destino =
    (input.kg_exportacion ?? 0) > 0 ||
    (input.kg_mercado ?? 0) > 0 ||
    (input.kg_industria_destino ?? 0) > 0;

  const kg_exportacion = n(input.kg_exportacion);
  const kg_mercado = n(input.kg_mercado);
  const kg_industria_destino = n(input.kg_industria_destino);

  const kg_destino_conocido = kg_exportacion + kg_mercado + kg_industria_destino;
  const kg_perdida_real = tiene_datos_destino
    ? Math.max(0, produccion_real - kg_destino_conocido)
    : 0;

  const rendimiento_comercial_pct =
    tiene_datos_destino && produccion_real > 0
      ? (kg_exportacion / produccion_real) * 100
      : 0;

  // M6 — T/h
  const tph_promedio =
    input.tph_promedio !== undefined && input.tph_promedio !== null
      ? input.tph_promedio
      : null;

  return {
    produccion_calibrador,
    industria_manual,
    mujeres,
    reciclado_z1,
    reciclado_z2,
    produccion_real,
    palets_brutos,
    inventario_anterior,
    palets_ajustados,
    inventario_final,
    diferencia_bruta,
    podrido_calibrador,
    podrido_manual,
    mermas_totales,
    dsj,
    dsj_pct,
    semaforo,
    kg_exportacion,
    kg_mercado,
    kg_industria_destino,
    kg_perdida_real,
    rendimiento_comercial_pct,
    tiene_datos_destino,
    tph_promedio,
  };
}
