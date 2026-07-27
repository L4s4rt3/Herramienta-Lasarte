import { describe, expect, it } from "vitest";
import { casarMermaCamara, parseMermaCamaraRows, type EntradaParaCasarMerma } from "./mermaCamaraImport";

const HEADER = [
  "Fecha almacenamiento", "Procedencia", "Su Ref.", "Agricultor", "Finca", "Variedad",
  "Fecha entrada LST", "Días almacén", "Peso inicial", "Peso final", "Merma", "% Merma",
];

describe("parseMermaCamaraRows", () => {
  it("parsea el formato real (fila de Dehesilla S26/100148: 21.580 → 20.760 = 820 kg)", () => {
    const { registros, descartadas } = parseMermaCamaraRows([
      HEADER,
      [new Date(2026, 3, 28), "Guadex", "S26/100148", "Frubezar", "Dehesilla", "Valencia", new Date(2026, 6, 7), 70, 21580, 20760, 820, 0.038],
    ]);
    expect(descartadas).toHaveLength(0);
    expect(registros[0]).toMatchObject({
      fechaAlmacenamiento: "2026-04-28",
      fechaSalida: "2026-07-07",
      ref: "S26/100148",
      finca: "Dehesilla",
      pesoInicial: 21580,
      pesoFinal: 20760,
      mermaKg: 820,
    });
  });

  it("descarta filas sin fecha o con peso final mayor que el inicial (error de registro)", () => {
    const { registros, descartadas } = parseMermaCamaraRows([
      HEADER,
      [null, "", "", "", "", "", null, 0, 21000, 20000, 1000, 0],
      [new Date(2026, 3, 28), "", "", "", "", "", null, 0, 20000, 21000, -1000, 0],
    ]);
    expect(registros).toHaveLength(0);
    expect(descartadas).toHaveLength(2);
  });
});

describe("casarMermaCamara", () => {
  const entradas: EntradaParaCasarMerma[] = [
    { id: "a", lote: "26042811", fecha: "2026-04-28", kg_entrada: 21580, finca: "Dehesilla - GG" },
    { id: "b", lote: "26042810", fecha: "2026-04-28", kg_entrada: 20600, finca: "INVERMARMELO - GG" },
    { id: "c", lote: "26042812", fecha: "2026-04-28", kg_entrada: 21580, finca: "Otra Finca" },
  ];
  const registro = (over: Partial<Parameters<typeof casarMermaCamara>[0][number]>) => ({
    fechaAlmacenamiento: "2026-04-28",
    fechaSalida: "2026-07-07",
    ref: null,
    finca: null,
    pesoInicial: 21580,
    pesoFinal: 20760,
    mermaKg: 820,
    ...over,
  });

  it("casa por (fecha, kg exactos) y desambigua por finca cuando hay empate", () => {
    const res = casarMermaCamara([registro({ finca: "Dehesilla" })], entradas);
    expect(res.casados).toHaveLength(1);
    expect(res.casados[0].lote).toBe("26042811");
    expect(res.ambiguos).toHaveLength(0);
  });

  it("empate sin finca que desambigüe → ambiguo, nunca se adivina", () => {
    const res = casarMermaCamara([registro({ finca: null })], entradas);
    expect(res.casados).toHaveLength(0);
    expect(res.ambiguos).toHaveLength(1);
  });

  it("sin candidata con (fecha, kg) exactos → sin casar", () => {
    const res = casarMermaCamara([registro({ pesoInicial: 99999 })], entradas);
    expect(res.sinCasar).toHaveLength(1);
  });

  it("una entrada no se casa dos veces (dos registros iguales → el segundo queda ambiguo o sin casar)", () => {
    const res = casarMermaCamara(
      [registro({ finca: "Dehesilla" }), registro({ finca: "Dehesilla" })],
      entradas,
    );
    expect(res.casados).toHaveLength(1);
    expect(res.sinCasar.length + res.ambiguos.length).toBe(1);
  });
});

describe("casarMermaCamara — casado aproximado (casos reales del archivo de 39 camiones, jul-2026)", () => {
  it("caso real S26/100201: (fecha, kg) exactos con candidata única pero finca mal escrita en el papel → casa con aviso", () => {
    const entradas: EntradaParaCasarMerma[] = [
      { id: "x", lote: "26050714", fecha: "2026-05-07", kg_entrada: 21640, finca: "La Vega de Santa Lucia" },
    ];
    const res = casarMermaCamara(
      [{ fechaAlmacenamiento: "2026-05-07", fechaSalida: "2026-07-16", ref: "S26/100201", finca: "La Torrecilla", pesoInicial: 21640, pesoFinal: 21240, mermaKg: 400 }],
      entradas,
    );
    expect(res.casados).toHaveLength(1);
    expect(res.casados[0].lote).toBe("26050714");
    expect(res.casados[0].aviso).toContain("finca");
  });

  it("finca distinta con VARIAS candidatas exactas → sigue sin casarse (el par exacto solo pesa más si es único)", () => {
    const entradas: EntradaParaCasarMerma[] = [
      { id: "x", lote: "L1", fecha: "2026-05-07", kg_entrada: 21640, finca: "Finca A" },
      { id: "y", lote: "L2", fecha: "2026-05-07", kg_entrada: 21640, finca: "Finca B" },
    ];
    const res = casarMermaCamara(
      [{ fechaAlmacenamiento: "2026-05-07", fechaSalida: null, ref: null, finca: "Finca C", pesoInicial: 21640, pesoFinal: 21240, mermaKg: 400 }],
      entradas,
    );
    expect(res.casados).toHaveLength(0);
    expect(res.sinCasar).toHaveLength(1);
  });

  it("caso real 26042812: kg del papel (20.860) ≠ báscula (20.960), único lote de esa finca ese día → casa con aviso", () => {
    const entradas: EntradaParaCasarMerma[] = [
      { id: "v", lote: "26042812", fecha: "2026-04-28", kg_entrada: 20960, finca: "VALLEJO" },
      { id: "d", lote: "26042811", fecha: "2026-04-28", kg_entrada: 21580, finca: "Dehesilla - GG" },
    ];
    const res = casarMermaCamara(
      [{ fechaAlmacenamiento: "2026-04-28", fechaSalida: "2026-07-13", ref: "S26/100149", finca: "Vallejo", pesoInicial: 20860, pesoFinal: 20400, mermaKg: 460 }],
      entradas,
    );
    expect(res.casados).toHaveLength(1);
    expect(res.casados[0].lote).toBe("26042812");
    expect(res.casados[0].aviso).toContain("kg");
  });

  it("dos candidatas dentro de la tolerancia el mismo día → ambiguo, nunca se adivina", () => {
    // Caso plausible: 26052003 (25.520) y 26052004 (25.500) son Colombo del
    // mismo día con 20 kg de diferencia; un papel con 25.510 no debe elegir.
    const entradas: EntradaParaCasarMerma[] = [
      { id: "a", lote: "26052003", fecha: "2026-05-20", kg_entrada: 25520, finca: "COLOMBO - GG" },
      { id: "b", lote: "26052004", fecha: "2026-05-20", kg_entrada: 25500, finca: "COLOMBO - GG" },
    ];
    const res = casarMermaCamara(
      [{ fechaAlmacenamiento: "2026-05-20", fechaSalida: null, ref: null, finca: "Colombo", pesoInicial: 25510, pesoFinal: 25000, mermaKg: 510 }],
      entradas,
    );
    expect(res.casados).toHaveLength(0);
    expect(res.ambiguos).toHaveLength(1);
  });

  it("kg fuera de la tolerancia (1 %) → sin casar", () => {
    const entradas: EntradaParaCasarMerma[] = [
      { id: "a", lote: "L1", fecha: "2026-05-20", kg_entrada: 26000, finca: "Colombo" },
    ];
    const res = casarMermaCamara(
      [{ fechaAlmacenamiento: "2026-05-20", fechaSalida: null, ref: null, finca: "Colombo", pesoInicial: 25500, pesoFinal: 25000, mermaKg: 500 }],
      entradas,
    );
    expect(res.casados).toHaveLength(0);
    expect(res.sinCasar).toHaveLength(1);
  });

  it("el casado exacto reclama su entrada ANTES que cualquier aproximado (aunque el aproximado venga primero en el archivo)", () => {
    const entradas: EntradaParaCasarMerma[] = [
      { id: "a", lote: "L1", fecha: "2026-05-20", kg_entrada: 25500, finca: "Colombo" },
    ];
    const aproximado = { fechaAlmacenamiento: "2026-05-20", fechaSalida: null, ref: "aprox", finca: "Colombo", pesoInicial: 25460, pesoFinal: 25000, mermaKg: 460 };
    const exacto = { fechaAlmacenamiento: "2026-05-20", fechaSalida: null, ref: "exacto", finca: "Colombo", pesoInicial: 25500, pesoFinal: 25100, mermaKg: 400 };
    const res = casarMermaCamara([aproximado, exacto], entradas);
    expect(res.casados).toHaveLength(1);
    expect(res.casados[0].registro.ref).toBe("exacto");
    expect(res.casados[0].aviso).toBeUndefined();
    expect(res.sinCasar[0]?.ref).toBe("aprox");
  });
});
