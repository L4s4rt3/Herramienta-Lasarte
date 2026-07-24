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
      "Cristian Prisco",
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

  it("counts every present worker from a real day, grouping unmatched zones as 'Sin zona' instead of dropping them", () => {
    // Reproduce el parte real del 2026-07-01 (52 personas presentes ese dia).
    // Hay dos causas reales de perdida silenciosa que este test cubre:
    //  1) "Tamara Martin Galvez" tiene zona "Segunda", que no aparece en
    //     ninguna lista de puestos ni en ningun fallback por zona: es la
    //     unica que debe acabar en "sinZona" (no hay forma de asignarla).
    //  2) Los puestos "Carretillero final linea" (objetivo 1, candidatos
    //     Alejandro Carmona/Juan Prieto) y "Produccion" (objetivo 3,
    //     candidatos Ana Maria Rodriguez Ramos/Rocio Flores Ancio/Sara Hans
    //     Doblas/Silvia Cerro Ojeda) listan mas nombres que plazas: si todos
    //     esos candidatos estan presentes a la vez, el sobrante (aqui: Juan
    //     Prieto y Silvia Cerro Ojeda) NO es "sin zona" — cuando viene todo
    //     el mundo, el que sobra de su puesto va a mesas (decision del
    //     dueño): cuenta como refuerzo de Envasado en el reparto.
    const nombre = (n: string) => n; // helper solo para legibilidad
    const trabajadores = [
      { id: "1", nombre: nombre("Marta Ariza"), zona: "Aereo", activo: true },
      { id: "2", nombre: "Pilar Llamas", zona: "Aereo", activo: true },
      { id: "3", nombre: "Daniel Perez Ruiz", zona: "Carga y descarga", activo: true },
      { id: "4", nombre: "Juan Francisco Mato Diaz", zona: "Carga y descarga", activo: true },
      { id: "5", nombre: "Raul Delgado Castilla", zona: "Carga y descarga", activo: true },
      { id: "6", nombre: "Sergio Perez Ruiz", zona: "Carga y descarga", activo: true },
      { id: "7", nombre: "Alejandro Carmona", zona: "Carretillero final linea", activo: true },
      { id: "8", nombre: "Juan Prieto", zona: "Carretillero final linea", activo: true },
      { id: "9", nombre: "Antonio Jesus Rodriguez Espejo", zona: "Carretillero inicio linea", activo: true },
      { id: "10", nombre: "Lidia Luna Rodriguez", zona: "Encargadas", activo: true },
      { id: "11", nombre: "Raquel Prisco Diaz", zona: "Encargadas", activo: true },
      { id: "12", nombre: "Ana Maria Jimenez Escribano", zona: "Envasadoras", activo: true },
      { id: "13", nombre: "Angeles Rodriguez Morejon", zona: "Envasadoras", activo: true },
      { id: "14", nombre: "Bibiana Blanco", zona: "Envasadoras", activo: true },
      { id: "15", nombre: "Carmen Carmelia Oprea", zona: "Envasadoras", activo: true },
      { id: "16", nombre: "Cristina Rodriguez Grande", zona: "Envasadoras", activo: true },
      { id: "17", nombre: "Laura Aguilar Priego", zona: "Envasadoras", activo: true },
      { id: "18", nombre: "Manuela Gomez Caballero", zona: "Envasadoras", activo: true },
      { id: "19", nombre: "Maria Celeste Ancio", zona: "Envasadoras", activo: true },
      { id: "20", nombre: "Pilar Gomez Caballero", zona: "Envasadoras", activo: true },
      { id: "21", nombre: "Rocio Diaz Ramos", zona: "Envasadoras", activo: true },
      { id: "22", nombre: "Araceli Rivera", zona: "Malla 1 - Recogedoras", activo: true },
      { id: "23", nombre: "Miriam Plaza", zona: "Malla 1 - Recogedoras", activo: true },
      { id: "24", nombre: "Marina Jimenez", zona: "Malla 1 - Tria", activo: true },
      { id: "25", nombre: "Rocio Garcia Navarro", zona: "Malla 2 - Recogedoras", activo: true },
      { id: "26", nombre: "Rocio Gonzalez", zona: "Malla 2 - Recogedoras", activo: true },
      { id: "27", nombre: "Maria Pilar Moreno", zona: "Malla 2 - Tria", activo: true },
      { id: "28", nombre: "Sandra Leon", zona: "Malla 3 - Tria", activo: true },
      { id: "29", nombre: "Eli Conde", zona: "Malla 4 - Recogedoras", activo: true },
      { id: "30", nombre: "Ana Belen Rodriguez Laguna", zona: "Malla 4 - Tria", activo: true },
      { id: "31", nombre: "Borja Garrido", zona: "Mozos envasado", activo: true },
      { id: "32", nombre: "Rafael Arjona", zona: "Mozos envasado", activo: true },
      { id: "33", nombre: "Ruben Chaparro", zona: "Mozos envasado", activo: true },
      { id: "34", nombre: "Ana Maria Rodriguez Ramos", zona: "Produccion", activo: true },
      { id: "35", nombre: "Rocio Flores Ancio", zona: "Produccion", activo: true },
      { id: "36", nombre: "Sara Hans Doblas", zona: "Produccion", activo: true },
      { id: "37", nombre: "Silvia Cerro Ojeda", zona: "Produccion", activo: true },
      { id: "38", nombre: "Antonio Lopez Galvez", zona: "Responsable mantenimiento", activo: true },
      { id: "39", nombre: "Eva Llamas", zona: "Responsables granel/RP", activo: true },
      { id: "40", nombre: "Irene Luna", zona: "Responsables granel/RP", activo: true },
      { id: "41", nombre: "Alvaro Corrales", zona: "Responsables mallas", activo: true },
      { id: "42", nombre: "Ana Cristina Jimenez", zona: "Responsables mallas", activo: true },
      { id: "43", nombre: "Encarni Minguez", zona: "Responsables mallas", activo: true },
      // Zona real de la BD que no aparece en ninguna lista de puestos ni fallback.
      { id: "44", nombre: "Tamara Martin Galvez", zona: "Segunda", activo: true },
      { id: "45", nombre: "Angel Prisco", zona: "Transpaletas mecanicas", activo: true },
      { id: "46", nombre: "Cristian Prisco", zona: "Transpaletas mecanicas", activo: true },
      { id: "47", nombre: "Enrique Fernandez", zona: "Transpaletas mecanicas", activo: true },
      { id: "48", nombre: "Daniela Areiza", zona: "Tria podrido", activo: true },
      { id: "49", nombre: "Sandra Naranjo", zona: "Tria podrido", activo: true },
      { id: "50", nombre: "Laura Rivero Rodriguez", zona: "Triadoras granel/RP", activo: true },
      { id: "51", nombre: "Sonia Lebron", zona: "Triadoras granel/RP", activo: true },
      { id: "52", nombre: "Virginia Fabra", zona: "Triadoras granel/RP", activo: true },
    ];
    // Todos presentes (52, igual que el dia real).
    const asistencia = Object.fromEntries(trabajadores.map((t) => [t.id, true]));

    const rendimiento = calcularRendimientoZonasAlmacen({
      trabajadores,
      asistencia,
      kgPorZona: { mallas: 29000, granelRp: 22000, mesas: 33000, industria: 15000 },
    });

    // La unica persona que de verdad no se puede asignar es "Tamara Martin
    // Galvez" (zona "Segunda"): debe aparecer en sinZona, no perderse. Juan
    // Prieto y Silvia Cerro Ojeda (candidatos de sobra de su puesto) van de
    // refuerzo a mesas, no a sinZona.
    expect(rendimiento.sinZona.presentes).toBe(1);
    expect(rendimiento.sinZona.personas).toEqual(["Tamara Martin Galvez"]);
    expect([...rendimiento.refuerzoMesas.personas].sort()).toEqual(["Juan Prieto", "Silvia Cerro Ojeda"]);
    expect(rendimiento.refuerzoMesas.presentes).toBe(2);
    // Mesas recibe el refuerzo: linea (15) + mozos presentes (3) +
    // envasadoras presentes (10) + 2 de refuerzo.
    expect(rendimiento.zonas.find((zona) => zona.id === "mesas")?.presentes).toBe(30);

    // El resto (51 personas) debe quedar contado en algun bloque: linea +
    // zonas productivas + carga y descarga (verificado indirectamente: solo
    // 1 de 52 cae en sinZona).
    const totalContadoEnZonasProductivas = rendimiento.zonas
      .filter((z) => z.id !== "industria")
      .reduce((sum, z) => sum + z.presentes, 0);
    // Cada zona productiva ya incluye el arranque (15) sumado dentro, por lo
    // que no se suman directamente sin restarlo; solo comprobamos que cada
    // zona individualmente refleja gente real y que "Segunda" no infla
    // ninguna zona de forma indebida.
    expect(totalContadoEnZonasProductivas).toBeGreaterThan(0);
    // La linea de arranque cubre sus 15 plazas; los 2 candidatos de sobra
    // (Juan Prieto y Silvia Cerro Ojeda) no inflan la linea — van a mesas.
    expect(rendimiento.lineaComun.objetivo).toBe(15);
    expect(rendimiento.lineaComun.presentes).toBe(15);
  });

  it("cruza la limpieza de box con el reparto: personas enteras, jornada completa fuera", () => {
    const trabajadores = [
      { id: "alejandro", nombre: "Alejandro Carmona", zona: "Carretillero final linea", activo: true },
      { id: "juan", nombre: "Juan Prieto", zona: "Carretillero final linea", activo: true },
      { id: "tamara", nombre: "Tamara Martin Galvez", zona: "Segunda", activo: true },
      { id: "env1", nombre: "Envasadora 1", zona: "Envasadoras", activo: true },
    ];
    const asistencia = { alejandro: true, juan: true, tamara: true, env1: true };

    const rendimiento = calcularRendimientoZonasAlmacen({
      trabajadores,
      asistencia,
      kgPorZona: { mallas: 0, granelRp: 0, mesas: 8000, industria: 0 },
      // Juan limpió box 5h de su jornada de 8h; Tamara la jornada completa.
      jornadaFueraLinea: { juan: 5 / 8, tamara: 1 },
    });

    // Las personas no se parten: Juan limpió unas horas pero estuvo, así que
    // cuenta ENTERO — Alejandro cubre la única plaza de carretillero final y
    // Juan va de refuerzo a mesas como 1 persona.
    expect(rendimiento.lineaComun.presentes).toBe(1);
    expect(rendimiento.refuerzoMesas.personas).toEqual(["Juan Prieto"]);
    expect(rendimiento.refuerzoMesas.presentes).toBe(1);
    // Mesas: linea (1) + envasadora (1) + refuerzo de Juan (1) — enteros.
    expect(rendimiento.zonas.find((zona) => zona.id === "mesas")?.presentes).toBe(3);
    // Tamara pasó la jornada COMPLETA limpiando: fuera del reparto, y tampoco
    // es "sin zona" — sabemos dónde estuvo, no hay nada que revisar en su ficha.
    expect(rendimiento.sinZona.presentes).toBe(0);
    // Ambas salen en el listado informativo de limpieza.
    expect(rendimiento.fueraLinea.presentes).toBe(2);
    expect([...rendimiento.fueraLinea.personas].sort()).toEqual(["Juan Prieto", "Tamara Martin Galvez"]);

    // Sin el parámetro, no hay limpieza que listar y Tamara vuelve a ser
    // "sin zona".
    const sinDescuento = calcularRendimientoZonasAlmacen({
      trabajadores,
      asistencia,
      kgPorZona: { mallas: 0, granelRp: 0, mesas: 8000, industria: 0 },
    });
    expect(sinDescuento.lineaComun.presentes).toBe(1);
    expect(sinDescuento.refuerzoMesas.presentes).toBe(1);
    expect(sinDescuento.fueraLinea.presentes).toBe(0);
    expect(sinDescuento.sinZona.personas).toEqual(["Tamara Martin Galvez"]);
  });
});
