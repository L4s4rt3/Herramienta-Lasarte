// El mix de clasificación de un lote: destinos, clases aptas y los cuatro
// formatos de Mercadona. Antes había tres copias con dos criterios de "clase
// apta"; esta es la única, y estos casos son los que las separaban.
import { describe, expect, it } from "vitest";
import {
  deducirMetodoVentaMdna,
  esClaseAptaMdna,
  letraClase,
  metodoMdnaDeProducto,
  mixPorLoteDesdeClasificacion,
} from "./mdnaMix";

describe("deducirMetodoVentaMdna", () => {
  it("lee el formato del nombre del producto, granel antes que el número", () => {
    expect(deducirMetodoVentaMdna("MDNA MALLA 3KG CAL 4/5")).toBe("MA3KGC");
    expect(deducirMetodoVentaMdna("MDNA GIRSAC 4 KG EXPRIMIDOR")).toBe("MA4KGC");
    expect(deducirMetodoVentaMdna("MDNA 5KG D-PACK CAL 3")).toBe("MA5KGC");
    expect(deducirMetodoVentaMdna("MDNA GRANEL CAL 3/4")).toBe("MA12KGC");
  });
  it("sin Mercadona en el nombre no adivina", () => {
    expect(deducirMetodoVentaMdna("KOLLA LST CAL 1/36")).toBeNull();
    expect(metodoMdnaDeProducto("KOLLA LST CAL 1/36")).toBeNull();
  });
  it("Mercadona sin formato reconocible se cuenta aparte, jamás se reparte", () => {
    expect(deducirMetodoVentaMdna("MDNA CAJA ESPECIAL")).toBeNull();
    expect(metodoMdnaDeProducto("MDNA CAJA ESPECIAL")).toBe("SIN_FORMATO");
  });
});

describe("clases aptas", () => {
  it("la letra del calibrador manda: A–F aptas, el resto no", () => {
    expect(letraClase("(C) Cat1 A")).toBe("C");
    expect(esClaseAptaMdna("(A) Extra 1")).toBe(true);
    expect(esClaseAptaMdna("(F) Cat 2")).toBe(true);
    expect(esClaseAptaMdna("(G) Cat 3")).toBe(false);
    expect(esClaseAptaMdna("(J) Podrido")).toBe(false);
  });
  it("sin letra no cuenta como apta en vez de adivinar por el texto", () => {
    expect(letraClase("Cat1 A")).toBeNull();
    expect(esClaseAptaMdna("Cat1 A")).toBe(false);
  });
});

describe("mixPorLoteDesdeClasificacion", () => {
  const filas = [
    { lote_codigo: "26051903 24 BOX", producto: "MDNA MALLA 3KG", clase: "(A) Extra 1", grupo_destino: "EXPORTACIÓN", peso_kg: 1000 },
    { lote_codigo: "26051903", producto: "MDNA GRANEL CAL 3/4", clase: "(C) Cat1 A", grupo_destino: "EXPORTACION", peso_kg: 500 },
    { lote_codigo: "26051903", producto: "KOLLA LST", clase: "(D) Cat1 B", grupo_destino: "NO EXPORTACION", peso_kg: 200 },
    { lote_codigo: "26051903", producto: "INDUSTRIA", clase: "(J) Podrido", grupo_destino: "NO COMERCIAL", peso_kg: "50" },
    { lote_codigo: "26051903", producto: "MDNA ESPECIAL", clase: "(B) Extra 2", grupo_destino: "MUJERES", peso_kg: 100 },
    { lote_codigo: null, producto: "X", clase: "(A) Extra 1", grupo_destino: "EXPORTACION", peso_kg: 999 },
  ];
  it("agrupa por lote de 8 dígitos, normaliza acentos y separa los formatos", () => {
    const mix = mixPorLoteDesdeClasificacion(filas);
    expect([...mix.keys()]).toEqual(["26051903"]);
    const m = mix.get("26051903")!;
    expect(m.kgClasificado).toBe(1850);
    expect(m.kgExportacion).toBe(1500);
    expect(m.kgNoExportacion).toBe(200);
    expect(m.kgMujeres).toBe(100);
    expect(m.kgNoComercial).toBe(50);
    expect(m.kgClaseApta).toBe(1800);
    expect(m.kgClasePodrido).toBe(50);
    expect(m.mdna).toEqual({ MA3KGC: 1000, MA4KGC: 0, MA5KGC: 0, MA12KGC: 500 });
    expect(m.mdnaSinFormato).toBe(100);
    expect(m.mdnaTotal).toBe(1600);
  });
});
