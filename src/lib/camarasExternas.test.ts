import { describe, expect, it } from "vitest";
import {
  agregarCamaraExterna,
  codigosEnCamaraExterna,
  estadoCamionExterno,
  parseRegistroCamaraExternaRows,
  type CamionCamaraExterna,
  type SenalesRecepcion,
} from "./camarasExternas";
import { TASA_MERMA_NATURAL_DIA } from "./mermaLote";

const HEADER_GUADEX = [
  "Fecha", "S/Ref", "Proveedor", "Finca", "Variedad", "Envases", "Kg.", "Nt/Ref",
  "Entrada1", "Entrada2", "Envases1", "Envases2", "Tte. A lst", "Tte. A Guadex",
];
const HEADER_ZAMEX = [
  "Fecha", "S/Ref", "Proveedor", "Finca", "Variedad", "Envases", "Kg.", "Nt/Ref",
  "Entrada1", "Entrada2", "Envases1", "Envases2", "Tte. A lst", "Tte. a Zamexfruit",
];

describe("parseRegistroCamaraExternaRows", () => {
  it("parsea el formato real del Registro de Guadex y detecta la procedencia de la cabecera", () => {
    const { registros, procedencia, descartadas } = parseRegistroCamaraExternaRows([
      HEADER_GUADEX,
      // Fila real: S26/100224 aún en cámara (sin Entrada1)
      [new Date(2026, 4, 13), "S26/100224", "Invermarmelo", "Invermarmelo 3", "Valencia", 104, 20320, 26051307, null, null, null, null, null, "Guadex"],
      // Fila real: recibida en dos viajes con "No aplica" en Entrada2
      [new Date(2026, 1, 23), "S26/100004", "J.M. Herrero", "Torre Judío", "Barnfield", 72, 25620, 26022309, new Date(2026, 2, 30), "No aplica", 72, null, "Galvez", null],
    ]);
    expect(descartadas).toHaveLength(0);
    expect(procedencia).toBe("GUADEX");
    expect(registros[0]).toMatchObject({
      procedencia: "GUADEX",
      s_ref: "S26/100224",
      lote: "26051307",
      fecha_almacenamiento: "2026-05-13",
      kg: 20320,
      entrada_lst_1: null,
      venta_directa: null,
    });
    expect(registros[1]).toMatchObject({ s_ref: "S26/100004", entrada_lst_1: "2026-03-30", entrada_lst_2: null, envases_1: 72 });
  });

  it("caso real Zamexfruit: 'Venta directa 15/05' en Entrada1 no es fecha, es venta directa", () => {
    const { registros, procedencia } = parseRegistroCamaraExternaRows([
      HEADER_ZAMEX,
      [new Date(2026, 4, 14), "Z-CAMION 3", "Camba", "La Torrecilla", "Valencia", 104, 21620, 26051411, "Venta directa 15/05", null, 104, null, null, "Galvez"],
    ]);
    expect(procedencia).toBe("ZAMEXFRUIT");
    expect(registros[0].venta_directa).toBe("Venta directa 15/05");
    expect(registros[0].entrada_lst_1).toBeNull();
  });

  it("la fila TOTAL (solo kg, sin fecha ni ref) se ignora sin descartarse como error", () => {
    const { registros, descartadas } = parseRegistroCamaraExternaRows([
      HEADER_GUADEX,
      [new Date(2026, 4, 13), "S26/100224", "Invermarmelo", "Invermarmelo 3", "Valencia", 104, 20320, 26051307, null, null, null, null, null, "Guadex"],
      [null, null, null, null, null, null, 503270, null, null, null, null, null, null, null],
    ]);
    expect(registros).toHaveLength(1);
    expect(descartadas).toHaveLength(0);
  });

  it("errata real '06/04/206' en Entrada1: no es fecha ni venta → queda como nota, no rompe la fila", () => {
    const { registros } = parseRegistroCamaraExternaRows([
      HEADER_GUADEX,
      [new Date(2026, 1, 24), "S26/100007", "J.M. Herrero", "Torre Judío", "Barnfield", 30, 10700, 26022408, "06/04/206", "No aplica", 30, null, "Galvez", null],
    ]);
    expect(registros[0].entrada_lst_1).toBeNull();
    expect(registros[0].nota_entrada).toBe("06/04/206");
    expect(registros[0].venta_directa).toBeNull();
  });
});

describe("estadoCamionExterno — el estado se DERIVA, nunca se guarda", () => {
  const base: CamionCamaraExterna = {
    procedencia: "GUADEX",
    s_ref: "S26/100224",
    lote: "26051307",
    fecha_almacenamiento: "2026-05-13",
    proveedor: "Invermarmelo",
    finca: "Invermarmelo 3",
    variedad: "Valencia",
    envases: 104,
    kg: 20320,
    entrada_lst_1: null,
    entrada_lst_2: null,
    envases_1: null,
    envases_2: null,
    venta_directa: null,
    nota_entrada: null,
    transporte_lst: null,
  };
  const sinSenales: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set() };

  it("sin ninguna señal → EN CÁMARA con días y merma esperada (kg × tasa × días)", () => {
    const estado = estadoCamionExterno(base, sinSenales, "2026-07-27");
    expect(estado).toMatchObject({ estado: "en_camara", dias: 75 });
    if (estado.estado === "en_camara") {
      expect(estado.mermaEsperadaKg).toBeCloseTo(20320 * TASA_MERMA_NATURAL_DIA * 75, 6);
    }
  });

  it("fecha_salida_camara del Excel de mermas manda sobre todo lo demás", () => {
    const senales: SenalesRecepcion = { salidaPorLote: new Map([["26051307", "2026-07-21"]]), lotesProcesados: new Set(["26051307"]) };
    expect(estadoCamionExterno(base, senales, "2026-07-27")).toEqual({ estado: "recibido", fuente: "salida_camara", fecha: "2026-07-21" });
  });

  it("con pasadas de calibrador (partes diarios) → recibido aunque el registro no traiga Entrada1", () => {
    const senales: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set(["26051307"]) };
    expect(estadoCamionExterno(base, senales, "2026-07-27")).toEqual({ estado: "recibido", fuente: "procesado", fecha: null });
  });

  it("Entrada1 del propio registro también cuenta como recibido", () => {
    const camion = { ...base, entrada_lst_1: "2026-07-21" };
    expect(estadoCamionExterno(camion, sinSenales, "2026-07-27")).toEqual({ estado: "recibido", fuente: "registro", fecha: "2026-07-21" });
  });

  it("caso real S26/100223: llegada parcial (6 de 72 envases) → 'parcial' con el kg restante prorrateado, aunque tenga pasadas", () => {
    const camion = {
      ...base,
      s_ref: "S26/100223",
      lote: "26051306",
      kg: 23140,
      envases: 72,
      entrada_lst_1: "2026-06-26",
      envases_1: 6,
    };
    const senales: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set(["26051306"]) };
    const estado = estadoCamionExterno(camion, senales, "2026-07-27");
    expect(estado.estado).toBe("parcial");
    if (estado.estado === "parcial") {
      expect(estado.envasesRecibidos).toBe(6);
      expect(estado.envasesTotal).toBe(72);
      expect(estado.kgRestante).toBeCloseTo(23140 * (66 / 72), 3);
    }
  });

  it("llegada parcial + salida MEDIDA del Excel de mermas → recibido (el camión completo se re-pesó al salir)", () => {
    const camion = { ...base, envases: 72, entrada_lst_1: "2026-06-26", envases_1: 6 };
    const senales: SenalesRecepcion = { salidaPorLote: new Map([["26051307", "2026-07-21"]]), lotesProcesados: new Set() };
    expect(estadoCamionExterno(camion, senales, "2026-07-27").estado).toBe("recibido");
  });

  it("envases_1 = envases (todo llegó) NO es parcial: recibido según registro", () => {
    const camion = { ...base, envases: 104, entrada_lst_1: "2026-07-21", envases_1: 104 };
    expect(estadoCamionExterno(camion, sinSenales, "2026-07-27").estado).toBe("recibido");
  });

  it("venta directa manda sobre cualquier otra señal", () => {
    const camion = { ...base, venta_directa: "Venta directa 15/05" };
    const senales: SenalesRecepcion = { salidaPorLote: new Map([["26051307", "2026-07-21"]]), lotesProcesados: new Set(["26051307"]) };
    expect(estadoCamionExterno(camion, senales, "2026-07-27")).toEqual({ estado: "venta_directa", detalle: "Venta directa 15/05" });
  });
});

describe("agregarCamaraExterna", () => {
  const camion = (over: Partial<CamionCamaraExterna>): CamionCamaraExterna => ({
    procedencia: "GUADEX",
    s_ref: "S26/1",
    lote: null,
    fecha_almacenamiento: "2026-05-13",
    proveedor: null,
    finca: null,
    variedad: null,
    envases: null,
    kg: 20000,
    entrada_lst_1: null,
    entrada_lst_2: null,
    envases_1: null,
    envases_2: null,
    venta_directa: null,
    nota_entrada: null,
    transporte_lst: null,
    ...over,
  });
  const sinSenales: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set() };

  it("separa en cámara / recibidos / ventas directas y agrega kg y merma esperada por procedencia", () => {
    const agregado = agregarCamaraExterna(
      [
        camion({ s_ref: "S26/1", kg: 20000 }),
        camion({ s_ref: "S26/2", kg: 10000, procedencia: "ZAMEXFRUIT" }),
        camion({ s_ref: "S26/3", entrada_lst_1: "2026-07-01" }),
        camion({ s_ref: "S26/4", venta_directa: "Venta directa 15/05" }),
      ],
      sinSenales,
      "2026-07-27",
    );
    expect(agregado.enCamara).toHaveLength(2);
    expect(agregado.kgEnCamara).toBe(30000);
    expect(agregado.recibidos).toBe(1);
    expect(agregado.ventasDirectas).toHaveLength(1);
    expect(agregado.porProcedencia.map((p) => p.procedencia)).toEqual(["GUADEX", "ZAMEXFRUIT"]);
    expect(agregado.mermaEsperadaKg).toBeCloseTo(30000 * TASA_MERMA_NATURAL_DIA * 75, 6);
    expect(agregado.diasMediosPonderados).toBe(75);
  });

  it("los camiones en cámara salen ordenados del más antiguo al más nuevo", () => {
    const agregado = agregarCamaraExterna(
      [camion({ s_ref: "B", fecha_almacenamiento: "2026-05-20" }), camion({ s_ref: "A", fecha_almacenamiento: "2026-04-24" })],
      sinSenales,
      "2026-07-27",
    );
    expect(agregado.enCamara.map((c) => c.camion.s_ref)).toEqual(["A", "B"]);
  });
});

describe("codigosEnCamaraExterna — ground truth del dueño 04-08-2026 (nº2, PRIORIDAD MÁXIMA): 'físicamente imposible que haya pasado por el calibrador'", () => {
  const camion = (over: Partial<CamionCamaraExterna>): CamionCamaraExterna => ({
    procedencia: "GUADEX",
    s_ref: "S26/1",
    lote: null,
    fecha_almacenamiento: "2026-05-08",
    proveedor: "Invermarmelo",
    finca: "Invermarmelo",
    variedad: "Valencia",
    envases: 104,
    kg: 20000,
    entrada_lst_1: null,
    entrada_lst_2: null,
    envases_1: null,
    envases_2: null,
    venta_directa: null,
    nota_entrada: null,
    transporte_lst: null,
    ...over,
  });
  const sinSenales: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set() };

  it("los 4 casos de control reales del dueño (Invermarmelo/Guadex) salen en el Set cuando no hay ninguna señal de recepción", () => {
    const codigosGuadex = ["26050809", "26051106", "26052207", "26052506"];
    const camiones = codigosGuadex.map((lote, i) => camion({ s_ref: `S26/10020${i}`, lote }));
    const set = codigosEnCamaraExterna(camiones, sinSenales, "2026-08-04");
    for (const lote of codigosGuadex) expect(set.has(lote)).toBe(true);
    expect(set.size).toBe(4);
  });

  it("con fecha_salida_camara (Excel de mermas) o pasadas de calibrador, el lote SALE del Set (ya no está en cámara)", () => {
    const camiones = [camion({ lote: "26050809" }), camion({ s_ref: "S26/2", lote: "26051106" })];
    const senales: SenalesRecepcion = {
      salidaPorLote: new Map([["26050809", "2026-07-01"]]),
      lotesProcesados: new Set(["26051106"]),
    };
    const set = codigosEnCamaraExterna(camiones, senales, "2026-08-04");
    expect(set.size).toBe(0);
  });

  it("venta directa o entrada_lst_1/2 registrados también sacan al lote del Set", () => {
    const camiones = [
      camion({ lote: "26050809", venta_directa: "Venta directa 15/05" }),
      camion({ s_ref: "S26/2", lote: "26051106", entrada_lst_1: "2026-07-01" }),
    ];
    const set = codigosEnCamaraExterna(camiones, sinSenales, "2026-08-04");
    expect(set.size).toBe(0);
  });

  it("llegada PARCIAL (entrada_lst_1 con envases parciales) no cuenta como 'en_camara' a efectos de este Set (ya tiene indicación de recepción)", () => {
    const camiones = [camion({ lote: "26050809", envases: 72, entrada_lst_1: "2026-06-26", envases_1: 6 })];
    const set = codigosEnCamaraExterna(camiones, sinSenales, "2026-08-04");
    expect(set.has("26050809")).toBe(false);
  });

  it("sin lote reconocible (null) no se añade nada al Set", () => {
    const set = codigosEnCamaraExterna([camion({ lote: null })], sinSenales, "2026-08-04");
    expect(set.size).toBe(0);
  });
});
