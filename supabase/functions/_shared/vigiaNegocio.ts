/**
 * vigiaNegocio.ts — lib PURA (sin red) del vigía de NEGOCIO.
 *
 * El vigilante (saludTrabajos.ts) avisa cuando un trabajo automático deja de
 * dar señales. Este vigía avisa cuando los DATOS, estando vivos, cuentan algo
 * que cuesta dinero o que se está quedando sin hacer: sobrellenado de malla,
 * camiones SAF sin cuadrar con su Laadbon, albaranes viejos sin factura,
 * fruta parada en cámara, lotes con merma fuera de banda, partes con
 * descuadre o con estimaciones que nadie sustituye por el papel, días con
 * rendimiento por debajo del estándar del dueño, y cargas que se paran sin
 * que nadie lo note (la asistencia, la hoja semanal de Mercadona).
 *
 * Filosofía heredada del vigilante: si no pasa nada, NO se manda nada. El
 * correo llega solo cuando hay hallazgos nuevos (y los lunes, un resumen de
 * lo que sigue pendiente). Cada hallazgo lleva su "qué es" en lenguaje llano
 * y, cuando se puede, sus euros — el destinatario sale de secretos (admin).
 *
 * Dos clases de hallazgo:
 *  - "evento": algo que PASÓ un día concreto (un día de sobrellenado, un lote
 *    con merma alta). Se avisa una vez y queda en el histórico; no se
 *    "resuelve" porque no es un estado.
 *  - "estado": algo que SIGUE mal hasta que alguien lo arregla (albaranes sin
 *    factura, camión sin Laadbon). Se avisa al aparecer, se recuerda los
 *    lunes y se marca resuelto solo cuando deja de detectarse.
 *
 * VIVE EN _shared (patrón fotoLotesCoherencia/informeSemanal): lo importa la
 * edge function vigia-negocio (Deno) y lo prueba vitest desde
 * src/lib/vigiaNegocio.test.ts. Cero LLM: texto determinista.
 */
import type { MermaSemanaInforme, StockInforme } from "./informeSemanal.ts";
import { ESTANDAR_RENDIMIENTO, listonRegimen, regimenPlantilla, type EstandarRendimiento } from "./estandarRendimiento.ts";
import { claveSemanaIso, fechasSemanaIso, lunesDeSemanaIso, semanaIsoDe, type SemanaIso } from "./semanaIso.ts";
import { EUR_KG_MINIMO_FIABLE, semanasPrecio, type SemanaMdnaCruda } from "./tipoDia.ts";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type TipoHallazgo = "evento" | "estado";
export type SeveridadHallazgo = "aviso" | "atencion";

export interface Hallazgo {
  /** Regla que lo detectó ("sobrellenado-malla", "saf-cuadre", …). */
  regla: string;
  /** Identidad estable del hallazgo: la misma situación produce la misma clave. */
  clave: string;
  tipo: TipoHallazgo;
  /** "aviso" = dinero o dato doliendo hoy; "atencion" = pendiente que se acumula. */
  severidad: SeveridadHallazgo;
  titulo: string;
  detalle: string | null;
  /** Impacto en euros cuando se conoce (el correo va solo a admin). */
  eur: number | null;
  kg: number | null;
}

function toNum(v: unknown): number {
  return Number(v) || 0;
}

const DIA_MS = 86_400_000;

/** Días enteros entre dos fechas ISO (b − a). */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DIA_MS);
}

/** fecha ISO − n días. */
export function fechaMenosDias(fechaISO: string, n: number): string {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - n * DIA_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Formato es-ES (local al módulo, como informeSemanal)
// ---------------------------------------------------------------------------

const NF_ENTERO = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const NF_DECIMAL = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF_KG_CAJA = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtKg(v: number): string {
  return `${NF_ENTERO.format(Math.round(v))} kg`;
}

export function fmtEur(v: number): string {
  return `${NF_ENTERO.format(Math.round(v))} €`;
}

function fmtPct1(v: number): string {
  return `${NF_DECIMAL.format(v)} %`;
}

function fmtFecha(fechaISO: string): string {
  const [y, m, d] = fechaISO.split("-");
  return `${d}-${m}-${y}`;
}

// ---------------------------------------------------------------------------
// Regla 1 — Sobrellenado (o caja corta) de la malla Mercadona
// ---------------------------------------------------------------------------
// Mercadona factura 12,00 kg/caja (4 mallas de 3 kg) y EXIGE entregar ≥12,24
// (3,06/malla). Los palets se pesan de verdad en el ERP: la media real de
// kg/caja del día dice cuántos kilos se regalan por encima de lo exigido.
// El análisis del camión SAF 1 (28-08) midió +0,24 kg/caja = ~300 kg/día
// evitables; la consigna de la enmalladora se puede bajar sin riesgo.

export const KG_CAJA_FACTURADO = 12;
export const KG_CAJA_EXIGIDO = 12.24;
/** Por encima de exigido + este margen por caja se considera sobrellenado evitable. */
export const UMBRAL_EXCESO_KG_CAJA = 0.08;
/** Por debajo de esto la media del día es "caja corta": riesgo de rechazo. */
export const UMBRAL_CAJA_CORTA = 12.02;
/** Días con menos cajas de malla que esto no se evalúan (arranques, restos). */
export const MIN_CAJAS_MALLA_DIA = 100;
/** Rango de kg/caja que identifica el formato caja-de-mallas de 12 kg. */
const KG_CAJA_MALLA_MIN = 11;
const KG_CAJA_MALLA_MAX = 14;

export interface PaletVigiaRow {
  fecha: string;
  articulo: string | null;
  cliente: string | null;
  num_cajas: number | string | null;
  kg_netos: number | string | null;
  num_albaran_venta: string | null;
  num_factura: string | null;
  fecha_venta: string | null;
  importe_venta: number | string | null;
}

export interface SafCamionRow {
  lote: string;
  fecha: string | null;
  cajas: number | string | null;
  eur_caja: number | string | null;
  porte_eur: number | string | null;
  kg_neto_laadbon: number | string | null;
}

/**
 * €/kg de la fruta PUESTA en almacén según el último Laadbon registrado:
 * (cajas × €/caja + porte) / kg netos. Sirve para poner euros al sobrellenado.
 */
export function costePuestoDesdeCamiones(camiones: SafCamionRow[]): number | null {
  const conDatos = camiones
    .filter((c) => toNum(c.kg_neto_laadbon) > 0 && toNum(c.cajas) > 0 && toNum(c.eur_caja) > 0)
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));
  const c = conDatos[0];
  if (!c) return null;
  return (toNum(c.cajas) * toNum(c.eur_caja) + toNum(c.porte_eur)) / toNum(c.kg_neto_laadbon);
}

export function reglaSobrellenadoMalla(
  palets: PaletVigiaRow[],
  fechas: string[],
  costePuestoEurKg: number | null,
): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const fecha of fechas) {
    let kg = 0;
    let cajas = 0;
    for (const p of palets) {
      if (p.fecha !== fecha) continue;
      const nCajas = toNum(p.num_cajas);
      const nKg = toNum(p.kg_netos);
      if (nCajas <= 0 || nKg <= 0) continue;
      const kgCaja = nKg / nCajas;
      if (kgCaja < KG_CAJA_MALLA_MIN || kgCaja > KG_CAJA_MALLA_MAX) continue;
      kg += nKg;
      cajas += nCajas;
    }
    if (cajas < MIN_CAJAS_MALLA_DIA) continue;

    const media = kg / cajas;
    const excesoKg = kg - cajas * KG_CAJA_EXIGIDO;
    if (media - KG_CAJA_EXIGIDO > UMBRAL_EXCESO_KG_CAJA) {
      const eur = costePuestoEurKg != null ? excesoKg * costePuestoEurKg : null;
      out.push({
        regla: "sobrellenado-malla",
        clave: `sobrellenado-malla|${fecha}`,
        tipo: "evento",
        severidad: "aviso",
        titulo: `Sobrellenado de malla el ${fmtFecha(fecha)}: ${NF_KG_CAJA.format(media)} kg/caja de media (lo exigido es 12,24) — ${fmtKg(excesoKg)} regalados${eur != null ? ` (~${fmtEur(eur)})` : ""}`,
        detalle: `${NF_ENTERO.format(cajas)} cajas pesadas en el ERP. Bajar la consigna de la enmalladora acerca la media a 12,24 sin riesgo de caja corta (dispersión medida el 28-08: 12,40–12,60).`,
        eur,
        kg: excesoKg,
      });
    } else if (media < UMBRAL_CAJA_CORTA) {
      out.push({
        regla: "caja-corta",
        clave: `caja-corta|${fecha}`,
        tipo: "evento",
        severidad: "aviso",
        titulo: `Caja corta el ${fmtFecha(fecha)}: ${NF_KG_CAJA.format(media)} kg/caja de media — por debajo del 12,24 exigido hay riesgo de rechazo de Mercadona`,
        detalle: `${NF_ENTERO.format(cajas)} cajas pesadas en el ERP ese día.`,
        eur: null,
        kg: kg - cajas * KG_CAJA_EXIGIDO,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regla 2 — Cuadre de camiones SAF con su Laadbon
// ---------------------------------------------------------------------------
// El precio REAL del camión es el del Laadbon de HG (€/caja). El alta del ERP
// se hace a €/kg y puede valorar de más o de menos: en el camión 1 fueron
// 1.790 € de más (alta 21.230 vs Laadbon 19.440). La tabla saf_camiones
// guarda lo que dice el Laadbon; esta regla lo contrasta con el alta.

/** Diferencia alta-vs-Laadbon a partir de la cual se avisa. */
export const UMBRAL_CUADRE_SAF_EUR = 200;
/** Días de gracia para registrar el Laadbon de una entrada SAF nueva. */
export const DIAS_GRACIA_LAADBON = 1;

export interface EntradaSafVigiaRow {
  lote: string;
  fecha: string;
  kg_entrada: number | string | null;
  importe_compra: number | string | null;
}

export function reglaCuadreSaf(
  camiones: SafCamionRow[],
  entradas: EntradaSafVigiaRow[],
  hoy: string,
): Hallazgo[] {
  const out: Hallazgo[] = [];
  const camionPorLote = new Map(camiones.map((c) => [c.lote, c]));
  const entradaPorLote = new Map(entradas.map((e) => [e.lote, e]));

  for (const e of entradas) {
    const c = camionPorLote.get(e.lote);
    if (!c) {
      if (diasEntre(e.fecha, hoy) >= DIAS_GRACIA_LAADBON) {
        out.push({
          regla: "saf-sin-laadbon",
          clave: `saf-sin-laadbon|${e.lote}`,
          tipo: "estado",
          severidad: "atencion",
          titulo: `Camión SAF ${e.lote} (${fmtFecha(e.fecha)}, ${fmtKg(toNum(e.kg_entrada))}) sin su Laadbon registrado: no se puede cuadrar el alta del ERP con el precio real`,
          detalle: `Registrar cajas y €/caja del Laadbon de HG en la tabla saf_camiones (con el porte). El alta del ERP valora ${fmtEur(toNum(e.importe_compra))}.`,
          eur: null,
          kg: toNum(e.kg_entrada),
        });
      }
      continue;
    }
    const esperado = toNum(c.cajas) * toNum(c.eur_caja);
    if (esperado <= 0) continue;
    const alta = toNum(e.importe_compra);
    const dif = alta - esperado;
    if (Math.abs(dif) > UMBRAL_CUADRE_SAF_EUR) {
      out.push({
        regla: "saf-cuadre",
        clave: `saf-cuadre|${e.lote}`,
        tipo: "estado",
        severidad: "aviso",
        titulo: `El alta del ERP del camión SAF ${e.lote} valora ${fmtEur(Math.abs(dif))} de ${dif > 0 ? "MÁS" : "MENOS"} que su Laadbon (${fmtEur(alta)} vs ${fmtEur(esperado)})`,
        detalle: `Laadbon: ${NF_ENTERO.format(toNum(c.cajas))} cajas × ${NF_KG_CAJA.format(toNum(c.eur_caja))} €/caja. Cotejar con la factura de HG y corregir la valoración de la entrada en el ERP.`,
        eur: dif,
        kg: null,
      });
    }
  }

  // Laadbon registrado cuya entrada no aparece: casi siempre un lote mal tecleado.
  for (const c of camiones) {
    if (entradaPorLote.has(c.lote)) continue;
    if (c.fecha && diasEntre(c.fecha, hoy) >= 3) {
      out.push({
        regla: "saf-sin-entrada",
        clave: `saf-sin-entrada|${c.lote}`,
        tipo: "estado",
        severidad: "atencion",
        titulo: `El Laadbon del camión SAF ${c.lote} está registrado pero no hay entrada con ese lote: revisar el código`,
        detalle: null,
        eur: null,
        kg: null,
      });
    }
  }
  return out;
}
// ---------------------------------------------------------------------------
// Regla 2b: correcciones ERP ↔ app pendientes de revisar
// ---------------------------------------------------------------------------
// sincronizar-entradas-erp.mjs no pisa una entrada cuando el ERP y la app
// tienen dato distinto: lo deja en erp_correcciones (foto actual, ver la
// migración 20260902094925). Cada lote con discrepancias es UN estado: se avisa
// al aparecer, se recuerda los lunes y se cierra solo cuando el sincronizador
// deja de verlo (alguien corrigió el ERP o la app).

export interface ErpCorreccionRow {
  lote: string;
  fecha: string | null;
  campo: string;
  en_la_app: string | null;
  en_el_erp: string | null;
  detectada_en: string;
  /** Alguien (admin) la dio por diferencia conocida: el vigía no la cuenta. */
  aceptada_en?: string | null;
}

/** Campos cuyo choque se traduce a euros o kilos en el hallazgo. */
const CAMPOS_EUR = new Set(["importe_compra", "importe_transporte"]);
const CAMPOS_KG = new Set(["kg_entrada", "kg_bruto_bascula"]);

export function reglaCorreccionesErp(filas: ErpCorreccionRow[], hoy: string): Hallazgo[] {
  const porLote = new Map<string, ErpCorreccionRow[]>();
  for (const f of filas) {
    if (f.aceptada_en) continue;
    if (!porLote.has(f.lote)) porLote.set(f.lote, []);
    porLote.get(f.lote)!.push(f);
  }
  const out: Hallazgo[] = [];
  for (const [lote, difs] of [...porLote.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    difs.sort((a, b) => a.campo.localeCompare(b.campo));
    const desde = difs.map((d) => d.detectada_en.slice(0, 10)).sort()[0];
    const dias = diasEntre(desde, hoy);
    let eur = 0;
    let kg = 0;
    for (const d of difs) {
      const dif = toNum(d.en_el_erp) - toNum(d.en_la_app);
      if (CAMPOS_EUR.has(d.campo)) eur += dif;
      if (CAMPOS_KG.has(d.campo)) kg += dif;
    }
    const fecha = difs[0].fecha;
    const lista = difs.map((d) => `${d.campo}: app «${d.en_la_app ?? "—"}» / ERP «${d.en_el_erp ?? "—"}»`).join(" · ");
    out.push({
      regla: "correccion-erp",
      clave: `correccion-erp|${lote}`,
      tipo: "estado",
      severidad: eur !== 0 ? "aviso" : "atencion",
      titulo: `La entrada ${lote}${fecha ? ` (${fmtFecha(fecha)})` : ""} no dice lo mismo en el ERP que en la Herramienta: ${difs.length} campo${difs.length === 1 ? "" : "s"}` +
        (dias > 0 ? `, desde hace ${dias} día${dias === 1 ? "" : "s"}` : ""),
      detalle: `${lista}. La sincronización no pisa un dato que ya existe: hay que decidir cuál de los dos es el bueno y corregirlo donde toque — o, si es una diferencia conocida (p. ej. importación por neto vs báscula), aceptarla en Datos → Importación SAF.`,
      eur: eur !== 0 ? eur : null,
      kg: kg !== 0 ? kg : null,
    });
  }
  return out;
}


// ---------------------------------------------------------------------------
// Regla 3 — Dinero parado: albaranes de venta viejos sin factura
// ---------------------------------------------------------------------------
// Un palet vendido sin factura a los 30 días es dinero sin cobrar o una
// liquidación de consignación que no ha llegado (bruto − 10,65 %). Se agrupa
// por cliente para que se lea de un vistazo. OJO: importe 0 = SIN VALORAR
// (regla de la casa), no gratis.

export const DIAS_UMBRAL_SIN_FACTURA = 30;

export function reglaDineroParado(palets: PaletVigiaRow[], hoy: string): Hallazgo[] {
  interface Acc { n: number; kg: number; eur: number; nSinValorar: number; masViejo: string }
  const porCliente = new Map<string, Acc>();
  for (const p of palets) {
    if (!p.num_albaran_venta || p.num_factura) continue;
    const venta = p.fecha_venta;
    if (!venta || diasEntre(venta, hoy) < DIAS_UMBRAL_SIN_FACTURA) continue;
    const cliente = (p.cliente ?? "").trim() || "(sin cliente)";
    let acc = porCliente.get(cliente);
    if (!acc) {
      acc = { n: 0, kg: 0, eur: 0, nSinValorar: 0, masViejo: venta };
      porCliente.set(cliente, acc);
    }
    acc.n += 1;
    acc.kg += toNum(p.kg_netos);
    const importe = toNum(p.importe_venta);
    if (importe > 0) acc.eur += importe;
    else acc.nSinValorar += 1;
    if (venta < acc.masViejo) acc.masViejo = venta;
  }

  const out: Hallazgo[] = [];
  for (const [cliente, a] of [...porCliente.entries()].sort((x, y) => y[1].eur - x[1].eur)) {
    out.push({
      regla: "dinero-parado",
      clave: `dinero-parado|${cliente}`,
      tipo: "estado",
      severidad: "atencion",
      titulo: `${cliente}: ${a.n} palet(s) vendidos hace más de ${DIAS_UMBRAL_SIN_FACTURA} días sin factura (${fmtKg(a.kg)}${a.eur > 0 ? `, ${fmtEur(a.eur)} valorados` : ""}${a.nSinValorar > 0 ? `, ${a.nSinValorar} sin valorar` : ""})`,
      detalle: `El más viejo se vendió el ${fmtFecha(a.masViejo)}. Si es consignación, falta su liquidación; si no, falta facturar.`,
      eur: a.eur > 0 ? a.eur : null,
      kg: a.kg,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regla 4 — Palets confeccionados que no se venden
// ---------------------------------------------------------------------------
// Confección parada = coste hecho sin ingreso. Solo mira la ventana reciente
// (los restos de campañas pasadas y los palets desmontados no son novedad).

export const DIAS_UMBRAL_SIN_VENDER = 14;
export const VENTANA_SIN_VENDER_DIAS = 60;
export const KG_MIN_SIN_VENDER = 3000;

export function reglaSinVender(palets: PaletVigiaRow[], hoy: string): Hallazgo[] {
  const desde = fechaMenosDias(hoy, VENTANA_SIN_VENDER_DIAS);
  const hasta = fechaMenosDias(hoy, DIAS_UMBRAL_SIN_VENDER);
  let n = 0;
  let kg = 0;
  let masViejo: string | null = null;
  for (const p of palets) {
    if (p.num_albaran_venta || toNum(p.num_cajas) <= 0) continue;
    if (p.fecha < desde || p.fecha > hasta) continue;
    n += 1;
    kg += toNum(p.kg_netos);
    if (!masViejo || p.fecha < masViejo) masViejo = p.fecha;
  }
  if (kg < KG_MIN_SIN_VENDER || !masViejo) return [];
  return [{
    regla: "sin-vender",
    clave: "sin-vender|global",
    tipo: "estado",
    severidad: "atencion",
    titulo: `${n} palet(s) confeccionados hace más de ${DIAS_UMBRAL_SIN_VENDER} días siguen sin venderse (${fmtKg(kg)})`,
    detalle: `El más viejo es del ${fmtFecha(masViejo)}. Confección pagada esperando destino.`,
    eur: null,
    kg,
  }];
}

// ---------------------------------------------------------------------------
// Regla 5 — Fruta parada en cámara
// ---------------------------------------------------------------------------
// La cámara come fruta cada día (~0,05 %/día medido en campaña). El stock es
// el MISMO de la pestaña Stock de Entradas (buildStockEntradas).

export const DIAS_UMBRAL_FRUTA_PARADA = 15;
export const KG_MIN_FRUTA_PARADA = 5000;

export function reglaFrutaParada(stock: StockInforme | null): Hallazgo[] {
  if (!stock) return [];
  if (stock.antiguedadMaxDias < DIAS_UMBRAL_FRUTA_PARADA || stock.kgEnCamara < KG_MIN_FRUTA_PARADA) return [];
  return [{
    regla: "fruta-parada",
    clave: "fruta-parada|global",
    tipo: "estado",
    severidad: "atencion",
    titulo: `Fruta parada en cámara: ${fmtKg(stock.kgEnCamara)} con el lote sin terminar más antiguo a ${stock.antiguedadMaxDias} días`,
    detalle: `${stock.lotesPendientes} lote(s) sin empezar y ${stock.lotesParciales} a medias. A la tasa de cámara (~0,05 %/día) cada semana parada pierde ~${fmtKg(stock.kgEnCamara * 0.0005 * 7)}.`,
    eur: null,
    kg: stock.kgEnCamara,
  }];
}

// ---------------------------------------------------------------------------
// Regla 6 — Lotes terminados con merma fuera de banda
// ---------------------------------------------------------------------------
// Sobre los lotes TERMINADOS en la ventana (misma cuenta que la pestaña
// "Mermas y coste" vía seleccionarMermaSemana). El ⚠ de calibrador>báscula
// no entra: eso es dato a revisar, no merma.

export const PCT_MERMA_FUERA_DE_BANDA = 5;
export const KG_ENTRADA_MIN_MERMA = 3000;

export function reglaMermaFueraDeBanda(merma: MermaSemanaInforme | null): Hallazgo[] {
  if (!merma) return [];
  const out: Hallazgo[] = [];
  for (const l of merma.lotes) {
    if (l.calibradorSuperaEntrada) continue;
    if (l.kgEntrada < KG_ENTRADA_MIN_MERMA) continue;
    if ((l.pctMerma ?? 0) <= PCT_MERMA_FUERA_DE_BANDA) continue;
    out.push({
      regla: "merma-lote",
      clave: `merma-lote|${l.lote}`,
      tipo: "evento",
      severidad: "aviso",
      titulo: `El lote ${l.lote}${l.agricultor ? ` (${l.agricultor})` : ""} terminó con ${fmtPct1(l.pctMerma ?? 0)} de merma: ${fmtKg(l.mermaNaturalKg ?? 0)} sobre ${fmtKg(l.kgEntrada)} de entrada`,
      detalle: l.diasEnCamara != null ? `${l.diasEnCamara} día(s) en cámara. Misma cuenta que «Entradas → Mermas y coste».` : "Misma cuenta que «Entradas → Mermas y coste».",
      eur: null,
      kg: l.mermaNaturalKg,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regla 7 — Partes: descuadres, borradores y papel sin meter
// ---------------------------------------------------------------------------

export interface ParteVigiaRow {
  date: string;
  estado: string;
  campos_estimados: {
    campos?: Record<string, unknown>;
    estimado_at?: string;
    gracia_dias?: number;
  } | null;
}

export const DIAS_BORRADOR_ESTANCADO = 3;
/** Margen sobre la gracia de la estimación antes de considerar el papel perdido. */
export const DIAS_MARGEN_PAPEL = 2;
export const DIAS_UMBRAL_SIN_VALIDAR = 7;

export function reglaPartes(partes: ParteVigiaRow[], hoy: string): Hallazgo[] {
  const out: Hallazgo[] = [];
  let nPapel = 0;
  let papelMasViejo: string | null = null;
  let nSinValidar = 0;
  let sinValidarMasViejo: string | null = null;

  for (const p of partes) {
    if (p.estado === "Con descuadre") {
      out.push({
        regla: "parte-descuadre",
        clave: `parte-descuadre|${p.date}`,
        tipo: "evento",
        severidad: "aviso",
        titulo: `El parte del ${fmtFecha(p.date)} quedó CON DESCUADRE: el análisis no cierra con las fuentes`,
        detalle: "Abrir el parte en la app y revisar la cascada del día.",
        eur: null,
        kg: null,
      });
    }
    if (p.estado === "Borrador" && diasEntre(p.date, hoy) >= DIAS_BORRADOR_ESTANCADO) {
      out.push({
        regla: "parte-borrador",
        clave: `parte-borrador|${p.date}`,
        tipo: "estado",
        severidad: "atencion",
        titulo: `El parte del ${fmtFecha(p.date)} lleva ${diasEntre(p.date, hoy)} días en Borrador sin analizarse`,
        detalle: null,
        eur: null,
        kg: null,
      });
    }
    const est = p.campos_estimados;
    if (est && est.campos && Object.keys(est.campos).length > 0) {
      const gracia = toNum(est.gracia_dias) || 2;
      if (diasEntre(p.date, hoy) > gracia + DIAS_MARGEN_PAPEL) {
        nPapel += 1;
        if (!papelMasViejo || p.date < papelMasViejo) papelMasViejo = p.date;
      }
    }
    if (p.estado === "Analizado" && diasEntre(p.date, hoy) >= DIAS_UMBRAL_SIN_VALIDAR) {
      nSinValidar += 1;
      if (!sinValidarMasViejo || p.date < sinValidarMasViejo) sinValidarMasViejo = p.date;
    }
  }

  if (nPapel > 0 && papelMasViejo) {
    out.push({
      regla: "papel-sin-meter",
      clave: "papel-sin-meter|global",
      tipo: "estado",
      severidad: "atencion",
      titulo: `${nPapel} parte(s) siguen con datos ESTIMADOS pasada su gracia: el papel de planta no se ha tecleado y el dato real gana siempre`,
      detalle: `El más viejo es del ${fmtFecha(papelMasViejo)}. Reabrir el parte con el botón de la app y teclear el papel.`,
      eur: null,
      kg: null,
    });
  }
  if (nSinValidar > 0 && sinValidarMasViejo) {
    out.push({
      regla: "partes-sin-validar",
      clave: "partes-sin-validar|global",
      tipo: "estado",
      severidad: "atencion",
      titulo: `${nSinValidar} parte(s) analizados llevan más de ${DIAS_UMBRAL_SIN_VALIDAR} días sin el candado humano (Validado)`,
      detalle: `El más viejo es del ${fmtFecha(sinValidarMasViejo)}. Validar es el repaso de una persona, no un trámite del sistema.`,
      eur: null,
      kg: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regla 8 — Rendimiento por debajo del estándar del dueño
// ---------------------------------------------------------------------------
// Estándar POR RÉGIMEN: sale de la tabla estandar_rendimiento (la edita el
// admin en la app desde el 04-09-2026); el respaldo es el del 27-08-2026:
// con plantilla completa (≥35 presentes) un día bueno son ≥2.100 kg/persona y
// por debajo de 1.700 es rojo; con media plantilla (<35) la gente rinde más:
// ≥2.600 bueno, <2.200 rojo. La asistencia se vuelca los lunes por semanas
// completas: esta regla evalúa los días que ya tienen asistencia, cuando llega.

// El estándar vive en estandarRendimiento.ts, la MISMA fuente que la vista
// "Por tipo de día" de la app y los scripts (03-09-2026). Aquí solo se aplica.
// Ojo al borde: 35 presentes es media plantilla (≤35), como en el JSON de los
// informes de la encargada; esta regla lo tenía al revés.

export interface DiaRendimientoVigia {
  fecha: string;
  /** Kg calibrados del día (Informe LOTE). */
  kg: number;
  presentes: number;
}

export function reglaRendimiento(dias: DiaRendimientoVigia[], est: EstandarRendimiento = ESTANDAR_RENDIMIENTO): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const d of dias) {
    if (d.kg <= 0 || d.presentes <= 0) continue;
    const reg = regimenPlantilla(d.presentes, est);
    const liston = listonRegimen(reg, est);
    const regimen = { rojo: liston.kgPersonaSuelo, verde: liston.kgPersonaObjetivo, nombre: reg === "completa" ? "plantilla completa" : "media plantilla" };
    const kgPersona = d.kg / d.presentes;
    if (kgPersona >= regimen.rojo) continue;
    out.push({
      regla: "rendimiento-rojo",
      clave: `rendimiento-rojo|${d.fecha}`,
      tipo: "evento",
      severidad: "aviso",
      titulo: `Día rojo de rendimiento el ${fmtFecha(d.fecha)}: ${fmtKg(kgPersona)} por persona con ${d.presentes} presentes (estándar de ${regimen.nombre}: rojo <${NF_ENTERO.format(regimen.rojo)}, bueno ≥${NF_ENTERO.format(regimen.verde)})`,
      detalle: `${fmtKg(d.kg)} calibrados. Un día corto reparte el mismo personal entre pocos kilos: si fue arranque o falta de pedidos, es la explicación; si no, toca mirar la línea.`,
      eur: null,
      kg: d.kg,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regla 9 — El detalle del calibrador contra el parte, día a día
// ---------------------------------------------------------------------------
// Desde el 31-08 la vista clasificacion_lote mezcla las tres fuentes (volcado
// SQL, import manual del Excel y DOCX del buzón) con la regla de frescura por
// lote-día. Esta regla compara sus kg diarios con los del PARTE (lotes_dia):
//  - detalle a CERO con producción = alguna fuente nueva se ha vuelto a caer
//    (así se descubrió el hueco del 11 al 31-08);
//  - detalle CORTO = falta una pasada (p. ej. un DOCX re-guardado que pisó a
//    la primera del día);
//  - detalle LARGO = algo se está contando dos veces (una regresión de la
//    propia vista, mejor que la cace esto y no un informe).

export const KG_MIN_SIN_DETALLE = 1000;
/** El detalle por debajo de esta fracción del parte se considera incompleto. */
export const FRACCION_DETALLE_CORTO = 0.85;
/** El detalle por encima de esta fracción del parte huele a doble conteo. */
export const FRACCION_DETALLE_LARGO = 1.15;

export interface DiaDetalleCalibrador {
  fecha: string;
  /** Kg de producción del parte (lotes_dia) ese día. */
  kgParte: number;
  /** Kg de la vista clasificacion_lote ese día (las tres fuentes mezcladas). */
  kgDetalle: number;
}

function hallazgoDetalle(
  regla: string,
  titulo: (n: number, kg: number) => string,
  detalle: string,
  dias: DiaDetalleCalibrador[],
): Hallazgo[] {
  if (dias.length === 0) return [];
  const ordenados = [...dias].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const kg = ordenados.reduce((s, d) => s + d.kgParte, 0);
  const lista = ordenados.map((d) => fmtFecha(d.fecha)).join(", ");
  return [{
    regla,
    clave: `${regla}|global`,
    tipo: "estado",
    severidad: "atencion",
    titulo: titulo(ordenados.length, kg),
    detalle: `Días: ${lista}. ${detalle}`,
    eur: null,
    kg,
  }];
}

export function reglaDetalleCalibrador(dias: DiaDetalleCalibrador[]): Hallazgo[] {
  const conProduccion = dias.filter((d) => d.kgParte >= KG_MIN_SIN_DETALLE);
  const ciegos = conProduccion.filter((d) => d.kgDetalle <= 0);
  const cortos = conProduccion.filter((d) => d.kgDetalle > 0 && d.kgDetalle < d.kgParte * FRACCION_DETALLE_CORTO);
  const largos = conProduccion.filter((d) => d.kgDetalle > d.kgParte * FRACCION_DETALLE_LARGO);
  return [
    ...hallazgoDetalle(
      "sin-detalle-calibrador",
      (n, kg) => `${n} día(s) con producción en el parte pero SIN detalle del calibrador (${fmtKg(kg)}): Rentabilidad y el informe semanal están ciegos esos días`,
      "La vista clasificacion_lote no tiene filas de ninguna fuente (volcado, Excel ni DOCX): revisar el buzón y, si el DOCX no llegó, importar el Excel en /importar.",
      ciegos,
    ),
    ...hallazgoDetalle(
      "detalle-corto-calibrador",
      (n) => `${n} día(s) con el detalle del calibrador INCOMPLETO (menos del 85 % de los kg del parte): probablemente falta una pasada`,
      "Suele ser un DOCX re-guardado que pisó a la primera pasada del día. Importar el Excel de esos días lo completa.",
      cortos,
    ),
    ...hallazgoDetalle(
      "detalle-largo-calibrador",
      (n) => `${n} día(s) con MÁS kg en el detalle del calibrador que en el parte (más del 115 %): algo se está contando dos veces`,
      "Huele a duplicado entre fuentes de la vista clasificacion_lote: revisar antes de fiarse de Rentabilidad esos días.",
      largos,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Regla 10 — La asistencia dejó de volcarse
// ---------------------------------------------------------------------------
// asistencia_detalle se vuelca los lunes por semanas completas (regla del
// dueño, comprobada el 06-08-2026): la semana en curso SIEMPRE está vacía y
// eso no es una avería. Lo que sí lo es: que la producción siga (partes con
// kg) y la última fecha con presentes se quede semanas atrás. Del 04-08 al
// 04-09-2026 pasó un mes así sin que nadie se enterara, y todo lo que cuelga
// de la asistencia se quedó ciego en silencio: «Por tipo de día» no puede
// clasificar un día sin personas, «Rentabilidad del día» calcula el personal
// con los presentes, y la regla de rendimiento de este vigía solo evalúa días
// con asistencia. Ni el vigilante ni el catálogo de salud lo miraban.
//
// Por qué 10 días: con el volcado del lunes, el último presente es el viernes
// (o el sábado) de la semana anterior y la producción sigue hasta el lunes
// siguiente, justo antes del próximo volcado: 10 días. Uno más quiere decir
// que el volcado del lunes no ha llegado. Se mide contra la ÚLTIMA PRODUCCIÓN,
// no contra hoy: si la línea para (fiesta, fin de campaña) el hueco no crece.

export const DIAS_UMBRAL_ASISTENCIA_PARADA = 10;

/**
 * @param fechasProduccion días (YYYY-MM-DD) con producción en el parte: kg en
 *   lotes_dia o kg_produccion_calibrador > 0. Pueden venir repetidos o
 *   anteriores a la asistencia; aquí se filtran.
 * @param ultimaAsistencia última fecha con presentes en asistencia_detalle.
 */
export function reglaAsistenciaParada(fechasProduccion: string[], ultimaAsistencia: string | null): Hallazgo[] {
  // Sin ninguna fecha con presentes no hay referencia: es "sin estrenar", no
  // "parada" (misma convención que el vigilante con los trabajos).
  if (!ultimaAsistencia) return [];
  const sinAsistencia = [...new Set(fechasProduccion)].filter((f) => f > ultimaAsistencia).sort();
  if (sinAsistencia.length === 0) return [];
  const ultimaProduccion = sinAsistencia[sinAsistencia.length - 1];
  const dias = diasEntre(ultimaAsistencia, ultimaProduccion);
  if (dias <= DIAS_UMBRAL_ASISTENCIA_PARADA) return [];
  const n = sinAsistencia.length;
  return [{
    regla: "asistencia-parada",
    // La identidad es "el volcado se quedó en X": si alguien carga una semana
    // y sigue atrasado, es una situación nueva y se avisa otra vez.
    clave: `asistencia-parada|${ultimaAsistencia}`,
    tipo: "estado",
    severidad: "atencion",
    titulo: `La asistencia no se vuelca desde el ${fmtFecha(ultimaAsistencia)}: hay producción hasta el ${fmtFecha(ultimaProduccion)} (${dias} días después) y ${n} día${n === 1 ? "" : "s"} de trabajo sin nadie presente en la base`,
    detalle: `La asistencia (asistencia_detalle) se carga los lunes por semanas completas, así que la semana en curso vacía es normal; esto ya no lo es. Mientras falte, «Por tipo de día» no puede clasificar esos días (sin personas no hay régimen), «Rentabilidad del día» se queda sin coste de personal y la regla de rendimiento de este vigía no los mira. Cargar el fichaje semanal de RRHH («SEMANA NN.xlsx») en /importar o marcar la asistencia a mano en /costes/asistencia.`,
    eur: null,
    kg: null,
  }];
}

// ---------------------------------------------------------------------------
// Regla 11 — La hoja semanal de Mercadona dejó de cargarse
// ---------------------------------------------------------------------------
// El precio REAL de Mercadona sale de la hoja semanal (mercadona_semanas +
// mercadona_semana_metodos: base_iva / kilos por método). Es la ÚNICA fuente
// de €/kg de Mercadona que tienen «Rentabilidad del día» y «Por tipo de día»
// — los precios MDNA por defecto están a 0 a propósito —, así que sin la hoja
// de una semana los días de esa semana se valoran con la última anterior que
// tenga base, y «Por tipo de día» exige además que sea fiable (≥0,80 €/kg;
// las semanas a medio facturar salen a 0,38-0,47). La hoja de la semana 32
// fue la última durante un mes (hasta el 04-09-2026) y nadie lo vio: la
// cuenta de Rentabilidad dejó de crecer en silencio.
//
// Solo se avisa si el ERP tiene palets a Mercadona posteriores a la última
// semana con base: sin venta no hay nada que facturar (una parada de campaña
// no es una hoja olvidada). Umbral de 2 semanas: la hoja de la semana N se
// carga durante la N+1; empezar la N+3 sin ella ya no es retraso normal.

export const SEMANAS_UMBRAL_MERCADONA_SIN_FACTURAR = 2;
/** Una semana de la hoja con sus métodos: el MISMO shape que lee useTipoDia. */
export type MercadonaSemanaVigiaRow = SemanaMdnaCruda;

/** Semanas ISO cerradas entre dos lunes (ambos excluidos), en orden. */
function semanasCerradasEntre(lunesDesde: string, lunesHasta: string): SemanaIso[] {
  const out: SemanaIso[] = [];
  for (let lunes = fechaMenosDias(lunesDesde, -7); lunes < lunesHasta; lunes = fechaMenosDias(lunes, -7)) {
    out.push(semanaIsoDe(lunes));
  }
  return out;
}

/** "33, 34 y 35 de 2026" — o, si cruzan el año, "53/2026, 1/2027 y 2/2027". */
function etiquetaSemanas(semanas: SemanaIso[]): string {
  const anios = [...new Set(semanas.map((s) => s.anio))];
  const nums = semanas.map((s) => (anios.length > 1 ? `${s.semana}/${s.anio}` : String(s.semana)));
  const lista = nums.length > 1 ? `${nums.slice(0, -1).join(", ")} y ${nums[nums.length - 1]}` : nums[0];
  return anios.length > 1 ? lista : `${lista} de ${anios[0]}`;
}

export function reglaMercadonaSinFacturar(
  semanas: MercadonaSemanaVigiaRow[],
  palets: PaletVigiaRow[],
  hoy: string,
): Hallazgo[] {
  // La MISMA cuenta que «Por tipo de día» (semanasPrecio): €/kg = Σbase / Σkilos
  // de la semana y "fiable" con su mismo corte.
  const conBase = semanasPrecio(semanas).filter((s) => s.baseIva > 0);
  const ultima = conBase[conBase.length - 1];
  // Sin ninguna semana con base no hay referencia: sin estrenar, no parada.
  if (!ultima) return [];

  const diasUltima = fechasSemanaIso(ultima.anio, ultima.semana);
  const lunesHoy = lunesDeSemanaIso(hoy);
  const semanasAtras = diasEntre(diasUltima[0], lunesHoy) / 7;
  if (semanasAtras <= SEMANAS_UMBRAL_MERCADONA_SIN_FACTURAR) return [];

  // ¿Se ha seguido vendiendo a Mercadona? Pesadas reales del ERP (erp_palet).
  let nPalets = 0;
  let kg = 0;
  for (const p of palets) {
    if (p.fecha <= diasUltima[6] || !(p.cliente ?? "").toUpperCase().includes("MERCADONA")) continue;
    nPalets += 1;
    kg += toNum(p.kg_netos);
  }
  if (nPalets === 0) return [];

  const faltan = semanasCerradasEntre(diasUltima[0], lunesHoy);
  const actual = semanaIsoDe(hoy);
  const aMedias = !ultima.fiable && ultima.eurKg != null
    ? `La semana ${ultima.semana} está además a medio facturar (${NF_KG_CAJA.format(ultima.eurKg)} €/kg de media; «Por tipo de día» solo da por real una semana a ≥${NF_KG_CAJA.format(EUR_KG_MINIMO_FIABLE)} €/kg). `
    : "";
  return [{
    regla: "mercadona-sin-facturar",
    // La identidad es "la última hoja con base es la semana X".
    clave: `mercadona-sin-facturar|${claveSemanaIso(diasUltima[0])}`,
    tipo: "estado",
    severidad: "atencion",
    titulo: `La hoja semanal de Mercadona se quedó en la semana ${ultima.semana} de ${ultima.anio}: faltan ${faltan.length} semana${faltan.length === 1 ? "" : "s"} cerrada${faltan.length === 1 ? "" : "s"} (${etiquetaSemanas(faltan)}) y ya va la ${actual.semana} — ${NF_ENTERO.format(nPalets)} palets (${fmtKg(kg)}) vendidos a Mercadona desde entonces sin base facturada`,
    detalle: `${aMedias}Sin la hoja no hay precio real de Mercadona: «Rentabilidad del día» valora esos días con la última semana con base y «Por tipo de día» los deja sin cuenta en euros — la cuenta entera de Rentabilidad no crece hasta que se cargue. Cargar el Excel semanal de Mercadona de cada semana que falta (tarjeta «Ventas semanales Mercadona» de /importar).`,
    eur: null,
    kg,
  }];
}

// ---------------------------------------------------------------------------
// Conciliación con lo ya guardado (vigia_hallazgos)
// ---------------------------------------------------------------------------

export interface HallazgoGuardadoRow {
  id: string;
  clave: string;
  tipo: string;
  titulo: string;
  creado_at: string;
  resuelto_at: string | null;
}

export interface PlanHallazgos {
  /** Hallazgos que no se conocían: se insertan y se cuentan en el correo. */
  nuevos: Hallazgo[];
  /** Estados abiertos que siguen detectándose (para el resumen del lunes). */
  pendientes: Array<{ hallazgo: Hallazgo; desde: string }>;
  /** Estados abiertos que ya NO se detectan: se marcan resueltos. */
  resolverIds: string[];
  /** Estados abiertos cuyo texto/importe cambió: se refrescan sin tocar creado_at. */
  actualizar: Array<{ id: string; titulo: string; detalle: string | null; eur: number | null; kg: number | null }>;
}

/**
 * Cruza lo detectado hoy con lo guardado. Un EVENTO ya visto (su clave existe,
 * resuelto o no) no se repite jamás. Un ESTADO abierto se refresca; si deja de
 * detectarse se resuelve; si reaparece tras resolverse, vuelve como nuevo.
 */
export function conciliarHallazgos(
  actuales: Hallazgo[],
  guardados: HallazgoGuardadoRow[],
): PlanHallazgos {
  const clavesVistas = new Set(guardados.map((g) => g.clave));
  const abiertosPorClave = new Map<string, HallazgoGuardadoRow>();
  for (const g of guardados) {
    if (g.resuelto_at == null) abiertosPorClave.set(g.clave, g);
  }

  const plan: PlanHallazgos = { nuevos: [], pendientes: [], resolverIds: [], actualizar: [] };
  const clavesEstadoActuales = new Set<string>();

  for (const h of actuales) {
    if (h.tipo === "evento") {
      if (!clavesVistas.has(h.clave)) plan.nuevos.push(h);
      continue;
    }
    clavesEstadoActuales.add(h.clave);
    const abierto = abiertosPorClave.get(h.clave);
    if (!abierto) {
      plan.nuevos.push(h);
      continue;
    }
    plan.pendientes.push({ hallazgo: h, desde: abierto.creado_at.slice(0, 10) });
    if (abierto.titulo !== h.titulo) {
      plan.actualizar.push({ id: abierto.id, titulo: h.titulo, detalle: h.detalle, eur: h.eur, kg: h.kg });
    }
  }

  for (const [clave, g] of abiertosPorClave) {
    if (!clavesEstadoActuales.has(clave)) plan.resolverIds.push(g.id);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// El correo (determinista, sin LLM)
// ---------------------------------------------------------------------------

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface CorreoVigia {
  asunto: string;
  html: string;
  texto: string;
}

/** ¿Toca mandar correo? Con novedades siempre; los lunes, también el resumen de pendientes. */
export function tocaEnviarCorreoVigia(plan: PlanHallazgos, esLunes: boolean): boolean {
  return plan.nuevos.length > 0 || (esLunes && plan.pendientes.length > 0);
}

export function renderCorreoVigia(plan: PlanHallazgos, hoy: string, esLunes: boolean): CorreoVigia {
  const n = plan.nuevos.length;
  const p = plan.pendientes.length;
  const asunto = n > 0
    ? `[VIGÍA] ${n} hallazgo${n === 1 ? "" : "s"} nuevo${n === 1 ? "" : "s"}${p > 0 ? ` · ${p} pendiente${p === 1 ? "" : "s"}` : ""}`
    : `[VIGÍA] Resumen semanal: ${p} pendiente${p === 1 ? "" : "s"} sin resolver`;

  const lineas: string[] = [
    "Soy el vigía de negocio: solo escribo cuando los datos cuentan algo que",
    "cuesta dinero o que se está quedando sin hacer. Los euros de este correo",
    "no salen de la herramienta.",
    "",
  ];
  if (n > 0) {
    lineas.push("NUEVO HOY", "");
    for (const h of plan.nuevos) {
      lineas.push(`- ${h.titulo}.`);
      if (h.detalle) lineas.push(`  ${h.detalle}`);
      lineas.push("");
    }
  }
  if (p > 0 && (esLunes || n > 0)) {
    lineas.push("SIGUE PENDIENTE", "");
    for (const { hallazgo, desde } of plan.pendientes) {
      lineas.push(`- ${hallazgo.titulo} (desde el ${fmtFecha(desde)}).`);
    }
    lineas.push("");
  }
  lineas.push("--");
  lineas.push(`Vigía de negocio · ${fmtFecha(hoy)}. Detalle en https://controlproduccion.vercel.app`);
  const texto = lineas.join("\n");

  const bloque = (titulo: string, items: string[]): string =>
    `<h2 style="margin:18px 0 8px;color:#22295c;font-size:15px;">${escaparHtml(titulo)}</h2>
     <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f7fb;border:1px solid #e2e5f0;border-radius:10px;">
       ${items.map((i) => `<tr><td style="padding:9px 14px;font-size:13px;color:#30354a;line-height:1.5;border-bottom:1px solid #e9ebf3;">${i}</td></tr>`).join("")}
     </table>`;

  const itemNuevo = (h: Hallazgo): string =>
    `<strong>${escaparHtml(h.titulo)}.</strong>${h.detalle ? `<br><span style="color:#6e7488;font-size:12px;">${escaparHtml(h.detalle)}</span>` : ""}`;
  const itemPendiente = (x: { hallazgo: Hallazgo; desde: string }): string =>
    `${escaparHtml(x.hallazgo.titulo)} <span style="color:#6e7488;font-size:12px;">(desde el ${fmtFecha(x.desde)})</span>`;

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escaparHtml(asunto)}</title></head>
<body style="margin:0;padding:0;background:#f2f4f8;font-family:Arial,Helvetica,sans-serif;color:#30354a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2f4f8;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 32px rgba(31,42,94,.11);">
        <tr><td style="height:6px;background:#b4232a;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:22px 32px 6px;">
          <p style="margin:0 0 4px;color:#6e7488;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;">Lasarte Cítricos SL · Vigía de negocio</p>
          <h1 style="margin:0;color:#22295c;font-size:21px;line-height:1.25;">${escaparHtml(asunto.replace("[VIGÍA] ", ""))}</h1>
          <p style="margin:8px 0 0;color:#6e7488;font-size:12px;">Solo llega correo cuando los datos cuentan algo que cuesta dinero o que se está quedando sin hacer.</p>
        </td></tr>
        <tr><td style="padding:0 32px 8px;">
          ${n > 0 ? bloque("Nuevo hoy", plan.nuevos.map(itemNuevo)) : ""}
          ${p > 0 && (esLunes || n > 0) ? bloque("Sigue pendiente", plan.pendientes.map(itemPendiente)) : ""}
        </td></tr>
        <tr><td style="padding:14px 32px 22px;">
          <p style="margin:0;font-size:11px;color:#858a9b;line-height:1.6;">
            Generado automáticamente con las mismas funciones de cálculo que las páginas de la herramienta
            (pesadas reales del ERP, conciliación de kg, «Mermas y coste»). Cuando falta un dato se dice — nunca se estima en silencio.
            Vigía diario · ${escaparHtml(fmtFecha(hoy))}.
          </p>
        </td></tr>
        <tr><td style="height:6px;background:#93c13d;font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { asunto, html, texto };
}
