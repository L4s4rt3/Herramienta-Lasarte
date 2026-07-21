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
