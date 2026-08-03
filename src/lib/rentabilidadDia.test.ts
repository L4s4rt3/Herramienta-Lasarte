// Tests de la lib pura de "Rentabilidad del día". Los casos de clasificación
// usan productos REALES de los Informes LOTE de julio 2026; el caso completo
// reproduce en miniatura la metodología validada a mano con los días 29-31.
import { describe, expect, it } from "vitest";
import {
  clasificarDestinoRentabilidad,
  computeRentabilidadDia,
  esMdnaSinFormato,
  personalDiaEur,
  preciosMdnaDesdeSemana,
  PRECIOS_RENTABILIDAD_DEFECTO,
  type FilaClasifRentabilidad,
  type OpcionesRentabilidad,
} from "@/lib/rentabilidadDia";

const OPCIONES: OpcionesRentabilidad = {
  precios: { ...PRECIOS_RENTABILIDAD_DEFECTO, mdna3: 1.21, mdna4: 0.86, mdna5: 0.99, mdnaGranel: 1.41 },
  horasJornada: 7,
  suministrosDiaEur: 600,
  costeHoraMedio: 8.34,
};

describe("clasificarDestinoRentabilidad", () => {
  it("clasifica productos reales del calibrador", () => {
    expect(clasificarDestinoRentabilidad("MDNA 3KG D-PACK CAL 4/5 (73/92M)", "(A) Extra 1")).toBe("mdna3");
    expect(clasificarDestinoRentabilidad("MDNA 4K EXP. CAL 6/8 (4/70-5/80)", "(B) Extra 2")).toBe("mdna4");
    expect(clasificarDestinoRentabilidad("MDNA 4K GIRSAC CAL 6/8 MALLA EXTRUSIONADA", "(C) Cat1 A")).toBe("mdna4");
    expect(clasificarDestinoRentabilidad("MDNA 5K D-PACK CAL 5/6 PURO", "(A) Extra 1")).toBe("mdna5");
    expect(clasificarDestinoRentabilidad("MDNA GRANEL  CAL 3/4 -3/54-3/60", "(A) Extra 1")).toBe("mdnaGranel");
    expect(clasificarDestinoRentabilidad("PREC 2-MDNA 3K Y 5KG", "(A) Extra 1")).toBe("prec");
    expect(clasificarDestinoRentabilidad("PREC CAMPO 4K MDNA", "(A) Extra 1")).toBe("prec");
    expect(clasificarDestinoRentabilidad("INDUSTRIA", "(H) Industria")).toBe("industria");
    expect(clasificarDestinoRentabilidad("INDUSTRIA PODRIO", "(H) Industria")).toBe("industria");
    expect(clasificarDestinoRentabilidad("LA FEA GRANELERA CAL 6/7", "(A) Extra 1")).toBe("otrosGranel");
    expect(clasificarDestinoRentabilidad("LA FEA GRANEL CAL 7/8 MESAS", "(A) Extra 1")).toBe("otrosGranel");
    expect(clasificarDestinoRentabilidad("PROSOL  CAL 7/8", "(A) Extra 1")).toBe("otrosGranel");
    expect(clasificarDestinoRentabilidad("LA FEA EMP CAL 3--3/54-3/60", "(A) Extra 1")).toBe("otrosEmp");
    expect(clasificarDestinoRentabilidad("VAN OOIJEN CAL 1/36", "(A) Extra 1")).toBe("otrosEmp");
    expect(clasificarDestinoRentabilidad("-MUESTRA-", "(A) Extra 1")).toBe("muestra");
  });

  it("la clase (J) manda sobre el producto: podrido dentro del box de industria NO se cobra", () => {
    expect(clasificarDestinoRentabilidad("INDUSTRIA", "(J) Podrido")).toBe("podrido");
    expect(clasificarDestinoRentabilidad("MDNA 5K D-PACK CAL 5/6 PURO", "(J) Podrido")).toBe("podrido");
  });

  it("un MDNA de formato desconocido cae a girsac 4 kg y se detecta para avisar", () => {
    expect(clasificarDestinoRentabilidad("MDNA 8K FUTURO", "(A) Extra 1")).toBe("mdna4");
    expect(esMdnaSinFormato("MDNA 8K FUTURO")).toBe(true);
    expect(esMdnaSinFormato("MDNA 3KG D-PACK CAL 4/5")).toBe(false);
    expect(esMdnaSinFormato("LA FEA EMP CAL 2")).toBe(false);
  });
});

describe("personalDiaEur", () => {
  it("suma nóminas conocidas y aplica la media a los presentes sin coste", () => {
    // 2 presentes con coste (8 + 10 €/h) + 1 sin coste a 8,34, jornada de 7 h.
    expect(personalDiaEur({ presentes: 3, sumaCosteHoraConocida: 18, presentesSinCoste: 1 }, 7, 8.34)).toBeCloseTo((18 + 8.34) * 7, 6);
  });
});

describe("preciosMdnaDesdeSemana", () => {
  it("convierte los métodos de la hoja semanal en €/kg y descarta semanas sin base", () => {
    const precios = preciosMdnaDesdeSemana([
      { metodo: "MA3KGC", kilos: 31728, base_iva: 38390.88 },
      { metodo: "MA12KGC", kilos: 18148, base_iva: 25588.68 },
      { metodo: "MA4KGC", kilos: 1000, base_iva: 0 }, // sin facturar: no fija precio 0
      { metodo: "OTRA", kilos: 10, base_iva: 10 },
    ]);
    expect(precios.mdna3).toBeCloseTo(1.21, 3);
    expect(precios.mdnaGranel).toBeCloseTo(1.41, 3);
    expect(precios.mdna4).toBeUndefined();
    expect(precios.mdna5).toBeUndefined();
  });
});

describe("computeRentabilidadDia", () => {
  const fila = (over: Partial<FilaClasifRentabilidad>): FilaClasifRentabilidad => ({
    lote_codigo: "26051504",
    productor: "COLOMBO",
    producto: "MDNA 5K D-PACK CAL 5/6 PURO",
    clase: "(A) Extra 1",
    peso_kg: 1000,
    toneladas_hora: 15.3,
    duracion_min: 100,
    ...over,
  });

  it("cuadra ingresos, margen y beneficio en un día de dos lotes", () => {
    const filas: FilaClasifRentabilidad[] = [
      // Lote A (26051504, 100 min): 1.000 kg a 5 kg + 500 kg granel MDNA + 100 kg podrido en box industria.
      fila({ peso_kg: 1000 }),
      fila({ producto: "MDNA GRANEL CAL 3/4", peso_kg: 500 }),
      fila({ producto: "INDUSTRIA", clase: "(J) Podrido", peso_kg: 100 }),
      // Lote B (26051901, 50 min): 300 kg industria + 200 kg emp otros. Sin fruta liquidada.
      fila({ lote_codigo: "26051901+2 BOX", productor: "LA TORRECILLA", producto: "INDUSTRIA", clase: "(H) Industria", peso_kg: 300, duracion_min: 50 }),
      fila({ lote_codigo: "26051901+2 BOX", productor: "LA TORRECILLA", producto: "VAN OOIJEN CAL 1/36", peso_kg: 200, duracion_min: 50 }),
    ];
    const fruta = new Map([["26051504", { eurKg: 0.7 }]]); // el 26051901 NO está liquidado
    const personal = { presentes: 2, sumaCosteHoraConocida: 20, presentesSinCoste: 0 };
    const dia = computeRentabilidadDia(filas, fruta, personal, OPCIONES);

    // Ingresos: 1000×0,99 + 500×1,41 + 100×0 (podrido) + 300×0,14 + 200×0,50 = 1.837 €
    expect(dia.ingresosEur).toBeCloseTo(1837, 6);
    expect(dia.kgTotal).toBe(2100);
    expect(dia.kgPorDestino.podrido).toBe(100);
    // Envase: 1000×0,0485 + 500×0,02 + 200×0,04 = 66,5 €
    expect(dia.envaseEur).toBeCloseTo(66.5, 6);
    // Personal: 20 €/h × 7 h = 140 €. Margen = 1.837 − 66,5 − 140 − 600.
    expect(dia.personalEur).toBeCloseTo(140, 6);
    expect(dia.margenEur).toBeCloseTo(1837 - 66.5 - 140 - 600, 6);
    // Fruta: solo el lote A (1.600 kg × 0,7). El B queda como kg sin coste.
    expect(dia.frutaEur).toBeCloseTo(1600 * 0.7, 6);
    expect(dia.kgSinCosteFruta).toBe(500);
    expect(dia.beneficioEur).toBeCloseTo(dia.margenEur - 1600 * 0.7, 6);

    // Reparto por minutos de línea: A 100/150, B 50/150.
    const a = dia.lotes.find((l) => l.loteCodigo === "26051504")!;
    const b = dia.lotes.find((l) => l.loteCodigo.startsWith("26051901"))!;
    expect(a.personalEur).toBeCloseTo((140 * 100) / 150, 6);
    expect(b.suministrosEur).toBeCloseTo((600 * 50) / 150, 6);
    expect(b.loteBase).toBe("26051901");
    expect(b.frutaEur).toBeNull();
    expect(b.beneficioEur).toBeNull();
    expect(a.beneficioEur).toBeCloseTo(a.margenEur - 1600 * 0.7, 6);
    // Conservación: la suma de márgenes por lote = margen del día.
    expect(a.margenEur + b.margenEur).toBeCloseTo(dia.margenEur, 6);
    // % del lote A: 100 podrido / 1.600 kg.
    expect(a.pctPodrido).toBeCloseTo(6.25, 6);
  });

  it("sin duración en algún lote reparte por kg, y sin filas devuelve un día a cero", () => {
    const filas: FilaClasifRentabilidad[] = [
      fila({ peso_kg: 750, duracion_min: null }),
      fila({ lote_codigo: "26051901", producto: "INDUSTRIA", clase: "(H) Industria", peso_kg: 250, duracion_min: 50 }),
    ];
    const dia = computeRentabilidadDia(filas, new Map(), { presentes: 0, sumaCosteHoraConocida: 0, presentesSinCoste: 0 }, OPCIONES);
    const a = dia.lotes.find((l) => l.loteCodigo === "26051504")!;
    expect(a.suministrosEur).toBeCloseTo(600 * 0.75, 6); // reparto por kg (750/1000)

    const vacio = computeRentabilidadDia([], new Map(), { presentes: 0, sumaCosteHoraConocida: 0, presentesSinCoste: 0 }, OPCIONES);
    expect(vacio.kgTotal).toBe(0);
    expect(vacio.margenEurKg).toBeNull();
    expect(vacio.lotes).toHaveLength(0);
  });
});
