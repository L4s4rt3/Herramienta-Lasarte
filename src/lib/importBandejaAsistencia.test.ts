import { describe, expect, it } from "vitest";
import { clasificarAsistenciaHoras } from "@/lib/importBandejaAsistencia";

// Fixture sintética con la misma forma que el fichaje real (SEMANA NN.xlsx
// del programa de fichajes de RRHH): una fila por (trabajador, día), columna
// "Productor" = nombre del TRABAJADOR (nombre engañoso del programa externo,
// no tiene nada que ver con un productor de fruta), varios tramos HI/HF por
// pausas y HN/HE = horas normales/extra.
const CABECERA_FICHAJE = ["Productor", "Actividad", "Fecha", "HI", "HF", "HI", "HF", "HI", "HF", "HN", "€/HN", "Imp. HN", "HE", "€/HE", "Imp. HE", "Anticipos", "Total"];

function filaFichaje(nombre: string, actividad: string, fecha: string, hn: number, he: number) {
  return [nombre, actividad, fecha, "06:00", "12:59", "", "", "", "", hn, 6.5, hn * 6.5, he, 6.5, he * 6.5, 0, hn * 6.5 + he * 6.5];
}

const FICHAJE_SEMANAL_ROWS: unknown[][] = [
  CABECERA_FICHAJE,
  filaFichaje("AGUILAR PRIEGO LAURA", "ENVASADORAS", "27/07/2026", 7, 0),
  filaFichaje("AGUILAR PRIEGO LAURA", "ENVASADORAS", "28/07/2026", 6.5, 0),
  filaFichaje("ANCIO RODRIGUEZ MARIA CELESTE", "ENVASADORAS", "27/07/2026", 0, 7.09),
  filaFichaje("ANCIO RODRIGUEZ MARIA CELESTE", "ENVASADORAS", "28/07/2026", 0, 6.91),
  filaFichaje("ARIZA OLMO MARTA", "AEREO", "27/07/2026", 7.56, 0),
];

describe("clasificarAsistenciaHoras", () => {
  it("detecta el fichaje semanal de horas (una fila por trabajador+día con HI/HF) y calcula el resumen", () => {
    const resultado = clasificarAsistenciaHoras("SEMANA 31.xlsx", FICHAJE_SEMANAL_ROWS, 2026);

    expect(resultado).not.toBeNull();
    expect(resultado?.esAsistencia).toBe(true);
    expect(resultado?.fileName).toBe("SEMANA 31.xlsx");
    // 3 trabajadores distintos, 2 días cada uno de los dos primeros + 1 día de Marta = 5 registros.
    expect(resultado?.n).toBe(5);
    expect(resultado?.payload.trabajadoresUnicos).toBe(3);
    expect(resultado?.payload.fechaInicio).toBe("2026-07-27");
    expect(resultado?.payload.fechaFin).toBe("2026-07-28");
    // Horas: (7+6.5) + (7.09+6.91) + 7.56 = 13.5 + 14 + 7.56 = 35.06 -> redondeado a 1 decimal.
    expect(resultado?.payload.horasTotales).toBeCloseTo(35.1, 5);
    // El nombre presente en cada día del payload lo consume tal cual buildAttendanceRecords.
    expect(resultado?.payload.dias).toEqual([
      { date: "2026-07-27", names: expect.arrayContaining(["AGUILAR PRIEGO LAURA", "ANCIO RODRIGUEZ MARIA CELESTE", "ARIZA OLMO MARTA"]) },
      { date: "2026-07-28", names: expect.arrayContaining(["AGUILAR PRIEGO LAURA", "ANCIO RODRIGUEZ MARIA CELESTE"]) },
    ]);
  });

  it("no confunde el fichaje con un grid de báscula (Fecha+Lote+Kg Entrada, sin columna de trabajador ni HI/HF)", () => {
    const rowsBascula: unknown[][] = [
      ["Fecha", "Entrada", "Finca", "Parcela", "Lote", "Agricultor", "Articulo", "Tipo de envase", "Envases", "Kg Entrada"],
      ["27/07/2026", "1", "LOS OLIVOS", "3", "26072701", "JUAN PEREZ SAT", "NARANJA", "PALOT", 10, 22500],
      ["27/07/2026", "2", "LA HOYA", "1", "26072702", "MARIA LOPEZ SAT", "LIMON", "PALOT", 8, 18000],
    ];

    expect(clasificarAsistenciaHoras("bascula_2026-07-27.xlsx", rowsBascula, 2026)).toBeNull();
  });

  it("no confunde el fichaje con el informe de tamaños/clase por PRODUCTOR del calibrador (misma palabra 'Productor', formato completamente distinto)", () => {
    const rowsInformeProductor: unknown[][] = [
      ["Filtros"],
      ["Nombre del Productor es 'MORATALLA'\nFecha de Lote es entre 01/07/2026 y 31/07/2026"],
      [],
      ["Variedad:", "NAVELINA"],
      ["(A) Extra 1"],
      [],
      ["Tamaño", "Peso (kg)"],
      ["(01) CITRICA", 1200],
      ["(02) CITRICA", 900],
      ["(J) Podrido"],
      ["Tamaño", "Peso (kg)"],
      ["(01) CITRICA", 30],
    ];

    expect(clasificarAsistenciaHoras("MORATALLA TAMAÑOS CLASE Y CALIDAD.xlsx", rowsInformeProductor, 2026)).toBeNull();
  });

  it("devuelve null si no hay suficientes filas o la hoja viene vacía", () => {
    expect(clasificarAsistenciaHoras("vacio.xlsx", [], 2026)).toBeNull();
    expect(clasificarAsistenciaHoras("vacio.xlsx", [CABECERA_FICHAJE], 2026)).toBeNull();
    expect(clasificarAsistenciaHoras("vacio.xlsx", undefined, 2026)).toBeNull();
  });

  it("exige HI Y HF a la vez: una cabecera con Nombre+Fecha pero sin ningún HI/HF no se clasifica como fichaje de horas", () => {
    const rowsSinHiHf: unknown[][] = [
      ["Nombre", "Fecha", "Presente"],
      ["Ana Lopez", "27/07/2026", "x"],
      ["Mario Perez", "27/07/2026", ""],
    ];

    expect(clasificarAsistenciaHoras("lista_presencia.xlsx", rowsSinHiHf, 2026)).toBeNull();
  });
});
