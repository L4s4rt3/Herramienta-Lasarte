import { describe, expect, it } from "vitest";
import { computeProductoresHistorico, computeProductoresRango, pctMdnaPorDia } from "./useMercadonaLotes";

describe("pctMdnaPorDia", () => {
  it("calcula el % MDNA del día como kg MDNA / kg totales, excluyendo la fila TOTAL", () => {
    const partesById = new Map([["p1", "2026-06-01"]]);
    const productos = [
      { part_id: "p1", producto: null, kg: 10000 }, // fila TOTAL: se excluye
      { part_id: "p1", producto: "MDNA 1KG", kg: 4000 },
      { part_id: "p1", producto: "MDNA GRANEL", kg: 1000 },
      { part_id: "p1", producto: "Otro cliente 5kg", kg: 5000 },
    ];
    const result = pctMdnaPorDia(productos, partesById);
    // total real del día (sin TOTAL) = 4000 + 1000 + 5000 = 10000; mdna = 5000 -> 50%
    expect(result.get("2026-06-01")).toBeCloseTo(50, 5);
  });

  it("da 0% cuando el día solo tiene productos no-MDNA", () => {
    const partesById = new Map([["p1", "2026-06-02"]]);
    const productos = [{ part_id: "p1", producto: "Otro cliente", kg: 500 }];
    const result = pctMdnaPorDia(productos, partesById);
    expect(result.get("2026-06-02")).toBe(0);
  });

  it("no genera entrada para un día donde solo llega la fila TOTAL (producto null)", () => {
    const partesById = new Map([["p1", "2026-06-02"]]);
    const productos = [{ part_id: "p1", producto: null, kg: 0 }];
    const result = pctMdnaPorDia(productos, partesById);
    expect(result.has("2026-06-02")).toBe(false);
  });

  it("ignora filas cuyo part_id no está en partesById", () => {
    const partesById = new Map<string, string>();
    const productos = [{ part_id: "desconocido", producto: "MDNA 1KG", kg: 100 }];
    const result = pctMdnaPorDia(productos, partesById);
    expect(result.size).toBe(0);
  });
});

describe("computeProductoresHistorico", () => {
  const partesById = new Map([
    ["p1", "2026-06-01"],
    ["p2", "2026-06-02"],
  ]);
  // Día 1: 80% MDNA. Día 2: 20% MDNA.
  const pctPorDia = new Map([
    ["2026-06-01", 80],
    ["2026-06-02", 20],
  ]);

  it("pondera el % MDNA de cada lote por los kg del lote y el % del día", () => {
    const lotes = [
      { part_id: "p1", productor: "Finca A", lote_codigo: "L1", producto: "Naranja", kg_peso_total: 1000, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p1", productor: "Finca A", lote_codigo: "L2", producto: "Naranja", kg_peso_total: 1000, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p2", productor: "Finca A", lote_codigo: "L3", producto: "Naranja", kg_peso_total: 2000, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
    ];
    const result = computeProductoresHistorico(lotes, pctPorDia, partesById);
    // kg totales = 4000; kg ponderado = 1000*0.8 + 1000*0.8 + 2000*0.2 = 800+800+400 = 2000
    // pct estimado = 2000/4000 = 50%
    expect(result).toHaveLength(1);
    expect(result[0].productor).toBe("Finca A");
    expect(result[0].kg).toBe(4000);
    expect(result[0].nLotes).toBe(3);
    expect(result[0].pctMdnaEstimado).toBeCloseTo(50, 5);
  });

  it("incluye productores aunque tengan menos de 3 lotes (ya no se corta por nº de lotes)", () => {
    const lotes = [
      { part_id: "p1", productor: "Finca B", lote_codigo: "L1", producto: "Naranja", kg_peso_total: 500, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p1", productor: "Finca B", lote_codigo: "L2", producto: "Naranja", kg_peso_total: 500, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
    ];
    const result = computeProductoresHistorico(lotes, pctPorDia, partesById);
    expect(result).toHaveLength(1);
    expect(result[0].productor).toBe("Finca B");
    expect(result[0].nLotes).toBe(2);
  });

  it("aplica el filtro minKg: excluye productores por debajo del umbral de kg", () => {
    const lotes = [
      { part_id: "p1", productor: "Finca Grande", lote_codigo: "L1", producto: "Naranja", kg_peso_total: 3000, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p2", productor: "Finca Pequena", lote_codigo: "L2", producto: "Naranja", kg_peso_total: 500, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
    ];
    const sinFiltro = computeProductoresHistorico(lotes, pctPorDia, partesById);
    expect(sinFiltro.map((p) => p.productor).sort()).toEqual(["Finca Grande", "Finca Pequena"]);

    const conFiltro = computeProductoresHistorico(lotes, pctPorDia, partesById, 1000);
    expect(conFiltro).toHaveLength(1);
    expect(conFiltro[0].productor).toBe("Finca Grande");
  });

  it("ordena de mayor a menor aprovechamiento estimado", () => {
    const lotes = [
      { part_id: "p2", productor: "Finca Baja", lote_codigo: "L1", producto: "Naranja", kg_peso_total: 100, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p2", productor: "Finca Baja", lote_codigo: "L2", producto: "Naranja", kg_peso_total: 100, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p2", productor: "Finca Baja", lote_codigo: "L3", producto: "Naranja", kg_peso_total: 100, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p1", productor: "Finca Alta", lote_codigo: "L4", producto: "Naranja", kg_peso_total: 100, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p1", productor: "Finca Alta", lote_codigo: "L5", producto: "Naranja", kg_peso_total: 100, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p1", productor: "Finca Alta", lote_codigo: "L6", producto: "Naranja", kg_peso_total: 100, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
    ];
    const result = computeProductoresHistorico(lotes, pctPorDia, partesById);
    expect(result.map((p) => p.productor)).toEqual(["Finca Alta", "Finca Baja"]);
  });

  it("agrupa lotes sin productor bajo 'Sin productor'", () => {
    const lotes = [
      { part_id: "p1", productor: null, lote_codigo: "L1", producto: "Naranja", kg_peso_total: 100, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p1", productor: "", lote_codigo: "L2", producto: "Naranja", kg_peso_total: 100, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
      { part_id: "p1", productor: "  ", lote_codigo: "L3", producto: "Naranja", kg_peso_total: 100, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
    ];
    const result = computeProductoresHistorico(lotes, pctPorDia, partesById);
    expect(result).toHaveLength(1);
    expect(result[0].productor).toBe("Sin productor");
    expect(result[0].nLotes).toBe(3);
  });
});

describe("computeProductoresRango", () => {
  const partesById = new Map([
    ["p1", "2026-06-01"],
    ["p2", "2026-06-15"],
  ]);
  // Día 1: 80% MDNA. Día 2: 20% MDNA.
  const pctPorDia = new Map([
    ["2026-06-01", 80],
    ["2026-06-15", 20],
  ]);
  const lotes = [
    { part_id: "p1", productor: "Finca A", lote_codigo: "L1", producto: "Naranja", kg_peso_total: 1000, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
    { part_id: "p2", productor: "Finca B", lote_codigo: "L2", producto: "Naranja", kg_peso_total: 2000, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
  ];

  it("con desde y hasta null no filtra por fecha: mismo resultado que computeProductoresHistorico sobre todos los lotes", () => {
    const esperado = computeProductoresHistorico(lotes, pctPorDia, partesById);
    const result = computeProductoresRango(lotes, pctPorDia, partesById, null, null);
    expect(result).toEqual(esperado);
  });

  it("restringe correctamente a un rango de fechas: un lote dentro del rango, otro fuera queda excluido", () => {
    const result = computeProductoresRango(lotes, pctPorDia, partesById, "2026-06-01", "2026-06-07");
    expect(result).toHaveLength(1);
    expect(result[0].productor).toBe("Finca A");
    expect(result[0].kg).toBe(1000);
  });

  it("excluye lotes cuyo part_id no tiene fecha conocida cuando se pide un rango", () => {
    const lotesConSinFecha = [
      ...lotes,
      { part_id: "desconocido", productor: "Finca C", lote_codigo: "L3", producto: "Naranja", kg_peso_total: 500, toneladas_hora: 14, duracion_min: 60, peso_fruta_promedio_g: 150 },
    ];
    const result = computeProductoresRango(lotesConSinFecha, pctPorDia, partesById, "2026-06-01", "2026-06-30");
    expect(result.map((p) => p.productor).sort()).toEqual(["Finca A", "Finca B"]);
  });

  it("respeta minKg dentro del rango elegido", () => {
    const sinFiltro = computeProductoresRango(lotes, pctPorDia, partesById, "2026-06-01", "2026-06-30");
    expect(sinFiltro.map((p) => p.productor).sort()).toEqual(["Finca A", "Finca B"]);

    const conFiltro = computeProductoresRango(lotes, pctPorDia, partesById, "2026-06-01", "2026-06-30", 1500);
    expect(conFiltro).toHaveLength(1);
    expect(conFiltro[0].productor).toBe("Finca B");
  });
});
