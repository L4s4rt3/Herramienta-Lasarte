// La agregación de campaña por productor y finca (pérdida + Mercadona). Los
// invariantes que la separan de "sumar columnas": dos denominadores distintos,
// la merma solo de lotes terminados, y el mix del papel llevado a los kg
// conciliados con el factor por lote.
import { describe, expect, it } from "vitest";
import type { MermaLote } from "./mermaLote";
import { mixVacio, type MixLote } from "./mdnaMix";
import {
  agruparMermaMdna,
  construirFilasMermaMdna,
  esLoteImposible,
  filasDelRanking,
  metricasMdna,
  metricasPerdida,
  ordenarPorPerdida,
  podridoPorMesDeProceso,
  totalMermaMdna,
} from "./mermaMdnaAgregado";

function lote(partial: Partial<MermaLote> & { lote: string }): MermaLote {
  return {
    fecha: "2026-05-01",
    kgEntrada: 10000,
    kgAjuste: 0,
    kgCalibrador: 9000,
    estado: "procesado",
    cerradoSinRegistro: false,
    diasEnCamara: 10,
    mermaNaturalKg: 1000,
    mermaNaturalEstimadaKg: 600,
    mermaCamaraReal: false,
    podridoPreCalibradorKg: 400,
    podridoPreCalibradorEsperadoKg: 300,
    podridoPreCalibradorNoVistoKg: 0,
    podridoPreCalibradorSinMargen: false,
    podridoCalibradorKg: 200,
    podridoCalibradorFuente: "real",
    podridoManualKg: 50,
    perdidaTotalEur: 500,
    costeTotalLote: 4000,
    ...partial,
  } as MermaLote;
}

function mixCon(kgClasificado: number, mdna3: number): MixLote {
  const m = mixVacio();
  m.kgClasificado = kgClasificado;
  m.kgExportacion = kgClasificado;
  m.kgClaseApta = kgClasificado;
  m.mdna.MA3KGC = mdna3;
  m.mdnaTotal = mdna3;
  return m;
}

const ENTRADAS = [
  { lote: "26050101", agricultor: "FINCA SUR S.L.", finca: "Sur Alta", articulo: "NARANJA" , kg_entrada: 10000 },
  { lote: "26050102", agricultor: "FINCA SUR S.L.", finca: "Sur Baja", articulo: "NARANJA", kg_entrada: 5000 },
  { lote: "26050103", agricultor: "Precalibrado", finca: "", articulo: "NARANJA", kg_entrada: 3000 },
];

function filasDeEjemplo() {
  const mermaLotes = [
    lote({ lote: "26050101" }),
    // Abierto: sin merma calculable, pero con podrido de calibrador (cuenta en la base solo lo pasado por línea).
    lote({ lote: "26050102", estado: "parcial", kgEntrada: 5000, kgCalibrador: 2000, mermaNaturalKg: null, mermaNaturalEstimadaKg: null, podridoPreCalibradorKg: null, podridoCalibradorKg: 100, diasEnCamara: null }),
    // Movimiento interno (precalibrado): fuera de los rankings.
    lote({ lote: "26050103", kgEntrada: 3000, kgCalibrador: 3000, mermaNaturalKg: 0 }),
  ];
  const mixPorLote = new Map<string, MixLote>([
    ["26050101", mixCon(9500, 4750)], // el papel pesa 9.500 y el conciliado 9.000 → factor 0,947
  ]);
  return construirFilasMermaMdna({
    mermaLotes,
    entradas: ENTRADAS,
    mixPorLote,
    nombrePorProductorId: new Map(),
    aliasPorNombre: new Map(),
  });
}

describe("construirFilasMermaMdna", () => {
  it("pone nombre, finca y mix a cada lote y marca los internos", () => {
    const filas = filasDeEjemplo();
    expect(filas).toHaveLength(3);
    const f = filas[0];
    expect(f.productor).toBe("FINCA SUR S.L.");
    expect(f.finca).toBe("Sur Alta");
    expect(f.mermaMedidaKg).toBe(1000);
    expect(f.perdidaKg).toBe(1200); // merma medida + podrido calibrador
    expect(f.factorConciliado).toBeCloseTo(9000 / 9500, 6);
    expect(filas[1].mermaMedidaKg).toBeNull();
    expect(filas[1].perdidaKg).toBeNull();
    expect(filas[2].interno).toBe(true);
  });

  it("un lote que pierde más de lo que entró o con ajuste negativo es imposible", () => {
    const [f] = construirFilasMermaMdna({
      mermaLotes: [lote({ lote: "26050101", mermaNaturalKg: 20000 })],
      entradas: ENTRADAS, mixPorLote: new Map(), nombrePorProductorId: new Map(), aliasPorNombre: new Map(),
    });
    expect(esLoteImposible(f)).toBe(true);
    expect(filasDelRanking([f])).toHaveLength(0);
  });
});

describe("agruparMermaMdna y métricas", () => {
  it("dos denominadores: merma sobre terminados, pérdida total sobre terminados + lo pasado de los abiertos con podrido", () => {
    const filas = filasDelRanking(filasDeEjemplo());
    expect(filas).toHaveLength(2);
    const [g] = agruparMermaMdna(filas, "productor");
    expect(g.nLotes).toBe(2);
    expect(g.nLotesConMerma).toBe(1);
    expect(g.nLotesSinMerma).toBe(1);
    expect(g.kgEntradaTotal).toBe(15000);
    expect(g.kgEntradaBase).toBe(10000);
    expect(g.kgBasePctPerdida).toBe(12000); // 10.000 del terminado + 2.000 pasados del abierto
    expect(g.mermaMedidaKg).toBe(1000);
    expect(g.mermaCamaraKg).toBe(600);
    expect(g.podridoPreKg).toBe(400);
    expect(g.podridoCalibradorKg).toBe(300);
    expect(g.perdidaKg).toBe(1300);
    const m = metricasPerdida(g);
    expect(m.pctMermaCamara).toBeCloseTo(6, 6);
    expect(m.pctPodridoPre).toBeCloseTo(4, 6);
    expect(m.pctPerdida).toBeCloseTo((1300 / 12000) * 100, 6);
    expect(m.diasMedio).toBe(10);
  });

  it("el mix del papel se lleva a los kg conciliados con el factor del lote", () => {
    const filas = filasDelRanking(filasDeEjemplo());
    const total = totalMermaMdna(filas);
    expect(total.nLotesSinClasificacion).toBe(1);
    expect(total.kgClasificado).toBe(9500);
    expect(total.mdnaAjustado.MA3KGC).toBeCloseTo(4750 * (9000 / 9500), 6);
    expect(total.mdnaTotalClasificado).toBe(4750);
    const m = metricasMdna(total);
    expect(m.pctMdnaSobreEntrada).toBeCloseTo((4500 / 15000) * 100, 6);
    expect(m.pctMdnaSobreProcesado).toBeCloseTo((4500 / 11000) * 100, 6);
    expect(m.pctClaseApta).toBe(100);
  });

  it("por productor+finca separa las fincas del mismo productor", () => {
    const grupos = agruparMermaMdna(filasDelRanking(filasDeEjemplo()), "productor_finca");
    expect(grupos.map((g) => g.finca).sort()).toEqual(["Sur Alta", "Sur Baja"]);
  });

  it("ordena por % de pérdida, peor primero", () => {
    const filas = filasDelRanking(filasDeEjemplo());
    const grupos = ordenarPorPerdida(agruparMermaMdna(filas, "productor_finca"));
    expect(grupos[0].finca).toBe("Sur Alta"); // la única con % calculable
  });
});

describe("podridoPorMesDeProceso", () => {
  it("cruza lo pesado por mes de parte con lo asumido por mes de proceso (entrada + días en cámara)", () => {
    const filas = filasDelRanking(filasDeEjemplo());
    const partes = [
      { date: "2026-05-03", kg_podrido_bolsa_basura: 120, kg_podrido_bateas: 30 },
      { date: "2026-05-20", kg_podrido_bolsa_basura: 80, kg_podrido_bateas: null },
    ];
    const meses = podridoPorMesDeProceso(filas, partes);
    expect(meses).toHaveLength(1);
    expect(meses[0].mes).toBe("2026-05");
    expect(meses[0].lotes).toBe(1); // el abierto no tiene días en cámara
    expect(meses[0].asumido).toBe(400);
    expect(meses[0].bolsa).toBe(200);
    expect(meses[0].bateas).toBe(30);
    expect(meses[0].pesadoTotal).toBe(230);
    expect(meses[0].partesConDato).toBe(2);
  });
});
