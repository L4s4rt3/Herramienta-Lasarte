import { describe, expect, it } from "vitest";
import {
  aplicarZonasOperativasTrabajadores,
  darBajaTrabajadorPreservandoHistorial,
  parseTrabajadorNamesInput,
  resolveTrabajadoresPorNombre,
  zonaOperativaTrabajador,
} from "./asistenciaTrabajadores";

describe("asistenciaTrabajadores", () => {
  it("keeps the worker row and only marks it inactive", () => {
    const trabajadores = [
      { id: "ana", nombre: "Ana", activo: true },
      { id: "luis", nombre: "Luis", activo: true },
    ];

    expect(darBajaTrabajadorPreservandoHistorial(trabajadores, "ana")).toEqual([
      { id: "ana", nombre: "Ana", activo: false },
      { id: "luis", nombre: "Luis", activo: true },
    ]);
  });

  it("parses pasted worker names and removes duplicates", () => {
    expect(parseTrabajadorNamesInput("Anais Castells Sánchez, Lucia Ferrero\nAnais Castells Sanchez")).toEqual([
      "Anais Castells Sánchez",
      "Lucia Ferrero",
    ]);
  });

  it("matches pasted names ignoring accents and active state", () => {
    const trabajadores = [
      { id: "anais", nombre: "Anais Castells Sánchez", activo: true },
      { id: "lucia", nombre: "Lucía Ferrero Martínez", activo: true },
      { id: "monserrat", nombre: "Monserrat García Alcázar", activo: false },
    ];

    const result = resolveTrabajadoresPorNombre(
      trabajadores,
      "Anais Castells Sanchez\nLucia Ferrero Martinez\nMonserrat Garcia Alcazar\nNo Existe",
    );

    expect(result.matches.map((match) => match.trabajador.id)).toEqual(["anais", "lucia"]);
    expect(result.inactive.map((match) => match.trabajador.id)).toEqual(["monserrat"]);
    expect(result.missing).toEqual(["No Existe"]);
  });

  it("assigns real operational zones by worker name", () => {
    expect(zonaOperativaTrabajador("Antonio Jesus Rodriguez Espejo")).toBe("Carretillero inicio linea");
    expect(zonaOperativaTrabajador("Cristian Prisco")).toBe("Transpaletas mecanicas");
    expect(zonaOperativaTrabajador("Maria Pilar Moreno")).toBe("Malla 2 - Tria");
    expect(zonaOperativaTrabajador("Irene Luna")).toBe("Responsables granel/RP");
    expect(zonaOperativaTrabajador("Trabajadora Sin Puesto", "Carga y descarga")).toBe("Carga y descarga");
    expect(zonaOperativaTrabajador("Trabajadora Sin Puesto", "Punta")).toBe("Envasadoras");
  });

  it("updates worker rows with the operational zone map", () => {
    expect(aplicarZonasOperativasTrabajadores([
      { nombre: "Ruben Chaparro", zona: "Mozos" },
      { nombre: "Laura Aguilar Priego", zona: "Punta" },
      { nombre: "Sergio Perez Ruiz", zona: "Carga y descarga" },
    ])).toEqual([
      { nombre: "Ruben Chaparro", zona: "Mozos envasado" },
      { nombre: "Laura Aguilar Priego", zona: "Envasadoras" },
      { nombre: "Sergio Perez Ruiz", zona: "Carga y descarga" },
    ]);
  });
});
