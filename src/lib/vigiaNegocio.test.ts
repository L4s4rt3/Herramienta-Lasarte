// Tests de la lib pura del vigía de negocio. El módulo vive en
// supabase/functions/_shared/vigiaNegocio.ts (lo importa la edge function
// vigia-negocio); aquí se prueba con vitest, patrón informeSemanal.
import { describe, expect, it } from "vitest";
import {
  conciliarHallazgos,
  costePuestoDesdeCamiones,
  diasEntre,
  fechaMenosDias,
  reglaAsistenciaParada,
  reglaCorreccionesErp,
  reglaCuadreSaf,
  reglaDineroParado,
  reglaFrutaParada,
  reglaMercadonaSinFacturar,
  reglaMermaFueraDeBanda,
  reglaDetalleCalibrador,
  reglaPartes,
  reglaRendimiento,
  reglaSinVender,
  reglaSobrellenadoMalla,
  renderCorreoVigia,
  tocaEnviarCorreoVigia,
  type Hallazgo,
  type HallazgoGuardadoRow,
  type MercadonaSemanaVigiaRow,
  type PaletVigiaRow,
  type SafCamionRow,
} from "@/lib/vigiaNegocio";
import type {
  LoteMermaSemana,
  MermaSemanaInforme,
  StockInforme,
} from "../../supabase/functions/_shared/informeSemanal.ts";

const HOY = "2026-08-31";

// El camión SAF 1 verificado el 28-08: Laadbon 1440 cajas × 13,50 + 3.200 de
// porte sobre 23.589 kg netos → 0,95977 €/kg puesto.
const CAMION_1: SafCamionRow = {
  lote: "26082701",
  fecha: "2026-08-27",
  cajas: 1440,
  eur_caja: 13.5,
  porte_eur: 3200,
  kg_neto_laadbon: 23589,
};

function paletMalla(fecha: string, extra?: Partial<PaletVigiaRow>): PaletVigiaRow {
  // Un palet de malla del día 1 real: 52 cajas a 12,478 kg/caja.
  return {
    fecha,
    articulo: "NAR VALENCIA MIDKNIGHT CAL4/5",
    cliente: "MERCADONA S.A.",
    num_cajas: 52,
    kg_netos: 648.9,
    num_albaran_venta: "18424",
    num_factura: null,
    fecha_venta: fecha,
    importe_venta: null,
    ...extra,
  };
}

describe("fechas", () => {
  it("diasEntre y fechaMenosDias son consistentes", () => {
    expect(diasEntre("2026-08-28", "2026-08-31")).toBe(3);
    expect(fechaMenosDias("2026-08-31", 3)).toBe("2026-08-28");
    expect(diasEntre(fechaMenosDias("2026-01-02", 5), "2026-01-02")).toBe(5);
  });
});

describe("costePuestoDesdeCamiones", () => {
  it("calcula el €/kg puesto del último Laadbon (camión 1: ~0,96)", () => {
    const coste = costePuestoDesdeCamiones([CAMION_1]);
    expect(coste).toBeCloseTo((1440 * 13.5 + 3200) / 23589, 5);
  });
  it("sin camiones con datos devuelve null", () => {
    expect(costePuestoDesdeCamiones([])).toBeNull();
    expect(costePuestoDesdeCamiones([{ ...CAMION_1, kg_neto_laadbon: null }])).toBeNull();
  });
});

describe("reglaSobrellenadoMalla", () => {
  it("detecta el sobrellenado del día 1 real (24 palets a 12,478 kg/caja)", () => {
    const palets = Array.from({ length: 24 }, () => paletMalla("2026-08-28"));
    const hallazgos = reglaSobrellenadoMalla(palets, ["2026-08-28"], 0.96);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].regla).toBe("sobrellenado-malla");
    expect(hallazgos[0].tipo).toBe("evento");
    // 24×648,9 − 24×52×12,24 = 297,6 kg regalados sobre lo exigido.
    expect(hallazgos[0].kg).toBeCloseTo(24 * 648.9 - 24 * 52 * 12.24, 1);
    expect(hallazgos[0].eur).toBeCloseTo((24 * 648.9 - 24 * 52 * 12.24) * 0.96, 1);
  });

  it("no avisa con la media en el objetivo (12,24-12,32)", () => {
    const palets = Array.from({ length: 24 }, () => paletMalla("2026-08-28", { kg_netos: 52 * 12.28 }));
    expect(reglaSobrellenadoMalla(palets, ["2026-08-28"], 0.96)).toHaveLength(0);
  });

  it("avisa de caja corta por debajo de 12,02", () => {
    const palets = Array.from({ length: 24 }, () => paletMalla("2026-08-28", { kg_netos: 52 * 11.9 }));
    const hallazgos = reglaSobrellenadoMalla(palets, ["2026-08-28"], null);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].regla).toBe("caja-corta");
  });

  it("ignora días con pocas cajas y palets que no son formato malla-12", () => {
    // 5 palets con kg provisional raro (9,47 kg/caja, como los del 31-08 a medias)
    // más un día de solo 1 palet: nada que evaluar.
    const raros = Array.from({ length: 5 }, () => paletMalla("2026-08-28", { num_cajas: 52, kg_netos: 492 }));
    expect(reglaSobrellenadoMalla(raros, ["2026-08-28"], null)).toHaveLength(0);
    expect(reglaSobrellenadoMalla([paletMalla("2026-08-28")], ["2026-08-28"], null)).toHaveLength(0);
  });
});

describe("reglaCuadreSaf", () => {
  const ENTRADA_1 = { lote: "26082701", fecha: "2026-08-27", kg_entrada: 23589, importe_compra: 21230.1 };

  it("detecta los 1.790 € de más del alta del camión 1 (caso real)", () => {
    const hallazgos = reglaCuadreSaf([CAMION_1], [ENTRADA_1], HOY);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].regla).toBe("saf-cuadre");
    expect(hallazgos[0].eur).toBeCloseTo(21230.1 - 1440 * 13.5, 1); // +1.790,10
    expect(hallazgos[0].titulo).toContain("MÁS");
  });

  it("con el alta cuadrada no dice nada", () => {
    const entrada = { ...ENTRADA_1, importe_compra: 1440 * 13.5 + 100 };
    expect(reglaCuadreSaf([CAMION_1], [entrada], HOY)).toHaveLength(0);
  });

  it("pide el Laadbon de una entrada SAF sin registrar (camión 2 real)", () => {
    const entrada2 = { lote: "26082901", fecha: "2026-08-29", kg_entrada: 22067, importe_compra: 19860.3 };
    const hallazgos = reglaCuadreSaf([], [entrada2], HOY);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].regla).toBe("saf-sin-laadbon");
    expect(hallazgos[0].tipo).toBe("estado");
  });

  it("respeta la gracia de 1 día antes de pedir el Laadbon", () => {
    const entradaHoy = { lote: "26083101", fecha: HOY, kg_entrada: 20000, importe_compra: 18000 };
    expect(reglaCuadreSaf([], [entradaHoy], HOY)).toHaveLength(0);
  });

  it("avisa de un Laadbon registrado sin entrada (lote mal tecleado)", () => {
    const hallazgos = reglaCuadreSaf([CAMION_1], [], HOY);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].regla).toBe("saf-sin-entrada");
  });
});

describe("reglaCorreccionesErp", () => {
  it("un estado por lote, con los campos listados y los euros del importe", () => {
    const filas = [
      { lote: "26081203", fecha: "2026-08-12", campo: "importe_compra", en_la_app: "1200", en_el_erp: "1450.5", detectada_en: "2026-08-25T05:10:00Z" },
      { lote: "26081203", fecha: "2026-08-12", campo: "tipo_envase", en_la_app: "BOX", en_el_erp: "PALOT", detectada_en: "2026-08-28T05:10:00Z" },
      { lote: "26082901", fecha: "2026-08-29", campo: "kg_entrada", en_la_app: "22067", en_el_erp: "24488", detectada_en: "2026-09-01T05:10:00Z" },
    ];
    const h = reglaCorreccionesErp(filas, "2026-09-03");
    expect(h).toHaveLength(2);
    expect(h[0].clave).toBe("correccion-erp|26081203");
    expect(h[0].tipo).toBe("estado");
    expect(h[0].severidad).toBe("aviso");
    expect(h[0].eur).toBeCloseTo(250.5);
    expect(h[0].titulo).toContain("2 campos");
    expect(h[0].titulo).toContain("desde hace 9 días");
    expect(h[0].detalle).toContain("importe_compra");
    expect(h[0].detalle).toContain("tipo_envase");
    expect(h[1].severidad).toBe("atencion");
    expect(h[1].kg).toBe(2421);
    expect(h[1].eur).toBeNull();
  });

  it("sin discrepancias no dice nada", () => {
    expect(reglaCorreccionesErp([], HOY)).toEqual([]);
  });

  it("una diferencia aceptada (importación por neto vs báscula) no se cuenta", () => {
    const filas = [
      { lote: "26082901", fecha: "2026-08-29", campo: "kg_entrada", en_la_app: "22067", en_el_erp: "24488", detectada_en: "2026-09-01T05:10:00Z", aceptada_en: "2026-09-02T10:00:00Z" },
      { lote: "26082901", fecha: "2026-08-29", campo: "importe_compra", en_la_app: "19860.3", en_el_erp: "22039.2", detectada_en: "2026-09-01T05:10:00Z", aceptada_en: null },
    ];
    const h = reglaCorreccionesErp(filas, HOY);
    expect(h).toHaveLength(1);
    expect(h[0].titulo).toContain("1 campo");
    expect(h[0].kg).toBeNull();
  });
});

describe("reglaDineroParado", () => {
  it("agrupa por cliente los palets vendidos >30 días sin factura, distinguiendo sin valorar", () => {
    const palets: PaletVigiaRow[] = [
      paletMalla("2026-07-01", { fecha_venta: "2026-07-01", importe_venta: 500, cliente: "MAPLAFE S.L." }),
      paletMalla("2026-07-10", { fecha_venta: "2026-07-10", importe_venta: 0, cliente: "MAPLAFE S.L." }),
      // reciente: fuera
      paletMalla("2026-08-20", { fecha_venta: "2026-08-20", importe_venta: 400, cliente: "MAPLAFE S.L." }),
      // con factura: fuera
      paletMalla("2026-07-01", { fecha_venta: "2026-07-01", num_factura: "A25/100", cliente: "MAPLAFE S.L." }),
    ];
    const hallazgos = reglaDineroParado(palets, HOY);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].clave).toBe("dinero-parado|MAPLAFE S.L.");
    expect(hallazgos[0].eur).toBe(500);
    expect(hallazgos[0].titulo).toContain("2 palet(s)");
    expect(hallazgos[0].titulo).toContain("1 sin valorar");
    expect(hallazgos[0].detalle).toContain("01-07-2026");
  });
});

describe("reglaSinVender", () => {
  it("suma los palets sin albarán de venta entre 14 y 60 días", () => {
    const palets: PaletVigiaRow[] = [
      ...Array.from({ length: 8 }, () => paletMalla("2026-08-10", { num_albaran_venta: null, fecha_venta: null })),
      // demasiado viejos (fuera de ventana) y demasiado recientes: fuera
      paletMalla("2026-05-01", { num_albaran_venta: null, fecha_venta: null }),
      paletMalla("2026-08-29", { num_albaran_venta: null, fecha_venta: null }),
    ];
    const hallazgos = reglaSinVender(palets, HOY);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].kg).toBeCloseTo(8 * 648.9, 1);
    expect(hallazgos[0].titulo).toContain("8 palet(s)");
  });

  it("por debajo del mínimo de kg no molesta", () => {
    const palets = [paletMalla("2026-08-10", { num_albaran_venta: null, fecha_venta: null })];
    expect(reglaSinVender(palets, HOY)).toHaveLength(0);
  });
});

describe("reglaFrutaParada", () => {
  const stock: StockInforme = {
    kgEnCamara: 40000,
    kgEnCamaraFirme: 30000,
    kgProbablementeTerminados: 10000,
    lotesProbablementeTerminados: 2,
    lotesPendientes: 3,
    lotesParciales: 2,
    antiguedadMaxDias: 20,
  };
  it("avisa con fruta vieja y volumen", () => {
    const hallazgos = reglaFrutaParada(stock);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].kg).toBe(40000);
    expect(hallazgos[0].titulo).toContain("20 días");
  });
  it("calla con la cámara fresca o vacía", () => {
    expect(reglaFrutaParada({ ...stock, antiguedadMaxDias: 5 })).toHaveLength(0);
    expect(reglaFrutaParada({ ...stock, kgEnCamara: 2000 })).toHaveLength(0);
    expect(reglaFrutaParada(null)).toHaveLength(0);
  });
});

describe("reglaMermaFueraDeBanda", () => {
  const base: MermaSemanaInforme = {
    nLotes: 2,
    kgEntrada: 50000,
    kgMerma: 3000,
    pctMerma: 6,
    nConDatoARevisar: 0,
    lotes: [
      { lote: "26081001", agricultor: "PACO", finca: "F1", kgEntrada: 30000, mermaNaturalKg: 2400, pctMerma: 8, diasEnCamara: 12, calibradorSuperaEntrada: false },
      { lote: "26081002", agricultor: "PEPE", finca: "F2", kgEntrada: 20000, mermaNaturalKg: 600, pctMerma: 3, diasEnCamara: 4, calibradorSuperaEntrada: false },
    ],
  };
  it("avisa solo del lote fuera de banda (>5 %)", () => {
    const hallazgos = reglaMermaFueraDeBanda(base);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].clave).toBe("merma-lote|26081001");
    expect(hallazgos[0].titulo).toContain("8,0 %");
  });
  it("el ⚠ calibrador>báscula no cuenta como merma", () => {
    const conAviso = { ...base, lotes: base.lotes.map((l: LoteMermaSemana) => ({ ...l, calibradorSuperaEntrada: true })) };
    expect(reglaMermaFueraDeBanda(conAviso)).toHaveLength(0);
    expect(reglaMermaFueraDeBanda(null)).toHaveLength(0);
  });
});

describe("reglaPartes", () => {
  it("descuadre = evento, borrador estancado = estado", () => {
    const hallazgos = reglaPartes([
      { date: "2026-08-27", estado: "Con descuadre", campos_estimados: null },
      { date: "2026-08-26", estado: "Borrador", campos_estimados: null },
      { date: "2026-08-30", estado: "Borrador", campos_estimados: null }, // reciente: aún no
    ], HOY);
    const reglas = hallazgos.map((h) => h.regla).sort();
    expect(reglas).toContain("parte-descuadre");
    expect(reglas).toContain("parte-borrador");
    expect(hallazgos.filter((h) => h.regla === "parte-borrador")).toHaveLength(1);
  });

  it("agrega el papel sin meter pasada la gracia y los analizados sin validar", () => {
    const estimado = {
      campos: { kg_podrido_bolsa_basura: { valor: 387, metodo: "mediana-14d" } },
      estimado_at: "2026-08-24T05:11:00Z",
      gracia_dias: 2,
    };
    const hallazgos = reglaPartes([
      { date: "2026-08-22", estado: "Analizado", campos_estimados: estimado },
      { date: "2026-08-24", estado: "Analizado", campos_estimados: estimado },
      // dentro de gracia+margen: no cuenta como papel perdido
      { date: "2026-08-29", estado: "Analizado", campos_estimados: estimado },
    ], HOY);
    const papel = hallazgos.find((h) => h.regla === "papel-sin-meter");
    expect(papel).toBeDefined();
    expect(papel!.titulo).toContain("2 parte(s)");
    expect(papel!.detalle).toContain("22-08-2026");
    const sinValidar = hallazgos.find((h) => h.regla === "partes-sin-validar");
    expect(sinValidar).toBeDefined();
    expect(sinValidar!.titulo).toContain("2 parte(s)");
  });
});

describe("reglaRendimiento", () => {
  it("aplica el estándar por régimen con corte en 35 presentes", () => {
    const hallazgos = reglaRendimiento([
      // plantilla completa: 40 presentes a 1.500 kg/p → rojo (<1.700)
      { fecha: "2026-08-25", kg: 60000, presentes: 40 },
      // plantilla completa: 40 presentes a 2.200 kg/p → bien
      { fecha: "2026-08-26", kg: 88000, presentes: 40 },
      // media plantilla: 20 presentes a 2.000 kg/p → rojo (<2.200)
      { fecha: "2026-08-27", kg: 40000, presentes: 20 },
      // media plantilla: 20 presentes a 2.800 kg/p → bien
      { fecha: "2026-08-28", kg: 56000, presentes: 20 },
      // sin kg o sin asistencia: no se evalúa
      { fecha: "2026-08-29", kg: 0, presentes: 20 },
      { fecha: "2026-08-30", kg: 30000, presentes: 0 },
    ]);
    expect(hallazgos.map((h) => h.clave)).toEqual([
      "rendimiento-rojo|2026-08-25",
      "rendimiento-rojo|2026-08-27",
    ]);
    expect(hallazgos[0].titulo).toContain("plantilla completa");
    expect(hallazgos[1].titulo).toContain("media plantilla");
  });
});

describe("reglaDetalleCalibrador", () => {
  it("separa ciegos, cortos y largos comparando con el parte", () => {
    const hallazgos = reglaDetalleCalibrador([
      // ciego: producción sin detalle en ninguna fuente
      { fecha: "2026-08-26", kgParte: 14536, kgDetalle: 0 },
      // corto: menos del 85 % (falta una pasada)
      { fecha: "2026-08-27", kgParte: 20000, kgDetalle: 12000 },
      // bien: dentro de banda
      { fecha: "2026-08-28", kgParte: 17147, kgDetalle: 17147 },
      // largo: más del 115 % (doble conteo)
      { fecha: "2026-08-29", kgParte: 10000, kgDetalle: 12500 },
      // restos por debajo del mínimo no molestan
      { fecha: "2026-08-30", kgParte: 300, kgDetalle: 0 },
    ]);
    const claves = hallazgos.map((h) => h.clave).sort();
    expect(claves).toEqual([
      "detalle-corto-calibrador|global",
      "detalle-largo-calibrador|global",
      "sin-detalle-calibrador|global",
    ]);
    const ciego = hallazgos.find((h) => h.regla === "sin-detalle-calibrador")!;
    expect(ciego.titulo).toContain("1 día(s)");
    expect(ciego.detalle).toContain("26-08-2026");
  });
  it("con el detalle al día no dice nada", () => {
    expect(reglaDetalleCalibrador([{ fecha: "2026-08-28", kgParte: 17147, kgDetalle: 17100 }])).toHaveLength(0);
  });
});

describe("reglaAsistenciaParada", () => {
  // Días de lunes a sábado entre dos fechas (la línea también trabaja sábados).
  function laborables(desde: string, hasta: string): string[] {
    const out: string[] = [];
    for (let i = diasEntre(desde, hasta); i >= 0; i--) {
      const f = fechaMenosDias(hasta, i);
      if (new Date(`${f}T00:00:00Z`).getUTCDay() !== 0) out.push(f);
    }
    return out;
  }

  it("caso real del 04-09-2026: el volcado se quedó el 04-08 y hay producción hasta el 03-09", () => {
    const produccion = laborables("2026-07-01", "2026-09-03");
    const hallazgos = reglaAsistenciaParada(produccion, "2026-08-04");
    expect(hallazgos).toHaveLength(1);
    const h = hallazgos[0];
    expect(h.regla).toBe("asistencia-parada");
    expect(h.clave).toBe("asistencia-parada|2026-08-04");
    expect(h.tipo).toBe("estado");
    expect(h.severidad).toBe("atencion");
    expect(h.titulo).toContain("desde el 04-08-2026");
    expect(h.titulo).toContain("hasta el 03-09-2026");
    expect(h.titulo).toContain("(30 días después)");
    // Solo cuentan los días de producción POSTERIORES a la última asistencia.
    const sinAsistencia = produccion.filter((f) => f > "2026-08-04");
    expect(h.titulo).toContain(`${sinAsistencia.length} días de trabajo`);
    expect(h.detalle).toContain("Por tipo de día");
    expect(h.detalle).toContain("Rentabilidad del día");
    expect(h.detalle).toContain("/importar");
  });

  it("la semana en curso vacía no es avería: al día con el volcado del lunes", () => {
    // El volcado del lunes 31-08 cubre hasta el sábado 29-08; la producción
    // sigue hasta el lunes 07-09 (9 días) sin que nadie haya vuelto a cargar.
    expect(reglaAsistenciaParada(laborables("2026-08-03", "2026-09-07"), "2026-08-29")).toHaveLength(0);
    // En el umbral (10 días) tampoco; al día siguiente, sí.
    expect(reglaAsistenciaParada(laborables("2026-08-03", "2026-09-08"), "2026-08-29")).toHaveLength(0);
    expect(reglaAsistenciaParada(laborables("2026-08-03", "2026-09-09"), "2026-08-29")).toHaveLength(1);
  });

  it("sin datos no hay falso positivo", () => {
    expect(reglaAsistenciaParada([], "2026-08-04")).toHaveLength(0);
    expect(reglaAsistenciaParada(laborables("2026-08-03", "2026-09-03"), null)).toHaveLength(0);
    // Producción solo ANTERIOR a la última asistencia (la línea parada): nada.
    expect(reglaAsistenciaParada(laborables("2026-07-01", "2026-08-01"), "2026-08-04")).toHaveLength(0);
  });
});

describe("reglaMercadonaSinFacturar", () => {
  // Una semana de la hoja: 4 métodos de 40 t a un €/kg dado (null = sin facturar).
  function semanaHoja(semana: number, eurKg: number | null, anio = 2026): MercadonaSemanaVigiaRow {
    return {
      anio,
      semana,
      metodos: ["MA3KGC", "MA4KGC", "MA5KGC", "MA12KGC"].map((metodo) => ({
        metodo, kilos: 40_000, base_iva: eurKg == null ? null : 40_000 * eurKg,
      })),
    };
  }
  const paletMdna = (fecha: string) => paletMalla(fecha, { cliente: "MERCADONA S.A.", kg_netos: 300 });

  it("caso real del 04-09-2026: la hoja se quedó en la 32 (a medio facturar) y se sigue vendiendo", () => {
    const semanas = [
      ...[21, 22, 23, 24, 25, 26].map((s) => semanaHoja(s, null)),
      semanaHoja(27, 0.38), semanaHoja(28, 0.47), semanaHoja(29, 0.46),
      semanaHoja(30, 1.02), semanaHoja(31, 1.02), semanaHoja(32, 0.43),
    ];
    const palets = [
      paletMdna("2026-08-10"), paletMdna("2026-08-20"), paletMdna("2026-09-02"),
      // dentro de la semana 32 (ya con base) y de otro cliente: no cuentan
      paletMdna("2026-08-09"),
      paletMalla("2026-08-25", { cliente: "MAPLAFE S.L." }),
    ];
    const hallazgos = reglaMercadonaSinFacturar(semanas, palets, "2026-09-04");
    expect(hallazgos).toHaveLength(1);
    const h = hallazgos[0];
    expect(h.regla).toBe("mercadona-sin-facturar");
    expect(h.clave).toBe("mercadona-sin-facturar|2026-W32");
    expect(h.tipo).toBe("estado");
    expect(h.titulo).toContain("semana 32 de 2026");
    expect(h.titulo).toContain("faltan 3 semanas cerradas (33, 34 y 35 de 2026)");
    expect(h.titulo).toContain("ya va la 36");
    expect(h.titulo).toContain("3 palets (900 kg)");
    expect(h.kg).toBe(900);
    expect(h.detalle).toContain("0,43 €/kg");
    expect(h.detalle).toContain("≥0,80 €/kg");
    expect(h.detalle).toContain("Rentabilidad");
    expect(h.detalle).toContain("/importar");
  });

  it("al día (la hoja de la semana pasada cargada) o con dos semanas de margen: nada; a la tercera avisa", () => {
    const palets = [paletMdna("2026-08-31"), paletMdna("2026-09-02")];
    expect(reglaMercadonaSinFacturar([semanaHoja(34, 1.02), semanaHoja(35, 1.02)], palets, "2026-09-04")).toHaveLength(0);
    expect(reglaMercadonaSinFacturar([semanaHoja(34, 1.02)], palets, "2026-09-04")).toHaveLength(0);
    const h = reglaMercadonaSinFacturar([semanaHoja(33, 1.02)], palets, "2026-09-04");
    expect(h).toHaveLength(1);
    expect(h[0].titulo).toContain("faltan 2 semanas cerradas (34 y 35 de 2026)");
    // una semana con tarifa real no lleva la coletilla de "a medio facturar"
    expect(h[0].detalle).not.toContain("a medio facturar");
  });

  it("sin datos no hay falso positivo", () => {
    const palets = [paletMdna("2026-09-02")];
    expect(reglaMercadonaSinFacturar([], palets, "2026-09-04")).toHaveLength(0);
    // semanas cargadas pero ninguna con base: sin referencia
    expect(reglaMercadonaSinFacturar([semanaHoja(21, null), semanaHoja(22, null)], palets, "2026-09-04")).toHaveLength(0);
    // sin venta a Mercadona desde la última semana con base (parada de campaña): no es una hoja olvidada
    const sinVenta = [paletMdna("2026-08-05"), paletMalla("2026-09-01", { cliente: "MAPLAFE S.L." })];
    expect(reglaMercadonaSinFacturar([semanaHoja(32, 1.02)], sinVenta, "2026-09-04")).toHaveLength(0);
  });

  it("cruza el año con la semana ISO de semanaIso.ts (2026 tiene 53 semanas)", () => {
    // Última hoja la 52/2026 (lunes 21-12); hoy miércoles 20-01-2027 = semana 3/2027.
    const h = reglaMercadonaSinFacturar([semanaHoja(52, 1.02)], [paletMdna("2027-01-15")], "2027-01-20");
    expect(h).toHaveLength(1);
    expect(h[0].clave).toBe("mercadona-sin-facturar|2026-W52");
    expect(h[0].titulo).toContain("faltan 3 semanas cerradas (53/2026, 1/2027 y 2/2027)");
    expect(h[0].titulo).toContain("ya va la 3 —");
  });
});

describe("conciliarHallazgos", () => {
  const evento: Hallazgo = {
    regla: "sobrellenado-malla", clave: "sobrellenado-malla|2026-08-28", tipo: "evento",
    severidad: "aviso", titulo: "Sobrellenado", detalle: null, eur: 285, kg: 297,
  };
  const estado: Hallazgo = {
    regla: "saf-sin-laadbon", clave: "saf-sin-laadbon|26082901", tipo: "estado",
    severidad: "atencion", titulo: "Camión sin Laadbon", detalle: null, eur: null, kg: 22067,
  };

  it("todo nuevo la primera vez", () => {
    const plan = conciliarHallazgos([evento, estado], []);
    expect(plan.nuevos).toHaveLength(2);
    expect(plan.pendientes).toHaveLength(0);
    expect(plan.resolverIds).toHaveLength(0);
  });

  it("un evento ya visto no se repite; un estado abierto pasa a pendiente", () => {
    const guardados: HallazgoGuardadoRow[] = [
      { id: "1", clave: evento.clave, tipo: "evento", titulo: evento.titulo, creado_at: "2026-08-29T12:00:00Z", resuelto_at: "2026-08-29T12:00:00Z" },
      { id: "2", clave: estado.clave, tipo: "estado", titulo: estado.titulo, creado_at: "2026-08-30T12:00:00Z", resuelto_at: null },
    ];
    const plan = conciliarHallazgos([evento, estado], guardados);
    expect(plan.nuevos).toHaveLength(0);
    expect(plan.pendientes).toHaveLength(1);
    expect(plan.pendientes[0].desde).toBe("2026-08-30");
  });

  it("un estado que desaparece se resuelve; si cambió el texto se refresca", () => {
    const guardados: HallazgoGuardadoRow[] = [
      { id: "2", clave: estado.clave, tipo: "estado", titulo: "Texto viejo", creado_at: "2026-08-30T12:00:00Z", resuelto_at: null },
      { id: "3", clave: "dinero-parado|X", tipo: "estado", titulo: "X debe", creado_at: "2026-08-20T12:00:00Z", resuelto_at: null },
    ];
    const plan = conciliarHallazgos([estado], guardados);
    expect(plan.actualizar).toHaveLength(1);
    expect(plan.actualizar[0].id).toBe("2");
    expect(plan.resolverIds).toEqual(["3"]);
  });

  it("un estado resuelto que reaparece vuelve como nuevo", () => {
    const guardados: HallazgoGuardadoRow[] = [
      { id: "2", clave: estado.clave, tipo: "estado", titulo: estado.titulo, creado_at: "2026-08-20T12:00:00Z", resuelto_at: "2026-08-25T12:00:00Z" },
    ];
    const plan = conciliarHallazgos([estado], guardados);
    expect(plan.nuevos).toHaveLength(1);
  });
});

describe("correo del vigía", () => {
  const nuevo: Hallazgo = {
    regla: "saf-cuadre", clave: "saf-cuadre|26082701", tipo: "estado", severidad: "aviso",
    titulo: "El alta del ERP del camión SAF 26082701 valora 1.790 € de MÁS que su Laadbon",
    detalle: "Cotejar con la factura de HG.", eur: 1790.1, kg: null,
  };

  it("sin nada nuevo entre semana, no se envía; el lunes con pendientes, sí", () => {
    const plan = { nuevos: [], pendientes: [{ hallazgo: nuevo, desde: "2026-08-29" }], resolverIds: [], actualizar: [] };
    expect(tocaEnviarCorreoVigia(plan, false)).toBe(false);
    expect(tocaEnviarCorreoVigia(plan, true)).toBe(true);
    expect(tocaEnviarCorreoVigia({ ...plan, nuevos: [nuevo] }, false)).toBe(true);
  });

  it("el correo lleva lo nuevo, lo pendiente y escapa el HTML", () => {
    const plan = {
      nuevos: [nuevo],
      pendientes: [{ hallazgo: { ...nuevo, clave: "x", titulo: "Camión <2> pendiente" }, desde: "2026-08-29" }],
      resolverIds: [],
      actualizar: [],
    };
    const correo = renderCorreoVigia(plan, HOY, false);
    expect(correo.asunto).toContain("1 hallazgo nuevo");
    expect(correo.texto).toContain("NUEVO HOY");
    expect(correo.texto).toContain("SIGUE PENDIENTE");
    expect(correo.texto).toContain("desde el 29-08-2026");
    expect(correo.html).toContain("&lt;2&gt;");
    expect(correo.html).not.toContain("Camión <2>");
  });
});
