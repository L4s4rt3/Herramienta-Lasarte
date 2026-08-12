import { describe, expect, it } from "vitest";
import {
  computeCmvProductoDia,
  PRODUCTO_PODRIDO,
  semillaFicha,
  type FichaProducto,
  type FilaClasifProducto,
  type FrutaLoteProducto,
} from "./cmvProducto";
import { claveProducto } from "./productosCanonicos";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fila(
  producto: string | null,
  peso_kg: number,
  opts: { lote?: string; clase?: string | null } = {},
): FilaClasifProducto {
  return {
    lote_codigo: opts.lote ?? "26080701",
    producto,
    clase: opts.clase ?? "(A) Primera",
    peso_kg,
  };
}

function ficha(nombre: string, overrides: Partial<FichaProducto> = {}): FichaProducto {
  return {
    clave: claveProducto(nombre),
    nombre,
    kg_por_bulto: null,
    coste_material_bulto: null,
    coste_material_pieza: null,
    indice_confeccion: null,
    precio_venta_eur_kg: null,
    metodo_venta: null,
    zona_override: null,
    activo: true,
    ...overrides,
  };
}

function fichasDe(...fs: FichaProducto[]): Map<string, FichaProducto> {
  return new Map(fs.map((f) => [f.clave, f]));
}

function fruta(eurKg: number | null): Map<string, FrutaLoteProducto> {
  return new Map([["26080701", { eurKg }]]);
}

/** Ficha completa de una malla de 5 kg: todo cargado, CMV calculable. */
const MALLA5 = "MDNA 5KG D-PACK CAL 5/6 (70/84M)";
function fichaMalla5(overrides: Partial<FichaProducto> = {}): FichaProducto {
  return ficha(MALLA5, {
    kg_por_bulto: 12,
    coste_material_bulto: 0.6,
    indice_confeccion: 2.5,
    precio_venta_eur_kg: 0.9,
    ...overrides,
  });
}

// ─── Fruta ───────────────────────────────────────────────────────────────────

describe("fruta: reparto plano dentro del lote", () => {
  it("cada kg del lote carga el mismo €/kg, salga en malla o en industria", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000), fila("INDUSTRIA", 500)],
      fichasDe(fichaMalla5(), ficha("INDUSTRIA", { indice_confeccion: 0.3 })),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    const malla = r.productos.find((p) => p.nombre === MALLA5)!;
    const industria = r.productos.find((p) => p.nombre === "INDUSTRIA")!;
    expect(malla.frutaEurKg).toBeCloseTo(0.5, 6);
    expect(industria.frutaEurKg).toBeCloseTo(0.5, 6);
    expect(malla.frutaEur).toBeCloseTo(500, 6);
    expect(industria.frutaEur).toBeCloseTo(250, 6);
    expect(r.frutaEur).toBeCloseTo(750, 6);
  });

  it("un lote sin liquidar deja los kg marcados y NO inventa un precio", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000)],
      fichasDe(fichaMalla5()),
      fruta(null),
      { tratamientoDiaEur: 0 },
    );
    const p = r.productos[0];
    expect(p.frutaEur).toBe(0);
    expect(p.frutaEurKg).toBeNull();
    expect(p.kgSinCosteFruta).toBe(1000);
    expect(p.faltantes).toContain("fruta");
    expect(p.cmvEurKg).toBeNull();
    expect(r.kgSinCosteFruta).toBe(1000);
    expect(r.incompleto).toBe(true);
  });

  it("distingue precalibrado (fruta ya pagada) de lote sin liquidar (dato que falta)", () => {
    // El operario anota a mano de qué días viene la fruta apartada: sin código
    // de 8 dígitos. Eso es precalibrado, no un import a medias.
    const r = computeCmvProductoDia(
      [
        fila(MALLA5, 400, { lote: "22/07  22 BOX  -  23/07 43 BOX" }),
        fila(MALLA5, 600, { lote: "26080709" }),
      ],
      fichasDe(fichaMalla5()),
      new Map([["26080709", { eurKg: null }]]),
      { tratamientoDiaEur: 0 },
    );
    const p = r.productos[0];
    expect(p.kgSinCosteFruta).toBe(1000);
    expect(p.kgPrecalibrado).toBe(400);
    expect(p.kgLoteSinLiquidar).toBe(600);
    expect(r.kgPrecalibrado).toBe(400);
    expect(r.kgLoteSinLiquidar).toBe(600);
  });

  it("un día entero de precalibrado no cuenta como lotes sin liquidar", () => {
    // Caso real del 04-ago-2026: ninguna pasada trae código de lote.
    const r = computeCmvProductoDia(
      [
        fila(MALLA5, 500, { lote: "30/07 - 46 B27/07,-7B -29/07-2 B" }),
        fila(MALLA5, 300, { lote: "24/07" }),
      ],
      fichasDe(fichaMalla5()),
      new Map(),
      { tratamientoDiaEur: 0 },
    );
    expect(r.kgPrecalibrado).toBe(800);
    expect(r.kgLoteSinLiquidar).toBe(0);
    // Sigue sin CMV completo: sin fruta no hay coste de producto de verdad.
    expect(r.productos[0].cmvEurKg).toBeNull();
  });

  it("mezcla de lotes: el €/kg del producto es la media ponderada", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000, { lote: "26080701" }), fila(MALLA5, 3000, { lote: "26080702" })],
      fichasDe(fichaMalla5()),
      new Map([
        ["26080701", { eurKg: 0.4 }],
        ["26080702", { eurKg: 0.6 }],
      ]),
      { tratamientoDiaEur: 0 },
    );
    // (1000×0,40 + 3000×0,60) / 4000 = 0,55
    expect(r.productos[0].frutaEurKg).toBeCloseTo(0.55, 6);
  });

  it("no cruza lotes por subcadena: el código se normaliza a 8 dígitos", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000, { lote: "26080701+26080702" })],
      fichasDe(fichaMalla5()),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    // El compuesto resuelve a su primer código de 8 dígitos (convención A).
    expect(r.productos[0].frutaEurKg).toBeCloseTo(0.5, 6);
  });
});

// ─── Material ────────────────────────────────────────────────────────────────

describe("material", () => {
  it("cobra el material por bulto: kg / kg por bulto × coste", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1200)],
      fichasDe(fichaMalla5({ kg_por_bulto: 12, coste_material_bulto: 0.6 })),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    const p = r.productos[0];
    expect(p.bultos).toBe(100);
    expect(p.materialEur).toBeCloseTo(60, 6);
    expect(p.materialEurKg).toBeCloseTo(0.05, 6);
  });

  it("en girsacs cobra el material por MALLA, no por bulto", () => {
    // "9X2 K" = 9 mallas de 2 kg por bulto de 18 kg. 180 kg = 10 bultos = 90 mallas.
    const GIRSAC = "HARRIE GOESTEN GIRSAC 9X2 K C.3/4";
    const r = computeCmvProductoDia(
      [fila(GIRSAC, 180)],
      fichasDe(ficha(GIRSAC, {
        kg_por_bulto: 18,
        coste_material_pieza: 0.03,
        indice_confeccion: 2.5,
        precio_venta_eur_kg: 0.5,
      })),
      fruta(0.4),
      { tratamientoDiaEur: 0 },
    );
    const p = r.productos[0];
    expect(p.bultos).toBe(10);
    expect(p.materialEur).toBeCloseTo(90 * 0.03, 6);
  });

  it("suma pieza y bulto cuando la ficha trae los dos (mallas + su caja)", () => {
    const GIRSAC = "HARRIE GOESTEN GIRSAC 9X2 K C.3/4";
    const r = computeCmvProductoDia(
      [fila(GIRSAC, 180)],
      fichasDe(ficha(GIRSAC, {
        kg_por_bulto: 18,
        coste_material_pieza: 0.03,
        coste_material_bulto: 0.25,
        indice_confeccion: 2.5,
        precio_venta_eur_kg: 0.5,
      })),
      fruta(0.4),
      { tratamientoDiaEur: 0 },
    );
    expect(r.productos[0].materialEur).toBeCloseTo(90 * 0.03 + 10 * 0.25, 6);
  });

  it("sin coste de material cargado el CMV sale null, NO más barato", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1200)],
      fichasDe(fichaMalla5({ coste_material_bulto: null })),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    const p = r.productos[0];
    expect(p.materialEur).toBeNull();
    expect(p.faltantes).toContain("material");
    expect(p.cmvEurKg).toBeNull();
    expect(r.kgSinMaterial).toBe(1200);
  });

  it("deduce los kg por bulto del empaque cuando la ficha no los trae", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1200)],
      fichasDe(fichaMalla5({ kg_por_bulto: null })),
      fruta(0.5),
      {
        tratamientoDiaEur: 0,
        empaquePorClave: new Map([[claveProducto(MALLA5), "12 K MDNA 618 LOGIFRUIT"]]),
      },
    );
    expect(r.productos[0].kgPorBulto).toBe(12);
    expect(r.productos[0].bultos).toBe(100);
  });

  it("la ficha manda sobre lo deducido del empaque", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1200)],
      fichasDe(fichaMalla5({ kg_por_bulto: 10 })),
      fruta(0.5),
      {
        tratamientoDiaEur: 0,
        empaquePorClave: new Map([[claveProducto(MALLA5), "12 K MDNA 618 LOGIFRUIT"]]),
      },
    );
    expect(r.productos[0].kgPorBulto).toBe(10);
  });
});

// ─── Tratamiento ─────────────────────────────────────────────────────────────

describe("tratamiento: reparto por kg ponderado", () => {
  it("reparte por kg × índice, no a partes iguales por kg", () => {
    // 1000 kg de malla (índice 2,5) y 1000 kg de industria (0,3).
    // Ponderados: 2500 y 300 → 2800. De 2.800 € tocan 2.500 y 300.
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000), fila("INDUSTRIA", 1000)],
      fichasDe(
        fichaMalla5(),
        ficha("INDUSTRIA", { indice_confeccion: 0.3, coste_material_bulto: 0, kg_por_bulto: 350, precio_venta_eur_kg: 0.14 }),
      ),
      fruta(0.5),
      { tratamientoDiaEur: 2800 },
    );
    const malla = r.productos.find((p) => p.nombre === MALLA5)!;
    const industria = r.productos.find((p) => p.nombre === "INDUSTRIA")!;
    expect(malla.tratamientoEur).toBeCloseTo(2500, 6);
    expect(industria.tratamientoEur).toBeCloseTo(300, 6);
    expect(r.tratamientoEur).toBeCloseTo(2800, 6);
  });

  it("reparte TODO el tratamiento del día (no se pierde ni un euro)", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 800), fila("LA FEA GRANEL CAL 6/7", 1500), fila("INDUSTRIA", 400)],
      fichasDe(
        fichaMalla5(),
        ficha("LA FEA GRANEL CAL 6/7", { indice_confeccion: 1 }),
        ficha("INDUSTRIA", { indice_confeccion: 0.3 }),
      ),
      fruta(0.5),
      { tratamientoDiaEur: 1234.56 },
    );
    const suma = r.productos.reduce((s, p) => s + p.tratamientoEur, 0);
    expect(suma).toBeCloseTo(1234.56, 6);
  });

  it("con todos los índices iguales degenera en el reparto plano por kg", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000), fila("LA FEA GRANEL CAL 6/7", 3000)],
      fichasDe(
        fichaMalla5({ indice_confeccion: 1 }),
        ficha("LA FEA GRANEL CAL 6/7", { indice_confeccion: 1 }),
      ),
      fruta(0.5),
      { tratamientoDiaEur: 400 },
    );
    const malla = r.productos.find((p) => p.nombre === MALLA5)!;
    expect(malla.tratamientoEur).toBeCloseTo(100, 6);
    expect(malla.tratamientoEurKg).toBeCloseTo(0.1, 6);
  });

  it("lo excluido (podrido) no absorbe tratamiento", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000), fila(MALLA5, 100, { clase: "(J) Podrido" })],
      fichasDe(fichaMalla5(), ficha(PRODUCTO_PODRIDO)),
      fruta(0.5),
      { tratamientoDiaEur: 500 },
    );
    const podrido = r.productos.find((p) => p.nombre === PRODUCTO_PODRIDO)!;
    const malla = r.productos.find((p) => p.nombre === MALLA5)!;
    expect(podrido.tratamientoEur).toBe(0);
    expect(malla.tratamientoEur).toBeCloseTo(500, 6);
  });

  it("un producto NO excluido sin índice se marca: no está absorbiendo lo suyo", () => {
    const r = computeCmvProductoDia(
      [fila("PRODUCTO RARO NUEVO", 1000)],
      // Ficha con índice explícito a 0: el dueño no lo ha puesto todavía.
      fichasDe(ficha("PRODUCTO RARO NUEVO", { indice_confeccion: 0 })),
      fruta(0.5),
      { tratamientoDiaEur: 500 },
    );
    const p = r.productos[0];
    expect(p.faltantes).toContain("indice");
    expect(r.kgSinIndice).toBe(1000);
  });

  it("si ningún producto tiene índice, el tratamiento queda sin repartir y se avisa", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 100, { clase: "(J) Podrido" })],
      fichasDe(ficha(PRODUCTO_PODRIDO)),
      fruta(0.5),
      { tratamientoDiaEur: 500 },
    );
    expect(r.kgPonderadosTotal).toBe(0);
    expect(r.tratamientoSinRepartirEur).toBe(500);
    expect(r.tratamientoEur).toBe(0);
  });
});

// ─── Estructura ──────────────────────────────────────────────────────────────

describe("estructura: reparto por kg PLANOS", () => {
  it("reparte por kilos, no por el índice de confección", () => {
    // 1000 kg de malla (índice 2,5) y 1000 de industria (0,3): la estructura
    // se parte por la mitad aunque el tratamiento no.
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000), fila("INDUSTRIA", 1000)],
      fichasDe(fichaMalla5(), ficha("INDUSTRIA", { indice_confeccion: 0.3 })),
      fruta(0.5),
      { tratamientoDiaEur: 2800, estructuraPeriodoEur: 1000 },
    );
    const malla = r.productos.find((p) => p.nombre === MALLA5)!;
    const industria = r.productos.find((p) => p.nombre === "INDUSTRIA")!;
    expect(malla.estructuraEur).toBeCloseTo(500, 6);
    expect(industria.estructuraEur).toBeCloseTo(500, 6);
    // El tratamiento, en cambio, sigue ponderado: 2500 / 300.
    expect(malla.tratamientoEur).toBeCloseTo(2500, 6);
    expect(industria.tratamientoEur).toBeCloseTo(300, 6);
  });

  it("lo apartado también absorbe estructura: ocupó nave igual", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 900), fila(MALLA5, 100, { clase: "(J) Podrido" })],
      fichasDe(fichaMalla5(), ficha(PRODUCTO_PODRIDO)),
      fruta(0.5),
      { tratamientoDiaEur: 0, estructuraPeriodoEur: 1000 },
    );
    const podrido = r.productos.find((p) => p.nombre === PRODUCTO_PODRIDO)!;
    expect(podrido.estructuraEur).toBeCloseTo(100, 6);
    expect(podrido.tratamientoEur).toBe(0);
  });

  it("reparte TODA la estructura del periodo", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 800), fila("LA FEA GRANEL CAL 6/7", 1500), fila("INDUSTRIA", 400)],
      fichasDe(fichaMalla5(), ficha("LA FEA GRANEL CAL 6/7"), ficha("INDUSTRIA")),
      fruta(0.5),
      { tratamientoDiaEur: 0, estructuraPeriodoEur: 987.65 },
    );
    const suma = r.productos.reduce((s, p) => s + p.estructuraEur, 0);
    expect(suma).toBeCloseTo(987.65, 6);
    expect(r.estructuraEur).toBeCloseTo(987.65, 6);
  });

  it("entra en el CMV y en el coste del periodo", () => {
    // 1200 kg: fruta 0,50 + material 0,05 + tratamiento 0,10 + estructura 0,20
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1200)],
      fichasDe(fichaMalla5()),
      fruta(0.5),
      { tratamientoDiaEur: 120, estructuraPeriodoEur: 240 },
    );
    const p = r.productos[0];
    expect(p.estructuraEurKg).toBeCloseTo(0.2, 6);
    expect(p.cmvEurKg).toBeCloseTo(0.85, 6);
    expect(r.costeEur).toBeCloseTo(r.frutaEur + r.materialEur + r.tratamientoEur + r.estructuraEur, 6);
    expect(r.margenEur).toBeCloseTo(r.ingresoEur - r.costeEur, 6);
  });

  it("sin apuntes de estructura se marca, y no se inventa una", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1200)],
      fichasDe(fichaMalla5()),
      fruta(0.5),
      { tratamientoDiaEur: 120 },
    );
    expect(r.sinEstructura).toBe(true);
    expect(r.estructuraEur).toBe(0);
    expect(r.productos[0].estructuraEur).toBe(0);
  });
});

// ─── Podrido ─────────────────────────────────────────────────────────────────

describe("podrido: la clase (J) manda sobre el producto", () => {
  it("los kg (J) no inflan el producto bueno, van a PODRIDO", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 900), fila(MALLA5, 100, { clase: "(J) Podrido" })],
      fichasDe(fichaMalla5(), ficha(PRODUCTO_PODRIDO)),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    const malla = r.productos.find((p) => p.nombre === MALLA5)!;
    const podrido = r.productos.find((p) => p.nombre === PRODUCTO_PODRIDO)!;
    expect(malla.kg).toBe(900);
    expect(podrido.kg).toBe(100);
    expect(r.kgTotal).toBe(1000);
  });

  it("el podrido carga su fruta y no tiene precio: es pérdida pura", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 100, { clase: "(J) Podrido" })],
      fichasDe(ficha(PRODUCTO_PODRIDO)),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    const podrido = r.productos[0];
    expect(podrido.excluido).toBe(true);
    expect(podrido.frutaEur).toBeCloseTo(50, 6);
    expect(podrido.precioEurKg).toBe(0);
    expect(podrido.ingresoEur).toBe(0);
    expect(podrido.margenEur).toBeCloseTo(-50, 6);
  });
});

// ─── Precio de venta ─────────────────────────────────────────────────────────

describe("precio de venta", () => {
  it("la facturación real del método manda sobre el precio manual de la ficha", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000)],
      fichasDe(fichaMalla5({ precio_venta_eur_kg: 0.9, metodo_venta: "MA5KGC" })),
      fruta(0.5),
      { tratamientoDiaEur: 0, precioPorMetodo: new Map([["MA5KGC", 0.242]]) },
    );
    const p = r.productos[0];
    expect(p.precioEurKg).toBeCloseTo(0.242, 6);
    expect(p.precioFuente).toBe("metodo");
  });

  it("cae al precio de la ficha si el método no tiene facturación esa semana", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000)],
      fichasDe(fichaMalla5({ precio_venta_eur_kg: 0.9, metodo_venta: "MA5KGC" })),
      fruta(0.5),
      { tratamientoDiaEur: 0, precioPorMetodo: new Map() },
    );
    expect(r.productos[0].precioEurKg).toBeCloseTo(0.9, 6);
    expect(r.productos[0].precioFuente).toBe("ficha");
  });

  it("un producto de Mercadona coge su método DEDUCIDO sin tocar la ficha", () => {
    // La ficha no trae método ni precio: el nombre dice que es la malla de 5 kg.
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000)],
      fichasDe(fichaMalla5({ precio_venta_eur_kg: null, metodo_venta: null })),
      fruta(0.5),
      { tratamientoDiaEur: 0, precioPorMetodo: new Map([["MA5KGC", 0.242]]) },
    );
    expect(r.productos[0].precioEurKg).toBeCloseTo(0.242, 6);
    expect(r.productos[0].precioFuente).toBe("metodo");
    expect(r.productos[0].faltantes).not.toContain("precio");
  });

  it("el método de la ficha manda sobre el deducido", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000)],
      fichasDe(fichaMalla5({ precio_venta_eur_kg: null, metodo_venta: "MA3KGC" })),
      fruta(0.5),
      { tratamientoDiaEur: 0, precioPorMetodo: new Map([["MA3KGC", 0.31], ["MA5KGC", 0.242]]) },
    );
    expect(r.productos[0].precioEurKg).toBeCloseTo(0.31, 6);
  });

  it("un producto que NO es de Mercadona no coge método deducido", () => {
    const r = computeCmvProductoDia(
      [fila("KOLLA  LST CAL 1/36", 1000)],
      new Map(),
      fruta(0.5),
      { tratamientoDiaEur: 0, precioPorMetodo: new Map([["MA5KGC", 0.242]]) },
    );
    expect(r.productos[0].precioEurKg).toBeNull();
    expect(r.productos[0].faltantes).toContain("precio");
  });

  it("sin precio de ningún sitio, el producto se marca y no se le inventa 0", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000)],
      fichasDe(fichaMalla5({ precio_venta_eur_kg: null })),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    const p = r.productos[0];
    expect(p.precioEurKg).toBeNull();
    expect(p.ingresoEur).toBeNull();
    expect(p.margenEur).toBeNull();
    expect(p.faltantes).toContain("precio");
    expect(r.kgSinPrecio).toBe(1000);
  });
});

// ─── CMV y margen ────────────────────────────────────────────────────────────

describe("CMV y margen del día", () => {
  it("CMV = fruta + material + tratamiento, y el margen sale del precio", () => {
    // 1200 kg, fruta 0,50 €/kg, material 0,05 €/kg (0,6 €/bulto ÷ 12 kg),
    // tratamiento 120 € / 1200 kg = 0,10 €/kg → CMV 0,65. Precio 0,90.
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1200)],
      fichasDe(fichaMalla5()),
      fruta(0.5),
      { tratamientoDiaEur: 120 },
    );
    const p = r.productos[0];
    expect(p.cmvEurKg).toBeCloseTo(0.65, 6);
    expect(p.completo).toBe(true);
    expect(p.margenEurKg).toBeCloseTo(0.25, 6);
    expect(p.margenEur).toBeCloseTo(300, 6);
    expect(r.margenEur).toBeCloseTo(300, 6);
    expect(r.incompleto).toBe(false);
  });

  it("el margen del día cuadra con ingreso − coste", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1200), fila("INDUSTRIA", 800)],
      fichasDe(
        fichaMalla5(),
        ficha("INDUSTRIA", {
          kg_por_bulto: 350, coste_material_bulto: 0, indice_confeccion: 0.3, precio_venta_eur_kg: 0.14,
        }),
      ),
      fruta(0.5),
      { tratamientoDiaEur: 400 },
    );
    expect(r.margenEur).toBeCloseTo(r.ingresoEur - r.costeEur, 6);
    expect(r.costeEur).toBeCloseTo(r.frutaEur + r.materialEur + r.tratamientoEur, 6);
  });

  it("la industria sale en pérdida con el reparto plano de fruta (consecuencia asumida)", () => {
    const r = computeCmvProductoDia(
      [fila("INDUSTRIA", 1000)],
      fichasDe(ficha("INDUSTRIA", {
        kg_por_bulto: 350, coste_material_bulto: 0, indice_confeccion: 0.3, precio_venta_eur_kg: 0.14,
      })),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    const p = r.productos[0];
    expect(p.cmvEurKg).toBeCloseTo(0.5, 6);
    expect(p.margenEurKg).toBeCloseTo(-0.36, 6);
    expect(p.margenEur).toBeLessThan(0);
  });

  it("ordena de lo que más pierde a lo que más gana, y los incompletos al final", () => {
    const r = computeCmvProductoDia(
      [fila(MALLA5, 1000), fila("INDUSTRIA", 1000), fila("SIN FICHA NINGUNA", 1000)],
      fichasDe(
        fichaMalla5(),
        ficha("INDUSTRIA", {
          kg_por_bulto: 350, coste_material_bulto: 0, indice_confeccion: 0.3, precio_venta_eur_kg: 0.14,
        }),
      ),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    expect(r.productos[0].nombre).toBe("INDUSTRIA"); // el que más pierde
    expect(r.productos[1].nombre).toBe(MALLA5);
    expect(r.productos[2].nombre).toBe("SIN FICHA NINGUNA"); // incompleto, al final
    expect(r.productos[2].margenEur).toBeNull();
  });

  it("las erratas del calibrador suman en el MISMO producto", () => {
    const r = computeCmvProductoDia(
      [
        fila("MDNA 5 K D-PACK CAL 5/6 (70/84M)", 500),
        fila("MDNA 5 KG D-PACK CAL 5/6 (70/84MM)", 300),
        fila("MDNA 5KG D-PACK CAL 5/6 (70/84M).", 200),
      ],
      fichasDe(fichaMalla5()),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    expect(r.productos).toHaveLength(1);
    expect(r.productos[0].kg).toBe(1000);
  });

  it("un producto sin ficha no rompe el cálculo: sale con lo que se sepa", () => {
    const r = computeCmvProductoDia(
      [fila("PRODUCTO NUEVO SIN FICHA", 1000)],
      new Map(),
      fruta(0.5),
      { tratamientoDiaEur: 100 },
    );
    const p = r.productos[0];
    expect(p.kg).toBe(1000);
    expect(p.frutaEurKg).toBeCloseTo(0.5, 6);
    // Sin ficha hereda la semilla de su zona, así que SÍ absorbe tratamiento.
    expect(p.tratamientoEur).toBeCloseTo(100, 6);
    expect(p.faltantes).toEqual(expect.arrayContaining(["material", "precio"]));
    expect(p.cmvEurKg).toBeNull();
  });

  it("ignora filas sin producto y sin kg, sin inventar fichas vacías", () => {
    const r = computeCmvProductoDia(
      [fila(null, 500), fila("   ", 500), fila(MALLA5, 0), fila(MALLA5, 100)],
      fichasDe(fichaMalla5()),
      fruta(0.5),
      { tratamientoDiaEur: 0 },
    );
    expect(r.productos).toHaveLength(1);
    expect(r.kgTotal).toBe(100);
  });

  it("un día sin filas devuelve el día a cero, no revienta", () => {
    const r = computeCmvProductoDia([], new Map(), new Map(), { tratamientoDiaEur: 500 });
    expect(r.productos).toHaveLength(0);
    expect(r.kgTotal).toBe(0);
    expect(r.margenEur).toBe(0);
    expect(r.tratamientoSinRepartirEur).toBe(500);
  });
});

// ─── Semilla de ficha ────────────────────────────────────────────────────────

describe("semillaFicha", () => {
  it("propone zona, kg por bulto e índice, pero nunca coste ni precio", () => {
    const s = semillaFicha(MALLA5, "12 K MDNA 618 LOGIFRUIT");
    expect(s.zona).toBe("Mallas");
    expect(s.kg_por_bulto).toBe(12);
    expect(s.indice_confeccion).toBe(2.5);
    expect(s).not.toHaveProperty("coste_material_bulto");
    expect(s).not.toHaveProperty("precio_venta_eur_kg");
  });

  it("sin empaque no inventa kg por bulto", () => {
    const s = semillaFicha("LA FEA GRANEL CAL 6/7", null);
    expect(s.zona).toBe("Graneleras");
    expect(s.kg_por_bulto).toBeNull();
    expect(s.indice_confeccion).toBe(1);
  });

  it("lo excluido nace sin índice (no absorbe tratamiento)", () => {
    expect(semillaFicha("PODRIDO", "BOX GRISES CERRADOS PARA PODRIDO").indice_confeccion).toBeNull();
  });
});
