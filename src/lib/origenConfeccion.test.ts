import { describe, expect, it } from "vitest";
import {
  evaluarCoherenciaExpedicion,
  fechaDeCodigoLote,
  interpretarCodigoLote,
  numeroDeCodigoLote,
  ordenarVolcadosCandidatos,
  type VolcadoDelDiaInput,
} from "./origenConfeccion";

describe("interpretarCodigoLote", () => {
  it("un canónico AAMMDDNN se respeta tal cual (aunque la lectura de palet también fuera plausible)", () => {
    expect(interpretarCodigoLote("26071002")).toEqual({ codigo: "26071002", eraFormatoPalet: false });
    expect(interpretarCodigoLote("25102401")).toEqual({ codigo: "25102401", eraFormatoPalet: false });
  });

  it("el formato del programa de palets NN+AAMMDD se voltea al canónico (caso real Mercadona jul-2026)", () => {
    // "02260710" leído directo sería mes 26 (imposible); leído como palet es
    // el lote 02 del 10/07/26 → canónico 26071002.
    expect(interpretarCodigoLote("02260710")).toEqual({ codigo: "26071002", eraFormatoPalet: true });
    expect(interpretarCodigoLote("09260608")).toEqual({ codigo: "26060809", eraFormatoPalet: true });
    // NN alto real del archivo de palets (va de 00 a 41).
    expect(interpretarCodigoLote("41251024")).toEqual({ codigo: "25102441", eraFormatoPalet: true });
  });

  it("extrae los 8 dígitos aunque vengan con texto alrededor (misma laxitud que normalizarLoteCodigo)", () => {
    expect(interpretarCodigoLote("lote 26042712 + 7 BOX DE RECICLAJE")).toEqual({ codigo: "26042712", eraFormatoPalet: false });
    expect(interpretarCodigoLote("palet 02260710 malla")).toEqual({ codigo: "26071002", eraFormatoPalet: true });
  });

  it("sin 8 dígitos no hay código; 8 dígitos sin lectura de fecha posible se devuelven tal cual", () => {
    expect(interpretarCodigoLote("PREC DIA")).toEqual({ codigo: null, eraFormatoPalet: false });
    expect(interpretarCodigoLote(null)).toEqual({ codigo: null, eraFormatoPalet: false });
    // Ni "999999" ni "999999" del volteo son fechas: se devuelve crudo.
    expect(interpretarCodigoLote("99999999")).toEqual({ codigo: "99999999", eraFormatoPalet: false });
  });
});

describe("fechaDeCodigoLote / numeroDeCodigoLote", () => {
  it("descompone el canónico en fecha ISO y nº de lote del día", () => {
    expect(fechaDeCodigoLote("26071002")).toBe("2026-07-10");
    expect(numeroDeCodigoLote("26071002")).toBe(2);
    expect(numeroDeCodigoLote("26060809")).toBe(9);
  });

  it("null si no es un canónico con fecha plausible", () => {
    expect(fechaDeCodigoLote("02260710")).toBeNull(); // formato palet sin voltear
    expect(fechaDeCodigoLote("999")).toBeNull();
    expect(fechaDeCodigoLote(null)).toBeNull();
    expect(numeroDeCodigoLote("999")).toBeNull();
  });
});

describe("evaluarCoherenciaExpedicion", () => {
  const base = { entradaExiste: true, entradaEsPrecalibrado: false, kgEntrada: 20000, kgExpedido: 5000 };

  it("null si el cruce es posible (expedición menor que la entrada, entrada de campo)", () => {
    expect(evaluarCoherenciaExpedicion(base)).toBeNull();
  });

  it("null sin palets de venta: no hay cruce que validar", () => {
    expect(evaluarCoherenciaExpedicion({ ...base, entradaExiste: false, kgExpedido: 0 })).toBeNull();
  });

  it("sin_entrada — palet 09260608 → 26060809 no existe como entrada", () => {
    expect(evaluarCoherenciaExpedicion({ ...base, entradaExiste: false })).toBe("sin_entrada");
  });

  it("entrada_precalibrado — palet 02260710 → 26071002 es la re-entrada interna de PREC 2", () => {
    expect(evaluarCoherenciaExpedicion({ ...base, entradaEsPrecalibrado: true, kgEntrada: 1382, kgExpedido: 5184 }))
      .toBe("entrada_precalibrado");
  });

  it("kg_superan_entrada — palet 06260608 → 26060806 (Valdelimones 5.970 kg) con 6.924 kg expedidos", () => {
    expect(evaluarCoherenciaExpedicion({ ...base, kgEntrada: 5970, kgExpedido: 6924 })).toBe("kg_superan_entrada");
  });
});

describe("ordenarVolcadosCandidatos", () => {
  const volcado = (over: Partial<VolcadoDelDiaInput>): VolcadoDelDiaInput => ({
    lote_codigo: "26042712",
    productor: "INVERMARMELO",
    producto: "VALENCIA DELTA",
    kg: 1000,
    hora_inicio: null,
    created_at: null,
    esPrecalibrado: false,
    ...over,
  });

  it("ordena por hora_inicio y numera 1..N (día real 10/07/26) — sin marcar ninguno como 'el del palet': el NN del código es orden de ENTRADA en báscula, no de volcado", () => {
    const candidatos = ordenarVolcadosCandidatos([
      volcado({ lote_codigo: "26042810", hora_inicio: "08:44:00" }),
      volcado({ lote_codigo: "26052704", productor: "LAS MARIAS", hora_inicio: "05:49:00" }),
      volcado({ lote_codigo: "26042712 + 7 BOX DE RECICLAJE", hora_inicio: "06:24:00" }),
      volcado({ lote_codigo: "26042914", hora_inicio: "11:13:00" }),
    ]);
    expect(candidatos.map((c) => c.codigo)).toEqual(["26052704", "26042712", "26042810", "26042914"]);
    expect(candidatos.map((c) => c.numero)).toEqual([1, 2, 3, 4]);
  });

  it("sin hora van al final conservando el orden de llegada (histórico sin hora guardada)", () => {
    const candidatos = ordenarVolcadosCandidatos([
      volcado({ lote_codigo: "26060801", created_at: "2026-07-16T10:00:00Z" }),
      volcado({ lote_codigo: "26060802", hora_inicio: "07:00:00" }),
      volcado({ lote_codigo: "26060803", created_at: "2026-07-16T09:00:00Z" }),
    ]);
    expect(candidatos.map((c) => c.codigo)).toEqual(["26060802", "26060803", "26060801"]);
  });
});
