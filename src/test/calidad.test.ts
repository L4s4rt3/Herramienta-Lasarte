import { describe, expect, it } from "vitest";
import {
  buildCalidadAttachmentRows,
  buildCalidadComentarioSugerido,
  buildCalidadExcelRows,
  buildCalidadHistorico,
  buildCalidadIncidentRows,
  buildComentarioCalidad,
  buildLotesParaImportar,
  calidadSummary,
  esErrorProductorFincaFk,
  esIncidenciaCalidad,
  extractWordXmlText,
  formatCalidadDate,
  formatHoraCorta,
  formatKgCantidad,
  isoWeekKey,
  normalizeCalidadName,
  sameLoteCodigo,
  splitComentarioCalidad,
  sameCalidadName,
  type CalidadLote,
} from "@/lib/calidad";

function makeLote(overrides: Partial<CalidadLote>): CalidadLote {
  return {
    id: "",
    jornada_id: "j1",
    user_id: "u1",
    fecha: "2026-06-03",
    numero_lote: "",
    productor_finca_id: null,
    productor_finca_nombre: "",
    producto: "Naranja",
    variedad: "",
    cantidad: "",
    hora: null,
    aerobotics_realizado: false,
    calidad: "Bueno",
    defectos: [],
    defecto_otro: "",
    observacion: "",
    accion_recomendada: "",
    informe_estado: "borrador",
    informe_generado: "",
    ia_calidad: null,
    ia_defectos: [],
    ia_resumen: "",
    ia_accion_recomendada: "",
    validado_at: null,
    validado_by: null,
    reabierto_at: null,
    reabierto_by: null,
    motivo_reapertura: "",
    created_at: "2026-06-03T06:00:00Z",
    updated_at: "2026-06-03T06:00:00Z",
    ...overrides,
  };
}

const lotes: CalidadLote[] = [
  makeLote({
    id: "1",
    numero_lote: "26041704",
    productor_finca_nombre: "Los Corrales",
    variedad: "Navel Powell",
    cantidad: "64 Box",
    hora: "06:00",
    aerobotics_realizado: true,
    calidad: "Regular",
    defectos: ["Rameado"],
    observacion: "Entrada regular, revisar calibre.",
    accion_recomendada: "Separar para seguimiento.",
  }),
  makeLote({
    id: "2",
    numero_lote: "26041705",
    productor_finca_nombre: "La Torrecilla",
    variedad: "Navel Lane Late",
    cantidad: "42 Box",
    created_at: "2026-06-03T07:00:00Z",
    updated_at: "2026-06-03T07:00:00Z",
  }),
];

describe("esErrorProductorFincaFk", () => {
  it("recognizes the PostgREST FK error for productor_finca_id", () => {
    expect(
      esErrorProductorFincaFk({
        code: "23503",
        details: 'Key (productor_finca_id)=(eefc9fd9-bb71-4a40-a105-78a29f592db1) is not present in table "calidad_productores".',
        message: 'insert or update on table "calidad_lotes" violates foreign key constraint "calidad_lotes_productor_finca_id_fkey"',
      }),
    ).toBe(true);
  });

  it("rejects other errors, other constraints and non-objects", () => {
    expect(
      esErrorProductorFincaFk({
        code: "23503",
        message: 'insert or update on table "calidad_lotes" violates foreign key constraint "calidad_lotes_jornada_id_fkey"',
      }),
    ).toBe(false);
    expect(esErrorProductorFincaFk({ code: "23505", message: "calidad_lotes_productor_finca_id_fkey" })).toBe(false);
    expect(esErrorProductorFincaFk(new Error("network error"))).toBe(false);
    expect(esErrorProductorFincaFk(null)).toBe(false);
    expect(esErrorProductorFincaFk("error")).toBe(false);
  });
});

describe("calidad helpers", () => {
  it("summarizes daily lots by quality, aerobotics and attachments", () => {
    expect(calidadSummary(lotes, { "1": 2, "2": 0 })).toEqual({
      total: 2,
      aerobotics: 1,
      fotos: 2,
      byQuality: {
        Excelente: 0,
        Bueno: 1,
        Regular: 1,
        Deficiente: 0,
        Pésimo: 0,
      },
    });
  });

  it("builds one Excel row per lot with each field in its own column", () => {
    expect(buildCalidadExcelRows(lotes, { "1": 2 })[0]).toMatchObject({
      Fecha: "03 jun 2026",
      Lote: "26041704",
      "Productor/Finca": "Los Corrales",
      Producto: "Naranja",
      Variedad: "Navel Powell",
      Box: "64 Box",
      "Aerobotics realizado": "Si",
      Calidad: "Regular",
      Defectos: "Rameado",
      Fotos: 2,
    });
  });

  it("builds an incidents sheet with only lots that need follow up", () => {
    const rows = buildCalidadIncidentRows(lotes, { "1": 2, "2": 0 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Prioridad: "Seguimiento",
      Lote: "26041704",
      "Productor/Finca": "Los Corrales",
      Calidad: "Regular",
      Fotos: 2,
    });
  });

  it("builds attachment rows with lot traceability fields", () => {
    const rows = buildCalidadAttachmentRows(
      { id: "j1", fecha: "2026-06-03", responsable: "Eusebio", estado: "guardada" },
      lotes,
      [{ id: "a1", lote_id: "1", file_name: "foto.jpg", file_path: "u/calidad/foto.jpg", mime_type: "image/jpeg", file_size: 123 }],
    );

    expect(rows[0]).toMatchObject({
      Fecha: "03 jun 2026",
      Lote: "26041704",
      "Productor/Finca": "Los Corrales",
      Calidad: "Regular",
      Archivo: "foto.jpg",
    });
  });

  it("formats ISO dates for readable report titles", () => {
    expect(formatCalidadDate("2026-06-03")).toBe("03 jun 2026");
  });

  it("normalizes repeated producer/farm names", () => {
    expect(normalizeCalidadName("  Los   Corrales  ")).toBe("Los Corrales");
    expect(sameCalidadName("Los Corrales", "los corrales")).toBe(true);
  });

  it("extracts readable text from Word document XML", () => {
    const xml = `
      <w:document>
        <w:p><w:r><w:t>Observacion:</w:t></w:r><w:r><w:t> Entrada con calibre irregular</w:t></w:r></w:p>
        <w:p><w:r><w:t>Accion recomendada:</w:t></w:r><w:r><w:t> Revisar en linea</w:t></w:r></w:p>
      </w:document>
    `;

    expect(extractWordXmlText(xml)).toBe("Observacion: Entrada con calibre irregular\nAccion recomendada: Revisar en linea");
  });

  it("combines observation and recommended action into one editable comment", () => {
    expect(buildComentarioCalidad(lotes[0])).toBe(
      "Entrada regular, revisar calibre.\n\nAcción recomendada: Separar para seguimiento.",
    );
  });

  it("splits an editable combined comment back into stored fields", () => {
    expect(splitComentarioCalidad("Entrada con rameado.\nAccion recomendada: Separar 20 box para seguimiento.")).toEqual({
      observacion: "Entrada con rameado.",
      accion_recomendada: "Separar 20 box para seguimiento.",
    });
  });

  it("puts the lot identification in the first block and the analysis in the second (Regular + Rameado)", () => {
    const suggestion = buildCalidadComentarioSugerido(lotes[0], [lotes[1], { ...lotes[0], id: "3", fecha: "2026-05-27", calidad: "Deficiente" }], 2);
    const [ficha, analisis] = suggestion.split("\n\n");

    expect(ficha).toContain("Lote 26041704");
    expect(ficha).toContain("Los Corrales");
    expect(ficha).toContain("Naranja Navel Powell");
    expect(ficha).toContain("64 boxes");
    expect(ficha).toContain("06:00 h");
    expect(ficha).toContain("Aerobotics");
    expect(analisis).toContain("Calidad regular.");
    expect(analisis).toContain("Rameado");
    expect(suggestion).toContain("Acción recomendada:");
  });

  it("suggests 'sin defectos' narrative with a direct destino for a Bueno lot", () => {
    const suggestion = buildCalidadComentarioSugerido(makeLote({ calidad: "Bueno", defectos: [] }));

    expect(suggestion).toMatch(/defectos reseñables|defectos dignos de mención/);
    expect(suggestion).toContain("El lote mantiene su aptitud comercial.");
    expect(suggestion).toContain("Acción recomendada:");
    expect(suggestion).toContain("Mercadona");
  });

  it("suggests a reclassification destino with defect narrative for a Deficiente lot (Mancha + Calibre irregular)", () => {
    const suggestion = buildCalidadComentarioSugerido(makeLote({ calidad: "Deficiente", defectos: ["Mancha", "Calibre irregular"] }));

    expect(suggestion).toContain("Mancha y calibre irregular.");
    // La aptitud es frase aparte con "el lote" de sujeto: no hay que concordar
    // en número con la lista de defectos ("que afecta" / "que afectan").
    expect(suggestion).toContain("El lote pierde aptitud comercial: hay que reclasificar parte de la fruta.");
    expect(suggestion).not.toContain("que afecta");
    expect(suggestion).toContain("Acción recomendada:");
    expect(suggestion).toMatch(/segunda o industria/);
  });

  it("varies wording between different lots but stays deterministic for the same lot", () => {
    const lotA = makeLote({ id: "a1", numero_lote: "26041710", productor_finca_nombre: "Los Corrales", calidad: "Bueno" });
    const lotB = makeLote({ id: "b2", numero_lote: "26041711", productor_finca_nombre: "La Torrecilla", calidad: "Bueno" });

    expect(buildCalidadComentarioSugerido(lotA)).toBe(buildCalidadComentarioSugerido(lotA));
    expect(buildCalidadComentarioSugerido(lotA)).not.toBe(buildCalidadComentarioSugerido(lotB));
  });

  it("keeps the technician's own text and manual accion recomendada untouched", () => {
    const suggestion = buildCalidadComentarioSugerido(makeLote({
      calidad: "Bueno",
      observacion: "Mucho rameado en la cara norte del box.",
      accion_recomendada: "Avisar al productor antes del siguiente volcado.",
    }));

    // Su texto va literal y en su propio bloque, sin comillas ni preámbulo.
    expect(suggestion.split("\n\n")).toContain("Mucho rameado en la cara norte del box.");
    expect(suggestion).not.toContain("el técnico de calidad añade");
    expect(suggestion).toContain("Acción recomendada: Avisar al productor antes del siguiente volcado.");
    // la acción manual no se machaca con el destino estándar
    expect(suggestion).not.toContain("Sin medidas correctoras");
  });

  it("regenerating over an already generated comment keeps the note and the manual action (idempotent)", () => {
    const base = makeLote({ id: "regen", observacion: "Nota manual del técnico.", accion_recomendada: "Revisar en línea." });
    const primera = buildCalidadComentarioSugerido(base);
    const guardado = splitComentarioCalidad(primera);
    const segunda = buildCalidadComentarioSugerido({ ...base, ...guardado });

    expect(segunda).toBe(primera);
  });

  it("replaces a previously generated destino (not treated as manual) when regenerating", () => {
    const base = makeLote({ id: "regen-2", calidad: "Pésimo" });
    const primera = buildCalidadComentarioSugerido(base);
    const guardado = splitComentarioCalidad(primera);
    const segunda = buildCalidadComentarioSugerido({ ...base, ...guardado });

    expect(segunda).toBe(primera);
    expect(segunda).toContain("responsable de calidad");
  });
});

describe("importar lotes del parte", () => {
  it("formats kg as a thousands-separated quantity string", () => {
    expect(formatKgCantidad(20635)).toBe("20.635 kg");
    expect(formatKgCantidad(0)).toBe("");
    expect(formatKgCantidad(null)).toBe("");
  });

  it("shortens a timestamp or HH:mm:ss value to HH:mm", () => {
    expect(formatHoraCorta("2026-06-03T06:05:00")).toBe("06:05");
    expect(formatHoraCorta("6:05:00")).toBe("06:05");
    expect(formatHoraCorta(null)).toBeNull();
  });

  it("matches lote codes with trim + case-insensitive comparison", () => {
    expect(sameLoteCodigo("26041704", " 26041704 ")).toBe(true);
    expect(sameLoteCodigo("ABC123", "abc123")).toBe(true);
    expect(sameLoteCodigo("ABC123", "ABC124")).toBe(false);
    expect(sameLoteCodigo(null, "ABC123")).toBe(false);
  });

  it("builds one importable lot per lotes_dia row not already in the jornada", () => {
    const lotesDia = [
      { lote_codigo: "26041704", productor: "Los Corrales", producto: "Naranja", kg_peso_total: 20635, hora_inicio: "06:05:00" },
      { lote_codigo: "26041705", productor: "La Torrecilla", producto: "Naranja", kg_peso_total: 15000, hora_inicio: "07:00:00" },
      { lote_codigo: null, productor: "Sin codigo", producto: "Naranja", kg_peso_total: 500, hora_inicio: null },
    ];

    const result = buildLotesParaImportar(lotesDia, [{ numero_lote: "26041704" }]);

    expect(result).toEqual([
      { numero_lote: "26041705", productor_finca_nombre: "La Torrecilla", producto: "Naranja", cantidad: "15.000 kg", hora: "07:00" },
    ]);
  });

  it("skips duplicate lote_codigo values within the same import batch", () => {
    const lotesDia = [
      { lote_codigo: "26041706", productor: "Finca A", producto: "Naranja", kg_peso_total: 1000, hora_inicio: "08:00:00" },
      { lote_codigo: "26041706", productor: "Finca A", producto: "Naranja", kg_peso_total: 1000, hora_inicio: "08:00:00" },
    ];

    expect(buildLotesParaImportar(lotesDia, [])).toHaveLength(1);
  });
});

describe("historico de calidad", () => {
  it("groups lots by ISO week and quality state", () => {
    expect(isoWeekKey("2026-06-03")).toMatch(/^2026-W\d{2}$/);
  });

  it("flags a lot as an incidence when quality needs follow-up or has defects", () => {
    expect(esIncidenciaCalidad({ calidad: "Regular", defectos: [] })).toBe(true);
    expect(esIncidenciaCalidad({ calidad: "Bueno", defectos: ["Golpe"] })).toBe(true);
    expect(esIncidenciaCalidad({ calidad: "Excelente", defectos: [] })).toBe(false);
  });

  it("aggregates weeks, top defects and producer incident ranking", () => {
    const historico: CalidadLote[] = [
      lotes[0],
      { ...lotes[0], id: "3", numero_lote: "26041706", fecha: "2026-05-27", calidad: "Deficiente", defectos: ["Rameado", "Golpe"] },
      { ...lotes[1], id: "4", productor_finca_nombre: "Los Corrales", calidad: "Bueno", defectos: [] },
    ];

    const resumen = buildCalidadHistorico(historico);

    expect(resumen.semanas.length).toBeGreaterThan(0);
    expect(resumen.defectos[0]).toMatchObject({ defecto: "Rameado", count: 2 });
    expect(resumen.productores[0].productor).toBe("Los Corrales");
    expect(resumen.productores[0].incidencias).toBe(2);
  });
});
