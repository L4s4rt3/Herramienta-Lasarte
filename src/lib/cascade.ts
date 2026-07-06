/**
 * Modelo DSJ — Cascada de producción citrícola Lasarte SAT.
 *
 * Producción real = Calibrador − Mujeres(L) − Reciclado Z1 − Reciclado Z2
 * Palets ajustados = Palets brutos − Inventario sin alta de D-1
 * Diferencia bruta = Producción real − Palets ajustados − Inventario final sin alta (D)
 * Mermas totales = Podrido manual (bolsa basura)
 *   (el podrido del calibrador es un dato informativo y NO entra en el DSJ)
 * DSJ = Diferencia bruta − Mermas totales
 * % DSJ = DSJ / Producción real
 *
 * El destino de fruta (exportación/mercado/industria) y la eficiencia de
 * máquina (T/h) NO se calculan aquí: viven en calibres_dia y lotes_dia,
 * y se consultan aparte (ver PartDetail.tsx) porque no forman parte del
 * balance de masa del DSJ.
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

  // Eficiencia de máquina (opcional; ver calcularTphOperativa)
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
  mermas_pct: number;

  dsj: number;
  dsj_pct: number;
  semaforo: "verde" | "amarillo" | "rojo";

  // Eficiencia de máquina
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
    produccion_calibrador - mujeres - reciclado_z1 - reciclado_z2;

  const palets_brutos = n(input.kg_palets_brutos);
  const inventario_anterior = n(input.kg_inventario_anterior_sin_alta);
  const inventario_final = n(input.kg_inventario_sin_alta);
  const palets_ajustados = palets_brutos - inventario_anterior;

  const diferencia_bruta = produccion_real - palets_ajustados - inventario_final;

  const podrido_manual = n(input.kg_podrido_bolsa_basura);
  // Dato informativo: el podrido del calibrador NO entra en el DSJ.
  const podrido_calibrador = n(input.kg_podrido_calibrador);
  const mermas_totales = podrido_manual;
  const mermas_pct = produccion_real > 0 ? (mermas_totales / produccion_real) * 100 : 0;

  const dsj = diferencia_bruta - podrido_manual;
  const dsj_pct = produccion_real > 0 ? (dsj / produccion_real) * 100 : 0;

  const abs = Math.abs(dsj_pct);
  const semaforo: "verde" | "amarillo" | "rojo" =
    abs <= 3 ? "verde" : abs <= 5 ? "amarillo" : "rojo";

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
    mermas_pct,
    dsj,
    dsj_pct,
    semaforo,
    tph_promedio,
  };
}
