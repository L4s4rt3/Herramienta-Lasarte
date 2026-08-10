// Tests de la lib pura del informe semanal automático (contenido pedido por
// el dueño el 10-08-2026: kg producidos, podrido, trabajadores, kg por
// trabajador y zona, podrido por productor y finca). El módulo vive en
// supabase/functions/_shared/informeSemanal.ts (lo importa la edge function
// informe-semanal); aquí se prueba con vitest, patrón fotoLotesCoherencia.
import { describe, expect, it } from "vitest";
import {
  asuntoInformeSemanal,
  computeInformeSemanal,
  etiquetaDia,
  etiquetaRango,
  fechasSemanaIso,
  renderInformeSemanalHtml,
  renderInformeSemanalTexto,
  semanaIsoAnterior,
  semanaIsoDe,
  type DiaInformeSemanal,
  type OpcionesInformeSemanal,
} from "../../supabase/functions/_shared/informeSemanal.ts";
import {
  computeRentabilidadDia,
  PRECIOS_RENTABILIDAD_DEFECTO,
  type FilaClasifRentabilidad,
} from "@/lib/rentabilidadDia";

const OPCIONES_SEMANA: OpcionesInformeSemanal = {
  anio: 2026,
  semana: 32,
  fincaPorLote: new Map([["26080301", "LA HOYA"]]),
};

/** Día realista en miniatura: un lote MDNA granel con algo de podrido. */
function diaConProduccion(fecha: string, opts?: {
  presentes?: number;
  lotesSinEntrada?: string[];
  presentesPorZona?: Record<string, number>;
}): DiaInformeSemanal {
  const filas: FilaClasifRentabilidad[] = [
    { lote_codigo: "26080301", productor: "AGRO SUR", producto: "MDNA GRANEL CAL 3/4", clase: "(A) Extra 1", peso_kg: 8000, toneladas_hora: 10, duracion_min: 60 },
    { lote_codigo: "26080301", productor: "AGRO SUR", producto: "INDUSTRIA", clase: "(H) Industria", peso_kg: 1500, toneladas_hora: null, duracion_min: 60 },
    { lote_codigo: "26080301", productor: "AGRO SUR", producto: "INDUSTRIA", clase: "(J) Podrido", peso_kg: 500, toneladas_hora: null, duracion_min: 60 },
  ];
  const presentes = opts?.presentes ?? 20;
  const rentabilidad = computeRentabilidadDia(
    filas,
    new Map(),
    { presentes, sumaCosteHoraConocida: 0, presentesSinCoste: 0 },
    { precios: PRECIOS_RENTABILIDAD_DEFECTO, horasJornada: 0, suministrosDiaEur: 0, costeHoraMedio: 0 },
  );
  return {
    fecha,
    rentabilidad,
    presentes,
    presentesPorZona: opts?.presentesPorZona ?? (presentes > 0 ? { Envasado: presentes - 5, Línea: 5 } : {}),
    lotesSinEntrada: opts?.lotesSinEntrada ?? [],
    kgEntradaBascula: 12000,
    numEntradasBascula: 2,
  };
}

function diaVacio(fecha: string, kgEntradaBascula = 0): DiaInformeSemanal {
  return {
    fecha,
    rentabilidad: null,
    presentes: 0,
    presentesPorZona: {},
    lotesSinEntrada: [],
    kgEntradaBascula,
    numEntradasBascula: kgEntradaBascula > 0 ? 1 : 0,
  };
}

describe("semanas ISO", () => {
  it("calcula la semana ISO de fechas reales de la campaña", () => {
    expect(semanaIsoDe("2026-08-03")).toEqual({ anio: 2026, semana: 32 });
    expect(semanaIsoDe("2026-08-09")).toEqual({ anio: 2026, semana: 32 });
    expect(semanaIsoDe("2026-07-27")).toEqual({ anio: 2026, semana: 31 });
  });

  it("maneja el cambio de año ISO (2026 tiene 53 semanas)", () => {
    expect(semanaIsoDe("2026-01-01")).toEqual({ anio: 2026, semana: 1 });
    expect(semanaIsoDe("2027-01-01")).toEqual({ anio: 2026, semana: 53 });
    expect(semanaIsoDe("2027-01-04")).toEqual({ anio: 2027, semana: 1 });
  });

  it("da las 7 fechas lunes→domingo de una semana", () => {
    const fechas = fechasSemanaIso(2026, 32);
    expect(fechas[0]).toBe("2026-08-03");
    expect(fechas[6]).toBe("2026-08-09");
    expect(fechas).toHaveLength(7);
  });

  it("la semana anterior a un martes de informe es la semana completa pasada", () => {
    expect(semanaIsoAnterior("2026-08-11")).toEqual({ anio: 2026, semana: 32 });
    expect(semanaIsoAnterior("2026-08-10")).toEqual({ anio: 2026, semana: 32 });
    expect(semanaIsoAnterior("2027-01-05")).toEqual({ anio: 2026, semana: 53 });
  });

  it("etiqueta días y rangos en español", () => {
    expect(etiquetaDia("2026-08-03")).toBe("lunes 03/08");
    expect(etiquetaRango("2026-08-03", "2026-08-09")).toBe("3–9 de agosto de 2026");
    expect(etiquetaRango("2026-08-31", "2026-09-06")).toBe("31 de agosto – 6 de septiembre de 2026");
  });
});

describe("computeInformeSemanal", () => {
  it("suma kg producidos, podrido e industria de los días con producción", () => {
    const inf = computeInformeSemanal(
      [diaConProduccion("2026-08-03"), diaConProduccion("2026-08-04"), diaVacio("2026-08-05"),
        diaVacio("2026-08-06"), diaVacio("2026-08-07"), diaVacio("2026-08-08"), diaVacio("2026-08-09")],
      OPCIONES_SEMANA,
    );

    expect(inf.diasConProduccion).toBe(2);
    expect(inf.kgTotal).toBe(20000);
    expect(inf.kgPodrido).toBe(1000);
    expect(inf.pctPodrido).toBeCloseTo(5, 3);
    expect(inf.kgIndustria).toBe(3000);
    expect(inf.pctIndustria).toBeCloseTo(15, 3);
    expect(inf.kgEntradaBascula).toBe(24000);
  });

  it("calcula trabajadores medios, kg por persona y presentes por zona", () => {
    const inf = computeInformeSemanal(
      [diaConProduccion("2026-08-03", { presentes: 20 }), diaConProduccion("2026-08-04", { presentes: 30 })],
      OPCIONES_SEMANA,
    );
    expect(inf.presentesMedios).toBeCloseTo(25, 6);
    // 20.000 kg entre 50 presentes-día = 400 kg por persona y día.
    expect(inf.kgPorPersonaDia).toBeCloseTo(400, 6);
    const envasado = inf.presentesPorZona.find((z) => z.zona === "Envasado");
    // (15 + 25) / 2 días con asistencia
    expect(envasado?.presentesMedios).toBeCloseTo(20, 6);
  });

  it("agrega el podrido por productor y finca (finca de báscula por clave de lote)", () => {
    const inf = computeInformeSemanal(
      [diaConProduccion("2026-08-03"), diaConProduccion("2026-08-04")],
      OPCIONES_SEMANA,
    );
    expect(inf.podridoPorProductor).toHaveLength(1);
    const p = inf.podridoPorProductor[0];
    expect(p.productor).toBe("AGRO SUR");
    expect(p.finca).toBe("LA HOYA");
    expect(p.kg).toBe(20000);
    expect(p.kgPodrido).toBe(1000);
    expect(p.pctPodrido).toBeCloseTo(5, 3);
    expect(p.pctIndustria).toBeCloseTo(15, 3);
  });

  it("avisa de la asistencia sin volcar y no inventa kg por persona", () => {
    const inf = computeInformeSemanal(
      [diaConProduccion("2026-08-03", { presentes: 0 }), diaConProduccion("2026-08-04", { presentes: 0 })],
      OPCIONES_SEMANA,
    );
    expect(inf.presentesMedios).toBeNull();
    expect(inf.kgPorPersonaDia).toBeNull();
    expect(inf.avisos.some((a) => a.includes("asistencia de la semana no está cargada"))).toBe(true);
  });

  it("avisa de báscula sin informe LOTE y de lotes calibrados sin entrada", () => {
    const inf = computeInformeSemanal(
      [diaConProduccion("2026-08-03", { lotesSinEntrada: ["26080399"] }), diaVacio("2026-08-04", 5000)],
      OPCIONES_SEMANA,
    );
    expect(inf.avisos.some((a) => a.includes("sin Informe LOTE"))).toBe(true);
    expect(inf.avisos.some((a) => a.includes("26080399"))).toBe(true);
  });

  it("una semana sin nada no inventa datos: aviso mayor y asunto sin datos", () => {
    const inf = computeInformeSemanal(
      fechasSemanaIso(2026, 32).map((f) => diaVacio(f)),
      OPCIONES_SEMANA,
    );
    expect(inf.diasConProduccion).toBe(0);
    expect(inf.kgTotal).toBe(0);
    expect(inf.pctPodrido).toBeNull();
    expect(inf.avisos.some((a) => a.includes("Ningún día"))).toBe(true);
    expect(asuntoInformeSemanal(inf)).toContain("sin datos de producción");
  });
});

describe("render del correo", () => {
  it("el HTML lleva las secciones pedidas y formato es-ES", () => {
    const inf = computeInformeSemanal(
      [diaConProduccion("2026-08-03"), diaConProduccion("2026-08-04", { presentes: 0 })],
      OPCIONES_SEMANA,
    );
    const html = renderInformeSemanalHtml(inf);
    expect(html).toContain("Semana 32/2026");
    expect(html).toContain("3–9 de agosto de 2026");
    expect(html).toContain("Kg producidos");
    expect(html).toContain("Podrido por productor y finca");
    expect(html).toContain("Trabajadores por zona");
    expect(html).toContain("Datos que faltan");
    expect(html).toContain("lunes 03/08");
    expect(html).toContain("20.000 kg"); // formato es-ES con punto de millar
  });

  it("escapa HTML en textos que vienen de datos (productor)", () => {
    const dia = diaConProduccion("2026-08-03");
    dia.rentabilidad!.lotes[0].productor = "<script>alert(1)</script>";
    const inf = computeInformeSemanal([dia], OPCIONES_SEMANA);
    const html = renderInformeSemanalHtml(inf);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("la versión texto lleva los mismos totales y el asunto los kg y el podrido", () => {
    const inf = computeInformeSemanal([diaConProduccion("2026-08-03")], OPCIONES_SEMANA);
    const texto = renderInformeSemanalTexto(inf);
    expect(texto).toContain("INFORME SEMANAL 32/2026");
    expect(texto).toContain("Kg producidos: 10.000 kg");
    expect(texto).toContain("AGRO SUR · LA HOYA");
    expect(asuntoInformeSemanal(inf)).toBe("Informe semanal 32/2026 — 10.000 kg · podrido 5,0 %");
  });
});
