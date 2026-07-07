import { describe, expect, it } from "vitest";
import {
  diasDevengados,
  diasDisfrutadosEnAnio,
  diasNaturalesPeriodo,
  saldoVacaciones,
  type PeriodoVacaciones,
} from "./rrhhVacaciones";

describe("rrhhVacaciones", () => {
  describe("diasDevengados", () => {
    it("devenga los 30 dias completos si el año natural transcurrio entero", () => {
      expect(diasDevengados({ fechaAlta: "2020-01-01", hasta: "2026-12-31" })).toBeCloseTo(30, 6);
    });

    it("prorratea por dias desde la fecha de alta a mitad de año", () => {
      // Alta el 1 de julio de 2026 (año de 365 dias): dias transcurridos
      // desde el 1-jul hasta el 31-dic, ambos inclusive.
      const devengados = diasDevengados({ fechaAlta: "2026-07-01", hasta: "2026-12-31" });
      const transcurridos = diasNaturalesPeriodo("2026-07-01", "2026-12-31");
      expect(transcurridos).toBe(184);
      expect(devengados).toBeCloseTo((184 * 30) / 365, 6);
    });

    it("devuelve 0 si la fecha de alta es futura respecto a 'hasta'", () => {
      expect(diasDevengados({ fechaAlta: "2027-01-01", hasta: "2026-12-31" })).toBe(0);
    });

    it("respeta diasAnuales personalizado (convenio distinto por persona)", () => {
      expect(diasDevengados({ fechaAlta: "2020-01-01", hasta: "2026-12-31", diasAnuales: 22 })).toBeCloseTo(22, 6);
    });

    it("usa 366 dias como base en año bisiesto", () => {
      const devengados = diasDevengados({ fechaAlta: "2024-01-01", hasta: "2024-12-31" });
      expect(devengados).toBeCloseTo(30, 6);

      // A mitad del año bisiesto (1 de julio a 31 de dic = 184 dias sobre 366).
      const mitad = diasDevengados({ fechaAlta: "2024-07-01", hasta: "2024-12-31" });
      const transcurridos = diasNaturalesPeriodo("2024-07-01", "2024-12-31");
      expect(mitad).toBeCloseTo((transcurridos * 30) / 366, 6);
    });

    it("sin fecha de alta (null) devenga desde el 1 de enero del año de 'hasta'", () => {
      const devengados = diasDevengados({ fechaAlta: null, hasta: "2026-06-30" });
      const transcurridos = diasNaturalesPeriodo("2026-01-01", "2026-06-30");
      expect(devengados).toBeCloseTo((transcurridos * 30) / 365, 6);
    });
  });

  describe("diasDisfrutadosEnAnio", () => {
    it("cuenta el periodo completo si cae dentro del año", () => {
      const periodos: PeriodoVacaciones[] = [
        { fecha_inicio: "2026-08-01", fecha_fin: "2026-08-15", dias_naturales: 15 },
      ];
      expect(diasDisfrutadosEnAnio(periodos, 2026)).toBe(15);
    });

    it("suma varios periodos dentro del mismo año", () => {
      const periodos: PeriodoVacaciones[] = [
        { fecha_inicio: "2026-01-05", fecha_fin: "2026-01-09", dias_naturales: 5 },
        { fecha_inicio: "2026-08-01", fecha_fin: "2026-08-10", dias_naturales: 10 },
      ];
      expect(diasDisfrutadosEnAnio(periodos, 2026)).toBe(15);
    });

    it("solo cuenta el solape real cuando el periodo cruza el 31 de diciembre", () => {
      const periodos: PeriodoVacaciones[] = [
        { fecha_inicio: "2026-12-28", fecha_fin: "2027-01-03", dias_naturales: 7 },
      ];
      // De 2026: 28,29,30,31 dic -> 4 dias. De 2027: 1,2,3 ene -> 3 dias.
      expect(diasDisfrutadosEnAnio(periodos, 2026)).toBe(4);
      expect(diasDisfrutadosEnAnio(periodos, 2027)).toBe(3);
    });

    it("ignora periodos que no solapan con el año consultado", () => {
      const periodos: PeriodoVacaciones[] = [
        { fecha_inicio: "2025-08-01", fecha_fin: "2025-08-10", dias_naturales: 10 },
      ];
      expect(diasDisfrutadosEnAnio(periodos, 2026)).toBe(0);
    });

    it("sin periodos, devuelve 0", () => {
      expect(diasDisfrutadosEnAnio([], 2026)).toBe(0);
    });
  });

  describe("saldoVacaciones", () => {
    it("calcula devengados, disfrutados y saldo (positivo)", () => {
      const periodos: PeriodoVacaciones[] = [
        { fecha_inicio: "2026-01-05", fecha_fin: "2026-01-09", dias_naturales: 5 },
      ];
      const resultado = saldoVacaciones({ fechaAlta: "2020-01-01", hasta: "2026-12-31" }, periodos);
      expect(resultado.devengados).toBeCloseTo(30, 6);
      expect(resultado.disfrutados).toBe(5);
      expect(resultado.saldo).toBeCloseTo(25, 6);
    });

    it("el saldo puede ser negativo si se disfruto mas de lo devengado a la fecha", () => {
      const periodos: PeriodoVacaciones[] = [
        { fecha_inicio: "2026-01-01", fecha_fin: "2026-01-31", dias_naturales: 31 },
      ];
      // A fecha 31-ene solo se han devengado ~2,5 dias (30/365*31).
      const resultado = saldoVacaciones({ fechaAlta: "2020-01-01", hasta: "2026-01-31" }, periodos);
      expect(resultado.disfrutados).toBe(31);
      expect(resultado.saldo).toBeLessThan(0);
    });
  });

  describe("diasNaturalesPeriodo", () => {
    it("un periodo de un solo dia (inicio == fin) cuenta como 1 dia", () => {
      expect(diasNaturalesPeriodo("2026-08-01", "2026-08-01")).toBe(1);
    });

    it("cuenta ambos extremos inclusive", () => {
      expect(diasNaturalesPeriodo("2026-08-01", "2026-08-07")).toBe(7);
    });
  });
});
