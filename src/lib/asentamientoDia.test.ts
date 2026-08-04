import { describe, expect, it } from "vitest";
import {
  construirAsentamientoCampana,
  replayConciliacionPorFecha,
  type AsentamientoInput,
  type EntradaPrecalibradoAsentamiento,
  type EntradaRealAsentamiento,
} from "./asentamientoDia";
import type { EntradaConciliacion, PasadaConciliacion } from "./conciliacionKg";

const real = (over: Partial<EntradaRealAsentamiento> & { lote: string; kg_entrada: number }): EntradaRealAsentamiento => ({
  fecha: "2026-05-01",
  finca: "INVERMARMELO",
  articulo: "NAR VAL DELTA SEEDLESS",
  ...over,
});

const prec = (over: Partial<EntradaPrecalibradoAsentamiento> & { lote: string; kg_entrada: number; fecha: string }): EntradaPrecalibradoAsentamiento => ({
  finca: "PREC 1 ALMACEN",
  ...over,
});

const pasada = (over: Partial<PasadaConciliacion> & { lote_codigo: string; kg_peso_total: number; date: string }): PasadaConciliacion => over;

/** Atajo para no repetir entradas/entradasPrecalibrado/reciclaje vacíos en cada caso. */
function asentar(over: Partial<AsentamientoInput> & { entradas?: EntradaRealAsentamiento[]; pasadas: PasadaConciliacion[] }) {
  return construirAsentamientoCampana({
    entradas: [],
    entradasPrecalibrado: [],
    reciclajePorDia: [],
    hoy: "2026-08-04",
    ...over,
  });
}

describe("construirAsentamientoCampana — pasada simple, un solo lote", () => {
  it("lote nombrado en su propia pasada, sin exceso: evidencia dura, día completo, primera=última pasada", () => {
    const res = asentar({
      entradas: [real({ lote: "26050101", kg_entrada: 20000, fecha: "2026-05-01" })],
      pasadas: [pasada({ lote_codigo: "26050101", kg_peso_total: 19400, date: "2026-05-01" })], // 20000×0,97 exacto
    });
    const lote = res.porLote.find((l) => l.codigo === "26050101")!;
    expect(lote.evidencia).toBe("dura");
    expect(lote.kgEvidenciaDura).toBe(19400);
    expect(lote.kgDerivada).toBe(0);
    expect(lote.kgSinRastro).toBe(600);
    expect(lote.fechaPrimeraPasada).toBe("2026-05-01");
    expect(lote.fechaUltimaPasada).toBe("2026-05-01");
    expect(lote.estadoFinal).toBe("procesado");
    expect(lote.diaCompleto).toBe("2026-05-01");

    expect(res.kgTotales).toBe(20000);
    expect(res.kgEvidenciaDura).toBe(19400);
    expect(res.kgSinRastro).toBe(600);
    expect(res.nLotesEvidenciaDura).toBe(1);
    // El hueco (podrido/merma habitual) del lote COMPLETO no es "sin rastro
    // preocupante": no está en la cola de cierres huérfanos porque tiene
    // evidencia dura fuerte de sobra (600 kg son ruido de umbral, no un hueco real).
    expect(res.kgSinRastroCerrado).toBe(0);
  });

  it("lote nunca nombrado en ninguna pasada: sin_rastro, nunca dura ni derivada, sin fechas de pasada", () => {
    const res = asentar({
      entradas: [
        real({ lote: "26050101", kg_entrada: 20000 }),
        real({ lote: "26050199", kg_entrada: 5000, fecha: "2026-05-01" }), // el "fantasma": ninguna pasada lo menciona
      ],
      pasadas: [pasada({ lote_codigo: "26050101", kg_peso_total: 19400, date: "2026-05-01" })],
    });
    const fantasma = res.porLote.find((l) => l.codigo === "26050199")!;
    expect(fantasma.evidencia).toBe("sin_rastro");
    expect(fantasma.kgEvidenciaDura).toBe(0);
    expect(fantasma.kgDerivada).toBe(0);
    expect(fantasma.kgSinRastro).toBe(5000);
    expect(fantasma.fechaPrimeraPasada).toBeNull();
    expect(fantasma.fechaUltimaPasada).toBeNull();
    expect(fantasma.diaCompleto).toBeNull();
  });
});

describe("construirAsentamientoCampana — pasada COMPUESTA multi-código", () => {
  it("los DOS códigos nombrados son evidencia DURA (aunque el 2º solo reciba vía multi_codigo); un 3º lote de la misma finca NO nombrado queda sin_rastro", () => {
    const res = asentar({
      entradas: [
        real({ lote: "25111002", kg_entrada: 20000, fecha: "2025-11-10" }),
        real({ lote: "25111001", kg_entrada: 15000, fecha: "2025-11-10" }),
        real({ lote: "25111099", kg_entrada: 9000, fecha: "2025-11-10" }), // misma finca/variedad, NUNCA nombrado
      ],
      pasadas: [pasada({ lote_codigo: "25111002+25111001", kg_peso_total: 29929, date: "2025-11-10" })],
    });
    const porCodigo = new Map(res.porLote.map((l) => [l.codigo, l]));

    const principal = porCodigo.get("25111002")!;
    expect(principal.evidencia).toBe("dura");
    expect(principal.kgEvidenciaDura).toBe(19400);
    expect(principal.fechaPrimeraPasada).toBe("2025-11-10");

    const segundo = porCodigo.get("25111001")!;
    expect(segundo.evidencia).toBe("dura"); // multi_codigo es evidencia dura: SÍ estaba nombrado en esa pasada
    expect(segundo.kgDerivada).toBe(0);
    expect(segundo.kgEvidenciaDura).toBeCloseTo(10529);

    const ajeno = porCodigo.get("25111099")!;
    expect(ajeno.evidencia).toBe("sin_rastro"); // NUNCA se le atribuye nada por estar "cerca": no se inventa un casado
    expect(ajeno.kgSinRastro).toBe(9000);
  });
});

describe("construirAsentamientoCampana — precalibrado (PREC) indicado en informe compuesto", () => {
  it("un lote PREC nombrado como código NO-primero en una pasada compuesta, con 0 kg bajo su propio código, se da por DURA (evidencia textual, no un FIFO inventado)", () => {
    const entradas: EntradaRealAsentamiento[] = [
      real({ lote: "25111002", kg_entrada: 20000, fecha: "2025-11-10" }),
      real({ lote: "25111001", kg_entrada: 15000, fecha: "2025-11-10" }),
    ];
    const entradasPrecalibrado: EntradaPrecalibradoAsentamiento[] = [
      prec({ lote: "25111901", kg_entrada: 1000, fecha: "2025-11-05" }),
    ];
    // Misma pasada compuesta que el caso real de arriba, con el PREC añadido
    // como 3er código nombrado: el reparto por capacidad agota el kg en los
    // dos primeros y el PREC se queda con absorbe=0 bajo su propio código —
    // pero el calibrador SÍ lo nombró.
    const pasadas = [pasada({ lote_codigo: "25111002+25111001+25111901", kg_peso_total: 29929, date: "2025-11-10" })];

    const res = asentar({ entradas, entradasPrecalibrado, pasadas });
    const precLote = res.porLote.find((l) => l.codigo === "25111901")!;
    expect(precLote.esPrecalibrado).toBe(true);
    expect(precLote.evidencia).toBe("dura");
    expect(precLote.kgEvidenciaDura).toBe(1000); // se da por consumida entera (regla del dueño: "se usa el que se indique")
    expect(precLote.kgDerivada).toBe(0); // el precalibrado JAMÁS recibe derrame
    expect(precLote.kgSinRastro).toBe(0);
    expect(precLote.estadoFinal).toBe("procesado");
    expect(precLote.diaCompleto).toBe("2025-11-10");
  });

  it("un PREC sin ninguna mención textual ni pasada propia queda sin_rastro (pendiente, cola de revisión manual)", () => {
    const res = asentar({
      entradasPrecalibrado: [prec({ lote: "26072001", kg_entrada: 3000, fecha: "2026-07-20" })],
      pasadas: [],
    });
    const precLote = res.porLote.find((l) => l.codigo === "26072001")!;
    expect(precLote.evidencia).toBe("sin_rastro");
    expect(precLote.kgSinRastro).toBe(3000);
    expect(precLote.estadoFinal).toBe("pendiente");
    expect(precLote.diaCompleto).toBeNull();
  });
});

describe("construirAsentamientoCampana — cámara EXTERNA: nunca recibe derrame", () => {
  it("el lote confirmado en cámara externa queda sin_rastro (0 kg) aunque haya exceso disponible de la misma finca/variedad; el derrame va al otro candidato", () => {
    const res = asentar({
      entradas: [
        real({ lote: "26030101", kg_entrada: 10000, fecha: "2026-03-01", finca: "DEHESILLA" }),
        real({ lote: "26030199", kg_entrada: 8000, fecha: "2026-03-01", finca: "DEHESILLA" }), // en Guadex: NO puede recibir
        real({ lote: "26030198", kg_entrada: 8000, fecha: "2026-03-02", finca: "DEHESILLA" }), // candidato normal
      ],
      pasadas: [pasada({ lote_codigo: "26030101", kg_peso_total: 15000, date: "2026-03-01" })],
      lotesEnCamaraExterna: new Set(["26030199"]),
    });
    const porCodigo = new Map(res.porLote.map((l) => [l.codigo, l]));

    const enGuadex = porCodigo.get("26030199")!;
    expect(enGuadex.evidencia).toBe("sin_rastro");
    expect(enGuadex.kgEvidenciaDura).toBe(0);
    expect(enGuadex.kgDerivada).toBe(0);
    expect(enGuadex.kgSinRastro).toBe(8000); // físicamente imposible que haya pasado por el calibrador

    const receptor = porCodigo.get("26030198")!;
    expect(receptor.evidencia).toBe("derivada");
    expect(receptor.kgDerivada).toBeGreaterThan(0);
    expect(receptor.kgEvidenciaDura).toBe(0);
  });
});

describe("construirAsentamientoCampana — kg_ajuste_stock (informe de stock, sin ninguna pasada)", () => {
  it("el ajuste de stock cuenta como evidencia DURA (medición real, no una asunción) y el lote nace completo desde su fecha de entrada", () => {
    const res = asentar({
      entradas: [real({ lote: "26060101", kg_entrada: 10000, fecha: "2026-06-01", kg_ajuste_stock: 9800 })],
      pasadas: [
        // Pasadas de OTROS lotes, en fechas anteriores a la entrada de este —
        // el "día completo" no debe tomar prestada ninguna de esas fechas.
        pasada({ lote_codigo: "26050101", kg_peso_total: 5000, date: "2026-05-01" }),
      ],
    });
    const lote = res.porLote.find((l) => l.codigo === "26060101")!;
    expect(lote.evidencia).toBe("dura");
    expect(lote.kgEvidenciaDura).toBe(9800);
    expect(lote.kgDerivada).toBe(0);
    expect(lote.kgSinRastro).toBe(200);
    expect(lote.fechaPrimeraPasada).toBeNull(); // nunca lo nombró ninguna pasada de calibrador
    expect(lote.fechaUltimaPasada).toBeNull();
    expect(lote.estadoFinal).toBe("procesado");
    expect(lote.diaCompleto).toBe("2026-06-01"); // su propia fecha de entrada, no la de una pasada ajena
  });

  it("kg_ajuste_stock PARCIAL se combina con kg de pasadas propias (dura) sin duplicar ni perderse", () => {
    const res = asentar({
      entradas: [real({ lote: "26060201", kg_entrada: 10000, fecha: "2026-06-02", kg_ajuste_stock: 4000 })],
      pasadas: [pasada({ lote_codigo: "26060201", kg_peso_total: 5000, date: "2026-06-05" })],
    });
    const lote = res.porLote.find((l) => l.codigo === "26060201")!;
    expect(lote.kgEvidenciaDura).toBe(9000); // 4000 (ajuste) + 5000 (pasada propia)
    expect(lote.kgSinRastro).toBe(1000);
    expect(lote.evidencia).toBe("dura");
  });
});

describe("construirAsentamientoCampana — agregado de cobertura de campaña", () => {
  it("suma kg y nº de lotes por clase de evidencia sobre TODOS los lotes (reales + precalibrado)", () => {
    const res = asentar({
      entradas: [
        real({ lote: "26030101", kg_entrada: 10000, fecha: "2026-03-01", finca: "DEHESILLA" }), // dura
        real({ lote: "26030102", kg_entrada: 8000, fecha: "2026-03-01", finca: "DEHESILLA" }), // derivada (recibe exceso)
        real({ lote: "26030103", kg_entrada: 6000, fecha: "2026-03-01", finca: "DEHESILLA" }), // sin_rastro
      ],
      entradasPrecalibrado: [prec({ lote: "26030199", kg_entrada: 1000, fecha: "2026-03-01" })], // sin_rastro
      pasadas: [pasada({ lote_codigo: "26030101", kg_peso_total: 15000, date: "2026-03-01" })],
    });

    expect(res.kgTotales).toBe(10000 + 8000 + 6000 + 1000);
    expect(res.nLotes).toBe(4);
    expect(res.nLotesEvidenciaDura).toBe(1);
    expect(res.nLotesDerivada).toBe(1);
    expect(res.nLotesSinRastro).toBe(2);
    // Conservación: los tres cubos suman exactamente el total de la campaña.
    expect(res.kgEvidenciaDura + res.kgDerivada + res.kgSinRastro).toBeCloseTo(res.kgTotales);
  });
});

describe("replayConciliacionPorFecha", () => {
  it("reproduce el acumulado kg-a-kg, snapshot por cada fecha con pasadas, en orden cronológico", () => {
    const entradas: EntradaConciliacion[] = [
      { lote: "26070101", fecha: "2026-07-01", finca: "X", articulo: "NAR VAL DELTA", kg_entrada: 20000 },
    ];
    const pasadas: PasadaConciliacion[] = [
      { lote_codigo: "26070101", kg_peso_total: 5000, date: "2026-07-02" },
      { lote_codigo: "26070101", kg_peso_total: 4000, date: "2026-07-05" },
    ];
    const snapshots = replayConciliacionPorFecha(entradas, pasadas);
    expect(snapshots.map((s) => s.fecha)).toEqual(["2026-07-02", "2026-07-05"]);
    expect(snapshots[0].porLote.get("26070101")).toBe(5000);
    expect(snapshots[1].porLote.get("26070101")).toBe(9000); // acumulado, no solo el del día
  });

  it("sin pasadas no hay snapshots (nada que reproducir)", () => {
    expect(replayConciliacionPorFecha([], [])).toEqual([]);
  });
});
