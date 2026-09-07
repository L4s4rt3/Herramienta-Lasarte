// Lo que la pantalla del calibrador dice del reparto canónico (04-09-2026) sale
// de resumir las filas de calibrador_pasada_reparto: pasadas = batch_id
// distintos, kg movidos = lo que NO se quedó en el primer código (orden > 1),
// y el método de cada pasada. Y el ranking sigue sin precalibrado ni huecos.
import { describe, expect, it } from "vitest";
import { esProductorReal, resumirReparto, type FilaPasadaReparto } from "./useCalibradorAprovechamiento";

const fila = (batch_id: number, orden: number, kg: number | string, metodo: string, lote8 = "26013107"): FilaPasadaReparto =>
  ({ batch_id, orden, kg, metodo, lote8, fraccion: null });

describe("resumirReparto", () => {
  it("cuenta cada pasada una vez y solo mueve lo que no se quedó en el primer código", () => {
    const r = resumirReparto([
      // 26013107+26012608 por capacidad: 3.000 kg se quedan, 2.000 van al segundo lote.
      fila(101, 1, 3000, "capacidad"),
      fila(101, 2, 2000, "capacidad", "26012608"),
      // 26051904 +7 BOX DE RECICLAJE por box: 900 se quedan, 100 salen (el numeric puede llegar como texto).
      fila(102, 1, "900", "box"),
      fila(102, 2, "100", "box", "26051905"),
      // Una a mano con tres lotes: 500 + 300 + 200.
      fila(103, 1, 500, "manual"),
      fila(103, 2, 300, "manual", "26060101"),
      fila(103, 3, 200, "manual", "26060102"),
    ]);
    expect(r.pasadas).toBe(3);
    expect(r.kgMovidos).toBe(2000 + 100 + 500);
    // De más a menos kilos movidos, con su etiqueta en castellano.
    expect(r.porMetodo.map((m) => [m.metodo, m.pasadas, m.kgMovidos])).toEqual([
      ["capacidad", 1, 2000],
      ["manual", 1, 500],
      ["box", 1, 100],
    ]);
    expect(r.porMetodo[0].etiqueta).toBe("por la capacidad pendiente de cada lote");
  });

  it("sin filas no hay reparto; una pasada con una sola fila no mueve nada", () => {
    expect(resumirReparto([])).toEqual({ pasadas: 0, kgMovidos: 0, porMetodo: [] });
    const r = resumirReparto([fila(7, 1, 1000, "capacidad")]);
    expect(r.pasadas).toBe(1);
    expect(r.kgMovidos).toBe(0);
  });

  it("un método desconocido no rompe: se enseña entre comillas", () => {
    const r = resumirReparto([fila(9, 1, 10, "otro"), fila(9, 2, 5, "otro", "26070101")]);
    expect(r.porMetodo[0].etiqueta).toBe("por «otro»");
  });
});

describe("esProductorReal", () => {
  it("excluye del ranking al precalibrado, los movimientos internos y los huecos entre paréntesis", () => {
    expect(esProductorReal({ productor_id: "x", productor: "INVERMARMELO - GG" })).toBe(true);
    expect(esProductorReal({ productor_id: null, productor: "PRECALIBRADO" })).toBe(false);
    expect(esProductorReal({ productor_id: null, productor: "(sin lote legible en el nombre de la pasada)" })).toBe(false);
    expect(esProductorReal({ productor_id: null, productor: "(precalibrado sin origen)" })).toBe(false);
  });
});
