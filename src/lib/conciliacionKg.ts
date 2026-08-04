/**
 * conciliacionKg.ts — conciliación determinista de kg procesados por lote.
 *
 * PROBLEMA (cuantificado con la campaña 25/26 real, 1.187 pasadas / 20,25 M kg):
 * el calibrador atribuye TODA la pasada al primer código de lote de su nombre,
 * pero en línea se mezclan lotes constantemente:
 *   - 647 lotes con MÁS kg procesados que de entrada (1,87 M kg de exceso, el
 *     patrón típico es proc ≈ 2× entrada: no cambian el lote del calibrador al
 *     volcar el siguiente camión de la misma finca);
 *   - 214 lotes >3 t casi sin procesado (3,5 M kg de "stock fantasma": su
 *     fruta se procesó bajo otro código);
 *   - 69 pasadas nombran VARIOS lotes ("25111002+25111001+PREC 25111901",
 *     1,18 M kg) pero todo el kg iba al primero;
 *   - reciclaje/boxes añadidos y re-pasadas de PRECALIBRADO (fruta ya contada).
 *
 * SOLUCIÓN (reglas acordadas con el dueño, 21-jul-2026): calcular un
 * "procesado conciliado" por lote SIN tocar los datos crudos:
 *   1. Las pasadas multi-código se reparten entre TODOS los lotes nombrados,
 *      con tope en el pendiente de cada uno (en el orden del nombre).
 *   2. El exceso de un lote (proc > entrada) se derrama a lotes CON pendiente:
 *      primero misma finca + misma familia de variedad, luego misma familia en
 *      otra finca; en ambos casos por cercanía de fecha de entrada. Con tope
 *      en el pendiente del receptor.
 *   3. Las entradas de PRECALIBRADO absorben sus propias re-pasadas (fruta ya
 *      contada) pero su exceso NO se derrama a lotes reales (sería doble
 *      cuenta) ni reciben derrames.
 *   4. Lo que no encuentra receptor queda en `excesosSinColocar` (cola de
 *      revisión) — nunca se inventa un cuadre.
 * Los totales globales no cambian: solo se reatribuye entre lotes, y cada
 * movimiento queda registrado en `movimientos` para poder auditarlo.
 *
 * REGLA DEL DUEÑO, 04-ago-2026 (textual): "cuando hay más kg, debe repartir
 * los kg entre los lotes que aparecen en el informe, sabiendo que el lote
 * principal es el primero y es el que seguramente se haga entero o casi
 * entero, y del resto seguramente con precalibrados". Diagnóstico confirmado:
 * antes de esta regla, el sobrante de una pasada MULTI-CÓDIGO que ya había
 * llenado el pendiente de TODOS los lotes nombrados caía en el MISMO derrame
 * genérico del punto 2 (misma finca/variedad) — podía acabar en un lote
 * ajeno al informe que ni siquiera se mencionó en esa pasada. Ahora ese
 * sobrante NUNCA entra en el derrame del punto 2: se marca como
 * "reentrada_nombrados" hacia los DEMÁS códigos nombrados en la pasada (el
 * principal ya se llenó en el paso 1; con toda probabilidad es su
 * precalibrado reincorporado bajo el nombre compuesto), repartido
 * proporcionalmente a lo que cada uno absorbió de ESA misma pasada (o a
 * partes iguales si ninguno absorbió nada de ella — los dos son
 * igual de simples, se elige el que mejor refleja qué código nombrado
 * "tocó" realmente la pasada). Es solo un movimiento de ATRIBUCIÓN/auditoría
 * (visible en `movimientos` y en el badge de Stock): NO llama a `tocar()`,
 * así que NO aumenta `asignado` de ningún lote (el tope de capacidad se
 * mantiene) y el kg sigue registrado en `excesosSinColocar` igual que antes
 * de existir esta regla (sigue sin "procesado" real que lo absorba; lo único
 * que cambia es que ya no se inventa un receptor ajeno al informe). El
 * derrame por finca/variedad del punto 2 queda EXCLUSIVAMENTE para el exceso
 * de pasadas de código SIMPLE (un único lote nombrado).
 *
 * REGLA DEL DUEÑO, 04-ago-2026, 2ª parte (textual): "también debes tener en
 * cuenta el valor normal o usual de podrido y mermas porque nunca habrá un
 * lote que no tenga podrido o mermas, siempre será alrededor del porcentaje
 * habitual". La CAPACIDAD del lote (ver `capacidad` más abajo) ya descontaba
 * la merma de cámara; ahora descuenta TAMBIÉN el podrido PRE-calibrador
 * habitual (fruta apartada sin pesar antes de línea, nunca llega a figurar en
 * ninguna pasada — % `PCT_PODRIDO_NO_PESADO_DEFECTO` importado de
 * `forfait.ts`, no duplicado). El podrido DE CALIBRADOR (clase "J", el que sí
 * pasa y pesa en las pasadas) NO se descuenta aquí: ya viene dentro del kg de
 * la pasada, así que restarlo también sería doble cuenta. Efecto esperado:
 * el "lote principal" de una pasada multi-código (que antes se llenaba al
 * 100 % de su capacidad) ahora se llena a su rendimiento REAL esperado —
 * entrada − merma − podrido habitual, "entero o casi entero" pero no más —
 * dejando más kg para repartir entre los demás nombrados o como
 * `reentrada_nombrados`, coherente con la 1ª parte de esta misma regla.
 */
import { diffDias } from "@/lib/entradasBascula";
// % de podrido pre-calibrador ASUMIDO (no duplicar el número, ver el
// docstring de `capacidad` más abajo): mismo % que ya usa el simulador del
// forfait para el mismo concepto (fruta apartada a contenedor sin pesar
// antes de línea, jul-2026).
import { PCT_PODRIDO_NO_PESADO_DEFECTO } from "@/lib/forfait";
import { TASA_MERMA_NATURAL_DIA } from "@/lib/mermaLote";

export interface EntradaConciliacion {
  /** Código canónico AAMMDDNN. */
  lote: string;
  /** Fecha de entrada ISO "YYYY-MM-DD" (ordena los candidatos por cercanía). */
  fecha: string;
  finca: string | null;
  articulo: string | null;
  kg_entrada: number;
  /** kg ya contados fuera de los partes (kg_ajuste_stock positivo): reducen el pendiente del lote pero NO forman parte del procesado sintético devuelto (buildStockEntradas suma el ajuste por su cuenta). */
  kg_preasignado?: number;
  /** Movimiento interno de precalibrado: absorbe sus re-pasadas pero ni derrama ni recibe. */
  esPrecalibrado?: boolean;
  /** Cerrado a mano: puede recibir kg (hasta su capacidad) pero SIN actualizar su última fecha de procesado — un derrame no debe disparar el aviso "actividad posterior al cierre". */
  cerrado?: boolean;
  /**
   * Merma REAL de cámara del lote (kg): peso inicial − peso final del
   * registro de mermas de cámara (entradas_bascula.merma_camara_kg). Cuando
   * existe, la CAPACIDAD del lote (kg máximos atribuibles como procesados) es
   * entrada − esta merma: la fruta que se evaporó en cámara nunca llegó al
   * calibrador. Sin dato, la capacidad se estima con TASA_MERMA_NATURAL_DIA ×
   * días hasta la fecha de la pasada. Sin este tope, la conciliación rellenaba
   * lotes al 100 % de su entrada y las mermas salían ≈ 0 (detectado por el
   * dueño contra el registro real de cámara, 21-jul-2026: mermas del 1,1–4,7 %).
   */
  kg_merma_camara?: number | null;
}

export interface PasadaConciliacion {
  /** Texto crudo de lotes_dia.lote_codigo (puede nombrar varios lotes). */
  lote_codigo: string | null;
  kg_peso_total: number | null;
  date?: string | null;
}

export interface MovimientoKg {
  /** Lote al que el calibrador atribuyó los kg (primer código de la pasada / donante del exceso). */
  de: string;
  a: string;
  kg: number;
  motivo: "multi_codigo" | "exceso_misma_finca" | "exceso_misma_variedad" | "reentrada_nombrados";
}

export interface ProcesadoConciliado {
  lote_codigo: string;
  kg_peso_total: number;
  date: string | null;
}

/**
 * Tara física de un box. Se aplica al introducir los datos manuales de cada
 * zona; la conciliación recibe Z1/Z2 ya netos y no vuelve a descontarla.
 */
export const TARA_BOX_RECICLAJE = 30;

/**
 * Codigos de lote que aparecen como codigo NO-primero en alguna pasada
 * COMPUESTA ("loteA+loteB..."): evidencia de que ese lote muy probablemente
 * SI se proceso, solo que el calibrador acredito el kg a otro codigo.
 *
 * Refuerzo del dueno (03-08-2026): la asignacion directa de arriba (fase 1)
 * reparte una pasada compuesta entre los codigos que nombra, PERO en el
 * orden del texto y con tope en el pendiente de cada uno -- si el PRIMER
 * codigo todavia tiene mucho pendiente, se lleva TODO el kg de la pasada y
 * los codigos siguientes no reciben nada de ESA pasada (no hay "restante"
 * que ofrecerles). Como `movimientos` solo registra un movimiento
 * "multi_codigo" cuando el codigo SI recibe algo (`absorbe > 0`), un codigo
 * que se queda sin nada en TODAS sus apariciones no deja ningun rastro: para
 * la herramienta es indistinguible de un lote que de verdad nunca se
 * proceso ("stock fantasma"), aunque su fruta este fisicamente contada bajo
 * otro codigo.
 *
 * Esta funcion NO reparte kg (imposible con fiabilidad sin inventar un
 * cuadre, y jamas por LIKE/subcadena): solo DETECTA la asociacion textual --
 * que codigos "vieron" a este lote nombrado junto al suyo en el export del
 * calibrador -- como EVIDENCIA para que un humano cierre el lote a mano (p.
 * ej. cierre_modo "sin_registro", ya existente) sabiendo que su fruta muy
 * probablemente se proceso bajo otro codigo, en vez de dejarlo pasar por
 * "sin procesar" sin ninguna pista. Se ofrece aparte de `movimientos` (que si
 * sigue siendo la fuente de verdad de que kg se atribuyo a donde) porque
 * cubre justo el caso que `movimientos` no puede ver: cero kg transferido.
 *
 * REFUERZO 04-ago-2026 (encargo del dueño, verificado contra la BD real
 * antes de tocar código — ver el inventario del informe): esta evidencia
 * textual deja de ser solo informativa. Un lote ACTIVO (báscula) nombrado
 * aquí como código no-primero, con 0 kg conciliados bajo su propio código,
 * pasa a estado derivado "procesado en compuesto" (ver
 * `buildStockEntradas`/`esCandidatoCierreCompuesto` en entradasBascula.ts) y
 * es candidato a cierre automático `sin_registro`. La MISMA evidencia
 * resuelve también el precalibrado interno (`stockPrecalibrado.ts`): de las
 * 304 entradas internas activas (846,7 t), 89 aparecen referenciadas por su
 * código exacto en `lotes_dia` (52 alguna vez como PRIMER código — ya
 * reciben su kg correctamente, sin bug) y 37 SOLO como no-primero (94,8 t) —
 * exactamente el patrón que esta función detecta. Las 215 restantes
 * (539,9 t, 159 de ellas >60 días) NO tienen ninguna mención textual en
 * ninguna pasada: para esas NO se inventa nada (ni FIFO ni derrame por
 * antigüedad) — quedan visibles con aviso "sin indicación en informes" y
 * cierre manual 1-clic, tal como pidió el dueño ("no asumas, usa lo que se
 * indique").
 *
 * `ultimaFecha`: la fecha MÁS RECIENTE (de `PasadaConciliacion.date`) entre
 * todas las pasadas compuestas que nombraron a ese código como no-primero.
 * Es la fecha de referencia para el margen de ≥2 días del cierre automático
 * (mismo `DIAS_SIN_ACTIVIDAD_AUTOCIERRE` que el cierre de completos): deja
 * "asentarse" la última mención por si llega un parte con retraso.
 */
export interface EvidenciaLotePasadaCompuesta {
  /** Primeros códigos de las pasadas compuestas que lo nombraron (orden alfabético, sin duplicar). */
  primeros: string[];
  /** Fecha más reciente entre esas pasadas; null si ninguna traía fecha. */
  ultimaFecha: string | null;
}

export function detectarLotesEnPasadaCompuesta(pasadas: PasadaConciliacion[]): Map<string, EvidenciaLotePasadaCompuesta> {
  const vistoCon = new Map<string, { primeros: Set<string>; ultimaFecha: string | null }>();
  for (const p of pasadas) {
    const kg = Number(p.kg_peso_total) || 0;
    if (kg <= 0) continue;
    const codes = String(p.lote_codigo ?? "").match(/\d{8}/g) ?? [];
    if (codes.length < 2) continue;
    const primero = codes[0]!;
    for (const code of codes.slice(1)) {
      if (code === primero) continue; // mismo codigo repetido en el texto: no hay un segundo lote real
      const acc = vistoCon.get(code) ?? { primeros: new Set<string>(), ultimaFecha: null };
      acc.primeros.add(primero);
      if (p.date && (!acc.ultimaFecha || p.date > acc.ultimaFecha)) acc.ultimaFecha = p.date;
      vistoCon.set(code, acc);
    }
  }
  const salida = new Map<string, EvidenciaLotePasadaCompuesta>();
  for (const [lote, acc] of vistoCon) {
    salida.set(lote, { primeros: Array.from(acc.primeros).sort(), ultimaFecha: acc.ultimaFecha });
  }
  return salida;
}

export interface ReciclajePasada {
  /** Primer código de lote de la pasada a la que se le descontó, o "(parte del YYYY-MM-DD)" para el reparto proporcional del día. */
  lote: string;
  /** Boxes: los anotados en el nombre de la pasada, o los del parte en la fila de reparto del día. */
  nBox: number;
  /** kg NETOS de fruta reciclada descontados. */
  kg: number;
  fecha: string | null;
}

/** "26042712 + 7 BOX DE RECICLAJE" → 7; "…+2 BOX +5 BOX PREC" → 7. 0 si no menciona boxes. */
export function contarBoxesReciclaje(texto: string | null | undefined): number {
  let total = 0;
  for (const m of String(texto ?? "").matchAll(/(\d+)\s*BOX/gi)) total += Number(m[1]) || 0;
  return total;
}

export interface ConciliacionKg {
  /** Una fila sintética por lote con kg conciliado (SIN el kg_preasignado) y su última fecha de procesado: alimenta buildStockEntradas tal cual. */
  procesados: ProcesadoConciliado[];
  movimientos: MovimientoKg[];
  /** Exceso que no encontró receptor (cola de revisión): lote donante (o texto crudo si la pasada no traía código) y kg. */
  excesosSinColocar: Array<{ lote: string; kg: number }>;
  /** kg netos reasignados por lote: positivo = recibió, negativo = cedió. 0/ausente = sus números crudos eran coherentes. */
  deltaPorLote: Map<string, number>;
  /** Boxes de reciclaje descontados de las pasadas (fruta que vuelve de la línea, ya contada en su lote original). */
  reciclaje: ReciclajePasada[];
  /** Σ kg de `reciclaje` (estimados a KG_POR_BOX_RECICLAJE por box). */
  kgReciclajeEstimado: number;
  /**
   * Kg de re-entradas de PRECALIBRADO aún sin pasada de calibrador asignada:
   * fruta FÍSICA en la nave esperando línea. Es la única parte del almacén
   * PREC medible con fiabilidad (lo que vuelve se pesa siempre en báscula;
   * lo que se aparta, no siempre — verificado 22-jul-2026: apartado
   * registrado 506 t < reintroducido 792 t, así que un "stock PREC" completo
   * saldría negativo y NO se calcula).
   */
  precalibradoPendienteKg: number;
}

/** Tokens genéricos que no distinguen variedad ("NAR VAL DELTA SEEDLESS" y "NARANJA VALENCIA DELTA" son la misma familia). OJO: "NAVEL" es genérico pero "NAVELINA" es una variedad (se compara el token completo). */
const TOKENS_GENERICOS = new Set(["NAR", "NARANJA", "NARANJAS", "VAL", "VALENCIA", "NAVEL", "DE", "DEL", "LA", "LAS", "EL", "LOS"]);

/** Primer token distintivo del artículo ("NAR VAL DELTA SEEDLESS" → "DELTA"); "" si no hay ninguno. */
export function familiaVariedad(articulo: string | null | undefined): string {
  const tokens = String(articulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  return tokens.find((t) => !TOKENS_GENERICOS.has(t)) ?? "";
}

/** Misma familia si un token es prefijo del otro (cubre "POWEL"/"POWELL"). Familias vacías nunca casan. */
export function mismaFamiliaVariedad(a: string, b: string): boolean {
  return a !== "" && b !== "" && (a.startsWith(b) || b.startsWith(a));
}

function normTexto(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

interface RegistroLote {
  entrada: EntradaConciliacion;
  familia: string;
  fincaNorm: string;
  /** kg ya atribuidos (incluye kg_preasignado inicial). */
  asignado: number;
  ultimaFecha: string | null;
}

export interface ReciclajeDiaInput {
  /** Fecha ISO del parte. */
  fecha: string;
  /** Kg NETOS de reciclaje del parte. El nombre se mantiene por compatibilidad histórica. */
  kgBruto: number;
  /** Nº de box de reciclaje: sirve para trazabilidad y para localizar las pasadas receptoras. */
  nBox: number;
}

/**
 * Fracción (0-1) de la entrada que se espera CONCILIAR como máximo tras
 * `dias` en cámara, SIN merma de cámara real registrada: 1 − merma natural
 * estimada (TASA_MERMA_NATURAL_DIA × días, acotada al 15 %) − podrido
 * pre-calibrador habitual (PCT_PODRIDO_NO_PESADO_DEFECTO). Es EXACTAMENTE la
 * misma fórmula que usa `capacidad()` dentro de `conciliarKgProcesados` (la
 * función de más abajo la reutiliza, no la duplica) para topar cuánto puede
 * absorber un lote sin merma real conocida.
 *
 * Refuerzo 04-ago-2026 (ground truth del dueño: 3 lotes de Guadex —
 * 26050508/26050608/26050609, ~90 días, 87-95 % procesado— confirmados
 * FÍSICAMENTE vacíos en cámara): el umbral plano del 97 % de
 * `UMBRAL_PROCESADO` es demasiado exigente para lotes VIEJOS, que nunca
 * llegan a esa cifra aunque estén completos de facto. Se exporta para que
 * `entradasBascula.ts` (umbralCompletoPorEdad/estadoLotePorProcesado) la
 * use como umbral DINÁMICO sin necesitar importarla directamente (evitaría
 * un ciclo entradasBascula.ts ⇄ conciliacionKg.ts/mermaLote.ts): se le
 * inyecta como callback desde useEntradasBascula.ts.
 */
export function capacidadFraccionEstimada(dias: number): number {
  const diasNoNegativos = Math.max(0, dias);
  return (1 - Math.min(0.15, TASA_MERMA_NATURAL_DIA * diasNoNegativos)) * (1 - PCT_PODRIDO_NO_PESADO_DEFECTO);
}

export function conciliarKgProcesados(
  entradas: EntradaConciliacion[],
  pasadas: PasadaConciliacion[],
  /**
   * Reciclaje DIARIO del parte. Z1+Z2 ya llegan netos de tara y se descuentan
   * de las pasadas de esa fecha ANTES de atribuir kg a las entradas: primero a las pasadas que
   * anotan boxes en su nombre ("+7 BOX DE RECICLAJE", en proporción a sus
   * boxes — localizan por dónde volvió la fruta), y el resto proporcional a
   * los kg de todas las pasadas del día. Sin dato del parte no se descuenta
   * nada: los boxes anotados en nombres, por sí solos, no cuantifican fruta.
   */
  reciclajePorDia: ReciclajeDiaInput[] = [],
  /**
   * Códigos de lote con alguna señal VIGENTE de "sigue en cámara" ahora
   * mismo: la UNIÓN de cámara EXTERNA (ver codigosEnCamaraExterna en
   * camarasExternas.ts) y confirmación FÍSICA por inventario a pie (ver
   * camaraConfirmadaVigentePorLote en camaraConfirmada.ts, refuerzo
   * 04-08-2026: 26 lotes de la cámara 5 confirmados por el dueño). Regla del
   * dueño 04-08-2026 (ground truth nº2, prioridad máxima): "es físicamente
   * imposible que fruta que está en cámara haya pasado por el calibrador" —
   * estos lotes quedan EXCLUIDOS de los candidatos al derrame por exceso
   * (fase 2, misma finca/variedad). Caso real que lo destapó: 4 lotes de
   * Guadex (26050809/26051106/26052207/26052506, Invermarmelo) recibían kg
   * del derrame de otros lotes reales de Invermarmelo y el auto-cierre por
   * edad los cerraba "con_analisis" — físicamente imposible, esa fruta
   * seguía en cámara. Se llamó `lotesEnCamaraExterna` cuando solo cubría la
   * primera señal; el caller (useEntradasBascula.ts) ya construye aquí la
   * UNIÓN de ambas antes de inyectarla, así que el nombre se generaliza para
   * no mentir sobre lo que representa. Opcional para no romper llamadas
   * existentes (tests, o mientras el caller no tenga esta señal a mano): sin
   * ella, el comportamiento es el de siempre (documentado, no una regresión).
   */
  lotesConfirmadosEnCamara?: Set<string>,
): ConciliacionKg {
  const reg = new Map<string, RegistroLote>();
  for (const e of entradas) {
    // Si un código viniera duplicado, se queda la primera aparición (los
    // exports reales no duplican lote de entrada).
    if (reg.has(e.lote)) continue;
    reg.set(e.lote, {
      entrada: e,
      familia: familiaVariedad(e.articulo),
      fincaNorm: normTexto(e.finca),
      asignado: Math.max(0, Number(e.kg_preasignado) || 0),
      ultimaFecha: null,
    });
  }
  /**
   * CAPACIDAD del lote a una fecha: kg máximos que pudieron salir de cámara
   * hacia el calibrador. Con merma de cámara REAL registrada: entrada − merma.
   * Sin dato: entrada × (1 − TASA_MERMA_NATURAL_DIA × días en cámara hasta la
   * fecha de referencia), acotada a un 15 % de descuento como salvaguarda.
   * Sin este tope la conciliación rellenaba lotes al 100 % de su entrada y la
   * merma salía ≈ 0 en todos los lotes tocados por el reparto.
   *
   * Regla del dueño, 04-ago-2026 (textual): "también debes tener en cuenta el
   * valor normal o usual de podrido y mermas porque nunca habrá un lote que
   * no tenga podrido o mermas, siempre será alrededor del porcentaje
   * habitual". Sobre lo anterior (merma de cámara) se descuenta TAMBIÉN el
   * podrido PRE-calibrador habitual: fruta que se aparta a un contenedor SIN
   * pesar antes de entrar a línea y que por tanto JAMÁS llega a figurar en
   * ninguna pasada del calibrador — mismo % asumido que ya usa el simulador
   * del forfait para este concepto (`PCT_PODRIDO_NO_PESADO_DEFECTO`,
   * src/lib/forfait.ts, documentado allí junto a `calidadReferencias.ts`; se
   * importa, no se duplica el número). OJO, matiz importante: el podrido DE
   * CALIBRADOR (clase "(J) Podrido") NO se descuenta aquí — ese SÍ pasa por
   * la máquina y SÍ pesa en las pasadas crudas, así que ya viene incluido en
   * el kg de la pasada que se reparte; restarlo de la capacidad sería doble
   * cuenta. v1 usa el % global asumido; enchufar la referencia medida POR
   * PRODUCTOR (calidad_referencias_productor) es trivial en cuanto haga falta
   * más precisión, pero exigiría pasarle ese dato a `conciliarKgProcesados`
   * (una query nueva) — se deja para cuando se necesite, no ahora.
   *
   * Las re-entradas de PRECALIBRADO quedan fuera de este descuento (ver más
   * abajo): su podrido pre-calibrador ya se separó en la entrada ORIGINAL, no
   * se resta dos veces en la re-entrada.
   */
  const capacidad = (r: RegistroLote, fechaRef: string | null | undefined): number => {
    // Las re-entradas de PRECALIBRADO ya se pesan en neto al volver: sin
    // descuento estimado (su "cámara" empieza en la re-entrada) NI descuento
    // de podrido pre-calibrador (ya se separó en su entrada original).
    if (r.entrada.esPrecalibrado) return r.entrada.kg_entrada;
    const mermaReal = r.entrada.kg_merma_camara;
    if (mermaReal != null) {
      const trasMermaCamara = Math.max(0, r.entrada.kg_entrada - Math.max(0, mermaReal));
      return trasMermaCamara * (1 - PCT_PODRIDO_NO_PESADO_DEFECTO);
    }
    const dias = fechaRef && r.entrada.fecha && fechaRef > r.entrada.fecha
      ? diffDias(r.entrada.fecha, fechaRef)
      : 0;
    return r.entrada.kg_entrada * capacidadFraccionEstimada(dias);
  };
  const pendiente = (r: RegistroLote, fechaRef: string | null | undefined) =>
    Math.max(0, capacidad(r, fechaRef) - r.asignado);

  const movimientos: MovimientoKg[] = [];
  const excesosSinColocar: Array<{ lote: string; kg: number }> = [];
  // Exceso acumulado por lote donante tras la fase de asignación directa, con
  // la última fecha de sus pasadas (los receptores del derrame la heredan).
  const excesoPorLote = new Map<string, { kg: number; ultimaFecha: string | null }>();

  const tocar = (r: RegistroLote, kg: number, fecha: string | null | undefined, esDerrame: boolean) => {
    r.asignado += kg;
    // Un derrame sobre un lote cerrado no actualiza su última fecha: el
    // cierre manual no debe marcarse como "actividad posterior" por una
    // reatribución contable.
    if (esDerrame && r.entrada.cerrado) return;
    if (fecha && (!r.ultimaFecha || fecha > r.ultimaFecha)) r.ultimaFecha = fecha;
  };

  // ── Fase 0: reciclaje DIARIO del parte (Z1+Z2 ya llegan netos) ────────────
  // El neto de fruta reciclada del día se descuenta de las pasadas de esa
  // fecha: primero a las que anotan boxes en el nombre (proporcional a sus
  // boxes: localizan por dónde volvió la fruta), el resto proporcional a los
  // kg de todas las pasadas del día. Se materializa en `descuentoPorPasada`
  // (índice original de la pasada → kg a restar) que consume la fase 1.
  const pasadasOrdenadas = pasadas
    .map((p, i) => ({ p, i }))
    .sort((a, b) => ((a.p.date ?? "").localeCompare(b.p.date ?? "")) || a.i - b.i);

  const reciclaje: ReciclajePasada[] = [];
  const descuentoPorPasada = new Map<number, number>();

  interface PasadaDia { i: number; kg: number; nBoxNombre: number; etiqueta: string }
  const pasadasPorDia = new Map<string, PasadaDia[]>();
  for (const { p, i } of pasadasOrdenadas) {
    const kg = Number(p.kg_peso_total) || 0;
    if (kg <= 0 || !p.date) continue;
    const texto = String(p.lote_codigo ?? "");
    const arr = pasadasPorDia.get(p.date) ?? [];
    arr.push({
      i,
      kg,
      nBoxNombre: contarBoxesReciclaje(texto),
      etiqueta: texto.match(/\d{8}/)?.[0] ?? (texto.trim() || "(sin código)"),
    });
    pasadasPorDia.set(p.date, arr);
  }

  const reciclajeDiaAgregado = new Map<string, { kgBruto: number; nBox: number }>();
  for (const dia of reciclajePorDia) {
    const acc = reciclajeDiaAgregado.get(dia.fecha) ?? { kgBruto: 0, nBox: 0 };
    acc.kgBruto += Math.max(0, Number(dia.kgBruto) || 0);
    acc.nBox += Math.max(0, Number(dia.nBox) || 0);
    reciclajeDiaAgregado.set(dia.fecha, acc);
  }

  for (const [fecha, dia] of reciclajeDiaAgregado) {
    // Los campos manuales Z1/Z2 ya tienen descontada la tara de sus boxes.
    let neto = Math.max(0, dia.kgBruto);
    if (neto <= 0) continue;
    const grupo = pasadasPorDia.get(fecha);
    if (!grupo || grupo.length === 0) continue; // día sin pasadas: nada de lo que descontar

    const disponible = (g: PasadaDia) => g.kg - (descuentoPorPasada.get(g.i) ?? 0);
    neto = Math.min(neto, grupo.reduce((s, g) => s + disponible(g), 0));

    // 1º: pasadas que anotan boxes en su nombre, en proporción a sus boxes.
    const conNombre = grupo.filter((g) => g.nBoxNombre > 0);
    const totalBoxNombre = conNombre.reduce((s, g) => s + g.nBoxNombre, 0);
    let pendiente = neto;
    if (totalBoxNombre > 0) {
      for (const g of conNombre) {
        const cuota = Math.min(neto * (g.nBoxNombre / totalBoxNombre), disponible(g));
        if (cuota <= 0) continue;
        descuentoPorPasada.set(g.i, (descuentoPorPasada.get(g.i) ?? 0) + cuota);
        pendiente -= cuota;
        reciclaje.push({ lote: g.etiqueta, nBox: g.nBoxNombre, kg: cuota, fecha });
      }
    }

    // 2º: el resto, proporcional a los kg restantes de TODAS las pasadas del día.
    if (pendiente > 0.5) {
      const base = grupo.reduce((s, g) => s + disponible(g), 0);
      if (base > 0) {
        let aplicado = 0;
        for (const g of grupo) {
          const cuota = Math.min(pendiente * (disponible(g) / base), disponible(g));
          if (cuota <= 0) continue;
          descuentoPorPasada.set(g.i, (descuentoPorPasada.get(g.i) ?? 0) + cuota);
          aplicado += cuota;
        }
        if (aplicado > 0.5) reciclaje.push({ lote: `(parte del ${fecha})`, nBox: dia.nBox, kg: aplicado, fecha });
      }
    }
  }

  // ── Fase 1: asignación directa, pasada a pasada (orden cronológico) ────────
  for (const { p, i } of pasadasOrdenadas) {
    let kg = Number(p.kg_peso_total) || 0;
    if (kg <= 0) continue;
    const texto = String(p.lote_codigo ?? "");
    const codes = texto.match(/\d{8}/g) ?? [];

    // Reciclaje del día ya repartido en la fase 0: fruta que vuelve de la
    // línea, ya contada en su lote original — fuera antes de atribuir nada.
    const descuento = descuentoPorPasada.get(i) ?? 0;
    if (descuento > 0) {
      kg -= descuento;
      if (kg <= 0.5) continue;
    }

    if (codes.length === 0) {
      // Pasada sin código ("PREC DIA 08/11/25"): no hay lote al que atribuir.
      excesosSinColocar.push({ lote: texto.trim() || "(sin código)", kg });
      continue;
    }
    const firstCode = codes[0]!;
    // Códigos DISTINTOS nombrados en el texto (una pasada puede repetir el
    // mismo código, p.ej. "26030103+26030103": eso no es multi-código de
    // verdad, es un único lote con el nombre duplicado).
    const codigosDistintos = Array.from(new Set(codes));
    const esMultiCodigo = codigosDistintos.length > 1;
    // kg absorbido por CADA código en ESTA pasada (agregado si el código se
    // repite en el texto): pondera el reparto de la reentrada más abajo.
    const absorbidoPorCode = new Map<string, number>();

    let restante = kg;
    for (const code of codes) {
      if (restante <= 0) break;
      const r = reg.get(code);
      if (!r) continue; // código desconocido (otra campaña, error de teclado): no se puede acotar
      const absorbe = Math.min(restante, pendiente(r, p.date));
      if (absorbe <= 0) continue;
      tocar(r, absorbe, p.date, false);
      restante -= absorbe;
      absorbidoPorCode.set(code, (absorbidoPorCode.get(code) ?? 0) + absorbe);
      if (code !== firstCode) {
        movimientos.push({ de: firstCode, a: code, kg: absorbe, motivo: "multi_codigo" });
      }
    }

    if (restante > 0.5) {
      if (esMultiCodigo) {
        // Regla del dueño 04-ago-2026 (ver docstring del módulo): el sobrante
        // de una pasada MULTI-CÓDIGO, tras llenar el pendiente de TODOS los
        // nombrados, se atribuye a los DEMÁS códigos nombrados (el principal
        // ya se llenó arriba) como "reentrada_nombrados" — proporcional a lo
        // que cada uno absorbió de ESTA pasada, o a partes iguales si ninguno
        // absorbió nada (ya estaban a tope antes de esta pasada). Es solo
        // ATRIBUCIÓN: no se llama a tocar(), así que no infla `asignado` de
        // nadie, y el kg sigue yendo a excesosSinColocar como cualquier
        // exceso sin procesado real que lo absorba — lo que cambia es que
        // JAMÁS se ofrece a un lote de la misma finca/variedad ajeno al
        // informe (eso queda solo para pasadas de código simple, más abajo).
        const demas = codigosDistintos.filter((c) => c !== firstCode && reg.has(c));
        if (demas.length > 0) {
          const pesos = demas.map((c) => absorbidoPorCode.get(c) ?? 0);
          const sumaPesos = pesos.reduce((s, v) => s + v, 0);
          demas.forEach((code, idx) => {
            const share = sumaPesos > 0 ? restante * (pesos[idx]! / sumaPesos) : restante / demas.length;
            if (share <= 0.0001) return;
            movimientos.push({ de: firstCode, a: code, kg: share, motivo: "reentrada_nombrados" });
          });
        }
        excesosSinColocar.push({ lote: firstCode, kg: restante });
      } else {
        const donante = firstCode;
        const acc = excesoPorLote.get(donante) ?? { kg: 0, ultimaFecha: null };
        acc.kg += restante;
        const fecha = p.date ?? null;
        if (fecha && (!acc.ultimaFecha || fecha > acc.ultimaFecha)) acc.ultimaFecha = fecha;
        excesoPorLote.set(donante, acc);
      }
    }
  }

  // ── Fase 2: derrame de excesos a lotes con pendiente ───────────────────────
  const donantes = Array.from(excesoPorLote.keys()).sort();
  for (const donante of donantes) {
    const exceso = excesoPorLote.get(donante)!;
    const rDonante = reg.get(donante);

    // Exceso de un lote PREC = fruta re-procesada por encima de su re-entrada:
    // derramarla a lotes reales sería contarla dos veces. A revisión.
    // Igual que el exceso de un código que no existe como entrada.
    if (!rDonante || rDonante.entrada.esPrecalibrado) {
      excesosSinColocar.push({ lote: donante, kg: exceso.kg });
      continue;
    }

    const candidatos = Array.from(reg.values())
      .filter((r) =>
        r.entrada.lote !== donante
        && !r.entrada.esPrecalibrado
        // Ground truth 04-08-2026 (nº2): un lote con señal VIGENTE de "sigue
        // en cámara" (externa o confirmación física) no puede recibir
        // derrame — es físicamente imposible que haya pasado por el
        // calibrador mientras sigue en Guadex/Zamexfruit o en la cámara 5.
        && !lotesConfirmadosEnCamara?.has(r.entrada.lote)
        && pendiente(r, exceso.ultimaFecha) > 0
        && mismaFamiliaVariedad(r.familia, rDonante.familia),
      )
      .sort((a, b) => {
        const fincaA = a.fincaNorm === rDonante.fincaNorm && a.fincaNorm !== "" ? 0 : 1;
        const fincaB = b.fincaNorm === rDonante.fincaNorm && b.fincaNorm !== "" ? 0 : 1;
        if (fincaA !== fincaB) return fincaA - fincaB;
        const distA = diffDias(
          a.entrada.fecha < rDonante.entrada.fecha ? a.entrada.fecha : rDonante.entrada.fecha,
          a.entrada.fecha < rDonante.entrada.fecha ? rDonante.entrada.fecha : a.entrada.fecha,
        );
        const distB = diffDias(
          b.entrada.fecha < rDonante.entrada.fecha ? b.entrada.fecha : rDonante.entrada.fecha,
          b.entrada.fecha < rDonante.entrada.fecha ? rDonante.entrada.fecha : b.entrada.fecha,
        );
        return distA - distB || a.entrada.fecha.localeCompare(b.entrada.fecha) || a.entrada.lote.localeCompare(b.entrada.lote);
      });

    let restante = exceso.kg;
    for (const r of candidatos) {
      if (restante <= 0.5) break;
      const absorbe = Math.min(restante, pendiente(r, exceso.ultimaFecha));
      if (absorbe <= 0) continue;
      const esMismaFinca = r.fincaNorm === rDonante.fincaNorm && r.fincaNorm !== "";
      tocar(r, absorbe, exceso.ultimaFecha, true);
      restante -= absorbe;
      movimientos.push({
        de: donante,
        a: r.entrada.lote,
        kg: absorbe,
        motivo: esMismaFinca ? "exceso_misma_finca" : "exceso_misma_variedad",
      });
    }

    if (restante > 0.5) excesosSinColocar.push({ lote: donante, kg: restante });
  }

  // ── Salidas ────────────────────────────────────────────────────────────────
  const procesados: ProcesadoConciliado[] = [];
  for (const r of reg.values()) {
    const kgSinteticos = r.asignado - Math.max(0, Number(r.entrada.kg_preasignado) || 0);
    if (kgSinteticos <= 0) continue;
    procesados.push({ lote_codigo: r.entrada.lote, kg_peso_total: kgSinteticos, date: r.ultimaFecha });
  }
  procesados.sort((a, b) => a.lote_codigo.localeCompare(b.lote_codigo));

  const deltaPorLote = new Map<string, number>();
  for (const m of movimientos) {
    deltaPorLote.set(m.de, (deltaPorLote.get(m.de) ?? 0) - m.kg);
    deltaPorLote.set(m.a, (deltaPorLote.get(m.a) ?? 0) + m.kg);
  }

  let precalibradoPendienteKg = 0;
  for (const r of reg.values()) {
    if (!r.entrada.esPrecalibrado) continue;
    precalibradoPendienteKg += Math.max(0, r.entrada.kg_entrada - r.asignado);
  }

  return {
    procesados,
    movimientos,
    excesosSinColocar,
    deltaPorLote,
    reciclaje,
    kgReciclajeEstimado: reciclaje.reduce((s, r) => s + r.kg, 0),
    precalibradoPendienteKg,
  };
}
