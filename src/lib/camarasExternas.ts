/**
 * camarasExternas.ts — fruta en cámaras EXTERNAS (Guadex / Zamexfruit / ...).
 *
 * La báscula registra cada camión como entrada en la FECHA DE ORIGEN (con los
 * papeles de la cámara), así que esa fruta ya existe en entradas_bascula y ya
 * cuenta como stock; lo que la app no sabía es DÓNDE está físicamente. Este
 * módulo importa el registro que lleva la propia cámara (una fila por camión,
 * formato "Registro_Control_Guadex" / "Control entradas"):
 *
 *   Fecha | S/Ref | Proveedor | Finca | Variedad | Envases | Kg. | Nt/Ref |
 *   Entrada1 | Entrada2 | Envases1 | Envases2 | Tte. A lst | Tte. A <cámara>
 *
 * Nt/Ref es directamente el lote de entradas_bascula (verificado 27-jul-2026
 * contra la BD: los 131 Nt/Ref del registro de Guadex y los 12 de Zamexfruit
 * existen como lote). La procedencia se detecta de la última cabecera
 * ("Tte. A Guadex" → GUADEX).
 *
 * REGLA DE ORO — el ESTADO NUNCA SE GUARDA, SE DERIVA en cada lectura de
 * datos que ya fluyen a diario, para que la sección funcione sola:
 *   1. Entrada1 con texto "Venta directa …"            → venta_directa
 *      (jamás llegará a la central: candidata a cierre "sin registro").
 *   2. lote con fecha_salida_camara (Excel de mermas)  → recibido (salida real)
 *   3. lote con pasadas de calibrador (partes diarios) → recibido (procesado)
 *   4. Entrada1/Entrada2 con fecha en el registro      → recibido (según registro)
 *   5. nada de lo anterior                             → EN CÁMARA: días
 *      acumulados y merma esperada (kg × TASA_MERMA_NATURAL_DIA × días).
 */
import { normalizarTexto } from "@/lib/format";
import { diffDias, parseFechaBascula } from "@/lib/entradasBascula";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { TASA_MERMA_NATURAL_DIA } from "@/lib/mermaLote";

export interface CamionCamaraExterna {
  procedencia: string;
  s_ref: string;
  lote: string | null;
  fecha_almacenamiento: string; // ISO
  proveedor: string | null;
  finca: string | null;
  variedad: string | null;
  envases: number | null;
  kg: number;
  entrada_lst_1: string | null;
  entrada_lst_2: string | null;
  envases_1: number | null;
  envases_2: number | null;
  venta_directa: string | null;
  nota_entrada: string | null;
  transporte_lst: string | null;
}

export interface ParseRegistroCamaraResult {
  registros: CamionCamaraExterna[];
  /** Procedencia detectada de la cabecera ("Tte. A Guadex" → "GUADEX"); null si no hay columna que la delate. */
  procedencia: string | null;
  descartadas: Array<{ fila: number; motivo: string }>;
}

function norm(value: unknown): string {
  return normalizarTexto(String(value ?? "")).trim();
}

function toEntero(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Parsea el registro de una cámara externa (hoja "Entradas total" o equivalente, cabeceras por texto). */
export function parseRegistroCamaraExternaRows(rows: unknown[][]): ParseRegistroCamaraResult {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(norm);
    return headers.some((h) => h === "s/ref")
      && headers.some((h) => h.startsWith("nt/ref"))
      && headers.some((h) => h.startsWith("kg"));
  });
  if (headerIndex === -1) {
    return { registros: [], procedencia: null, descartadas: [{ fila: 0, motivo: "No se encontró la cabecera (S/Ref / Nt/Ref / Kg.)" }] };
  }

  const headers = rows[headerIndex].map(norm);
  const col = (pred: (h: string) => boolean) => headers.findIndex(pred);
  const iFecha = col((h) => h === "fecha");
  const iRef = col((h) => h === "s/ref");
  const iProveedor = col((h) => h.startsWith("proveedor"));
  const iFinca = col((h) => h === "finca");
  const iVariedad = col((h) => h.startsWith("variedad"));
  const iEnvases = col((h) => h === "envases");
  const iKg = col((h) => h.startsWith("kg"));
  const iLote = col((h) => h.startsWith("nt/ref"));
  const iEntrada1 = col((h) => h === "entrada1");
  const iEntrada2 = col((h) => h === "entrada2");
  const iEnvases1 = col((h) => h === "envases1");
  const iEnvases2 = col((h) => h === "envases2");
  const iTteLst = col((h) => h.startsWith("tte. a lst") || h.startsWith("tte a lst"));
  // La columna "Tte. A <cámara>" delata la procedencia del registro.
  const iTteCamara = headers.findIndex((h, i) => i !== iTteLst && (h.startsWith("tte. a ") || h.startsWith("tte a ")));
  const procedencia = iTteCamara >= 0
    ? headers[iTteCamara].replace(/^tte\.? a /, "").trim().toUpperCase() || null
    : null;

  const registros: CamionCamaraExterna[] = [];
  const descartadas: Array<{ fila: number; motivo: string }> = [];

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const filaNum = headerIndex + offset + 2;
    if (row.every((c) => c == null || String(c).trim() === "")) return;
    const fecha = parseFechaBascula(row[iFecha]);
    const sRef = String(row[iRef] ?? "").trim();
    // Fila TOTAL del registro: solo trae el sumatorio de kg, sin fecha ni ref.
    if (!fecha && !sRef) return;
    if (!fecha) { descartadas.push({ fila: filaNum, motivo: "Sin fecha" }); return; }
    if (!sRef) { descartadas.push({ fila: filaNum, motivo: "Sin S/Ref" }); return; }
    const kg = Number(row[iKg]);
    if (!Number.isFinite(kg) || kg <= 0) { descartadas.push({ fila: filaNum, motivo: "Sin kg" }); return; }

    // Entrada1/Entrada2: fecha, texto de venta directa, "No aplica" o erratas.
    let ventaDirecta: string | null = null;
    let notaEntrada: string | null = null;
    const leerEntrada = (idx: number): string | null => {
      if (idx < 0) return null;
      const fechaEntrada = parseFechaBascula(row[idx]);
      if (fechaEntrada) return fechaEntrada;
      const texto = String(row[idx] ?? "").trim();
      if (!texto || norm(texto) === "no aplica") return null;
      if (/venta/i.test(texto)) ventaDirecta = texto;
      else notaEntrada = notaEntrada ? `${notaEntrada} · ${texto}` : texto;
      return null;
    };
    const entrada1 = leerEntrada(iEntrada1);
    const entrada2 = leerEntrada(iEntrada2);

    registros.push({
      procedencia: procedencia ?? "EXTERNA",
      s_ref: sRef,
      lote: iLote >= 0 ? (String(row[iLote] ?? "").trim() || null) : null,
      fecha_almacenamiento: fecha,
      proveedor: iProveedor >= 0 ? (String(row[iProveedor] ?? "").trim() || null) : null,
      finca: iFinca >= 0 ? (String(row[iFinca] ?? "").trim() || null) : null,
      variedad: iVariedad >= 0 ? (String(row[iVariedad] ?? "").trim() || null) : null,
      envases: iEnvases >= 0 ? toEntero(row[iEnvases]) : null,
      kg,
      entrada_lst_1: entrada1,
      entrada_lst_2: entrada2,
      envases_1: iEnvases1 >= 0 ? toEntero(row[iEnvases1]) : null,
      envases_2: iEnvases2 >= 0 ? toEntero(row[iEnvases2]) : null,
      venta_directa: ventaDirecta,
      nota_entrada: notaEntrada,
      transporte_lst: iTteLst >= 0 ? (String(row[iTteLst] ?? "").trim() || null) : null,
    });
  });

  return { registros, procedencia, descartadas };
}

// ─── Estado derivado ─────────────────────────────────────────────────────────

export type EstadoCamionExterno =
  | { estado: "venta_directa"; detalle: string }
  | { estado: "recibido"; fuente: "salida_camara" | "procesado" | "registro"; fecha: string | null }
  /** El registro dice que solo llegó una parte de los envases: el resto sigue en la cámara (caso real S26/100223: 6 de 72). */
  | { estado: "parcial"; dias: number; kgRestante: number; envasesRecibidos: number; envasesTotal: number; mermaEsperadaKg: number }
  | { estado: "en_camara"; dias: number; mermaEsperadaKg: number };

/** Señales vivas de la app para derivar el estado (todas por lote normalizado a 8 dígitos). */
export interface SenalesRecepcion {
  /** lote → fecha_salida_camara de entradas_bascula (import del Excel de mermas). */
  salidaPorLote: Map<string, string | null>;
  /** Lotes con alguna pasada de calibrador (lotes_dia): si se procesó, está aquí. */
  lotesProcesados: Set<string>;
}

/** Deriva el estado de un camión externo. NUNCA se persiste: se recalcula con cada render. */
export function estadoCamionExterno(camion: CamionCamaraExterna, senales: SenalesRecepcion, hoy: string): EstadoCamionExterno {
  if (camion.venta_directa) return { estado: "venta_directa", detalle: camion.venta_directa };
  const lote8 = normalizarLoteCodigo(camion.lote);
  // La salida MEDIDA (el camión se re-pesó al salir, Excel de mermas) manda:
  // significa que el camión completo dejó la cámara.
  if (lote8 && senales.salidaPorLote.has(lote8)) {
    return { estado: "recibido", fuente: "salida_camara", fecha: senales.salidaPorLote.get(lote8) ?? null };
  }
  // Llegada PARCIAL según el registro: vinieron algunos envases y el resto
  // sigue en la cámara (caso real S26/100223: 6 de 72 envases el 26-jun,
  // y sus pasadas de calibrador solo cubren esa parte). El kg restante se
  // prorratea por envases (la cámara no re-pesa las salidas parciales).
  const entrada = camion.entrada_lst_1 ?? camion.entrada_lst_2;
  const envasesRecibidos = (camion.envases_1 ?? 0) + (camion.envases_2 ?? 0);
  if (entrada && camion.envases != null && camion.envases > 0 && envasesRecibidos > 0 && envasesRecibidos < camion.envases) {
    const dias = diffDias(camion.fecha_almacenamiento, hoy);
    const kgRestante = camion.kg * (1 - envasesRecibidos / camion.envases);
    return {
      estado: "parcial",
      dias,
      kgRestante,
      envasesRecibidos,
      envasesTotal: camion.envases,
      mermaEsperadaKg: kgRestante * TASA_MERMA_NATURAL_DIA * dias,
    };
  }
  if (lote8 && senales.lotesProcesados.has(lote8)) {
    return { estado: "recibido", fuente: "procesado", fecha: null };
  }
  if (entrada) return { estado: "recibido", fuente: "registro", fecha: entrada };
  const dias = diffDias(camion.fecha_almacenamiento, hoy);
  return { estado: "en_camara", dias, mermaEsperadaKg: camion.kg * TASA_MERMA_NATURAL_DIA * dias };
}

// ─── Agregados para la UI ────────────────────────────────────────────────────

export interface CamionConEstado {
  camion: CamionCamaraExterna;
  estado: EstadoCamionExterno;
}

export interface CamaraExternaAgregado {
  /** Camiones total o parcialmente en cámara, los más antiguos primero (los parciales cuentan solo su kg restante). */
  enCamara: CamionConEstado[];
  /** Camiones con venta directa según el registro (candidatos a cierre "sin registro" si siguen activos). */
  ventasDirectas: CamionConEstado[];
  kgEnCamara: number;
  mermaEsperadaKg: number;
  diasMediosPonderados: number | null;
  recibidos: number;
  /** kg en cámara por procedencia, de mayor a menor. */
  porProcedencia: Array<{ procedencia: string; camiones: number; kg: number; mermaEsperadaKg: number }>;
}

/** kg que siguen físicamente en la cámara según el estado (0 si ya salió). */
export function kgEnCamaraDeEstado(camion: CamionCamaraExterna, estado: EstadoCamionExterno): number {
  if (estado.estado === "en_camara") return camion.kg;
  if (estado.estado === "parcial") return estado.kgRestante;
  return 0;
}

/**
 * Códigos de lote CONFIRMADOS físicamente en una cámara EXTERNA ahora mismo
 * (estado "en_camara": sin venta_directa, sin entrada_lst_1/2, sin
 * fecha_salida_camara y sin pasadas propias en lotes_dia — ver
 * estadoCamionExterno más arriba).
 *
 * REGLA DEL DUEÑO, 04-ago-2026 (ground truth nº2, prioridad máxima): "un
 * lote cuya señal de cámara externa diga que SIGUE EN CÁMARA NO PUEDE
 * recibir derrames de exceso en conciliarKgProcesados — es físicamente
 * imposible que fruta que está en Guadex haya pasado por el calibrador".
 * Caso real que destapó el bug: 4 lotes de Guadex (26052506, 26052207,
 * 26051106, 26050809, todos Invermarmelo) recibieron kg vía el derrame por
 * misma finca/variedad (exceso_misma_finca) de otros lotes reales de
 * Invermarmelo, y el auto-cierre por edad los cerró "con_analisis" — el
 * accidente exacto que esta función existe para impedir.
 *
 * Se exporta como un Set de códigos de 8 dígitos para que
 * conciliarKgProcesados (conciliacionKg.ts) pueda EXCLUIR estos lotes de sus
 * candidatos a derrame (fase 2) sin tener que importar este módulo — el
 * caller (useEntradasBascula.ts) construye el Set con `estadoCamionExterno`
 * y se lo inyecta como parámetro opcional. Solo cuenta "en_camara" (NO
 * "parcial": ese estado ya tiene entrada_lst_1/2 registrado, así que no
 * encaja en la descripción literal de la regla).
 */
export function codigosEnCamaraExterna(camiones: CamionCamaraExterna[], senales: SenalesRecepcion, hoy: string): Set<string> {
  const codigos = new Set<string>();
  for (const camion of camiones) {
    const lote8 = normalizarLoteCodigo(camion.lote);
    if (!lote8) continue;
    const estado = estadoCamionExterno(camion, senales, hoy);
    if (estado.estado === "en_camara") codigos.add(lote8);
  }
  return codigos;
}

export function agregarCamaraExterna(camiones: CamionCamaraExterna[], senales: SenalesRecepcion, hoy: string): CamaraExternaAgregado {
  const conEstado: CamionConEstado[] = camiones.map((camion) => ({ camion, estado: estadoCamionExterno(camion, senales, hoy) }));
  const enCamara = conEstado
    .filter((c) => c.estado.estado === "en_camara" || c.estado.estado === "parcial")
    .sort((a, b) => a.camion.fecha_almacenamiento.localeCompare(b.camion.fecha_almacenamiento) || a.camion.s_ref.localeCompare(b.camion.s_ref));
  const ventasDirectas = conEstado.filter((c) => c.estado.estado === "venta_directa");

  let kgEnCamara = 0;
  let mermaEsperadaKg = 0;
  let kgDias = 0;
  const acc = new Map<string, { camiones: number; kg: number; mermaEsperadaKg: number }>();
  for (const { camion, estado } of enCamara) {
    if (estado.estado !== "en_camara" && estado.estado !== "parcial") continue;
    const kg = kgEnCamaraDeEstado(camion, estado);
    kgEnCamara += kg;
    mermaEsperadaKg += estado.mermaEsperadaKg;
    kgDias += kg * estado.dias;
    const a = acc.get(camion.procedencia) ?? { camiones: 0, kg: 0, mermaEsperadaKg: 0 };
    a.camiones += 1;
    a.kg += kg;
    a.mermaEsperadaKg += estado.mermaEsperadaKg;
    acc.set(camion.procedencia, a);
  }

  return {
    enCamara,
    ventasDirectas,
    kgEnCamara,
    mermaEsperadaKg,
    diasMediosPonderados: kgEnCamara > 0 ? kgDias / kgEnCamara : null,
    recibidos: conEstado.filter((c) => c.estado.estado === "recibido").length,
    porProcedencia: [...acc.entries()]
      .map(([procedencia, a]) => ({ procedencia, ...a }))
      .sort((a, b) => b.kg - a.kg),
  };
}
