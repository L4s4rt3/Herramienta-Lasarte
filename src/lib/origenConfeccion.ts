/**
 * origenConfeccion.ts — el eslabón que faltaba entre los palets y la fruta
 * real cuando la confección sale de cámara.
 *
 * Contexto (verificado con la campaña 25/26, caso Mercadona jul-2026): el
 * programa de palets etiqueta cada palet con "NN+AAMMDD" donde NN es el nº de
 * LOTE DE CONFECCIÓN del día — que solo coincide con el nº de entrada de
 * báscula cuando la fruta se vuelca el mismo día que entra (lo normal de
 * septiembre a mayo). En junio/julio la fruta salió de cámara (entradas de
 * abril) y el volteo NN+AAMMDD→AAMMDD+NN produce códigos que:
 *   - no existen como entrada (palet 09260608 → 26060809: ninguna entrada), o
 *   - chocan con una entrada AJENA (palet 02260710 → 26071002 = re-entrada de
 *     PRECALIBRADO de 1.382 kg, con 5.184 kg de malla expedidos "colgando"), o
 *   - chocan con una entrada real de OTRA fruta (palet 06260608 → 26060806 =
 *     Valdelimones V. Late 5.970 kg, con 6.924+ kg de Powel expedidos).
 *
 * Este módulo aporta las piezas PURAS para que la ficha de trazabilidad
 * detecte esos cruces imposibles y ofrezca el origen real probable: los
 * volcados (lotes_dia) del día de confección, ordenados por hora, con el
 * volcado nº NN destacado. El vínculo exacto confección↔volcado solo lo tiene
 * el ERP (no hay export hoy): esto es un "candidatos probables", no certeza,
 * y la UI debe presentarlo así.
 */

/** ¿"AAMMDD" es una fecha plausible? (mes 01-12, día 01-31; el año no se restringe). */
function esFechaPlausibleAAMMDD(seis: string): boolean {
  const mes = Number(seis.slice(2, 4));
  const dia = Number(seis.slice(4, 6));
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
}

export interface CodigoLoteInterpretado {
  /** Código canónico AAMMDDNN (convención A del repo), null si el texto no trae 8 dígitos. */
  codigo: string | null;
  /**
   * true si los 8 dígitos SOLO tienen sentido leídos como formato del
   * programa de palets (NN+AAMMDD) y se han volteado al canónico. La UI puede
   * avisar "leído como lote de confección NN del día …".
   */
  eraFormatoPalet: boolean;
}

/**
 * Como `normalizarLoteCodigo` (primer grupo de 8 dígitos) pero además
 * entiende el formato del programa de palets/etiqueta de palet (NN+AAMMDD,
 * p. ej. "02260710" = lote 02 del 10/07/26) y lo voltea al canónico
 * AAMMDD+NN ("26071002").
 *
 * Regla de desambiguación: si la lectura directa AAMMDD+NN ya es una fecha
 * plausible se respeta tal cual (aunque la lectura de palet también lo fuera:
 * el canónico es la convención de toda la app y quien teclea un canónico no
 * debe verlo volteado). Solo se voltea cuando la lectura directa es
 * imposible como fecha Y la de palet sí es plausible ("022607…" → mes 26 ✗).
 */
export function interpretarCodigoLote(value: string | null | undefined): CodigoLoteInterpretado {
  const match = String(value ?? "").match(/\d{8}/);
  if (!match) return { codigo: null, eraFormatoPalet: false };
  const digitos = match[0];
  if (esFechaPlausibleAAMMDD(digitos.slice(0, 6))) {
    return { codigo: digitos, eraFormatoPalet: false };
  }
  if (esFechaPlausibleAAMMDD(digitos.slice(2, 8))) {
    return { codigo: `${digitos.slice(2)}${digitos.slice(0, 2)}`, eraFormatoPalet: true };
  }
  // Ni una lectura ni otra es una fecha: se devuelve tal cual (mismo
  // comportamiento laxo que normalizarLoteCodigo — no se inventa nada).
  return { codigo: digitos, eraFormatoPalet: false };
}

/** "26071002" → "2026-07-10" (fecha del día embebida en el código canónico); null si el código no es AAMMDDNN con fecha plausible. */
export function fechaDeCodigoLote(codigo: string | null | undefined): string | null {
  const text = String(codigo ?? "");
  if (!/^\d{8}$/.test(text) || !esFechaPlausibleAAMMDD(text.slice(0, 6))) return null;
  return `20${text.slice(0, 2)}-${text.slice(2, 4)}-${text.slice(4, 6)}`;
}

/** "26071002" → 2 (el nº de lote del día); null si el código no es AAMMDDNN. */
export function numeroDeCodigoLote(codigo: string | null | undefined): number | null {
  const text = String(codigo ?? "");
  if (!/^\d{8}$/.test(text)) return null;
  const nn = Number(text.slice(6, 8));
  return Number.isFinite(nn) ? nn : null;
}

// ─── Coherencia palets ↔ entrada ─────────────────────────────────────────────

export type MotivoIncoherenciaExpedicion =
  /** Hay palets con este código pero ninguna entrada de báscula: el código es de confección, no de entrada. */
  | "sin_entrada"
  /** La entrada con este código es el movimiento interno al almacén de precalibrado, no fruta de campo: los palets no pueden ser "de" esa entrada. */
  | "entrada_precalibrado"
  /** Los kg netos expedidos superan los kg de la entrada: físicamente imposible, el cruce por código es falso. */
  | "kg_superan_entrada";

export interface CoherenciaExpedicionInput {
  entradaExiste: boolean;
  entradaEsPrecalibrado: boolean;
  kgEntrada: number;
  /** Kg netos de palets de VENTA colgados del código (sin los internos de precalibrado). */
  kgExpedido: number;
}

/**
 * Decide si la expedición colgada de un código de lote es coherente con su
 * entrada de báscula. Devuelve el motivo de incoherencia o null si no hay
 * nada que objetar (también null sin palets: sin expedición no hay cruce que
 * validar). El orden de los motivos importa: "sin_entrada" y
 * "entrada_precalibrado" son estructurales; "kg_superan_entrada" es el último
 * recurso numérico (estricto, sin tolerancia: la báscula pesa fruta bruta y
 * el palet neto vendible — el neto NUNCA puede superar la entrada).
 */
export function evaluarCoherenciaExpedicion(input: CoherenciaExpedicionInput): MotivoIncoherenciaExpedicion | null {
  if (input.kgExpedido <= 0) return null;
  if (!input.entradaExiste) return "sin_entrada";
  if (input.entradaEsPrecalibrado) return "entrada_precalibrado";
  if (input.kgExpedido > input.kgEntrada) return "kg_superan_entrada";
  return null;
}

// ─── Volcados candidatos del día de confección ───────────────────────────────

export interface VolcadoDelDiaInput {
  /** Texto crudo de lotes_dia.lote_codigo (puede ser compuesto "26042712 + 7 BOX…"). */
  lote_codigo: string | null;
  productor: string | null;
  producto: string | null;
  kg: number;
  /** lotes_dia.hora_inicio ("HH:MM:SS"); null en filas del histórico importadas antes de guardarse la hora. */
  hora_inicio: string | null;
  /** Desempate estable cuando falta hora_inicio (orden de inserción del import, que sigue el orden del Excel del calibrador). */
  created_at: string | null;
  esPrecalibrado: boolean;
}

export interface VolcadoCandidato extends VolcadoDelDiaInput {
  /** Código canónico de 8 dígitos del volcado (para enlazar a su ficha); null si el texto no trae uno. */
  codigo: string | null;
  /** Posición 1-based en el orden del día (por hora_inicio; sin hora, al final en orden de inserción). Puramente informativa. */
  numero: number;
}

/**
 * Ordena los volcados de un día de confección (por hora_inicio ascendente;
 * los que no tienen hora van al final conservando su orden de llegada) y los
 * numera 1..N — numeración INFORMATIVA, del orden de proceso del día.
 *
 * OJO (corrección del dueño, 21-jul-2026): el NN del lote del palet NO es el
 * nº de volcado — es el nº de ENTRADA en báscula de ese día (se asigna al dar
 * entrada al camión). Con fruta del día ambos órdenes suelen coincidir (los
 * camiones se vuelcan según entran), pero con fruta de cámara el NN apunta a
 * una entrada interna (PREC) y no identifica la fruta. Por eso NO se marca
 * ningún volcado como "más probable": se devuelve la lista COMPLETA del día
 * y el peso de cada volcado es la única pista honesta del origen.
 */
export function ordenarVolcadosCandidatos(volcados: VolcadoDelDiaInput[]): VolcadoCandidato[] {
  const indexados = volcados.map((v, i) => ({ v, i }));
  indexados.sort((a, b) => {
    if (a.v.hora_inicio != null && b.v.hora_inicio != null) {
      return a.v.hora_inicio.localeCompare(b.v.hora_inicio) || a.i - b.i;
    }
    if (a.v.hora_inicio != null) return -1;
    if (b.v.hora_inicio != null) return 1;
    const porCreacion = (a.v.created_at ?? "").localeCompare(b.v.created_at ?? "");
    return porCreacion || a.i - b.i;
  });
  return indexados.map(({ v }, i) => {
    const match = String(v.lote_codigo ?? "").match(/\d{8}/);
    return {
      ...v,
      codigo: match ? match[0] : null,
      numero: i + 1,
    };
  });
}
