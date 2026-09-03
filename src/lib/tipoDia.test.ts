// El análisis por tipo de día: régimen y calidad contra el listón del dueño,
// euros de venta SOLO con tarifa Mercadona real, días sin asistencia aparte,
// y medias por tipo sobre los días con dato.
import { describe, expect, it } from "vitest";
import {
  agregarDias,
  construirDiasTipo,
  filasPorDiaDesde,
  frutaPorLoteDesdeEntradas,
  preciosDelDia,
  presentesPorDiaDesde,
  resumenPorTipo,
  semanasPrecio,
} from "./tipoDia";

const SEMANAS = semanasPrecio([
  // A medio facturar: 0,40 €/kg → NO fija precio.
  { anio: 2026, semana: 29, metodos: [{ metodo: "MA3KGC", kilos: 100000, base_iva: 40000 }] },
  // Tarifa real.
  { anio: 2026, semana: 30, metodos: [{ metodo: "MA3KGC", kilos: 100000, base_iva: 102000 }, { metodo: "MA12KGC", kilos: 50000, base_iva: 45000 }] },
  // Sin base todavía.
  { anio: 2026, semana: 31, metodos: [{ metodo: "MA3KGC", kilos: 90000, base_iva: null }] },
]);

describe("semanasPrecio y preciosDelDia", () => {
  it("una semana es fiable desde 0,80 €/kg medio; sin base no fija precio", () => {
    expect(SEMANAS.map((s) => [s.semana, s.fiable])).toEqual([[29, false], [30, true], [31, false]]);
    expect(SEMANAS[1].eurKg).toBeCloseTo(0.98, 6);
    expect(SEMANAS[1].precios).toEqual({ mdna3: 1.02, mdnaGranel: 0.9 });
  });
  it("un día usa su semana fiable o la última fiable anterior; sin ninguna, MDNA a 0 y sin cuenta", () => {
    // 2026-07-20 es semana 30; 2026-07-29 es semana 31 (sin base) → cae a la 30; 2026-07-13 es semana 29 → nada antes.
    expect(preciosDelDia("2026-07-20", SEMANAS)).toMatchObject({ fiable: true, semana: { semana: 30 }, precios: { mdna3: 1.02, mdnaGranel: 0.9, mdna4: 0 } });
    expect(preciosDelDia("2026-07-29", SEMANAS).semana?.semana).toBe(30);
    const sin = preciosDelDia("2026-07-13", SEMANAS);
    expect(sin.fiable).toBe(false);
    expect(sin.precios.mdna3).toBe(0);
  });
});

describe("frutaPorLoteDesdeEntradas", () => {
  it("€/kg all-in por clave de 8 dígitos; importe 0 o nulo = sin liquidar (null, nunca 0)", () => {
    const m = frutaPorLoteDesdeEntradas([
      { lote: "26052001", kg_entrada: 10000, importe_total: 3000 },
      { lote: "26052002", kg_entrada: 5000, importe_total: 0 },
      { lote: "26052003 bis", kg_entrada: 5000, importe_total: null },
      { lote: "sin codigo", kg_entrada: 1, importe_total: 1 },
    ]);
    expect(m.get("26052001")).toEqual({ eurKg: 0.3 });
    expect(m.get("26052002")).toEqual({ eurKg: null });
    expect(m.get("26052003")).toEqual({ eurKg: null });
    expect(m.size).toBe(3);
  });
});

describe("construirDiasTipo", () => {
  const filas = filasPorDiaDesde([
    // Día 1 (semana 30, tarifa real): 40 presentes → completa. 80.000 kg → 2.000 kg/p → medio.
    { fecha: "2026-07-20", lote_codigo: "26052001", productor: "P", producto: "MDNA MALLA 3KG CAL 4/5", clase: "(A) Extra 1", peso_kg: 50000, toneladas_hora: null, duracion_min: 120 },
    { fecha: "2026-07-20", lote_codigo: "26052002", productor: "P", producto: "INDUSTRIA", clase: "(I) Industria", peso_kg: 30000, toneladas_hora: null, duracion_min: 60 },
    // Día 2 (semana 29, sin tarifa): 30 presentes → reducida. 84.000 kg → 2.800 kg/p → bueno. Sin euros de venta.
    { fecha: "2026-07-14", lote_codigo: "26052001", productor: "P", producto: "MDNA MALLA 3KG CAL 4/5", clase: "(A) Extra 1", peso_kg: 84000, toneladas_hora: null, duracion_min: 200 },
    // Día 3: sin asistencia en la base.
    { fecha: "2026-07-15", lote_codigo: "26052001", productor: "P", producto: "MDNA MALLA 3KG CAL 4/5", clase: "(A) Extra 1", peso_kg: 70000, toneladas_hora: null, duracion_min: 200 },
    // Día 4: arranque, 3.000 kg.
    { fecha: "2026-07-16", lote_codigo: "26052001", productor: "P", producto: "MDNA MALLA 3KG CAL 4/5", clase: "(A) Extra 1", peso_kg: 3000, toneladas_hora: null, duracion_min: 20 },
  ]);
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
  const presentes = presentesPorDiaDesde([
    ...ids(40).map((id) => ({ date: "2026-07-20", trabajador_id: id, presente: true })),
    { date: "2026-07-20", trabajador_id: "ausente", presente: false },
    ...ids(30).map((id) => ({ date: "2026-07-14", trabajador_id: id, presente: true })),
    ...ids(30).map((id) => ({ date: "2026-07-16", trabajador_id: id, presente: true })),
  ]);
  // Solo t0 tiene coste conocido (10 €/h); el resto al coste medio.
  const coste = new Map<string, number | null>([["t0", 10], ["t1", 0], ["t2", null]]);
  const fruta = frutaPorLoteDesdeEntradas([{ lote: "26052001", kg_entrada: 90000, importe_total: 27000 }]);
  const r = construirDiasTipo({ filasPorDia: filas, presentesPorDia: presentes, costeHoraPorTrabajador: coste, frutaPorLote: fruta, semanas: SEMANAS, opciones: { costeHoraMedio: 8, horasJornada: 7, suministrosDiaEur: 600 } });

  it("clasifica cada día por su régimen y su listón, y aparta los que no puede", () => {
    expect(r.dias.map((d) => d.fecha)).toEqual(["2026-07-14", "2026-07-20"]);
    expect(r.sinAsistencia).toEqual(["2026-07-15"]);
    expect(r.descartadosPorKg).toEqual([{ fecha: "2026-07-16", kg: 3000 }]);
    const d20 = r.dias[1];
    expect(d20).toMatchObject({ presentes: 40, kg: 80000, kgPersona: 2000, regimen: "completa", calidad: "medio", tipo: "Plantilla completa · día medio", conCuenta: true, semanaPrecio: { anio: 2026, semana: 30 } });
    // personal = (10 + 39 × 8) × 7
    expect(d20.personalEur).toBeCloseTo((10 + 39 * 8) * 7, 6);
    expect(d20.presentesSinCoste).toBe(39);
    expect(d20.ingresos).toBeGreaterThan(0);
    expect(d20.kgSinFruta).toBe(30000); // el lote 26052002 no está en báscula
  });

  it("sin tarifa real: estructura sí, euros de venta no", () => {
    const d14 = r.dias[0];
    expect(d14).toMatchObject({ presentes: 30, kgPersona: 2800, regimen: "reducida", calidad: "bueno", conCuenta: false, semanaPrecio: null, ingresos: null, margen: null, beneficio: null });
    expect(d14.personalEur).toBeGreaterThan(0);
  });

  it("las medias por tipo van sobre los días con dato y respetan el orden canónico", () => {
    const res = resumenPorTipo(r.dias);
    expect(res.map((f) => f.tipo)).toEqual(["Plantilla completa · día medio", "Plantilla reducida · día bueno"]);
    expect(res[1]).toMatchObject({ dias: 1, kg: 84000, presentes: 30, kgPersona: 2800, ingresos: null, diasConCuenta: 0 });
    const total = agregarDias("Todos", r.dias);
    expect(total.dias).toBe(2);
    expect(total.kg).toBe(82000);
    expect(total.ingresos).toBe(r.dias[1].ingresos); // la media ignora el día sin cuenta
    expect(total.personalKg).toBeCloseTo((total.personal ?? 0) / 82000, 9);
  });
});
