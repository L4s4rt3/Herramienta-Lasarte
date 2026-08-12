import { describe, expect, it } from "vitest";
import {
  claveProducto,
  deducirCalibreProducto,
  deducirMarcaProducto,
  deducirMetodoVentaMdna,
  deducirProducto,
  INDICE_CONFECCION_SEMILLA,
  kgPorBultoDesdeEmpaque,
  nombreDisplayProducto,
  piezasPorBultoDesdeProducto,
} from "./productosCanonicos";

describe("claveProducto", () => {
  it("colapsa las erratas reales del calibrador en una sola clave", () => {
    // Las 5 variantes que conviven en lote_clasificacion para el mismo producto
    // (comprobado contra la BD, ago-2026).
    const variantes = [
      "MDNA 5 K D-PACK CAL 5/6 (70/84M)",
      "MDNA 5 KG D-PACK CAL 5/6 (70/84MM)",
      "MDNA 5K D-PACK CAL 5/6 (70/84M)",
      "MDNA 5KG D-PACK CAL 5/6 (70/84M)",
      "MDNA 5KG D-PACK CAL 5/6 (70/84M).",
    ];
    const claves = new Set(variantes.map(claveProducto));
    expect(claves.size).toBe(1);
  });

  it("colapsa espacios múltiples y puntuación suelta (D.MARTINEZ)", () => {
    const variantes = [
      "D.MARTINEZ     CAL 1/20- 1/30",
      "D.MARTINEZ    CAL.1/20--1/30",
      "D.MARTINEZ  CAL 1/20-1/30",
    ];
    expect(new Set(variantes.map(claveProducto)).size).toBe(1);
  });

  it("NO colapsa productos que solo se diferencian en el calibre", () => {
    expect(claveProducto("MDNA 5KG D-PACK CAL 5/6")).not.toBe(
      claveProducto("MDNA 5KG D-PACK CAL 3/4"),
    );
  });

  it("NO colapsa productos que solo se diferencian en el formato", () => {
    expect(claveProducto("MDNA 3KG D-PACK CAL 4/5")).not.toBe(
      claveProducto("MDNA 5KG D-PACK CAL 4/5"),
    );
  });

  it("distingue el sufijo que sí es producto distinto (CHICO)", () => {
    expect(claveProducto("MDNA 5KG D-PACK CAL 5/6 (70/84M)")).not.toBe(
      claveProducto("MDNA 5KG D-PACK CAL 5/6 (70/84M) CHICO"),
    );
  });

  it("es estable ante tildes y minúsculas", () => {
    expect(claveProducto("BOX PEQUEÑOS NEGROS")).toBe(claveProducto("box pequenos negros"));
  });

  it("devuelve cadena vacía para vacío/null (el catálogo lo descarta)", () => {
    expect(claveProducto(null)).toBe("");
    expect(claveProducto("   ")).toBe("");
  });
});

describe("nombreDisplayProducto", () => {
  it("gana la variante con más kg", () => {
    const nombre = nombreDisplayProducto([
      { texto: "MDNA 5 K D-PACK CAL 5/6 (70/84M)", kg: 266_616 },
      { texto: "MDNA 5KG D-PACK CAL 5/6 (70/84M)", kg: 605_217 },
    ]);
    expect(nombre).toBe("MDNA 5KG D-PACK CAL 5/6 (70/84M)");
  });

  it("a igualdad de kg es determinista: la más corta, luego alfabética", () => {
    const a = nombreDisplayProducto([
      { texto: "PREC 1 MDNA 3K", kg: 100 },
      { texto: "PREC 1  MDNA 3KG", kg: 100 },
    ]);
    const b = nombreDisplayProducto([
      { texto: "PREC 1  MDNA 3KG", kg: 100 },
      { texto: "PREC 1 MDNA 3K", kg: 100 },
    ]);
    expect(a).toBe("PREC 1 MDNA 3K");
    expect(a).toBe(b);
  });

  it("devuelve null si no hay ninguna variante con texto", () => {
    expect(nombreDisplayProducto([])).toBeNull();
    expect(nombreDisplayProducto([{ texto: "   ", kg: 10 }])).toBeNull();
  });
});

describe("deducirMarcaProducto", () => {
  it("reconoce las marcas de los productos reales", () => {
    expect(deducirMarcaProducto("MDNA 3KG GIRSAC CAL 4/5 (73/92M)")).toBe("MERCADONA");
    expect(deducirMarcaProducto("LA FEA GRANEL CAL 6/7")).toBe("LA FEA");
    expect(deducirMarcaProducto("HARRIE GOESTEN GIRSAC 9X2 K C.3/4")).toBe("HARRIE GOESTEN");
    expect(deducirMarcaProducto("H.GOESTEN GIRSAC 9X2 K CAL 3/4 8 PZAS")).toBe("HARRIE GOESTEN");
    expect(deducirMarcaProducto("HG AZUL GIRSAC 9X2 K CAL 3/4")).toBe("HARRIE GOESTEN");
    expect(deducirMarcaProducto("EDEKA ( HERZSTÜCKE) D-PACK 9X2 KG CAL 1/2")).toBe("EDEKA");
    expect(deducirMarcaProducto("MASTERFRUIT IFCO CAL 4")).toBe("MASTERFRUIT");
  });

  it("LASARTE/LST cede ante la marca que va delante", () => {
    // "LST" aquí es el empaque de Lasarte, no el cliente: manda KOLLA.
    expect(deducirMarcaProducto("KOLLA  LST CAL 1/36")).toBe("KOLLA");
    expect(deducirMarcaProducto("MORA FRERES LST CAL 1/25---1/42")).toBe("MORA FRERES");
    // Sin otra marca delante, sí es Lasarte.
    expect(deducirMarcaProducto("LASARTE GIRSAC 10 X 2 KG CRT")).toBe("LASARTE");
  });

  it("devuelve null si no reconoce ninguna (no inventa 'GENERICA')", () => {
    expect(deducirMarcaProducto("INDUSTRIA")).toBeNull();
    expect(deducirMarcaProducto("GRANEL CAL 6/7")).toBeNull();
    expect(deducirMarcaProducto(null)).toBeNull();
  });
});

describe("deducirCalibreProducto", () => {
  it("extrae el calibre tal y como lo escribe el calibrador", () => {
    expect(deducirCalibreProducto("MDNA 5KG D-PACK CAL 5/6")).toBe("5/6");
    expect(deducirCalibreProducto("D.MARTINEZ JZ CAL 1/24--1/36")).toBe("1/24-1/36");
    expect(deducirCalibreProducto("KOLLA  LST CAL. 1/30")).toBe("1/30");
    expect(deducirCalibreProducto("LA FEA EMP CAL 2/48-1/42")).toBe("2/48-1/42");
  });

  it("devuelve null si el nombre no trae CAL", () => {
    expect(deducirCalibreProducto("INDUSTRIA")).toBeNull();
    expect(deducirCalibreProducto("BOX MANOLO")).toBeNull();
  });
});

describe("kgPorBultoDesdeEmpaque", () => {
  it("lee los kg de los empaques reales", () => {
    expect(kgPorBultoDesdeEmpaque("12 K MDNA 618 LOGIFRUIT")).toBe(12);
    expect(kgPorBultoDesdeEmpaque("10 K PLAST FINO 50X30")).toBe(10);
    expect(kgPorBultoDesdeEmpaque("15 K CARTON GEN NEGRO")).toBe(15);
    expect(kgPorBultoDesdeEmpaque("LA BELLA ANDALOUSE 11 KG")).toBe(11);
    expect(kgPorBultoDesdeEmpaque("EPS 20KG  24603")).toBe(20);
  });

  it("no confunde las medidas de la caja con los kg", () => {
    // 44x30 son centímetros, no kilos.
    expect(kgPorBultoDesdeEmpaque("10 K JZ 44X30")).toBe(10);
    expect(kgPorBultoDesdeEmpaque("20 K CARTON NEGRO COLUMNA 60X40X24")).toBe(20);
    expect(kgPorBultoDesdeEmpaque("15K LA FEA CARTON 64X40X18")).toBe(15);
  });

  it("devuelve null cuando el empaque no declara kg", () => {
    expect(kgPorBultoDesdeEmpaque("BOX GRANDES INDUSTRIA")).toBeNull();
    expect(kgPorBultoDesdeEmpaque("BOX PEQUEÑOS NEGROS")).toBeNull();
    expect(kgPorBultoDesdeEmpaque("IFCOBLL 6416")).toBeNull();
    expect(kgPorBultoDesdeEmpaque("NADA")).toBeNull();
    expect(kgPorBultoDesdeEmpaque(null)).toBeNull();
  });
});

describe("piezasPorBultoDesdeProducto", () => {
  it("lee las mallas por bulto de los girsacs", () => {
    expect(piezasPorBultoDesdeProducto("HARRIE GOESTEN GIRSAC 9X2 K C.3/4")).toEqual({
      piezas: 9,
      kgPorPieza: 2,
    });
    expect(piezasPorBultoDesdeProducto("LASARTE GIRSAC 10 X 2 KG CRT")).toEqual({
      piezas: 10,
      kgPorPieza: 2,
    });
    expect(piezasPorBultoDesdeProducto("EDEKA ( HERZSTÜCKE) D-PACK 9X2 KG CAL 1/2")).toEqual({
      piezas: 9,
      kgPorPieza: 2,
    });
  });

  it("devuelve null en productos que no son girsac por piezas", () => {
    expect(piezasPorBultoDesdeProducto("MDNA 5KG D-PACK CAL 5/6")).toBeNull();
    expect(piezasPorBultoDesdeProducto("LA FEA GRANEL CAL 6/7")).toBeNull();
  });

  it("no toma las medidas de caja como piezas", () => {
    // 50X30 cm: sin K detrás, no casa.
    expect(piezasPorBultoDesdeProducto("LA FEA EMP 50X30")).toBeNull();
  });
});

describe("deducirMetodoVentaMdna", () => {
  it("mapea los cuatro formatos de Mercadona a su método", () => {
    expect(deducirMetodoVentaMdna("MDNA 3KG GIRSAC CAL 4/5 (73/92M)")).toBe("MA3KGC");
    expect(deducirMetodoVentaMdna("MDNA 4KG GIRSAC CAL 6/8 MALLA EXTRUSIONADA")).toBe("MA4KGC");
    expect(deducirMetodoVentaMdna("MDNA 5KG D-PACK CAL 5/6 (70/84M)")).toBe("MA5KGC");
    expect(deducirMetodoVentaMdna("MDNA GRANEL CAL 1/2 (84-100 MM)")).toBe("MA12KGC");
  });

  it("el granel gana al número del calibre", () => {
    // "3/4" es el calibre, no una malla de 3 kg.
    expect(deducirMetodoVentaMdna("MDNA GRANEL CAL 3/4 (77/85 MM)")).toBe("MA12KGC");
    expect(deducirMetodoVentaMdna("MDNA GRANEL 3/4 ( 77/85 MM)")).toBe("MA12KGC");
  });

  it("acepta las variantes de tecleo del formato", () => {
    expect(deducirMetodoVentaMdna("MDNA 5 KG D-PACK CAL 3/4 (77/92MM)")).toBe("MA5KGC");
    expect(deducirMetodoVentaMdna("MDNA 5 K D-PACK CAL 5/6 (70/84M)")).toBe("MA5KGC");
    expect(deducirMetodoVentaMdna("MDNA 4 K EXPRIMIDOR 6-8 (65-80MM)")).toBe("MA4KGC");
  });

  it("no inventa método para el resto de clientes", () => {
    expect(deducirMetodoVentaMdna("KOLLA  LST CAL 1/36")).toBeNull();
    expect(deducirMetodoVentaMdna("LA FEA GRANEL CAL 6/7")).toBeNull();
    expect(deducirMetodoVentaMdna("HARRIE GOESTEN GIRSAC 9X2 K C.3/4")).toBeNull();
    expect(deducirMetodoVentaMdna("INDUSTRIA")).toBeNull();
  });

  it("un MDNA sin formato reconocible se queda sin método, no adivina", () => {
    expect(deducirMetodoVentaMdna("MDNA 4K EN LA M4")).toBe("MA4KGC");
    expect(deducirMetodoVentaMdna("MDNA CAL 3/4  (3/54-3/60) CHICO")).toBeNull();
  });
});

describe("deducirProducto", () => {
  it("compone la ficha completa de una malla de Mercadona", () => {
    const ficha = deducirProducto("MDNA 5KG D-PACK CAL 5/6 (70/84M)", "12 K MDNA 618 LOGIFRUIT");
    expect(ficha.zona).toBe("Mallas");
    expect(ficha.excluido).toBe(false);
    expect(ficha.marca).toBe("MERCADONA");
    expect(ficha.calibre).toBe("5/6");
    expect(ficha.kgPorBulto).toBe(12);
    expect(ficha.piezasPorBulto).toBeNull();
  });

  it("compone la ficha de un girsac con sus mallas por bulto", () => {
    const ficha = deducirProducto("HARRIE GOESTEN GIRSAC 9X2 K C.3/4", "20 K CARTON LST 10X2 K");
    expect(ficha.zona).toBe("Mallas");
    expect(ficha.marca).toBe("HARRIE GOESTEN");
    expect(ficha.piezasPorBulto).toEqual({ piezas: 9, kgPorPieza: 2 });
  });

  it("marca como excluido lo que no es confección vendible", () => {
    expect(deducirProducto("PODRIDO", "BOX GRISES CERRADOS PARA PODRIDO").excluido).toBe(true);
    expect(deducirProducto("MUESTRA", "NADA").excluido).toBe(true);
    expect(deducirProducto("PREC 1 MDNA 3K", "BOX PEQUEÑOS NEGROS").excluido).toBe(true);
  });

  it("la industria va a su zona y sin kg por bulto (box sin kg declarados)", () => {
    const ficha = deducirProducto("INDUSTRIA", "BOX GRANDES INDUSTRIA");
    expect(ficha.zona).toBe("Industria");
    expect(ficha.excluido).toBe(false);
    expect(ficha.kgPorBulto).toBeNull();
  });

  it("sin empaque conocido la ficha nace sin empaque ni kg/bulto, no con 0", () => {
    const ficha = deducirProducto("LA FEA GRANEL CAL 6/7", null);
    expect(ficha.empaque).toBeNull();
    expect(ficha.kgPorBulto).toBeNull();
    expect(ficha.zona).toBe("Graneleras");
  });

  it("es determinista: misma entrada, misma ficha", () => {
    const a = deducirProducto("MDNA 3KG GIRSAC CAL 4/5 (73/92M)", "12 K MDNA 618 LOGIFRUIT");
    const b = deducirProducto("MDNA 3KG GIRSAC CAL 4/5 (73/92M)", "12 K MDNA 618 LOGIFRUIT");
    expect(a).toEqual(b);
  });
});

describe("INDICE_CONFECCION_SEMILLA", () => {
  it("ordena las zonas por mano de obra, con granel como ancla", () => {
    expect(INDICE_CONFECCION_SEMILLA.Graneleras).toBe(1);
    expect(INDICE_CONFECCION_SEMILLA.Mallas!).toBeGreaterThan(INDICE_CONFECCION_SEMILLA.Mesas!);
    expect(INDICE_CONFECCION_SEMILLA.Mesas!).toBeGreaterThan(INDICE_CONFECCION_SEMILLA.Graneleras!);
    expect(INDICE_CONFECCION_SEMILLA.Graneleras!).toBeGreaterThan(INDICE_CONFECCION_SEMILLA.Industria!);
  });

  it("lo excluido es null, no 0 (el precalibrado volverá a línea)", () => {
    expect(INDICE_CONFECCION_SEMILLA.Excluir).toBeNull();
  });
});
