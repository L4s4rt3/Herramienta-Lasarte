// El Excel de Económico → Rentabilidad → «Por tipo de día» (TipoDiaEconomico.tsx):
// las mismas hojas y columnas que scripts/analisis-tipo-dia.ts, pero a partir
// de lo que useTipoDia YA tiene calculado para el rango de la pantalla. Aquí no
// se recalcula nada ni se toca la base: se proyecta al formato del informe y se
// descarga con exportKit, como el resto de exports de la app.
//
// Los kg salen siempre de la vista canónica del calibrador (la RPC
// rentabilidad_filas_dias, igual que la pantalla); la variante --fuente=tabla
// del script (lote_clasificacion, solo la última pasada del día) era para
// comparar con la versión del 27-08 y no tiene sentido aquí.
import type { TipoDiaResultado } from "@/hooks/useTipoDia";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  descargarLibro,
  FMT_EUR,
  FMT_INT,
  FMT_KG,
  type ColumnaTabla,
  type HojaTablaOptions,
  type LasarteExportMeta,
} from "./exportKit";
import { ESTANDAR_RENDIMIENTO, type EstandarRendimiento } from "./estandarRendimiento";
import { EUR_KG_MINIMO_FIABLE, KG_MINIMO_DIA, type FilaTipoDia } from "./tipoDia";

export interface OpcionesExportTipoDia {
  /** El rango pedido en la pantalla (AAAA-MM-DD); los días clasificados pueden empezar más tarde. */
  desde: string;
  hasta: string;
  /** Correo de quien exporta, para el pie de marca. Nunca "Herramienta Lasarte": eso no va en documentos. */
  usuario?: string | null;
  /** Solo para tests deterministas (sello); por defecto ahora. */
  generadoEn?: Date;
  /**
   * El estándar VIGENTE (tabla estandar_rendimiento). Se pasa porque desde el
   * 04-09-2026 el dueño lo edita en la app: el Excel tiene que citar el listón
   * con el que se midieron los días, no el que había cuando se escribió esto.
   */
  estandar?: EstandarRendimiento;
}

const eurCol = (header: string, key: string, width = 14): ColumnaTabla => ({ header, key, tipo: "numero", numFmt: FMT_EUR, width });
const kgCol = (header: string, key: string, width = 13): ColumnaTabla => ({ header, key, tipo: "numero", numFmt: FMT_KG, width });
const intCol = (header: string, key: string, width = 9): ColumnaTabla => ({ header, key, tipo: "numero", numFmt: FMT_INT, width });

// Las filas agregadas vienen tipadas de la lib compartida; añadirHojaTabla
// quiere objetos abiertos, así que se copian tal cual.
const filaAgregado = (f: FilaTipoDia): Record<string, unknown> => ({ ...f });

/** "2026-08-27" → "27-08": la fecha del estándar del dueño tal y como la cita el script. */
const diaMes = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;

/** Etiquetas de las semanas cuya tarifa Mercadona fija precios ("S31", "S32"…). */
export function semanasFiables(data: TipoDiaResultado): string[] {
  return data.semanas.filter((s) => s.fiable).map((s) => `S${s.semana}`);
}

/** Las hojas del libro a partir de `data`: pura, sin tocar la base (testeable). */
export function hojasTipoDia(data: TipoDiaResultado, est: EstandarRendimiento = ESTANDAR_RENDIMIENTO): HojaTablaOptions[] {
  const EST = est;
  const dias = data.dias;
  const fiables = semanasFiables(data);
  const diasConCuenta = data.totalCuenta?.dias ?? 0;
  return [
    {
      nombreHoja: "Por tipo de día",
      titulo: `ESTRUCTURA de los ${dias.length} días · reducida = ≤${EST.cortePlantillaReducida} presentes (media plantilla); 45 con faltas sigue siendo completa · bueno/malo contra el listón de SU régimen: completa ${EST.regimenes.completa.kgPersonaSuelo}/${EST.regimenes.completa.kgPersonaObjetivo} · reducida ${EST.regimenes.reducida.kgPersonaSuelo}/${EST.regimenes.reducida.kgPersonaObjetivo} kg/pers (estándar del dueño ${diaMes(EST.fecha)})`,
      autofilter: false,
      columnas: [
        { header: "Tipo de día", key: "tipo", width: 34 },
        intCol("Días", "dias", 8),
        kgCol("Kg/día", "kg"),
        intCol("Personas", "presentes", 10),
        kgCol("Kg/persona", "kgPersona", 12),
        eurCol("Personal/día", "personal"),
        { header: "Personal €/kg", key: "personalKg", tipo: "numero", numFmt: "#,##0.0000", width: 13 },
      ],
      filas: data.porTipo.map(filaAgregado),
      totales: filaAgregado(data.total),
    },
    {
      nombreHoja: "Cuenta completa",
      titulo: `La cuenta ENTERA (metodología v5) solo en los ${diasConCuenta} días con clasificación, asistencia en la base y tarifa Mercadona real (${fiables.length ? fiables.join(", ") : "ninguna semana fiable"})`,
      autofilter: false,
      columnas: [
        { header: "Tipo de día", key: "tipo", width: 34 },
        intCol("Días", "dias", 8),
        kgCol("Kg/día", "kg"),
        intCol("Personas", "presentes", 10),
        kgCol("Kg/persona", "kgPersona", 12),
        eurCol("Ingresos/día", "ingresos"),
        eurCol("Personal/día", "personal"),
        eurCol("Envase/día", "envase", 12),
        eurCol("Suministros", "suministros", 12),
        eurCol("MARGEN/día", "margen"),
        eurCol("Fruta/día", "fruta"),
        eurCol("BENEFICIO/día", "beneficio", 15),
        kgCol("Kg sin coste fruta", "kgSinFruta", 15),
      ],
      filas: data.porTipoCuenta.map(filaAgregado),
      totales: data.totalCuenta ? filaAgregado(data.totalCuenta) : undefined,
    },
    {
      nombreHoja: "Día a día",
      titulo: "Cada día con su tipo, su fuente y su cuenta (euros de venta solo donde la tarifa es real)",
      columnas: [
        { header: "Fecha", key: "fecha", width: 12 },
        { header: "Tipo", key: "tipo", width: 32 },
        { header: "Fuente", key: "fuente", width: 14 },
        intCol("Personas", "presentes", 10),
        kgCol("Kg", "kg"),
        kgCol("Kg/persona", "kgPersona", 12),
        eurCol("Personal", "personal"),
        eurCol("Ingresos", "ingresos"),
        eurCol("Margen", "margen"),
        eurCol("Fruta", "fruta"),
        eurCol("Beneficio", "beneficio"),
      ],
      // En orden cronológico, como el script (la pantalla los enseña del más reciente al más antiguo).
      filas: dias.map((d) => ({
        fecha: d.fecha, tipo: d.tipo, fuente: "base (v5)", presentes: d.presentes, kg: d.kg,
        kgPersona: d.kgPersona, personal: d.personalEur, ingresos: d.ingresos,
        margen: d.margen, fruta: d.fruta, beneficio: d.beneficio,
      })),
    },
    {
      nombreHoja: "Metodología",
      titulo: "Cómo leer este análisis",
      autofilter: false,
      columnas: [{ header: "Nota", key: "a", width: 46 }, { header: "Detalle", key: "b", width: 120 }],
      filas: [
        { a: "Plantilla completa / reducida", b: `Definición del dueño (${diaMes(EST.fecha)}): reducida = el régimen de media plantilla que empezó en agosto (25-30 presentes); un día de 45 es plantilla completa CON FALTAS. Corte: ≤${EST.cortePlantillaReducida} presentes. En los datos separa limpio los dos regímenes (mayo-julio 45-55; agosto 27-31).` },
        { a: "Bueno / medio / malo", b: `kg/persona contra el estándar DE SU RÉGIMEN (decisión del dueño ${diaMes(EST.fecha)}): plantilla completa suelo ${EST.regimenes.completa.kgPersonaSuelo} / objetivo ${EST.regimenes.completa.kgPersonaObjetivo}; media plantilla suelo ${EST.regimenes.reducida.kgPersonaSuelo} / objetivo ${EST.regimenes.reducida.kgPersonaObjetivo}. El kg/persona se diluye con plantilla grande, así que cada régimen tiene su listón — el mismo que usa el vigía de negocio, el semáforo del correo diario y los informes de la encargada.` },
        { a: "De dónde salen los kg", b: "La vista canónica del calibrador (volcado SQL del Sizer, TODAS las pasadas; Word de lote como respaldo por lote y día), vía la RPC rentabilidad_filas_dias: la misma fuente que la pantalla Económico → Rentabilidad → Por tipo de día." },
        { a: "La cuenta de cada día (donde la hay)", b: "computeRentabilidadDia, la MISMA función pura que /economico/rentabilidad y el informe semanal (v5, validada a mano el 03-08). Ingresos = kg×precio por destino; margen = ingresos − personal − envase − suministros; beneficio = margen − fruta al coste real de báscula. Sin Seguridad Social ni estructura: comparaciones entre días, sí; cuenta de resultados, no." },
        { a: "Precios Mercadona — por qué la cuenta entera solo va con tarifa real", b: `Una semana fija precios si su €/kg medio facturado (base sin IVA / kilos) llega a ${EUR_KG_MINIMO_FIABLE.toFixed(2)}; las que están a medio facturar (0,38-0,47 €/kg frente a 1,02 real) o sin base no valen: usarlas hundiría los ingresos como si fuera verdad. Un día usa su semana fiable o la última fiable anterior. Hoy: ${fiables.length ? fiables.join(", ") : "ninguna"}.` },
        { a: "Lo que se deja fuera", b: `${data.sinAsistencia.length} día(s) con producción sin asistencia en la base (no se pueden clasificar; al volcar la asistencia entran solos) y ${data.descartadosPorKg.length} por debajo de ${KG_MINIMO_DIA} kg (arranques). Un día con 'Kg sin coste fruta' > 0 tiene lotes con báscula sin liquidar: su beneficio es PARCIAL (null ≠ 0).` },
      ],
    },
  ];
}

/** Metadatos de la banda de marca: el periodo son los días clasificados (o el rango pedido si no hay ninguno). */
export function metaTipoDia(data: TipoDiaResultado, opciones: OpcionesExportTipoDia): LasarteExportMeta {
  const EST = opciones.estandar ?? ESTANDAR_RENDIMIENTO;
  const primero = data.dias[0]?.fecha ?? opciones.desde;
  const ultimo = data.dias[data.dias.length - 1]?.fecha ?? opciones.hasta;
  return {
    titulo: "Análisis económico por tipo de día (plantilla × rendimiento)",
    periodo: `${primero} a ${ultimo} · plantilla reducida = ≤${EST.cortePlantillaReducida} presentes (definición del dueño ${diaMes(EST.fecha)})`,
    usuario: opciones.usuario ?? undefined,
    filtros: `Rango pedido: ${opciones.desde} a ${opciones.hasta}`,
    clasificacion: "Dirección",
    generadoEn: opciones.generadoEn,
  };
}

/** Convención del script (Analisis_Economico_Tipo_de_Dia.xlsx) más el rango, que aquí lo elige la pantalla. */
export function nombreFicheroTipoDia(desde: string, hasta: string): string {
  return `Analisis_Economico_Tipo_de_Dia_${desde}_${hasta}.xlsx`;
}

/** Genera y descarga el Excel del rango con los datos ya calculados por la pantalla. */
export async function exportarTipoDia(data: TipoDiaResultado, opciones: OpcionesExportTipoDia): Promise<void> {
  const ctx = crearLibroLasarte(metaTipoDia(data, opciones));
  for (const hoja of hojasTipoDia(data, opciones.estandar ?? ESTANDAR_RENDIMIENTO)) añadirHojaTabla(ctx, hoja);
  await descargarLibro(ctx, nombreFicheroTipoDia(opciones.desde, opciones.hasta));
}
