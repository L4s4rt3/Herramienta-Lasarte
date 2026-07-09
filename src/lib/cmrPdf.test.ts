import { describe, expect, it } from "vitest";
import {
  buildCmrFieldValues,
  cmrPdfFilename,
  generarHojaRutaPdf,
  hojaRutaPdfFilename,
  LASARTE_REMITENTE_DEFECTO,
  ORIGEN_DEFECTO,
  pdfToBytes,
} from "./cmrPdf";

// generarCmrPdf() hace fetch('/plantillas/plantilla-cmr.pdf') + PDFDocument.load,
// que requiere el asset servido por Vite/el navegador: no se puede probar en
// Node/vitest. Lo testable de la Parte A es el mapeo puro datos -> campos,
// buildCmrFieldValues, cubierto abajo.
describe("buildCmrFieldValues", () => {
  it("usa el remitente por defecto de Lasarte cuando no se aporta", () => {
    const values = buildCmrFieldValues({});
    expect(values["001"]).toBe(LASARTE_REMITENTE_DEFECTO);
  });

  it("respeta un remitente explicito", () => {
    const values = buildCmrFieldValues({ remitente: "OTRO REMITENTE" });
    expect(values["001"]).toBe("OTRO REMITENTE");
  });

  it("mapea numCarta y consignatario a NumCarta/002", () => {
    const values = buildCmrFieldValues({ numCarta: "10305", consignatario: "COFRULY" });
    expect(values.NumCarta).toBe("10305");
    expect(values["002"]).toBe("COFRULY");
  });

  it("reparte lugarEntrega (string con saltos de linea) en 003_1..3, maximo 3 lineas", () => {
    const values = buildCmrFieldValues({ lugarEntrega: "Linea 1\nLinea 2\nLinea 3\nLinea 4" });
    expect(values["003_1"]).toBe("Linea 1");
    expect(values["003_2"]).toBe("Linea 2");
    expect(values["003_3"]).toBe("Linea 3");
    expect(values["003_4"]).toBeUndefined();
  });

  it("acepta lugarFechaCarga como array en 004_1..2", () => {
    const values = buildCmrFieldValues({ lugarFechaCarga: ["ECIJA", "08/07/2026"] });
    expect(values["004_1"]).toBe("ECIJA");
    expect(values["004_2"]).toBe("08/07/2026");
  });

  it("mapea docsAnexos, marcas y naturaleza a 005/006/009", () => {
    const values = buildCmrFieldValues({ docsAnexos: "Albaran 123", marcas: "MARCA-X", naturaleza: "Citricos" });
    expect(values["005"]).toBe("Albaran 123");
    expect(values["006"]).toBe("MARCA-X");
    expect(values["009"]).toBe("Citricos");
  });

  it("reparte bultos en 007_1..4", () => {
    const values = buildCmrFieldValues({ bultos: ["10 palets", "5 cajas"] });
    expect(values["007_1"]).toBe("10 palets");
    expect(values["007_2"]).toBe("5 cajas");
    expect(values["007_3"]).toBeUndefined();
  });

  it("reparte embalaje en 008_01..02", () => {
    const values = buildCmrFieldValues({ embalaje: ["Palet", "Caja"] });
    expect(values["008_01"]).toBe("Palet");
    expect(values["008_02"]).toBe("Caja");
  });

  it("sin lineas explicitas, usa pesoBrutoKg como fallback en la linea 1 (columna 014_01)", () => {
    const values = buildCmrFieldValues({ pesoBrutoKg: "1200" });
    expect(values["014_01"]).toBe("1200");
    expect(values["010_01"]).toBeUndefined();
    expect(values["015_01"]).toBeUndefined();
  });

  it("con lineas explicitas, mapea numeroEstadistico/pesoBrutoKg/volumenM3 a 010/014/015 por indice", () => {
    const values = buildCmrFieldValues({
      lineas: [
        { numeroEstadistico: "EST-1", pesoBrutoKg: "500", volumenM3: "1.2" },
        { pesoBrutoKg: "300" },
      ],
    });
    expect(values["010_01"]).toBe("EST-1");
    expect(values["014_01"]).toBe("500");
    expect(values["015_01"]).toBe("1.2");
    expect(values["014_02"]).toBe("300");
    expect(values["010_02"]).toBeUndefined();
  });

  it("trunca a un maximo de 7 lineas de mercancia", () => {
    const lineas = Array.from({ length: 10 }, (_, i) => ({ pesoBrutoKg: String(i + 1) }));
    const values = buildCmrFieldValues({ lineas });
    expect(values["014_07"]).toBe("7");
    expect(values["014_08"]).toBeUndefined();
  });

  it("mapea transportista, formalizadoEn, matriculas y firmas", () => {
    const values = buildCmrFieldValues({
      transportista: "Transportes Lasarte",
      formalizadoEn: ["ECIJA", "08/07/2026"],
      matriculaTractora: "1234ABC",
      matriculaRemolque: "5678DEF",
      firmaRemitente: "Juan Perez",
      firmaTransportista: "Ana Gomez",
    });
    expect(values["016"]).toBe("Transportes Lasarte");
    expect(values["021_01"]).toBe("ECIJA");
    expect(values["021_02"]).toBe("08/07/2026");
    expect(values.TRACTORA).toBe("1234ABC");
    expect(values.REMOLQUE).toBe("5678DEF");
    expect(values["022"]).toBe("Juan Perez");
    expect(values["023"]).toBe("Ana Gomez");
  });

  it("no incluye claves para campos vacios o en blanco", () => {
    const values = buildCmrFieldValues({ consignatario: "   ", docsAnexos: "" });
    expect(values["002"]).toBeUndefined();
    expect(values["005"]).toBeUndefined();
  });

  it("con datos completamente vacios solo aporta el remitente por defecto", () => {
    const values = buildCmrFieldValues({});
    expect(Object.keys(values)).toEqual(["001"]);
  });
});

describe("generarHojaRutaPdf", () => {
  it("genera un PDF A4 vertical con al menos una pagina", async () => {
    const doc = await generarHojaRutaPdf({
      numero: "HR-1",
      transportista: "Transportes Lasarte",
      destinatario: "Cliente Destino",
      matriculaTractora: "1234ABC",
      matriculaRemolque: "5678DEF",
      destino: "Madrid",
      fechaCarga: "2026-07-06",
      fechaDescarga: "2026-07-07",
      descripcionMercancia: "Citricos varios",
      pesoKg: "1200",
      observaciones: "Entregar antes de las 10:00",
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0);
  });

  it("no lanza con datos vacios (usa ECIJA como origen por defecto)", async () => {
    await expect(generarHojaRutaPdf({})).resolves.toBeDefined();
  });

  it("produce bytes de PDF validos (cabecera %PDF)", async () => {
    const doc = await generarHojaRutaPdf({ transportista: "T", destino: "D" });
    const bytes = pdfToBytes(doc);
    expect(bytes.length).toBeGreaterThan(500);
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });
});

describe("nombres de archivo", () => {
  it("cmrPdfFilename incluye el numero cuando se aporta", () => {
    expect(cmrPdfFilename("10305")).toMatch(/^Lasarte_CMR_10305_/);
    expect(cmrPdfFilename("10305")).toMatch(/\.pdf$/);
  });

  it("cmrPdfFilename funciona sin numero", () => {
    expect(cmrPdfFilename(null)).toMatch(/^Lasarte_CMR_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("hojaRutaPdfFilename incluye el numero cuando se aporta", () => {
    expect(hojaRutaPdfFilename("HR-1")).toMatch(/^Lasarte_HojaRuta_HR-1_/);
  });
});

describe("constantes de defecto", () => {
  it("ORIGEN_DEFECTO es ECIJA", () => {
    const sinAcentos = ORIGEN_DEFECTO.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
    expect(sinAcentos).toBe("ECIJA");
  });

  it("LASARTE_REMITENTE_DEFECTO incluye el CIF real", () => {
    expect(LASARTE_REMITENTE_DEFECTO).toContain("B14800304");
  });
});
