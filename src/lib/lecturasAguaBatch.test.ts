import { describe, expect, it } from "vitest";
import {
  buildLecturasAguaBatch,
  fechasSinLecturaAgua,
  parseLecturasAguaPegadas,
  type ConsumoFisicoInput,
} from "./consumosFisicos";

const HOY = "2026-08-14";

/** Fila de contador ya guardada, tal como la escriben los builders. */
function lecturaGuardada(
  referencia: string,
  foto: string,
  lectura: number,
  unidadLectura: "m3" | "L",
  cantidad = 0,
): ConsumoFisicoInput {
  const etiqueta = referencia === "agua-contador-general"
    ? `Lectura contador: ${lectura} m3`
    : `Lectura contador (${unidadLectura}): ${lectura} ${unidadLectura}`;
  return {
    id: `${referencia}-${foto}`,
    recurso: "agua",
    fecha_inicio: foto,
    fecha_fin: foto,
    cantidad,
    unidad: "l",
    fuente: "contador",
    referencia,
    notas: `${etiqueta} (foto del ${foto}). Consumo calculado: ${cantidad} L.`,
  };
}

describe("parseLecturasAguaPegadas", () => {
  it("lee una línea con las cuatro lecturas separadas por espacios", () => {
    const [fila] = parseLecturasAguaPegadas("2026-08-14  39265,5  3613,442  565279  1200");
    expect(fila.error).toBeNull();
    expect(fila.fecha).toBe("2026-08-14");
    expect(fila.lecturas).toEqual({
      "agua-contador-general": 39265.5,
      "agua-contador-tratamiento": 3613.442,
      "agua-contador-tratamiento-jabon": 565279,
      "agua-contador-drencher": 1200,
    });
  });

  it("acepta fecha española, tabuladores, punto y coma y la unidad escrita", () => {
    const filas = parseLecturasAguaPegadas("14/08/2026\t39265.5 m3;3613,442m3;565279 L");
    expect(filas).toHaveLength(1);
    expect(filas[0].error).toBeNull();
    expect(filas[0].fecha).toBe("2026-08-14");
    expect(filas[0].lecturas["agua-contador-general"]).toBe(39265.5);
    expect(filas[0].lecturas["agua-contador-tratamiento-jabon"]).toBe(565279);
  });

  it("deja vacío el contador marcado con guion y omite columnas de la derecha", () => {
    const [fila] = parseLecturasAguaPegadas("2026-08-14; 39265,5; -; 565279");
    expect(fila.error).toBeNull();
    expect(fila.lecturas["agua-contador-tratamiento"]).toBeUndefined();
    expect(fila.lecturas["agua-contador-tratamiento-jabon"]).toBe(565279);
    expect(fila.lecturas["agua-contador-drencher"]).toBeUndefined();
  });

  it("ignora líneas en blanco, comentarios y la cabecera", () => {
    const filas = parseLecturasAguaPegadas([
      "fecha  general  tratamiento",
      "# esto es un comentario",
      "",
      "2026-08-14  39265,5",
    ].join("\n"));
    expect(filas).toHaveLength(1);
    expect(filas[0].fecha).toBe("2026-08-14");
  });

  it("señala la línea y el motivo cuando la fecha o la lectura no valen", () => {
    const filas = parseLecturasAguaPegadas("no-es-fecha 123\n2026-08-14  treinta y nueve mil");
    expect(filas[0].linea).toBe(1);
    expect(filas[0].error).toMatch(/No se entiende la fecha/);
    expect(filas[1].linea).toBe(2);
    expect(filas[1].error).toMatch(/no numérica/);
  });

  it("rechaza fechas que no existen y columnas de sobra", () => {
    expect(parseLecturasAguaPegadas("31/02/2026 39265")[0].error).toMatch(/No se entiende la fecha/);
    expect(parseLecturasAguaPegadas("2026-08-14 1 2 3 4 5")[0].error).toMatch(/Sobran columnas/);
  });
});

describe("buildLecturasAguaBatch", () => {
  it("encadena los días de la tanda: cada consumo se calcula contra la línea anterior", () => {
    const plan = buildLecturasAguaBatch({
      texto: "2026-08-13  39259,5\n2026-08-14  39265,5",
      consumos: [lecturaGuardada("agua-contador-general", "2026-08-12", 39253.5, "m3")],
      hoy: HOY,
    });

    expect(plan.hayErrores).toBe(false);
    expect(plan.totalLecturas).toBe(2);
    expect(plan.dias[0].entradas[0].consumoL).toBe(6000);
    expect(plan.dias[1].entradas[0].lecturaAnterior).toBe(39259.5);
    expect(plan.dias[1].entradas[0].consumoL).toBe(6000);
    expect(plan.totalConsumoL).toBe(12000);
  });

  it("REGLA 1: el consumo se atribuye a los días anteriores a la foto, no a la foto", () => {
    const plan = buildLecturasAguaBatch({
      texto: "2026-08-14  39265,5",
      consumos: [lecturaGuardada("agua-contador-general", "2026-08-13", 39259.5, "m3")],
      hoy: HOY,
    });
    const [entrada] = plan.dias[0].entradas;
    expect(entrada.consumo.fecha_inicio).toBe("2026-08-13");
    expect(entrada.consumo.fecha_fin).toBe("2026-08-13");
  });

  it("la foto del lunes cubre el fin de semana completo", () => {
    const plan = buildLecturasAguaBatch({
      // 2026-08-10 es lunes; la foto anterior fue el viernes 2026-08-07.
      texto: "2026-08-10  39239,67",
      consumos: [lecturaGuardada("agua-contador-general", "2026-08-07", 39233.68, "m3")],
      hoy: HOY,
    });
    const [entrada] = plan.dias[0].entradas;
    expect(entrada.consumo.fecha_inicio).toBe("2026-08-07");
    expect(entrada.consumo.fecha_fin).toBe("2026-08-09");
  });

  it("enlaza con la lectura guardada más reciente aunque la tanda empiece antes", () => {
    // Fotos atrasadas: la línea del 06 no debe quedarse como referencia de la del 14.
    const plan = buildLecturasAguaBatch({
      texto: "2026-08-06  39228,64\n2026-08-14  39265,5",
      consumos: [
        lecturaGuardada("agua-contador-general", "2026-08-05", 39221.66, "m3"),
        lecturaGuardada("agua-contador-general", "2026-08-13", 39259.5, "m3"),
      ],
      hoy: HOY,
    });

    expect(plan.dias[0].entradas[0].lecturaAnterior).toBe(39221.66);
    expect(plan.dias[1].entradas[0].lecturaAnterior).toBe(39259.5);
    expect(plan.dias[1].entradas[0].consumoL).toBe(6000);
  });

  it("no deja retroceder un contador ni repetir la fecha de una foto", () => {
    const plan = buildLecturasAguaBatch({
      texto: "2026-08-13  39100\n2026-08-14  39265,5\n14/08/2026  39266",
      consumos: [lecturaGuardada("agua-contador-general", "2026-08-12", 39253.5, "m3")],
      hoy: HOY,
    });

    expect(plan.hayErrores).toBe(true);
    expect(plan.dias[0].errores[0]).toMatch(/no retrocede/);
    expect(plan.dias.find((dia) => dia.errores.some((e) => /misma fecha/.test(e)))).toBeTruthy();
  });

  it("rechaza fotos futuras", () => {
    const plan = buildLecturasAguaBatch({ texto: "2026-08-20  39300", consumos: [], hoy: HOY });
    expect(plan.dias[0].errores[0]).toMatch(/futura/);
    expect(plan.hayErrores).toBe(true);
  });

  it("REGLA 2: el desglose no puede igualar ni superar el consumo del general", () => {
    const plan = buildLecturasAguaBatch({
      texto: "2026-08-14  39260,5  3620  600000",
      consumos: [
        lecturaGuardada("agua-contador-general", "2026-08-13", 39259.5, "m3"),
        lecturaGuardada("agua-contador-tratamiento", "2026-08-13", 3611.804, "m3"),
        lecturaGuardada("agua-contador-tratamiento-jabon", "2026-08-13", 564682, "L"),
      ],
      hoy: HOY,
    });
    expect(plan.dias[0].errores[0]).toMatch(/desglose/i);
    expect(plan.hayErrores).toBe(true);
  });

  it("avisa y se salta la lectura que ya estaba guardada para esa foto", () => {
    const plan = buildLecturasAguaBatch({
      texto: "2026-08-14  39265,5  3613,442",
      consumos: [
        lecturaGuardada("agua-contador-general", "2026-08-13", 39259.5, "m3"),
        lecturaGuardada("agua-contador-general", "2026-08-14", 39265.5, "m3"),
        lecturaGuardada("agua-contador-tratamiento", "2026-08-13", 3611.804, "m3"),
      ],
      hoy: HOY,
    });

    expect(plan.dias[0].avisos[0]).toMatch(/ya había una lectura guardada/);
    expect(plan.dias[0].entradas).toHaveLength(1);
    expect(plan.dias[0].entradas[0].referencia).toBe("agua-contador-tratamiento");
    expect(plan.hayErrores).toBe(false);
  });

  it("la primera lectura de un contador queda de referencia inicial, sin consumo", () => {
    const plan = buildLecturasAguaBatch({ texto: "2026-08-13  -  3611,804", consumos: [], hoy: HOY });
    const [entrada] = plan.dias[0].entradas;
    expect(entrada.lecturaAnterior).toBeNull();
    expect(entrada.consumoL).toBe(0);
    expect(entrada.consumo.notas).toMatch(/sin referencia/);
  });
});

describe("fechasSinLecturaAgua", () => {
  it("lista los días laborables sin foto desde la última lectura guardada", () => {
    const pendientes = fechasSinLecturaAgua(
      [lecturaGuardada("agua-contador-general", "2026-08-11", 39245.5, "m3")],
      { hoy: "2026-08-14" },
    );
    expect(pendientes).toEqual(["2026-08-12", "2026-08-13", "2026-08-14"]);
  });

  it("no cuenta sábados ni domingos: la foto del lunes ya cubre el finde", () => {
    const pendientes = fechasSinLecturaAgua(
      // viernes 2026-08-07
      [lecturaGuardada("agua-contador-general", "2026-08-07", 39233.68, "m3")],
      { hoy: "2026-08-10" },
    );
    expect(pendientes).toEqual(["2026-08-10"]);
  });

  it("sin lecturas guardadas no inventa pendientes", () => {
    expect(fechasSinLecturaAgua([], { hoy: HOY })).toEqual([]);
  });
});
