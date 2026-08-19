import { describe, expect, it } from "vitest";
import {
  asuntoVentasMercadona,
  partirEnSemanas,
  renderVentasMercadonaHtml,
  renderVentasMercadonaTexto,
  resumirVentasSemana,
  type DatosCorreoMercadona,
  type PaletVenta,
} from "./ventasMercadona";

const palet = (numero: string, cajas: number, kg: number, fecha: string): PaletVenta =>
  ({ numero, num_cajas: cajas, kg_netos: kg, fecha });

describe("resumirVentasSemana", () => {
  it("cuenta palets distintos, cajas y kg", () => {
    const r = resumirVentasSemana([
      palet("P1", 24, 300, "2026-08-10"),
      palet("P2", 24, 300, "2026-08-11"),
      palet("P3", 20, 250, "2026-08-12"),
    ]);
    expect(r).toEqual({ palets: 3, cajas: 68, kg: 850 });
  });

  it("un número de palet repetido no se cuenta dos veces (pero sus cajas/kg sí suman)", () => {
    const r = resumirVentasSemana([
      palet("P1", 24, 300, "2026-08-10"),
      palet("P1", 1, 12, "2026-08-10"),
    ]);
    expect(r.palets).toBe(1);
    expect(r.cajas).toBe(25);
  });

  it("filas sin número no rompen el recuento", () => {
    const r = resumirVentasSemana([{ numero: null, num_cajas: 5, kg_netos: 60, fecha: "2026-08-10" }]);
    expect(r).toEqual({ palets: 0, cajas: 5, kg: 60 });
  });

  it("una semana vacía es 0, no un fallo", () => {
    expect(resumirVentasSemana([])).toEqual({ palets: 0, cajas: 0, kg: 0 });
  });
});

describe("partirEnSemanas", () => {
  it("separa la semana objetivo de la anterior por el lunes", () => {
    const filas = [
      palet("A", 1, 1, "2026-08-03"), // anterior
      palet("B", 1, 1, "2026-08-09"), // anterior (domingo)
      palet("C", 1, 1, "2026-08-10"), // objetivo (lunes)
      palet("D", 1, 1, "2026-08-14"), // objetivo
    ];
    const { objetivo, anterior } = partirEnSemanas(filas, "2026-08-10");
    expect(objetivo.map((f) => f.numero)).toEqual(["C", "D"]);
    expect(anterior.map((f) => f.numero)).toEqual(["A", "B"]);
  });
});

describe("render del correo", () => {
  const datos: DatosCorreoMercadona = {
    anio: 2026,
    semana: 33,
    fechas: ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"],
    actual: { palets: 591, cajas: 13686, kg: 159355 },
    anterior: { palets: 616, cajas: 14204, kg: 166267 },
  };

  it("el asunto lleva palets y kg de la semana", () => {
    expect(asuntoVentasMercadona(datos)).toBe("Ventas Mercadona semana 33/2026 · 591 palets · 159.355 kg");
  });

  it("el texto trae las tres métricas con separador de miles español", () => {
    const t = renderVentasMercadonaTexto(datos);
    expect(t).toContain("159.355");
    expect(t).toContain("13.686");
    expect(t).toContain("591");
  });

  it("compara con la semana anterior con su signo", () => {
    // 591 vs 616 = -4%
    expect(renderVentasMercadonaTexto(datos)).toContain("−4% sobre la semana pasada");
  });

  it("sin semana anterior no inventa comparación", () => {
    const t = renderVentasMercadonaTexto({ ...datos, anterior: { palets: 0, cajas: 0, kg: 0 } });
    expect(t).not.toContain("sobre la semana pasada");
  });

  it("el HTML sale bien formado y con el rango de fechas", () => {
    const h = renderVentasMercadonaHtml(datos);
    expect(h).toContain("Semana 33/2026");
    expect(h).toContain("10 ago a 16 ago");
    expect(h).toContain("159.355");
    expect(h.startsWith("<!doctype html>")).toBe(true);
  });
});
