import { describe, expect, it } from "vitest";
import {
  buildCalidadAttachmentRows,
  buildCalidadExcelRows,
  buildCalidadIncidentRows,
  calidadSummary,
  formatCalidadDate,
  normalizeCalidadName,
  sameCalidadName,
  type CalidadLote,
} from "@/lib/calidad";

const lotes: CalidadLote[] = [
  {
    id: "1",
    jornada_id: "j1",
    fecha: "2026-06-03",
    numero_lote: "26041704",
    productor_finca_id: null,
    productor_finca_nombre: "Los Corrales",
    producto: "Naranja",
    variedad: "Navel Powell",
    cantidad: "64 Box",
    hora: "06:00",
    aerobotics_realizado: true,
    calidad: "Regular",
    defectos: ["Rameado"],
    observacion: "Entrada regular, revisar calibre.",
    accion_recomendada: "Separar para seguimiento.",
    created_at: "2026-06-03T06:00:00Z",
    updated_at: "2026-06-03T06:00:00Z",
  },
  {
    id: "2",
    jornada_id: "j1",
    fecha: "2026-06-03",
    numero_lote: "26041705",
    productor_finca_id: null,
    productor_finca_nombre: "La Torrecilla",
    producto: "Naranja",
    variedad: "Navel Lane Late",
    cantidad: "42 Box",
    hora: null,
    aerobotics_realizado: false,
    calidad: "Bueno",
    defectos: [],
    observacion: "",
    accion_recomendada: "",
    created_at: "2026-06-03T07:00:00Z",
    updated_at: "2026-06-03T07:00:00Z",
  },
];

describe("calidad helpers", () => {
  it("summarizes daily lots by quality, aerobotics and attachments", () => {
    expect(calidadSummary(lotes, { "1": 2, "2": 0 })).toEqual({
      total: 2,
      aerobotics: 1,
      fotos: 2,
      byQuality: {
        Bueno: 1,
        Regular: 1,
        Deficiente: 0,
        Rechazado: 0,
      },
    });
  });

  it("builds one Excel row per lot with each field in its own column", () => {
    expect(buildCalidadExcelRows(lotes, { "1": 2 })[0]).toMatchObject({
      Fecha: "03 jun 2026",
      Lote: "26041704",
      "Productor/Finca": "Los Corrales",
      Producto: "Naranja",
      Variedad: "Navel Powell",
      Cantidad: "64 Box",
      "Aerobotics realizado": "Si",
      Calidad: "Regular",
      Defectos: "Rameado",
      Fotos: 2,
    });
  });

  it("builds an incidents sheet with only lots that need follow up", () => {
    const rows = buildCalidadIncidentRows(lotes, { "1": 2, "2": 0 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Prioridad: "Seguimiento",
      Lote: "26041704",
      "Productor/Finca": "Los Corrales",
      Calidad: "Regular",
      Fotos: 2,
    });
  });

  it("builds attachment rows with lot traceability fields", () => {
    const rows = buildCalidadAttachmentRows(
      { id: "j1", fecha: "2026-06-03", responsable: "Eusebio", estado: "guardada" },
      lotes,
      [{ id: "a1", lote_id: "1", file_name: "foto.jpg", file_path: "u/calidad/foto.jpg", mime_type: "image/jpeg", file_size: 123 }],
    );

    expect(rows[0]).toMatchObject({
      Fecha: "03 jun 2026",
      Lote: "26041704",
      "Productor/Finca": "Los Corrales",
      Calidad: "Regular",
      Archivo: "foto.jpg",
    });
  });

  it("formats ISO dates for readable report titles", () => {
    expect(formatCalidadDate("2026-06-03")).toBe("03 jun 2026");
  });

  it("normalizes repeated producer/farm names", () => {
    expect(normalizeCalidadName("  Los   Corrales  ")).toBe("Los Corrales");
    expect(sameCalidadName("Los Corrales", "los corrales")).toBe(true);
  });
});
