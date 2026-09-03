import { describe, expect, it } from "vitest";
import {
  estadoSecciones,
  indiceMadurez,
  nombreDescargaFoto,
  nombreInformeCalidadImport,
  parseNumeroFlexible,
  pctsDefectosTexto,
  pctZumo,
  rowToControl,
  tiposDefectosTexto,
  unirValores,
  type CalidadImportControl,
} from "./calidadImport";

// Control base con todo vacío, para construir casos por encima.
function controlVacio(): CalidadImportControl {
  return {
    id: "c1",
    user_id: "u1",
    fecha: "2026-08-27",
    fecha_descarga: null,
    estado: "borrador",
    referencia: "",
    nuestra_ref: "",
    proveedor: "",
    barco: "",
    marca: "",
    num_contenedor: "",
    kg_total: "",
    puc_orchard: "",
    ggn: "",
    tipo_producto: "",
    tipo_confeccion: "",
    origen: "",
    calibre: "",
    etiquetado: "",
    tratamientos: "",
    clasificacion: "",
    temperatura: "",
    paletizacion: "",
    peso_medio_cajas: "",
    sticker: "",
    papel: "",
    muestreo_no_evolutivos: "",
    defectos_leves: [],
    defectos_graves: [],
    obs_no_evolutivos: "",
    muestreo_evolutivos: "",
    defectos_evolutivos: [],
    obs_evolutivos: "",
    muestras_internas: [],
    obs_calidad_interna: "",
    evaluador: "",
    firma_path: null,
    conclusion: "",
    created_at: "",
    updated_at: "",
  };
}

describe("parseNumeroFlexible", () => {
  it("acepta punto, coma y espacios", () => {
    expect(parseNumeroFlexible("12.2")).toBe(12.2);
    expect(parseNumeroFlexible("12,2")).toBe(12.2);
    expect(parseNumeroFlexible(" 948 ")).toBe(948);
  });

  it("devuelve null para vacío o texto", () => {
    expect(parseNumeroFlexible("")).toBeNull();
    expect(parseNumeroFlexible("n/a")).toBeNull();
  });
});

describe("derivados de calidad interna (valores de los informes reales)", () => {
  // CAT 1 muestra 1: 402 g de zumo sobre 948 g de fruta.
  it("pctZumo calcula a 1 decimal", () => {
    expect(pctZumo({ peso_fruta: "948", peso_zumo: "402" })).toBe("42.4");
    expect(pctZumo({ peso_fruta: "1032", peso_zumo: "420" })).toBe("40.7"); // CAT 2
  });

  it("pctZumo vacío sin datos o con fruta 0", () => {
    expect(pctZumo({ peso_fruta: "", peso_zumo: "402" })).toBe("");
    expect(pctZumo({ peso_fruta: "0", peso_zumo: "402" })).toBe("");
  });

  it("indiceMadurez = brix/acidez a 1 decimal", () => {
    expect(indiceMadurez({ brix: "12.2", acidez: "0.97" })).toBe("12.6"); // CAT 1
    expect(indiceMadurez({ brix: "11.3", acidez: "1.08" })).toBe("10.5"); // CAT 2
  });

  it("indiceMadurez vacío con acidez 0 o sin datos", () => {
    expect(indiceMadurez({ brix: "12.2", acidez: "0" })).toBe("");
    expect(indiceMadurez({ brix: "", acidez: "1" })).toBe("");
  });

  it("acepta decimales con coma (teclado español)", () => {
    expect(indiceMadurez({ brix: "12,2", acidez: "0,97" })).toBe("12.6");
  });
});

describe("textos combinados del informe", () => {
  it("unirValores junta con / saltando vacíos", () => {
    expect(unirValores(["948", "1264"])).toBe("948/1264");
    expect(unirValores(["948", "", " "])).toBe("948");
    expect(unirValores([])).toBe("");
  });

  it("tipos y pcts en paralelo, con guion para el % vacío", () => {
    const defectos = [
      { tipo: "RAMEADO", pct: "4" },
      { tipo: "CICATRIZ", pct: "1" },
      { tipo: "", pct: "9" }, // sin tipo no cuenta
      { tipo: "TRIP", pct: "" },
    ];
    expect(tiposDefectosTexto(defectos)).toBe("RAMEADO / CICATRIZ / TRIP");
    expect(pctsDefectosTexto(defectos)).toBe("4 / 1 / -");
  });
});

describe("nombreInformeCalidadImport", () => {
  it("replica el patrón de los Word que circulaban", () => {
    expect(
      nombreInformeCalidadImport({ referencia: "1184057", nuestra_ref: "26082701", clasificacion: "CAT 1" }),
    ).toBe("CONTROL CALIDAD 1184057-26082701 CAT 1.docx");
  });

  it("aguanta partes vacías y caracteres prohibidos", () => {
    expect(nombreInformeCalidadImport({ referencia: "", nuestra_ref: "26082701", clasificacion: "" })).toBe(
      "CONTROL CALIDAD 26082701.docx",
    );
    expect(nombreInformeCalidadImport({ referencia: "A/B", nuestra_ref: "", clasificacion: "CAT 2" })).toBe(
      "CONTROL CALIDAD A-B CAT 2.docx",
    );
  });
});

describe("nombreDescargaFoto", () => {
  it("conserva la base del nombre y corrige la extensión al tipo real", () => {
    // El iPhone la llama IMG_1234.HEIC pero lo guardado es el JPEG comprimido.
    expect(nombreDescargaFoto({ file_name: "IMG_1234.HEIC", file_path: "u/c/x.jpg", mime_type: "image/jpeg", orden: 0 })).toBe("IMG_1234.jpg");
    expect(nombreDescargaFoto({ file_name: "firma.png", file_path: "u/c/f.png", mime_type: "image/png", orden: 0 })).toBe("firma.png");
  });

  it("sin nombre usa el orden, sin mime cae a la extensión del path", () => {
    expect(nombreDescargaFoto({ file_name: "", file_path: "u/c/x.jpg", mime_type: null, orden: 2 })).toBe("foto-3.jpg");
  });

  it("limpia caracteres prohibidos del nombre", () => {
    expect(nombreDescargaFoto({ file_name: "lote 4/56: caja.jpg", file_path: "u/c/x.jpg", mime_type: "image/jpeg", orden: 0 })).toBe("lote 4-56- caja.jpg");
  });
});

describe("rowToControl", () => {
  it("valida el JSONB: arrays bien formados pasan, basura se descarta", () => {
    const fila = {
      ...controlVacio(),
      estado: "completado",
      defectos_leves: [{ tipo: "RAMEADO", pct: "4" }, "basura", null, { otro: 1 }],
      defectos_graves: null,
      defectos_evolutivos: [{ tipo: "PODRIDO", pct: 0.5 }],
      muestras_internas: [{ peso_fruta: 948, peso_zumo: "402", brix: "12.2", acidez: "0.97" }],
    } as unknown as Parameters<typeof rowToControl>[0];

    const control = rowToControl(fila);
    expect(control.estado).toBe("completado");
    expect(control.defectos_leves).toEqual([
      { tipo: "RAMEADO", pct: "4" },
      { tipo: "", pct: "" }, // el objeto sin tipo/pct queda vacío pero no revienta
    ]);
    expect(control.defectos_graves).toEqual([]);
    expect(control.defectos_evolutivos).toEqual([{ tipo: "PODRIDO", pct: "0.5" }]);
    expect(control.muestras_internas).toEqual([
      { peso_fruta: "948", peso_zumo: "402", brix: "12.2", acidez: "0.97" },
    ]);
  });

  it("un estado desconocido cae a borrador", () => {
    const fila = { ...controlVacio(), estado: "loquesea" } as unknown as Parameters<typeof rowToControl>[0];
    expect(rowToControl(fila).estado).toBe("borrador");
  });
});

describe("estadoSecciones", () => {
  it("marca completas solo las secciones con contenido", () => {
    const control = {
      ...controlVacio(),
      referencia: "1184057",
      muestras_internas: [{ peso_fruta: "948", peso_zumo: "", brix: "", acidez: "" }],
      evaluador: "Raquel Rubio Martín",
    };
    const secciones = estadoSecciones(control, 0);
    expect(secciones.map((s) => s.completa)).toEqual([true, false, false, false, true, false, true]);
  });

  it("las fotos completan la sección 6", () => {
    const secciones = estadoSecciones(controlVacio(), 3);
    expect(secciones[5].completa).toBe(true);
  });

  it("las observaciones de calidad interna también completan la sección 5", () => {
    const control = { ...controlVacio(), obs_calidad_interna: "ASPECTO GRANULADO" };
    expect(estadoSecciones(control, 0)[4].completa).toBe(true);
  });
});
