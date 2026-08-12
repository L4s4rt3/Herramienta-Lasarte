/**
 * cmvProducto.ts — lib PURA (sin red) del CMV POR PRODUCTO y del beneficio
 * diario por producto (Económico → Coste por producto).
 *
 * Encargo del dueño (07-ago-2026): "definir costes de cada producto — el
 * forfait, el coste de compra de la fruta, el coste de tratamiento (con
 * trabajadores, consumibles…) y el precio de venta. Sacar el CMV por producto
 * y ver cada día si perdemos o ganamos dinero".
 *
 *   CMV €/kg = fruta €/kg + material €/kg + tratamiento €/kg
 *   Margen   = (precio de venta − CMV) × kg
 *
 * ─── Diferencia con los dos módulos que ya existen ──────────────────────────
 * - src/lib/cmv.ts calcula UN CMV mensual para toda la empresa (coste total ÷
 *   kg vendidos del mes). Responde "¿cuánto me cuesta el kilo medio?".
 * - src/lib/rentabilidadDia.ts calcula el beneficio del día POR LOTE y por
 *   destino comercial (10 destinos gruesos). Responde "¿qué dejó el día?".
 * - Este módulo cruza los dos ejes: día × PRODUCTO (los 978 del catálogo).
 *   Responde "¿qué producto me está haciendo perder dinero hoy?".
 * Los tres deben cuadrar en total: mismos kg del calibrador, mismo coste de
 * fruta de báscula, mismo coste de tratamiento del día.
 *
 * ─── Las tres decisiones de método (del dueño, 07-ago-2026) ─────────────────
 * 1. FRUTA — reparto PLANO dentro del lote: cada kg que sale de un lote carga
 *    el mismo €/kg de compra, salga en malla o en industria. Es lo que dice el
 *    excel de compra de fruta (un precio por lote, no por destino). Consecuencia
 *    asumida: la industria SIEMPRE sale en pérdida (cuesta ~0,50 €/kg y se
 *    vende a ~0,14), y eso es exactamente lo que hay que ver. La alternativa
 *    contable (industria como subproducto que solo absorbe su precio) NO se
 *    implementa aquí: cambiaría la pregunta a "¿cuánto gana la malla?" y
 *    escondería el coste real de la merma.
 * 2. TRATAMIENTO — reparto por KG PONDERADO por el índice de confección de
 *    cada producto: confeccionar una malla lleva manos que tirar un box de
 *    industria no lleva. El índice vive en la ficha del producto y es
 *    relativo (granel = 1,0 es el ancla), no €/kg.
 * 3. PRODUCTO — ficha propia por producto (no herencia por empaque): cada
 *    producto tiene su coste de material, su índice y su precio.
 *
 * ─── null ≠ 0, y el CMV incompleto se dice ──────────────────────────────────
 * Un componente sin dato (lote sin liquidar, ficha sin coste de material,
 * producto sin precio) NO vale 0: sale `null` y el producto se marca
 * `incompleto` con la lista de lo que le falta. Un CMV al que le falta el
 * material es más bajo que el real, y presentarlo como bueno haría tomar la
 * decisión contraria a la correcta. Los totales del día suman SOLO lo conocido
 * y publican aparte cuántos kg van sin cada componente.
 */
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import type { ZonaProductoInforme } from "@/lib/asistenciaProductoClasificacion";
import {
  claveProducto,
  deducirProducto,
  INDICE_CONFECCION_SEMILLA,
  kgPorBultoDesdeEmpaque,
} from "@/lib/productosCanonicos";

// ─── Entradas ────────────────────────────────────────────────────────────────

/** Fila de lote_clasificacion (Informe LOTE) con lo que necesita el cálculo. */
export interface FilaClasifProducto {
  lote_codigo: string | null;
  producto: string | null;
  clase: string | null;
  peso_kg: number | null;
}

/**
 * Ficha del catálogo (productos_catalogo) tal y como llega de Supabase. Todos
 * los importes pueden ser null: null = "sin dato", nunca 0.
 */
export interface FichaProducto {
  clave: string;
  nombre: string;
  kg_por_bulto: number | null;
  coste_material_bulto: number | null;
  coste_material_pieza: number | null;
  indice_confeccion: number | null;
  precio_venta_eur_kg: number | null;
  metodo_venta: string | null;
  zona_override: ZonaProductoInforme | null;
  activo: boolean;
}

/** Coste de fruta de un lote: importe_total/kg_entrada de báscula. null = sin liquidar. */
export interface FrutaLoteProducto {
  eurKg: number | null;
}

export interface OpcionesCmvProducto {
  /**
   * Coste de TRATAMIENTO del día en €: personal + suministros + consumibles.
   * Es el importe que se reparte entre los productos por kg ponderado. Lo
   * calcula el llamador (mismo criterio que rentabilidadDia.ts) para que este
   * módulo no duplique la regla de nómina.
   */
  tratamientoDiaEur: number;
  /**
   * Empaque conocido por producto (de producto_dia / Informe PRODUCTO),
   * indexado por CLAVE canónica. Sirve para deducir los kg por bulto cuando la
   * ficha no los trae. Puede estar vacío: el Informe PRODUCTO solo cubre desde
   * may-2026.
   */
  empaquePorClave?: Map<string, string>;
  /**
   * Precio real €/kg por método de venta (Mercadona de la semana, ERP del
   * mes). Manda sobre el precio manual de la ficha: es facturación real.
   */
  precioPorMetodo?: Map<string, number>;
  /**
   * ESTRUCTURA del periodo en €: alquiler, seguros, amortización, gestoría,
   * financieros. Viene de los apuntes mensuales (cmv_costes_mensuales)
   * prorrateados a los días del periodo.
   *
   * Se reparte POR KG PLANOS, no por el índice de confección: el alquiler y el
   * seguro no dependen de si el kilo va en malla o en box, a diferencia del
   * personal. Mezclar las dos bases sería más cómodo pero le cargaría a la
   * malla una estructura que no consume.
   *
   * 0 o ausente = sin apuntes cargados. El resultado publica `sinEstructura`
   * para que la página pueda decir que el margen está antes de estructura en
   * vez de darlo por bueno.
   */
  estructuraPeriodoEur?: number;
}

// ─── Salidas ─────────────────────────────────────────────────────────────────

/** Componente que le falta a un producto para tener el CMV completo. */
export type FaltanteCmv = "fruta" | "material" | "indice" | "precio";

export interface CmvProductoDia {
  clave: string;
  nombre: string;
  zona: ZonaProductoInforme;
  /** true si la zona no participa en confección (podrido, muestras, precalibrado). */
  excluido: boolean;
  marca: string | null;
  calibre: string | null;

  kg: number;

  // ─── Fruta ───
  /** €/kg de compra, media ponderada de los lotes de los que salió este producto hoy. */
  frutaEurKg: number | null;
  /** € de fruta de los kg CON lote liquidado. */
  frutaEur: number;
  /** Kg de este producto sin coste de fruta imputado, por cualquiera de los dos motivos de abajo. */
  kgSinCosteFruta: number;
  /**
   * De `kgSinCosteFruta`, los que vienen de una pasada SIN código de lote
   * reconocible: el operario anotó a mano de qué días sale la fruta
   * ("22/07 22 BOX - 23/07 43 BOX"). Es PRECALIBRADO, y su fruta ya se pagó
   * el día que entró: NO es un dato que falte.
   */
  kgPrecalibrado: number;
  /**
   * De `kgSinCosteFruta`, los que SÍ traen código de lote pero cuya entrada de
   * báscula no tiene importe. Aquí sí falta el dato y el CMV sale corto.
   */
  kgLoteSinLiquidar: number;

  // ─── Material ───
  /** Kg de fruta por bulto (ficha, o deducido del empaque). null = desconocido. */
  kgPorBulto: number | null;
  /** Bultos equivalentes: kg / kgPorBulto. null si no hay kgPorBulto. */
  bultos: number | null;
  materialEur: number | null;
  materialEurKg: number | null;

  // ─── Tratamiento ───
  /** Índice de confección aplicado (ficha, o semilla de su zona). null = no absorbe. */
  indice: number | null;
  /** kg × índice: la cuota con la que este producto absorbe el tratamiento. */
  kgPonderados: number;
  tratamientoEur: number;
  tratamientoEurKg: number | null;

  // ─── Estructura ───
  /** Cuota de estructura del producto: por kg planos, no por índice. */
  estructuraEur: number;
  estructuraEurKg: number | null;

  // ─── CMV ───
  /** fruta + material + tratamiento + estructura, €/kg. null si le falta algún componente. */
  cmvEurKg: number | null;
  /** Suma de lo CONOCIDO en €, aunque falte algún componente (para los totales). */
  cmvEurParcial: number;
  /** Qué componentes faltan. Vacío = CMV completo y fiable. */
  faltantes: FaltanteCmv[];
  completo: boolean;

  // ─── Venta ───
  precioEurKg: number | null;
  /** De dónde salió el precio: facturación real del método, o la ficha. */
  precioFuente: "metodo" | "ficha" | null;
  /** Método de venta aplicado (el de la ficha, o el deducido para Mercadona). */
  metodoVenta: string | null;
  ingresoEur: number | null;
  margenEurKg: number | null;
  /** (precio − CMV) × kg. null si no hay precio o el CMV está incompleto. */
  margenEur: number | null;
}

export interface CmvDiaResultado {
  productos: CmvProductoDia[];
  kgTotal: number;
  /** Σ kg × índice de todos los productos que absorben tratamiento. */
  kgPonderadosTotal: number;

  frutaEur: number;
  materialEur: number;
  tratamientoEur: number;
  estructuraEur: number;
  /** fruta + material + tratamiento + estructura, contando solo lo conocido. */
  costeEur: number;
  ingresoEur: number;
  /** ingreso − coste. Ojo: PARCIAL si hay kg sin algún componente (ver avisos). */
  margenEur: number;

  // ─── Avisos: qué le falta al día para que el número sea completo ───
  kgSinCosteFruta: number;
  /**
   * Kg de pasadas sin código de lote: precalibrado que vuelve a línea. Su
   * fruta ya se pagó el día que entró, así que NO falta ningún dato — pero el
   * periodo cobra la venta sin volver a pagar la fruta y su margen sale
   * inflado. Un periodo con esto alto no es comparable con uno normal.
   */
  kgPrecalibrado: number;
  /** Kg con código de lote real pero sin importe en báscula: aquí SÍ falta el dato. */
  kgLoteSinLiquidar: number;
  kgSinMaterial: number;
  kgSinPrecio: number;
  /** Kg que no absorbieron tratamiento por no tener índice (excluidos aparte). */
  kgSinIndice: number;
  /** Tratamiento que NO se pudo repartir (ningún producto con índice). */
  tratamientoSinRepartirEur: number;
  /** true si no hay ningún apunte de estructura: el margen está ANTES de estructura. */
  sinEstructura: boolean;
  /** true si algún componente falta en algún producto: el margen es parcial. */
  incompleto: boolean;
}

// ─── Cálculo ─────────────────────────────────────────────────────────────────

/** Clase "(J) Podrido" del calibrador — misma convención que mermaLote.ts y rentabilidadDia.ts. */
const RE_CLASE_PODRIDO = /^\(J\)/i;

/**
 * Nombre bajo el que se agrupan los kg descartados por el calibrador. La clase
 * (J) manda sobre el producto: un kg podrido es podrido aunque viaje en el box
 * de un producto bueno, y contarlo como producción de ese producto le inflaría
 * los kg y le abarataría el CMV. Va a su propio "producto", donde carga su
 * fruta y no tiene precio: la merma se ve como la pérdida que es.
 */
export const PRODUCTO_PODRIDO = "PODRIDO";

interface Acc {
  nombre: string;
  kg: number;
  /** Σ kg × €/kg de fruta de los lotes liquidados. */
  frutaEur: number;
  kgSinCosteFruta: number;
  /** Sin código de lote reconocible: precalibrado, fruta ya pagada. */
  kgPrecalibrado: number;
  /** Con código pero sin importe de báscula: dato que falta. */
  kgLoteSinLiquidar: number;
}

/**
 * CMV y margen de un día, producto a producto.
 *
 * `frutaPorLote` va indexada por la clave de 8 dígitos (normalizarLoteCodigo,
 * convención A del repo) — la misma de báscula. JAMÁS cruzar por LIKE ni por
 * subcadena: es una lección real del repo, infla los kg.
 */
export function computeCmvProductoDia(
  filas: FilaClasifProducto[],
  fichas: Map<string, FichaProducto>,
  frutaPorLote: Map<string, FrutaLoteProducto>,
  opciones: OpcionesCmvProducto,
): CmvDiaResultado {
  const { tratamientoDiaEur, empaquePorClave, precioPorMetodo } = opciones;
  const estructuraPeriodoEur = opciones.estructuraPeriodoEur ?? 0;

  // ─── 1. Agrupar los kg del día por producto, con su fruta ───
  const porClave = new Map<string, Acc>();
  for (const f of filas) {
    const kg = f.peso_kg ?? 0;
    if (kg <= 0) continue;

    const esPodrido = f.clase != null && RE_CLASE_PODRIDO.test(f.clase.trim());
    const nombreCrudo = esPodrido ? PRODUCTO_PODRIDO : (f.producto ?? "").trim();
    const clave = claveProducto(nombreCrudo);
    if (!clave) continue; // fila sin producto: no se inventa una ficha vacía

    let acc = porClave.get(clave);
    if (!acc) {
      acc = { nombre: nombreCrudo, kg: 0, frutaEur: 0, kgSinCosteFruta: 0, kgPrecalibrado: 0, kgLoteSinLiquidar: 0 };
      porClave.set(clave, acc);
    }
    acc.kg += kg;

    // Dos motivos MUY distintos para no tener coste de fruta, y confundirlos
    // lleva a leer al revés un día entero (lección real del 04-ago-2026):
    //   - Sin código de lote → el operario anotó a mano de qué días viene la
    //     fruta ("22/07 22 BOX - 23/07 43 BOX"). Es precalibrado y su fruta YA
    //     se pagó: no falta ningún dato, pero el margen del día sale inflado.
    //   - Con código y sin importe → la entrada de báscula está sin liquidar.
    //     Aquí sí falta el dato y el CMV sale más bajo del real.
    const loteBase = normalizarLoteCodigo(f.lote_codigo ?? "");
    const eurKg = loteBase ? (frutaPorLote.get(loteBase)?.eurKg ?? null) : null;
    if (eurKg != null) {
      acc.frutaEur += kg * eurKg;
    } else {
      acc.kgSinCosteFruta += kg;
      if (loteBase) acc.kgLoteSinLiquidar += kg;
      else acc.kgPrecalibrado += kg;
    }
  }

  // ─── 2. Resolver la ficha de cada producto y su índice ───
  interface Resuelto {
    clave: string;
    acc: Acc;
    ficha: FichaProducto | undefined;
    nombre: string;
    zona: ZonaProductoInforme;
    excluido: boolean;
    marca: string | null;
    calibre: string | null;
    kgPorBulto: number | null;
    indice: number | null;
    /** Método de venta deducido del nombre (solo Mercadona). */
    metodoVenta: string | null;
    /** Mallas por bulto, para cobrar el material por pieza en los girsacs. */
    piezasPorBulto: { piezas: number; kgPorPieza: number } | null;
  }
  const resueltos: Resuelto[] = [];
  let kgPonderadosTotal = 0;

  for (const [clave, acc] of porClave) {
    const ficha = fichas.get(clave);
    const nombre = ficha?.nombre ?? acc.nombre;
    // Lo deducible se calcula, no se lee de la BD (estado derivado, principio
    // del repo): así una mejora de la deducción llega sola a todo el módulo.
    const empaque = empaquePorClave?.get(clave) ?? null;
    const deducido = deducirProducto(nombre, empaque);
    const zona = ficha?.zona_override ?? deducido.zona;
    const excluido = zona === "Excluir";

    // kg por bulto: manda la ficha (el dueño lo corrigió), si no lo deducido
    // del empaque. En girsacs el material se consume por MALLA, así que los
    // "bultos" a los que se aplica coste_material_pieza son las piezas.
    const kgPorBulto = ficha?.kg_por_bulto ?? deducido.kgPorBulto ?? null;

    // Índice: manda la ficha, si no la semilla de su zona. Los excluidos no
    // absorben tratamiento (null, no 0: el precalibrado lo consumirá el día
    // que se confeccione, bajo el producto que salga entonces).
    const indice = ficha?.indice_confeccion ?? INDICE_CONFECCION_SEMILLA[zona];

    if (indice != null && indice > 0) kgPonderadosTotal += acc.kg * indice;

    resueltos.push({
      clave, acc, ficha, nombre, zona, excluido,
      marca: deducido.marca,
      calibre: deducido.calibre,
      kgPorBulto,
      indice: indice ?? null,
      metodoVenta: deducido.metodoVenta,
      piezasPorBulto: deducido.piezasPorBulto,
    });
  }

  // ─── 3. Componer cada producto ───
  const productos: CmvProductoDia[] = [];
  const dia: CmvDiaResultado = {
    productos,
    kgTotal: 0,
    kgPonderadosTotal,
    frutaEur: 0,
    materialEur: 0,
    tratamientoEur: 0,
    estructuraEur: 0,
    costeEur: 0,
    ingresoEur: 0,
    margenEur: 0,
    kgSinCosteFruta: 0,
    kgPrecalibrado: 0,
    kgLoteSinLiquidar: 0,
    kgSinMaterial: 0,
    kgSinPrecio: 0,
    kgSinIndice: 0,
    tratamientoSinRepartirEur: kgPonderadosTotal > 0 ? 0 : tratamientoDiaEur,
    sinEstructura: estructuraPeriodoEur <= 0,
    incompleto: false,
  };

  // Kg entre los que se reparte la estructura: TODOS los del periodo, incluido
  // lo apartado. El podrido y el precalibrado también han ocupado almacén y
  // han pasado por la nave, así que su parte de alquiler la consumen igual.
  const kgTotalPeriodo = resueltos.reduce((s, r) => s + r.acc.kg, 0);

  for (const r of resueltos) {
    const { acc, ficha } = r;
    const kg = acc.kg;
    const faltantes: FaltanteCmv[] = [];

    // ── Fruta ──
    const kgConFruta = kg - acc.kgSinCosteFruta;
    const frutaEurKg = kgConFruta > 0 ? acc.frutaEur / kgConFruta : null;
    if (acc.kgSinCosteFruta > 0) faltantes.push("fruta");

    // ── Material ──
    // Dos formas de cobrarlo, según cómo se consume: por PIEZA (girsacs: 9
    // mallas por bulto gastan 9 mallas de material) o por BULTO (caja, box).
    // Si la ficha trae las dos, se suman: un girsac gasta las mallas Y la caja
    // que las agrupa.
    const piezas = r.piezasPorBulto;
    let materialEur: number | null = null;
    let bultos: number | null = null;
    const costeBulto = ficha?.coste_material_bulto ?? null;
    const costePieza = ficha?.coste_material_pieza ?? null;

    if (r.kgPorBulto != null && r.kgPorBulto > 0) {
      bultos = kg / r.kgPorBulto;
      let total = 0;
      let algo = false;
      if (costeBulto != null) { total += bultos * costeBulto; algo = true; }
      if (costePieza != null) {
        // Piezas del día: si el producto declara piezas por bulto ("9X2 K"),
        // son bultos × piezas; si no, se asume una pieza por bulto.
        const piezasDia = bultos * (piezas?.piezas ?? 1);
        total += piezasDia * costePieza;
        algo = true;
      }
      materialEur = algo ? total : null;
    }
    // Los excluidos (podrido, muestras, precalibrado) no llevan material: no
    // se envasan. Su material es 0 de verdad, no un dato que falte.
    if (r.excluido) materialEur = materialEur ?? 0;
    if (materialEur == null) faltantes.push("material");

    // ── Tratamiento ──
    const kgPonderados = r.indice != null && r.indice > 0 ? kg * r.indice : 0;
    const tratamientoEur = kgPonderadosTotal > 0
      ? tratamientoDiaEur * (kgPonderados / kgPonderadosTotal)
      : 0;
    // Un producto NO excluido sin índice es un hueco real de la ficha: no está
    // absorbiendo el coste de tratamiento que le toca.
    if (!r.excluido && (r.indice == null || r.indice <= 0)) faltantes.push("indice");

    // ── Estructura ──
    // Por kg planos: un kilo de industria ocupa la misma nave que uno de malla.
    const estructuraEur = kgTotalPeriodo > 0 ? estructuraPeriodoEur * (kg / kgTotalPeriodo) : 0;
    const estructuraEurKg = kg > 0 ? estructuraEur / kg : null;

    // ── CMV ──
    const materialEurKg = materialEur != null && kg > 0 ? materialEur / kg : null;
    const tratamientoEurKg = kg > 0 ? tratamientoEur / kg : null;
    const cmvEurKg =
      frutaEurKg != null && materialEurKg != null && tratamientoEurKg != null && !faltantes.length
        ? frutaEurKg + materialEurKg + tratamientoEurKg + (estructuraEurKg ?? 0)
        : null;
    const cmvEurParcial = acc.frutaEur + (materialEur ?? 0) + tratamientoEur + estructuraEur;

    // ── Venta ──
    // La facturación REAL del método manda sobre el precio manual de la ficha.
    // Si la ficha no trae método, se usa el DEDUCIDO (solo Mercadona: su
    // nombre dice el formato y los 4 códigos son 1:1 con los 4 formatos). Eso
    // da precio real a la mitad de los kg de una semana sin tocar una ficha;
    // el resto de clientes necesitan que alguien ponga el método a mano.
    const metodo = ficha?.metodo_venta?.trim().toUpperCase() || r.metodoVenta;
    const precioMetodo = metodo ? (precioPorMetodo?.get(metodo) ?? null) : null;
    const precioEurKg = precioMetodo ?? ficha?.precio_venta_eur_kg ?? null;
    const precioFuente: "metodo" | "ficha" | null =
      precioMetodo != null ? "metodo" : (ficha?.precio_venta_eur_kg != null ? "ficha" : null);
    // Lo excluido no se vende: su precio es 0 de verdad (podrido, muestras).
    const precioEfectivo = r.excluido ? 0 : precioEurKg;
    if (!r.excluido && precioEurKg == null) faltantes.push("precio");

    const ingresoEur = precioEfectivo != null ? kg * precioEfectivo : null;
    const margenEurKg = cmvEurKg != null && precioEfectivo != null ? precioEfectivo - cmvEurKg : null;
    const margenEur = margenEurKg != null ? margenEurKg * kg : null;

    productos.push({
      clave: r.clave,
      nombre: r.nombre,
      zona: r.zona,
      excluido: r.excluido,
      marca: r.marca,
      calibre: r.calibre,
      kg,
      frutaEurKg,
      frutaEur: acc.frutaEur,
      kgSinCosteFruta: acc.kgSinCosteFruta,
      kgPrecalibrado: acc.kgPrecalibrado,
      kgLoteSinLiquidar: acc.kgLoteSinLiquidar,
      kgPorBulto: r.kgPorBulto,
      bultos,
      materialEur,
      materialEurKg,
      indice: r.indice,
      kgPonderados,
      tratamientoEur,
      tratamientoEurKg,
      estructuraEur,
      estructuraEurKg,
      cmvEurKg,
      cmvEurParcial,
      faltantes,
      completo: faltantes.length === 0,
      precioEurKg: precioEfectivo,
      precioFuente,
      metodoVenta: metodo,
      ingresoEur,
      margenEurKg,
      margenEur,
    });

    // ── Totales del día: solo lo conocido ──
    dia.kgTotal += kg;
    dia.frutaEur += acc.frutaEur;
    dia.materialEur += materialEur ?? 0;
    dia.tratamientoEur += tratamientoEur;
    dia.estructuraEur += estructuraEur;
    dia.ingresoEur += ingresoEur ?? 0;
    dia.kgSinCosteFruta += acc.kgSinCosteFruta;
    dia.kgPrecalibrado += acc.kgPrecalibrado;
    dia.kgLoteSinLiquidar += acc.kgLoteSinLiquidar;
    if (materialEur == null) dia.kgSinMaterial += kg;
    if (!r.excluido && precioEurKg == null) dia.kgSinPrecio += kg;
    if (!r.excluido && (r.indice == null || r.indice <= 0)) dia.kgSinIndice += kg;
    if (faltantes.length) dia.incompleto = true;
  }

  dia.costeEur = dia.frutaEur + dia.materialEur + dia.tratamientoEur + dia.estructuraEur;
  dia.margenEur = dia.ingresoEur - dia.costeEur;

  // De lo que más pierde a lo que más gana: la pregunta del dueño es "¿qué me
  // está hundiendo el día?", así que lo peor va arriba. Los productos sin
  // margen calculable (incompletos) van al final, no mezclados con los buenos.
  productos.sort((a, b) => {
    if (a.margenEur == null && b.margenEur == null) return b.kg - a.kg;
    if (a.margenEur == null) return 1;
    if (b.margenEur == null) return -1;
    return a.margenEur - b.margenEur;
  });

  return dia;
}

// ─── Semilla de la ficha (para la UI de alta) ────────────────────────────────

/**
 * Valores con los que se propone rellenar una ficha vacía: lo deducible del
 * nombre y del empaque. NO se guarda automáticamente — es lo que la página
 * ofrece como sugerencia para que el dueño confirme, porque el coste de
 * material y el precio no hay forma de deducirlos y tienen que venir de él.
 */
export function semillaFicha(
  nombre: string,
  empaque: string | null,
): Pick<FichaProducto, "kg_por_bulto" | "indice_confeccion"> & { zona: ZonaProductoInforme } {
  const deducido = deducirProducto(nombre, empaque);
  return {
    zona: deducido.zona,
    kg_por_bulto: deducido.kgPorBulto ?? kgPorBultoDesdeEmpaque(empaque),
    indice_confeccion: INDICE_CONFECCION_SEMILLA[deducido.zona],
  };
}
