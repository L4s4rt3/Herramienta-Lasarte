import { describe, expect, it } from "vitest";
import { agregarPodridoBateas, costeMedioCompraFruta, type VaciadoBateaInput } from "./podridoBateas";

const VACIADOS: VaciadoBateaInput[] = [
  { date: "2026-07-10", kg_podrido_bateas: null }, // día sin vaciado
  { date: "2026-07-22", kg_podrido_bateas: 6000 },
  { date: "2026-07-29", kg_podrido_bateas: 6000 },
  { date: "2026-08-04", kg_podrido_bateas: null },
];

describe("costeMedioCompraFruta", () => {
  it("Σ importe / Σ kg", () => {
    expect(costeMedioCompraFruta(10702882, 22528467)).toBeCloseTo(0.4751, 4);
  });

  it("sin kg o sin importe es null, nunca 0 (un periodo sin importes cargados no vale 0 €/kg)", () => {
    expect(costeMedioCompraFruta(1000, 0)).toBeNull();
    expect(costeMedioCompraFruta(0, 1000)).toBeNull();
  });
});

describe("agregarPodridoBateas", () => {
  it("suma los vaciados del rango y los valora al coste medio", () => {
    const r = agregarPodridoBateas(VACIADOS, "2026-07-01", "2026-07-31", 0.4751);
    expect(r.kgTotal).toBe(12000);
    expect(r.nVaciados).toBe(2);
    expect(r.eur).toBeCloseTo(12000 * 0.4751);
  });

  it("acota a qué fechas pertenece de verdad el kg (primer y último vaciado)", () => {
    const r = agregarPodridoBateas(VACIADOS, "2026-07-01", "2026-07-31", 0.5);
    expect(r.primerVaciado).toBe("2026-07-22");
    expect(r.ultimoVaciado).toBe("2026-07-29");
  });

  it("los días sin vaciado (null) no cuentan como vaciados de 0 kg", () => {
    const r = agregarPodridoBateas(VACIADOS, "2026-08-01", "2026-08-31", 0.5);
    expect(r.nVaciados).toBe(0);
    expect(r.kgTotal).toBe(0);
    expect(r.primerVaciado).toBeNull();
    expect(r.eur).toBe(0);
  });

  it("sin coste medio conocido el € es null, no 0", () => {
    const r = agregarPodridoBateas(VACIADOS, "2026-07-01", "2026-07-31", null);
    expect(r.kgTotal).toBe(12000); // los kg sí se saben
    expect(r.eur).toBeNull();
    expect(r.costeMedioKg).toBeNull();
  });

  it("el rango filtra por la fecha de PESADA: un vaciado fuera no entra aunque su fruta sea del periodo", () => {
    // Caso real del encargo: la batea acumula varios días, así que un vaciado
    // del 22-jul lleva fruta de antes. El módulo no lo reparte — solo se
    // asegura de no contar un vaciado que cayó fuera del rango elegido.
    const r = agregarPodridoBateas(VACIADOS, "2026-07-23", "2026-07-31", 0.5);
    expect(r.nVaciados).toBe(1);
    expect(r.kgTotal).toBe(6000);
  });
});
