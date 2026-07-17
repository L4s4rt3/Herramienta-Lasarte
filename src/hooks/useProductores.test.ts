import { describe, expect, it } from "vitest";
import { mapProductorAggRowsToClasificacionRows } from "./useProductores";

// mapProductorAggRowsToClasificacionRows adapta las filas de la vista
// agregada lote_clasificacion_productor_agg (migración
// 20260717120000_vistas_agregadas_clasificacion.sql) al mismo shape de
// ClasificacionRow que useProductores.ts obtenía antes descargando
// lote_clasificacion entera para el rango de fechas. Como todo lo que hace
// el hook con estas filas es SUMAR peso_kg/piezas/cartons agrupando por
// productor/grupo_destino/clase/tamano, una fila ya pre-sumada por día
// (columna fecha de la vista, descartada aquí) da el mismo total que sumar
// las filas originales — no hace falta re-agregar por fecha en el cliente.
describe("mapProductorAggRowsToClasificacionRows", () => {
  it("mapea 1:1 las columnas compartidas y descarta fecha (no la usa ClasificacionRow)", () => {
    const rows = [
      { productor: "Finca A", grupo_destino: "EXPORTACION", clase: "1", tamano: "M", fecha: "2026-07-10", peso_kg: 100, piezas: 500, cartons: 10 },
    ];
    expect(mapProductorAggRowsToClasificacionRows(rows)).toEqual([
      { productor: "Finca A", grupo_destino: "EXPORTACION", clase: "1", peso_kg: 100, tamano: "M", piezas: 500, cartons: 10 },
    ]);
  });

  it("null pasa tal cual (no se sustituye por 0 aquí; el consumidor ya usa Number(...) || 0)", () => {
    const rows = [
      { productor: null, grupo_destino: null, clase: null, tamano: null, fecha: null, peso_kg: null, piezas: null, cartons: null },
    ];
    expect(mapProductorAggRowsToClasificacionRows(rows)).toEqual([
      { productor: null, grupo_destino: null, clase: null, peso_kg: null, tamano: null, piezas: null, cartons: null },
    ]);
  });

  it("varias filas de la vista para el mismo productor/grupo/clase/tamano en días distintos suman igual que una única fila cruda con el total", () => {
    // Simula: la vista trae 2 días separados para el mismo productor+grupo+clase+tamano.
    const filasVista = [
      { productor: "Finca A", grupo_destino: "MERCADO", clase: "2", tamano: "L", fecha: "2026-07-10", peso_kg: 60, piezas: 300, cartons: 6 },
      { productor: "Finca A", grupo_destino: "MERCADO", clase: "2", tamano: "L", fecha: "2026-07-11", peso_kg: 40, piezas: 200, cartons: 4 },
    ];
    const mapeadas = mapProductorAggRowsToClasificacionRows(filasVista);
    const sumaKg = mapeadas.reduce((s, r) => s + (r.peso_kg ?? 0), 0);
    const sumaPiezas = mapeadas.reduce((s, r) => s + (r.piezas ?? 0), 0);

    // Equivalente a una única fila cruda de lote_clasificacion con el total del periodo.
    const filaCrudaEquivalente = { productor: "Finca A", grupo_destino: "MERCADO", clase: "2", tamano: "L", peso_kg: 100, piezas: 500, cartons: 10 };

    expect(sumaKg).toBe(filaCrudaEquivalente.peso_kg);
    expect(sumaPiezas).toBe(filaCrudaEquivalente.piezas);
  });

  it("devuelve [] para []", () => {
    expect(mapProductorAggRowsToClasificacionRows([])).toEqual([]);
  });
});
