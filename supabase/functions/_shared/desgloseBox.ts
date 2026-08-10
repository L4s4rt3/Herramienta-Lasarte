/**
 * desgloseBox.ts — reparto de los kg de UNA pasada del calibrador entre los
 * varios lotes que se echaron en ella, usando los BOX de cada uno.
 *
 * PROBLEMA (encargo del dueño, 06-ago-2026): en línea se echan varios lotes
 * seguidos y el calibrador registra una sola pasada, atribuyendo todo su kg al
 * primer código del nombre. El operario SÍ escribe el desglose en ese nombre,
 * pero en texto libre y sin repartir nada — casos reales del martes 04-08:
 *   "26051904-15 BOX +7 BOX DE RECICLAJE"          →  5.948,40 kg
 *   "22/07  22 BOX  -  23/07 43 BOX"               → 13.698,86 kg
 *   "30/07 - 46 B27/07,-7B -29/07-2 B -21/07-7 B"  → 15.476,86 kg
 *   "31/07 -28 BOX  +3 BOX DE 4K DIA 03/08"        →  7.362,55 kg
 * Aquí se convierte ese texto en líneas (lote / precalibrado por fecha /
 * reciclaje) con sus box, y se reparten los kg REALES de la pasada.
 *
 * REGLA DEL DUEÑO sobre el peso del box (06-ago-2026, textual): "cada box
 * grande (que es el normal) tiene una tara de 35 kg y pesa unos 350 kg, y el
 * box pequeño tiene tara de 30 kg y pesa unos 230 kg. Siempre van a ser box
 * grandes a no ser que se especifique lo contrario". Los ~350/~230 son el
 * BRUTO en báscula, así que la fruta de un box es 315 / 200 kg.
 *
 * REGLA DEL DUEÑO sobre el cuadre (06-ago-2026): el peso del box SOLO PONDERA
 * — el total repartido es siempre el kg REAL de la pasada del calibrador, ni
 * un kg más ni uno menos. Los pesos de arriba son el box LLENO y en la
 * práctica no lo van (la pasada de las 08:00 del 04-08: 62 box y 15.476,86 kg
 * → 249,6 kg/box real frente a los 315 teóricos), así que tomarlos como kg
 * absolutos inventaría un 26 % de fruta que no existe. Con todas las líneas
 * del mismo tamaño de box el reparto es exactamente proporcional a los box;
 * el tamaño solo cambia el resultado cuando se mezclan grandes y pequeños.
 *
 * Módulo PURO (sin red ni Supabase): la persistencia vive en la tabla
 * pasada_box_lineas (migración 20260806120000_pasada_box_lineas.sql) y la
 * inyección al motor de conciliación en useEntradasBascula.ts —
 * conciliarKgProcesados (conciliacionKg.ts) NO se toca, igual que con
 * pasadaAnotaciones.ts: se le entregan pasadas sintéticas ya repartidas.
 */
import { normalizarLoteCodigo } from "./loteCodigo.ts";
// La tara del box de reciclaje (30 kg) ya vivía aquí desde 2026-07-29 y es la
// del box PEQUEÑO: no se duplica el número, se reutiliza.
import { TARA_BOX_KG } from "./recicladoZonas.ts";

export const BOX_TAMANOS = ["grande", "pequeno"] as const;
export type BoxTamano = (typeof BOX_TAMANOS)[number];

/** El normal: si nadie dice lo contrario, un box es grande (regla del dueño). */
export const BOX_TAMANO_DEFECTO: BoxTamano = "grande";

/** Peso del envase vacío. El pequeño es el mismo box de 30 kg del reciclaje. */
export const BOX_TARA_KG: Record<BoxTamano, number> = {
  grande: 35,
  pequeno: TARA_BOX_KG,
};

/** Peso BRUTO típico del box lleno (fruta + envase), tal cual lo dio el dueño. */
export const BOX_BRUTO_KG: Record<BoxTamano, number> = {
  grande: 350,
  pequeno: 230,
};

/** Fruta de un box lleno = bruto − tara. Es la PONDERACIÓN del reparto, no un kg absoluto. */
export const BOX_NETO_KG: Record<BoxTamano, number> = {
  grande: BOX_BRUTO_KG.grande - BOX_TARA_KG.grande,
  pequeno: BOX_BRUTO_KG.pequeno - BOX_TARA_KG.pequeno,
};

export const BOX_TAMANO_LABEL: Record<BoxTamano, string> = {
  grande: "Grande",
  pequeno: "Pequeño",
};

/** Un tamaño de box válido, o el de defecto si el valor guardado no lo es. */
export function normalizarBoxTamano(value: string | null | undefined): BoxTamano {
  return (BOX_TAMANOS as readonly string[]).includes(String(value))
    ? (value as BoxTamano)
    : BOX_TAMANO_DEFECTO;
}

/**
 * Qué se echó en una línea del desglose:
 * - "lote": un lote real, por su código de 8 dígitos (Convención A).
 * - "precalibrado": fruta del almacén PREC, que el operario nombra por la
 *   FECHA en que se apartó ("22/07"). Si esa fecha casa con una re-entrada de
 *   báscula se guarda además su código y entonces cuenta como ese lote; si no
 *   casa, la línea se lleva sus kg pero no se atribuyen a ningún código (no se
 *   inventa un cruce — misma doctrina que stockPrecalibrado.ts).
 * - "reciclaje": box de fruta ya contada que vuelve a línea. Consume kg de la
 *   pasada pero NO se atribuye a ningún lote: contarlo sería doble cuenta.
 */
export type TipoLineaDesglose = "lote" | "precalibrado" | "reciclaje";

export interface LineaDesglose {
  tipo: TipoLineaDesglose;
  /** Código de 8 dígitos: el del lote, o el de la re-entrada PREC ya resuelta. */
  lote_codigo?: string | null;
  /** Fecha ISO del precalibrado tal como la nombró el operario ("22/07" → "2026-07-22"). */
  prec_fecha?: string | null;
  /** Box echados de esta línea. `null` = el operario no lo escribió (hay que preguntárselo). */
  box: number | null;
  box_tamano: BoxTamano;
  nota?: string | null;
}

export interface LineaDesgloseRepartida extends LineaDesglose {
  /** Ponderación: box × fruta de un box lleno de ese tamaño. */
  peso: number;
  /** Kg teóricos si los box hubieran ido llenos (referencia, NO es lo repartido). */
  kgTeorico: number;
  /** Kg REALES de la pasada que le tocan a esta línea. Σ = kg de la pasada. */
  kg: number;
  /** Código al que se atribuyen esos kg; null = nadie (reciclaje o PREC sin resolver). */
  codigoAtribuido: string | null;
}

export interface RepartoPasadaBox {
  lineas: LineaDesgloseRepartida[];
  /** Kg de la pasada que se han repartido (el real del calibrador). */
  kgPasada: number;
  boxTotal: number;
  /** Suma de los kg teóricos (box llenos). Comparar con kgPasada dice cuán vacíos iban. */
  kgTeoricoTotal: number;
  /** kgPasada − kgTeoricoTotal: negativo = los box no iban llenos (lo normal). */
  desviacionKg: number;
  /** Kg reales por box grande equivalente. null si no hay box. */
  kgPorBoxReal: number | null;
  /** Kg atribuidos a un código real (excluye reciclaje y PREC sin resolver). */
  kgAtribuido: number;
  /** Kg que la pasada se lleva sin atribuir a ningún lote. */
  kgSinAtribuir: number;
  /** Líneas sin box escrito: el reparto las deja a 0 hasta que se rellenen. */
  lineasSinBox: number;
}

/**
 * Redondeo a la MISMA precisión con la que el calibrador da sus kg (4
 * decimales, p.ej. 15476,8571): así el prorrateo no arrastra decimales
 * infinitos y el cuadre con el kg de la pasada sigue siendo exacto.
 */
function redondearKg(kg: number): number {
  return Math.round(kg * 1e4) / 1e4;
}

/** El código al que esta línea atribuye sus kg (null si no atribuye a nadie). */
export function codigoAtribuidoDe(linea: LineaDesglose): string | null {
  if (linea.tipo === "reciclaje") return null;
  return normalizarLoteCodigo(linea.lote_codigo) ?? null;
}

/**
 * Reparte los kg REALES de una pasada entre sus líneas, en proporción a
 * box × peso del box (ver la regla del dueño en la cabecera). El total
 * repartido es EXACTAMENTE `kgPasada`: el residuo del redondeo se ajusta en la
 * línea de mayor peso, así que ni se inventa ni se pierde un gramo.
 *
 * Las líneas sin box (`box === null`, el operario no lo escribió) NO reciben
 * kg: pesan 0 y se reportan en `lineasSinBox` para que la UI los reclame —
 * repartirles algo sería inventarse el dato.
 */
export function repartirPasadaPorBox(
  kgPasadaInput: number | null | undefined,
  lineas: LineaDesglose[],
): RepartoPasadaBox {
  const kgPasada = Math.max(0, Number(kgPasadaInput) || 0);

  const conPeso = lineas.map((linea) => {
    const box = linea.box == null ? null : Math.max(0, Number(linea.box) || 0);
    const tamano = normalizarBoxTamano(linea.box_tamano);
    const peso = box == null ? 0 : box * BOX_NETO_KG[tamano];
    return { linea, box, tamano, peso };
  });

  const pesoTotal = conPeso.reduce((s, l) => s + l.peso, 0);

  const repartidas: LineaDesgloseRepartida[] = conPeso.map(({ linea, box, tamano, peso }) => ({
    ...linea,
    box,
    box_tamano: tamano,
    peso,
    kgTeorico: redondearKg(peso),
    kg: pesoTotal > 0 ? redondearKg((kgPasada * peso) / pesoTotal) : 0,
    codigoAtribuido: codigoAtribuidoDe(linea),
  }));

  // Cuadre exacto: el residuo de redondear va a la línea de mayor peso (la que
  // menos se distorsiona en términos relativos).
  if (pesoTotal > 0) {
    const sumaKg = repartidas.reduce((s, l) => s + l.kg, 0);
    const residuo = redondearKg(kgPasada - sumaKg);
    if (residuo !== 0) {
      let iMayor = 0;
      for (let i = 1; i < repartidas.length; i += 1) {
        if (repartidas[i].peso > repartidas[iMayor].peso) iMayor = i;
      }
      repartidas[iMayor].kg = redondearKg(repartidas[iMayor].kg + residuo);
    }
  }

  const boxTotal = conPeso.reduce((s, l) => s + (l.box ?? 0), 0);
  const kgTeoricoTotal = redondearKg(pesoTotal);
  const kgAtribuido = repartidas.reduce((s, l) => s + (l.codigoAtribuido ? l.kg : 0), 0);

  return {
    lineas: repartidas,
    kgPasada,
    boxTotal,
    kgTeoricoTotal,
    desviacionKg: redondearKg(kgPasada - kgTeoricoTotal),
    kgPorBoxReal: boxTotal > 0 ? redondearKg(kgPasada / boxTotal) : null,
    kgAtribuido: redondearKg(kgAtribuido),
    kgSinAtribuir: redondearKg(kgPasada - kgAtribuido),
    lineasSinBox: conPeso.filter((l) => l.box == null).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser del texto del calibrador
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte "22/07" (lo que escribe el operario) en fecha ISO, usando la fecha
 * del parte como referencia: mismo año, salvo que la fecha resultante caiga
 * DESPUÉS del parte (p.ej. "28/12" en un parte de enero), en cuyo caso es del
 * año anterior. El precalibrado siempre se apartó antes de echarse.
 */
export function fechaPrecalibradoAIso(diaMes: string, fechaParte: string): string | null {
  const m = String(diaMes).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;

  const anioParte = Number(String(fechaParte).slice(0, 4));
  if (!Number.isFinite(anioParte)) return null;

  let anio = anioParte;
  if (m[3]) {
    const escrito = Number(m[3]);
    anio = escrito < 100 ? 2000 + escrito : escrito;
  }
  const iso = (a: number) => `${a}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  if (!m[3] && iso(anio) > String(fechaParte)) anio -= 1;
  return iso(anio);
}

/**
 * Trocea el nombre de la pasada en líneas de desglose. Reconoce, en el orden
 * en que aparecen:
 *   - código de lote de 8 dígitos            → línea "lote"
 *   - fecha DD/MM (con o sin año)            → línea "precalibrado"
 *   - box que no son de ningún lote nombrado → línea "reciclaje"
 *     (RECICLAJE y sus erratas reales —"RECILAJE"—, RECICLADO, DESCARTE,
 *     DESMONTAJE, EGIPTO: todos son fruta que entra a línea sin ser de un
 *     lote nuevo, así que ninguno atribuye kg; la palabra literal se guarda
 *     en la nota para no perder de qué era)
 * y les asigna el número de box más cercano. El operario escribe la cantidad
 * unas veces DESPUÉS de lo que echó ("30/07 - 46 B") y otras ANTES ("3 BOX DE
 * PREC DIA 31/07", "2 PREC DIA 03/08", "7 BOX DE RECICLAJE"), y lo que
 * distingue los dos casos en TODOS los partes reales es qué sigue al número:
 * si sigue una PALABRA ("DE", "PREC", "DIA"…) la cantidad es de lo que viene
 * después; si sigue un separador o directamente otro código/fecha, es de la
 * línea ya abierta.
 *
 * Números pegados a otra letra ("4K" de "3 BOX DE 4K DIA 03/08") NO son box:
 * son formato/calibre y se ignoran como cantidad. Un texto que no ancle nada
 * (p.ej. "8098") devuelve lista vacía — nunca se inventa una línea.
 */
export function parsearDesgloseTexto(
  loteCodigo: string | null | undefined,
  fechaParte: string,
): LineaDesglose[] {
  const texto = String(loteCodigo ?? "").toUpperCase();
  if (!texto.trim()) return [];

  const TOKEN = new RegExp(
    [
      "(\\d{8})", // 1: código de lote
      "(\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)", // 2: fecha DD/MM[/AA]
      "(RECI\\w*|DESCART\\w*|DESMONT\\w*|EGIP\\w*)", // 3: box sin lote al que atribuir
      "(\\d{1,4})\\s*[-–]?\\s*(?:BOX|BX|B)(?![A-Z])", // 4: "N BOX", "7B", "10-BOX", "2BOX"
      "(\\d{1,4})(?![\\dA-Z/])", // 5: número suelto
    ].join("|"),
    "g",
  );

  const lineas: LineaDesglose[] = [];
  let abierta: LineaDesglose | null = null;
  let boxPendiente: number | null = null;

  /** Abre una línea, dándole el box que hubiera quedado pendiente delante de ella. */
  const abrir = (linea: LineaDesglose): LineaDesglose => {
    if (boxPendiente != null) {
      linea.box = boxPendiente;
      boxPendiente = null;
    }
    lineas.push(linea);
    return linea;
  };

  for (const m of texto.matchAll(TOKEN)) {
    const [, codigo, fecha, reciclaje, boxMarcado, numeroSuelto] = m;

    if (codigo) {
      abierta = abrir({ tipo: "lote", lote_codigo: codigo, box: null, box_tamano: BOX_TAMANO_DEFECTO });
      continue;
    }
    if (fecha) {
      abierta = abrir({
        tipo: "precalibrado",
        prec_fecha: fechaPrecalibradoAIso(fecha, fechaParte),
        lote_codigo: null,
        box: null,
        box_tamano: BOX_TAMANO_DEFECTO,
        nota: `Precalibrado ${fecha}`,
      });
      continue;
    }
    if (reciclaje) {
      // La palabra literal (RECICLAJE, DESCARTE, EGIPTO…) va a la nota: el
      // tratamiento es el mismo —no atribuye kg a ningún lote— pero se
      // conserva de qué era.
      abierta = abrir({
        tipo: "reciclaje",
        box: null,
        box_tamano: BOX_TAMANO_DEFECTO,
        nota: reciclaje.charAt(0) + reciclaje.slice(1).toLowerCase(),
      });
      continue;
    }

    const numero = Number(boxMarcado ?? numeroSuelto);
    if (!Number.isFinite(numero) || numero <= 0) continue;
    // ¿La cantidad es de lo ya abierto o de lo que viene después? Lo decide lo
    // que sigue al número: una palabra ("DE PREC DIA 31/07") lo empuja hacia
    // adelante; un separador o un código/fecha ("- 23/07", "+7 BOX") lo deja
    // en la línea abierta. Ver la cabecera de la función.
    const resto = texto.slice((m.index ?? 0) + m[0].length);
    const apuntaAdelante = /^[\s,;.:+\-/]*[A-ZÑ]/.test(resto);
    if (!apuntaAdelante && abierta && abierta.box == null) abierta.box = numero;
    // Un número suelto (sin "BOX"/"B") que tampoco apunta a nada es ruido del
    // nombre (un calibre, un nº de albarán): se descarta, no se inventa box.
    else if (boxMarcado || apuntaAdelante) boxPendiente = numero;
  }

  return lineas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inyección en el motor de conciliación
// ─────────────────────────────────────────────────────────────────────────────

/** Lo mínimo que necesita una pasada para poder expandirse (fila de lotes_dia). */
export interface PasadaExpandible {
  id: string;
  lote_codigo: string | null;
  kg_peso_total: number | null;
  /** Destrío a industria de la pasada, si el consumidor lo trae: se prorratea igual que los kg. */
  kg_industria?: number;
}

/**
 * Sustituye una pasada desglosada por tantas pasadas SINTÉTICAS como líneas
 * atribuidas a un código tenga, cada una con sus kg ya repartidos. Es la forma
 * de que `conciliarKgProcesados` (conciliacionKg.ts) reparta como manda el
 * desglose SIN tocar ni una línea del motor: para él son pasadas normales de
 * código simple — misma doctrina que la inyección de pasadaAnotaciones.ts.
 *
 * Lo que NO genera pasada: el reciclaje y los precalibrados sin resolver. Sus
 * kg salen del reparto y no se le atribuyen a ningún lote, que es justo lo que
 * se quiere (fruta ya contada u origen desconocido: inventarle un dueño sería
 * doble cuenta).
 *
 * CINTURÓN: si el desglose todavía no atribuye NADA (líneas sin box, solo
 * reciclaje, precalibrados sin re-entrada…), la pasada se devuelve INTACTA.
 * Un desglose a medio rellenar nunca puede hacer desaparecer los kg de una
 * pasada del calibrador: mientras no atribuya nada, todo sigue como antes de
 * desglosar.
 */
export function expandirPasadaPorDesglose<T extends PasadaExpandible>(
  pasada: T,
  lineas: LineaDesglose[],
): T[] {
  if (lineas.length === 0) return [pasada];

  const kgPasada = Number(pasada.kg_peso_total) || 0;
  const reparto = repartirPasadaPorBox(kgPasada, lineas);
  if (reparto.kgAtribuido <= 0) return [pasada];

  const sinteticas: T[] = [];
  reparto.lineas.forEach((linea, i) => {
    if (!linea.codigoAtribuido || linea.kg <= 0) return;
    const fraccion = kgPasada > 0 ? linea.kg / kgPasada : 0;
    sinteticas.push({
      ...pasada,
      id: `${pasada.id}#box${i + 1}`,
      lote_codigo: linea.codigoAtribuido,
      kg_peso_total: linea.kg,
      ...(typeof pasada.kg_industria === "number"
        ? { kg_industria: (Number(pasada.kg_industria) || 0) * fraccion }
        : {}),
    });
  });
  return sinteticas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolución de un precalibrado por fecha contra las re-entradas de báscula
// ─────────────────────────────────────────────────────────────────────────────

export interface ReentradaPrecCandidata {
  lote: string;
  fecha: string;
  /**
   * "PREC 1 ALMACEN" / "PREC 2 ALMACEN" cuando la fila viene del export de
   * báscula. OJO: las re-entradas sembradas desde el informe de stock de lotes
   * NO traen finca (llegan solo con el agricultor "LASARTE ALMACEN
   * PRECALIBRADO"), así que quien construya estas candidatas debe filtrarlas
   * con `esEntradaPrecalibrado` (productoresCanonicos.ts) — que mira agricultor
   * O finca— y nunca por la finca a secas.
   */
  finca: string | null;
  /** Agricultor de báscula: es lo ÚNICO que identifica al precalibrado en las filas sembradas desde stock. */
  agricultor?: string | null;
  kg_entrada: number;
  envases: number | null;
}

export type ResolucionPrec =
  | { estado: "resuelto"; codigo: string; candidata: ReentradaPrecCandidata }
  | { estado: "ambiguo"; candidatas: ReentradaPrecCandidata[] }
  | { estado: "sin_candidatos" };

/**
 * Busca a qué re-entrada de precalibrado corresponde una fecha escrita por el
 * operario. Con una sola candidata ese día, se resuelve; con varias (PREC 1 y
 * PREC 2 el mismo día) se devuelven todas para que elija una persona — jamás
 * se elige por FIFO ni por tamaño (doctrina de stockPrecalibrado.ts: "cada
 * lote de precalibrado se indica"). Sin candidatas, la línea se queda con la
 * fecha y sin código.
 */
export function resolverPrecalibradoPorFecha(
  fechaIso: string | null | undefined,
  candidatas: ReentradaPrecCandidata[],
): ResolucionPrec {
  if (!fechaIso) return { estado: "sin_candidatos" };
  const delDia = candidatas.filter((c) => c.fecha === fechaIso);
  if (delDia.length === 0) return { estado: "sin_candidatos" };
  if (delDia.length === 1) return { estado: "resuelto", codigo: delDia[0].lote, candidata: delDia[0] };
  return { estado: "ambiguo", candidatas: delDia };
}

/** Kg por box de una re-entrada según báscula: sirve para contrastar el reparto con el dato real. */
export function kgPorBoxDeReentrada(candidata: ReentradaPrecCandidata): number | null {
  const envases = Number(candidata.envases) || 0;
  if (envases <= 0) return null;
  return redondearKg((Number(candidata.kg_entrada) || 0) / envases);
}


// ─── Adaptadores de pasada_box_lineas (persistencia → motor) ─────────────────
// Vivían en src/hooks/usePasadaBoxLineas.ts; se mudan a este módulo puro para
// que la edge function informe-semanal inyecte el desglose en la conciliación
// con EXACTAMENTE el mismo adaptador que la app. El hook los re-exporta.

/** Fila cruda de la tabla pasada_box_lineas (migración 20260806120000). */
export interface PasadaBoxLineaRow {
  id: string;
  user_id: string;
  lote_dia_id: string;
  posicion: number;
  tipo: TipoLineaDesglose;
  lote_codigo: string | null;
  prec_fecha: string | null;
  box: number | null;
  box_tamano: BoxTamano;
  nota: string | null;
}

/** Una fila guardada, en la forma que consume el motor de reparto. */
export function lineaDesdeRow(row: PasadaBoxLineaRow): LineaDesglose {
  return {
    tipo: row.tipo,
    lote_codigo: row.lote_codigo,
    prec_fecha: row.prec_fecha,
    box: row.box == null ? null : Number(row.box),
    box_tamano: normalizarBoxTamano(row.box_tamano),
    nota: row.nota,
  };
}

/** lote_dia_id → sus líneas, ordenadas por posición. */
export function agruparLineasBoxPorLoteDia(filas: PasadaBoxLineaRow[]): Map<string, PasadaBoxLineaRow[]> {
  const mapa = new Map<string, PasadaBoxLineaRow[]>();
  for (const fila of filas) {
    const arr = mapa.get(fila.lote_dia_id) ?? [];
    arr.push(fila);
    mapa.set(fila.lote_dia_id, arr);
  }
  for (const arr of mapa.values()) arr.sort((a, b) => a.posicion - b.posicion);
  return mapa;
}