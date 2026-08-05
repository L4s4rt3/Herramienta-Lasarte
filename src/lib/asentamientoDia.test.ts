import { describe, expect, it } from "vitest";
import {
  construirAsentamientoCampana,
  replayConciliacionPorFecha,
  type AsentamientoInput,
  type EntradaPrecalibradoAsentamiento,
  type EntradaRealAsentamiento,
} from "./asentamientoDia";
import type { EntradaConciliacion, PasadaConciliacion, ReciclajeDiaInput } from "./conciliacionKg";
import { construirEventosLote, type EntradaBasculaEventoInput } from "./eventosLote";
import { derivarCicloVidaLote, type LoteCiclo } from "./cicloVidaLote";

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

/**
 * FASE 3c: la clasificación de evidencia ya no la calcula asentamientoDia.ts
 * por su cuenta — sale de `cicloPorLote` (cicloVidaLote.ts). El banco de
 * pruebas de este archivo construye el ciclo con el MOTOR REAL (mismo camino
 * que useEntradasBascula.ts/useAsentamientoDia.ts) a partir de los mismos
 * datos crudos del caso, para que los números que se verifican aquí sean el
 * comportamiento REAL del motor único, no un mock que pudiera esconder una
 * divergencia.
 */
function cicloDeInput(args: {
  entradas: EntradaRealAsentamiento[];
  entradasPrecalibrado: EntradaPrecalibradoAsentamiento[];
  pasadas: PasadaConciliacion[];
  reciclajePorDia: ReciclajeDiaInput[];
  lotesConfirmadosEnCamara?: Set<string>;
  hoy: string;
}): Map<string, LoteCiclo> {
  const entradasEvento: EntradaBasculaEventoInput[] = [
    ...args.entradas.map((e): EntradaBasculaEventoInput => ({
      lote: e.lote,
      fecha: e.fecha,
      kg_entrada: e.kg_entrada,
      finca: e.finca,
      articulo: e.articulo,
      agricultor: e.agricultor ?? null,
      kg_ajuste_stock: e.kg_ajuste_stock ?? 0,
      merma_camara_kg: e.kg_merma_camara ?? null,
      cerrado_at: e.cerrado_at ?? null,
      cierre_modo: e.cierre_modo ?? null,
    })),
    ...args.entradasPrecalibrado.map((e): EntradaBasculaEventoInput => ({
      lote: e.lote,
      fecha: e.fecha,
      kg_entrada: e.kg_entrada,
      finca: e.finca,
      articulo: null,
      agricultor: null,
      kg_ajuste_stock: 0,
      merma_camara_kg: null,
      cerrado_at: e.cerrado_at ?? null,
      cierre_modo: null,
    })),
  ];
  const entradasConciliacion: EntradaConciliacion[] = [
    ...args.entradas.map((e): EntradaConciliacion => ({
      lote: e.lote,
      fecha: e.fecha,
      finca: e.finca,
      articulo: e.articulo,
      kg_entrada: e.kg_entrada,
      kg_preasignado: Math.max(0, e.kg_ajuste_stock ?? 0),
      esPrecalibrado: false,
      cerrado: Boolean(e.cerrado_at),
      kg_merma_camara: e.kg_merma_camara ?? null,
    })),
    ...args.entradasPrecalibrado.map((e): EntradaConciliacion => ({
      lote: e.lote,
      fecha: e.fecha,
      finca: e.finca,
      articulo: null,
      kg_entrada: e.kg_entrada,
      esPrecalibrado: true,
      cerrado: Boolean(e.cerrado_at),
    })),
  ];
  const eventos = construirEventosLote({
    entradas: entradasEvento,
    entradasConciliacion,
    pasadas: args.pasadas,
    reciclajePorDia: args.reciclajePorDia,
    lotesConfirmadosEnCamara: args.lotesConfirmadosEnCamara,
    hoy: args.hoy,
  });
  const ciclo = derivarCicloVidaLote(eventos, args.hoy);
  return new Map(ciclo.map((c) => [c.lote, c]));
}

/** Atajo para no repetir entradas/entradasPrecalibrado/reciclaje vacíos en cada caso — construye `cicloPorLote` con el motor real salvo que el test lo pase explícito. */
function asentar(over: Partial<AsentamientoInput> & { entradas?: EntradaRealAsentamiento[]; pasadas: PasadaConciliacion[] }) {
  const entradas = over.entradas ?? [];
  const entradasPrecalibrado = over.entradasPrecalibrado ?? [];
  const reciclajePorDia = over.reciclajePorDia ?? [];
  const hoy = over.hoy ?? "2026-08-04";
  const lotesConfirmadosEnCamara = over.lotesConfirmadosEnCamara;
  const cicloPorLote = over.cicloPorLote ?? cicloDeInput({ entradas, entradasPrecalibrado, pasadas: over.pasadas, reciclajePorDia, lotesConfirmadosEnCamara, hoy });
  return construirAsentamientoCampana({
    entradas,
    entradasPrecalibrado,
    pasadas: over.pasadas,
    reciclajePorDia,
    lotesConfirmadosEnCamara,
    cicloPorLote,
    hoy,
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

describe("construirAsentamientoCampana — precalibrado (PREC) mencionado en informe compuesto SIN kg cuantificable", () => {
  /**
   * ANTES de la 3c (motor propio de asentamientoDia.ts): una mención textual
   * en pasada compuesta, aunque el reparto por capacidad no le diera NI UN
   * kg bajo su propio código, se contaba como evidencia "dura" completa (se
   * asumía "se usa el que se indique" y se acreditaba el kg ENTERO de la
   * re-entrada). DESPUÉS de la 3c (cicloVidaLote.ts, kgPorClase.nombrado):
   * solo cuenta el kg que el reparto REALMENTE atribuye al código — una
   * mención sin kg cuantificable abre la "puerta" de completitud (ver
   * cicloVidaLote.ts) pero no aporta NINGÚN kg a kgPorClase.nombrado, así que
   * la card la deja en "sin_rastro" en vez de "dura". Es MÁS HONESTO: antes
   * la card no distinguía "el calibrador lo nombró y sabemos cuánto" de "el
   * calibrador lo nombró pero no hay forma de saber cuánto exactamente" — el
   * mismo patrón (mención sin kg) que motivó la TAREA 0 del cinturón y
   * tirantes (los 5 PREC cerrados el 04-08 sin indicación real, ver
   * cicloVidaLoteAdapter.precalibrado.test.ts). `stockPrecalibrado.ts` puede
   * seguir dando esta re-entrada por "consumida" (motivo "compuesto") para
   * decidir el CIERRE — esa es una pregunta distinta (¿se puede cerrar?) de
   * la que responde esta card (¿con qué solidez sabemos qué pasó con el kg?).
   */
  it("con SOLO la mención (0 kg atribuido bajo su propio código): sin_rastro, no dura — antes era dura=1000/sinRastro=0", () => {
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
    // pero el calibrador SÍ lo nombró (mención sin kg).
    const pasadas = [pasada({ lote_codigo: "25111002+25111001+25111901", kg_peso_total: 29929, date: "2025-11-10" })];

    const res = asentar({ entradas, entradasPrecalibrado, pasadas });
    const precLote = res.porLote.find((l) => l.codigo === "25111901")!;
    expect(precLote.esPrecalibrado).toBe(true);
    // ANTES: evidencia "dura", kgEvidenciaDura=1000, kgSinRastro=0.
    // DESPUÉS (3c, motor único): la mención no trae kg cuantificable, así que
    // NO cuenta como "dura" en la card — sigue "sin_rastro" hasta que haya
    // una fuente REAL de kg (nombrado numérico, anotación, o un cierre).
    expect(precLote.evidencia).toBe("sin_rastro");
    expect(precLote.kgEvidenciaDura).toBe(0);
    expect(precLote.kgDerivada).toBe(0); // el precalibrado JAMÁS recibe derrame (invariante que SÍ se conserva)
    expect(precLote.kgSinRastro).toBe(1000);
    // El eje TIEMPO (estadoFinal/diaCompleto) NO cambia con la 3c: sigue
    // saliendo de la evidencia de pasada compuesta (motor viejo, ver
    // clasificarLotesPrecalibrado) — "resuelta del todo" para el estado,
    // aunque la card de evidencia ya no la cuente como "dura".
    expect(precLote.estadoFinal).toBe("procesado");
    expect(precLote.diaCompleto).toBe("2025-11-10");
  });

  it("un PREC sin ninguna mención textual ni pasada propia queda sin_rastro (pendiente, cola de revisión manual) — sin cambios con la 3c", () => {
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
      lotesConfirmadosEnCamara: new Set(["26030199"]),
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

describe("construirAsentamientoCampana — kg_ajuste_stock (informe de stock, sin ninguna pasada): MEDIDO ya NO cuenta como dura", () => {
  /**
   * ANTES de la 3c: un kg_ajuste_stock (foto de stock) contaba como evidencia
   * "dura" por sí solo ("una medición física, no una asunción" — literal de
   * la cabecera vieja del módulo). DESPUÉS (motor único, REGLA DE ORO): lo
   * MEDIDO (kg_ajuste_stock/merma real/cámara externa/venta directa) fija
   * cantidad/ubicación pero NUNCA prueba por sí solo que el lote se procesó
   * — hace falta ADEMÁS una mención NOMBRADA o una anotación humana (ver
   * cicloVidaLote.ts, "la puerta"). Sin ninguna mención en los partes, un
   * kg_ajuste_stock puro es EXACTAMENTE el patrón de "stock fantasma" que
   * motivó toda la refundación (conciliacionKg.ts: 3,5 M kg de fruta cuyo
   * único "respaldo" era un ajuste sin mención real) — la card ahora lo
   * enseña como "sin rastro" en vez de darlo por bueno. Es MÁS HONESTO: antes
   * la card no distinguía "alguien MIDIÓ esto" de "sabemos QUÉ PASÓ con ello".
   */
  it("sin ninguna mención de calibrador: el ajuste de stock por sí solo es 'sin_rastro' (antes era 'dura'=9800/sinRastro=200)", () => {
    const res = asentar({
      entradas: [real({ lote: "26060101", kg_entrada: 10000, fecha: "2026-06-01", kg_ajuste_stock: 9800 })],
      pasadas: [
        // Pasadas de OTROS lotes, en fechas anteriores a la entrada de este —
        // el "día completo" no debe tomar prestada ninguna de esas fechas.
        pasada({ lote_codigo: "26050101", kg_peso_total: 5000, date: "2026-05-01" }),
      ],
    });
    const lote = res.porLote.find((l) => l.codigo === "26060101")!;
    // ANTES: evidencia "dura", kgEvidenciaDura=9800, kgSinRastro=200.
    // DESPUÉS (3c): sin ninguna mención NOMBRADA/ANOTADA, lo medido (9800) se
    // clasifica como "sin_rastro" — la card ya NO lo confunde con evidencia dura.
    expect(lote.evidencia).toBe("sin_rastro");
    expect(lote.kgEvidenciaDura).toBe(0);
    expect(lote.kgDerivada).toBe(0);
    expect(lote.kgSinRastro).toBe(10000); // medido(9800) + sinRastro(200) del propio kgPorClase
    expect(lote.fechaPrimeraPasada).toBeNull(); // nunca lo nombró ninguna pasada de calibrador
    expect(lote.fechaUltimaPasada).toBeNull();
    // El eje TIEMPO (estadoFinal/diaCompleto) SIGUE viniendo del motor viejo
    // (buildStockEntradas/estadoLotePorProcesado) — NO cambia con la 3c: para
    // el estado del lote, el ajuste de stock sigue completándolo desde su
    // propia fecha de entrada. Es justo la discrepancia que el badge de
    // cicloVidaLoteAdapter.ts (compararConMotorViejo) ya expone en Stock/
    // Trazabilidad — aquí simplemente ya no se "cuadra en silencio" en la
    // card de evidencia.
    expect(lote.estadoFinal).toBe("procesado");
    expect(lote.diaCompleto).toBe("2026-06-01"); // su propia fecha de entrada, no la de una pasada ajena
  });

  it("kg_ajuste_stock PARCIAL + pasada propia: SOLO la pasada cuenta como dura, el ajuste sigue en sin_rastro (antes: dura=9000 combinado)", () => {
    const res = asentar({
      entradas: [real({ lote: "26060201", kg_entrada: 10000, fecha: "2026-06-02", kg_ajuste_stock: 4000 })],
      pasadas: [pasada({ lote_codigo: "26060201", kg_peso_total: 5000, date: "2026-06-05" })],
    });
    const lote = res.porLote.find((l) => l.codigo === "26060201")!;
    // ANTES: kgEvidenciaDura=9000 (4000 ajuste + 5000 pasada combinados),
    // kgSinRastro=1000. DESPUÉS: SOLO la pasada propia (nombrado) cuenta como
    // dura — el ajuste de stock (medido), aunque abrió la "puerta" de
    // completitud junto a la pasada, no aporta kg a kgPorClase.nombrado, así
    // que se queda en "sin rastro" (documentado explícitamente, no un cuadre
    // silencioso: 4000 kg que antes se contaban "dura" ahora son "sin rastro").
    expect(lote.kgEvidenciaDura).toBe(5000); // solo la pasada propia
    expect(lote.kgSinRastro).toBe(5000); // 4000 (ajuste, medido) + 1000 (resto)
    expect(lote.evidencia).toBe("dura"); // sigue "dura" porque la pasada propia (5000) es >0
    // Conservación exacta pese al cambio de reparto entre clases.
    expect(lote.kgEvidenciaDura + lote.kgDerivada + lote.kgSinRastro).toBe(lote.kgEntrada);
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
    // Conservación: los tres cubos suman exactamente el total de la campaña —
    // invariante que se mantiene EXACTO tras la 3c (viene directo del propio
    // invariante de crearKgPorClase en cicloVidaLote.ts).
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
