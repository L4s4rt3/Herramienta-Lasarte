import { describe, expect, it } from "vitest";
import {
  buildProductoClasificadoExportRow,
  buildRendimientoZonaExportRow,
  buildTrabajadorDiaExportRow,
  normalizeAsistenciaExportZona,
} from "./asistenciaExport";

describe("asistencia export labels", () => {
  it("normalizes old operational zone names for exports", () => {
    expect(normalizeAsistenciaExportZona("Envasadoras")).toBe("Mesas");
    expect(normalizeAsistenciaExportZona("Envasado")).toBe("Mesas");
    expect(normalizeAsistenciaExportZona("Granelera/RP")).toBe("Graneleras");
    expect(normalizeAsistenciaExportZona("granel rp")).toBe("Graneleras");
    expect(normalizeAsistenciaExportZona("Mallas")).toBe("Mallas");
  });

  it("uses readable headers in Rendimiento zonas export", () => {
    const row = buildRendimientoZonaExportRow({
      label: "Granelera/RP",
      kg: 1234.4,
      porcentajeKg: 42.5,
      personas: 8,
      objetivo: 10,
      kgPersona: 154.3,
    }, "42,5%");

    expect(row).toEqual({
      Zona: "Graneleras",
      Kg: 1234,
      "Porcentaje kg": "42,5%",
      "Personas presentes": 8,
      "Personas plantilla": 10,
      "Kg/persona": 154,
    });
    expect(Object.keys(row).some((key) => key.includes("_"))).toBe(false);
  });

  it("uses Kg/persona general for treatment-line worker reference", () => {
    const row = buildTrabajadorDiaExportRow({
      nombre: "Ana",
      zona: "Envasadoras",
      estado: "Presente",
      coste: "Linea tratamiento",
      calculo: "Entra kg/p",
      kgRef: 2259,
    });

    expect(row).toEqual({
      Nombre: "Ana",
      Zona: "Mesas",
      Estado: "Presente",
      Coste: "Linea tratamiento",
      Calculo: "Entra kg/p",
      "Kg/persona general": 2259,
    });
    expect(Object.keys(row).some((key) => key.includes("_"))).toBe(false);
  });

  it("uses readable headers in Productos clasificados export", () => {
    const row = buildProductoClasificadoExportRow({
      producto: "LA FEA",
      empaque: "15 K",
      zona: "Granelera/RP",
      computa: true,
      kg: 1000.4,
    });

    expect(row).toEqual({
      Producto: "LA FEA",
      Empaque: "15 K",
      Zona: "Graneleras",
      "Computa kg zona": "Si",
      Kg: 1000,
    });
    expect(Object.keys(row).some((key) => key.includes("_"))).toBe(false);
  });
});
