import { describe, expect, it } from "vitest";
import {
  convertirLotePaletACanonico,
  normalizarPaletIdParaCasar,
  parseInformePaletsRows,
  resumirInformePalets,
} from "./historicoPalets";

// Cabecera real del export "palets 1sep 14 jul.xlsx" (hoja "Sheet 1", fila 0).
const HEADER = [
  "TipoPalet", "NºPalet", "Fecha", "Denominación Producto", "Lote", "DcmtoVta",
  "Fecha", "Cliente", "Cajas", "TipoCaja", "Netos", "Fact.", "Sit",
];

// Filas reales del archivo (verificadas con node + xlsx).
const FILA_FICTICIO = [
  "PALET FICTICIO", 356900, "24/10/2025", "NAR NAVELINA CITRICA", "01251024",
  "", "", "", 1, "BOX PLASTICO 35 KG 1200X1000X780", 103, 0, "",
];
// Fecha de confección (24/10) distinta de la fecha de venta (25/10): fija que
// se mapea la PRIMERA "Fecha", no la segunda.
const FILA_CON_CLIENTE = [
  "PALET FRUTERO BLANCO 100X120", 356904, "24/10/2025", "NAR NAVELINA CAL4", "01251024",
  "Alb.C 15830", "25/10/2025", "MORA FRERES S.A.", 96, "CAJA MADERA 10 KG 500X300X150 LASARTE PREMIUM", 1046, 1046, "F",
];
const FILA_SIN_LOTE = ["", 374605, "27/02/2026", "", "", "", "", "", 0, "", 0, 0, "S"];

describe("parseInformePaletsRows", () => {
  it("mapea la fecha de CONFECCIÓN (primera 'Fecha'), no la de venta (segunda 'Fecha')", () => {
    const { filas } = parseInformePaletsRows([HEADER, FILA_CON_CLIENTE]);
    expect(filas).toHaveLength(1);
    expect(filas[0].fecha).toBe("2025-10-24");
  });

  it("parsea un palet con cliente y lote", () => {
    const { filas, descartadas } = parseInformePaletsRows([HEADER, FILA_CON_CLIENTE]);
    expect(descartadas).toHaveLength(0);
    const f = filas[0];
    expect(f.palet_id).toBe("356904");
    expect(f.producto).toBe("NAR NAVELINA CAL4");
    expect(f.lote_codigo_crudo).toBe("01251024");
    expect(f.lote_codigo).toBe("25102401");
    expect(f.cliente).toBe("MORA FRERES S.A.");
    expect(f.n_cajas).toBe(96);
    expect(f.kg_neto).toBe(1046);
    expect(f.situacion).toBe("F");
  });

  it("parsea un palet ficticio sin cliente ni situación (cadenas vacías -> null)", () => {
    const { filas } = parseInformePaletsRows([HEADER, FILA_FICTICIO]);
    expect(filas[0].cliente).toBeNull();
    expect(filas[0].situacion).toBeNull();
    expect(filas[0].kg_neto).toBe(103);
  });

  it("importa igual las filas sin lote (lote_codigo_crudo vacío -> lote_codigo null, no se descarta)", () => {
    const { filas, descartadas } = parseInformePaletsRows([HEADER, FILA_SIN_LOTE]);
    expect(descartadas).toHaveLength(0);
    expect(filas[0].lote_codigo_crudo).toBeNull();
    expect(filas[0].lote_codigo).toBeNull();
    expect(filas[0].kg_neto).toBe(0); // kg 0 es válido, no se descarta
    expect(filas[0].n_cajas).toBe(0);
  });

  it("descarta filas sin nº de palet", () => {
    const fila = [...FILA_CON_CLIENTE]; fila[1] = "";
    const { filas, descartadas } = parseInformePaletsRows([HEADER, fila]);
    expect(filas).toHaveLength(0);
    expect(descartadas).toHaveLength(1);
    expect(descartadas[0].motivo).toBe("Sin nº de palet");
  });

  it("descarta filas sin fecha de confección", () => {
    const fila = [...FILA_CON_CLIENTE]; fila[2] = "";
    const { descartadas } = parseInformePaletsRows([HEADER, fila]);
    expect(descartadas[0].motivo).toBe("Sin fecha de confección");
  });

  it("descarta filas sin kg netos (celda no numérica)", () => {
    const fila = [...FILA_CON_CLIENTE]; fila[10] = "";
    const { descartadas } = parseInformePaletsRows([HEADER, fila]);
    expect(descartadas[0].motivo).toBe("Sin kg netos");
  });

  it("no reconoce la cabecera si faltan las columnas clave", () => {
    const { filas, descartadas } = parseInformePaletsRows([["A", "B"], [1, 2]]);
    expect(filas).toHaveLength(0);
    expect(descartadas[0].motivo).toMatch(/cabecera/i);
  });
});

describe("convertirLotePaletACanonico", () => {
  it("convierte NN+AAMMDD a AAMMDD+NN", () => {
    expect(convertirLotePaletACanonico("01251024")).toBe("25102401");
    expect(convertirLotePaletACanonico("03260714")).toBe("26071403");
  });

  it("devuelve null para vacío/nulo", () => {
    expect(convertirLotePaletACanonico("")).toBeNull();
    expect(convertirLotePaletACanonico(null)).toBeNull();
    expect(convertirLotePaletACanonico(undefined)).toBeNull();
    expect(convertirLotePaletACanonico("   ")).toBeNull();
  });

  it("devuelve null si no son exactamente 8 dígitos o hay texto no numérico", () => {
    expect(convertirLotePaletACanonico("2510241")).toBeNull(); // 7 dígitos
    expect(convertirLotePaletACanonico("012510244")).toBeNull(); // 9 dígitos
    expect(convertirLotePaletACanonico("0125102X")).toBeNull(); // no numérico
    expect(convertirLotePaletACanonico("2510-24")).toBeNull(); // separador
  });
});

describe("normalizarPaletIdParaCasar", () => {
  it("quita ceros a la izquierda", () => {
    expect(normalizarPaletIdParaCasar("00356900")).toBe("356900");
    expect(normalizarPaletIdParaCasar("356900")).toBe("356900");
  });

  it("no rompe con vacío", () => {
    expect(normalizarPaletIdParaCasar("")).toBe("");
    expect(normalizarPaletIdParaCasar(null)).toBe("");
  });
});

describe("resumirInformePalets", () => {
  it("agrega kg, palets únicos, clientes distintos, con/sin lote y rango de fechas", () => {
    const resultado = parseInformePaletsRows([HEADER, FILA_FICTICIO, FILA_CON_CLIENTE, FILA_SIN_LOTE]);
    const resumen = resumirInformePalets(resultado);
    expect(resumen.filasValidas).toBe(3);
    expect(resumen.filasDescartadas).toBe(0);
    expect(resumen.paletsUnicos).toBe(3);
    expect(resumen.clientesDistintos).toBe(1);
    expect(resumen.kgNetoTotal).toBe(103 + 1046 + 0);
    expect(resumen.paletsConLote).toBe(2);
    expect(resumen.paletsSinLote).toBe(1);
    expect(resumen.fechaDesde).toBe("2025-10-24");
    expect(resumen.fechaHasta).toBe("2026-02-27");
  });

  it("cuenta las filas descartadas por motivo", () => {
    const filaSinPalet = [...FILA_CON_CLIENTE]; filaSinPalet[1] = "";
    const resultado = parseInformePaletsRows([HEADER, filaSinPalet]);
    const resumen = resumirInformePalets(resultado);
    expect(resumen.descartadasPorMotivo["Sin nº de palet"]).toBe(1);
  });
});
