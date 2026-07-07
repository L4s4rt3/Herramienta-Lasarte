import { describe, expect, it } from "vitest";
import { cmrPdfFilename, generarCmrPdf, generarHojaRutaPdf, hojaRutaPdfFilename, pdfToBytes } from "./cmrPdf";

describe("generarCmrPdf", () => {
  it("genera un PDF A4 vertical con al menos una pagina", async () => {
    const doc = await generarCmrPdf({ numero: "10305", remitente: "LASARTE SAT", consignatario: "COFRULY" });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0);
  });

  it("produce bytes de PDF validos (cabecera %PDF)", async () => {
    const doc = await generarCmrPdf({ numero: "1", remitente: "LASARTE SAT" });
    const bytes = pdfToBytes(doc);
    expect(bytes.length).toBeGreaterThan(500);
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  it("no lanza con datos vacios (remitente por defecto)", async () => {
    await expect(generarCmrPdf({})).resolves.toBeDefined();
  });
});

describe("generarHojaRutaPdf", () => {
  it("genera un PDF con las paradas indicadas", async () => {
    const doc = await generarHojaRutaPdf({
      numero: "HR-1",
      fecha: "2026-07-06",
      transportista: "Transportes Lasarte",
      matricula: "1234ABC",
      conductor: "Juan",
      paradas: [
        { orden: 1, cliente: "Cliente A", destino: "Madrid", bultos: "10", kg: "500" },
        { orden: 2, cliente: "Cliente B", destino: "Valencia", bultos: "5", kg: "250" },
      ],
      notas: "Entregar antes de las 10:00",
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("no lanza con una lista de paradas vacia", async () => {
    await expect(generarHojaRutaPdf({ paradas: [] })).resolves.toBeDefined();
  });

  it("produce bytes de PDF validos", async () => {
    const doc = await generarHojaRutaPdf({ paradas: [{ orden: 1, cliente: "A", destino: "B" }] });
    const bytes = pdfToBytes(doc);
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
