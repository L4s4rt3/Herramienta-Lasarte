/**
 * Pruebas de supabase/functions/_shared/lineasBoxReenlace.ts: que el reanálisis
 * del parte (que borra y reinserta lotes_dia) NO pierda los desgloses manuales
 * por box, y que no los recoloque a ciegas cuando la pasada ya no está.
 */
import { describe, expect, it } from "vitest";

import {
  codigoBase8,
  emparejarLotesDia,
  normalizarTituloLote,
  recolocarLineasBox,
  type LineaBoxGuardada,
  type LoteDiaMin,
} from "../../supabase/functions/_shared/lineasBoxReenlace";

const linea = (lote_dia_id: string, posicion: number, lote_codigo: string, box: number): LineaBoxGuardada => ({
  user_id: "u1", lote_dia_id, posicion, tipo: "lote", lote_codigo, prec_fecha: null, box, box_tamano: "pequeno", nota: null,
});

describe("normalización", () => {
  it("compara títulos sin espacios repetidos ni mayúsculas y saca el código de 8 dígitos", () => {
    expect(normalizarTituloLote("26090401-26090501-26090701-  26083102-19 BOX")).toBe("26090401-26090501-26090701- 26083102-19 box");
    expect(codigoBase8("PREC- 2 ---18 BOX")).toBeNull();
    expect(codigoBase8("  26090503-58 BOX")).toBe("26090503");
  });
});

describe("emparejarLotesDia", () => {
  const viejos: LoteDiaMin[] = [
    { id: "v-restos", lote_codigo: "26090401-26090501-26090701- 26083102-19 BOX", kg_peso_total: 4022.75 },
    { id: "v-58", lote_codigo: "26090503-58 BOX", kg_peso_total: 12119.23 },
  ];

  it("el caso real del 14-09: mismo día reinsertado con títulos idénticos → cada vieja encuentra su nueva", () => {
    const nuevos: LoteDiaMin[] = [
      { id: "n-58", lote_codigo: "26090503-58 BOX", kg_peso_total: "12119.23" },
      { id: "n-restos", lote_codigo: "26090401-26090501-26090701- 26083102-19 BOX", kg_peso_total: "4022.75" },
    ];
    const m = emparejarLotesDia(viejos, nuevos);
    expect(m.get("v-restos")).toBe("n-restos");
    expect(m.get("v-58")).toBe("n-58");
  });

  it("si el operario reescribió el título, casa por código base y kg (±1 %)", () => {
    const nuevos: LoteDiaMin[] = [
      { id: "n-a", lote_codigo: "26090503 58 box reenviado", kg_peso_total: 12130 },
      { id: "n-b", lote_codigo: "26090503 48 box", kg_peso_total: 10869 },
    ];
    const m = emparejarLotesDia([viejos[1]], nuevos);
    expect(m.get("v-58")).toBe("n-a");
  });

  it("con el mismo código dos veces y kg lejanos, elige el más cercano dentro del 10 % y no reutiliza una nueva", () => {
    const previos: LoteDiaMin[] = [
      { id: "v1", lote_codigo: "26083101 33BOX", kg_peso_total: 6354 },
      { id: "v2", lote_codigo: "26083101-52 box", kg_peso_total: 11527 },
    ];
    const nuevos: LoteDiaMin[] = [
      { id: "n1", lote_codigo: "26083101 primera", kg_peso_total: 6800 },
      { id: "n2", lote_codigo: "26083101 segunda", kg_peso_total: 11000 },
    ];
    const m = emparejarLotesDia(previos, nuevos);
    expect(m.get("v1")).toBe("n1");
    expect(m.get("v2")).toBe("n2");
  });

  it("no inventa pareja: sin código base o con kg fuera del 10 % devuelve null", () => {
    const m = emparejarLotesDia(
      [{ id: "v-prec", lote_codigo: "PREC- 2 ---18 BOX", kg_peso_total: 3742 }, { id: "v-x", lote_codigo: "26090503-58 BOX", kg_peso_total: 12119 }],
      [{ id: "n-y", lote_codigo: "26090503-48 box", kg_peso_total: 10869 }, { id: "n-z", lote_codigo: "26090503 otra", kg_peso_total: 5000 }],
    );
    expect(m.get("v-prec")).toBeNull();
    expect(m.get("v-x")).toBeNull();
  });
});

describe("recolocarLineasBox", () => {
  it("copia las líneas sobre el id nuevo conservando posición, box y nota; lista las que se quedan sin destino", () => {
    const previos: LoteDiaMin[] = [
      { id: "v-restos", lote_codigo: "26090401-26090501-26090701- 26083102-19 BOX", kg_peso_total: 4022.75 },
      { id: "v-58", lote_codigo: "26090503-58 BOX", kg_peso_total: 12119.23 },
      { id: "v-ido", lote_codigo: "26099999 5 box", kg_peso_total: 1000 },
    ];
    const nuevos: LoteDiaMin[] = [
      { id: "n-restos", lote_codigo: "26090401-26090501-26090701- 26083102-19 BOX", kg_peso_total: 4022.75 },
      { id: "n-58", lote_codigo: "26090503-58 BOX", kg_peso_total: 12119.23 },
    ];
    const lineas = [
      { ...linea("v-restos", 1, "26090401", 1.875), nota: "375 kg" },
      linea("v-restos", 2, "26090501", 2.175),
      linea("v-ido", 1, "26099999", 5),
    ];
    const r = recolocarLineasBox(lineas, previos, nuevos);
    expect(r.emparejados).toBe(1);
    expect(r.filas).toEqual([
      { user_id: "u1", lote_dia_id: "n-restos", posicion: 1, tipo: "lote", lote_codigo: "26090401", prec_fecha: null, box: 1.875, box_tamano: "pequeno", nota: "375 kg" },
      { user_id: "u1", lote_dia_id: "n-restos", posicion: 2, tipo: "lote", lote_codigo: "26090501", prec_fecha: null, box: 2.175, box_tamano: "pequeno", nota: null },
    ]);
    expect(r.sinDestino).toEqual([{ lote_dia_id: "v-ido", lote_codigo: "26099999 5 box", lineas: 1 }]);
  });

  it("sin líneas no hace nada", () => {
    expect(recolocarLineasBox([], [], [])).toEqual({ filas: [], sinDestino: [], emparejados: 0 });
  });
});
