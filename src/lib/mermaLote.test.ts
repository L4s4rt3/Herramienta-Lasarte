import { describe, expect, it } from "vitest";
import {
  agregarMermaLotes,
  agruparPerdidaPorProductor,
  computeMermaLotes,
  mermaLotesEnPeriodo,
  TASA_MERMA_NATURAL_DIA,
  type ClasificacionLoteInput,
  type EntradaLoteInput,
  type ItemPerdidaProductor,
  type LoteDiaKgInput,
  type ParteMermaInput,
} from "./mermaLote";

// Entrada mínima con solo lo necesario para el test dado (el resto a null/0).
function entrada(overrides: Partial<EntradaLoteInput> & { lote: string; kg_entrada: number }): EntradaLoteInput {
  return {
    fecha: "2026-05-01",
    kg_ajuste_stock: 0,
    importe_compra: null,
    coste_recoleccion: null,
    importe_transporte: null,
    importe_comision: null,
    importe_total: null,
    ...overrides,
  };
}

describe("computeMermaLotes — kgCalibrador (Σ de varios partes)", () => {
  it("suma el kg de un lote procesado en varios partes/días distintos", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 400, part_id: "p1" },
      { lote_codigo: "26050101", kg_peso_total: 590, part_id: "p2" },
    ];
    const partes: ParteMermaInput[] = [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 },
      { part_id: "p2", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 },
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(resultado.kgCalibrador).toBe(990);
    expect(resultado.estado).toBe("procesado"); // 990/1000 = 99% >= 97%
    expect(resultado.mermaNaturalKg).toBe(10);
  });

  it("normaliza el código del calibrador aunque traiga texto pegado", () => {
    const entradas = [entrada({ lote: "26042712", kg_entrada: 500 })];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26042712 + 7 BOX DE RECICLAJE", kg_peso_total: 495, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(resultado.kgCalibrador).toBe(495);
  });
});

describe("computeMermaLotes — prorrateo de podrido con varios lotes en un parte", () => {
  it("reparte el podrido del parte proporcionalmente al kg de cada lote (las cuotas suman el total del parte)", () => {
    const entradas = [
      entrada({ lote: "26050101", kg_entrada: 1000 }),
      entrada({ lote: "26050102", kg_entrada: 3000 }),
    ];
    // Parte con 2 lotes: 1000 + 3000 = 4000 kg total. Podrido auto = 40, manual = 20.
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 1000, part_id: "p1" },
      { lote_codigo: "26050102", kg_peso_total: 3000, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 40, kg_podrido_bolsa_basura: 20 }];
    const resultados = computeMermaLotes(entradas, lotesDia, [], partes);

    const lote1 = resultados.find((r) => r.lote === "26050101")!;
    const lote2 = resultados.find((r) => r.lote === "26050102")!;

    // Cuota 1/4 y 3/4 respectivamente.
    expect(lote1.podridoCalibradorKg).toBeCloseTo(10); // 40 * 0.25
    expect(lote1.podridoManualKg).toBeCloseTo(5); // 20 * 0.25
    expect(lote2.podridoCalibradorKg).toBeCloseTo(30); // 40 * 0.75
    expect(lote2.podridoManualKg).toBeCloseTo(15); // 20 * 0.75

    // Las cuotas del parte suman exactamente el total (conservación).
    expect(lote1.podridoCalibradorKg! + lote2.podridoCalibradorKg!).toBeCloseTo(40);
    expect(lote1.podridoManualKg! + lote2.podridoManualKg!).toBeCloseTo(20);

    expect(lote1.podridoCalibradorFuente).toBe("prorrateo");
    expect(lote2.podridoCalibradorFuente).toBe("prorrateo");
  });

  it("propiedad de conservación: Σ podrido prorrateado de los lotes de un parte === kg_podrido del parte (todos con kg, ninguno con informe real)", () => {
    const entradas = [
      entrada({ lote: "26050101", kg_entrada: 500 }),
      entrada({ lote: "26050102", kg_entrada: 750 }),
      entrada({ lote: "26050103", kg_entrada: 1250 }),
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 500, part_id: "p1" },
      { lote_codigo: "26050102", kg_peso_total: 750, part_id: "p1" },
      { lote_codigo: "26050103", kg_peso_total: 1250, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 77, kg_podrido_bolsa_basura: 33 }];
    const resultados = computeMermaLotes(entradas, lotesDia, [], partes);

    const sumaAuto = resultados.reduce((s, r) => s + (r.podridoCalibradorKg ?? 0), 0);
    const sumaManual = resultados.reduce((s, r) => s + (r.podridoManualKg ?? 0), 0);
    expect(sumaAuto).toBeCloseTo(77);
    expect(sumaManual).toBeCloseTo(33);
  });

  it("el mismo lote en DOS filas lotes_dia del mismo parte se suma antes de prorratear (no infla ni desinfla su cuota)", () => {
    // p1 tiene 3 filas: el lote 101 aparece dos veces (dos pasadas por el
    // calibrador el mismo día) y el lote 102 una vez. Total del parte: 1000.
    const entradas = [
      entrada({ lote: "26050101", kg_entrada: 1000 }),
      entrada({ lote: "26050102", kg_entrada: 1000 }),
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 300, part_id: "p1" },
      { lote_codigo: "26050101", kg_peso_total: 200, part_id: "p1" }, // misma lote, segunda fila
      { lote_codigo: "26050102", kg_peso_total: 500, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 100, kg_podrido_bolsa_basura: 0 }];
    const resultados = computeMermaLotes(entradas, lotesDia, [], partes);

    const lote1 = resultados.find((r) => r.lote === "26050101")!;
    const lote2 = resultados.find((r) => r.lote === "26050102")!;

    // kgCalibrador del lote 101 = 300+200 = 500 (suma de sus dos filas).
    expect(lote1.kgCalibrador).toBe(500);
    // Cuota correcta: 500/1000 = 0.5 (no 300/1000 y 200/1000 tratadas por separado).
    expect(lote1.podridoCalibradorKg).toBeCloseTo(50);
    expect(lote2.podridoCalibradorKg).toBeCloseTo(50);
    expect(lote1.podridoCalibradorKg! + lote2.podridoCalibradorKg!).toBeCloseTo(100); // conservación intacta
  });

  it("un lote con kg_peso_total 0 en el parte tiene cuota 0 (no NaN) y no roba cuota a los demás lotes del parte", () => {
    const entradas = [
      entrada({ lote: "26050101", kg_entrada: 1000 }), // sin kg en el parte (0)
      entrada({ lote: "26050102", kg_entrada: 1000 }),
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 0, part_id: "p1" },
      { lote_codigo: "26050102", kg_peso_total: 1000, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 50, kg_podrido_bolsa_basura: 10 }];
    const resultados = computeMermaLotes(entradas, lotesDia, [], partes);

    const loteCero = resultados.find((r) => r.lote === "26050101")!;
    const loteNormal = resultados.find((r) => r.lote === "26050102")!;

    expect(loteCero.podridoCalibradorKg).toBe(0);
    expect(loteCero.podridoManualKg).toBe(0);
    expect(Number.isFinite(loteCero.podridoCalibradorKg!)).toBe(true);
    // El denominador del parte SIGUE incluyendo la fila de kg 0 (no se filtra),
    // pero como aporta 0 al numerador de kg no cambia el resultado: el lote
    // normal se lleva el 100% del podrido porque es el único con kg > 0.
    expect(loteNormal.podridoCalibradorKg).toBeCloseTo(50);
    expect(loteNormal.podridoManualKg).toBeCloseTo(10);
  });

  it("documenta (no corrige) el sesgo cuando en el mismo parte conviven un lote con Informe LOTE real y otros sin él: la conservación NO se cumple", () => {
    // Parte con 2 lotes de 1000 kg cada uno (cuota 50/50). kg_podrido_calibrador_auto = 100.
    // El lote 101 tiene Informe LOTE real con solo 10 kg de Podrido (menos que
    // su cuota teórica de 50). El lote 102 no tiene informe: su prorrateo se
    // sigue calculando sobre el denominador COMPLETO (2000, incluyendo al 101),
    // así que sigue recibiendo 50 (su cuota original), no una redistribución
    // del "sobrante" que dejó el 101 al tener menos podrido real del esperado.
    const entradas = [
      entrada({ lote: "26050101", kg_entrada: 1000 }),
      entrada({ lote: "26050102", kg_entrada: 1000 }),
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 1000, part_id: "p1" },
      { lote_codigo: "26050102", kg_peso_total: 1000, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 100, kg_podrido_bolsa_basura: 0 }];
    const clasificacion: ClasificacionLoteInput[] = [{ lote_codigo: "26050101", clase: "(J) Podrido", peso_kg: 10 }];
    const resultados = computeMermaLotes(entradas, lotesDia, clasificacion, partes);

    const conInforme = resultados.find((r) => r.lote === "26050101")!;
    const sinInforme = resultados.find((r) => r.lote === "26050102")!;

    expect(conInforme.podridoCalibradorFuente).toBe("real");
    expect(conInforme.podridoCalibradorKg).toBe(10); // el real, bastante por debajo de su cuota teórica (50)
    expect(sinInforme.podridoCalibradorFuente).toBe("prorrateo");
    expect(sinInforme.podridoCalibradorKg).toBeCloseTo(50); // su cuota SIN redistribuir el sobrante del 101

    // La suma ya NO reproduce kg_podrido_calibrador_auto del parte (100): se
    // queda corta en 40 (justo la diferencia entre la cuota teórica del 101 y
    // su valor real). Comportamiento aceptado y documentado en mermaLote.ts
    // (limitación conocida, sesgo marginal con solo ~28/398 lotes con informe).
    const suma = conInforme.podridoCalibradorKg! + sinInforme.podridoCalibradorKg!;
    expect(suma).toBeCloseTo(60);
    expect(suma).not.toBeCloseTo(100);
  });
});

describe("computeMermaLotes — denominador 0", () => {
  it("un parte sin kg positivo en ningún lote no aporta podrido a ninguno (no divide por 0)", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 500 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 0, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 25, kg_podrido_bolsa_basura: 10 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(resultado.podridoCalibradorKg).toBe(0);
    expect(resultado.podridoManualKg).toBe(0);
    expect(Number.isFinite(resultado.podridoCalibradorKg!)).toBe(true); // nunca NaN
  });
});

describe("computeMermaLotes — merma negativa", () => {
  it("flag calibradorSuperaEntrada y clamp a 0 en el cálculo de €, pero el kg con signo se expone tal cual", () => {
    const entradas = [
      entrada({
        lote: "26050101",
        kg_entrada: 1000,
        importe_total: 500, // 0.5 €/kg
      }),
    ];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 1100, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.estado).toBe("procesado");
    expect(resultado.mermaNaturalKg).toBe(-100); // 1000 - 1100, con signo
    expect(resultado.calibradorSuperaEntrada).toBe(true);
    expect(resultado.perdidaMermaEur).toBe(0); // max(0, -100) * 0.5 = 0, no una pérdida negativa
  });
});

describe("computeMermaLotes — lote parcial: merma no calculable", () => {
  it("mermaNaturalKg es null (no 0) si el lote no ha superado el umbral de procesado", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 500, part_id: "p1" }]; // 50%
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(resultado.estado).toBe("parcial");
    expect(resultado.mermaNaturalKg).toBeNull();
    expect(resultado.calibradorSuperaEntrada).toBe(false);
    expect(resultado.perdidaMermaEur).toBeNull();
  });

  it("mermaNaturalKg es null también para un lote pendiente (0% procesado)", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000 })];
    const [resultado] = computeMermaLotes(entradas, [], [], []);
    expect(resultado.estado).toBe("pendiente");
    expect(resultado.mermaNaturalKg).toBeNull();
  });
});

describe("computeMermaLotes — Informe LOTE real: no se suma además el prorrateo (sin doble conteo)", () => {
  it("usa la suma real de la clase Podrido e ignora la cuota de prorrateo para ese lote", () => {
    const entradas = [
      entrada({ lote: "26050101", kg_entrada: 1000 }),
      entrada({ lote: "26050102", kg_entrada: 1000 }),
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 1000, part_id: "p1" },
      { lote_codigo: "26050102", kg_peso_total: 1000, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 100, kg_podrido_bolsa_basura: 0 }];
    // Solo el lote 26050101 tiene Informe LOTE, con 15 kg reales en la clase Podrido.
    const clasificacion: ClasificacionLoteInput[] = [
      { lote_codigo: "26050101", clase: "(A) Primera", peso_kg: 300 },
      { lote_codigo: "26050101", clase: "(J) Podrido", peso_kg: 15 },
    ];
    const resultados = computeMermaLotes(entradas, lotesDia, clasificacion, partes);
    const conInforme = resultados.find((r) => r.lote === "26050101")!;
    const sinInforme = resultados.find((r) => r.lote === "26050102")!;

    expect(conInforme.podridoCalibradorFuente).toBe("real");
    expect(conInforme.podridoCalibradorKg).toBe(15); // el real, NO 50 (su cuota de prorrateo hubiera sido 100*0.5)

    expect(sinInforme.podridoCalibradorFuente).toBe("prorrateo");
    expect(sinInforme.podridoCalibradorKg).toBeCloseTo(50); // 100 * 0.5, su cuota normal
  });

  it("un lote con Informe LOTE pero sin filas de la clase Podrido usa 0 REAL (no cae a prorrateo)", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 1000, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 80, kg_podrido_bolsa_basura: 0 }];
    const clasificacion: ClasificacionLoteInput[] = [{ lote_codigo: "26050101", clase: "(A) Primera", peso_kg: 1000 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, clasificacion, partes);
    expect(resultado.podridoCalibradorFuente).toBe("real");
    expect(resultado.podridoCalibradorKg).toBe(0); // real 0, no 80 (que sería su cuota de prorrateo)
  });
});

describe("computeMermaLotes — sin coste", () => {
  it("sinCoste=true y todas las cifras en € son null cuando no hay importe", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 970, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 5, kg_podrido_bolsa_basura: 2 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(resultado.sinCoste).toBe(true);
    expect(resultado.costePorKg).toBeNull();
    expect(resultado.perdidaMermaEur).toBeNull();
    expect(resultado.perdidaPodridoEur).toBeNull();
    expect(resultado.perdidaTotalEur).toBeNull();
    expect(resultado.pctPerdidaSobreCoste).toBeNull();
  });

  it("costeTotalLote <= 0 (p.ej. importe_total 0) también cuenta como sinCoste", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, importe_total: 0 })];
    const [resultado] = computeMermaLotes(entradas, [], [], []);
    expect(resultado.sinCoste).toBe(true);
    expect(resultado.costeTotalLote).toBe(0);
  });
});

describe("computeMermaLotes — ajuste de stock restando", () => {
  it("kg_ajuste_stock positivo se resta de la merma (cuenta como procesado ya conciliado)", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, kg_ajuste_stock: 30 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 950, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);
    // 950 + 30 = 980 -> 98% procesado
    expect(resultado.estado).toBe("procesado");
    expect(resultado.mermaNaturalKg).toBe(1000 - 950 - 30); // 20
  });

  it("kg_ajuste_stock negativo devuelve stock (reduce lo procesado) y puede dejar el lote como parcial", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, kg_ajuste_stock: -500 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 980, part_id: "p1" }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], []);
    // 980 + (-500) = 480 -> 48% procesado -> parcial
    expect(resultado.estado).toBe("parcial");
    expect(resultado.mermaNaturalKg).toBeNull();
  });
});

describe("agregarMermaLotes — real y estimado SIEMPRE separados", () => {
  it("separa kg y € de podrido real vs estimado, y no los mezcla en una única cifra sin desglose", () => {
    const entradas = [
      entrada({ lote: "26050101", kg_entrada: 1000, importe_total: 500 }), // 0.5 €/kg, con informe real
      entrada({ lote: "26050102", kg_entrada: 1000, importe_total: 500 }), // 0.5 €/kg, prorrateo
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 1000, part_id: "p1" },
      { lote_codigo: "26050102", kg_peso_total: 1000, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 100, kg_podrido_bolsa_basura: 40 }];
    const clasificacion: ClasificacionLoteInput[] = [{ lote_codigo: "26050101", clase: "(J) Podrido", peso_kg: 20 }];

    const lotes = computeMermaLotes(entradas, lotesDia, clasificacion, partes);
    const agregado = agregarMermaLotes(lotes);

    expect(agregado.kgPodridoCalibradorReal).toBe(20);
    expect(agregado.kgPodridoCalibradorEstimado).toBeCloseTo(50); // 100 * 0.5 (cuota del segundo lote)
    expect(agregado.kgPodridoManualEstimado).toBeCloseTo(40); // 20 (lote1, prorrateo) + 20 (lote2, prorrateo)

    expect(agregado.eurPerdidaPodridoCalibradorReal).toBeCloseTo(20 * 0.5);
    expect(agregado.eurPerdidaPodridoCalibradorEstimado).toBeCloseTo(50 * 0.5);
    expect(agregado.eurPerdidaPodridoManualEstimado).toBeCloseTo(40 * 0.5);

    // El total se expone junto a (no en lugar de) el desglose real/estimado.
    const sumaComponentes = agregado.eurPerdidaMermaTotal
      + agregado.eurPerdidaPodridoCalibradorReal
      + agregado.eurPerdidaPodridoCalibradorEstimado
      + agregado.eurPerdidaPodridoManualEstimado;
    expect(agregado.eurPerdidaTotal).toBeCloseTo(sumaComponentes);
  });

  it("cuenta procesados/pendientes-parciales/sin coste/con dato a revisar y la merma media ponderada", () => {
    const entradas = [
      entrada({ lote: "26050101", kg_entrada: 1000, importe_total: 500 }), // procesado, con coste
      entrada({ lote: "26050102", kg_entrada: 1000 }), // pendiente, sin coste
      entrada({ lote: "26050103", kg_entrada: 1000, importe_total: 500 }), // procesado, calibrador > entrada
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 970, part_id: "p1" }, // 97% -> procesado, merma 30
      { lote_codigo: "26050103", kg_peso_total: 1100, part_id: "p1" }, // 110% -> procesado, merma -100 (dato a revisar)
    ];
    const lotes = computeMermaLotes(entradas, lotesDia, [], []);
    const agregado = agregarMermaLotes(lotes);

    expect(agregado.nLotes).toBe(3);
    expect(agregado.nProcesados).toBe(2);
    expect(agregado.nPendientesOParciales).toBe(1);
    expect(agregado.nSinCoste).toBe(1);
    expect(agregado.nConDatoARevisar).toBe(1);

    // Σ merma (con signo) = 30 + (-100) = -70; Σ entrada procesados = 2000.
    expect(agregado.kgEntradaProcesados).toBe(2000);
    expect(agregado.kgMermaNaturalTotal).toBe(-70);
    expect(agregado.mermaMediaPonderadaPct).toBeCloseTo((-70 / 2000) * 100);
  });
});

// ─── Desglose natural estimada / sin justificar (TASA_MERMA_NATURAL_DIA) ────

describe("computeMermaLotes — diasEnCamara (fecha de entrada -> última fecha de procesado)", () => {
  it("toma la fecha del parte más reciente que procesó el lote, no la primera", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, fecha: "2026-05-01" })];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 400, part_id: "p1" },
      { lote_codigo: "26050101", kg_peso_total: 590, part_id: "p2" },
    ];
    const partes: ParteMermaInput[] = [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0, date: "2026-05-10" },
      { part_id: "p2", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0, date: "2026-06-30" }, // más reciente
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(resultado.diasEnCamara).toBe(60); // 2026-05-01 -> 2026-06-30
  });

  it("null si ningún parte trae fecha (date ausente en ParteMermaInput)", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, fecha: "2026-05-01" })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 990, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);
    expect(resultado.diasEnCamara).toBeNull();
  });
});

describe("computeMermaLotes — mermaNaturalEstimadaKg: tasa aplicada bien (kg × tasa × días)", () => {
  it("cuando la merma medida es mayor que el techo por días, la estimación es exactamente kgEntrada × TASA × días", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 10000, fecha: "2026-05-01" })];
    // kgCalibrador = 9700 (97%, sigue "procesado") -> mermaMedida = 300. Techo por 50 días: 10000*0.000553*50 = 276.5 (< 300, se clampa).
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 9700, part_id: "p1" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0, date: "2026-06-20" },
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.diasEnCamara).toBe(50);
    expect(resultado.mermaNaturalKg).toBe(300);
    const techoEsperado = 10000 * TASA_MERMA_NATURAL_DIA * 50;
    expect(resultado.mermaNaturalEstimadaKg).toBeCloseTo(techoEsperado);
    expect(resultado.podridoPreCalibradorKg).toBeCloseTo(300 - techoEsperado);
  });
});

describe("computeMermaLotes — clamp de mermaNaturalEstimadaKg a la merma medida", () => {
  it("poco tiempo en cámara pero mucha merma: la estimación queda pequeña y casi todo va a 'sin justificar'", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 10000, fecha: "2026-05-01" })];
    // kgCalibrador = 9700 (97%, sigue "procesado") -> mermaMedida = 300, pero solo 5 días en cámara -> techo = 10000*0.000553*5 = 27.65.
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 9700, part_id: "p1" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0, date: "2026-05-06" },
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.diasEnCamara).toBe(5);
    expect(resultado.mermaNaturalKg).toBe(300);
    const techo = 10000 * TASA_MERMA_NATURAL_DIA * 5;
    expect(resultado.mermaNaturalEstimadaKg).toBeCloseTo(techo); // pequeña
    expect(resultado.podridoPreCalibradorKg).toBeCloseTo(300 - techo); // la mayor parte, sin justificar
    expect(resultado.podridoPreCalibradorKg!).toBeGreaterThan(250); // casi todo sin justificar
  });

  it("mucho tiempo en cámara: la estimación se clampa a la medida y 'sin justificar' es 0", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, fecha: "2026-05-01" })];
    // kgCalibrador = 980 (98%, "procesado") -> mermaMedida = 20 (poca), pero 200 días en cámara -> techo = 1000*0.000553*200 = 110.6 (> 20).
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 980, part_id: "p1" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0, date: "2026-11-17" }, // 200 días tras 2026-05-01
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.diasEnCamara).toBe(200);
    expect(resultado.mermaNaturalKg).toBe(20);
    expect(resultado.mermaNaturalEstimadaKg).toBeCloseTo(20); // clampado a la medida, no al techo (110.6)
    expect(resultado.podridoPreCalibradorKg).toBeCloseTo(0);
  });
});

describe("computeMermaLotes — conservación exacta del desglose natural/sin-justificar", () => {
  it("mermaNaturalEstimadaKg + podridoPreCalibradorKg === max(0, mermaNaturalKg) sin redondeos", () => {
    const casos = [
      { kgEntrada: 10000, kgCalibrador: 9700, dias: 60 }, // clamp al techo (merma 3%, aún "procesado")
      { kgEntrada: 1000, kgCalibrador: 980, dias: 200 }, // clamp a la medida
      { kgEntrada: 5000, kgCalibrador: 4900, dias: 36 }, // intermedio
    ];
    for (const caso of casos) {
      const entradas = [entrada({ lote: "26050101", kg_entrada: caso.kgEntrada, fecha: "2026-05-01" })];
      const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: caso.kgCalibrador, part_id: "p1" }];
      const fechaFin = new Date(Date.UTC(2026, 4, 1) + caso.dias * 86400000).toISOString().slice(0, 10);
      const partes: ParteMermaInput[] = [
        { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0, date: fechaFin },
      ];
      const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);
      const mermaMedida = Math.max(0, resultado.mermaNaturalKg ?? 0);
      const suma = (resultado.mermaNaturalEstimadaKg ?? 0) + (resultado.podridoPreCalibradorKg ?? 0);
      expect(suma).toBeCloseTo(mermaMedida, 9);
    }
  });
});

describe("computeMermaLotes — diasEnCamara null: desglose null pero mermaNaturalKg (medida) intacta", () => {
  it("sin fecha de procesado (partes sin date), la merma medida se mantiene pero el desglose es null, no 0", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, fecha: "2026-05-01" })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 980, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }]; // sin date
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.diasEnCamara).toBeNull();
    expect(resultado.mermaNaturalKg).toBe(20); // medida intacta, no se toca
    expect(resultado.mermaNaturalEstimadaKg).toBeNull();
    expect(resultado.podridoPreCalibradorKg).toBeNull();
    expect(resultado.mermaNaturalEstimadaEur).toBeNull();
    expect(resultado.podridoPreCalibradorEur).toBeNull();
  });
});

describe("computeMermaLotes — merma negativa (calibradorSuperaEntrada): desglose null aunque haya fecha", () => {
  it("con fecha de procesado disponible, el desglose natural/sin-justificar sigue siendo null (no se estima sobre una merma negativa)", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, fecha: "2026-05-01" })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 1100, part_id: "p1" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0, date: "2026-06-01" },
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.calibradorSuperaEntrada).toBe(true);
    expect(resultado.diasEnCamara).toBe(31); // la fecha SÍ se conoce
    expect(resultado.mermaNaturalEstimadaKg).toBeNull();
    expect(resultado.podridoPreCalibradorKg).toBeNull();
  });
});

describe("computeMermaLotes — pctMermaSobreEntrada", () => {
  it("mermaNaturalKg / kgEntrada × 100, con el mismo signo que mermaNaturalKg", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 970, part_id: "p1" }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }]);
    expect(resultado.pctMermaSobreEntrada).toBeCloseTo(3); // 30/1000*100
  });

  it("null si el lote no está procesado (mermaNaturalKg null)", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000 })];
    const [resultado] = computeMermaLotes(entradas, [], [], []);
    expect(resultado.pctMermaSobreEntrada).toBeNull();
  });
});

describe("agregarMermaLotes — totales de natural estimada / sin justificar y contador sin desglose posible", () => {
  it("suma kg y € de ambos componentes y cuenta los lotes procesados sin diasEnCamara conocido", () => {
    const entradas = [
      // Procesado, con fecha -> desglosable.
      entrada({ lote: "26050101", kg_entrada: 10000, fecha: "2026-05-01", importe_total: 5000 }), // 0.5 €/kg
      // Procesado, SIN fecha de parte -> no desglosable (cuenta en nSinDesglosePosible).
      entrada({ lote: "26050102", kg_entrada: 1000, importe_total: 500 }),
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050101", kg_peso_total: 9700, part_id: "p1" },
      { lote_codigo: "26050102", kg_peso_total: 970, part_id: "p2" },
    ];
    const partes: ParteMermaInput[] = [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0, date: "2026-06-30" }, // 60 días
      { part_id: "p2", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }, // sin date
    ];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);
    const agregado = agregarMermaLotes(lotes);

    const lote1 = lotes.find((l) => l.lote === "26050101")!;
    expect(lote1.mermaNaturalEstimadaKg).not.toBeNull();
    const lote2 = lotes.find((l) => l.lote === "26050102")!;
    expect(lote2.diasEnCamara).toBeNull();

    expect(agregado.nSinDesglosePosible).toBe(1); // solo el lote 2
    expect(agregado.kgNaturalEstimadaTotal).toBeCloseTo(lote1.mermaNaturalEstimadaKg!);
    expect(agregado.kgPodridoPreCalibradorTotal).toBeCloseTo(lote1.podridoPreCalibradorKg!);
    expect(agregado.eurNaturalEstimadaTotal).toBeCloseTo(lote1.mermaNaturalEstimadaEur!);
    expect(agregado.eurPodridoPreCalibradorTotal).toBeCloseTo(lote1.podridoPreCalibradorEur!);
  });
});

describe("mermaLotesEnPeriodo", () => {
  it("filtra por fecha de entrada (inclusive en ambos extremos)", () => {
    const entradas = [
      entrada({ lote: "26042001", kg_entrada: 100, fecha: "2026-04-20" }),
      entrada({ lote: "26050101", kg_entrada: 100, fecha: "2026-05-01" }),
      entrada({ lote: "26053101", kg_entrada: 100, fecha: "2026-05-31" }),
      entrada({ lote: "26060101", kg_entrada: 100, fecha: "2026-06-01" }),
    ];
    const lotes = computeMermaLotes(entradas, [], [], []);
    const filtrados = mermaLotesEnPeriodo(lotes, "2026-05-01", "2026-05-31");
    expect(filtrados.map((l) => l.lote).sort()).toEqual(["26050101", "26053101"]);
  });
});

// ─── Cierre manual de lote (entradas_bascula.cerrado_at) ────────────────────

describe("computeMermaLotes — cerradoManualmente", () => {
  it("un lote sin cerrar con pct bajo (< 97%) queda 'parcial' y cerradoManualmente es false", () => {
    const entradas = [entrada({ lote: "26061203", kg_entrada: 24900 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26061203", kg_peso_total: 23360, part_id: "p1" }]; // 93.8%
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }]);
    expect(resultado.estado).toBe("parcial");
    expect(resultado.cerradoManualmente).toBe(false);
    expect(resultado.mermaNaturalKg).toBeNull();
  });

  it("caso real 26061203: cerrado_at fuerza 'procesado' aunque el calibrador no llegue al umbral, con la merma completa calculable", () => {
    // entrada 24.900 kg, calibrador 23.360 kg (93,8%) -> sin cerrar sería "parcial"
    // eterno. Cerrado manualmente: mermaMedida = 24900 - 23360 = 1540 kg. Con
    // ~30 días en cámara, natural ≈ 24900*0.000553*30 ≈ 413 kg y el resto
    // (≈1127 kg) es podrido pre-calibrador (asumido).
    const entradas = [entrada({ lote: "26061203", kg_entrada: 24900, fecha: "2026-06-12", cerrado_at: "2026-07-15T10:00:00Z" })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26061203", kg_peso_total: 23360, part_id: "p1" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0, date: "2026-07-12" }, // 30 dias
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.estado).toBe("procesado");
    expect(resultado.cerradoManualmente).toBe(true);
    expect(resultado.mermaNaturalKg).toBe(1540); // 24900 - 23360 - 0
    expect(resultado.calibradorSuperaEntrada).toBe(false);
    expect(resultado.diasEnCamara).toBe(30);

    const naturalEsperada = 24900 * TASA_MERMA_NATURAL_DIA * 30;
    expect(resultado.mermaNaturalEstimadaKg).toBeCloseTo(naturalEsperada, 3); // ≈ 413 kg
    expect(resultado.podridoPreCalibradorKg).toBeCloseTo(1540 - naturalEsperada, 3); // ≈ 1127 kg

    // Conservación exacta de siempre, también en un lote cerrado a mano.
    const suma = (resultado.mermaNaturalEstimadaKg ?? 0) + (resultado.podridoPreCalibradorKg ?? 0);
    expect(suma).toBeCloseTo(Math.max(0, resultado.mermaNaturalKg ?? 0), 9);
  });

  it("cerrado con calibrador > entrada: el flag calibradorSuperaEntrada y el signo negativo se mantienen intactos", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, cerrado_at: "2026-07-15T00:00:00Z" })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 1100, part_id: "p1" }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }]);

    expect(resultado.estado).toBe("procesado");
    expect(resultado.cerradoManualmente).toBe(true);
    expect(resultado.mermaNaturalKg).toBe(-100); // con signo, intacto
    expect(resultado.calibradorSuperaEntrada).toBe(true);
    expect(resultado.mermaNaturalEstimadaKg).toBeNull(); // no se estima sobre una merma negativa, cerrado o no
    expect(resultado.podridoPreCalibradorKg).toBeNull();
  });

  it("reabrir (cerrado_at null/undefined) vuelve al estado calculado por el pct normal", () => {
    const entradas = [entrada({ lote: "26061203", kg_entrada: 24900, cerrado_at: null })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26061203", kg_peso_total: 23360, part_id: "p1" }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }]);
    expect(resultado.estado).toBe("parcial"); // 93.8% < 97%, sin cierre manual
    expect(resultado.cerradoManualmente).toBe(false);
    expect(resultado.mermaNaturalKg).toBeNull();
  });
});

// ─── cierre_modo "sin_registro": exclusión total de mermas/podrido/pérdida ──
// Evidencia real (jul-2026): 121 de 174 lotes activos antiguos no tienen
// NINGÚN registro de procesado bajo su código (pasaron bajo códigos
// compuestos que acreditan a otro lote, o se vendieron sin procesar).
// Cerrarlos con el modo "con_analisis" (comportamiento original de
// cerrado_at) metería 2,5 M kg de merma/podrido FICTICIA en Económico; el
// modo "sin_registro" los saca del stock sin inventar esa pérdida.

describe("computeMermaLotes — cierre_modo 'sin_registro': exclusión total", () => {
  it("cerradoSinRegistro=true y TODO lo derivado de merma/podrido/pérdida sale null (no 0), aunque estado siga 'procesado'", () => {
    // Caso real: 24.900 kg de entrada, 0 kg de procesado bajo su propio
    // código (pasó bajo un compuesto que acreditó a otro lote).
    const entradas = [entrada({
      lote: "26061203", kg_entrada: 24900, importe_total: 10000,
      cerrado_at: "2026-07-16T10:00:00Z", cierre_modo: "sin_registro",
    })];
    const [resultado] = computeMermaLotes(entradas, [], [], []);

    expect(resultado.estado).toBe("procesado"); // el criterio de stock no cambia según el modo
    expect(resultado.cerradoManualmente).toBe(true);
    expect(resultado.cerradoSinRegistro).toBe(true);

    // Informativos, SIGUEN calculándose (no se anulan):
    expect(resultado.kgEntrada).toBe(24900);
    expect(resultado.kgCalibrador).toBe(0);
    expect(resultado.sinCoste).toBe(false);
    expect(resultado.costeTotalLote).toBeGreaterThan(0);

    // Todo lo derivado de merma/podrido/pérdida es null, no 0 ni un número inventado.
    expect(resultado.mermaNaturalKg).toBeNull();
    expect(resultado.calibradorSuperaEntrada).toBe(false);
    expect(resultado.pctMermaSobreEntrada).toBeNull();
    expect(resultado.mermaNaturalEstimadaKg).toBeNull();
    expect(resultado.mermaNaturalEstimadaEur).toBeNull();
    expect(resultado.podridoPreCalibradorKg).toBeNull();
    expect(resultado.podridoPreCalibradorEur).toBeNull();
    expect(resultado.podridoCalibradorKg).toBeNull();
    expect(resultado.podridoCalibradorFuente).toBe("desconocido");
    expect(resultado.podridoManualKg).toBeNull();
    expect(resultado.podridoDesconocido).toBe(false); // "excluido a propósito" no es lo mismo que "falta el dato"
    expect(resultado.perdidaMermaEur).toBeNull();
    expect(resultado.perdidaPodridoEur).toBeNull();
    expect(resultado.perdidaTotalEur).toBeNull();
    expect(resultado.pctPerdidaSobreCoste).toBeNull();
  });

  it("con cierre_modo 'con_analisis' explícito, el comportamiento es exactamente el original (no se excluye nada)", () => {
    const entradas = [entrada({
      lote: "26061203", kg_entrada: 24900, cerrado_at: "2026-07-16T10:00:00Z", cierre_modo: "con_analisis",
    })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26061203", kg_peso_total: 23360, part_id: "p1" }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }]);

    expect(resultado.cerradoSinRegistro).toBe(false);
    expect(resultado.mermaNaturalKg).toBe(1540); // 24900 - 23360, igual que el cierre "normal" de siempre
  });

  it("cerrado_at con cierre_modo NULL (cierres anteriores a la migración) se trata como 'con_analisis', por compat", () => {
    const entradas = [entrada({
      lote: "26061203", kg_entrada: 24900, cerrado_at: "2026-07-15T10:00:00Z", cierre_modo: null,
    })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26061203", kg_peso_total: 23360, part_id: "p1" }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }]);

    expect(resultado.cerradoSinRegistro).toBe(false);
    expect(resultado.mermaNaturalKg).toBe(1540); // comportamiento original de cerrado_at, sin cambios
  });

  it("sin cerrado_at, cierre_modo se ignora aunque venga 'sin_registro' por error de datos (no tiene sentido sin cierre)", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000, cierre_modo: "sin_registro" })]; // cerrado_at ausente
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 970, part_id: "p1" }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], []);

    expect(resultado.cerradoManualmente).toBe(false);
    expect(resultado.cerradoSinRegistro).toBe(false);
    expect(resultado.mermaNaturalKg).toBe(30); // criterio normal por umbral, sin exclusión
  });
});

describe("agregarMermaLotes — cierre_modo 'sin_registro': los agregados no lo cuentan", () => {
  it("nLotesCerradosSinRegistro/kgCerradosSinRegistro los informan, pero ningún otro total los incluye", () => {
    const entradas = [
      // Normal, procesado con coste: SÍ debe contar en todos los totales.
      entrada({ lote: "26050101", kg_entrada: 1000, importe_total: 500 }),
      // Cerrado sin_registro con 24.900 kg y 0 procesado: NO debe contar en
      // nProcesados/kgEntradaProcesados/podrido/pérdida/costeTotalConCoste.
      entrada({
        lote: "26061203", kg_entrada: 24900, importe_total: 10000,
        cerrado_at: "2026-07-16T10:00:00Z", cierre_modo: "sin_registro",
      }),
    ];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 970, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 5, kg_podrido_bolsa_basura: 2 }];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);
    const agregado = agregarMermaLotes(lotes);

    // Informativos: SÍ se cuentan aparte.
    expect(agregado.nLotesCerradosSinRegistro).toBe(1);
    expect(agregado.kgCerradosSinRegistro).toBe(24900);

    // nLotes es el total bruto (para eso está el desglose de arriba).
    expect(agregado.nLotes).toBe(2);
    // Pero nProcesados/kgEntradaProcesados excluyen al cerrado sin_registro:
    // solo el lote normal (1000 kg) cuenta como "procesado" para la merma.
    expect(agregado.nProcesados).toBe(1);
    expect(agregado.kgEntradaProcesados).toBe(1000);
    // Reconciliación: nLotes === nProcesados + nPendientesOParciales + nLotesCerradosSinRegistro.
    expect(agregado.nProcesados + agregado.nPendientesOParciales + agregado.nLotesCerradosSinRegistro).toBe(agregado.nLotes);

    // costeTotalConCoste excluye también el coste del lote sin_registro (su
    // pérdida es 0 forzado; incluir su coste diluiría el % de pérdida real).
    expect(agregado.costeTotalConCoste).toBe(500);
  });

  it("con varios lotes sin_registro, la suma de kg se acumula correctamente en kgCerradosSinRegistro", () => {
    const entradas = [
      entrada({ lote: "26061203", kg_entrada: 24900, cerrado_at: "2026-07-16T00:00:00Z", cierre_modo: "sin_registro" }),
      entrada({ lote: "26061204", kg_entrada: 5100, cerrado_at: "2026-07-16T00:00:00Z", cierre_modo: "sin_registro" }),
    ];
    const lotes = computeMermaLotes(entradas, [], [], []);
    const agregado = agregarMermaLotes(lotes);

    expect(agregado.nLotesCerradosSinRegistro).toBe(2);
    expect(agregado.kgCerradosSinRegistro).toBe(30000);
    expect(agregado.nProcesados).toBe(0);
  });
});

describe("agruparPerdidaPorProductor", () => {
  it("suma kg/€ por clave y conserva null en eurPerdido solo si NINGÚN ítem del grupo trae €", () => {
    const items: ItemPerdidaProductor[] = [
      { productorKey: "id:abc", productorLabel: "Finca A", kgEntrada: 1000, kgPerdido: 30, eurPerdido: 15 },
      { productorKey: "id:abc", productorLabel: "Finca A", kgEntrada: 500, kgPerdido: 10, eurPerdido: null },
      { productorKey: "nombre:Sin vincular", productorLabel: "Sin vincular", kgEntrada: 200, kgPerdido: 5, eurPerdido: null },
    ];
    const resultado = agruparPerdidaPorProductor(items);
    const abc = resultado.find((r) => r.key === "id:abc")!;
    const sinVincular = resultado.find((r) => r.key === "nombre:Sin vincular")!;

    expect(abc.kgEntrada).toBe(1500);
    expect(abc.kgPerdido).toBe(40);
    expect(abc.eurPerdido).toBe(15); // el segundo item (null) no lo pisa a null
    expect(abc.nLotes).toBe(2);

    expect(sinVincular.eurPerdido).toBeNull(); // ningún item del grupo traía €
    expect(sinVincular.kgPerdido).toBe(5);
  });
});

// ─── Podrido DESCONOCIDO (import histórico de campaña, jul 2026) ────────────
// Un parte sintético creado por el importador del histórico no trae podrido
// del calibrador (no hay ese dato en el export de producción): AMBAS
// columnas de ParteMermaInput llegan `null`, nunca 0. Sus lotes deben
// prorratear `null` ("desconocido"), no un 0 que se confundiría con un 0 real.

describe("computeMermaLotes — podrido DESCONOCIDO (parte sin dato, ambas columnas null)", () => {
  it("sin Informe LOTE: podridoCalibradorKg y podridoManualKg son null, fuente 'desconocido', podridoDesconocido=true", () => {
    const entradas = [entrada({ lote: "25101601", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "25101601", kg_peso_total: 1000, part_id: "p-historico" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p-historico", kg_podrido_calibrador_auto: null, kg_podrido_bolsa_basura: null },
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.estado).toBe("procesado");
    expect(resultado.podridoCalibradorKg).toBeNull();
    expect(resultado.podridoManualKg).toBeNull();
    expect(resultado.podridoCalibradorFuente).toBe("desconocido");
    expect(resultado.podridoDesconocido).toBe(true);
  });

  it("un parte real con 0 EXPLÍCITO sigue siendo 0 real, no se confunde con desconocido", () => {
    const entradas = [entrada({ lote: "26050101", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050101", kg_peso_total: 1000, part_id: "p1" }];
    const partes: ParteMermaInput[] = [{ part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.podridoCalibradorKg).toBe(0);
    expect(resultado.podridoManualKg).toBe(0);
    expect(resultado.podridoCalibradorFuente).toBe("prorrateo");
    expect(resultado.podridoDesconocido).toBe(false);
  });

  it("Informe LOTE real: el calibrador sigue siendo 'real' aunque el parte no traiga dato de podrido (el manual, sin fuente real, sí queda null)", () => {
    const entradas = [entrada({ lote: "26050102", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "26050102", kg_peso_total: 1000, part_id: "p-historico" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p-historico", kg_podrido_calibrador_auto: null, kg_podrido_bolsa_basura: null },
    ];
    const clasificacion: ClasificacionLoteInput[] = [{ lote_codigo: "26050102", clase: "(J) Podrido", peso_kg: 12 }];
    const [resultado] = computeMermaLotes(entradas, lotesDia, clasificacion, partes);

    expect(resultado.podridoCalibradorFuente).toBe("real");
    expect(resultado.podridoCalibradorKg).toBe(12); // el real manda, no depende del parte
    expect(resultado.podridoManualKg).toBeNull(); // el manual nunca tiene fuente "real"
    expect(resultado.podridoDesconocido).toBe(true); // sigue faltando el dato manual
  });

  it("mezcla: un parte CON dato y otro SIN dato para el mismo lote suma solo lo conocido y marca podridoDesconocido, sin caer a null completo", () => {
    const entradas = [entrada({ lote: "26050103", kg_entrada: 2000 })];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "26050103", kg_peso_total: 1000, part_id: "p-con-dato" },
      { lote_codigo: "26050103", kg_peso_total: 970, part_id: "p-historico" },
    ];
    const partes: ParteMermaInput[] = [
      { part_id: "p-con-dato", kg_podrido_calibrador_auto: 50, kg_podrido_bolsa_basura: 20 }, // cuota 100% de este parte (único lote)
      { part_id: "p-historico", kg_podrido_calibrador_auto: null, kg_podrido_bolsa_basura: null },
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    // Solo se suma la cuota del parte con dato (50/20, cuota 1 porque es el
    // único lote de ese parte); el parte histórico no aporta nada (no un 0).
    expect(resultado.podridoCalibradorKg).toBeCloseTo(50);
    expect(resultado.podridoManualKg).toBeCloseTo(20);
    expect(resultado.podridoCalibradorFuente).toBe("prorrateo");
    expect(resultado.podridoDesconocido).toBe(true); // falta el dato del segundo parte
  });

  it("perdidaPodridoEur trata el podrido desconocido (null) como 0 en la cuenta de €, documentado (subestima el lote marcado)", () => {
    const entradas = [entrada({ lote: "25101601", kg_entrada: 1000, importe_total: 500 })];
    const lotesDia: LoteDiaKgInput[] = [{ lote_codigo: "25101601", kg_peso_total: 1000, part_id: "p-historico" }];
    const partes: ParteMermaInput[] = [
      { part_id: "p-historico", kg_podrido_calibrador_auto: null, kg_podrido_bolsa_basura: null },
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.sinCoste).toBe(false);
    expect(resultado.perdidaPodridoEur).toBe(0); // (0 + 0) * costePorKg, no null: el € siempre es calculable, solo queda corto
    expect(resultado.podridoDesconocido).toBe(true);
  });
});

// ─── El precalibrado SÍ cuenta para kgCalibrador (regla revisada 2026-07-16) ─
// Verificado contra la BD real (jul-2026): de todos los lotes con alguna
// pasada de procesado, 837 tienen pasadas SOLO de productor real, 52 SOLO de
// productor PRECALIBRADO, y CERO lotes tienen pasadas de ambos tipos a la vez.
// computeMermaLotes nunca filtró por productor (LoteDiaKgInput no lo trae);
// lo que cambió es que useMermaLotes YA NO excluye las filas de precalibrado
// antes de llamar aquí (ver src/lib/mermaLote.ts / productoresCanonicos.ts).
// Estos tests documentan las dos caras de esa evidencia: el caso real (un
// lote cuyo ÚNICO procesado es una pasada PREC, antes se perdía) y el caso
// que la evidencia descarta (mezcla real+PREC en el mismo lote: 0 de 889).

describe("regla de negocio — el precalibrado SÍ cuenta para kgCalibrador", () => {
  it("un lote cuyo ÚNICO registro de procesado es una pasada de PRECALIBRADO con código real SÍ suma a kgCalibrador y queda 'procesado' (antes de la revisión quedaba con stock fantasma, p. ej. lote 25103101)", () => {
    const entradas = [entrada({ lote: "25103101", kg_entrada: 1000 })];
    // Único lotes_dia de este lote: una pasada de PRECALIBRADO (código
    // compuesto que normaliza al lote real). Sin la exclusión previa, este
    // lote no tenía NINGÚN otro registro de procesado.
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "25103101+25103102", kg_peso_total: 990, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [
      { part_id: "p1", kg_podrido_calibrador_auto: 0, kg_podrido_bolsa_basura: 0 },
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], partes);

    expect(resultado.kgCalibrador).toBe(990); // ya no 0 (stock fantasma)
    expect(resultado.estado).toBe("procesado"); // ya no "pendiente"
    expect(resultado.mermaNaturalKg).toBe(10);
  });

  it("si un lote tuviera pasadas de AMBOS tipos (real y PRECALIBRADO) con el mismo código, ambas se suman sin deduplicar por productor — escenario que la evidencia de la BD real descarta hoy (0 de 889 lotes mixtos), documentado por si cambiara en el futuro", () => {
    const entradas = [entrada({ lote: "25110707", kg_entrada: 1000 })];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "25110707", kg_peso_total: 990, part_id: "p1" }, // pasada real
      { lote_codigo: "25110707+25110606", kg_peso_total: 500, part_id: "p2" }, // pasada PRECALIBRADO, mismo lote
    ];
    const [resultado] = computeMermaLotes(entradas, lotesDia, [], []);
    expect(resultado.kgCalibrador).toBe(1490); // suma de las dos, sin filtrar por productor
  });
});

describe("agregarMermaLotes — nLotesPodridoDesconocido", () => {
  it("cuenta los lotes con podridoDesconocido=true, separado del resto de agregados", () => {
    const entradas = [
      entrada({ lote: "25101601", kg_entrada: 1000 }), // desconocido
      entrada({ lote: "26050101", kg_entrada: 1000 }), // normal, con dato
    ];
    const lotesDia: LoteDiaKgInput[] = [
      { lote_codigo: "25101601", kg_peso_total: 1000, part_id: "p-historico" },
      { lote_codigo: "26050101", kg_peso_total: 1000, part_id: "p1" },
    ];
    const partes: ParteMermaInput[] = [
      { part_id: "p-historico", kg_podrido_calibrador_auto: null, kg_podrido_bolsa_basura: null },
      { part_id: "p1", kg_podrido_calibrador_auto: 10, kg_podrido_bolsa_basura: 5 },
    ];
    const lotes = computeMermaLotes(entradas, lotesDia, [], partes);
    const agregado = agregarMermaLotes(lotes);

    expect(agregado.nLotes).toBe(2);
    expect(agregado.nLotesPodridoDesconocido).toBe(1);
  });
});
