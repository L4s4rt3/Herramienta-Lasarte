import { describe, expect, it } from "vitest";
import {
  fichaConfeccion,
  fichaDestinoEntrada,
  fichaDestinoLotes,
  type DuenoEntrada,
  type OrigenConfeccionFila,
  type PaletErpFila,
} from "./trazabilidadErp";

// Caso real de la campaña 25/26: el lote de confección 01260807 sale de dos
// entradas y sus palets se venden a Mercadona y a un cliente de exportación.
const ORIGENES: OrigenConfeccionFila[] = [
  { lote_confeccion: "01260807", lote_entrada: "26051408", articulo: "NARANJA VALENCIA MIDKNIGHT", kg_atribuidos: 30000 },
  { lote_confeccion: "01260807", lote_entrada: "22070401", articulo: "NARANJA VALENCIA LATE", kg_atribuidos: 10000 },
  // Otro lote de confección que también consume de 26051408.
  { lote_confeccion: "02260807", lote_entrada: "26051408", articulo: "NARANJA VALENCIA MIDKNIGHT", kg_atribuidos: 5000 },
];

const PALETS: PaletErpFila[] = [
  { numero: "1", lote_confeccion: "01260807", kg_netos: 800, cliente: "MERCADONA S.A.", importe_venta: 640, fecha_venta: "2026-08-08" },
  { numero: "2", lote_confeccion: "01260807", kg_netos: 200, cliente: "ZAMEXFRUIT S.L.", importe_venta: 180, fecha_venta: "2026-08-08" },
  // Sin vender: cuenta kilos pero no euros.
  { numero: "3", lote_confeccion: "01260807", kg_netos: 100, cliente: null, importe_venta: null, fecha_venta: null },
  { numero: "4", lote_confeccion: "02260807", kg_netos: 500, cliente: "MERCADONA S.A.", importe_venta: 400, fecha_venta: "2026-08-09" },
];

const DUENOS = new Map<string, DuenoEntrada>([
  ["26051408", { agricultor: "Berrynest SAT", finca: "COLOMBO - GG" }],
]);

describe("fichaConfeccion", () => {
  const ficha = fichaConfeccion("01260807", ORIGENES, PALETS, DUENOS);

  it("solo mira su propio lote de confección", () => {
    expect(ficha.origenes.map((o) => o.loteEntrada)).toEqual(["26051408", "22070401"]);
    expect(ficha.palets).toBe(3);
  });

  it("marca como desconocido el origen que no está en entradas_bascula", () => {
    expect(ficha.origenes[0]).toMatchObject({ agricultor: "Berrynest SAT", desconocido: false });
    expect(ficha.origenes[1]).toMatchObject({ agricultor: null, desconocido: true });
  });

  it("da las DOS cifras: kilos con origen y kilos paletizados", () => {
    expect(ficha.kgConOrigen).toBe(40000);
    expect(ficha.kgPalets).toBe(1100);
  });

  it("suma los euros solo de los palets facturados, y el sin vender no los ensucia", () => {
    expect(ficha.euros).toBe(820);
    expect(ficha.clientes).toEqual([
      { cliente: "MERCADONA S.A.", kgEstimados: 800, eurosEstimados: 640 },
      { cliente: "ZAMEXFRUIT S.L.", kgEstimados: 200, eurosEstimados: 180 },
      { cliente: "(sin vender)", kgEstimados: 100, eurosEstimados: null },
    ]);
  });
});

describe("fichaDestinoEntrada", () => {
  const ficha = fichaDestinoEntrada("26051408", ORIGENES, PALETS);

  it("encuentra los dos lotes de confección que consumieron esa entrada", () => {
    expect(ficha.confecciones).toEqual([
      { loteConfeccion: "01260807", kgAtribuidos: 30000, kgLoteConfeccion: 40000, palets: 3 },
      { loteConfeccion: "02260807", kgAtribuidos: 5000, kgLoteConfeccion: 5000, palets: 1 },
    ]);
  });

  it("prorratea por su cuota en cada lote: 3/4 del primero y todo el segundo", () => {
    // Mercadona: 800 x 0,75 (del 01260807) + 500 x 1 (del 02260807) = 1.100.
    expect(ficha.clientes[0]).toEqual({
      cliente: "MERCADONA S.A.",
      kgEstimados: 1100,
      eurosEstimados: 880, // 640 x 0,75 + 400
    });
    // Zamexfruit: 200 x 0,75 = 150.
    expect(ficha.clientes[1]).toEqual({
      cliente: "ZAMEXFRUIT S.L.",
      kgEstimados: 150,
      eurosEstimados: 135,
    });
  });

  it("el palet sin vender aporta kilos estimados pero nunca euros", () => {
    const sinVender = ficha.clientes.find((c) => c.cliente === "(sin vender)");
    expect(sinVender).toEqual({ cliente: "(sin vender)", kgEstimados: 75, eurosEstimados: null });
  });

  it("los totales son la suma de lo prorrateado, no de los palets enteros", () => {
    expect(ficha.kgEstimadosVendidos).toBe(1325); // 1100 + 150 + 75
    expect(ficha.eurosEstimados).toBe(1015); // 880 + 135
  });

  it("con VARIOS lotes (un productor entero) las cuotas suman 1 y no se cuenta doble", () => {
    // 26051408 aporta 3/4 del lote 01260807 y 22070401 el 1/4 restante: si se
    // piden los dos, los kilos de sus palets tienen que salir enteros, no x2.
    const ficha = fichaDestinoLotes(["26051408", "22070401"], ORIGENES, PALETS);
    expect(ficha.loteEntrada).toBeNull();
    expect(ficha.clientes).toEqual([
      { cliente: "MERCADONA S.A.", kgEstimados: 1300, eurosEstimados: 1040 }, // 800 + 500
      { cliente: "ZAMEXFRUIT S.L.", kgEstimados: 200, eurosEstimados: 180 },
      { cliente: "(sin vender)", kgEstimados: 100, eurosEstimados: null },
    ]);
    expect(ficha.kgEstimadosVendidos).toBe(1600);
    expect(ficha.eurosEstimados).toBe(1220);
  });

  it("una entrada que no alimentó nada devuelve la ficha vacía, no un cero engañoso", () => {
    const vacia = fichaDestinoEntrada("99999999", ORIGENES, PALETS);
    expect(vacia.confecciones).toEqual([]);
    expect(vacia.clientes).toEqual([]);
    expect(vacia.eurosEstimados).toBeNull();
  });
});
