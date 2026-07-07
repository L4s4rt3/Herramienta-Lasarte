import { describe, expect, it } from "vitest";
import {
  aplicarZonasOperativasTrabajadores,
  darBajaTrabajadorPreservandoHistorial,
  parseTrabajadorNamesInput,
  resolveTrabajadoresPorLista,
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

  describe("resolveTrabajadoresPorNombre — robustez del parser", () => {
    const trabajadores = [
      { id: "borja", nombre: "Borja Garrido", activo: true },
      { id: "angel", nombre: "Ángel Núñez Pérez", activo: true },
      { id: "lucia", nombre: "Lucía Ferrero Martínez", activo: true },
      { id: "juan1", nombre: "Juan Pérez", activo: true },
      { id: "juan2", nombre: "Juan Pérez", activo: true },
    ];

    it("matches names with accents removed and different case", () => {
      const result = resolveTrabajadoresPorNombre(trabajadores, "angel nunez perez");
      expect(result.matches.map((m) => m.trabajador.id)).toEqual(["angel"]);
    });

    it("matches inverted token order without a comma (apellido nombre)", () => {
      const result = resolveTrabajadoresPorNombre(trabajadores, "GARRIDO BORJA");
      expect(result.matches.map((m) => m.trabajador.id)).toEqual(["borja"]);
    });

    it("matches a single already-isolated name with a comma (Apellido, Nombre) via resolveTrabajadoresPorLista", () => {
      // Cada nombre llega ya separado (una celda de Excel = un nombre), asi que
      // aqui la coma es formato "Apellido, Nombre", no separador de lista.
      const result = resolveTrabajadoresPorLista(trabajadores, ["GARRIDO, BORJA"]);
      expect(result.matches.map((m) => m.trabajador.id)).toEqual(["borja"]);
    });

    it("matches names with a comma and double spaces from an Excel cell", () => {
      const result = resolveTrabajadoresPorLista(trabajadores, ["Núñez,  Pérez,   Ángel"]);
      expect(result.matches.map((m) => m.trabajador.id)).toEqual(["angel"]);
    });

    it("matches compound surnames regardless of token order from an Excel cell", () => {
      const result = resolveTrabajadoresPorLista(trabajadores, ["Ferrero Martinez, Lucia"]);
      expect(result.matches.map((m) => m.trabajador.id)).toEqual(["lucia"]);
    });

    it("resolveTrabajadoresPorLista treats each array entry as one already-isolated name (no comma splitting)", () => {
      const result = resolveTrabajadoresPorLista(trabajadores, ["Borja Garrido", "Angel Nunez Perez"]);
      expect(result.matches.map((m) => m.trabajador.id).sort()).toEqual(["angel", "borja"]);
      expect(result.missing).toEqual([]);
    });

    it("resolves an unmatched name via a learned alias", () => {
      const aliasPorNombre = new Map<string, string>([["b garrido", "borja"]]);
      const result = resolveTrabajadoresPorNombre(trabajadores, "B Garrido", aliasPorNombre);
      expect(result.matches.map((m) => m.trabajador.id)).toEqual(["borja"]);
      expect(result.missing).toEqual([]);
    });

    it("does not resolve via alias when the alias map lacks an entry", () => {
      const aliasPorNombre = new Map<string, string>([["otro alias", "borja"]]);
      const result = resolveTrabajadoresPorNombre(trabajadores, "Nombre Desconocido Total", aliasPorNombre);
      expect(result.missing).toEqual(["Nombre Desconocido Total"]);
    });

    it("flags a real ambiguous case (two active workers, same short name)", () => {
      const result = resolveTrabajadoresPorNombre(trabajadores, "Juan Perez");
      expect(result.ambiguous).toHaveLength(1);
      expect(result.ambiguous[0].trabajadores.map((t) => t.id).sort()).toEqual(["juan1", "juan2"]);
      expect(result.matches).toEqual([]);
    });

    it("returns up to 3 reasonable suggestions for an unresolved name", () => {
      const result = resolveTrabajadoresPorNombre(trabajadores, "Borja Garido");
      expect(result.missing).toEqual(["Borja Garido"]);
      expect(result.noResueltos).toHaveLength(1);
      const [entry] = result.noResueltos;
      expect(entry.nombre).toBe("Borja Garido");
      expect(entry.sugerencias.length).toBeGreaterThan(0);
      expect(entry.sugerencias.length).toBeLessThanOrEqual(3);
      expect(entry.sugerencias[0].trabajadorId).toBe("borja");
      expect(entry.sugerencias[0].score).toBeGreaterThan(0.4);
    });

    it("suggests nothing when the name has no plausible candidate", () => {
      const result = resolveTrabajadoresPorNombre(trabajadores, "Zzzxxqq Wwvvyy");
      expect(result.noResueltos).toHaveLength(1);
      expect(result.noResueltos[0].sugerencias).toEqual([]);
    });

    it("keeps noResueltos in sync with missing for multiple unresolved names", () => {
      const result = resolveTrabajadoresPorNombre(trabajadores, "Persona Fantasma\nOtra Persona Rara");
      expect(result.missing).toEqual(["Persona Fantasma", "Otra Persona Rara"]);
      expect(result.noResueltos.map((n) => n.nombre)).toEqual(["Persona Fantasma", "Otra Persona Rara"]);
    });
  });
});
