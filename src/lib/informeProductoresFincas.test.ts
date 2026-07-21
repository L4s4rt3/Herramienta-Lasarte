import { describe, expect, it } from "vitest";
import {
  buildInformeProductoresFincas,
  SIN_AGRICULTOR_LABEL,
  SIN_FINCA_LABEL,
  type EntradaInformeInput,
} from "./informeProductoresFincas";

const SIN_ALIAS = new Map<string, string>();
const SIN_NOMBRES = new Map<string, string>();

function entrada(overrides: Partial<EntradaInformeInput>): EntradaInformeInput {
  return {
    fecha: "2025-10-01",
    agricultor: "AGRICOLA SOMISUR S.L.",
    finca: "Bramadero",
    envases: 10,
    kg_entrada: 1000,
    ...overrides,
  };
}

describe("buildInformeProductoresFincas", () => {
  it("agrupa productor → fincas con totales y ordena por kg desc", () => {
    const informe = buildInformeProductoresFincas(
      [
        entrada({ finca: "Bramadero", kg_entrada: 1000, envases: 10 }),
        entrada({ finca: "Bramadero", kg_entrada: 500, envases: 5 }),
        entrada({ finca: "Los Zamorales", kg_entrada: 2000, envases: 20 }),
        entrada({ agricultor: "EL ESPARRAGAL S.A.", finca: "El Esparragal", kg_entrada: 9000, envases: 90 }),
      ],
      { desde: "2025-09-01", hasta: "2026-07-20", aliasPorNombreNormalizado: SIN_ALIAS, nombrePorProductorId: SIN_NOMBRES },
    );

    expect(informe.totalKg).toBe(12500);
    expect(informe.totalEntradas).toBe(4);
    expect(informe.totalEnvases).toBe(125);
    expect(informe.nFincas).toBe(3);

    // Ordenado por kg desc: El Esparragal (9000) antes que Somisur (3500).
    expect(informe.productores.map((p) => p.nombre)).toEqual(["EL ESPARRAGAL S.A.", "AGRICOLA SOMISUR S.L."]);

    const somisur = informe.productores[1];
    expect(somisur.kg).toBe(3500);
    expect(somisur.nEntradas).toBe(3);
    // Fincas del productor también por kg desc.
    expect(somisur.fincas.map((f) => f.finca)).toEqual(["Los Zamorales", "Bramadero"]);
    expect(somisur.fincas[1]).toMatchObject({ finca: "Bramadero", nEntradas: 2, envases: 15, kg: 1500 });
  });

  it("filtra por rango de fechas con ambos extremos inclusive", () => {
    const informe = buildInformeProductoresFincas(
      [
        entrada({ fecha: "2025-08-31", kg_entrada: 111 }),
        entrada({ fecha: "2025-09-01", kg_entrada: 1000 }),
        entrada({ fecha: "2026-07-20", kg_entrada: 2000 }),
        entrada({ fecha: "2026-07-21", kg_entrada: 999 }),
      ],
      { desde: "2025-09-01", hasta: "2026-07-20", aliasPorNombreNormalizado: SIN_ALIAS, nombrePorProductorId: SIN_NOMBRES },
    );
    expect(informe.totalKg).toBe(3000);
    expect(informe.totalEntradas).toBe(2);
  });

  it("unifica variantes del mismo productor vía alias y usa el nombre canónico del catálogo", () => {
    const alias = new Map([
      ["lasarte export s.l. josefa gomez", "uuid-josefa"],
      ["lasarte export sl josefa gomez", "uuid-josefa"],
    ]);
    const nombres = new Map([["uuid-josefa", "LASARTE EXPORT S.L. Josefa Gómez Domínguez"]]);

    const informe = buildInformeProductoresFincas(
      [
        entrada({ agricultor: "LASARTE EXPORT S.L. Josefa Gomez", finca: "El Soto", kg_entrada: 100 }),
        entrada({ agricultor: "LASARTE EXPORT SL JOSEFA GOMEZ", finca: "El Soto", kg_entrada: 200 }),
      ],
      { desde: "2025-09-01", hasta: "2026-07-20", aliasPorNombreNormalizado: alias, nombrePorProductorId: nombres },
    );

    expect(informe.productores).toHaveLength(1);
    expect(informe.productores[0].nombre).toBe("LASARTE EXPORT S.L. Josefa Gómez Domínguez");
    expect(informe.productores[0].fincas).toEqual([
      { finca: "El Soto", nEntradas: 2, envases: 20, kg: 300, ultimaFecha: "2025-10-01" },
    ]);
  });

  it("prioriza productor_id directo de la fila sobre el texto del agricultor", () => {
    const nombres = new Map([["uuid-directo", "Productor Canónico"]]);
    const informe = buildInformeProductoresFincas(
      [
        entrada({ agricultor: "NOMBRE CUALQUIERA", productor_id: "uuid-directo", kg_entrada: 100 }),
        entrada({ agricultor: "OTRO TEXTO DISTINTO", productor_id: "uuid-directo", kg_entrada: 200 }),
      ],
      { desde: "2025-09-01", hasta: "2026-07-20", aliasPorNombreNormalizado: SIN_ALIAS, nombrePorProductorId: nombres },
    );
    expect(informe.productores).toHaveLength(1);
    expect(informe.productores[0]).toMatchObject({ key: "id:uuid-directo", nombre: "Productor Canónico", kg: 300 });
  });

  it("una finca con el mismo nombre bajo dos productores NO se mezcla", () => {
    const informe = buildInformeProductoresFincas(
      [
        entrada({ agricultor: "AGRICOLA SOMISUR S.L.", finca: "El Soto", kg_entrada: 100 }),
        entrada({ agricultor: "EL ESPARRAGAL S.A.", finca: "El Soto", kg_entrada: 200 }),
      ],
      { desde: "2025-09-01", hasta: "2026-07-20", aliasPorNombreNormalizado: SIN_ALIAS, nombrePorProductorId: SIN_NOMBRES },
    );
    expect(informe.productores).toHaveLength(2);
    expect(informe.nFincas).toBe(2);
  });

  it("entradas sin finca o sin agricultor caen en etiquetas explícitas", () => {
    const informe = buildInformeProductoresFincas(
      [
        entrada({ agricultor: null, finca: null, kg_entrada: 100 }),
        entrada({ agricultor: "   ", finca: "  ", kg_entrada: 50 }),
      ],
      { desde: "2025-09-01", hasta: "2026-07-20", aliasPorNombreNormalizado: SIN_ALIAS, nombrePorProductorId: SIN_NOMBRES },
    );
    expect(informe.productores).toHaveLength(1);
    expect(informe.productores[0].nombre).toBe(SIN_AGRICULTOR_LABEL);
    expect(informe.productores[0].fincas[0].finca).toBe(SIN_FINCA_LABEL);
    expect(informe.productores[0].kg).toBe(150);
  });

  it("ultimaFecha refleja la entrada más reciente de la finca dentro del periodo", () => {
    const informe = buildInformeProductoresFincas(
      [
        entrada({ fecha: "2026-02-14" }),
        entrada({ fecha: "2025-11-03" }),
        entrada({ fecha: "2026-07-30" }), // fuera de rango: no cuenta
      ],
      { desde: "2025-09-01", hasta: "2026-07-20", aliasPorNombreNormalizado: SIN_ALIAS, nombrePorProductorId: SIN_NOMBRES },
    );
    expect(informe.productores[0].fincas[0].ultimaFecha).toBe("2026-02-14");
  });

  it("con cero entradas en rango devuelve informe vacío", () => {
    const informe = buildInformeProductoresFincas(
      [entrada({ fecha: "2024-01-01" })],
      { desde: "2025-09-01", hasta: "2026-07-20", aliasPorNombreNormalizado: SIN_ALIAS, nombrePorProductorId: SIN_NOMBRES },
    );
    expect(informe.productores).toEqual([]);
    expect(informe.totalKg).toBe(0);
    expect(informe.nFincas).toBe(0);
  });
});
