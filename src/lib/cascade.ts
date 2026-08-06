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
 * POR QUÉ EL PODRIDO MANUAL SE DESCUENTA AQUÍ (explicación del dueño,
 * 06-ago-2026 — NO es un descuido, no lo "arregles"): esa fruta se aparta
 * ANTES de entrar al calibrador, así que en rigor no está dentro de
 * `kg_produccion_calibrador` y no explica la diferencia contra palets. Se
 * descuenta igualmente porque es la ÚNICA parte que se pesa de lo que se
 * pierde entre la báscula y la línea: "no tengo forma de saber cuál es la
 * diferencia entre los kg de entrada que debería pesar el lote y los kg que
 * han pasado; esa diferencia es merma y podrido". El DSJ asume ese descuento
 * como la mejor aproximación disponible a esa pérdida.
 *
 * Consecuencia medida en la campaña 25/26 (79 partes): el descuento mejora el
 * balance en 28.871 kg sobre 6,88 M kg de producción — el DSJ pasa de +3,71 %
 * a +3,29 %. Si algún día se mide la pérdida pre-calibrador por lote (con las
 * bateas de la tría, hoy solo 2 partes con dato), este descuento debería
 * quitarse de aquí y llevarse a ese balance.
 *
 * OJO al usar estos números fuera del DSJ: el análisis por lote
 * (src/lib/mermaLote.ts) trata el podrido manual como lo que es, parte de la
 * merma medida (entrada − calibrador), y por eso NUNCA lo suma aparte en kg,
 * € ni %. Los dos criterios conviven a propósito: aquí es un descuento
 * operativo del día, allí es el desglose de una pérdida ya contada.
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
