import { describe, expect, it } from "vitest";
import {
  calcularResumenKgPersonaOperacion,
  calcularRendimientoGrupos,
  calcularRendimientoPersonas,
  etiquetaTipoCoste,
  tipoCosteTrabajador,
  totalKgRendimiento,
} from "./asistenciaRendimiento";

describe("calcularRendimientoGrupos", () => {
  it("uses producto_dia packaging to assign kg by confection group", () => {
    const result = calcularRendimientoGrupos({
      parte: {
        producto_dia: [
          { producto: "GENERICO EMP CAL 2/48-1/42", formato_caja: "10 K PLAST FINO 50X30", kg: 100 },
          { producto: "H. MOLINA GIRSAC CAL 4/5-3/4", formato_caja: "20 K CARTON NEGRO COLUMNA", kg: 75 },
          { producto: "H. MUNOZ EN BOX CAL 7/8", formato_caja: "BOX GRANDES INDUSTRIA", kg: 25 },
          { producto: "MDNA 4KG GIRSAC CAL 6/8 MALLA EXTRUSIONADA", formato_caja: "12 K MDNA 618 LOGIFRUIT", kg: 200 },
          { producto: "MDNA 4KG GIRSAC CAL 6/8 MALLA EXTRUSIONADA", formato_caja: "CAJON CAMPO AZUL", kg: 50 },
          { producto: "LA FEA GRANEL CAL 6/7", formato_caja: "15 K PLAST FINO 26", kg: 300 },
          { producto: "INDUSTRIA", formato_caja: "BOX GRANDES INDUSTRIA", kg: 400 },
          { producto: "PREC 1 - 4K EXPRIMIDOR", formato_caja: "BOX PEQUENOS NEGROS", kg: 500 },
          { producto: "VANOOIJEN CITRUS EMP CATARINA CAL 1/22", formato_caja: "15KG CATARINA", kg: 600 },
        ],
      },
      trabajadores: [
        { id: "1", zona: "Envasadoras" },
        { id: "2", zona: "Mallas" },
        { id: "3", zona: "Graneleras" },
      ],
      asistencia: { "1": true, "2": true, "3": false },
    });

    expect(result.Envasadoras).toEqual({ kg: 100, personas: 1 });
    expect(result.Industria).toEqual({ kg: 425, personas: 0 });
    expect(result.Mallas).toEqual({ kg: 325, personas: 1 });
    expect(result.Graneleras).toEqual({ kg: 300, personas: 0 });
  });

  it("keeps product report kg by zone without scaling to real production", () => {
    const result = calcularRendimientoGrupos({
      parte: {
        kg_produccion_calibrador: 250,
        producto_dia: [
          { producto: "GENERICO EMP CAL 2/48-1/42", formato_caja: "10 K PLAST FINO 50X30", kg: 100 },
          { producto: "MDNA 3KG D-PACK CAL 4/5", formato_caja: "12 K MDNA 618 LOGIFRUIT", kg: 200 },
        ],
      },
      trabajadores: [],
      asistencia: {},
    });

    expect(result.Envasadoras.kg).toBe(100);
    expect(result.Mallas.kg).toBe(200);
    expect(totalKgRendimiento(result)).toBe(300);
  });

  it("keeps all product report zones exact even when production differs", () => {
    const result = calcularRendimientoGrupos({
      parte: {
        kg_produccion_calibrador: 350,
        producto_dia: [
          { producto: "ENVASADO GENERICO", kg: 100 },
          { producto: "MDNA 3KG D-PACK", kg: 200 },
          { producto: "INDUSTRIA", formato_caja: "BOX GRANDES INDUSTRIA", kg: 100 },
        ],
      },
      trabajadores: [],
      asistencia: {},
    });

    expect(result.Industria.kg).toBe(100);
    expect(result.Envasadoras.kg).toBe(100);
    expect(result.Mallas.kg).toBe(200);
    expect(totalKgRendimiento(result)).toBe(400);
  });

  it("uses the exact Industria product report cell as industria kg", () => {
    const result = calcularRendimientoGrupos({
      parte: {
        producto_dia: [
          { producto: "Industria", kg: 125 },
          { categoria: "Industria", producto: "Linea informe", kg: 75 },
          { producto: "ENVASADO GENERICO", kg: 200 },
        ],
      },
      trabajadores: [],
      asistencia: {},
    });

    expect(result.Industria.kg).toBe(200);
    expect(result.Envasadoras.kg).toBe(200);
  });

  it("uses the Informe product split directly even when stored cascade production differs", () => {
    const result = calcularRendimientoGrupos({
      parte: {
        resumen_ia: { cascada: { produccion_real: 96779 } },
        kg_produccion_calibrador: 107818.3753,
        producto_dia: [
          { producto: "ENVASADO GENERICO", kg: 35952.8126 },
          { producto: "MDNA 5KG D-PACK", kg: 33459.2399 },
          { producto: "LA FEA GRANEL", kg: 27878.8503 },
        ],
      },
      trabajadores: [],
      asistencia: {},
    });

    expect(result.Envasadoras.kg).toBeCloseTo(35952.8126, 4);
    expect(result.Mallas.kg).toBeCloseTo(33459.2399, 4);
    expect(result.Graneleras.kg).toBeCloseTo(27878.8503, 4);
    expect(totalKgRendimiento(result)).toBeCloseTo(97290.9028, 4);
  });

  it("matches the Informe 0806 product totals", () => {
    const producto_dia = [
      ["D.MARTINEZ  CAL 1/20-1/30", "10 K JZ", 335.142],
      ["D.MARTINEZ  JZ CAL 1/20-1/36", "10 K JZ", 597.3805],
      ["GRANEL LA FEA CAL 6/7 VO", "15 K PLAST FINO 26", 237.273],
      ["GRANEL LA FEA CAL 7/8 VO", "15 K PLAST FINO 26", 71.4137],
      ["H. MOLINA GIRSAC CAL 4/5-3/4", "20 K CARTON NEGRO COLUMNA 60X40X24", 50.754],
      ["H. MOLINA GIRSAC CAL 4/5-3/4- 5/6", "20 K CARTON NEGRO COLUMNA 60X40X24", 2586.4731],
      ["H. MUNOZ EN BOX CAL 7/8", "BOX GRANDES INDUSTRIA", 705.5832],
      ["INDUSTRIA", "BOX GRANDES INDUSTRIA", 10049.5324],
      ["INDUSTRIA GENERADA PRODUCCION LST", "BOX GRANDES INDUSTRIA", 90.6366],
      ["LA FEA EMP CAL 2--2/48", "10 K PLAST FINO 50X30", 1487.6969],
      ["LA FEA EMP CAL 3--3/54", "10 K PLAST FINO 50X30", 1409.1652],
      ["LA FEA GRANEL CAL 6/7", "15 K PLAST FINO 26", 14502.1532],
      ["LA FEA GRANEL CAL 6/7 VO", "15 K PLAST FINO 26", 3602.9865],
      ["LA FEA GRANEL CAL 7/8", "15 K PLAST FINO 26", 1724.2734],
      ["LA FEA GRANEL CAL 7/8 VO", "15 K PLAST FINO 26", 232.0838],
      ["LA FEA GRANEL CAL6/ 7", "15 K NEGRA GENERICA", 1343.1828],
      ["MDNA 3 KG D-PACK GORDO", "12 K MDNA 618 LOGIFRUIT", 4781.9205],
      ["MDNA 3KG D-PACK CAL 4/5 (73/92M) .", "12 K MDNA 618 LOGIFRUIT", 5217.6256],
      ["MDNA 4KG GIRSAC CAL 6/8 MALLA EXTRUSIONADA", "12 K MDNA 618 LOGIFRUIT", 7568.9446],
      ["MDNA 5KG D-PACK CAL 5/6 (70/84M) CHICO", "12 K MDNA 618 LOGIFRUIT", 15890.7492],
      ["MDNA GRANEL 3/4 ( 77/85 MM)", "12 K MDNA 618 LOGIFRUIT", 3259.635],
      ["MDNA GRANEL CAL 1/2 (1/30-1/36) gordas", "12 K MDNA 618 LOGIFRUIT", 612.9135],
      ["MDNA GRANEL CAL 1/2 (84-100 MM)", "12 K MDNA 618 LOGIFRUIT", 2292.9354],
      ["MUESTRA", "NADA", 29.5628],
      ["-MUESTRA-", "NADA", 55.7944],
      ["PICOLITO EMP CAL 3/60", "15 K CARTON COLUMNA LST", 575.259],
      ["PICOLITO LST GIRSAC 10X2 KG CAL 3/4", "20 K CARTON LST", 15492.7965],
      ["PICOLITO LST GIRSAC 10X2 KG CAL 3/4 GORDO", "20 K CARTON LST", 12712.5622],
      ["PODRIDO", "BOX GRISES CERRADOS PARA PODRIDO", 290.9572],
      ["PREC 1 GORDA", "BOX PEQUENOS NEGROS", 10.9434],
    ].map(([producto, formato_caja, kg]) => ({ producto, formato_caja, kg }));

    const result = calcularRendimientoGrupos({
      parte: { producto_dia },
      trabajadores: [],
      asistencia: {},
    });

    expect(result.Envasadoras.kg).toBeCloseTo(4404.6436, 4);
    expect(result.Industria.kg).toBeCloseTo(10845.7522, 4);
    expect(result.Mallas.kg).toBeCloseTo(64301.8257, 4);
    expect(result.Graneleras.kg).toBeCloseTo(27878.8503, 4);
  });

  it("classifies product report rows by warehouse zone and excludes non-production rows", () => {
    const result = calcularRendimientoGrupos({
      parte: {
        producto_dia: [
          { producto: "GENERICO GIRSAC CAL 5/6", formato_caja: "20 K CARTON NEGRO COLUMNA 60X40X24", kg: 1000 },
          { producto: "MDNA 3KG D-PACK CAL 4/5 (73/92M)", formato_caja: "12 K MDNA 618 LOGIFRUIT", kg: 2000 },
          { producto: "MDNA GRANEL CAL 1/2 (1/42-1/36)", formato_caja: "12 K MDNA 618 LOGIFRUIT", kg: 600 },
          { producto: "MDNA 4K EXPRIMIDOR CAL 6/8", formato_caja: "12 K MDNA 618 LOGIFRUIT", kg: 700 },
          { producto: "LA FEA GRANEL CAL 6/7", formato_caja: "LA FEA 15 K PLAST FINO 26", kg: 3000 },
          { producto: "GRANEL 6/7 MUJERES", formato_caja: "15 K CARTON GEN NEGRO", kg: 800 },
          { producto: "LA FEA EMP CAL 3--3/54", formato_caja: "10 K PLAST FINO 50X30", kg: 4000 },
          { producto: "D.MARTINEZ JZ CAL 1/30", formato_caja: "10 K JZ 44X30", kg: 1000 },
          { producto: "INDUSTRIA GENERADA PRODUCCION LST", formato_caja: "BOX GRANDES INDUSTRIA", kg: 5000 },
          { producto: "PRUEBA", formato_caja: "NADA", kg: 6000 },
          { producto: "PODRIDO", formato_caja: "BOX GRISES CERRADOS PARA PODRIDO", kg: 7000 },
          { producto: "PREC 1- 4KG", formato_caja: "BOX PEQUEÑOS NEGROS", kg: 8000 },
          { producto: "PREC 2 CAT 2/3 Y MUJERES", formato_caja: "BOX PEQUEÑOS NEGROS", kg: 9000 },
        ],
      },
      trabajadores: [],
      asistencia: {},
    });

    expect(result.Mallas.kg).toBe(3700);
    expect(result.Graneleras.kg).toBe(4400);
    expect(result.Envasadoras.kg).toBe(5000);
    expect(result.Industria.kg).toBe(5000);
    expect(totalKgRendimiento(result)).toBe(18100);
  });

  it("assigns direct kg per present person and separates general/treatment costs", () => {
    const personas = calcularRendimientoPersonas({
      trabajadores: [
        { id: "1", nombre: "Ana", zona: "Mallas" },
        { id: "2", nombre: "Bea", zona: "Mallas" },
        { id: "3", nombre: "Clara", zona: "Volcador" },
        { id: "4", nombre: "Diana", zona: "Encargadas" },
        { id: "5", nombre: "Eva", zona: "Carga y descarga" },
      ],
      asistencia: { "1": true, "2": true, "3": true, "4": false, "5": true },
      grupos: {
        Envasadoras: { kg: 0, personas: 0 },
        Industria: { kg: 0, personas: 0 },
        Mallas: { kg: 32000, personas: 2 },
        Graneleras: { kg: 0, personas: 0 },
      },
      kgGeneralBase: 48000,
    });

    const ana = personas.find((persona) => persona.id === "1");
    const clara = personas.find((persona) => persona.id === "3");
    const diana = personas.find((persona) => persona.id === "4");
    const eva = personas.find((persona) => persona.id === "5");

    expect(ana?.kgDirectosPersona).toBe(16000);
    expect(ana?.kgGeneralPersona).toBe(16000);
    expect(clara?.tipoCoste).toBe("tratamiento");
    expect(clara?.kgDirectosPersona).toBe(0);
    expect(clara?.kgReferenciaPersona).toBe(16000);
    expect(diana?.tipoCoste).toBe("tratamiento");
    expect(diana?.kgReferenciaPersona).toBe(0);
    expect(eva?.tipoCoste).toBe("no_computa");
    expect(eva?.cuentaKgPersona).toBe(false);
    expect(eva?.kgReferenciaPersona).toBe(0);
    expect(etiquetaTipoCoste("tratamiento")).toBe("Linea tratamiento");
  });

  it("classifies workers without applying operating targets", () => {
    expect(tipoCosteTrabajador({ id: "1", zona: "Mallas" })).toBe("grupo");
    expect(tipoCosteTrabajador({ id: "2", zona: "Punta" })).toBe("tratamiento");
    expect(tipoCosteTrabajador({ id: "3", zona: "Mozos" })).toBe("general");
    expect(tipoCosteTrabajador({ id: "4", zona: "Carga y descarga" })).toBe("no_computa");
    expect(tipoCosteTrabajador({ id: "5", zona: null })).toBe("sin_grupo");
    expect(tipoCosteTrabajador({ id: "6", zona: "Industria" })).toBe("grupo");
  });

  it("classifies detailed operative template zones in the right cost buckets", () => {
    expect(tipoCosteTrabajador({ id: "1", zona: "Responsables mallas" })).toBe("grupo");
    expect(tipoCosteTrabajador({ id: "2", zona: "RPack" })).toBe("grupo");
    expect(tipoCosteTrabajador({ id: "3", zona: "Empaquetadoras mesas" })).toBe("grupo");
    expect(tipoCosteTrabajador({ id: "4", zona: "Carretillero final linea" })).toBe("tratamiento");
    expect(tipoCosteTrabajador({ id: "5", zona: "Transpaletas mecanicas" })).toBe("tratamiento");
    expect(tipoCosteTrabajador({ id: "6", zona: "Responsable mantenimiento" })).toBe("tratamiento");
    expect(tipoCosteTrabajador({ id: "7", zona: "Mozos continuo" })).toBe("general");
  });

  it("builds the daily kg/person operation summary excluding non-computable workers", () => {
    const result = calcularResumenKgPersonaOperacion({
      trabajadores: [
        { id: "1", nombre: "Ana", zona: "Envasadoras" },
        { id: "2", nombre: "Bea", zona: "Punta" },
        { id: "3", nombre: "Clara", zona: "Mozos" },
        { id: "4", nombre: "Diana", zona: "Carga y descarga" },
        { id: "5", nombre: "Eva", zona: "Mallas" },
        { id: "6", nombre: "Ines", zona: "Industria" },
      ],
      asistencia: { "1": true, "2": true, "3": true, "4": true, "5": false, "6": true },
      kgProduccionDia: 90000,
    });

    expect(result.presentes).toBe(5);
    expect(result.presentesComputables).toBe(4);
    expect(result.fueraKgPersona).toBe(1);
    expect(result.kgPersona).toBe(22500);
    expect(result.costes).toEqual({
      "Coste de grupo": 2,
      "Linea tratamiento": 1,
      "Coste general": 1,
      "No computa kg/p": 1,
    });
    expect(result.rows.map((row) => [row.trabajador.id, row.coste, row.calculo, row.kgRef])).toEqual([
      ["3", "Coste general", "Entra kg/p", 22500],
      ["2", "Linea tratamiento", "Entra kg/p", 22500],
      ["1", "Coste de grupo", "Entra kg/p", 22500],
      ["6", "Coste de grupo", "Entra kg/p", 22500],
      ["4", "No computa kg/p", "Fuera kg/p", null],
      ["5", "Coste de grupo", "Entra kg/p", null],
    ]);
  });
});
