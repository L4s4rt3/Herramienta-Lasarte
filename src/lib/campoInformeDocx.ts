// Generador del "INFORME TECNICO DE CAMPO" en Word (.docx).
//
// EL ASPECTO es el del informe de la finca Ganchal (visita del 04-09-2026) que
// el dueño puso como modelo: sobrio, de consultora, sin barras de colores —
// justo lo contrario del informe de calidad de importación, que imita al perito
// holandés. Por eso NO reutiliza calidadImportDocx: mismo motor (docx), otra
// maqueta.
//
//   · PORTADA con el logo, "INFORME TECNICO DE CAMPO" en azul pequeño, el
//     nombre de la finca en grande y una rejilla de seis datos en dos columnas
//     (etiqueta pequeña en azul, valor en negrita).
//   · CABECERA DE PÁGINA "LASARTE | INFORME TECNICO DE CAMPO | FINCA X" con
//     filete, para que una hoja suelta se identifique sola.
//   · SECCIONES NUMERADAS en azul oscuro.
//   · RECUADRO DE CRITERIO con fondo gris y filete azul a la izquierda.
//   · TABLAS con cabecera azul marino y texto blanco, y fila de TOTAL/MEDIA
//     resaltada.
//   · PIES DE FIGURA en cursiva gris.
//
// LA REGLA QUE MANDA: solo se imprime lo que hay. Sin puntos de muestreo no
// sale la tabla de puntos ni el mapa; sin capturas de Aeroview no salen las
// figuras; sin historial no sale la sección de la finca. Las secciones que
// quedan se renumeran solas — igual que en el informe de calidad, y por la
// misma razón: un apartado vacío es peor que no tenerlo.
import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, PageNumber, Packer,
  Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from "docx";
import type { InformeCampo } from "@/lib/campoInforme";
import { etiquetaSemana, formatFechaLarga } from "@/lib/campoInforme";

// ─── Paleta y medidas ────────────────────────────────────────────────────────

const AZUL_TITULO = "1F3A5F";
const AZUL_ETIQUETA = "2E6DA4";
const AZUL_TABLA = "1F3864";
const GRIS_TEXTO = "3B4252";
const GRIS_SUAVE = "6B7280";
const GRIS_LINEA = "C9CDD6";
const GRIS_FILA = "F4F5F7";
const BEIGE_MEDIA = "F3EFE4";
const BLANCO = "FFFFFF";

const SZ_TITULO = 40;   // 20 pt
const SZ_SECCION = 26;  // 13 pt
const SZ_TEXTO = 20;    // 10 pt
const SZ_PEQUENO = 18;  // 9 pt
const SZ_MICRO = 14;    // 7 pt

const MARGEN = 907; // 16 mm
const ANCHO = 11906 - 2 * MARGEN;

const FILETE = { style: BorderStyle.SINGLE, size: 3, color: GRIS_LINEA } as const;
const SIN_BORDE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const BORDES_LIMPIOS = { top: SIN_BORDE, bottom: SIN_BORDE, left: SIN_BORDE, right: SIN_BORDE, insideHorizontal: SIN_BORDE, insideVertical: SIN_BORDE };

/** Imagen ya descargada del almacén, lista para incrustar. */
export interface ImagenBinaria {
  data: ArrayBuffer | Uint8Array;
  width: number;
  height: number;
  tipo: "jpg" | "png";
}

export interface ImagenDelInforme extends ImagenBinaria {
  id: string;
  clase: "estructura" | "mapa" | "modelizacion" | "punto" | "otra";
  punto_id: string | null;
  pie: string | null;
}

/** Lo único que este informe cambia de un texto a otro. */
interface EstiloTexto {
  size?: number;
  color?: string;
  bold?: boolean;
  italics?: boolean;
}

const run = (texto: string, opts: EstiloTexto = {}) =>
  new TextRun({
    text: texto,
    font: "Calibri",
    size: opts.size ?? SZ_TEXTO,
    color: opts.color ?? GRIS_TEXTO,
    bold: opts.bold,
    italics: opts.italics,
  });

const parrafo = (texto: string, opts: { after?: number; before?: number; size?: number; color?: string; bold?: boolean; italics?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({
    alignment: opts.align,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: 276 },
    children: [run(texto, { size: opts.size, color: opts.color, bold: opts.bold, italics: opts.italics })],
  });

const titulillo = (texto: string) =>
  new Paragraph({ spacing: { before: 240, after: 100 }, children: [run(texto, { size: SZ_SECCION, color: AZUL_TITULO, bold: true })] });

const pieFigura = (texto: string) =>
  new Paragraph({ spacing: { before: 60, after: 200 }, children: [run(texto, { size: SZ_MICRO, color: GRIS_SUAVE, italics: true })] });

const mm1 = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1).replace(".", ",")} mm`);
const kg0 = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString("es-ES")} kg`);
const pct1 = (parte: number, total: number) => (total > 0 ? `${((100 * parte) / total).toFixed(1).replace(".", ",")} %` : "—");

function imagenAjustada(img: ImagenBinaria, cajaAncho: number, cajaAlto: number): ImageRun {
  const escala = Math.min(cajaAncho / img.width, cajaAlto / img.height, 1);
  return new ImageRun({
    type: img.tipo,
    data: img.data,
    transformation: { width: Math.max(1, Math.round(img.width * escala)), height: Math.max(1, Math.round(img.height * escala)) },
  });
}

// ─── Piezas de maqueta ───────────────────────────────────────────────────────

/** Celda de la rejilla de la portada: etiqueta pequeña en azul y valor en negrita. */
function celdaDato(etiqueta: string, valor: string, ancho: number): TableCell {
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    borders: { top: SIN_BORDE, bottom: FILETE, left: SIN_BORDE, right: SIN_BORDE },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({ spacing: { after: 20 }, children: [run(etiqueta.toUpperCase(), { size: SZ_MICRO, color: AZUL_ETIQUETA, bold: true })] }),
      new Paragraph({ spacing: { after: 0 }, children: [run(valor || "—", { size: SZ_PEQUENO, bold: true })] }),
    ],
  });
}

/** La rejilla de seis datos de la portada, en dos columnas. */
function rejillaDatos(datos: Array<[string, string]>): Table {
  const mitad = Math.floor(ANCHO / 2);
  const filas: TableRow[] = [];
  for (let i = 0; i < datos.length; i += 2) {
    const izq = datos[i];
    const der = datos[i + 1] ?? ["", ""];
    filas.push(new TableRow({ children: [celdaDato(izq[0], izq[1], mitad), celdaDato(der[0], der[1], mitad)] }));
  }
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    // Sin columnWidths el visor de Word del móvil colapsa las columnas y el
    // texto sale en vertical, una letra por línea. Word de escritorio las
    // calcula solo y por eso no se veía en el ordenador.
    columnWidths: [mitad, mitad],
    layout: TableLayoutType.FIXED,
    borders: BORDES_LIMPIOS,
    rows: filas,
  });
}

/** Recuadro de criterio: fondo gris y filete azul a la izquierda. */
function recuadro(etiqueta: string, texto: string): Table {
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: [ANCHO],
    layout: TableLayoutType.FIXED,
    borders: BORDES_LIMPIOS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: ANCHO, type: WidthType.DXA },
            shading: { fill: GRIS_FILA },
            borders: { top: SIN_BORDE, bottom: SIN_BORDE, right: SIN_BORDE, left: { style: BorderStyle.SINGLE, size: 18, color: AZUL_ETIQUETA } },
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            children: [
              new Paragraph({ spacing: { after: 40 }, children: [run(etiqueta.toUpperCase(), { size: SZ_MICRO, color: AZUL_ETIQUETA, bold: true })] }),
              new Paragraph({ spacing: { after: 0, line: 276 }, children: [run(texto, { size: SZ_PEQUENO, bold: true, color: AZUL_TITULO })] }),
            ],
          }),
        ],
      }),
    ],
  });
}

interface OpcionesTabla {
  /** Anchos relativos de las columnas; si falta, se reparten iguales. */
  anchos?: number[];
  /** Índice de la fila que va resaltada (la de MEDIA o TOTAL). */
  destacada?: number;
  alinearDerecha?: number[];
  /** Columnas de texto largo: se leen mucho mejor pegadas a la izquierda. */
  alinearIzquierda?: number[];
}

/** Tabla con cabecera azul marino, filete fino y fila destacada opcional. */
function tabla(cabeceras: string[], filas: string[][], opts: OpcionesTabla = {}): Table {
  const n = cabeceras.length;
  const pesos = opts.anchos ?? Array(n).fill(1);
  const total = pesos.reduce((s, p) => s + p, 0);
  const anchos = pesos.map((p) => Math.floor((ANCHO * p) / total));
  const derecha = new Set(opts.alinearDerecha ?? []);
  const izquierda = new Set(opts.alinearIzquierda ?? []);
  const alineacion = (i: number) =>
    derecha.has(i) ? AlignmentType.RIGHT : izquierda.has(i) || i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER;

  const filaCabecera = new TableRow({
    tableHeader: true,
    children: cabeceras.map((c, i) => new TableCell({
      width: { size: anchos[i], type: WidthType.DXA },
      shading: { fill: AZUL_TABLA },
      borders: { top: SIN_BORDE, bottom: SIN_BORDE, left: SIN_BORDE, right: SIN_BORDE },
      margins: { top: 90, bottom: 90, left: 120, right: 120 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: alineacion(i),
        spacing: { after: 0 },
        children: [run(c.toUpperCase(), { size: SZ_MICRO, color: BLANCO, bold: true })],
      })],
    })),
  });

  const cuerpo = filas.map((fila, idx) => new TableRow({
    children: fila.map((celda, i) => new TableCell({
      width: { size: anchos[i], type: WidthType.DXA },
      shading: opts.destacada === idx ? { fill: BEIGE_MEDIA } : undefined,
      borders: { top: SIN_BORDE, bottom: FILETE, left: SIN_BORDE, right: SIN_BORDE },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: alineacion(i),
        spacing: { after: 0 },
        children: [run(celda, { size: SZ_PEQUENO, bold: opts.destacada === idx })],
      })],
    })),
  }));

  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: anchos,
    layout: TableLayoutType.FIXED,
    borders: BORDES_LIMPIOS,
    rows: [filaCabecera, ...cuerpo],
  });
}

/** Ficha fotográfica de un punto: código, milímetros, semana, coordenadas y foto. */
function fichaPunto(codigo: string, mm: number, semana: string | null, coords: string | null, foto: ImagenBinaria | undefined, ancho: number): TableCell {
  const hijos: Paragraph[] = [
    new Paragraph({
      spacing: { after: 40 },
      children: [run(`${codigo}  |  ${mm.toFixed(1).replace(".", ",")} mm`, { size: SZ_PEQUENO, bold: true, color: AZUL_TITULO })],
    }),
    new Paragraph({ spacing: { after: 20 }, children: [run(etiquetaSemana(semana), { size: SZ_MICRO, color: GRIS_SUAVE })] }),
  ];
  if (coords) hijos.push(new Paragraph({ spacing: { after: 80 }, children: [run(coords, { size: SZ_MICRO, color: GRIS_SUAVE })] }));
  if (foto) hijos.push(new Paragraph({ spacing: { after: 0 }, children: [imagenAjustada(foto, 215, 260)] }));

  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    borders: { top: SIN_BORDE, bottom: SIN_BORDE, left: SIN_BORDE, right: SIN_BORDE },
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    verticalAlign: VerticalAlign.TOP,
    children: hijos,
  });
}

// ─── El documento ────────────────────────────────────────────────────────────

export interface OpcionesInformeDocx {
  logo?: ImagenBinaria | null;
  imagenes?: ImagenDelInforme[];
}

/**
 * Monta el documento. `imagenes` son las capturas ya descargadas del almacén;
 * las que falten simplemente no salen, y su sección tampoco si se queda vacía.
 */
export function construirInformeCampoDocx(informe: InformeCampo, opts: OpcionesInformeDocx = {}): Document {
  const imagenes = opts.imagenes ?? [];
  const de = (clase: ImagenDelInforme["clase"]) => imagenes.filter((i) => i.clase === clase);
  const hijos: Array<Paragraph | Table> = [];

  // ── Portada ──
  if (opts.logo) {
    hijos.push(new Paragraph({ spacing: { after: 160 }, children: [imagenAjustada(opts.logo, 150, 56)] }));
  }
  hijos.push(new Paragraph({ spacing: { after: 40 }, children: [run("INFORME TECNICO DE CAMPO", { size: SZ_MICRO + 2, color: AZUL_ETIQUETA, bold: true })] }));
  hijos.push(new Paragraph({ spacing: { after: 60 }, children: [run(`Finca ${informe.ficha.finca}`, { size: SZ_TITULO, color: AZUL_TITULO, bold: true })] }));
  // El subtítulo dice la verdad: sin fecha de visita no hubo visita presencial,
  // y un informe no puede empezar diciendo que sí (Sonsailla, 17-09-2026).
  hijos.push(parrafo(
    informe.fechaVisita ? "Visita presencial, muestreo y seguimiento de calibre" : "Muestreo y seguimiento de calibre",
    { size: SZ_PEQUENO, color: GRIS_SUAVE, after: 240 },
  ));

  const nPuntos = informe.puntos.puntos.length;
  const muestreo = nPuntos > 0
    ? `${nPuntos} ${nPuntos === 1 ? "punto" : "puntos"} · ${etiquetaSemana(informe.puntos.semana)}`
    : informe.ultimaMedida ? `Sin muestreo de campo · ${etiquetaSemana(informe.ultimaMedida.semana)}` : "Sin muestreo";
  hijos.push(rejillaDatos([
    ["Fecha de visita", informe.fechaVisita ? formatFechaLarga(informe.fechaVisita) : "Seguimiento sin visita"],
    ["Personal de campo", informe.personal ?? "—"],
    ["Muestreo", muestreo],
    ["Apoyo técnico", informe.apoyoTecnico],
    ["Objetivo operativo", `${informe.objetivoMm} mm${informe.objetivoNota ? ` (${informe.objetivoNota})` : ""}`],
    ["Horizonte de valoración", informe.horizonte ? `A partir de la ${etiquetaSemana(informe.horizonte).toLowerCase()}` : "Por determinar"],
    ["Finca", informe.ficha.finca + (informe.ficha.hectareas ? ` · ${informe.ficha.hectareas.toFixed(1).replace(".", ",")} ha` : "")],
    ["Entidad", informe.entidad],
  ]));

  // ── Antecedentes ──
  hijos.push(titulillo("Antecedentes"));
  hijos.push(parrafo(informe.textos.antecedentes));

  let n = 0;
  const seccion = (titulo: string) => titulillo(`${++n}. ${titulo}`);
  // Las tablas también se numeran solas: si una sección no sale (no hay
  // previsión, no hay historial), la siguiente tabla no puede llamarse "Tabla 4"
  // detrás de la "Tabla 2".
  let nTabla = 0;
  const pieTabla = (texto: string) => parrafo(`Tabla ${++nTabla}. ${texto}`, { size: SZ_MICRO, color: GRIS_SUAVE, italics: true, after: 160 });

  // ── Objeto y contexto ──
  hijos.push(seccion("Objeto y contexto de la visita"));
  hijos.push(parrafo(informe.textos.contexto));
  hijos.push(recuadro("Criterio de seguimiento", informe.textos.criterio));
  hijos.push(parrafo("", { after: 120 }));

  // ── Trabajo de campo ──
  const actuaciones: string[][] = [];
  if (informe.fechaVisita) actuaciones.push(["01", "Comprobación presencial", "Revisión directa de la situación de la fruta en la finca."]);
  if (nPuntos > 0) actuaciones.push([String(actuaciones.length + 1).padStart(2, "0"), "Muestreo", `Selección de ${nPuntos} ${nPuntos === 1 ? "punto representativo" : "puntos representativos"}.`]);
  if (informe.puntos.puntos.some((p) => p.lat != null && p.lon != null)) {
    actuaciones.push([String(actuaciones.length + 1).padStart(2, "0"), "Georreferenciación", "Registro de coordenadas para cada punto."]);
  }
  if (informe.calibre.puntos.length > 0 || imagenes.length > 0) {
    actuaciones.push([String(actuaciones.length + 1).padStart(2, "0"), informe.apoyoTecnico, "Fotografías, estructura de tamaño y modelización de evolución."]);
  }
  if (actuaciones.length > 0) {
    hijos.push(seccion("Trabajo de campo realizado"));
    hijos.push(parrafo(
      nPuntos > 0
        ? "Durante la visita se seleccionaron los puntos de muestreo distribuidos por la finca. En cada punto se registró la referencia de calibre y su posición geográfica."
        : "Seguimiento realizado con los datos de calibre disponibles para la finca.",
    ));
    hijos.push(tabla(["N.º", "Actuación", "Evidencia obtenida"], actuaciones, { anchos: [1, 2, 4], alinearIzquierda: [1, 2] }));
    hijos.push(parrafo("", { after: 120 }));
  }

  // ── Resultados de calibre ──
  if (nPuntos > 0 || informe.ultimaMedida) {
    hijos.push(seccion(`Resultados de calibre · ${etiquetaSemana(informe.puntos.semana ?? informe.ultimaMedida?.semana ?? null)}`));
    if (nPuntos > 0 && informe.puntos.media != null) {
      const intro = `Los ${nPuntos} puntos presentan calibres medios comprendidos entre ${mm1(informe.puntos.minimo)} y ${mm1(informe.puntos.maximo)}. ` +
        `La media aritmética simple es ${mm1(informe.puntos.media)}.` +
        (informe.ultimaMedida ? ` De forma independiente, el panel de ${informe.apoyoTecnico} muestra un tamaño medio de fruta de ${mm1(informe.ultimaMedida.mm)} en ${etiquetaSemana(informe.ultimaMedida.semana).toLowerCase()}.` : "");
      hijos.push(parrafo(intro));
      const filas = informe.puntos.puntos.map((p) => [
        p.codigo,
        mm1(p.mm),
        `${(p.mm - informe.objetivoMm) >= 0 ? "+" : "−"}${Math.abs(p.mm - informe.objetivoMm).toFixed(1).replace(".", ",")} mm`,
        p.lat != null && p.lon != null ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : "—",
      ]);
      filas.push([
        "MEDIA",
        mm1(informe.puntos.media),
        `${(informe.puntos.difObjetivo ?? 0) >= 0 ? "+" : "−"}${Math.abs(informe.puntos.difObjetivo ?? 0).toFixed(1).replace(".", ",")} mm`,
        `Media simple de ${informe.puntos.puntos[0].codigo}-${informe.puntos.puntos.at(-1)!.codigo}`,
      ]);
      hijos.push(tabla(["Punto", "Calibre medio", `Dif. vs ${informe.objetivoMm} mm`, "Coordenadas"], filas, { anchos: [1, 1.2, 1.2, 2], destacada: filas.length - 1 }));
      hijos.push(pieTabla(`Resultados de los puntos de muestreo. ${etiquetaSemana(informe.puntos.semana)}.`));
    } else if (informe.ultimaMedida) {
      hijos.push(parrafo(
        `No se registraron puntos de muestreo. La última medida disponible de ${informe.apoyoTecnico} para la finca es de ${mm1(informe.ultimaMedida.mm)} en ${etiquetaSemana(informe.ultimaMedida.semana).toLowerCase()}, ` +
        `frente al objetivo de ${informe.objetivoMm} mm.`,
      ));
    }

    const estructura = de("estructura")[0];
    if (estructura) {
      hijos.push(new Paragraph({ spacing: { before: 60, after: 60 }, children: [run("Estructura de tamaño", { size: SZ_PEQUENO + 2, bold: true, color: AZUL_TITULO })] }));
      hijos.push(new Paragraph({ spacing: { after: 0 }, children: [imagenAjustada(estructura, 470, 260)] }));
      hijos.push(pieFigura(estructura.pie ?? `Figura 1. Estructura de tamaño mostrada por ${informe.apoyoTecnico}.`));
    }
  }

  // ── Mapa ──
  const mapa = de("mapa")[0];
  if (mapa) {
    hijos.push(seccion("Mapa de muestreo"));
    hijos.push(parrafo("Los puntos se distribuyeron en distintas zonas de la finca para disponer de referencias espaciales diferenciadas. El mapa permite relacionar cada lectura de calibre con su posición y con la ficha fotográfica correspondiente."));
    hijos.push(new Paragraph({ spacing: { after: 0 }, children: [imagenAjustada(mapa, 470, 520)] }));
    hijos.push(pieFigura(mapa.pie ?? "Figura 2. Mapa general de los puntos de muestreo."));
  }

  // ── Evolución y previsión ──
  if (informe.calibre.puntos.length > 0) {
    hijos.push(seccion("Evolución y previsión operativa del calibre"));
    hijos.push(parrafo(informe.textos.criterio));

    const medidas = informe.calibre.puntos.filter((p) => p.medido != null);
    const previstas = informe.calibre.puntos.filter((p) => p.medido == null && p.previsto != null);
    if (medidas.length > 0) {
      hijos.push(tabla(
        ["Semana", "Medido", "Previsto en su día", "Dif. vs objetivo"],
        medidas.map((p) => {
          const acierto = informe.calibre.aciertos.find((a) => a.semana === p.semana);
          return [
            etiquetaSemana(p.semana),
            mm1(p.medido),
            acierto ? mm1(acierto.previsto) : "—",
            `${(p.medido! - informe.objetivoMm) >= 0 ? "+" : "−"}${Math.abs(p.medido! - informe.objetivoMm).toFixed(1).replace(".", ",")} mm`,
          ];
        }),
        { anchos: [1.4, 1, 1.4, 1.2] },
      ));
      hijos.push(pieTabla("Calibre medido por semana. Cuando existe, se pone al lado lo que se había previsto para esa misma semana."));
    }
    if (previstas.length > 0) {
      hijos.push(tabla(
        ["Semana", "Previsión", "Dif. vs objetivo"],
        previstas.map((p) => [
          etiquetaSemana(p.semana),
          mm1(p.previsto),
          `${(p.previsto! - informe.objetivoMm) >= 0 ? "+" : "−"}${Math.abs(p.previsto! - informe.objetivoMm).toFixed(1).replace(".", ",")} mm`,
        ]),
        { anchos: [1.4, 1, 1.2], destacada: informe.objetivo?.tipo === "prevision" ? previstas.findIndex((p) => p.semana === informe.objetivo!.semana) : undefined },
      ));
      hijos.push(pieTabla("Previsión de calibre. La estimación numérica del modelo está pendiente de validación durante la campaña."));
    }

    const modelizacion = de("modelizacion")[0];
    if (modelizacion) {
      hijos.push(new Paragraph({ spacing: { after: 0 }, children: [imagenAjustada(modelizacion, 470, 260)] }));
      hijos.push(pieFigura(modelizacion.pie ?? `Figura 3. Salida de modelización de ${informe.apoyoTecnico}. La cifra numérica no se considera una previsión validada.`));
    }
  }

  // ── Lo que ha dado la finca ──
  const h = informe.historial;
  if (h.campanas.length > 0) {
    hijos.push(seccion("Lo que ha dado la finca"));
    hijos.push(parrafo(
      `Entregas registradas en la báscula y destino de la fruta según el calibrador. Los kilos de entrada y los del calibrador no coinciden a propósito: ` +
      `el calibrador arrastra la tara del box, por eso los destinos se dan en porcentaje sobre lo calibrado.`,
    ));
    hijos.push(tabla(
      ["Campaña", "Entradas", "Kg de báscula", "Variedades"],
      h.campanas.map((c) => [c.campana, String(c.entradas), kg0(c.kgEntrada), c.variedades.slice(0, 2).join(", ") || "—"]),
      { anchos: [1, 0.8, 1.2, 2.5], alinearDerecha: [2], alinearIzquierda: [3] },
    ));
    hijos.push(pieTabla("Entregas por campaña, según la báscula."));

    const d = h.destino;
    if (d && d.kgCalibrados > 0) {
      // Dos tablas y no una: la clasificación de la máquina y el destino de
      // venta son dos lecturas de los MISMOS kilos. Cada una suma el total por
      // su cuenta; juntas darían más del 100 %.
      hijos.push(tabla(
        ["Cómo la clasificó el calibrador", "Kg", "% de lo calibrado"],
        [
          ["Exportación", kg0(d.exportacion), pct1(d.exportacion, d.kgCalibrados)],
          ["No exportación (Cat. 2, Cat. 3, verde)", kg0(d.noExportacion), pct1(d.noExportacion, d.kgCalibrados)],
          ["Repaso de mesa", kg0(d.mujeres), pct1(d.mujeres, d.kgCalibrados)],
          ["No comercial (industria y podrido)", kg0(d.noComercial), pct1(d.noComercial, d.kgCalibrados)],
          ["TOTAL CALIBRADO", kg0(d.kgCalibrados), "100 %"],
        ],
        { anchos: [2.5, 1.2, 1.2], alinearDerecha: [1, 2], destacada: 4 },
      ));
      hijos.push(pieTabla("Calidad de la fruta según la clasificación del calibrador."));

      hijos.push(tabla(
        ["Dónde acabó la fruta", "Kg", "% de lo calibrado"],
        [
          ["Confección para Mercadona", kg0(d.mercadona), pct1(d.mercadona, d.kgCalibrados)],
          ["Otros clientes (marca, granel, segunda)", kg0(d.otrosClientes), pct1(d.otrosClientes, d.kgCalibrados)],
          ["Industria", kg0(d.industria), pct1(d.industria, d.kgCalibrados)],
          ["Precalibrado (vuelve a línea otro día)", kg0(d.precalibrado), pct1(d.precalibrado, d.kgCalibrados)],
          ["Podrido", kg0(d.podrido), pct1(d.podrido, d.kgCalibrados)],
          ["TOTAL CALIBRADO", kg0(d.kgCalibrados), "100 %"],
        ],
        { anchos: [2.5, 1.2, 1.2], alinearDerecha: [1, 2], destacada: 5 },
      ));
      const aviso = h.lotesSinCalibrador > 0
        ? ` ${h.lotesSinCalibrador} de los ${h.lotesTotal} lotes de la finca no tienen clasificación del calibrador y no están en estas tablas.`
        : "";
      hijos.push(pieTabla(
        `Destino comercial de la misma fruta. Las dos tablas miran los mismos kilos de distinta manera: una naranja de clase Extra apilada en el box de industria cuenta en “exportación” arriba y en “industria” aquí.${aviso}`,
      ));
    }
  }

  // ── Registro fotográfico ──
  const fotosPunto = de("punto");
  if (fotosPunto.length > 0) {
    hijos.push(seccion(`Registro fotográfico · ${informe.apoyoTecnico}`));
    hijos.push(parrafo("Fichas de los puntos de muestreo, con semana, geolocalización y evidencia fotográfica."));
    const mitad = Math.floor(ANCHO / 2);
    const puntos = informe.puntos.puntos;
    for (let i = 0; i < puntos.length; i += 2) {
      const par = [puntos[i], puntos[i + 1]].filter(Boolean);
      const celdas = par.map((p) => fichaPunto(
        p.codigo, p.mm, p.semana,
        p.lat != null && p.lon != null ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : null,
        fotosPunto.find((f) => f.punto_id === p.id),
        mitad,
      ));
      if (celdas.length === 1) celdas.push(new TableCell({ width: { size: mitad, type: WidthType.DXA }, borders: BORDES_LIMPIOS, children: [parrafo("")] }));
      hijos.push(new Table({
        width: { size: ANCHO, type: WidthType.DXA },
        columnWidths: [mitad, mitad],
        layout: TableLayoutType.FIXED,
        borders: BORDES_LIMPIOS,
        rows: [new TableRow({ children: celdas })],
      }));
    }
    hijos.push(pieFigura("Fichas fotográficas de los puntos de muestreo."));
  }

  // ── Otras imágenes ──
  for (const otra of de("otra")) {
    hijos.push(new Paragraph({ spacing: { before: 120, after: 0 }, children: [imagenAjustada(otra, 470, 300)] }));
    hijos.push(pieFigura(otra.pie ?? "Imagen adjunta al informe."));
  }

  // ── Conclusión ──
  hijos.push(seccion("Conclusión"));
  hijos.push(parrafo(informe.textos.conclusion));
  if (informe.avisoCurva) hijos.push(parrafo(informe.avisoCurva, { size: SZ_PEQUENO, color: GRIS_SUAVE, italics: true }));

  const pieVisita = informe.fechaVisita
    ? `Visita ${informe.fechaVisita.split("-").reverse().join("/")}`
    : "Seguimiento de gabinete";

  return new Document({
    creator: informe.entidad,
    title: `Informe técnico de campo · ${informe.ficha.finca}`,
    description: "Visita presencial, muestreo y seguimiento de calibre",
    styles: { default: { document: { run: { font: "Calibri", size: SZ_TEXTO, color: GRIS_TEXTO } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, right: MARGEN, bottom: 1000, left: MARGEN } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            spacing: { after: 60 },
            border: { bottom: FILETE },
            children: [run(`LASARTE | INFORME TECNICO DE CAMPO | FINCA ${informe.ficha.finca.toUpperCase()}`, { size: SZ_MICRO, color: AZUL_ETIQUETA, bold: true })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            border: { top: FILETE },
            spacing: { before: 60 },
            children: [
              run(`${informe.entidad.toUpperCase()} | Seguimiento de calibre | ${pieVisita}`, { size: SZ_MICRO, color: GRIS_SUAVE }),
              new TextRun({ children: ["\t", PageNumber.CURRENT], font: "Calibri", size: SZ_MICRO, color: GRIS_SUAVE }),
            ],
          })],
        }),
      },
      children: hijos,
    }],
  });
}

/** El .docx listo para descargar. */
export async function informeCampoDocxBlob(informe: InformeCampo, opts: OpcionesInformeDocx = {}): Promise<Blob> {
  return Packer.toBlob(construirInformeCampoDocx(informe, opts));
}

/** Nombre del fichero: "Informe_campo_Ganchal_2026-09-04.docx". */
export function nombreInformeCampo(informe: InformeCampo): string {
  const finca = informe.ficha.finca.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const fecha = informe.fechaVisita ?? new Date().toISOString().slice(0, 10);
  return `Informe_campo_${finca}_${fecha}.docx`;
}
