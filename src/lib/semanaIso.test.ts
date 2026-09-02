// La implementación única de semana ISO. Los casos son los bordes de año, que
// es donde tres copias "iguales" podían dejar de serlo sin que nadie lo viera:
// deciden qué semana manda el correo del lunes y el de Mercadona.
import { describe, expect, it } from "vitest";
import {
  anioSemanaIso,
  claveSemanaIso,
  fechasSemanaIso,
  lunesDeSemanaIso,
  numeroSemanaIso,
  semanaIsoAnterior,
  semanaIsoDe,
} from "./semanaIso";
import { getIsoWeekNumber } from "./isoWeek";
import { semanaIsoDe as semanaIsoDeInforme } from "../../supabase/functions/_shared/informeSemanal.ts";
import { semanaIsoDe as semanaIsoDeVentas } from "../../supabase/functions/_shared/ventasMercadona.ts";

describe("semanaIsoDe", () => {
  it("el lunes 29-12-2025 es la semana 1 de 2026 (manda el jueves)", () => {
    expect(semanaIsoDe("2025-12-29")).toEqual({ anio: 2026, semana: 1 });
  });
  it("2026 tiene semana 53: del 28-12-2026 al 03-01-2027", () => {
    expect(semanaIsoDe("2026-12-28")).toEqual({ anio: 2026, semana: 53 });
    expect(semanaIsoDe("2027-01-03")).toEqual({ anio: 2026, semana: 53 });
    expect(semanaIsoDe("2027-01-04")).toEqual({ anio: 2027, semana: 1 });
  });
  it("el domingo cierra su semana, no abre la siguiente", () => {
    expect(semanaIsoDe("2026-08-30")).toEqual({ anio: 2026, semana: 35 });
    expect(semanaIsoDe("2026-08-31")).toEqual({ anio: 2026, semana: 36 });
  });
});

describe("fechasSemanaIso y lunesDeSemanaIso", () => {
  it("la semana 53 de 2026 va de lunes 28-12 a domingo 03-01", () => {
    const f = fechasSemanaIso(2026, 53);
    expect(f[0]).toBe("2026-12-28");
    expect(f[6]).toBe("2027-01-03");
  });
  it("la semana 1 de 2026 empieza el 29-12-2025", () => {
    expect(fechasSemanaIso(2026, 1)[0]).toBe("2025-12-29");
    expect(lunesDeSemanaIso("2026-01-01")).toBe("2025-12-29");
  });
  it("ida y vuelta: cualquier día de la semana devuelve las mismas 7 fechas", () => {
    for (const dia of ["2026-09-01", "2026-09-05", "2026-09-06"]) {
      const { anio, semana } = semanaIsoDe(dia);
      expect(fechasSemanaIso(anio, semana)).toContain(dia);
      expect(fechasSemanaIso(anio, semana)[0]).toBe(lunesDeSemanaIso(dia));
    }
  });
});

describe("semanaIsoAnterior (la que cubren los correos del lunes)", () => {
  it("un lunes cualquiera manda la semana que acaba de cerrar", () => {
    expect(semanaIsoAnterior("2026-08-31")).toEqual({ anio: 2026, semana: 35 });
  });
  it("en el borde de año la anterior a la semana 1 de 2027 es la 53 de 2026", () => {
    expect(semanaIsoAnterior("2027-01-04")).toEqual({ anio: 2026, semana: 53 });
  });
  it("y la anterior a la semana 1 de 2026 es la 52 de 2025", () => {
    expect(semanaIsoAnterior("2025-12-29")).toEqual({ anio: 2025, semana: 52 });
  });
});

describe("claveSemanaIso / numeroSemanaIso / anioSemanaIso", () => {
  it("clave con año ISO y dos dígitos", () => {
    expect(claveSemanaIso("2026-06-03")).toBe("2026-W23");
    expect(claveSemanaIso("2027-01-03")).toBe("2026-W53");
  });
  it("con un Date usa los componentes locales, no UTC", () => {
    const d = new Date(2026, 11, 28, 0, 30); // 28-12-2026 00:30 local
    expect(numeroSemanaIso(d)).toBe(53);
    expect(anioSemanaIso(d)).toBe(2026);
  });
});

describe("las antiguas copias son la misma función", () => {
  it("isoWeek.getIsoWeekNumber, informeSemanal y ventasMercadona coinciden en los bordes", () => {
    for (const dia of ["2025-12-29", "2026-01-01", "2026-12-28", "2027-01-03", "2027-01-04", "2026-08-30"]) {
      const ref = semanaIsoDe(dia);
      expect(semanaIsoDeInforme(dia)).toEqual(ref);
      expect(semanaIsoDeVentas(dia)).toEqual(ref);
      const [y, m, d] = dia.split("-").map(Number);
      expect(getIsoWeekNumber(new Date(y, m - 1, d))).toBe(ref.semana);
    }
  });
});
