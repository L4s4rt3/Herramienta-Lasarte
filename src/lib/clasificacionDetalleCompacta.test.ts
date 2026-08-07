import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLASIF_DETALLE_COLUMNAS,
  mapClasifDetalleCompacto,
} from "./clasificacionDetalleCompacta";

const MIGRACION = resolve(
  __dirname,
  "../../supabase/migrations/20260730110000_rpc_clasificacion_detalle_por_partes.sql",
);

describe("contrato con la RPC", () => {
  // ESTE es el candado del formato compacto: la RPC devuelve arrays
  // posicionales, así que un reordenamiento en el SQL que no se replique en
  // CLASIF_DETALLE_COLUMNAS mezclaría los campos EN SILENCIO (el productor
  // acabaría en `producto` y ningún error saltaría).
  it("el orden de columnas del cliente es el mismo que el del jsonb_build_array de la migración", () => {
    const sql = readFileSync(MIGRACION, "utf8");
    const bloque = sql.slice(sql.indexOf("jsonb_build_array("), sql.indexOf("order by id"));
    const columnasSql = bloque
      .slice(bloque.indexOf("(") + 1, bloque.lastIndexOf(")"))
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    expect(columnasSql).toEqual([...CLASIF_DETALLE_COLUMNAS]);
  });
});

describe("mapClasifDetalleCompacto", () => {
  // `unknown[]`: el jsonb trae nulos y los numeric llegan como texto.
  const fila: unknown[] = [
    "26051102", "26051102", "LA TORRECILLA", "VALENCIA DELTA", "PRIMERA", "Cat1 A",
    "exportacion", "(09) 3/60", 120, 12.5, "1234.5", 10.2, 40, 8.1,
    "c9972a64-59e4-4856-97f2-610a9edac915",
  ];

  it("coloca cada posición en su campo", () => {
    const [r] = mapClasifDetalleCompacto([fila]);
    expect(r).toEqual({
      lote_codigo: "26051102",
      lote_codigo_base: "26051102",
      productor: "LA TORRECILLA",
      producto: "VALENCIA DELTA",
      calidad: "PRIMERA",
      clase: "Cat1 A",
      grupo_destino: "exportacion",
      tamano: "(09) 3/60",
      piezas: 120,
      pct_piezas: 12.5,
      peso_kg: 1234.5, // los numeric de Postgres llegan como texto en jsonb
      pct_peso: 10.2,
      cartons: 40,
      pct_cartons: 8.1,
      part_id: "c9972a64-59e4-4856-97f2-610a9edac915",
    });
  });

  it("respeta los nulos sin convertirlos en 0 ni en cadena vacía", () => {
    const conNulos = [...fila];
    conNulos[1] = null; conNulos[4] = null; conNulos[8] = null; conNulos[12] = null;
    const [r] = mapClasifDetalleCompacto([conNulos]);
    expect(r.lote_codigo_base).toBeNull();
    expect(r.calidad).toBeNull();
    expect(r.piezas).toBeNull();
    expect(r.cartons).toBeNull();
  });

  it("descarta filas sin part_id y tolera basura sin reventar", () => {
    const sinPartId = [...fila];
    sinPartId[14] = null;
    expect(mapClasifDetalleCompacto([sinPartId])).toEqual([]);
    expect(mapClasifDetalleCompacto(null)).toEqual([]);
    expect(mapClasifDetalleCompacto({ ok: true })).toEqual([]);
    expect(mapClasifDetalleCompacto(["no soy un array"])).toEqual([]);
  });
});
