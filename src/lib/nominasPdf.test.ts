import { describe, expect, it } from "vitest";
import { casarPaginaConTrabajador, normalizarNombre, type TrabajadorNominaCandidato } from "./nominasPdf";

describe("normalizarNombre", () => {
  it("quita tildes, pasa a minusculas y colapsa espacios", () => {
    expect(normalizarNombre("María José  Pérez")).toBe("maria jose perez");
  });

  it("quita comas y puntos", () => {
    expect(normalizarNombre("Pérez, María")).toBe("perez maria");
  });

  it("nunca lanza con entradas raras", () => {
    expect(normalizarNombre(null as unknown as string)).toBe("");
    expect(normalizarNombre(undefined as unknown as string)).toBe("");
  });
});

describe("casarPaginaConTrabajador", () => {
  const trabajadores: TrabajadorNominaCandidato[] = [
    { id: "1", nombre: "Juan Pérez García" },
    { id: "2", nombre: "Juan Gómez López" },
    { id: "3", nombre: "María José Pérez" },
  ];

  it("match claro: nombre y apellido presentes en el texto", () => {
    const texto = "NOMINA DEL MES\nTrabajador: Juan Pérez García\nDNI: 12345678A\nSalario: 1500€";
    const resultado = casarPaginaConTrabajador(texto, trabajadores);
    expect(resultado).toEqual({ trabajadorId: "1", confianza: "alta" });
  });

  it("ambiguedad: dos personas comparten nombre de pila y solo aparece el nombre de pila", () => {
    const texto = "NOMINA\nTrabajador: Juan\nDNI: 00000000A";
    const resultado = casarPaginaConTrabajador(texto, trabajadores);
    expect(resultado.trabajadorId).toBeNull();
    expect(resultado.confianza).toBe("baja");
    expect(resultado.candidatos?.map((c) => c.id).sort()).toEqual(["1", "2"]);
  });

  it("sin match: el texto no contiene a ningun trabajador", () => {
    const texto = "NOMINA\nTrabajador: Pedro Alonso Ruiz\nDNI: 99999999Z";
    const resultado = casarPaginaConTrabajador(texto, trabajadores);
    expect(resultado).toEqual({ trabajadorId: null, confianza: "ninguna" });
  });

  it("no confunde nombres que son substring de otra palabra", () => {
    const texto = "Empresa Juanjo Pereztein S.L.";
    const resultado = casarPaginaConTrabajador(texto, trabajadores);
    expect(resultado.confianza).toBe("ninguna");
    expect(resultado.trabajadorId).toBeNull();
  });

  it("distingue nombre de pila compartido cuando el apellido tambien aparece", () => {
    const texto = "NOMINA\nTrabajador: Juan Gómez López\nDNI: 11111111B";
    const resultado = casarPaginaConTrabajador(texto, trabajadores);
    expect(resultado).toEqual({ trabajadorId: "2", confianza: "alta" });
  });
});
