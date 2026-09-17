// El documento, por dentro.
//
// LO QUE SE COMPRUEBA AQUÍ es lo que se rompió en el móvil (17-09-2026): el
// informe de Los Pajares salía con el texto en VERTICAL, una letra por línea,
// porque las tablas no declaraban la rejilla de columnas. Word de escritorio la
// calcula solo —por eso en el ordenador se veía bien— pero el visor del móvil
// no, y colapsa cada columna a un carácter.
//
// Regla que sale de ahí: TODA tabla lleva su `columnWidths`. Este test lo mira
// en el XML de verdad, no en el código.
import { Packer } from "docx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { armarInformeCampo, type EntradaInformeCampo } from "./campoInforme";
import { construirInformeCampoDocx, nombreInformeCampo } from "./campoInformeDocx";
import type { CampoParcelaRow, MedidaCalibre } from "./campoParcelas";

const parcela: CampoParcelaRow = {
  id: "p1", origen: "aerobotics", origen_finca_id: "1", origen_finca_nombre: "LOS PAJARES",
  nombre: "LOS PAJARES", hectareas: 12.5, cultivo: "Orange", variedad: "Salustiana",
  plantacion: null, patron: null, contorno: [], centro_lon: -5.55, centro_lat: 37.66,
  finca: "Los Pajares", parcela: null, emparejado_estado: "clara", emparejado_puntuacion: 1, emparejado_nota: null,
};

const medida = (semana: string, mm: number, tipo: "medida" | "prevision" = "medida"): MedidaCalibre => ({
  id: `${semana}-${tipo}`, finca_nombre: "LOS PAJARES", bloque: "LOS PAJARES", variedad: "Salustiana",
  semana, mm, tipo, mm_previsto: null, previsto_en: null, parcela_id: "p1",
});

const entrada: EntradaInformeCampo = {
  informe: {
    id: "i1", finca: "Los Pajares", fecha_visita: "2026-09-17", personal: "Luis Navas",
    apoyo_tecnico: "Aerobotics", semana_muestreo: "2026W38", objetivo_mm: 64, objetivo_nota: "Cítrica",
    horizonte_semana: null, antecedentes: null, contexto: null, conclusion: null, estado: "borrador",
  },
  parcelas: [parcela],
  medidas: [medida("2026W36", 59.4), medida("2026W38", 61.2), medida("2026W49", 64.8, "prevision")],
  curvas: [],
  puntos: [
    { id: "P1", codigo: "P1", mm: 61.6, lat: 37.66587, lon: -5.55323, semana: "2026W38", nota: null, orden: 1 },
    { id: "P2", codigo: "P2", mm: 60.9, lat: 37.66568, lon: -5.55311, semana: "2026W38", nota: null, orden: 2 },
    { id: "P3", codigo: "P3", mm: 58.3, lat: null, lon: null, semana: "2026W38", nota: null, orden: 3 },
  ],
  imagenes: [],
  entradas: [
    { finca: "Los Pajares", lote: "26011501", fecha: "2026-01-15", articulo: "NARANJA SALUSTIANA", kg_entrada: 24000 },
  ],
  clasif: [
    { lote_codigo_base: "26011501", grupo_destino: "EXPORTACION", clase: "Cat1 A", producto: "MDNA 5 KG D-PACK", peso_kg: 18000 },
    { lote_codigo_base: "26011501", grupo_destino: "NO COMERCIAL", clase: "Industria", producto: "INDUSTRIA PARA GARCIA CARRION", peso_kg: 4000 },
    { lote_codigo_base: "26011501", grupo_destino: "NO COMERCIAL", clase: "Podrido", producto: "PODRIDO", peso_kg: 1000 },
  ],
};

/** El .docx es un zip: para mirar el XML de verdad hay que abrirlo. */
async function xmlDelInforme(): Promise<string> {
  const armado = armarInformeCampo(entrada);
  const buffer = await Packer.toBuffer(construirInformeCampoDocx(armado));
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

describe("el .docx del informe de campo", () => {
  it("TODA tabla declara su rejilla de columnas (si no, el móvil lo pone en vertical)", async () => {
    const xml = await xmlDelInforme();
    const tablas = xml.match(/<w:tbl>/g)?.length ?? 0;
    const rejillas = xml.match(/<w:tblGrid>/g)?.length ?? 0;
    expect(tablas).toBeGreaterThan(3);
    expect(rejillas).toBe(tablas);
    // Y las columnas tienen ancho de verdad, no cero.
    for (const [, ancho] of xml.matchAll(/<w:gridCol w:w="(\d+)"/g)) {
      expect(Number(ancho)).toBeGreaterThan(200);
    }
  });

  it("las tablas van a lo ancho de la caja de texto, con reparto fijo", async () => {
    const xml = await xmlDelInforme();
    const fijas = xml.match(/<w:tblLayout w:type="fixed"/g)?.length ?? 0;
    const tablas = xml.match(/<w:tbl>/g)?.length ?? 0;
    expect(fijas).toBe(tablas);
  });

  it("lleva lo que el informe promete: portada, puntos, evolución y lo que dio la finca", async () => {
    const xml = await xmlDelInforme();
    expect(xml).toContain("INFORME TECNICO DE CAMPO");
    expect(xml).toContain("Finca Los Pajares");
    expect(xml).toContain("Lasarte Cítricos S.L.");
    expect(xml).toContain("puntos de muestreo"); // la sección 3 y su tabla
    expect(xml).toContain("Lo que ha dado la finca");
    expect(xml).toContain("Conclusión");
  });

  it("las secciones y las tablas se numeran solas, sin huecos", async () => {
    const xml = await xmlDelInforme();
    // Sin capturas de Aeroview no hay sección de mapa: la numeración no salta.
    const numeros = [...xml.matchAll(/>(\d)\. (Objeto|Trabajo|Resultados|Mapa|Evolución|Lo que|Registro|Conclusión)/g)]
      .map((m) => Number(m[1]));
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
    expect(new Set(numeros).size).toBe(numeros.length);

    const tablas = [...xml.matchAll(/>Tabla (\d)\./g)].map((m) => Number(m[1]));
    expect(tablas).toEqual(tablas.map((_, i) => i + 1));
  });

  it("sin visita, el informe NO dice 'Visita presencial' en el subtítulo", async () => {
    const conVisita = await xmlDelInforme();
    expect(conVisita).toContain("Visita presencial, muestreo y seguimiento de calibre");

    const sinVisita = armarInformeCampo({
      ...entrada,
      informe: { ...entrada.informe, fecha_visita: null, personal: null },
    });
    const zip = await JSZip.loadAsync(await Packer.toBuffer(construirInformeCampoDocx(sinVisita)));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Muestreo y seguimiento de calibre");
    expect(xml).not.toContain("Visita presencial");
    expect(xml).toContain("Seguimiento sin visita");
  });

  it("un punto sin coordenadas sale con raya, no con 'undefined'", async () => {
    const xml = await xmlDelInforme();
    expect(xml).not.toContain("undefined");
    expect(xml).not.toContain("NaN");
  });

  it("el nombre del fichero lleva finca y fecha, sin acentos ni espacios", () => {
    const armado = armarInformeCampo(entrada);
    expect(nombreInformeCampo(armado)).toBe("Informe_campo_Los_Pajares_2026-09-17.docx");
  });
});
