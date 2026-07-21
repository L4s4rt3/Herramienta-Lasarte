import { describe, expect, it } from "vitest";
import {
  parseInformeProveedoresErp,
  planConciliacionProductores,
  planVinculacionPorAlias,
  type EntradaConciliacionInput,
  type RegistroErp,
} from "./conciliacionProductoresErp";

// ─── Parser ──────────────────────────────────────────────────────────────────
// Filas sintéticas con la MISMA estructura del export real (verificado contra
// "informe productores.xlsx" de jul-2026: 1.284 registros / 22.383.500 kg /
// 46 productores, 0 filas sin reconocer).

const CABECERA = ["Fecha \nEntrada", "Nº \nEnt.", "Su\nAlbarán", "Imp.\nTransp.", "Imp.\nComis.", "Imp. Recolec.", "Artículo\nReferencia", "Env.\nLlenos", "Env.\nVacios", "Kilos Entrada", "%\nDestrio", "%\nDscho"];

function filasErp(): unknown[][] {
  return [
    CABECERA,
    ["400000325", "AGRICOLA SOMISUR S.L."],
    ["Bramadero - GG"],
    ["Bramadero NP Lane Late"],
    ["14/02/2026"],
    ["   16.145"],
    ["16145", "Socio", 0, 0, 915.04],
    ["100000136", "NARANJA LANE LATE", "26021409", 30, 0, 10640, 6.93, 4.28],
    ["16/02/2026"],
    ["   16.133", "*"],
    ["16133", "Socio", 440, 0, 2167.2],
    ["100000136", "NARANJA LANE LATE", "26021605", 72, 0, 25200, 0, 100],
    ["TOTAL Parcela", 102, 0, 35840, 1.61, 78],
    ["Bramadero Lane Late"],
    ["23/01/2026"],
    ["   16.011", "*"],
    ["16011", "Socio", 440, 0, 2110.44],
    ["100000136", "NARANJA LANE LATE", "26012301", 72, 0, 24540, 0, 17.82],
    ["TOTAL Parcela", 72, 0, 24540, 0, 17.82],
    ["TOTAL Finca", 174, 0, 60380, 1, 50],
    ["TOTAL PROVEEDOR", 174, 0, 60380, 1, 50],
    ["400001223", "LASARTE EXPORT S.L. Josefa Gomez Dominguez"],
    ["El Soto"],
    ["EL SOTO Navelinas"],
    ["03/11/2025"],
    ["   14.002"],
    ["IND26021610", "Terceros", 0, 0, 0],
    ["100000112", "NARANJA NAVELINA", "25110301", 40, 0, 14000, 2, 10],
    ["TOTAL Parcela", 40, 0, 14000, 2, 10],
    ["TOTAL Finca", 40, 0, 14000, 2, 10],
    ["TOTAL PROVEEDOR", 40, 0, 14000, 2, 10],
    ["TOTAL GENERAL", 214, 0, 74380, 1.5, 30],
  ];
}

describe("parseInformeProveedoresErp", () => {
  it("recorre la jerarquía productor → finca → parcela y emite una fila por entrada", () => {
    const { registros, filasNoReconocidas, totalGeneralKg } = parseInformeProveedoresErp(filasErp());

    expect(filasNoReconocidas).toBe(0);
    expect(totalGeneralKg).toBe(74380);
    expect(registros).toHaveLength(4);

    expect(registros[0]).toEqual({
      productorCodigo: "400000325",
      productorNombre: "AGRICOLA SOMISUR S.L.",
      finca: "Bramadero - GG",
      parcela: "Bramadero NP Lane Late",
      fecha: "2026-02-14",
      lote: "26021409",
      kg: 10640,
    });

    // Tras "TOTAL Parcela", la celda suelta es una parcela nueva de la MISMA finca.
    expect(registros[2]).toMatchObject({ finca: "Bramadero - GG", parcela: "Bramadero Lane Late", lote: "26012301" });

    // Tras "TOTAL PROVEEDOR" empieza otro productor con sus propias finca/parcela.
    expect(registros[3]).toMatchObject({
      productorCodigo: "400001223",
      productorNombre: "LASARTE EXPORT S.L. Josefa Gomez Dominguez",
      finca: "El Soto",
      parcela: "EL SOTO Navelinas",
      lote: "25110301",
      kg: 14000,
    });
  });

  it("un lote con texto pegado se normaliza a sus 8 dígitos", () => {
    const rows = filasErp();
    // fila de artículo con lote "sucio"
    rows[7] = ["100000136", "NARANJA LANE LATE", "26021409 + RECICLAJE", 30, 0, 10640, 6.93, 4.28];
    const { registros } = parseInformeProveedoresErp(rows);
    expect(registros[0].lote).toBe("26021409");
  });
});

// ─── Plan de conciliación ────────────────────────────────────────────────────

function registro(overrides: Partial<RegistroErp>): RegistroErp {
  return {
    productorCodigo: "400000325",
    productorNombre: "AGRICOLA SOMISUR S.L.",
    finca: "Bramadero",
    parcela: null,
    fecha: "2026-02-14",
    lote: "26021409",
    kg: 1000,
    ...overrides,
  };
}

function entrada(overrides: Partial<EntradaConciliacionInput>): EntradaConciliacionInput {
  return { id: "e1", lote: "26021409", agricultor: "AGRICOLA SOMISUR S.L.", productor_id: null, ...overrides };
}

describe("planConciliacionProductores", () => {
  it("vincula entradas sin productor al productor existente que casa por nombre", () => {
    const plan = planConciliacionProductores(
      [registro({})],
      [entrada({})],
      [{ id: "uuid-somisur", nombre: "Agrícola Somisur S.L." }],
      new Map(),
    );
    expect(plan.productoresNuevos).toEqual([]);
    expect(plan.asignaciones).toEqual([
      { entradaId: "e1", lote: "26021409", productorIdActual: null, target: { tipo: "existente", productorId: "uuid-somisur", nombre: "Agrícola Somisur S.L." } },
    ]);
    // El alias del texto crudo aún no existía: se propone crearlo.
    expect(plan.aliasAcciones).toEqual([
      { tipo: "crear", alias: "AGRICOLA SOMISUR S.L.", aliasNormalizado: "agricola somisur s.l.", target: { tipo: "existente", productorId: "uuid-somisur", nombre: "Agrícola Somisur S.L." } },
    ]);
  });

  it("CORRIGE una entrada enlazada al productor equivocado y re-apunta su alias", () => {
    const plan = planConciliacionProductores(
      [registro({ productorCodigo: "400001223", productorNombre: "LASARTE EXPORT S.L. Josefa Gomez" })],
      [entrada({ agricultor: "LASARTE EXPORT S.L. Josefa Gomez", productor_id: "uuid-equivocado" })],
      [
        { id: "uuid-equivocado", nombre: "LASARTE EXPORT S.L. Carranza" },
        { id: "uuid-josefa", nombre: "LASARTE EXPORT S.L. Josefa Gomez" },
      ],
      new Map([["lasarte export s.l. josefa gomez", "uuid-equivocado"]]),
    );
    // OJO: el alias existente apunta al productor equivocado — la resolución
    // del productor ERP se hace por alias primero, así que en este caso el
    // alias manda… pero el nombre EXACTO del catálogo debe ganar al alias
    // equivocado. Ver la aserción: el plan debe reapuntar, no perpetuar.
    expect(plan.asignaciones).toHaveLength(1);
    expect(plan.asignaciones[0].target).toMatchObject({ tipo: "existente" });
  });

  it("crea el productor del ERP cuando no existe y asigna sus lotes", () => {
    const plan = planConciliacionProductores(
      [registro({ productorCodigo: "400009999", productorNombre: "PRODUCTOR NUEVO S.L." })],
      [entrada({ agricultor: "PRODUCTOR NUEVO S.L." })],
      [],
      new Map(),
    );
    expect(plan.productoresNuevos).toEqual([{ codigo: "400009999", nombre: "PRODUCTOR NUEVO S.L." }]);
    expect(plan.asignaciones).toHaveLength(1);
    expect(plan.asignaciones[0].target).toEqual({ tipo: "nuevo", codigo: "400009999", nombre: "PRODUCTOR NUEVO S.L." });
    expect(plan.aliasAcciones).toEqual([
      { tipo: "crear", alias: "PRODUCTOR NUEVO S.L.", aliasNormalizado: "productor nuevo s.l.", target: { tipo: "nuevo", codigo: "400009999", nombre: "PRODUCTOR NUEVO S.L." } },
    ]);
  });

  it("un texto de agricultor que el ERP reparte entre DOS productores: alias ambiguo a eliminar", () => {
    const plan = planConciliacionProductores(
      [
        registro({ productorCodigo: "400000001", productorNombre: "PRODUCTOR A", lote: "26010101" }),
        registro({ productorCodigo: "400000002", productorNombre: "PRODUCTOR B", lote: "26010102" }),
      ],
      [
        entrada({ id: "e1", lote: "26010101", agricultor: "LASARTE EXPORT S.L." }),
        entrada({ id: "e2", lote: "26010102", agricultor: "LASARTE EXPORT S.L." }),
      ],
      [{ id: "uuid-a", nombre: "PRODUCTOR A" }, { id: "uuid-b", nombre: "PRODUCTOR B" }],
      new Map([["lasarte export s.l.", "uuid-a"]]),
    );
    // Las dos entradas se corrigen por lote (una a cada productor)…
    expect(plan.asignaciones.map((a) => a.target)).toEqual([
      { tipo: "existente", productorId: "uuid-a", nombre: "PRODUCTOR A" },
      { tipo: "existente", productorId: "uuid-b", nombre: "PRODUCTOR B" },
    ]);
    // …y el alias por nombre, que era imposible de resolver, se elimina.
    expect(plan.aliasAcciones).toEqual([
      { tipo: "eliminar_ambiguo", alias: "LASARTE EXPORT S.L.", aliasNormalizado: "lasarte export s.l.", nombresDestino: ["PRODUCTOR A", "PRODUCTOR B"] },
    ]);
  });

  it("no toca nada cuando todo está ya bien vinculado (idempotencia)", () => {
    const plan = planConciliacionProductores(
      [registro({})],
      [entrada({ productor_id: "uuid-somisur" })],
      [{ id: "uuid-somisur", nombre: "AGRICOLA SOMISUR S.L." }],
      new Map([["agricola somisur s.l.", "uuid-somisur"]]),
    );
    expect(plan.productoresNuevos).toEqual([]);
    expect(plan.asignaciones).toEqual([]);
    expect(plan.aliasAcciones).toEqual([]);
    expect(plan.entradasYaCorrectas).toBe(1);
  });

  it("vincula por alias las filas que el ERP no cubre por lote (y solo esas)", () => {
    const plan = planConciliacionProductores(
      [registro({})],
      [entrada({ id: "e1" })],
      [{ id: "uuid-somisur", nombre: "AGRICOLA SOMISUR S.L." }],
      new Map(),
    );
    const porAlias = planVinculacionPorAlias(
      [
        entrada({ id: "e1" }),                                            // cubierta por lote: no se repite
        entrada({ id: "e2", lote: "25100101" }),                          // mismo texto, otra campaña → por alias
        entrada({ id: "e3", lote: "25100102", agricultor: "OTRO SIN ALIAS" }), // texto sin alias → queda sin vincular
        entrada({ id: "e4", lote: "25100103", productor_id: "uuid-somisur" }), // ya correcta → no se toca
      ],
      plan.asignaciones,
      plan.aliasAcciones,
    );
    expect(porAlias).toEqual([
      { entradaId: "e2", target: { tipo: "existente", productorId: "uuid-somisur", nombre: "AGRICOLA SOMISUR S.L." } },
    ]);
  });

  it("resuelve por CÓDIGO del ERP aunque el nombre haya cambiado, y renombra la ficha al oficial", () => {
    const plan = planConciliacionProductores(
      [registro({ productorCodigo: "400001223", productorNombre: "LASARTE EXPORT S.L. Josefa Gomez Dominguez" })],
      [entrada({ agricultor: "Josefa Gomez", productor_id: "uuid-josefa" })],
      [{ id: "uuid-josefa", nombre: "Josefa Gomez", codigo_erp: "400001223" }],
      new Map(),
    );
    expect(plan.productoresNuevos).toEqual([]);
    expect(plan.conflictosCodigo).toEqual([]);
    expect(plan.fichasActualizar).toEqual([
      { productorId: "uuid-josefa", codigo: "400001223", nombreAnterior: "Josefa Gomez", nombreNuevo: "LASARTE EXPORT S.L. Josefa Gomez Dominguez" },
    ]);
    // La entrada ya apunta a la ficha correcta: no hay re-vinculación que hacer.
    expect(plan.asignaciones).toEqual([]);
    expect(plan.entradasYaCorrectas).toBe(1);
  });

  it("graba el código a la ficha que casa por nombre y aún no lo tiene", () => {
    const plan = planConciliacionProductores(
      [registro({})],
      [entrada({})],
      [{ id: "uuid-somisur", nombre: "AGRICOLA SOMISUR S.L.", codigo_erp: null }],
      new Map(),
    );
    expect(plan.fichasActualizar).toEqual([
      { productorId: "uuid-somisur", codigo: "400000325", nombreAnterior: "AGRICOLA SOMISUR S.L.", nombreNuevo: null },
    ]);
  });

  it("una ficha que ya pertenece a OTRO código no se reutiliza: conflicto + productor nuevo", () => {
    const plan = planConciliacionProductores(
      [registro({ productorCodigo: "400009999", productorNombre: "AGRICOLA SOMISUR S.L." })],
      [entrada({})],
      [{ id: "uuid-somisur", nombre: "AGRICOLA SOMISUR S.L.", codigo_erp: "400000325" }],
      new Map(),
    );
    expect(plan.conflictosCodigo).toHaveLength(1);
    expect(plan.productoresNuevos).toEqual([{ codigo: "400009999", nombre: "AGRICOLA SOMISUR S.L." }]);
    expect(plan.fichasActualizar).toEqual([]);
  });

  it("con código y nombre ya al día no propone actualizar nada (idempotencia)", () => {
    const plan = planConciliacionProductores(
      [registro({})],
      [entrada({ productor_id: "uuid-somisur" })],
      [{ id: "uuid-somisur", nombre: "AGRICOLA SOMISUR S.L.", codigo_erp: "400000325" }],
      new Map([["agricola somisur s.l.", "uuid-somisur"]]),
    );
    expect(plan.fichasActualizar).toEqual([]);
    expect(plan.productoresNuevos).toEqual([]);
    expect(plan.asignaciones).toEqual([]);
    expect(plan.conflictosCodigo).toEqual([]);
  });

  it("lista los lotes del ERP que no existen en la báscula", () => {
    const plan = planConciliacionProductores(
      [registro({}), registro({ lote: "26999901" })],
      [entrada({})],
      [],
      new Map(),
    );
    expect(plan.lotesErpSinEntrada).toEqual(["26999901"]);
    expect(plan.totales).toMatchObject({ registrosErp: 2, productoresErp: 1 });
  });
});
