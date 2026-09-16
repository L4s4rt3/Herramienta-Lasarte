// Campo → Parcelas: el catálogo de parcelas de la campaña.
//
// POR QUÉ EXISTE (16-09-2026). La herramienta mira la fruta desde que se pesa
// en la báscula; lo que pasa ANTES —en el árbol— no tiene sitio. Esta es la
// primera página del eje PARCELA: una fila por parcela con lo que entró de
// ella, para que quien lleva el campo abra su parcela y vea qué dio.
//
// DE DÓNDE SALE CADA COSA. De las entradas de báscula (`entradas_bascula`), que
// es donde la finca y la parcela vienen escritas. No hay catálogo de parcelas
// en ningún sitio: la parcela EXISTE porque ha entrado fruta de ella. Por eso
// una parcela que aún no ha entregado no aparece — y es correcto que no
// aparezca, porque de ella no sabemos nada todavía.
//
// LO QUE NO ESTÁ AQUÍ. Ni hectáreas, ni árboles, ni estado de la plantación:
// eso lo tiene Aerobotics y llegará por su API cuando haya token (la página lo
// dice en pantalla en vez de dejar columnas vacías). El aprovechamiento de cada
// parcela tampoco se calcula aquí: es caro y lo hace useAprovechamientoReal
// sobre la parcela que se abra.
//
// Solo funciones puras: la página pinta, esto cuenta.
import { normalizarTexto } from "@/lib/format";

/** Lo que esta lib necesita de una entrada de báscula. Nada de euros: esta página es de campo, no de compras. */
export interface EntradaParcelaInput {
  finca: string | null;
  parcela: string | null;
  agricultor: string | null;
  articulo: string | null;
  lote: string;
  fecha: string;
  kg_entrada: number | null;
  certificada?: boolean | null;
  certificado_ggn?: string | null;
}

export interface FilaParcela {
  /** finca + parcela: identifica la fila (la misma parcela puede repetirse en otra finca). */
  clave: string;
  finca: string;
  /** Texto tal y como está en la báscula; "" = la entrada no traía parcela. */
  parcela: string;
  /** Lo que se enseña: la parcela, o "(sin parcela)" cuando la báscula no la trae. */
  etiqueta: string;
  /** El agricultor que más veces aparece en esas entradas. */
  agricultor: string;
  /** Variedades distintas que han entrado de la parcela, de más a menos kg. */
  variedades: string[];
  entradas: number;
  kgEntrada: number;
  /** Día de la primera y la última entrada (YYYY-MM-DD). */
  primera: string | null;
  ultima: string | null;
  /** Nº de entradas marcadas como certificadas y el código GGN visto (null si ninguno). */
  entradasCertificadas: number;
  ggn: string | null;
  /** Códigos de lote de la parcela, en orden de entrada. */
  lotes: string[];
}

export interface TotalesParcelas {
  fincas: number;
  parcelas: number;
  entradas: number;
  kgEntrada: number;
  /** Parcelas cuyas entradas NO traían nombre de parcela: el agujero del dato. */
  sinParcela: number;
}

/** Separador de la clave finca+parcela. Un carácter que no aparece en los nombres de la báscula. */
export const CLAVE_SEPARADOR = "‖";

export function claveParcela(finca: string, parcela: string): string {
  return `${finca}${CLAVE_SEPARADOR}${parcela}`;
}

export function partirClave(clave: string): { finca: string; parcela: string } {
  const i = clave.indexOf(CLAVE_SEPARADOR);
  if (i < 0) return { finca: clave, parcela: "" };
  return { finca: clave.slice(0, i), parcela: clave.slice(i + CLAVE_SEPARADOR.length) };
}

const txt = (v: string | null | undefined) => String(v ?? "").trim();

/**
 * El catálogo: una fila por finca+parcela, de más a menos kg entrados.
 * Las entradas sin finca se descartan (sin finca no hay parcela que enseñar).
 */
export function catalogoParcelas(entradas: EntradaParcelaInput[]): FilaParcela[] {
  const acc = new Map<string, {
    finca: string;
    parcela: string;
    agricultores: Map<string, number>;
    variedades: Map<string, number>;
    entradas: number;
    kg: number;
    primera: string | null;
    ultima: string | null;
    certificadas: number;
    ggn: string | null;
    lotes: Array<{ lote: string; fecha: string }>;
  }>();

  for (const e of entradas) {
    const finca = txt(e.finca);
    if (!finca) continue;
    const parcela = txt(e.parcela);
    const clave = claveParcela(finca, parcela);
    const fila = acc.get(clave) ?? {
      finca, parcela,
      agricultores: new Map<string, number>(),
      variedades: new Map<string, number>(),
      entradas: 0, kg: 0, primera: null, ultima: null, certificadas: 0, ggn: null,
      lotes: [] as Array<{ lote: string; fecha: string }>,
    };

    const kg = Number(e.kg_entrada) || 0;
    fila.entradas += 1;
    fila.kg += kg;

    const agricultor = txt(e.agricultor);
    if (agricultor) fila.agricultores.set(agricultor, (fila.agricultores.get(agricultor) ?? 0) + 1);

    const variedad = txt(e.articulo);
    if (variedad) fila.variedades.set(variedad, (fila.variedades.get(variedad) ?? 0) + kg);

    const dia = txt(e.fecha).slice(0, 10);
    if (dia) {
      if (!fila.primera || dia < fila.primera) fila.primera = dia;
      if (!fila.ultima || dia > fila.ultima) fila.ultima = dia;
    }

    if (e.certificada) fila.certificadas += 1;
    const ggn = txt(e.certificado_ggn);
    if (ggn && !fila.ggn) fila.ggn = ggn;

    const lote = txt(e.lote);
    if (lote) fila.lotes.push({ lote, fecha: dia });

    acc.set(clave, fila);
  }

  return [...acc.entries()]
    .map(([clave, f]): FilaParcela => ({
      clave,
      finca: f.finca,
      parcela: f.parcela,
      etiqueta: f.parcela || "(sin parcela)",
      agricultor: [...f.agricultores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      variedades: [...f.variedades.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v),
      entradas: f.entradas,
      kgEntrada: f.kg,
      primera: f.primera,
      ultima: f.ultima,
      entradasCertificadas: f.certificadas,
      ggn: f.ggn,
      lotes: f.lotes.sort((a, b) => a.fecha.localeCompare(b.fecha)).map((l) => l.lote),
    }))
    .sort((a, b) => b.kgEntrada - a.kgEntrada);
}

/**
 * Busca en finca, parcela, agricultor y variedades, sin tildes ni mayúsculas
 * ("torrecilla", "delta" o "camba" encuentran lo suyo). Varias palabras =
 * tienen que aparecer TODAS (en cualquier campo).
 */
export function buscarParcelas<T extends FilaParcela>(filas: T[], texto: string): T[] {
  const palabras = normalizarTexto(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return filas;
  return filas.filter((f) => {
    const heno = normalizarTexto([f.finca, f.etiqueta, f.agricultor, f.variedades.join(" ")].join(" "));
    return palabras.every((p) => heno.includes(p));
  });
}

// ─── La ficha de campo (hectáreas y contorno) ───────────────────────────────

export type EmparejadoEstado = "clara" | "probable" | "pendiente" | "confirmada" | "descartada";

/** Una parcela de Aerobotics tal y como la guarda campo_parcelas. */
export interface CampoParcelaRow {
  id: string;
  origen: string;
  origen_finca_id: string;
  /** Nombre de la finca en Aerobotics. Los planos no lo traen: sale de los informes de calibre. */
  origen_finca_nombre: string | null;
  nombre: string;
  hectareas: number | null;
  cultivo: string | null;
  variedad: string | null;
  plantacion: string | null;
  patron: string | null;
  /** Anillos [[[lon, lat], ...], ...]; el primero es el exterior. */
  contorno: Array<Array<[number, number]>>;
  centro_lon: number | null;
  centro_lat: number | null;
  finca: string | null;
  parcela: string | null;
  emparejado_estado: EmparejadoEstado;
  emparejado_puntuacion: number | null;
  emparejado_nota: string | null;
}

/**
 * Los kilos por hectárea que tienen sentido en naranja de regadío. Fuera de
 * esta horquilla no se concluye nada: o el emparejamiento está mal, o
 * Aerobotics solo tiene dibujado un trozo de lo que la báscula llama esa
 * parcela. Salió de la primera carga: La Vereda daba 104.865 kg/ha porque
 * entregó 162.540 kg y solo hay 1,55 ha dibujadas de esa finca.
 */
export const RENDIMIENTO_CREIBLE: [number, number] = [10000, 60000];

export interface FichaCampo {
  /** Suma de las hectáreas de las parcelas emparejadas CON CONFIANZA. null = no hay. */
  hectareas: number | null;
  /** Cuántos trozos dibujados suman esas hectáreas (Aerobotics parte algunas en dos). */
  trozos: number;
  /** Las fichas que cuentan (clara o confirmada). */
  fichas: CampoParcelaRow[];
  /** Emparejadas como "probable": se enseñan, pero NO suman hectáreas. */
  dudosas: CampoParcelaRow[];
  /** kg entrados ÷ hectáreas. null si no hay hectáreas de confianza. */
  kgPorHa: number | null;
  /** true si kgPorHa se sale de lo posible: el emparejamiento hay que mirarlo. */
  rendimientoIncreible: boolean;
}

export interface FilaParcelaConCampo extends FilaParcela {
  campo: FichaCampo;
}

/** Solo estas dos cuentan para calcular: una propuesta dudosa no divide kilos. */
export function fichaCuenta(f: CampoParcelaRow): boolean {
  return f.emparejado_estado === "clara" || f.emparejado_estado === "confirmada";
}

const claveDe = (finca: string | null, parcela: string | null) =>
  claveParcela(txt(finca), txt(parcela));

/**
 * Pega a cada parcela de la báscula su ficha de campo y calcula los kilos por
 * hectárea. Varias parcelas de Aerobotics pueden caer en la misma de la
 * báscula: sus hectáreas SE SUMAN (Aerobotics parte "LAS TERESAS" en dos
 * polígonos de 0,64 y 1,50 ha que para la báscula son una sola parcela, y
 * dividir los kilos entre uno solo daba 110.000 kg/ha).
 */
export function unirFichasDeCampo(filas: FilaParcela[], fichas: CampoParcelaRow[]): FilaParcelaConCampo[] {
  const porClave = new Map<string, CampoParcelaRow[]>();
  for (const f of fichas) {
    if (!f.finca) continue;
    const k = claveDe(f.finca, f.parcela);
    porClave.set(k, [...(porClave.get(k) ?? []), f]);
  }

  return filas.map((fila) => {
    const todas = porClave.get(fila.clave) ?? [];
    const cuentan = todas.filter(fichaCuenta);
    const dudosas = todas.filter((f) => f.emparejado_estado === "probable");
    const hectareas = cuentan.reduce((s, f) => s + (f.hectareas ?? 0), 0);
    const kgPorHa = hectareas > 0 ? fila.kgEntrada / hectareas : null;
    return {
      ...fila,
      campo: {
        hectareas: hectareas > 0 ? hectareas : null,
        trozos: cuentan.length,
        fichas: cuentan,
        dudosas,
        kgPorHa,
        rendimientoIncreible: kgPorHa != null && (kgPorHa < RENDIMIENTO_CREIBLE[0] || kgPorHa > RENDIMIENTO_CREIBLE[1]),
      },
    };
  });
}

// ─── El calibre en el campo ─────────────────────────────────────────────────

/** Una medida (o una previsión) de diámetro de fruta, de campo_calibre_medidas. */
export interface MedidaCalibre {
  id: string;
  finca_nombre: string;
  bloque: string;
  variedad: string | null;
  /** Semana ISO, "2026W37". Ordena bien alfabéticamente. */
  semana: string;
  mm: number;
  tipo: "medida" | "prevision";
  /** Lo que se había previsto para esta semana, aunque ya se haya medido. */
  mm_previsto: number | null;
  previsto_en: string | null;
  parcela_id: string | null;
}

/** La curva de una finca y variedad, de campo_curvas_crecimiento. */
export interface CurvaCrecimiento {
  id: string;
  finca_nombre: string;
  variedad: string;
  floracion_semana: string | null;
  ventana: string | null;
  ventana_desde: string | null;
  ventana_hasta: string | null;
  crecimiento: Record<string, number>;
  fuente: string | null;
}

/** Lo que dice Aerobotics de dónde saca cada curva, en cristiano. */
export const ETIQUETA_FUENTE: Record<string, string> = {
  previous_season_sizes: "de los tamaños de la campaña anterior",
  customer_input: "tecleado por vosotros",
  region_cultivar_default: "media de la comarca, NO fruta de esta finca",
};

export interface PuntoCalibre {
  semana: string;
  /** Milímetros medidos de verdad. null = esa semana no se midió. */
  medido: number | null;
  /** Milímetros que Aerobotics prevé. null = esa semana ya pasó. */
  previsto: number | null;
}

export interface CalibreDeParcela {
  puntos: PuntoCalibre[];
  /** Bloques de Aerobotics que aportan medidas a esta parcela. */
  bloques: string[];
  ultimaMedida: { semana: string; mm: number } | null;
  /** Lo más lejos que llega la previsión. */
  ultimaPrevision: { semana: string; mm: number } | null;
  /** Previsiones que ya tienen su medida al lado: lo previsto menos lo que salió. */
  aciertos: Array<{ semana: string; previsto: number; medido: number; error: number }>;
}

/**
 * La curva de calibre de una parcela: lo medido y lo previsto, semana a semana.
 *
 * Si a la parcela le corresponden VARIOS bloques de Aerobotics, se hace la
 * media de sus milímetros en cada semana — son trozos de la misma parcela y la
 * fruta no se puede sumar, se promedia.
 *
 * La línea de previsión arranca en la última semana medida (con su mismo valor)
 * para que las dos líneas se toquen y se vea de dónde sale la proyección.
 */
export function calibreDeParcela(fichas: CampoParcelaRow[], medidas: MedidaCalibre[]): CalibreDeParcela {
  const ids = new Set(fichas.map((f) => f.id));
  // Un 0 no es una medida de 0 mm: es una semana sin medir. El Excel de
  // Aerobotics escribe 0 en las celdas vacías y, si se cuela, la última medida
  // de la finca pasa a ser 0 mm (16-09-2026: 187 de 232 filas de la primera
  // carga venían así). El cargador ya no las mete; esto es el cinturón.
  const mias = medidas.filter((m) => m.parcela_id && ids.has(m.parcela_id) && m.mm > 0);
  if (mias.length === 0) {
    return { puntos: [], bloques: [], ultimaMedida: null, ultimaPrevision: null, aciertos: [] };
  }

  const porSemana = new Map<string, { medidos: number[]; previstos: number[] }>();
  for (const m of mias) {
    const p = porSemana.get(m.semana) ?? { medidos: [], previstos: [] };
    if (m.tipo === "medida") p.medidos.push(m.mm);
    else p.previstos.push(m.mm);
    porSemana.set(m.semana, p);
  }

  const media = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);
  const puntos: PuntoCalibre[] = [...porSemana.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([semana, v]) => ({ semana, medido: media(v.medidos), previsto: media(v.previstos) }));

  const medidos = puntos.filter((p) => p.medido != null);
  const ultima = medidos.at(-1) ?? null;
  // Empalme: la previsión arranca donde acaba lo medido.
  if (ultima && ultima.previsto == null) ultima.previsto = ultima.medido;

  const previstos = puntos.filter((p) => p.previsto != null && p.medido == null);

  // Lo previsto contra lo que salió: solo se puede en las semanas que ya
  // pasaron y para las que quedó guardada la previsión anterior.
  const aciertos = mias
    .filter((m) => m.tipo === "medida" && m.mm_previsto != null)
    .map((m) => ({ semana: m.semana, previsto: m.mm_previsto!, medido: m.mm, error: m.mm - m.mm_previsto! }))
    .sort((a, b) => a.semana.localeCompare(b.semana));

  return {
    puntos,
    bloques: [...new Set(mias.map((m) => m.bloque))].sort(),
    ultimaMedida: ultima ? { semana: ultima.semana, mm: ultima.medido! } : null,
    ultimaPrevision: previstos.at(-1) ? { semana: previstos.at(-1)!.semana, mm: previstos.at(-1)!.previsto! } : null,
    aciertos,
  };
}

/**
 * Las curvas (floración y ventana de recolección) que le tocan a una parcela:
 * las de su finca de Aerobotics y su variedad. Si no casa la variedad se
 * devuelven todas las de la finca, para no dejar la ficha vacía por una
 * diferencia de nombre.
 */
export function curvasDeParcela(fichas: CampoParcelaRow[], curvas: CurvaCrecimiento[]): CurvaCrecimiento[] {
  const fincas = new Set(fichas.map((f) => normalizarTexto(f.origen_finca_nombre ?? "")).filter(Boolean));
  if (fincas.size === 0) return [];
  const deLaFinca = curvas.filter((c) => fincas.has(normalizarTexto(c.finca_nombre)));
  const variedades = new Set(fichas.map((f) => normalizarTexto(f.variedad ?? "")).filter(Boolean));
  const conVariedad = deLaFinca.filter((c) => variedades.has(normalizarTexto(c.variedad)));
  return conVariedad.length > 0 ? conVariedad : deLaFinca;
}

export interface TotalesCampo {
  /** Parcelas con hectáreas de confianza. */
  conHectareas: number;
  hectareas: number;
  /** Solo las que además dan un rendimiento creíble: es la media que se puede enseñar. */
  parcelasCreibles: number;
  kgCreibles: number;
  hectareasCreibles: number;
  kgPorHaMedio: number | null;
  /** Las que dan una cifra imposible: son las primeras que revisar. */
  aRevisar: number;
}

export function totalesCampo(filas: FilaParcelaConCampo[]): TotalesCampo {
  const conHa = filas.filter((f) => f.campo.hectareas != null);
  const creibles = conHa.filter((f) => !f.campo.rendimientoIncreible);
  const kgCreibles = creibles.reduce((s, f) => s + f.kgEntrada, 0);
  const hectareasCreibles = creibles.reduce((s, f) => s + (f.campo.hectareas ?? 0), 0);
  return {
    conHectareas: conHa.length,
    hectareas: conHa.reduce((s, f) => s + (f.campo.hectareas ?? 0), 0),
    parcelasCreibles: creibles.length,
    kgCreibles,
    hectareasCreibles,
    kgPorHaMedio: hectareasCreibles > 0 ? kgCreibles / hectareasCreibles : null,
    aRevisar: conHa.length - creibles.length,
  };
}

export function totalesParcelas(filas: FilaParcela[]): TotalesParcelas {
  return {
    fincas: new Set(filas.map((f) => f.finca)).size,
    parcelas: filas.length,
    entradas: filas.reduce((s, f) => s + f.entradas, 0),
    kgEntrada: filas.reduce((s, f) => s + f.kgEntrada, 0),
    sinParcela: filas.filter((f) => f.parcela === "").length,
  };
}
