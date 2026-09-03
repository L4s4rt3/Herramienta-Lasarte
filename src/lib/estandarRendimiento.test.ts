// El estándar por régimen vive en dos sitios a propósito (TypeScript para la
// app, el vigía y los scripts de Node; JSON para los informes en Python y el
// correo diario). Este test es lo que impide que se separen.
import { describe, expect, it } from "vitest";
import estandarJson from "../../scripts/informe-produccion/estandar.json";
import {
  calidadDia,
  ESTANDAR_RENDIMIENTO,
  ORDEN_TIPOS_DIA,
  regimenPlantilla,
  tipoDia,
} from "./estandarRendimiento";

describe("estándar de rendimiento", () => {
  it("dice lo mismo que scripts/informe-produccion/estandar.json", () => {
    expect(estandarJson.cortePlantillaReducida).toBe(ESTANDAR_RENDIMIENTO.cortePlantillaReducida);
    expect(estandarJson.regimenes).toEqual(ESTANDAR_RENDIMIENTO.regimenes);
    expect(estandarJson.fecha).toBe(ESTANDAR_RENDIMIENTO.fecha);
  });

  it("≤35 presentes es media plantilla; 36 con faltas sigue siendo completa (definición del dueño)", () => {
    expect(regimenPlantilla(27)).toBe("reducida");
    expect(regimenPlantilla(35)).toBe("reducida");
    expect(regimenPlantilla(36)).toBe("completa");
    expect(regimenPlantilla(45)).toBe("completa");
  });

  it("cada régimen tiene su listón", () => {
    expect(calidadDia(2100, "completa")).toBe("bueno");
    expect(calidadDia(1700, "completa")).toBe("medio");
    expect(calidadDia(1699, "completa")).toBe("malo");
    expect(calidadDia(2100, "reducida")).toBe("malo");
    expect(calidadDia(2200, "reducida")).toBe("medio");
    expect(calidadDia(2600, "reducida")).toBe("bueno");
  });

  it("los seis tipos, completa primero", () => {
    expect(ORDEN_TIPOS_DIA).toEqual([
      "Plantilla completa · día bueno", "Plantilla completa · día medio", "Plantilla completa · día malo",
      "Plantilla reducida · día bueno", "Plantilla reducida · día medio", "Plantilla reducida · día malo",
    ]);
    expect(tipoDia("reducida", "medio")).toBe("Plantilla reducida · día medio");
  });
});
