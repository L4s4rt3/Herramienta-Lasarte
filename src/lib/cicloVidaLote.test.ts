import { describe, expect, it } from "vitest";
import { derivarCicloVidaLote, tieneContradiccionPasadaVsFotoStock } from "@/lib/cicloVidaLote";
import type { EventoLote } from "@/lib/eventosLote";

const HOY = "2026-08-04";

/** Construye rápido el evento de entrada (siempre necesario para que el lote exista). */
function entrada(
  lote: string,
  kg: number,
  fecha = "2026-05-01",
  extra: Partial<{ esPrecalibrado: boolean; esCampoCit: boolean }> = {},
): EventoLote {
  return {
    tipo: "entrada_bascula",
    clase: "medido",
    lote,
    fecha,
    kg,
    esPrecalibrado: false,
    esCampoCit: false,
    ...extra,
  };
}

function derivarUno(eventos: EventoLote[]) {
  const resultado = derivarCicloVidaLote(eventos, HOY);
  expect(resultado).toHaveLength(1);
  return resultado[0];
}

describe("cicloVidaLote — REGLA DE ORO: el derrame nunca completa ni cierra", () => {
  it("un lote con SOLO derrame (sin nombrado/anotado/medido) queda sin_evidencia_suficiente, nunca completo", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "derrame_exceso", clase: "derivado", lote: "26050101", fecha: "2026-05-10", kg: 10000, motivo: "exceso_misma_finca", loteDonante: "26050102" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("sin_evidencia_suficiente");
    expect(lote.pctConEvidenciaDura).toBe(0);
    expect(lote.kgPorClase.derivado).toBe(10000);
    expect(lote.kgPorClase.nombrado).toBe(0);
    expect(lote.contradicciones.some((c) => c.tipo === "exceso_sin_dueno")).toBe(true);
  });

  it("un cierre manual respaldado ÚNICAMENTE por derrame se degrada (nunca hereda 'cerrado' limpio)", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "cierre_manual", clase: "anotado", lote: "26050101", fecha: "2026-07-01", kg: null, cierreModo: "sin_registro" },
      { tipo: "derrame_exceso", clase: "derivado", lote: "26050101", fecha: "2026-05-10", kg: 10000, motivo: "exceso_misma_variedad", loteDonante: "26050102" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("sin_evidencia_suficiente");
    expect(lote.contradicciones.some((c) => c.tipo === "exceso_sin_dueno")).toBe(true);
  });

  it("un cierre manual SIN ningún rastro (ni nombrado ni derrame) sí es legítimo: ANOTADO cierra por sí solo", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "cierre_manual", clase: "anotado", lote: "26050101", fecha: "2026-07-01", kg: null, cierreModo: "sin_registro" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("cerrado");
    expect(lote.pctConEvidenciaDura).toBe(1);
    expect(lote.contradicciones).toHaveLength(0);
  });

  it("el derrame recibido SIEMPRE queda visible como sugerencia (kgPorClase.derivado), aunque no cuente para nada", () => {
    // Lote con nombrado suficiente para completar Y además algo de derrame: el
    // derrame se ve, pero no hace falta para llegar al estado completo.
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: 9700, posicion: "principal" },
      { tipo: "derrame_exceso", clase: "derivado", lote: "26050101", fecha: "2026-05-06", kg: 200, motivo: "exceso_misma_finca", loteDonante: "26050103" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("completo_pendiente_cierre");
    expect(lote.kgPorClase.derivado).toBeGreaterThan(0);
  });
});

describe("cicloVidaLote — jerarquía de evidencia (nombrado/anotado abren la puerta, medido no)", () => {
  it("medido puro (sin ninguna mención) NO completa aunque cubra el 100 % — se queda sin_rastro", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "foto_stock", clase: "medido", lote: "26050101", fecha: "2026-05-01", kg: 10000 },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("sin_rastro");
    expect(lote.pctConEvidenciaDura).toBe(0);
  });

  it("mención SIN kg cuantificado (kg:null) abre la puerta y deja que lo medido complete", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: null, posicion: "principal" },
      { tipo: "foto_stock", clase: "medido", lote: "26050101", fecha: "2026-05-01", kg: 10000 },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("completo_pendiente_cierre");
  });

  it("una anotación de pasada con kg también abre la puerta (equivale a nombrado)", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "anotacion_pasada", clase: "anotado", lote: "26050101", fecha: "2026-05-05", kg: 9800, nota: "confirmado por dirección" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("completo_pendiente_cierre");
    expect(lote.kgPorClase.anotado).toBe(9800);
  });

  it("merma real de cámara NO cuenta hacia el umbral de completitud (ya la absorbe el umbral relajado por edad)", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: 5000, posicion: "principal" },
      { tipo: "merma_camara", clase: "medido", lote: "26050101", fecha: "2026-05-01", kg: 5000 },
    ];
    const lote = derivarUno(eventos);
    // 5000/10000 = 50% de evidencia nombrada real: muy por debajo de cualquier umbral.
    expect(lote.estado).toBe("parcial");
    expect(lote.kgPorClase.medido).toBe(5000);
  });
});

describe("cicloVidaLote — señales de ubicación (medido/anotado) vetan cierre y derrame", () => {
  it("cámara externa vigente ('en_camara') fuerza estado en_camara_externa, no completa aunque haya derrame", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "camara_externa", clase: "medido", lote: "26050101", fecha: "2026-05-02", kg: 10000, procedencia: "GUADEX", estadoCamion: "en_camara" },
      { tipo: "derrame_exceso", clase: "derivado", lote: "26050101", fecha: "2026-05-10", kg: 9000, motivo: "exceso_misma_finca", loteDonante: "26050102" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("en_camara_externa");
  });

  it("cámara externa con estado 'recibido' no debería llegar como evento (caducidad la gestiona eventosLote.ts) — si llegara, no bloquea", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: 9800, posicion: "principal" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("completo_pendiente_cierre");
  });

  it("confirmación física vigente fuerza en_camara_confirmada", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "confirmacion_fisica", clase: "anotado", lote: "26050101", fecha: "2026-06-01", kg: null, nombreCamara: "Cámara 5" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("en_camara_confirmada");
  });

  it("venta directa es una explicación terminal: manda incluso con un cierre manual encima", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "venta_directa", clase: "medido", lote: "26050101", fecha: "2026-05-02", kg: 10000, detalle: "Venta directa a Fulano" },
      { tipo: "cierre_manual", clase: "anotado", lote: "26050101", fecha: "2026-07-01", kg: null, cierreModo: "sin_registro" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("venta_directa");
  });

  it("CAMPO/CIT se deriva a Cítrica sin mirar ninguna otra evidencia", () => {
    const eventos: EventoLote[] = [entrada("26050101", 10000, "2026-05-01", { esCampoCit: true })];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("derivado_citrica");
  });
});

describe("cicloVidaLote — contradicciones de primera clase", () => {
  it("pasada_vs_foto_stock: ajuste negativo grande que anula una pasada propia", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: 9500, posicion: "principal" },
      { tipo: "foto_stock", clase: "medido", lote: "26050101", fecha: "2026-05-01", kg: -9000 },
    ];
    const lote = derivarUno(eventos);
    expect(lote.contradicciones.some((c) => c.tipo === "pasada_vs_foto_stock")).toBe(true);
  });

  it("un ajuste negativo PEQUEÑO (ruido de redondeo) NO dispara la contradicción", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: 9500, posicion: "principal" },
      { tipo: "foto_stock", clase: "medido", lote: "26050101", fecha: "2026-05-01", kg: -200 },
    ];
    const lote = derivarUno(eventos);
    expect(lote.contradicciones.some((c) => c.tipo === "pasada_vs_foto_stock")).toBe(false);
  });

  // ─── tieneContradiccionPasadaVsFotoStock — corolario de la REGLA DE ORO ────
  // (decisión del dueño 05-08-2026, FASE 3d, ver docs/TRAZABILIDAD_REFUNDACION.md):
  // envoltorio con nombre sobre la MISMA condición de arriba, para que
  // mermaPorProductor.ts (y cualquier ranking por productor) no repita el
  // `.some(c => c.tipo === ...)` en cada sitio que lo necesite.
  it("tieneContradiccionPasadaVsFotoStock: true solo cuando esa contradicción concreta está presente", () => {
    const conContradiccion: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: 9500, posicion: "principal" },
      { tipo: "foto_stock", clase: "medido", lote: "26050101", fecha: "2026-05-01", kg: -9000 },
    ];
    expect(tieneContradiccionPasadaVsFotoStock(derivarUno(conContradiccion))).toBe(true);

    const sinContradiccion: EventoLote[] = [entrada("26050102", 10000, "2026-05-01")];
    expect(tieneContradiccionPasadaVsFotoStock(derivarUno(sinContradiccion))).toBe(false);

    // Otra contradicción distinta (exceso_sin_dueno) no cuenta para este predicado.
    const conOtraContradiccion: EventoLote[] = [
      entrada("26050103", 10000, "2026-05-01"),
      { tipo: "derrame_exceso", clase: "derivado", lote: "26050103", fecha: "2026-05-10", kg: 10000, motivo: "exceso_misma_finca", loteDonante: "26050104" },
    ];
    expect(tieneContradiccionPasadaVsFotoStock(derivarUno(conOtraContradiccion))).toBe(false);

    // null/undefined (lote sin ciclo derivado, p. ej. sin entrada de báscula): false, nunca lanza.
    expect(tieneContradiccionPasadaVsFotoStock(null)).toBe(false);
    expect(tieneContradiccionPasadaVsFotoStock(undefined)).toBe(false);
  });

  it("prec_sin_indicacion: precalibrado sin ninguna mención en los informes", () => {
    const eventos: EventoLote[] = [entrada("26050101", 5000, "2026-05-01", { esPrecalibrado: true })];
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("sin_rastro");
    expect(lote.contradicciones.some((c) => c.tipo === "prec_sin_indicacion")).toBe(true);
  });

  it("precalibrado CON mención (indicado en el informe) no dispara prec_sin_indicacion", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 5000, "2026-05-01", { esPrecalibrado: true }),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: null, posicion: "no_principal" },
    ];
    const lote = derivarUno(eventos);
    expect(lote.contradicciones.some((c) => c.tipo === "prec_sin_indicacion")).toBe(false);
  });

  it("sin_rastro_con_edad: lote real sin ninguna evidencia y ya con antigüedad sospechosa", () => {
    const eventos: EventoLote[] = [entrada("26050101", 5000, "2026-06-01")]; // ~64 días hasta HOY
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("sin_rastro");
    expect(lote.contradicciones.some((c) => c.tipo === "sin_rastro_con_edad")).toBe(true);
  });

  it("un lote real MUY reciente sin evidencia NO dispara sin_rastro_con_edad todavía (puede que no le toque)", () => {
    const eventos: EventoLote[] = [entrada("26050101", 5000, "2026-08-02")]; // 2 días
    const lote = derivarUno(eventos);
    expect(lote.estado).toBe("sin_rastro");
    expect(lote.contradicciones.some((c) => c.tipo === "sin_rastro_con_edad")).toBe(false);
  });
});

describe("cicloVidaLote — invariante de conservación", () => {
  it("Σ kg por clase siempre suma exactamente kg_entrada, con mezcla de todas las clases", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: 6000, posicion: "principal" },
      { tipo: "foto_stock", clase: "medido", lote: "26050101", fecha: "2026-05-01", kg: 1000 },
      { tipo: "derrame_exceso", clase: "derivado", lote: "26050101", fecha: "2026-05-06", kg: 500, motivo: "exceso_misma_finca", loteDonante: "X" },
    ];
    const lote = derivarUno(eventos);
    const { nombrado, anotado, medido, derivado, sinRastro } = lote.kgPorClase;
    expect(nombrado + anotado + medido + derivado + sinRastro).toBeCloseTo(10000, 5);
  });

  it("un cierre manual reparte el resto como anotado y la suma sigue cerrando exacta", () => {
    const eventos: EventoLote[] = [
      entrada("26050101", 10000, "2026-05-01"),
      { tipo: "pasada_nombrada", clase: "nombrado", lote: "26050101", fecha: "2026-05-05", kg: 4000, posicion: "principal" },
      { tipo: "cierre_manual", clase: "anotado", lote: "26050101", fecha: "2026-07-01", kg: null, cierreModo: "con_analisis" },
    ];
    const lote = derivarUno(eventos);
    const { nombrado, anotado, medido, derivado, sinRastro } = lote.kgPorClase;
    expect(nombrado + anotado + medido + derivado + sinRastro).toBeCloseTo(10000, 5);
    expect(anotado).toBeCloseTo(6000, 5);
    expect(sinRastro).toBeCloseTo(0, 5);
  });
});

describe("cicloVidaLote — varios lotes de una campaña", () => {
  it("deriva cada lote de forma independiente y ordena el resultado por código", () => {
    const eventos: EventoLote[] = [
      entrada("26050202", 1000, "2026-05-02"),
      entrada("26050101", 1000, "2026-05-01"),
    ];
    const resultado = derivarCicloVidaLote(eventos, HOY);
    expect(resultado.map((r) => r.lote)).toEqual(["26050101", "26050202"]);
  });
});
