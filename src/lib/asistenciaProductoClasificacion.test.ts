import { describe, expect, it } from "vitest";
import {
  clasificarProductoInforme,
  zonaRendimientoDesdeClasificacion,
} from "./asistenciaProductoClasificacion";

describe("asistenciaProductoClasificacion", () => {
  it("classifies confirmed product report rules", () => {
    const cases = [
      ["GENERICO GIRSAC CAL 5/6", "20 K CARTON NEGRO COLUMNA 60X40X24", "Mallas"],
      ["MDNA 3KG D-PACK CAL 4/5 (73/92M)", "12 K MDNA 618 LOGIFRUIT", "Mallas"],
      ["MDNA 4K EXPRIMIDOR CAL 6/8", "12 K MDNA 618 LOGIFRUIT", "Mallas"],
      ["H. GOESTEN AZUL GIRS 9X2 K CAL 3/4", "EPS 20KG  24603", "Mallas"],
      ["MDNA GRANEL CAL 1/2 (1/42-1/36)", "12 K MDNA 618 LOGIFRUIT", "Graneleras"],
      ["GRANEL 6/7 MUJERES", "15 K CARTON GEN NEGRO", "Graneleras"],
      ["LA FEA EMP CAL 3--3/54", "10 K PLAST FINO 50X30", "Mesas"],
      ["D.MARTINEZ JZ CAL 1/30", "10 K JZ 44X30", "Mesas"],
      ["LA FEA EMP CAL 2--2/48-1/42", "LA FEA PLAST REUTILIZABLE 19", "Mesas"],
      ["INDUSTRIA GENERADA PRODUCCION LST", "BOX GRANDES INDUSTRIA", "Industria"],
    ] as const;

    expect(
      cases.map(([producto, empaque, expected]) => [
        producto,
        clasificarProductoInforme({ producto, empaque }).zona,
        expected,
      ]),
    ).toEqual(cases.map(([producto, , expected]) => [producto, expected, expected]));
  });

  it("excludes non-production rows confirmed by the user", () => {
    const excluded = [
      ["", "$10"],
      ["MUESTRA", "NADA"],
      ["PRUEBA", "NADA"],
      ["PODRIDO", "BOX GRISES CERRADOS PARA PODRIDO"],
      ["PREC 2 CAT 2/3 Y MUJERES", "BOX PEQUEÑOS NEGROS"],
      ["PRECALIBRADO EXTRA 1-2 1A", "BOX PEQUEÑOS NEGROS"],
    ] as const;

    expect(excluded.map(([producto, empaque]) => clasificarProductoInforme({ producto, empaque }).computaKgZona))
      .toEqual([false, false, false, false, false, false]);
  });

  it("maps report classifications to rendimiento groups", () => {
    expect(zonaRendimientoDesdeClasificacion("Mesas")).toBe("Envasadoras");
    expect(zonaRendimientoDesdeClasificacion("Graneleras")).toBe("Graneleras");
    expect(zonaRendimientoDesdeClasificacion("Mallas")).toBe("Mallas");
    expect(zonaRendimientoDesdeClasificacion("Industria")).toBe("Industria");
    expect(zonaRendimientoDesdeClasificacion("Excluir")).toBeNull();
  });

  it("allows manual overrides for exceptional products", () => {
    const result = clasificarProductoInforme(
      { producto: "PRODUCTO ESPECIAL", empaque: "CAJA ESPECIAL" },
      { "producto especial|caja especial": "Mallas" },
    );

    expect(result).toMatchObject({
      zona: "Mallas",
      computaKgZona: true,
      motivo: "override_manual",
    });
  });
});
