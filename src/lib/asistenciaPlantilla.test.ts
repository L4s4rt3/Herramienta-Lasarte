import { describe, expect, it } from "vitest";
import {
  ASISTENCIA_PLANTILLA_OPERATIVA,
  calcularCoberturaPlantilla,
  calcularRendimientoZonasAlmacen,
  totalPlantillaOperativa,
} from "./asistenciaPlantilla";

describe("asistenciaPlantilla", () => {
  it("defines the real operational headcount by start-up and zone", () => {
    expect(totalPlantillaOperativa()).toBe(58);
    expect(ASISTENCIA_PLANTILLA_OPERATIVA.arranque.total).toBe(15);
    expect(ASISTENCIA_PLANTILLA_OPERATIVA.mallas.total).toBe(14);
    expect(ASISTENCIA_PLANTILLA_OPERATIVA.granelRp.total).toBe(7);
    expect(ASISTENCIA_PLANTILLA_OPERATIVA.mesas.total).toBe(18);
    expect(ASISTENCIA_PLANTILLA_OPERATIVA.cargaDescarga.total).toBe(4);
    expect(ASISTENCIA_PLANTILLA_OPERATIVA.mesas.puestos).toContainEqual({
      zona: "Envasadoras",
      trabajadores: 14,
    });
  });

  it("compares active workers against the required headcount by zone", () => {
    const cobertura = calcularCoberturaPlantilla([
      { zona: "Carretillero inicio linea", activo: true },
      { zona: "Carretillero inicio linea", activo: false },
      { zona: "Encargadas", activo: true },
      { zona: "Responsables mallas", activo: true },
      { zona: "Responsables mallas", activo: true },
      { zona: "Envasadoras", activo: true },
      { zona: "Carga y descarga", activo: true },
    ]);

    expect(cobertura.totalActual).toBe(6);
    expect(cobertura.totalObjetivo).toBe(58);
    expect(cobertura.zonas.find((zona) => zona.zona === "Encargadas")).toMatchObject({
      objetivo: 2,
      actual: 1,
      diferencia: -1,
    });
    expect(cobertura.zonas.find((zona) => zona.zona === "Responsables mallas")).toMatchObject({
      objetivo: 3,
      actual: 2,
      diferencia: -1,
    });
  });

  it("calculates kg per person by productive warehouse zone", () => {
    const arranque = [
      "Raquel Prisco Diaz",
      "Lidia Luna Rodriguez",
      "Antonio Jesus Rodriguez Espejo",
      "Sandra Naranjo",
      "Daniela Areiza",
      "Marta Ariza",
      "Pilar Llamas",
      "Alejandro Carmona",
      "Angel Prisco",
      "Monserrat Garcia Alcazar",
      "Cristian Prieto",
      "Ana Maria Rodriguez Ramos",
      "Rocio Flores Ancio",
      "Sara Hans Doblas",
      "Antonio Lopez Galvez",
    ];
    const mallas = [
      "Alvaro Corrales",
      "Ana Cristina Jimenez",
      "Encarni Minguez",
      "Marina Jimenez",
      "Araceli Rivera",
      "Miriam Plaza",
      "Maria Pilar Moreno",
      "Rocio Garcia Navarro",
      "Rocio Gonzalez",
      "Sandra Leon",
      "Lucia Ferrero Martinez",
      "Libertad Diaz",
      "Ana Belen Rodriguez Laguna",
    ];
    const granel = [
      "Eva Llamas",
      "Irene Luna",
      "Virginia Fabra",
      "Laura Rivero Rodriguez",
      "Sonia Lebron",
    ];
    const mozos = ["Borja Garrido", "Josue Prisco", "Rafael Arjona", "Ruben Chaparro"];
    const envasadoras = Array.from({ length: 14 }, (_, index) => `Envasadora ${index + 1}`);
    const workers = [
      ...arranque.map((nombre) => ({ id: nombre, nombre, activo: true })),
      ...mallas.map((nombre) => ({ id: nombre, nombre, activo: true })),
      ...granel.map((nombre) => ({ id: nombre, nombre, activo: true })),
      ...mozos.map((nombre) => ({ id: nombre, nombre, activo: true })),
      ...envasadoras.map((nombre) => ({ id: nombre, nombre, zona: "Envasadoras", activo: true })),
    ];

    const rendimiento = calcularRendimientoZonasAlmacen({
      trabajadores: workers,
      asistencia: Object.fromEntries(workers.map((worker) => [worker.id, true])),
      kgPorZona: {
        mallas: 29000,
        granelRp: 22000,
        mesas: 33000,
        industria: 15000,
      },
    });

    expect(rendimiento.lineaComun).toMatchObject({
      objetivo: 15,
      presentes: 15,
    });
    expect(rendimiento.zonas.find((zona) => zona.id === "mallas")).toMatchObject({
      objetivo: 29,
      presentes: 29,
      kg: 29000,
      kgPersonaPresentes: 1000,
      kgPersonaObjetivo: 1000,
    });
    expect(rendimiento.zonas.find((zona) => zona.id === "granelRp")).toMatchObject({
      objetivo: 22,
      presentes: 22,
      kgPersonaPresentes: 1000,
      kgPersonaObjetivo: 1000,
    });
    expect(rendimiento.zonas.find((zona) => zona.id === "mesas")).toMatchObject({
      objetivo: 33,
      presentes: 33,
      kgPersonaPresentes: 1000,
      kgPersonaObjetivo: 1000,
    });
    expect(rendimiento.zonas.find((zona) => zona.id === "industria")).toMatchObject({
      objetivo: 15,
      presentes: 15,
      kgPersonaPresentes: 1000,
      kgPersonaObjetivo: 1000,
    });
  });
});
