import { describe, it, expect } from "vitest";
import {
  campanaDe,
  campanaSiguiente,
  esFincaDeCampo,
  normalizarSemana,
  preverCampana,
  semanaMasUnAnio,
  semanasEntre,
  type EntradaCurva,
  type EntradaFicha,
  type EntradaPrevision,
} from "@/lib/previsionCampana";

function entrada(p: Partial<EntradaPrevision> & { fecha: string }): EntradaPrevision {
  return {
    finca: "La Torrecilla",
    parcela: "La Torrecilla Salustiana",
    agricultor: "CAMBA S.C.",
    articulo: "NARANJA SALUSTIANA",
    kg_entrada: 10000,
    ...p,
  };
}

function ficha(p: Partial<EntradaFicha> = {}): EntradaFicha {
  return {
    finca: "La Torrecilla",
    parcela: "La Torrecilla Salustiana",
    hectareas: 10,
    emparejado_estado: "clara",
    origen_finca_nombre: "Torrecilla",
    variedad: "Salustiana",
    ...p,
  };
}

function curva(p: Partial<EntradaCurva> = {}): EntradaCurva {
  return {
    finca_nombre: "Torrecilla",
    variedad: "Salustiana",
    ventana_desde: "2026W45",
    ventana_hasta: "2026W48",
    fuente: "previous_season_sizes",
    ...p,
  };
}

describe("campanaDe", () => {
  it("la campaña va de septiembre a agosto", () => {
    expect(campanaDe("2025-10-16")).toBe("2025/26");
    expect(campanaDe("2026-08-12")).toBe("2025/26");
    expect(campanaDe("2026-09-01")).toBe("2026/27");
    expect(campanaDe("2026-12-31")).toBe("2026/27");
    expect(campanaDe("2027-01-02")).toBe("2026/27");
  });

  it("la siguiente es la siguiente", () => {
    expect(campanaSiguiente("2025/26")).toBe("2026/27");
    expect(campanaSiguiente("2029/30")).toBe("2030/31");
  });
});

describe("semanas", () => {
  it("entiende el formato de Aerobotics y el del proyecto", () => {
    expect(normalizarSemana("2026W42")).toBe("2026-W42");
    expect(normalizarSemana("2026W3")).toBe("2026-W03");
    expect(normalizarSemana("2026-W42")).toBe("2026-W42");
    expect(normalizarSemana("")).toBeNull();
    expect(normalizarSemana("la semana que viene")).toBeNull();
  });

  it("lleva una semana un año adelante", () => {
    expect(semanaMasUnAnio("2025-W47")).toBe("2026-W47");
    expect(semanaMasUnAnio("2026-W01")).toBe("2027-W01");
  });

  it("enumera las semanas de una ventana, con las dos incluidas", () => {
    expect(semanasEntre("2026-W45", "2026-W48")).toEqual(["2026-W45", "2026-W46", "2026-W47", "2026-W48"]);
  });

  it("cruza el fin de año sin perderse", () => {
    expect(semanasEntre("2026-W52", "2027-W02")).toEqual(["2026-W52", "2026-W53", "2027-W01", "2027-W02"]);
  });

  it("una ventana del revés o absurdamente larga no vale", () => {
    expect(semanasEntre("2026-W48", "2026-W45")).toEqual([]);
    expect(semanasEntre("2026-W01", "2026-W52")).toEqual([]);
  });
});

describe("esFincaDeCampo", () => {
  it("deja fuera el precalibrado y la importación", () => {
    expect(esFincaDeCampo("La Torrecilla")).toBe(true);
    expect(esFincaDeCampo("PREC 1 ALMACEN")).toBe(false);
    expect(esFincaDeCampo("Importacion")).toBe(false);
    expect(esFincaDeCampo("")).toBe(false);
  });
});

describe("preverCampana", () => {
  const BASE = [
    entrada({ fecha: "2025-11-10", kg_entrada: 30000 }),
    entrada({ fecha: "2025-11-17", kg_entrada: 20000 }),
  ];

  it("la base son los kilos de la campaña pasada, no una cuenta de hectáreas", () => {
    const p = preverCampana({ entradas: BASE, fichas: [ficha({ hectareas: 10 })], curvas: [] });
    expect(p.campanaBase).toBe("2025/26");
    expect(p.campanaObjetivo).toBe("2026/27");
    expect(p.parcelas).toHaveLength(1);
    expect(p.parcelas[0].kgBase).toBe(50000);
    // Las hectáreas se enseñan, pero no multiplican nada.
    expect(p.parcelas[0].hectareas).toBe(10);
    expect(p.parcelas[0].kgPorHa).toBe(5000);
  });

  it("el calendario es el del año pasado, un año después", () => {
    const p = preverCampana({ entradas: BASE, fichas: [], curvas: [] });
    expect(p.parcelas[0].semanas).toEqual([
      { semana: "2026-W46", kg: 30000 },
      { semana: "2026-W47", kg: 20000 },
    ]);
  });

  it("la ventana de Aerobotics NO mueve el calendario: solo contrasta", () => {
    // La ventana es W45-W48 y el año pasado se cogió en W46-W47: cuadra, y los
    // kilos siguen estando donde estaban, sin repartirse por la ventana.
    const p = preverCampana({ entradas: BASE, fichas: [ficha()], curvas: [curva()] });
    expect(p.parcelas[0].ventana).toEqual({ desde: "2026-W45", hasta: "2026-W48", fuente: "previous_season_sizes" });
    expect(p.parcelas[0].avisoVentana).toBe("cuadra");
    expect(p.parcelas[0].semanas).toEqual([
      { semana: "2026-W46", kg: 30000 },
      { semana: "2026-W47", kg: 20000 },
    ]);
  });

  it("avisa cuando se cogió ANTES de que Aerobotics la diera por lista", () => {
    const p = preverCampana({
      entradas: BASE,
      fichas: [ficha()],
      curvas: [curva({ ventana_desde: "2026W49", ventana_hasta: "2026W52" })],
    });
    expect(p.parcelas[0].avisoVentana).toBe("antes");
    expect(p.parcelas[0].semanasDeDesfase).toBe(3); // W46 contra W49
    expect(p.totales.fueraDeVentana).toBe(1);
  });

  it("avisa cuando se terminó DESPUÉS de cerrarse la ventana", () => {
    const p = preverCampana({
      entradas: BASE,
      fichas: [ficha()],
      curvas: [curva({ ventana_desde: "2026W44", ventana_hasta: "2026W45" })],
    });
    expect(p.parcelas[0].avisoVentana).toBe("despues");
    expect(p.parcelas[0].semanasDeDesfase).toBe(2); // W45 contra W47
  });

  it("un emparejamiento dudoso no aporta ni hectáreas ni ventana", () => {
    const p = preverCampana({
      entradas: BASE,
      fichas: [ficha({ emparejado_estado: "probable" })],
      curvas: [curva()],
    });
    expect(p.parcelas[0].hectareas).toBeNull();
    expect(p.parcelas[0].ventana).toBeNull();
    expect(p.parcelas[0].avisoVentana).toBeNull();
  });

  it("descuenta lo que ya ha entrado de la campaña nueva", () => {
    const p = preverCampana({
      entradas: [...BASE, entrada({ fecha: "2026-11-09", kg_entrada: 18000 })],
      fichas: [],
      curvas: [],
    });
    expect(p.parcelas[0].kgEntrado).toBe(18000);
    expect(p.parcelas[0].kgPendiente).toBe(32000);
  });

  it("el precalibrado y la importación no se prevén", () => {
    const p = preverCampana({
      entradas: [
        ...BASE,
        entrada({ fecha: "2025-11-10", finca: "PREC 1 ALMACEN", parcela: "PRE1 Navelina", kg_entrada: 99999 }),
        entrada({ fecha: "2025-11-10", finca: "Importacion", parcela: "Valencia SAF", kg_entrada: 99999 }),
      ],
      fichas: [],
      curvas: [],
    });
    expect(p.parcelas).toHaveLength(1);
    expect(p.totales.kgPrevisto).toBe(50000);
  });

  it("una parcela que solo existe en la campaña nueva no se prevé: no hay de dónde copiar", () => {
    const p = preverCampana({
      entradas: [
        ...BASE,
        entrada({ fecha: "2026-11-09", finca: "Finca Nueva", parcela: "Plantación joven", kg_entrada: 5000 }),
      ],
      fichas: [],
      curvas: [],
    });
    expect(p.campanaBase).toBe("2025/26");
    expect(p.parcelas.map((x) => x.finca)).toEqual(["La Torrecilla"]);
  });

  it("con una sola campaña en los datos, esa es la base y se prevé la siguiente", () => {
    const p = preverCampana({ entradas: [entrada({ fecha: "2026-11-09", kg_entrada: 5000 })], fichas: [], curvas: [] });
    expect(p.campanaBase).toBe("2026/27");
    expect(p.campanaObjetivo).toBe("2027/28");
    expect(p.parcelas[0].kgBase).toBe(5000);
  });

  it("la curva semanal junta lo previsto y lo entrado", () => {
    const p = preverCampana({
      entradas: [...BASE, entrada({ fecha: "2026-11-09", kg_entrada: 18000 })],
      fichas: [],
      curvas: [],
    });
    const w46 = p.porSemana.find((s) => s.semana === "2026-W46");
    expect(w46).toEqual({ semana: "2026-W46", previsto: 30000, entrado: 18000 });
  });

  it("los totales dicen cuánto se apoya en Aerobotics y cuánto en el año pasado", () => {
    const p = preverCampana({
      entradas: [
        ...BASE,
        entrada({ fecha: "2025-12-01", finca: "Otra", parcela: "Otra P", kg_entrada: 10000 }),
      ],
      fichas: [ficha()],
      curvas: [curva()],
    });
    expect(p.totales.parcelas).toBe(2);
    expect(p.totales.kgPrevisto).toBe(60000);
    expect(p.totales.conVentana).toBe(1);
    expect(p.totales.kgConVentana).toBe(50000);
    expect(p.totales.fueraDeVentana).toBe(0);
  });
});
