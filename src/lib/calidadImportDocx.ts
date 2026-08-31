// Generador del "REPORTE DE CALIDAD FRUTA IMPORTACIÓN" en Word (.docx).
//
// Replica el formato del informe que calidad hacía a mano: cabecera con el
// logo en cada página, secciones en tablas con la columna de etiquetas
// sombreada (F2F2F2, Arial), rejilla de fotos a 3 columnas y firma. Las
// medidas (página carta, márgenes, anchos de columna) están sacadas del
// document.xml de un informe real para que el resultado sea indistinguible.
//
// Regla pedida por la evaluadora (31-08): el informe SOLO imprime lo que se
// rellenó. Las filas con valor vacío no salen, y una sección sin contenido
// desaparece entera (las restantes se renumeran de corrido).
import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  pctZumo,
  indiceMadurez,
  REF_ACIDEZ,
  REF_BRIX,
  REF_INDICE_MADUREZ,
  REF_PCT_ZUMO,
  unirValores,
  type CalidadImportControl,
  type DefectoImport,
} from "@/lib/calidadImport";

/** Imagen lista para incrustar: bytes + tamaño natural en píxeles. */
export interface ImagenInforme {
  data: ArrayBuffer | Uint8Array;
  width: number;
  height: number;
  tipo: "jpg" | "png";
}

const FUENTE = "Arial";
const SZ_TITULO = 28; // 14pt: los "1. Información del producto"
const SZ_CUERPO = 20; // 10pt: etiquetas y valores de las tablas
const SZ_PEQ = 16; //    8pt: tipos de defecto, porcentajes y observaciones
const SOMBREADO_ETIQUETA = "F2F2F2";

// Página carta con los márgenes del informe original (DXA).
const ANCHO_CONTENIDO = 8630;
const MITAD = ANCHO_CONTENIDO / 2; // 4315: columna de etiquetas al 50%
const CUARTO = MITAD / 2; // 2157(.5): subcolumnas tipo/% y valor/ref

const BORDE = { style: BorderStyle.SINGLE, size: 4, color: "auto" } as const;
const BORDES_TABLA = {
  top: BORDE,
  bottom: BORDE,
  left: BORDE,
  right: BORDE,
  insideHorizontal: BORDE,
  insideVertical: BORDE,
};
const MARGEN_CELDA = { top: 60, bottom: 60, left: 100, right: 100 };

function texto(contenido: string, opts?: { bold?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): Paragraph {
  return new Paragraph({
    alignment: opts?.align,
    spacing: { after: 0, line: 240 },
    children: [
      new TextRun({ text: contenido, font: FUENTE, size: opts?.size ?? SZ_CUERPO, bold: opts?.bold ?? false }),
    ],
  });
}

/** Varias líneas apiladas en una celda (los tipos de defecto y sus %). */
function lineas(valores: string[], opts?: { size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): Paragraph[] {
  const visibles = valores.length > 0 ? valores : [""];
  return visibles.map((v) => texto(v, { size: opts?.size ?? SZ_PEQ, align: opts?.align }));
}

function celdaEtiqueta(nombre: string, width = MITAD): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: SOMBREADO_ETIQUETA },
    margins: MARGEN_CELDA,
    verticalAlign: VerticalAlign.CENTER,
    children: [texto(nombre, { bold: true })],
  });
}

function celdaValor(children: Paragraph[], opts?: { width?: number; columnSpan?: number }): TableCell {
  return new TableCell({
    width: { size: opts?.width ?? MITAD, type: WidthType.DXA },
    margins: MARGEN_CELDA,
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: opts?.columnSpan,
    children,
  });
}

function filaEtiquetaValor(nombre: string, valor: string, span?: number): TableRow {
  return new TableRow({
    children: [celdaEtiqueta(nombre), celdaValor([texto(valor)], { columnSpan: span })],
  });
}

/** Fila solo si el valor tiene contenido: la regla "imprime lo rellenado". */
function filaSiHayValor(nombre: string, valor: string, span?: number): TableRow[] {
  return valor.trim() === "" ? [] : [filaEtiquetaValor(nombre, valor.trim(), span)];
}

function tabla(rows: TableRow[], columnWidths: number[]): Table {
  return new Table({
    columnWidths,
    width: { size: ANCHO_CONTENIDO, type: WidthType.DXA },
    borders: BORDES_TABLA,
    rows,
  });
}

function tituloSeccion(numero: number, nombre: string, primera: boolean): Paragraph {
  return new Paragraph({
    spacing: { before: primera ? 0 : 360, after: 240 },
    keepNext: true,
    children: [
      new TextRun({ text: `${numero}. ${nombre}`, font: FUENTE, size: SZ_TITULO, bold: true, color: "000000" }),
    ],
  });
}

/** "1184057 NUESTRA REF 26082701": cómo imprime el informe la referencia. */
export function referenciaInformeTexto(control: Pick<CalidadImportControl, "referencia" | "nuestra_ref">): string {
  const referencia = control.referencia.trim();
  const nuestra = control.nuestra_ref.trim();
  if (referencia && nuestra) return `${referencia} NUESTRA REF ${nuestra}`;
  return referencia || nuestra;
}

/** "2026-08-27" → "27/08/2026" (sin pasar por Date: nada de sorpresas de zona). */
export function fechaInformeTexto(fechaIso: string): string {
  const [y, m, d] = fechaIso.split("-");
  if (!y || !m || !d) return fechaIso;
  return `${d}/${m}/${y}`;
}

// ─── Secciones (cada una devuelve null si no tiene nada que imprimir) ────────

function seccionProducto(control: CalidadImportControl): Table | null {
  const filas = [
    ...filaSiHayValor("Referencia", referenciaInformeTexto(control)),
    ...filaSiHayValor("Fecha descarga camión", control.fecha_descarga ? fechaInformeTexto(control.fecha_descarga) : ""),
    ...filaSiHayValor("Proveedor", control.proveedor),
    ...filaSiHayValor("Barco", control.barco),
    ...filaSiHayValor("Marca", control.marca),
    ...filaSiHayValor("Nº Contenedor", control.num_contenedor),
    ...filaSiHayValor("Kg total contenedor", control.kg_total),
    ...filaSiHayValor("PUC / Orchard (campo)", control.puc_orchard),
    ...filaSiHayValor("GGN", control.ggn),
    ...filaSiHayValor("Tipo de producto", control.tipo_producto),
    ...filaSiHayValor("Tipo confección", control.tipo_confeccion),
    ...filaSiHayValor("Origen", control.origen),
    ...filaSiHayValor("Calibre", control.calibre),
  ];
  return filas.length > 0 ? tabla(filas, [MITAD, MITAD]) : null;
}

function seccionGeneral(control: CalidadImportControl): Table | null {
  const filas = [
    ...filaSiHayValor("Etiquetado (OK / NO OK)", control.etiquetado),
    ...filaSiHayValor("Tratamientos post-cosecha", control.tratamientos),
    ...filaSiHayValor("Clasificación", control.clasificacion),
    ...filaSiHayValor("Temperatura", control.temperatura),
    ...filaSiHayValor("Paletización / cajas", control.paletizacion),
    ...filaSiHayValor("Peso medio de las cajas", control.peso_medio_cajas),
    ...filaSiHayValor("Sticker", control.sticker),
    ...filaSiHayValor("Papel", control.papel),
  ];
  return filas.length > 0 ? tabla(filas, [MITAD, MITAD]) : null;
}

function conTipo(defectos: DefectoImport[]): DefectoImport[] {
  return defectos.filter((d) => d.tipo.trim() !== "");
}

function seccionDefectosNoEvolutivos(control: CalidadImportControl): Table | null {
  const leves = conTipo(control.defectos_leves);
  const graves = conTipo(control.defectos_graves);

  const filaDefectos = (nombre: string, defectos: DefectoImport[]): TableRow =>
    new TableRow({
      children: [
        celdaEtiqueta(nombre),
        celdaValor(lineas(defectos.map((d) => d.tipo.trim())), { width: CUARTO }),
        celdaValor(lineas(defectos.map((d) => d.pct.trim() || "-"), { align: AlignmentType.CENTER }), { width: CUARTO }),
      ],
    });

  const filas: TableRow[] = [];
  if (control.muestreo_no_evolutivos.trim() !== "") {
    filas.push(filaEtiquetaValor("Muestreo (%)", control.muestreo_no_evolutivos.trim(), 2));
  }
  if (leves.length > 0 || graves.length > 0) {
    filas.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: MITAD, type: WidthType.DXA },
            shading: { fill: SOMBREADO_ETIQUETA },
            margins: MARGEN_CELDA,
            children: [texto("")],
          }),
          celdaValor([texto("Tipo de defecto", { bold: true })], { width: CUARTO }),
          celdaValor([texto("%", { bold: true, align: AlignmentType.CENTER })], { width: CUARTO }),
        ],
      }),
    );
    if (leves.length > 0) filas.push(filaDefectos("Defecto leve", leves));
    if (graves.length > 0) filas.push(filaDefectos("Defecto grave", graves));
  }
  if (control.obs_no_evolutivos.trim() !== "") {
    filas.push(
      new TableRow({
        children: [
          celdaEtiqueta("Observaciones"),
          celdaValor([texto(control.obs_no_evolutivos.trim(), { size: SZ_PEQ })], { columnSpan: 2 }),
        ],
      }),
    );
  }
  return filas.length > 0 ? tabla(filas, [MITAD, CUARTO, CUARTO]) : null;
}

function seccionDefectosEvolutivos(control: CalidadImportControl): Table | null {
  const defectos = conTipo(control.defectos_evolutivos);
  const filas: TableRow[] = [];
  if (control.muestreo_evolutivos.trim() !== "") {
    filas.push(filaEtiquetaValor("Muestreo (%)", control.muestreo_evolutivos.trim()));
  }
  if (defectos.length > 0) {
    filas.push(
      new TableRow({
        children: [
          celdaEtiqueta("Tipo de defecto"),
          celdaValor([texto("%", { bold: true, align: AlignmentType.CENTER })]),
        ],
      }),
      new TableRow({
        children: [
          celdaValor(lineas(defectos.map((d) => d.tipo.trim()))),
          celdaValor(lineas(defectos.map((d) => d.pct.trim() || "-"), { align: AlignmentType.CENTER })),
        ],
      }),
    );
  }
  if (control.obs_evolutivos.trim() !== "") {
    filas.push(
      new TableRow({
        children: [
          celdaEtiqueta("Observaciones"),
          celdaValor([texto(control.obs_evolutivos.trim(), { size: SZ_PEQ })]),
        ],
      }),
    );
  }
  return filas.length > 0 ? tabla(filas, [MITAD, MITAD]) : null;
}

function seccionCalidadInterna(control: CalidadImportControl): Table | null {
  const muestras = control.muestras_internas;
  const filaConRef = (nombre: string, valor: string, ref: string): TableRow[] =>
    valor.trim() === ""
      ? []
      : [
          new TableRow({
            children: [
              celdaEtiqueta(nombre),
              celdaValor([texto(valor)], { width: CUARTO }),
              celdaValor([texto(`Ref. ${ref}`)], { width: CUARTO }),
            ],
          }),
        ];

  const filas = [
    ...filaSiHayValor("Peso fruta", unirValores(muestras.map((m) => m.peso_fruta)), 2),
    ...filaSiHayValor("Peso zumo", unirValores(muestras.map((m) => m.peso_zumo)), 2),
    ...filaConRef("% Zumo", unirValores(muestras.map((m) => pctZumo(m))), REF_PCT_ZUMO),
    ...filaConRef("Brix", unirValores(muestras.map((m) => m.brix)), REF_BRIX),
    ...filaConRef("Acidez", unirValores(muestras.map((m) => m.acidez)), REF_ACIDEZ),
    ...filaConRef("Índice de madurez", unirValores(muestras.map((m) => indiceMadurez(m))), REF_INDICE_MADUREZ),
  ];
  if (control.obs_calidad_interna.trim() !== "") {
    filas.push(
      new TableRow({
        children: [
          celdaEtiqueta("Observaciones"),
          celdaValor([texto(control.obs_calidad_interna.trim(), { size: SZ_PEQ })], { columnSpan: 2 }),
        ],
      }),
    );
  }
  return filas.length > 0 ? tabla(filas, [MITAD, CUARTO, CUARTO]) : null;
}

// Rejilla de fotos a 3 columnas. Cada foto se encaja en una caja de
// 180x200 px conservando su proporción (las celdas del informe original
// miden ~4,9 cm de ancho).
const FOTO_CAJA_ANCHO = 180;
const FOTO_CAJA_ALTO = 200;
const FOTOS_POR_FILA = 3;

function imagenAjustada(foto: ImagenInforme, cajaAncho: number, cajaAlto: number): ImageRun {
  const escala = Math.min(cajaAncho / foto.width, cajaAlto / foto.height, 1);
  return new ImageRun({
    type: foto.tipo,
    data: foto.data,
    transformation: {
      width: Math.max(1, Math.round(foto.width * escala)),
      height: Math.max(1, Math.round(foto.height * escala)),
    },
  });
}

function seccionFotos(fotos: ImagenInforme[]): Table | null {
  if (fotos.length === 0) return null;
  const anchoCol = Math.floor(ANCHO_CONTENIDO / FOTOS_POR_FILA);
  const filas: TableRow[] = [];
  const numFilas = Math.ceil(fotos.length / FOTOS_POR_FILA);
  for (let f = 0; f < numFilas; f++) {
    const celdas: TableCell[] = [];
    for (let c = 0; c < FOTOS_POR_FILA; c++) {
      const foto = fotos[f * FOTOS_POR_FILA + c];
      celdas.push(
        new TableCell({
          width: { size: anchoCol, type: WidthType.DXA },
          margins: MARGEN_CELDA,
          verticalAlign: VerticalAlign.CENTER,
          children: [
            foto
              ? new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [imagenAjustada(foto, FOTO_CAJA_ANCHO, FOTO_CAJA_ALTO)] })
              : texto(""),
          ],
        }),
      );
    }
    filas.push(new TableRow({ children: celdas }));
  }
  return tabla(filas, [anchoCol, anchoCol, anchoCol]);
}

function seccionRealiza(control: CalidadImportControl, firma: ImagenInforme | null): Table {
  const filas = [
    ...filaSiHayValor("Nombre del evaluador", control.evaluador),
    // La fecha del control siempre existe: Realiza siempre se imprime.
    filaEtiquetaValor("Fecha", fechaInformeTexto(control.fecha)),
  ];
  if (firma) {
    filas.push(
      new TableRow({
        children: [
          celdaEtiqueta("Firma"),
          celdaValor([new Paragraph({ spacing: { after: 0 }, children: [imagenAjustada(firma, 140, 55)] })]),
        ],
      }),
    );
  }
  return tabla(filas, [MITAD, MITAD]);
}

function conclusionParrafos(conclusion: string): Paragraph[] {
  const lineasConclusion = conclusion
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return lineasConclusion.map(
    (linea, indice) =>
      new Paragraph({
        spacing: { before: indice === 0 ? 360 : 120, after: 0 },
        children: [new TextRun({ text: linea, font: FUENTE, size: SZ_CUERPO })],
      }),
  );
}

function cabecera(logo: ImagenInforme | null): Header {
  // Réplica de la cabecera original: tabla con el logo (~4,3 cm) y el título.
  return new Header({
    children: [
      new Table({
        columnWidths: [2646, 5946],
        width: { size: 8592, type: WidthType.DXA },
        borders: BORDES_TABLA,
        rows: [
          new TableRow({
            height: { value: 1077, rule: HeightRule.ATLEAST },
            children: [
              new TableCell({
                width: { size: 2646, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                margins: MARGEN_CELDA,
                children: [
                  logo
                    ? new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [imagenAjustada(logo, 162, 64)] })
                    : texto("LASARTE", { bold: true }),
                ],
              }),
              new TableCell({
                width: { size: 5946, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                margins: MARGEN_CELDA,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 0 },
                    children: [
                      new TextRun({ text: "REPORTE DE CALIDAD FRUTA IMPORTACIÓN", font: FUENTE, size: 22, bold: true }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      // Aire entre la cabecera y el primer título de sección.
      new Paragraph({ spacing: { after: 120 }, children: [] }),
    ],
  });
}

/**
 * Genera el informe completo como Blob .docx.
 * Las imágenes llegan ya cargadas (bytes + tamaño natural): este módulo no
 * hace fetch para poder probarse en tests sin red ni storage.
 */
export async function generarInformeCalidadImportBlob(
  control: CalidadImportControl,
  fotos: ImagenInforme[],
  firma: ImagenInforme | null,
  logo: ImagenInforme | null,
): Promise<Blob> {
  // Solo entran las secciones con contenido, renumeradas de corrido.
  const secciones: Array<{ titulo: string; contenido: Table | null }> = [
    { titulo: "Información del producto", contenido: seccionProducto(control) },
    { titulo: "Información general", contenido: seccionGeneral(control) },
    { titulo: "Defectos no evolutivos", contenido: seccionDefectosNoEvolutivos(control) },
    { titulo: "Defectos evolutivos", contenido: seccionDefectosEvolutivos(control) },
    { titulo: "Calidad interna", contenido: seccionCalidadInterna(control) },
    { titulo: "Registro fotográfico", contenido: seccionFotos(fotos) },
    { titulo: "Realiza", contenido: seccionRealiza(control, firma) },
  ];

  const cuerpo: Array<Paragraph | Table> = [];
  let numero = 0;
  for (const seccion of secciones) {
    if (!seccion.contenido) continue;
    numero += 1;
    cuerpo.push(tituloSeccion(numero, seccion.titulo, numero === 1), seccion.contenido);
  }
  cuerpo.push(...conclusionParrafos(control.conclusion));

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FUENTE, size: SZ_CUERPO } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1800, bottom: 1440, left: 1800, header: 720, footer: 720 },
          },
        },
        headers: { default: cabecera(logo) },
        children: cuerpo,
      },
    ],
  });

  return Packer.toBlob(doc);
}
