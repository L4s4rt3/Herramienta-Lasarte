// Generador del "REPORTE DE CALIDAD FRUTA IMPORTACIÓN" en Word (.docx).
//
// El contenido es el de siempre —las mismas secciones, las mismas etiquetas y
// los mismos datos que rellena calidad—, pero el ASPECTO es una adaptación
// directa del informe del perito de destino (D-Quality Survey, el que
// inspecciona los contenedores de Harrie Goesten en Holanda), que es el que el
// dueño puso como referencia de "documento de empresa seria":
//
//   · CABECERA DE TRES BLOQUES. Logo a la izquierda y, al lado, los datos del
//     control en tres columnas de "Etiqueta:  Valor" con el valor en negrita.
//     Se repite en todas las páginas: una hoja suelta se identifica sola.
//   · BARRAS DE COLOR con el texto en blanco para el título del documento, las
//     cabeceras de sección y las cabeceras de columna de las tablas.
//   · TABLAS CON REJILLA, no listas sueltas.
//   · TIRA DE VEREDICTOS, como su "Temperature / Underweight / Brix /
//     Packaging": lo que hay que mirar de un golpe de vista, con ✓ o ✕.
//   · OBSERVACIONES GENERALES al final, bajo su barra, como su "General
//     remarks", con el dictamen literal de quien evaluó.
//   · PIE EN BANDA DE COLOR con la razón social.
//   · Registro fotográfico numerado, seis por página en rejilla 3x2.
//
// Lo que se conserva del informe de siempre: las siete secciones numeradas, sus
// etiquetas, los datos y la regla pedida por la evaluadora (31-08) de que SOLO
// se imprime lo que se rellenó — los campos vacíos no salen y una sección sin
// contenido desaparece entera, renumerándose las demás.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  parseNumeroFlexible,
  pctZumo,
  indiceMadurez,
  REF_ACIDEZ,
  REF_BRIX,
  REF_INDICE_MADUREZ,
  REF_PCT_ZUMO,
  type CalidadImportControl,
  type DefectoImport,
  type MuestraInterna,
} from "@/lib/calidadImport";

/** Imagen lista para incrustar: bytes + tamaño natural en píxeles. */
export interface ImagenInforme {
  data: ArrayBuffer | Uint8Array;
  width: number;
  height: number;
  tipo: "jpg" | "png";
}

/** El color de las barras. Lo demás del aspecto es igual en las dos variantes. */
export interface TemaInforme {
  /** Fondo de las barras y cabeceras de tabla. */
  barra: string;
  /** Fondo muy claro para las filas de observaciones. */
  barraSuave: string;
}

/** El verde de la casa, que además es el del informe de referencia. */
export const TEMA_VERDE: TemaInforme = { barra: "8CB82B", barraSuave: "F4F8EA" };

/** El azul corporativo, por si se prefiere más serio que fresco. */
export const TEMA_AZUL: TemaInforme = { barra: "253A70", barraSuave: "EEF2F8" };

const FUENTE = "Arial";
const SZ_TITULO = 24; //    12pt: el título en la barra
const SZ_SECCION = 20; //   10pt: cabecera de sección
const SZ_CUERPO = 18; //     9pt: valores y textos
const SZ_TABLA = 17; //    8,5pt: dentro de las tablas
const SZ_MICRO = 15; //    7,5pt: cabecera de página y pie

const NEGRO = "1A1A1A";
const GRIS_SUAVE = "5F6470";
const GRIS_LINEA = "C9CDD6";
const GRIS_FILA = "F4F5F7";
const ROJO = "B42318";
const VERDE_OK = "3B7A21";
const BLANCO = "FFFFFF";

// Página A4 (11906 x 16838 DXA) con márgenes de 16 mm.
const MARGEN_LATERAL = 907;
const ANCHO_CONTENIDO = 11906 - 2 * MARGEN_LATERAL; // 10092
const MITAD = Math.floor(ANCHO_CONTENIDO / 2);

const FILETE = { style: BorderStyle.SINGLE, size: 3, color: GRIS_LINEA } as const;
const SIN_BORDE = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
const BORDES_REJILLA = {
  top: FILETE,
  bottom: FILETE,
  left: FILETE,
  right: FILETE,
  insideHorizontal: FILETE,
  insideVertical: FILETE,
};
const BORDES_NINGUNO = {
  top: SIN_BORDE,
  bottom: SIN_BORDE,
  left: SIN_BORDE,
  right: SIN_BORDE,
  insideHorizontal: SIN_BORDE,
  insideVertical: SIN_BORDE,
};

const SALTO_DE_LINEA = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const MARCA_OK = String.fromCharCode(0x2713); // ✓
const MARCA_NO = String.fromCharCode(0x2717); // ✕

// ─── Piezas de texto ─────────────────────────────────────────────────────────

function run(
  contenido: string,
  opts?: { size?: number; color?: string; bold?: boolean },
): TextRun {
  return new TextRun({
    text: contenido,
    font: FUENTE,
    size: opts?.size ?? SZ_CUERPO,
    color: opts?.color ?? NEGRO,
    bold: opts?.bold ?? false,
  });
}

function parrafo(
  contenido: string,
  opts?: {
    size?: number;
    color?: string;
    bold?: boolean;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    after?: number;
  },
): Paragraph {
  return new Paragraph({
    alignment: opts?.align,
    spacing: { after: opts?.after ?? 0, line: 240 },
    children: [run(contenido, { size: opts?.size, color: opts?.color, bold: opts?.bold })],
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

/** La línea del membrete: lo justo para identificar una página suelta. */
export function lineaIdentificacion(control: CalidadImportControl): string {
  return [
    referenciaInformeTexto(control),
    fechaInformeTexto(control.fecha),
    control.clasificacion.trim(),
    control.proveedor.trim(),
  ]
    .map((parte) => parte.trim())
    .filter((parte) => parte !== "")
    .join("   ·   ");
}

// ─── Barras y tablas ─────────────────────────────────────────────────────────

/** Barra de color con el texto en blanco: el recurso del informe de referencia. */
function barra(tema: TemaInforme, texto: string, opts?: { size?: number; primera?: boolean; saltoDePagina?: boolean; detalle?: string }): Paragraph {
  const hijos = [run(texto, { size: opts?.size ?? SZ_SECCION, color: BLANCO, bold: true })];
  if (opts?.detalle) {
    hijos.push(run(TAB, { size: SZ_MICRO, color: BLANCO }), run(opts.detalle, { size: SZ_MICRO, color: BLANCO }));
  }
  return new Paragraph({
    pageBreakBefore: opts?.saltoDePagina ?? false,
    spacing: { before: opts?.primera ? 0 : 260, after: 0, line: 280 },
    shading: { fill: tema.barra },
    indent: { left: 120, right: 120 },
    tabStops: [{ type: TabStopType.RIGHT, position: ANCHO_CONTENIDO - 160 }],
    keepNext: true,
    children: hijos,
  });
}

/** Celda de cabecera de tabla: fondo de color, texto blanco. */
function celdaCabecera(tema: TemaInforme, texto: string, ancho: number, align?: (typeof AlignmentType)[keyof typeof AlignmentType]): TableCell {
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    shading: { fill: tema.barra },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    verticalAlign: VerticalAlign.CENTER,
    children: [parrafo(texto, { size: SZ_TABLA, color: BLANCO, bold: true, align })],
  });
}

function celdaEtiqueta(texto: string, ancho: number): TableCell {
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    shading: { fill: GRIS_FILA },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    verticalAlign: VerticalAlign.CENTER,
    children: [parrafo(texto, { size: SZ_TABLA, color: GRIS_SUAVE, bold: true })],
  });
}

function celdaValor(
  contenido: Paragraph[],
  ancho: number,
  opts?: { columnSpan?: number },
): TableCell {
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    columnSpan: opts?.columnSpan,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    verticalAlign: VerticalAlign.CENTER,
    children: contenido,
  });
}

function tabla(rows: TableRow[], columnWidths: number[]): Table {
  return new Table({
    columnWidths,
    width: { size: ANCHO_CONTENIDO, type: WidthType.DXA },
    borders: BORDES_REJILLA,
    rows,
  });
}

// ─── La ficha de datos: pares etiqueta / valor a dos columnas ────────────────

interface CampoInforme {
  etiqueta: string;
  valor: string;
  /** Un texto largo ocupa la fila entera. */
  completo: boolean;
  marca: "si" | "no" | null;
}

/** Sí / OK / correcto → ✓ verde; no / dañado → ✕ rojo; lo demás, nada. */
export function marcaDeValor(valor: string): "si" | "no" | null {
  const limpio = valor.trim().toUpperCase();
  if (["SI", "SÍ", "OK", "CORRECTO", "BIEN"].includes(limpio)) return "si";
  if (["NO", "NO OK", "KO", "DAÑADO", "DANADO", "MAL", "INCORRECTO"].includes(limpio)) return "no";
  return null;
}

/** Solo los campos con valor: la regla "imprime lo rellenado". */
function campo(etiqueta: string, valor: string, opts?: { completo?: boolean; conMarca?: boolean }): CampoInforme[] {
  const limpio = valor.trim();
  if (limpio === "") return [];
  return [
    {
      etiqueta,
      valor: limpio,
      completo: opts?.completo ?? false,
      marca: opts?.conMarca ? marcaDeValor(limpio) : null,
    },
  ];
}

function parrafoValor(datos: CampoInforme): Paragraph {
  const hijos: TextRun[] = [];
  if (datos.marca === "si") hijos.push(run(`${MARCA_OK} `, { size: SZ_TABLA, color: VERDE_OK, bold: true }));
  if (datos.marca === "no") hijos.push(run(`${MARCA_NO} `, { size: SZ_TABLA, color: ROJO, bold: true }));
  hijos.push(run(datos.valor, { size: SZ_TABLA }));
  return new Paragraph({ spacing: { after: 0, line: 240 }, children: hijos });
}

/**
 * Ficha a dos pares por fila (etiqueta | valor | etiqueta | valor). Los campos
 * largos ocupan la fila entera. Es denso, como el informe de referencia, y
 * cabe el doble en la misma altura.
 */
function fichaCampos(campos: CampoInforme[]): Table | null {
  if (campos.length === 0) return null;
  const anchoEtiqueta = Math.floor(ANCHO_CONTENIDO * 0.21);
  const anchoValor = MITAD - anchoEtiqueta;
  const filas: TableRow[] = [];
  const pendientes: CampoInforme[] = [];

  const volcar = () => {
    while (pendientes.length > 0) {
      const par = pendientes.splice(0, 2);
      const celdas: TableCell[] = [];
      for (const datos of par) {
        celdas.push(celdaEtiqueta(datos.etiqueta, anchoEtiqueta), celdaValor([parrafoValor(datos)], anchoValor));
      }
      if (par.length === 1) {
        // La fila impar se cierra con una celda vacía que ocupa el otro par.
        celdas.push(celdaValor([parrafo("")], anchoEtiqueta + anchoValor, { columnSpan: 2 }));
      }
      filas.push(new TableRow({ children: celdas }));
    }
  };

  for (const datos of campos) {
    if (datos.completo) {
      volcar();
      filas.push(
        new TableRow({
          children: [
            celdaEtiqueta(datos.etiqueta, anchoEtiqueta),
            celdaValor([parrafoValor(datos)], ANCHO_CONTENIDO - anchoEtiqueta, { columnSpan: 3 }),
          ],
        }),
      );
    } else {
      pendientes.push(datos);
      if (pendientes.length === 2) volcar();
    }
  }
  volcar();

  return tabla(filas, [anchoEtiqueta, anchoValor, anchoEtiqueta, anchoValor]);
}

// ─── Secciones ───────────────────────────────────────────────────────────────

function seccionProducto(control: CalidadImportControl): Table | null {
  return fichaCampos([
    ...campo("Referencia", referenciaInformeTexto(control)),
    ...campo("Proveedor", control.proveedor),
    ...campo("Tipo de producto", control.tipo_producto),
    ...campo("Marca", control.marca),
    ...campo("Origen", control.origen),
    ...campo("Calibre", control.calibre),
    ...campo("Kg total contenedor", control.kg_total),
    ...campo("Tipo confección", control.tipo_confeccion),
    ...campo("Fecha descarga camión", control.fecha_descarga ? fechaInformeTexto(control.fecha_descarga) : ""),
    ...campo("Barco", control.barco),
    ...campo("Nº Contenedor", control.num_contenedor),
    ...campo("PUC / Orchard (campo)", control.puc_orchard),
    ...campo("GGN", control.ggn, { completo: true }),
  ]);
}

function seccionGeneral(control: CalidadImportControl): Table | null {
  return fichaCampos([
    ...campo("Clasificación", control.clasificacion),
    ...campo("Etiquetado", control.etiquetado, { conMarca: true }),
    ...campo("Temperatura", control.temperatura),
    ...campo("Paletización / cajas", control.paletizacion),
    ...campo("Peso medio de las cajas", control.peso_medio_cajas),
    ...campo("Sticker", control.sticker, { conMarca: true }),
    ...campo("Papel", control.papel, { conMarca: true }),
    ...campo("Estado de las cajas", control.packaging_cajas, { conMarca: true }),
    ...campo("Estado de los palets", control.packaging_palets, { conMarca: true }),
    ...campo("Detalle del embalaje", control.packaging_detalle, { completo: true }),
    ...campo("Tratamientos post-cosecha", control.tratamientos, { completo: true }),
  ]);
}

function conTipo(defectos: DefectoImport[]): DefectoImport[] {
  return defectos.filter((d) => d.tipo.trim() !== "");
}

/** Tabla de defectos: cabecera de color, una fila por defecto. */
function tablaDefectos(tema: TemaInforme, grupos: Array<{ nombre: string; defectos: DefectoImport[] }>): Table | null {
  const conContenido = grupos.filter((g) => g.defectos.length > 0);
  if (conContenido.length === 0) return null;

  const anchoGrupo = Math.floor(ANCHO_CONTENIDO * 0.24);
  const anchoPct = Math.floor(ANCHO_CONTENIDO * 0.16);
  const anchoTipo = ANCHO_CONTENIDO - anchoGrupo - anchoPct;

  const filas: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        celdaCabecera(tema, "Tipo", anchoGrupo),
        celdaCabecera(tema, "Defecto", anchoTipo),
        celdaCabecera(tema, "%", anchoPct, AlignmentType.CENTER),
      ],
    }),
  ];

  for (const grupo of conContenido) {
    grupo.defectos.forEach((defecto, indice) => {
      filas.push(
        new TableRow({
          children: [
            indice === 0
              ? celdaEtiqueta(grupo.nombre, anchoGrupo)
              : celdaValor([parrafo("", { size: SZ_TABLA })], anchoGrupo),
            celdaValor([parrafo(defecto.tipo.trim(), { size: SZ_TABLA })], anchoTipo),
            celdaValor(
              [parrafo(defecto.pct.trim() === "" ? "-" : `${defecto.pct.trim()} %`, { size: SZ_TABLA, bold: true, align: AlignmentType.CENTER })],
              anchoPct,
            ),
          ],
        }),
      );
    });
  }

  return tabla(filas, [anchoGrupo, anchoTipo, anchoPct]);
}

/** Una observación larga, con su etiqueta, ocupando la fila entera. */
function bloqueObservacion(etiqueta: string, contenido: string): Table | null {
  return fichaCampos(campo(etiqueta, contenido, { completo: true }));
}

function seccionDefectosNoEvolutivos(tema: TemaInforme, control: CalidadImportControl): Array<Paragraph | Table> {
  return [
    tablaDefectos(tema, [
      { nombre: "Defecto leve", defectos: conTipo(control.defectos_leves) },
      { nombre: "Defecto grave", defectos: conTipo(control.defectos_graves) },
    ]),
    bloqueObservacion("Observaciones", control.obs_no_evolutivos),
  ].filter((b): b is Table => b !== null);
}

function seccionDefectosEvolutivos(tema: TemaInforme, control: CalidadImportControl): Array<Paragraph | Table> {
  return [
    tablaDefectos(tema, [{ nombre: "Defecto", defectos: conTipo(control.defectos_evolutivos) }]),
    bloqueObservacion("Observaciones", control.obs_evolutivos),
  ].filter((b): b is Table => b !== null);
}

// ─── Calidad interna ─────────────────────────────────────────────────────────

/** Rango de una referencia escrita como "10/16" o ">40/42%". */
export function rangoDeReferencia(referencia: string): { min: number | null; max: number | null } {
  const encontrados = referencia.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const numeros = encontrados.map((n) => parseNumeroFlexible(n)).filter((n): n is number => n !== null);
  if (numeros.length === 0) return { min: null, max: null };
  // ">40/42%": el primero es el mínimo exigible y no hay máximo.
  if (referencia.includes(">")) return { min: numeros[0], max: null };
  return { min: numeros[0], max: numeros[1] ?? null };
}

/** true si lo medido se sale de su referencia (para pintarlo en rojo). */
export function fueraDeReferencia(valor: string, referencia: string): boolean {
  const medido = parseNumeroFlexible(valor);
  if (medido === null) return false;
  const { min, max } = rangoDeReferencia(referencia);
  if (min !== null && medido < min) return true;
  if (max !== null && medido > max) return true;
  return false;
}

/** Una columna por muestra, una fila por medida y la referencia al final. */
function seccionCalidadInterna(tema: TemaInforme, control: CalidadImportControl): Array<Paragraph | Table> {
  const muestras = control.muestras_internas.filter(
    (m) => [m.peso_fruta, m.peso_zumo, m.brix, m.acidez].some((v) => v.trim() !== ""),
  );
  const observacion = bloqueObservacion("Observaciones", control.obs_calidad_interna);
  if (muestras.length === 0) return observacion ? [observacion] : [];

  const anchoMedida = Math.floor(ANCHO_CONTENIDO * 0.27);
  const anchoRef = Math.floor(ANCHO_CONTENIDO * 0.17);
  const anchoMuestra = Math.floor((ANCHO_CONTENIDO - anchoMedida - anchoRef) / muestras.length);

  const filas: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        celdaCabecera(tema, "Medida", anchoMedida),
        ...muestras.map((_, i) => celdaCabecera(tema, `Muestra ${i + 1}`, anchoMuestra, AlignmentType.CENTER)),
        celdaCabecera(tema, "Referencia", anchoRef, AlignmentType.CENTER),
      ],
    }),
  ];

  const filaMedida = (nombre: string, valorDe: (m: MuestraInterna) => string, referencia?: string): TableRow[] => {
    const valores = muestras.map(valorDe);
    if (valores.every((v) => v.trim() === "")) return [];
    return [
      new TableRow({
        children: [
          celdaEtiqueta(nombre, anchoMedida),
          ...valores.map((v) =>
            celdaValor(
              [
                parrafo(v.trim() === "" ? "-" : v, {
                  size: SZ_TABLA,
                  bold: true,
                  align: AlignmentType.CENTER,
                  color: referencia && fueraDeReferencia(v, referencia) ? ROJO : NEGRO,
                }),
              ],
              anchoMuestra,
            ),
          ),
          celdaValor(
            [parrafo(referencia ?? "", { size: SZ_TABLA, color: GRIS_SUAVE, align: AlignmentType.CENTER })],
            anchoRef,
          ),
        ],
      }),
    ];
  };

  filas.push(
    ...filaMedida("Peso de la fruta (g)", (m) => m.peso_fruta.trim()),
    ...filaMedida("Peso del zumo (g)", (m) => m.peso_zumo.trim()),
    ...filaMedida("% de zumo", (m) => pctZumo(m), REF_PCT_ZUMO),
    ...filaMedida("Brix", (m) => m.brix.trim(), REF_BRIX),
    ...filaMedida("Acidez", (m) => m.acidez.trim(), REF_ACIDEZ),
    ...filaMedida("Índice de madurez", (m) => indiceMadurez(m), REF_INDICE_MADUREZ),
  );

  const bloques: Array<Paragraph | Table> = [
    tabla(filas, [anchoMedida, ...muestras.map(() => anchoMuestra), anchoRef]),
  ];
  if (observacion) bloques.push(observacion);
  return bloques;
}

// ─── La tira de veredictos ───────────────────────────────────────────────────

interface Veredicto {
  titulo: string;
  valor: string;
  marca: "si" | "no" | null;
}

/**
 * Lo que hay que mirar de un golpe de vista, como el "Temperature /
 * Underweight / Brix / Packaging" del informe de referencia. Solo entra lo
 * que está anotado, y la marca sale de la propia referencia (Brix, % de zumo)
 * o del sí/no que escribió calidad.
 */
export function veredictosDeControl(control: CalidadImportControl): Veredicto[] {
  const veredictos: Veredicto[] = [];
  const conMarca = (titulo: string, valor: string) => {
    if (valor.trim() === "") return;
    veredictos.push({ titulo, valor: valor.trim(), marca: marcaDeValor(valor) });
  };

  conMarca("Etiquetado", control.etiquetado);
  conMarca("Cajas", control.packaging_cajas);
  conMarca("Palets", control.packaging_palets);

  const peorDe = (valores: string[], referencia: string) => {
    const numeros = valores.map((v) => parseNumeroFlexible(v)).filter((n): n is number => n !== null);
    if (numeros.length === 0) return null;
    const peor = Math.min(...numeros);
    return { peor, fuera: fueraDeReferencia(String(peor), referencia) };
  };

  const brix = peorDe(control.muestras_internas.map((m) => m.brix), REF_BRIX);
  if (brix) {
    veredictos.push({
      titulo: "Brix",
      valor: `${brix.peor} (ref. ${REF_BRIX})`,
      marca: brix.fuera ? "no" : "si",
    });
  }

  const zumo = peorDe(control.muestras_internas.map((m) => pctZumo(m)), REF_PCT_ZUMO);
  if (zumo) {
    veredictos.push({
      titulo: "% de zumo",
      valor: `${zumo.peor} (ref. ${REF_PCT_ZUMO})`,
      marca: zumo.fuera ? "no" : "si",
    });
  }

  if (control.temperatura.trim() !== "") {
    veredictos.push({ titulo: "Temperatura", valor: control.temperatura.trim(), marca: null });
  }

  return veredictos;
}

function tiraVeredictos(tema: TemaInforme, veredictos: Veredicto[]): Table | null {
  if (veredictos.length === 0) return null;
  const ancho = Math.floor(ANCHO_CONTENIDO / veredictos.length);
  const anchos = veredictos.map(() => ancho);

  const cabeceras = veredictos.map((v) => celdaCabecera(tema, v.titulo, ancho));
  const valores = veredictos.map((v) => {
    const hijos: TextRun[] = [];
    if (v.marca === "si") hijos.push(run(`${MARCA_OK}  `, { size: SZ_CUERPO, color: VERDE_OK, bold: true }));
    if (v.marca === "no") hijos.push(run(`${MARCA_NO}  `, { size: SZ_CUERPO, color: ROJO, bold: true }));
    hijos.push(run(v.valor, { size: SZ_TABLA, bold: true }));
    return new TableCell({
      width: { size: ancho, type: WidthType.DXA },
      margins: { top: 120, bottom: 120, left: 110, right: 110 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ spacing: { after: 0, line: 240 }, children: hijos })],
    });
  });

  return tabla([new TableRow({ children: cabeceras }), new TableRow({ children: valores })], anchos);
}

// ─── Registro fotográfico ────────────────────────────────────────────────────

const FOTOS_POR_FILA = 3;
const FOTOS_POR_PAGINA = 6;
const FOTO_CAJA_ANCHO = 195;
const FOTO_CAJA_ALTO = 250;

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

/** Celda de foto: su número en una barra de color y la imagen debajo. */
function celdaFoto(tema: TemaInforme, foto: ImagenInforme | undefined, numero: number, ancho: number): TableCell {
  if (!foto) {
    return new TableCell({
      width: { size: ancho, type: WidthType.DXA },
      borders: { top: SIN_BORDE, bottom: SIN_BORDE, left: SIN_BORDE, right: SIN_BORDE },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [parrafo("")],
    });
  }
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    verticalAlign: VerticalAlign.TOP,
    children: [
      new Paragraph({
        spacing: { before: 0, after: 60, line: 240 },
        shading: { fill: tema.barra },
        indent: { left: 90, right: 90 },
        children: [run(`Foto ${numero}`, { size: SZ_MICRO, color: BLANCO, bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [imagenAjustada(foto, FOTO_CAJA_ANCHO, FOTO_CAJA_ALTO)],
      }),
    ],
  });
}

function seccionFotos(tema: TemaInforme, fotos: ImagenInforme[]): Array<Paragraph | Table> {
  if (fotos.length === 0) return [];
  const anchoCol = Math.floor(ANCHO_CONTENIDO / FOTOS_POR_FILA);
  const bloques: Array<Paragraph | Table> = [];

  for (let inicio = 0; inicio < fotos.length; inicio += FOTOS_POR_PAGINA) {
    const grupo = fotos.slice(inicio, inicio + FOTOS_POR_PAGINA);
    const filas: TableRow[] = [];
    for (let f = 0; f * FOTOS_POR_FILA < grupo.length; f++) {
      const celdas: TableCell[] = [];
      for (let c = 0; c < FOTOS_POR_FILA; c++) {
        const indice = f * FOTOS_POR_FILA + c;
        celdas.push(celdaFoto(tema, grupo[indice], inicio + indice + 1, anchoCol));
      }
      filas.push(new TableRow({ children: celdas, cantSplit: true }));
    }
    if (inicio > 0) {
      bloques.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, children: [] }));
    }
    bloques.push(
      new Table({
        columnWidths: [anchoCol, anchoCol, anchoCol],
        width: { size: ANCHO_CONTENIDO, type: WidthType.DXA },
        borders: BORDES_NINGUNO,
        rows: filas,
      }),
    );
  }
  return bloques;
}

function seccionRealiza(control: CalidadImportControl, firma: ImagenInforme | null): Table | null {
  const campos = [
    ...campo("Nombre del evaluador", control.evaluador),
    // La fecha del control siempre existe: Realiza siempre se imprime.
    ...campo("Fecha", fechaInformeTexto(control.fecha)),
  ];
  const ficha = fichaCampos(campos);
  if (!firma || !ficha) return ficha;

  const anchoEtiqueta = Math.floor(ANCHO_CONTENIDO * 0.21);
  const anchoValor = MITAD - anchoEtiqueta;
  return tabla(
    [
      new TableRow({
        children: [
          celdaEtiqueta(campos[0]?.etiqueta ?? "Fecha", anchoEtiqueta),
          celdaValor([parrafoValor(campos[0] ?? { etiqueta: "", valor: "", completo: false, marca: null })], anchoValor),
          celdaEtiqueta("Firma", anchoEtiqueta),
          celdaValor([new Paragraph({ spacing: { after: 0 }, children: [imagenAjustada(firma, 150, 58)] })], anchoValor),
        ],
      }),
      ...(campos.length > 1
        ? [
            new TableRow({
              children: [
                celdaEtiqueta(campos[1].etiqueta, anchoEtiqueta),
                celdaValor([parrafoValor(campos[1])], ANCHO_CONTENIDO - anchoEtiqueta, { columnSpan: 3 }),
              ],
            }),
          ]
        : []),
    ],
    [anchoEtiqueta, anchoValor, anchoEtiqueta, anchoValor],
  );
}

/** El dictamen literal de quien evaluó, bajo su barra. */
function bloqueObservacionesGenerales(tema: TemaInforme, conclusion: string): Array<Paragraph | Table> {
  const lineasConclusion = conclusion
    .split(SALTO_DE_LINEA)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lineasConclusion.length === 0) return [];

  return [
    barra(tema, "Observaciones generales"),
    tabla(
      [
        new TableRow({
          children: [
            new TableCell({
              width: { size: ANCHO_CONTENIDO, type: WidthType.DXA },
              margins: { top: 140, bottom: 140, left: 140, right: 140 },
              children: lineasConclusion.map(
                (linea, indice) =>
                  new Paragraph({
                    spacing: { before: indice === 0 ? 0 : 100, after: 0, line: 260 },
                    children: [run(linea, { size: SZ_CUERPO })],
                  }),
              ),
            }),
          ],
        }),
      ],
      [ANCHO_CONTENIDO],
    ),
  ];
}

// ─── Cabecera y pie ──────────────────────────────────────────────────────────

/** Los datos del control repartidos en los dos bloques de la cabecera. */
export function bloquesCabecera(control: CalidadImportControl): string[][][] {
  const par = (etiqueta: string, valor: string): string[][] => (valor.trim() === "" ? [] : [[etiqueta, valor.trim()]]);
  const todos: string[][] = [
    ...par("Proveedor", control.proveedor),
    ...par("Ref. proveedor", control.referencia),
    ...par("Nuestra ref.", control.nuestra_ref),
    ...par("Marca", control.marca),
    ...par("Nº contenedor", control.num_contenedor),
    ...par("Barco", control.barco),
    ...par("Fecha del control", fechaInformeTexto(control.fecha)),
    ...par("Fecha de descarga", control.fecha_descarga ? fechaInformeTexto(control.fecha_descarga) : ""),
    ...par("Origen", control.origen),
    ...par("Producto", control.tipo_producto),
    ...par("Categoría", control.clasificacion),
    ...par("Kg descargados", control.kg_total),
    ...par("Evaluador", control.evaluador),
  ];
  // Dos bloques lo más iguales posible, en el orden de arriba.
  const porBloque = Math.ceil(todos.length / 2);
  return [todos.slice(0, porBloque), todos.slice(porBloque)];
}

function celdaBloqueCabecera(pares: string[][], ancho: number): TableCell {
  const anchoEtiqueta = Math.floor(ancho * 0.38);
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 0, right: 100 },
    verticalAlign: VerticalAlign.TOP,
    children:
      pares.length > 0
        ? pares.map(
            ([etiqueta, valor]) =>
              new Paragraph({
                spacing: { after: 10, line: 200 },
                tabStops: [{ type: TabStopType.LEFT, position: anchoEtiqueta }],
                children: [
                  run(`${etiqueta}:`, { size: SZ_MICRO, color: GRIS_SUAVE }),
                  run(TAB, { size: SZ_MICRO }),
                  run(valor, { size: SZ_MICRO, bold: true }),
                ],
              }),
          )
        : [parrafo("")],
  });
}

/** Membrete: logo y los datos del control en tres bloques, como el de referencia. */
function cabecera(control: CalidadImportControl, logo: ImagenInforme | null, tema: TemaInforme): Header {
  const anchoLogo = 2000;
  const anchoBloque = Math.floor((ANCHO_CONTENIDO - anchoLogo) / 2);
  const bloques = bloquesCabecera(control);

  return new Header({
    children: [
      new Table({
        columnWidths: [anchoLogo, anchoBloque, anchoBloque],
        width: { size: ANCHO_CONTENIDO, type: WidthType.DXA },
        borders: BORDES_NINGUNO,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: anchoLogo, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 0, bottom: 0, left: 0, right: 140 },
                children: [
                  logo
                    ? new Paragraph({ spacing: { after: 0 }, children: [imagenAjustada(logo, 140, 52)] })
                    : parrafo("LASARTE CÍTRICOS", { bold: true, size: SZ_CUERPO }),
                ],
              }),
              ...bloques.map((b) => celdaBloqueCabecera(b, anchoBloque)),
            ],
          }),
        ],
      }),
      new Paragraph({
        spacing: { before: 100, after: 0, line: 280 },
        shading: { fill: tema.barra },
        alignment: AlignmentType.CENTER,
        children: [run("REPORTE DE CALIDAD FRUTA IMPORTACIÓN", { size: SZ_TITULO, color: BLANCO, bold: true })],
      }),
    ],
  });
}

/** Pie en banda de color con la razón social, como el informe de referencia. */
function pie(tema: TemaInforme): Footer {
  return new Footer({
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0, line: 240 },
        shading: { fill: tema.barra },
        alignment: AlignmentType.CENTER,
        children: [
          run("Lasarte Cítricos S.L.  ·  CIF B14800304  ·  Control de recepción de fruta de importación", {
            size: SZ_MICRO,
            color: BLANCO,
          }),
        ],
      }),
      new Paragraph({
        spacing: { before: 60, after: 0 },
        tabStops: [{ type: TabStopType.RIGHT, position: ANCHO_CONTENIDO }],
        children: [
          run("Documento generado por la herramienta de Lasarte Cítricos S.L.", { size: SZ_MICRO, color: GRIS_SUAVE }),
          run(TAB, { size: SZ_MICRO }),
          new TextRun({ children: [PageNumber.CURRENT], font: FUENTE, size: SZ_MICRO, color: GRIS_SUAVE }),
          run(" / ", { size: SZ_MICRO, color: GRIS_SUAVE }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FUENTE, size: SZ_MICRO, color: GRIS_SUAVE }),
        ],
      }),
    ],
  });
}

/** "Muestreo (11-200)" para la barra de la sección, o vacío si no se anotó. */
function muestreoTexto(muestreo: string): string {
  const limpio = muestreo.trim();
  return limpio === "" ? "" : `Muestreo ${limpio}`;
}

function unaTabla(contenido: Table | null): Array<Paragraph | Table> {
  return contenido ? [contenido] : [];
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
  tema: TemaInforme = TEMA_VERDE,
): Promise<Blob> {
  const secciones: Array<{
    titulo: string;
    contenido: Array<Paragraph | Table>;
    saltoDePagina?: boolean;
    detalle?: string;
  }> = [
    { titulo: "Información del producto", contenido: unaTabla(seccionProducto(control)) },
    { titulo: "Información general", contenido: unaTabla(seccionGeneral(control)) },
    {
      titulo: "Defectos no evolutivos",
      contenido: seccionDefectosNoEvolutivos(tema, control),
      detalle: muestreoTexto(control.muestreo_no_evolutivos),
    },
    {
      titulo: "Defectos evolutivos",
      contenido: seccionDefectosEvolutivos(tema, control),
      detalle: muestreoTexto(control.muestreo_evolutivos),
    },
    { titulo: "Calidad interna", contenido: seccionCalidadInterna(tema, control) },
    // Las fotos empiezan en página nueva: si no, la rejilla se parte y quedan
    // tres por hoja en vez de seis.
    { titulo: "Registro fotográfico", contenido: seccionFotos(tema, fotos), saltoDePagina: true },
    { titulo: "Realiza", contenido: unaTabla(seccionRealiza(control, firma)) },
  ];

  const cuerpo: Array<Paragraph | Table> = [];

  // La tira de veredictos abre el informe: lo que hay que mirar de un vistazo.
  const tira = tiraVeredictos(tema, veredictosDeControl(control));
  if (tira) {
    cuerpo.push(barra(tema, "De un vistazo", { primera: true }), tira);
  }

  let numero = 0;
  for (const seccion of secciones) {
    // Una sección de defectos sin defectos pero CON muestreo sigue diciendo
    // algo ("se miraron 200 piezas y no había nada"): se imprime su barra.
    if (seccion.contenido.length === 0 && !seccion.detalle) continue;
    numero += 1;
    cuerpo.push(
      barra(tema, `${numero}. ${seccion.titulo}`, {
        primera: cuerpo.length === 0,
        saltoDePagina: seccion.saltoDePagina,
        detalle: seccion.detalle,
      }),
      ...seccion.contenido,
    );
  }

  cuerpo.push(...bloqueObservacionesGenerales(tema, control.conclusion));

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FUENTE, size: SZ_CUERPO, color: NEGRO } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 2500, right: MARGEN_LATERAL, bottom: 1500, left: MARGEN_LATERAL, header: 620, footer: 500 },
          },
        },
        headers: { default: cabecera(control, logo, tema) },
        footers: { default: pie(tema) },
        children: cuerpo,
      },
    ],
  });

  return Packer.toBlob(doc);
}
