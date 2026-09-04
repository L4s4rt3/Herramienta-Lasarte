// El Excel de Análisis → Por productor → «Aprovechamiento real por parcela»
// (AprovechamientoRealParcela.tsx): las mismas hojas y columnas que
// scripts/informe-aprovechamiento-invermarmelo.ts, pero para la finca y las
// parcelas que tenga elegidas la pantalla y a partir de lo que
// useAprovechamientoReal YA tiene calculado. Aquí no se recalcula nada ni se
// toca la base: se proyecta al formato del informe y se descarga con exportKit.
//
// El script estaba clavado a dos parcelas (Invermarmelo 2 y 4), así que su
// «Resumen» tenía dos columnas de valor y una de diferencia. Aquí hay una
// columna por parcela elegida, una de TOTAL cuando hay más de una y la
// diferencia solo cuando se comparan exactamente dos (con más no significa nada).
import type { AprovechamientoReal, ParcelaReal } from "@/hooks/useAprovechamientoReal";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_INT,
  FMT_KG,
  FMT_PCT,
  type ColumnaTabla,
  type HojaTablaOptions,
  type LasarteExportMeta,
} from "./exportKit";
import { etiquetaParcela, LABEL_ESTADO_DATO } from "./aprovechamientoReal";
import { LABEL_MDNA, METODOS_MDNA } from "./mdnaMix";

export interface OpcionesExportAprovechamiento {
  /** La finca elegida en la pantalla (texto de la báscula). */
  finca: string;
  /** Correo de quien exporta, para el pie de marca. Nunca "Herramienta Lasarte": eso no va en documentos. */
  usuario?: string | null;
  /** Solo para tests deterministas (nombre del fichero y sello); por defecto ahora. */
  generadoEn?: Date;
}

const kgCol = (h: string, k: string, w = 15): ColumnaTabla => ({ header: h, key: k, tipo: "numero", numFmt: FMT_KG, width: w });
const pctCol = (h: string, k: string, w = 12): ColumnaTabla => ({ header: h, key: k, tipo: "numero", numFmt: FMT_PCT, width: w });

const pct = (parte: number, total: number): number | null => (total > 0 ? (parte / total) * 100 : null);
/** Dos decimales, como el script, para que la hoja se lea sin ruido; null se queda null. */
const r2 = (v: number | null | undefined): number | null => (v == null ? null : Number(v.toFixed(2)));
/** Entero con separador de miles español, para los textos de las notas. */
const n0 = (v: number): string => Math.round(v).toLocaleString("es-ES");

/** Desfase calibrador vs báscula de los lotes analizados: la misma cuenta que enseña la pantalla. */
export function desfaseParcela(p: ParcelaReal): number | null {
  return p.kgEntradaConDato > 0 ? ((p.resumen.kgSizer - p.kgEntradaConDato) / p.kgEntradaConDato) * 100 : null;
}

/** Las columnas de valor del «Resumen»: las parcelas y, si hay más de una, el TOTAL (igual que la tabla de la pantalla). */
export function columnasParcelas(data: AprovechamientoReal): ParcelaReal[] {
  return data.parcelas.length > 1 ? [...data.parcelas, { ...data.total, etiqueta: "TOTAL" }] : data.parcelas;
}

const etiquetas = (data: AprovechamientoReal): string => data.parcelas.map((p) => p.etiqueta).join(", ");

// ─── Resumen ──────────────────────────────────────────────────────────────────

type Unidad = "kg" | "pct" | "int" | "txt";
const UNIDAD_TXT: Record<Unidad, string> = { pct: "%", kg: "kg", int: "nº", txt: "" };

interface FilaResumenDef {
  concepto: string;
  /** null en las filas de texto (frescura de las fuentes): no tienen valor por parcela. */
  valor: ((p: ParcelaReal) => number | null) | null;
  unidad: Unidad;
  nota: string;
}

function definicionResumen(data: AprovechamientoReal): FilaResumenDef[] {
  const f = data.frescura;
  const kgDocxTotal = data.total.resumen.kgRespaldo;
  const pendientes = data.pendientesVolcado;
  const txt = (concepto: string, nota: string): FilaResumenDef => ({ concepto, valor: null, unidad: "txt", nota });
  const fila = (concepto: string, valor: (p: ParcelaReal) => number | null, unidad: Unidad, nota: string): FilaResumenDef =>
    ({ concepto, valor, unidad, nota });
  return [
    // ─── Hasta qué día llega cada fuente ────────────────────────────────────
    // Va lo PRIMERO a propósito: sin esto, un informe con el volcado parado se
    // lee como si estuviera al día (aprendido a la mala el 18-ago-2026).
    txt("▸ Última pasada en el volcado del calibrador", `${f.ultimaPasadaSizer ?? "sin dato"} · sincronizado por última vez el ${f.ultimaSincronizacion ?? "sin dato"}`),
    txt("▸ Último informe Word de lote recibido", `${f.ultimoInformeDocx ?? "sin dato"} · es el respaldo que tapa los días que el volcado SQL no trae`),
    txt("▸ Último parte diario registrado", f.ultimoParte ?? "sin dato"),
    txt("▸ Estado de los datos", f.volcadoAtrasado
      ? `⚠ EL VOLCADO SQL DEL CALIBRADOR VA POR DETRÁS DE LOS PARTES (${f.ultimaPasadaSizer} frente a ${f.ultimoParte}). Lo procesado después del ${f.ultimaPasadaSizer} entra en este informe con el INFORME WORD de lote (${n0(kgDocxTotal)} kg en total), que trae solo la última pasada de cada día. ${pendientes.length > 0 ? `Quedan ${pendientes.length} lote(s) sin ninguna de las dos fuentes: ${pendientes.map((c) => c.lote8).join(", ")} (${n0(pendientes.reduce((s, c) => s + (c.kgEnParte ?? 0), 0))} kg según el parte). Ver hoja «Cobertura».` : "Ningún lote de estas parcelas se queda sin desglose. Ver la columna «De ellos, del Word» en «Cobertura»."}`
      : "Volcado del calibrador y partes diarios al mismo día: el informe está completo hasta esa fecha."),
    fila("Kg que vienen del Word en vez del volcado SQL", (p) => p.resumen.kgRespaldo, "kg", "Dato de respaldo: el Word solo trae la última pasada de cada día, el volcado las trae todas"),
    fila("Lotes de la parcela", (p) => p.nLotes, "int", "Todos los lotes entrados por báscula"),
    fila("Lotes con dato real del calibrador", (p) => p.nConDato, "int", "Los demás no han pasado por línea: ver hoja «Cobertura»"),
    fila("Pasadas analizadas", (p) => p.resumen.pasadas, "int", "Todas de un solo lote: cada kg es directamente atribuible"),
    fila("Kg entrada por báscula (todos los lotes)", (p) => p.kgEntradaTotal, "kg", "Referencia, NO la base de los porcentajes"),
    fila("Kg entrada de los lotes analizados", (p) => p.kgEntradaConDato, "kg", "La parte de la parcela que ya ha pasado por línea"),
    fila("Cobertura del informe", (p) => p.cobertura, "pct", "Sobre kg de entrada"),
    fila("KG PESADOS POR EL CALIBRADOR", (p) => p.resumen.kgSizer, "kg", "★ LA BASE de todos los porcentajes de abajo"),
    fila("Desfase calibrador vs báscula", desfaseParcela, "pct", "Sistemático en toda la campaña (+7,80 % en 904 lotes): desfase de tara, no fruta de otro sitio"),
    fila("% EXPORTACIÓN", (p) => p.resumen.pctExportacion, "pct", "Extra 1/2, Cat1 A/B y Verde Claro"),
    fila("% NO EXPORTACIÓN", (p) => p.resumen.pctNoExportacion, "pct", "Cat 2, Cat 3 y Verde Oscuro"),
    fila("% MUJERES", (p) => p.resumen.pctMujeres, "pct", "Fruta desviada a repaso manual"),
    fila("% NO COMERCIAL", (p) => p.resumen.pctNoComercial, "pct", "Industria, podrido y densidad"),
    fila("Podrido en el calibrador", (p) => p.resumen.kgPodrido, "kg", "Medido por la máquina, no prorrateado"),
    fila("% podrido en el calibrador", (p) => p.resumen.pctPodrido, "pct", "Solo el que descarta la máquina: la tría previa no se ve aquí"),
    fila("% clases aptas para Mercadona (A–F)", (p) => p.resumen.pctApta, "pct", "Techo teórico de lo que Mercadona podría aceptar"),
    ...METODOS_MDNA.map((m) => fila(`MERCADONA · ${LABEL_MDNA[m]}`, (p) => p.resumen.pctMdnaFormato[m], "pct",
      data.parcelas.map((p) => `${n0(p.resumen.mdna[m])} kg en ${p.etiqueta}`).join(" · "))),
    fila("MERCADONA · sin formato en el nombre", (p) => p.resumen.pctMdnaSinFormato, "pct", "Dice MDNA pero no declara formato: no se reparte a ojo"),
    fila("% MERCADONA TOTAL", (p) => p.resumen.pctMdna, "pct", "★ EL APROVECHAMIENTO DE MERCADONA de la parcela"),
    fila("Kg a Mercadona", (p) => p.resumen.mdnaTotal, "kg", "Kg reales clasificados en un producto de Mercadona"),
    fila("Apto A–F que NO fue a Mercadona", (p) => p.resumen.pctAptoFuera, "pct", "Fruta con calidad de Mercadona vendida a otros clientes"),
  ];
}

function hojaResumen(data: AprovechamientoReal): HojaTablaOptions {
  const cols = columnasParcelas(data);
  // La diferencia solo tiene sentido entre dos: con una no hay con qué comparar
  // y con tres o más no se sabe cuál restar a cuál.
  const dos = data.parcelas.length === 2 ? ([data.parcelas[0], data.parcelas[1]] as const) : null;
  const columnas: ColumnaTabla[] = [
    { header: "Concepto", key: "concepto", width: 42 },
    ...cols.map((c, i): ColumnaTabla => ({ header: c.etiqueta, key: `v${i}`, tipo: "numero", numFmt: "#,##0.00", width: 20 })),
    ...(dos ? [{ header: `Diferencia (${dos[1].etiqueta} − ${dos[0].etiqueta})`, key: "dif", tipo: "numero", numFmt: "#,##0.00", width: 24 } as ColumnaTabla] : []),
    { header: "Unidad", key: "unidad", width: 8 },
    { header: "Qué significa", key: "nota", width: 88 },
  ];
  const filas = definicionResumen(data).map((d) => {
    const fila: Record<string, unknown> = { concepto: d.concepto, unidad: UNIDAD_TXT[d.unidad], nota: d.nota };
    cols.forEach((c, i) => { fila[`v${i}`] = d.valor ? r2(d.valor(c)) : null; });
    if (dos) {
      const a = d.valor ? d.valor(dos[0]) : null;
      const b = d.valor ? d.valor(dos[1]) : null;
      fila.dif = a != null && b != null ? r2(b - a) : null;
    }
    return fila;
  });
  return {
    nombreHoja: "Resumen",
    titulo: `Aprovechamiento REAL de ${etiquetas(data)} · medido por el calibrador, sin estimar`,
    autofilter: false,
    columnas,
    filas,
  };
}

// ─── El resto de hojas ────────────────────────────────────────────────────────

function filasMetodologia(data: AprovechamientoReal, finca: string): Record<string, unknown>[] {
  const t = data.total;
  const f = data.frescura;
  const kgDocxTotal = t.resumen.kgRespaldo;
  const desfaseTotal = desfaseParcela(t);
  const compuestas = data.compuestas;
  const metodo: Array<[string, string]> = [
    ["Qué se ha medido", `Las ${t.resumen.pasadas} pasadas de calibrador de los ${t.nConDato} lotes (de ${t.nLotes}) de ${finca} · ${etiquetas(data)} que ya han pasado por línea. La fuente es la vista canónica del calibrador: el volcado SQL del Compac Sizer, que registra TODAS las pasadas de cada lote, y como respaldo el informe Word de lote, que solo trae la última de cada día (225 lotes de la campaña pasan más de una vez).`],
    ["Por qué esto SÍ es real", `Se ha comprobado pasada a pasada que ninguna nombra más de un lote (${compuestas.length} compuestas encontradas): no hay códigos que mezclen fruta de dos parcelas. Por eso cada kg que clasificó la máquina se atribuye directamente, sin prorrateo, sin conciliación y sin aplicar mezclas de otros lotes.${compuestas.length > 0 ? ` ¡AVISO! ${compuestas.map((c) => `«${c.nombre}» (${c.fuente})`).join(", ")}: el calibrador cargó esos kg enteros al primer código, así que para esas parcelas esto no es "real".` : ""}`],
    ["La base de los porcentajes", `Los kg que pesó el CALIBRADOR (${n0(t.resumen.kgSizer)} kg en las parcelas elegidas), no los de la báscula de entrada. Las dos básculas no coinciden: el calibrador pesa un +7,80 % de más en los 904 lotes de la campaña con volcado${desfaseTotal != null ? ` (aquí ${desfaseTotal >= 0 ? "+" : ""}${desfaseTotal.toFixed(2)} %)` : ""}. Como el desfase es sistemático y las pasadas son de un solo lote, no es fruta de otro sitio: es tara/calibración. Calcular los porcentajes sobre la entrada daría cifras que suman más del 100 %.`],
    ["Cobertura", `${n0(t.kgEntradaConDato)} kg analizados de ${n0(t.kgEntradaTotal)} kg entrados (${(t.cobertura ?? 0).toFixed(1)} %). Los lotes que faltan no se estiman ni se rellenan: cada uno tiene su motivo en la hoja «Cobertura».`],
    ["Hasta qué día llega el informe", `El volcado SQL del calibrador llega al ${f.ultimaPasadaSizer ?? "—"} (última sincronización: ${f.ultimaSincronizacion ?? "—"}), los informes Word de lote al ${f.ultimoInformeDocx ?? "—"} y los partes diarios al ${f.ultimoParte ?? "—"}. ${f.volcadoAtrasado ? `EL VOLCADO SQL VA POR DETRÁS, así que lo procesado después del ${f.ultimaPasadaSizer} entra por el Word (${n0(kgDocxTotal)} kg). Lo que no tenga ninguna de las dos fuentes sale en «Cobertura» como «pendiente volcado» — con sus kg reales del parte — y NUNCA como «en cámara».` : "Las fuentes están al mismo día."}`],
    ["Las dos fuentes del desglose", `El volcado SQL del Sizer es la fuente canónica: trae TODAS las pasadas de cada lote. El informe Word por producto y lote, que entra por el buzón de correo y se guarda con batch_id negativo, es el RESPALDO: solo trae la última pasada de cada día. La regla, la misma que aplica la vista canónica, es POR LOTE Y DÍA — si ese lote-día está en el volcado, manda el volcado; si no está, entra el Word. En este informe ${kgDocxTotal > 0 ? `${n0(kgDocxTotal)} kg vienen del Word (columna «De ellos, del Word» en «Cobertura»)` : "no ha hecho falta el Word: el volcado cubre todo"}.`],
    ["Qué NO dice este informe", "El podrido que se ve aquí es SOLO el que descarta la máquina. La tría que se retira antes de entrar al calibrador (bolsa y bateas) no se puede repartir por lote — se pesa por día y las bateas se vacían cada varios días — así que no aparece. Para la pérdida completa de fruta, con merma de cámara y podrido de tría, está Entradas → «Campaña»."],
    ["Clases aptas para Mercadona", "Extra 1, Extra 2, Cat1 A, Cat1 B, Verde Claro y Cat 2. Mujeres, Cat 3, Verde Oscuro, Industria, Podrido y Densidad no van a Mercadona nunca. Ojo: el volcado del Sizer escribe la clase sin la letra («Extra 1») y el Word con ella («(A) Extra 1»); se casan con la misma tabla que usa la base."],
    ["Los 4 formatos", `${METODOS_MDNA.map((m) => `${m} = ${LABEL_MDNA[m]}`).join(" · ")}. Se leen del nombre del producto que teclea el calibrador, con la misma función que usa la app. Lo que dice «MDNA» sin declarar formato se cuenta aparte.`],
    ["Los calibres", "La hoja «Calibres» no reparte kg entre tornillos: los rangos se solapan (un 3/54 vale para malla de 5 kg y para granel) y quien decide es la programación de la semana. Dice para qué SIRVE cada calibre, que es lo que permite ver si una parcela encaja con lo que Mercadona pide."],
  ];
  return metodo.map(([punto, texto]) => ({ punto, texto }));
}

/** Las hojas del libro a partir de `data`: pura, sin tocar la base (testeable). */
export function hojasAprovechamientoReal(data: AprovechamientoReal, finca: string): HojaTablaOptions[] {
  return [
    hojaResumen(data),
    {
      nombreHoja: "Clases y destinos",
      titulo: "Qué salió de la máquina, clase a clase (kg medidos)",
      columnas: [
        { header: "Parcela", key: "parcela", width: 22 },
        { header: "Destino", key: "destino", width: 18 },
        { header: "Clase", key: "clase", width: 16 },
        { header: "¿Apta MDNA?", key: "apta", width: 12 },
        kgCol("Kg", "kg"),
        pctCol("% sobre lo pesado", "pctSizer", 16),
      ],
      // La clase con su letra, como en la pantalla y en el Word ("(A) Extra 1").
      filas: data.parcelas.flatMap((p) => p.clases.map((c) => ({
        parcela: p.etiqueta, destino: c.destino, clase: `${c.letra ? `(${c.letra}) ` : ""}${c.clase}`, apta: c.apta ? "SÍ" : "no", kg: c.kg, pctSizer: c.pct,
      }))),
    },
    {
      nombreHoja: "Mercadona 4 formatos",
      titulo: "Aprovechamiento de Mercadona por formato · kg reales del calibrador",
      columnas: [
        { header: "Parcela", key: "parcela", width: 22 },
        { header: "Formato", key: "formato", width: 34 },
        kgCol("Kg", "kg"),
        pctCol("% sobre lo pesado", "pctSizer", 16),
        pctCol("% del total MDNA", "pctMdna", 16),
      ],
      filas: data.parcelas.flatMap((p) => {
        const r = p.resumen;
        return [
          ...METODOS_MDNA.map((m) => ({
            parcela: p.etiqueta, formato: `${LABEL_MDNA[m]} (${m})`, kg: r.mdna[m],
            pctSizer: r.pctMdnaFormato[m], pctMdna: pct(r.mdna[m], r.mdnaTotal),
          })),
          { parcela: p.etiqueta, formato: "Sin formato en el nombre", kg: r.mdnaSinFormato, pctSizer: r.pctMdnaSinFormato, pctMdna: pct(r.mdnaSinFormato, r.mdnaTotal) },
          { parcela: p.etiqueta, formato: "TOTAL MERCADONA", kg: r.mdnaTotal, pctSizer: r.pctMdna, pctMdna: r.mdnaTotal > 0 ? 100 : null },
          { parcela: p.etiqueta, formato: "Apto A–F vendido a otros clientes", kg: r.kgAptoFuera, pctSizer: r.pctAptoFuera, pctMdna: null },
          { parcela: p.etiqueta, formato: "No apto para Mercadona", kg: r.kgNoApta, pctSizer: r.pctNoApta, pctMdna: null },
        ];
      }),
    },
    {
      nombreHoja: "Calibres",
      titulo: "Calibre de la fruta apta para Mercadona y a qué tornillo puede ir",
      columnas: [
        { header: "Parcela", key: "parcela", width: 22 },
        { header: "Calibre", key: "calibre", width: 12 },
        kgCol("Kg aptos", "kg"),
        pctCol("% de lo apto", "pctApta", 13),
        { header: "Tornillos de Mercadona que admiten este calibre", key: "tornillos", width: 42 },
      ],
      filas: data.parcelas.flatMap((p) => p.calibres.map((c) => ({
        parcela: p.etiqueta, calibre: c.calibre, kg: c.kg, pctApta: c.pctApta, tornillos: c.tornillos,
      }))),
    },
    {
      nombreHoja: "Detalle lotes",
      titulo: "Un lote por fila: todo medido, nada prorrateado",
      columnas: [
        { header: "Parcela", key: "parcela", width: 22 },
        { header: "Lote", key: "lote", width: 11 },
        { header: "Entrada", key: "fecha", width: 11 },
        { header: "Pasadas", key: "pasadas", tipo: "numero", numFmt: FMT_INT, width: 9 },
        kgCol("Kg báscula", "kgEntrada", 14),
        kgCol("Kg calibrador", "kgSizer", 15),
        pctCol("Desfase", "desfase", 10),
        pctCol("% exportación", "pctExport", 13),
        pctCol("% no exportación", "pctNoExport", 14),
        pctCol("% mujeres", "pctMujeres", 11),
        pctCol("% no comercial", "pctNoComercial", 13),
        kgCol("Podrido kg", "kgPodrido", 13),
        pctCol("% podrido", "pctPodrido", 11),
        kgCol("MDNA 3 kg", "mdna3", 13),
        kgCol("MDNA 4 kg", "mdna4", 13),
        kgCol("MDNA 5 kg", "mdna5", 13),
        kgCol("MDNA granel", "mdna12", 13),
        kgCol("MDNA total", "mdnaTotal", 14),
        pctCol("% MDNA", "pctMdna", 11),
      ],
      // Los lotes con dato, vengan del volcado o del Word (la pantalla enseña los mismos).
      filas: data.lotes.flatMap((l) => {
        const r = l.resumen;
        if (!r) return [];
        return [{
          parcela: etiquetaParcela(l.parcela), lote: l.lote8, fecha: l.fecha, pasadas: l.pasadas,
          kgEntrada: l.kgEntrada, kgSizer: r.kgSizer, desfase: l.desfase,
          pctExport: r.pctExportacion, pctNoExport: r.pctNoExportacion, pctMujeres: r.pctMujeres, pctNoComercial: r.pctNoComercial,
          kgPodrido: r.kgPodrido, pctPodrido: r.pctPodrido,
          mdna3: r.mdna.MA3KGC, mdna4: r.mdna.MA4KGC, mdna5: r.mdna.MA5KGC, mdna12: r.mdna.MA12KGC,
          mdnaTotal: r.mdnaTotal, pctMdna: r.pctMdna,
        }];
      }),
    },
    {
      nombreHoja: "Cobertura",
      titulo: "Los lotes de las parcelas elegidas: cuáles entran en el análisis y por qué los demás no",
      columnas: [
        { header: "Parcela", key: "parcela", width: 22 },
        { header: "Lote", key: "lote", width: 11 },
        { header: "Entrada", key: "fecha", width: 11 },
        kgCol("Kg báscula", "kgEntrada", 14),
        { header: "¿Dato real?", key: "conDato", width: 16 },
        { header: "Pasadas", key: "pasadas", tipo: "numero", numFmt: FMT_INT, width: 9 },
        kgCol("Kg calibrador", "kgSizer", 15),
        kgCol("De ellos, del Word", "kgDocx", 18),
        kgCol("Kg según el parte (sin volcar)", "kgEnParte", 20),
        pctCol("Desfase", "desfase", 10),
        { header: "Motivo", key: "motivo", width: 88 },
      ],
      filas: data.lotes.map((l) => ({
        parcela: etiquetaParcela(l.parcela), lote: l.lote8, fecha: l.fecha, kgEntrada: l.kgEntrada, conDato: LABEL_ESTADO_DATO[l.estado], pasadas: l.pasadas,
        kgSizer: l.kgSizer, kgDocx: l.kgRespaldo, kgEnParte: l.kgEnParte, desfase: l.desfase, motivo: l.motivo,
      })),
    },
    {
      nombreHoja: "Metodología",
      titulo: "Cómo se ha calculado (y qué no dice)",
      autofilter: false,
      columnas: [
        { header: "Punto", key: "punto", width: 32 },
        { header: "Explicación", key: "texto", width: 150 },
      ],
      filas: filasMetodologia(data, finca),
    },
  ];
}

/** Metadatos de la banda de marca: finca y parcelas como filtro, y las fechas de entrada de sus lotes como periodo. */
export function metaAprovechamientoReal(data: AprovechamientoReal, opciones: OpcionesExportAprovechamiento): LasarteExportMeta {
  const fechas = data.lotes.map((l) => l.fecha).filter(Boolean).sort();
  return {
    titulo: `Aprovechamiento real — ${opciones.finca} · ${etiquetas(data)}`,
    periodo: fechas.length ? `Entradas ${fechas[0]} a ${fechas[fechas.length - 1]}` : undefined,
    usuario: opciones.usuario ?? undefined,
    filtros: `Finca: ${opciones.finca} · Parcelas: ${etiquetas(data)}`,
    clasificacion: "Dirección",
    generadoEn: opciones.generadoEn,
  };
}

/** Trozo de nombre de fichero: sin acentos, solo letras/números, guion bajo entre palabras ("INVERMARMELO - GG" → "INVERMARMELO_GG"). */
function segmentoFichero(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Convención del script: Aprovechamiento_<finca>_AAAA-MM-DD.xlsx. */
export function nombreFicheroAprovechamiento(finca: string, fecha: Date = new Date()): string {
  return `Aprovechamiento_${segmentoFichero(finca) || "finca"}_${fecha.toISOString().slice(0, 10)}.xlsx`;
}

/** Genera y descarga el Excel de la finca/parcelas elegidas con los datos ya calculados por la pantalla. */
export async function exportarAprovechamientoReal(data: AprovechamientoReal, opciones: OpcionesExportAprovechamiento): Promise<void> {
  const ctx = crearLibroLasarte(metaAprovechamientoReal(data, opciones));
  for (const hoja of hojasAprovechamientoReal(data, opciones.finca)) añadirHojaTabla(ctx, hoja);
  await descargarLibro(ctx, nombreFicheroAprovechamiento(opciones.finca, opciones.generadoEn));
}
