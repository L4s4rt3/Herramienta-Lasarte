// @vitest-environment jsdom
// (necesita DOM: el proyecto "logica" de vitest corre src/lib en node)
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  fechaInformeTexto,
  generarInformeCalidadImportBlob,
  referenciaInformeTexto,
} from "./calidadImportDocx";
import type { CalidadImportControl } from "./calidadImport";

// El control del informe REAL "CONTROL CALIDAD 1184057-26082701 CAT 1" del
// 27-08-2026 (camión 1 de SAF): el test comprueba que el Word generado
// contiene lo mismo que el que hacía la evaluadora a mano.
const CONTROL_CAT1: CalidadImportControl = {
  id: "c1",
  user_id: "u1",
  fecha: "2026-08-27",
  fecha_descarga: null,
  estado: "completado",
  referencia: "1184057",
  nuestra_ref: "26082701",
  proveedor: "HARRIE GOESTEN",
  barco: "",
  marca: "PRIMORE/DSA",
  num_contenedor: "",
  kg_total: "23589",
  puc_orchard: "",
  ggn: "4059883430516/4050373064518",
  tipo_producto: "NARANJA MIDKNIGHT",
  tipo_confeccion: "ENCAJADO 15 KG CARTÓN TELESCÓPICO",
  origen: "SUDÁFRICA",
  calibre: "4/56-5/64-6/72",
  etiquetado: "OK",
  tratamientos: "IMAZALIL, CERAS E-903 E-904",
  clasificacion: "CAT 1",
  temperatura: "7",
  paletizacion: "80",
  peso_medio_cajas: "16.45",
  sticker: "NO",
  papel: "NO",
  muestreo_no_evolutivos: "(11-200)",
  defectos_leves: [
    { tipo: "RAMEADO", pct: "4" },
    { tipo: "CICATRIZ", pct: "1" },
  ],
  defectos_graves: [{ tipo: "DEFORMACIÓN", pct: "0.5" }],
  obs_no_evolutivos: "NARANJA PIEL LIMPIA Y SIN DAÑOS DESTACABLES.",
  muestreo_evolutivos: "(2-200)",
  defectos_evolutivos: [
    { tipo: "PODRIDO", pct: "0.5" },
    { tipo: "PINCHAZO", pct: "0.5" },
  ],
  obs_evolutivos: "",
  muestras_internas: [
    { peso_fruta: "948", peso_zumo: "402", brix: "12.2", acidez: "0.97" },
    { peso_fruta: "1264", peso_zumo: "510", brix: "10.4", acidez: "0.93" },
  ],
  obs_calidad_interna: "",
  evaluador: "Raquel Rubio Martín",
  firma_path: null,
  conclusion: "",
  created_at: "",
  updated_at: "",
};

// Bytes cualesquiera como "foto": docx no decodifica la imagen, solo la
// empaqueta en word/media con el tamaño que se le pasa.
const FOTO_FALSA = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), width: 1200, height: 900, tipo: "jpg" as const };

// El Blob de jsdom (v20) no tiene .arrayBuffer(); en navegador sí. FileReader
// funciona en los dos sitios.
function blobABytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function generarYExtraer(control: CalidadImportControl, fotos = [FOTO_FALSA]) {
  const blob = await generarInformeCalidadImportBlob(control, fotos, null, null);
  const zip = unzipSync(await blobABytes(blob));
  const texto = (nombre: string) => strFromU8(zip[nombre]);
  return { zip, texto };
}

describe("referenciaInformeTexto", () => {
  it("compone la referencia como el informe manual", () => {
    expect(referenciaInformeTexto({ referencia: "1184057", nuestra_ref: "26082701" })).toBe(
      "1184057 NUESTRA REF 26082701",
    );
    expect(referenciaInformeTexto({ referencia: "1184057", nuestra_ref: "" })).toBe("1184057");
    expect(referenciaInformeTexto({ referencia: "", nuestra_ref: "26082701" })).toBe("26082701");
  });
});

describe("fechaInformeTexto", () => {
  it("ISO → dd/mm/aaaa sin pasar por Date", () => {
    expect(fechaInformeTexto("2026-08-27")).toBe("27/08/2026");
    expect(fechaInformeTexto("texto raro")).toBe("texto raro");
  });
});

describe("generarInformeCalidadImportBlob", () => {
  it("el documento lleva las 7 secciones con los datos del control", async () => {
    const { texto } = await generarYExtraer(CONTROL_CAT1);
    const doc = texto("word/document.xml");

    // Títulos de sección
    for (const titulo of [
      "1. Información del producto",
      "2. Información general",
      "3. Defectos no evolutivos",
      "4. Defectos evolutivos",
      "5. Calidad interna",
      "6. Registro fotográfico",
      "7. Realiza",
    ]) {
      expect(doc).toContain(titulo);
    }

    // Sección 1 y 2: los valores tal cual
    expect(doc).toContain("1184057 NUESTRA REF 26082701");
    expect(doc).toContain("HARRIE GOESTEN");
    expect(doc).toContain("ENCAJADO 15 KG CARTÓN TELESCÓPICO");
    expect(doc).toContain("IMAZALIL, CERAS E-903 E-904");

    // Regla "solo lo rellenado": las filas vacías (Barco, Nº Contenedor,
    // PUC) no salen en el informe.
    expect(doc).not.toContain("Barco");
    expect(doc).not.toContain("Nº Contenedor");
    expect(doc).not.toContain("PUC / Orchard");

    // Sección 3 y 4: defectos apilados
    expect(doc).toContain("RAMEADO");
    expect(doc).toContain("DEFORMACIÓN");
    expect(doc).toContain("PODRIDO");
    expect(doc).toContain("(11-200)");

    // Sección 5: medidas unidas con "/" y derivados calculados
    expect(doc).toContain("948/1264");
    expect(doc).toContain("402/510");
    expect(doc).toContain("42.4/40.3"); // % zumo derivado
    expect(doc).toContain("12.6/11.2"); // índice de madurez derivado
    expect(doc).toContain("Ref. &gt;40/42%");

    // Sección 7
    expect(doc).toContain("Raquel Rubio Martín");
    expect(doc).toContain("27/08/2026");
  });

  it("la cabecera repite el título del reporte en todas las páginas", async () => {
    const { zip, texto } = await generarYExtraer(CONTROL_CAT1);
    const headerEntry = Object.keys(zip).find((n) => /word\/header\d*\.xml$/.test(n));
    expect(headerEntry).toBeDefined();
    expect(texto(headerEntry!)).toContain("REPORTE DE CALIDAD FRUTA IMPORTACIÓN");
  });

  it("las fotos van empaquetadas en word/media", async () => {
    const { zip } = await generarYExtraer(CONTROL_CAT1, [FOTO_FALSA, FOTO_FALSA]);
    const media = Object.keys(zip).filter((n) => n.startsWith("word/media/"));
    expect(media.length).toBe(2);
  });

  it("observaciones de calidad interna y conclusión (control 26083101 de Raquel)", async () => {
    const control: CalidadImportControl = {
      ...CONTROL_CAT1,
      referencia: "1184066",
      nuestra_ref: "26083101",
      obs_calidad_interna: "MARCA MALACHITE CAL 4/56 %ZUMO NO ACEPTABLE, ASPECTO INTERIOR GRANULADO",
      conclusion:
        "*Calibre 4/56 Marca Malachite presenta problemas internos, por los que estos 3 palets los consideramos no aptos según nuestras especificaciones organolépticas.\n% Zumo de 34.5 y aspecto granuloso.",
    };
    const { texto } = await generarYExtraer(control);
    const doc = texto("word/document.xml");
    expect(doc).toContain("ASPECTO INTERIOR GRANULADO");
    expect(doc).toContain("no aptos según nuestras especificaciones organolépticas");
    expect(doc).toContain("% Zumo de 34.5 y aspecto granuloso.");
    // La conclusión va DESPUÉS de la tabla de Realiza.
    expect(doc.indexOf("no aptos según")).toBeGreaterThan(doc.indexOf("Nombre del evaluador"));
  });

  it("sin observaciones internas ni conclusión, esas piezas no aparecen", async () => {
    const { texto } = await generarYExtraer(CONTROL_CAT1);
    const doc = texto("word/document.xml");
    // CAT1 solo escribió observaciones en la sección 3 (evolutivos vacía).
    expect(doc.match(/Observaciones/g)?.length).toBe(1);
  });

  it("la fecha de descarga del camión sale en la sección de producto", async () => {
    const { texto } = await generarYExtraer({ ...CONTROL_CAT1, fecha_descarga: "2026-08-26" });
    const doc = texto("word/document.xml");
    expect(doc).toContain("Fecha descarga camión");
    expect(doc).toContain("26/08/2026");
  });

  it("las secciones vacías desaparecen y las demás se renumeran de corrido", async () => {
    const soloProducto: CalidadImportControl = {
      ...CONTROL_CAT1,
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
      conclusion: "",
    };
    const { texto } = await generarYExtraer(soloProducto, []);
    const doc = texto("word/document.xml");
    expect(doc).toContain("1. Información del producto");
    // Sin general/defectos/interna/fotos: Realiza pasa a ser la sección 2.
    expect(doc).toContain("2. Realiza");
    expect(doc).not.toContain("Información general");
    expect(doc).not.toContain("Defectos no evolutivos");
    expect(doc).not.toContain("Registro fotográfico");
  });

  it("un control totalmente vacío se queda solo con Realiza (la fecha siempre existe)", async () => {
    const vacio: CalidadImportControl = {
      ...CONTROL_CAT1,
      referencia: "",
      nuestra_ref: "",
      proveedor: "",
      marca: "",
      kg_total: "",
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
      evaluador: "",
      conclusion: "",
    };
    const { texto } = await generarYExtraer(vacio, []);
    const doc = texto("word/document.xml");
    expect(doc).toContain("1. Realiza");
    expect(doc).toContain("27/08/2026");
    expect(doc).not.toContain("Información del producto");
  });
});
