// Campo → Informe técnico de finca: los números y los textos del documento.
//
// POR QUÉ EXISTE (16-09-2026). El informe de la finca Ganchal se montó a mano:
// alguien juntó las medidas de Aerobotics, las capturas de Aeroview, las
// coordenadas de los cinco puntos y escribió el texto. Vadim quiere el mismo
// documento para TODAS las fincas, eligiendo la finca y dándole a un botón,
// "sin tener que hablar con Luis o JM, o hablando lo menos posible".
//
// LA IDEA QUE MANDA AQUÍ: lo que ya está en la base NO se vuelve a teclear.
// El calibre por semana, la previsión, la curva y de dónde sale, las hectáreas
// y lo que la finca entregó en almacén salen solos. Una persona solo pone lo
// que de verdad solo ella sabe: la visita, los milímetros de cada punto y las
// capturas de Aeroview.
//
// LOS TEXTOS SE ESCRIBEN SOLOS, SIN IA. Igual que en calidad (la regla del
// dueño de septiembre): el texto se compone con los datos y siempre sale igual
// para los mismos datos. Si una persona escribe el suyo, manda el suyo — el
// generado es el suelo, no el techo.
//
// NULL ≠ 0. Una finca sin puntos de muestreo no tiene media 0: no tiene media,
// y el informe lo dice en vez de inventarla. Lo que falta se devuelve en
// `faltan` para que la pantalla lo enseñe ANTES de generar el documento.
//
// Solo funciones puras: la página pinta, el generador maqueta, esto cuenta.
import { normalizarTexto } from "@/lib/format";
import {
  calibreDeParcela, curvasDeParcela, ETIQUETA_FUENTE,
  type CalibreDeParcela, type CampoParcelaRow, type CurvaCrecimiento, type MedidaCalibre,
} from "@/lib/campoParcelas";

export const ENTIDAD = "Lasarte Cítricos S.L.";
/** Calibre que se persigue por defecto: el de Ganchal, la naranja de cítrica. */
export const OBJETIVO_MM_DEFECTO = 64;

// ─── Lo que entra ────────────────────────────────────────────────────────────

/** Fila de campo_informes. */
export interface InformeCampoRow {
  id: string;
  finca: string;
  fecha_visita: string | null;
  personal: string | null;
  apoyo_tecnico: string | null;
  semana_muestreo: string | null;
  objetivo_mm: number;
  objetivo_nota: string | null;
  horizonte_semana: string | null;
  antecedentes: string | null;
  contexto: string | null;
  conclusion: string | null;
  estado: string;
}

/** Fila de campo_informe_puntos. */
export interface PuntoMuestreo {
  id: string;
  codigo: string;
  mm: number;
  lat: number | null;
  lon: number | null;
  semana: string | null;
  nota: string | null;
  orden: number;
}

/** Fila de campo_informe_imagenes. */
export interface ImagenInforme {
  id: string;
  tipo: "estructura" | "mapa" | "modelizacion" | "punto" | "otra";
  punto_id: string | null;
  file_path: string;
  file_name: string;
  pie: string | null;
  orden: number;
}

/** Lo que el informe necesita de una entrada de báscula para contar el historial. */
export interface EntradaFincaInput {
  finca: string | null;
  lote: string;
  fecha: string;
  articulo: string | null;
  kg_entrada: number | null;
}

/** Una fila de clasificacion_lote, ya agregada por lote y grupo. */
export interface ClasifFincaInput {
  lote_codigo_base: string | null;
  grupo_destino: string | null;
  clase: string | null;
  producto: string | null;
  peso_kg: number | null;
}

// ─── Semanas ISO ─────────────────────────────────────────────────────────────
// Aerobotics escribe "2026W36" y el resto del proyecto "2026-W36". Aquí se
// aceptan las dos y se enseña siempre "Semana 36 (2026)", que es como lo dice
// el informe de Ganchal y como lo dice la gente.

/** "2026W36" o "2026-W36" → { anio: 2026, semana: 36 }. null si no es una semana. */
export function partirSemana(semana: string | null | undefined): { anio: number; semana: number } | null {
  const m = /^(\d{4})-?W(\d{1,2})$/.exec(String(semana ?? "").trim());
  if (!m) return null;
  const n = Number(m[2]);
  return n >= 1 && n <= 53 ? { anio: Number(m[1]), semana: n } : null;
}

/** "2026W36" → "Semana 36". Lo que se lee en el documento. */
export function etiquetaSemana(semana: string | null | undefined): string {
  const p = partirSemana(semana);
  return p ? `Semana ${p.semana}` : "—";
}

/** Para ordenar y comparar semanas de distintos años: 2026W36 → 202636. */
export function ordinalSemana(semana: string | null | undefined): number | null {
  const p = partirSemana(semana);
  return p ? p.anio * 100 + p.semana : null;
}

// ─── Calibre: cuándo se llega al objetivo ────────────────────────────────────

export interface SemanaObjetivo {
  semana: string;
  mm: number;
  /** "medida" = ya se ha alcanzado de verdad; "prevision" = lo dice el modelo. */
  tipo: "medida" | "prevision";
}

/**
 * La primera semana en la que el calibre alcanza el objetivo.
 *
 * Se mira primero lo medido (si ya se alcanzó, no hay nada que prever) y
 * después lo previsto. Devuelve null cuando ni la previsión llega al objetivo:
 * eso también es una respuesta, y el informe la dice tal cual en vez de
 * estirar la curva.
 */
export function semanaQueAlcanzaObjetivo(calibre: CalibreDeParcela, objetivoMm: number): SemanaObjetivo | null {
  const medida = calibre.puntos.find((p) => p.medido != null && p.medido >= objetivoMm);
  if (medida) return { semana: medida.semana, mm: medida.medido!, tipo: "medida" };
  const prevista = calibre.puntos.find((p) => p.medido == null && p.previsto != null && p.previsto >= objetivoMm);
  return prevista ? { semana: prevista.semana, mm: prevista.previsto!, tipo: "prevision" } : null;
}

// ─── Los puntos de muestreo ──────────────────────────────────────────────────

export interface ResumenPuntos {
  puntos: PuntoMuestreo[];
  /** Media aritmética simple, como la del informe de Ganchal. null sin puntos. */
  media: number | null;
  minimo: number | null;
  maximo: number | null;
  /** Media menos objetivo: negativo = todavía falta calibre. */
  difObjetivo: number | null;
  /** Cuántos puntos ya superan el objetivo. */
  porEncima: number;
  /** Semana del muestreo: la del informe, o la que traigan los puntos. */
  semana: string | null;
}

export function resumirPuntos(puntos: PuntoMuestreo[], objetivoMm: number, semanaInforme: string | null): ResumenPuntos {
  const ordenados = [...puntos].sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
  const mm = ordenados.map((p) => p.mm).filter((v) => Number.isFinite(v));
  if (mm.length === 0) {
    return { puntos: ordenados, media: null, minimo: null, maximo: null, difObjetivo: null, porEncima: 0, semana: semanaInforme };
  }
  const media = mm.reduce((s, v) => s + v, 0) / mm.length;
  const semanaPuntos = ordenados.find((p) => partirSemana(p.semana))?.semana ?? null;
  return {
    puntos: ordenados,
    media,
    minimo: Math.min(...mm),
    maximo: Math.max(...mm),
    difObjetivo: media - objetivoMm,
    porEncima: mm.filter((v) => v >= objetivoMm).length,
    semana: semanaInforme ?? semanaPuntos,
  };
}

// ─── Lo que ha dado la finca (la sección nueva) ──────────────────────────────

export interface CampanaFinca {
  /** "2025/26". */
  campana: string;
  kgEntrada: number;
  entradas: number;
  variedades: string[];
  primera: string | null;
  ultima: string | null;
}

/**
 * El destino de la fruta, en DOS lecturas que no se pueden mezclar.
 *
 * Son dos maneras distintas de mirar los mismos kilos, y cada una suma el total
 * por su cuenta:
 *   · CÓMO LA CLASIFICÓ LA MÁQUINA (exportación / no exportación / repaso de
 *     mesa / no comercial). Habla de la calidad de la fruta.
 *   · DÓNDE ACABÓ (Mercadona / otros clientes / industria / podrido /
 *     precalibrado). Habla de la venta.
 * Sumarlas juntas da más del 100 %: una naranja de clase Extra que se apiló en
 * el box de industria está en "exportación" y en "industria" a la vez. Por eso
 * el informe las enseña en dos tablas separadas y lo dice.
 */
export interface DestinoFinca {
  kgCalibrados: number;
  /** Lectura 1 — la clasificación del calibrador. Suma kgCalibrados. */
  exportacion: number;
  noExportacion: number;
  mujeres: number;
  noComercial: number;
  /** Lectura 2 — el producto con el que se confeccionó. Suma kgCalibrados. */
  mercadona: number;
  otrosClientes: number;
  industria: number;
  podrido: number;
  precalibrado: number;
}

export interface HistorialFinca {
  campanas: CampanaFinca[];
  kgTotal: number;
  /** Destinos de TODA la historia conocida de la finca. null si ningún lote pasó por el calibrador. */
  destino: DestinoFinca | null;
  /** Lotes distintos que ha entregado la finca. */
  lotesTotal: number;
  /** De esos, los que no tienen clasificación del calibrador. */
  lotesSinCalibrador: number;
}

export type DestinoComercial = "mercadona" | "otros" | "industria" | "podrido" | "precalibrado";

/**
 * Dónde acabó una fila del calibrador, por el producto con el que se confeccionó.
 *
 * Misma convención que rentabilidadDia.ts: la clase Podrido MANDA sobre el
 * producto, porque un kilo podrido es podrido aunque viaje en el box de
 * industria — y por eso no se cobra a precio de industria.
 */
export function destinoComercial(c: ClasifFincaInput): DestinoComercial {
  if ((c.clase ?? "").trim().toLowerCase() === "podrido") return "podrido";
  const p = (c.producto ?? "").trim().toUpperCase();
  if (p.startsWith("MDNA")) return "mercadona";
  if (p.includes("INDUSTRIA")) return "industria";
  if (p.startsWith("PREC")) return "precalibrado";
  return "otros";
}

/** Campaña citrícola de una fecha: de septiembre a agosto. "2026-02-20" → "2025/26". */
export function campanaDe(fecha: string): string {
  const [anio, mes] = fecha.split("-").map(Number);
  const inicio = mes >= 9 ? anio : anio - 1;
  return `${inicio}/${String(inicio + 1).slice(2)}`;
}

/**
 * Lo que la finca ha entregado y en qué acabó.
 *
 * Los kilos son los de BÁSCULA (lo que entró) y los destinos, los del
 * calibrador (lo que salió). Son dos pesos distintos a propósito: el calibrador
 * pesa ~8 % más porque arrastra la tara del box, así que los destinos se dan en
 * porcentaje sobre lo calibrado y JAMÁS sobre los kilos de entrada.
 */
export function historialFinca(entradas: EntradaFincaInput[], clasif: ClasifFincaInput[]): HistorialFinca {
  interface AcumuladoCampana { kg: number; entradas: number; variedades: Map<string, number>; fechas: string[] }
  const porCampana = new Map<string, AcumuladoCampana>();
  const lotes = new Set<string>();
  for (const e of entradas) {
    if (!e.fecha) continue;
    lotes.add(e.lote);
    const campana = campanaDe(e.fecha);
    const c: AcumuladoCampana = porCampana.get(campana) ?? { kg: 0, entradas: 0, variedades: new Map<string, number>(), fechas: [] };
    c.kg += e.kg_entrada ?? 0;
    c.entradas += 1;
    c.fechas.push(e.fecha);
    const art = (e.articulo ?? "").trim();
    if (art) c.variedades.set(art, (c.variedades.get(art) ?? 0) + (e.kg_entrada ?? 0));
    porCampana.set(campana, c);
  }

  const campanas: CampanaFinca[] = [...porCampana.entries()]
    .map(([campana, c]) => ({
      campana,
      kgEntrada: c.kg,
      entradas: c.entradas,
      variedades: [...c.variedades.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v),
      primera: c.fechas.sort()[0] ?? null,
      ultima: c.fechas.sort().at(-1) ?? null,
    }))
    .sort((a, b) => b.campana.localeCompare(a.campana));

  const mias = clasif.filter((c) => c.lote_codigo_base && lotes.has(c.lote_codigo_base));
  const lotesConCalibrador = new Set(mias.map((c) => c.lote_codigo_base!));
  let destino: DestinoFinca | null = null;
  if (mias.length > 0) {
    const suma = (pred: (c: ClasifFincaInput) => boolean) =>
      mias.filter(pred).reduce((s, c) => s + (c.peso_kg ?? 0), 0);
    destino = {
      kgCalibrados: mias.reduce((s, c) => s + (c.peso_kg ?? 0), 0),
      exportacion: suma((c) => c.grupo_destino === "EXPORTACION"),
      noExportacion: suma((c) => c.grupo_destino === "NO EXPORTACION"),
      mujeres: suma((c) => c.grupo_destino === "MUJERES"),
      noComercial: suma((c) => c.grupo_destino === "NO COMERCIAL"),
      mercadona: suma((c) => destinoComercial(c) === "mercadona"),
      otrosClientes: suma((c) => destinoComercial(c) === "otros"),
      industria: suma((c) => destinoComercial(c) === "industria"),
      podrido: suma((c) => destinoComercial(c) === "podrido"),
      precalibrado: suma((c) => destinoComercial(c) === "precalibrado"),
    };
  }

  return {
    campanas,
    kgTotal: campanas.reduce((s, c) => s + c.kgEntrada, 0),
    destino,
    lotesTotal: lotes.size,
    lotesSinCalibrador: [...lotes].filter((l) => !lotesConCalibrador.has(l)).length,
  };
}

// ─── El informe entero ───────────────────────────────────────────────────────

export interface FichaFincaInforme {
  finca: string;
  hectareas: number | null;
  parcelas: number;
  variedades: string[];
  /** Nombre con el que Aerobotics conoce la finca, si se ha casado. */
  fincaAerobotics: string | null;
}

export interface InformeCampo {
  ficha: FichaFincaInforme;
  entidad: string;
  fechaVisita: string | null;
  personal: string | null;
  apoyoTecnico: string;
  objetivoMm: number;
  objetivoNota: string | null;
  puntos: ResumenPuntos;
  calibre: CalibreDeParcela;
  /** Última medida de Aerobotics para esta finca. */
  ultimaMedida: { semana: string; mm: number } | null;
  objetivo: SemanaObjetivo | null;
  /** Semana desde la que se valora, tecleada o calculada. */
  horizonte: string | null;
  curvas: CurvaCrecimiento[];
  /** Aviso cuando la curva no es de esta finca sino la media de la comarca. */
  avisoCurva: string | null;
  historial: HistorialFinca;
  imagenes: ImagenInforme[];
  textos: { antecedentes: string; contexto: string; criterio: string; conclusion: string };
  /** Lo que no se ha podido rellenar, en cristiano, para enseñarlo antes de generar. */
  faltan: string[];
}

export interface EntradaInformeCampo {
  informe: InformeCampoRow;
  parcelas: CampoParcelaRow[];
  medidas: MedidaCalibre[];
  curvas: CurvaCrecimiento[];
  puntos: PuntoMuestreo[];
  imagenes: ImagenInforme[];
  entradas: EntradaFincaInput[];
  clasif: ClasifFincaInput[];
}

const mm1 = (v: number) => `${v.toFixed(1).replace(".", ",")} mm`;
const pct = (parte: number, total: number) => (total > 0 ? `${((100 * parte) / total).toFixed(1).replace(".", ",")} %` : "—");
const kg0 = (v: number) => `${Math.round(v).toLocaleString("es-ES")} kg`;

/** Las parcelas de esta finca, mirando el nombre de la báscula y el de Aerobotics. */
export function parcelasDeFinca(parcelas: CampoParcelaRow[], finca: string): CampoParcelaRow[] {
  const buscada = normalizarTexto(finca);
  if (!buscada) return [];
  return parcelas.filter((p) =>
    normalizarTexto(p.finca ?? "") === buscada ||
    normalizarTexto(p.origen_finca_nombre ?? "") === buscada ||
    normalizarTexto(p.nombre ?? "").startsWith(buscada));
}

/**
 * Arma el informe: junta lo que hay en la base con lo que puso la persona y
 * escribe los textos que nadie ha escrito.
 */
export function armarInformeCampo(e: EntradaInformeCampo): InformeCampo {
  const { informe } = e;
  const objetivoMm = Number(informe.objetivo_mm) || OBJETIVO_MM_DEFECTO;
  const parcelas = parcelasDeFinca(e.parcelas, informe.finca);
  const calibre = calibreDeParcela(parcelas, e.medidas);
  const curvas = curvasDeParcela(parcelas, e.curvas);
  const puntos = resumirPuntos(e.puntos, objetivoMm, informe.semana_muestreo);
  const historial = historialFinca(e.entradas, e.clasif);
  const objetivo = semanaQueAlcanzaObjetivo(calibre, objetivoMm);

  const hectareas = parcelas.reduce((s, p) => s + (p.hectareas ?? 0), 0);
  const ficha: FichaFincaInforme = {
    finca: informe.finca,
    hectareas: hectareas > 0 ? hectareas : null,
    parcelas: parcelas.length,
    variedades: [...new Set(parcelas.map((p) => (p.variedad ?? "").trim()).filter(Boolean))].sort(),
    fincaAerobotics: parcelas.find((p) => p.origen_finca_nombre)?.origen_finca_nombre ?? null,
  };

  const curvaComarca = curvas.find((c) => c.fuente === "region_cultivar_default");
  const avisoCurva = curvaComarca
    ? `La curva de crecimiento que usa Aerobotics para ${curvaComarca.variedad} en esta finca es la ${ETIQUETA_FUENTE.region_cultivar_default}: la previsión no está hecha con fruta de aquí y debe tomarse como orientación.`
    : null;

  const faltan: string[] = [];
  if (puntos.puntos.length === 0) faltan.push("No hay puntos de muestreo: el informe sale sin la tabla de puntos ni fichas fotográficas (el mapa de la parcela sí se puede dibujar).");
  if (calibre.puntos.length === 0) faltan.push("Aerobotics no tiene medidas de calibre casadas con esta finca: falta la evolución y la previsión.");
  if (!e.imagenes.some((i) => i.tipo === "estructura")) faltan.push("Falta la captura de la estructura de tamaño de Aeroview (Figura 1).");
  if (!e.imagenes.some((i) => i.tipo === "mapa")) {
    // Si hay geografía, el mapa no hay que ir a buscarlo: lo dibuja la
    // herramienta con el contorno, los puntos y la ortofoto del IGN.
    const hayContorno = parcelas.some((p) => (p.contorno ?? []).length > 0);
    const hayCoordenadas = e.puntos.some((p) => p.lat != null && p.lon != null);
    faltan.push(hayContorno || hayCoordenadas
      ? "Falta el mapa: se dibuja con el botón «Dibujar el mapa» (o sube tu captura de Aeroview)."
      : "Falta el mapa con los puntos, y no hay contorno ni coordenadas con los que dibujarlo.");
  }
  if (!e.imagenes.some((i) => i.tipo === "modelizacion")) faltan.push("Falta la captura de la modelización de evolución (Figura 3).");
  if (!informe.fecha_visita) faltan.push("Sin fecha de visita: el informe saldrá como seguimiento, no como visita.");
  if (!informe.personal) faltan.push("Sin personal de campo: no se dirá quién fue.");
  if (parcelas.length === 0) faltan.push("Esta finca no tiene parcelas dibujadas en Campo → Parcelas: no hay hectáreas ni mapa propio.");

  const horizonte = informe.horizonte_semana ?? (objetivo?.tipo === "prevision" ? objetivo.semana : null);

  return {
    ficha,
    entidad: ENTIDAD,
    fechaVisita: informe.fecha_visita,
    personal: informe.personal,
    apoyoTecnico: informe.apoyo_tecnico ?? "Aerobotics",
    objetivoMm,
    objetivoNota: informe.objetivo_nota,
    puntos,
    calibre,
    ultimaMedida: calibre.ultimaMedida,
    objetivo,
    horizonte,
    curvas,
    avisoCurva,
    historial,
    imagenes: [...e.imagenes].sort((a, b) => a.orden - b.orden),
    textos: {
      antecedentes: informe.antecedentes?.trim() || textoAntecedentes(ficha, historial),
      contexto: informe.contexto?.trim() || textoContexto(informe, puntos),
      criterio: textoCriterio(objetivoMm, informe.objetivo_nota, objetivo, horizonte, avisoCurva),
      conclusion: informe.conclusion?.trim() || textoConclusion(ficha, puntos, calibre, objetivoMm, objetivo),
    },
    faltan,
  };
}

// ─── Los textos, escritos con los datos ──────────────────────────────────────

/** Antecedentes: lo que esta finca ha dado hasta hoy, contado con sus números. */
export function textoAntecedentes(ficha: FichaFincaInforme, h: HistorialFinca): string {
  if (h.campanas.length === 0) {
    return `No constan entregas anteriores de la finca ${ficha.finca} en los registros de la herramienta, por lo que este informe es el primer seguimiento documentado de su fruta.`;
  }
  const partes: string[] = [];
  partes.push(
    h.campanas.length === 1
      ? `La finca ${ficha.finca} ha entregado ${kg0(h.kgTotal)} en la campaña ${h.campanas[0].campana}.`
      : `La finca ${ficha.finca} ha entregado ${kg0(h.kgTotal)} en ${h.campanas.length} campañas: ` +
        `${h.campanas.map((c) => `${c.campana} (${kg0(c.kgEntrada)})`).join(", ")}.`,
  );
  const variedades = [...new Set(h.campanas.flatMap((c) => c.variedades))];
  if (variedades.length > 0) partes.push(`La fruta registrada corresponde a ${variedades.slice(0, 3).join(", ")}.`);

  const d = h.destino;
  if (d && d.kgCalibrados > 0) {
    // Dos frases, una por lectura: la clasificación habla de la calidad y el
    // producto de la venta. Juntas en la misma frase sumarían más del 100 %.
    partes.push(
      `De los ${kg0(d.kgCalibrados)} que pasaron por el calibrador, el ${pct(d.exportacion, d.kgCalibrados)} se clasificó como exportación ` +
      `y el ${pct(d.noComercial, d.kgCalibrados)} como no comercial.`,
    );
    partes.push(
      `Por destino de venta, el ${pct(d.mercadona, d.kgCalibrados)} se confeccionó para Mercadona, el ${pct(d.otrosClientes, d.kgCalibrados)} para otros clientes ` +
      `y el ${pct(d.industria, d.kgCalibrados)} se fue a industria.`,
    );
    if ((100 * d.industria) / d.kgCalibrados >= 10) {
      partes.push(`El peso de la industria en esa fruta justifica revisar la evolución del calibre y volver a valorar su potencial comercial.`);
    }
  } else {
    partes.push(`No hay clasificación del calibrador asociada a esos lotes, así que no puede detallarse el destino de la fruta.`);
  }
  if (h.lotesSinCalibrador > 0) {
    partes.push(
      `${h.lotesSinCalibrador} de los ${h.lotesTotal} lotes de la finca no tienen clasificación del calibrador, así que lo anterior no cubre toda la fruta entregada.`,
    );
  }
  if (ficha.hectareas) partes.push(`La finca tiene ${ficha.hectareas.toFixed(1).replace(".", ",")} ha dibujadas en ${ficha.parcelas} ${ficha.parcelas === 1 ? "parcela" : "parcelas"}.`);
  return partes.join(" ");
}

/** Objeto y contexto: qué se hizo, quién y cuándo. */
export function textoContexto(informe: InformeCampoRow, puntos: ResumenPuntos): string {
  const quien = informe.personal?.trim();
  const cuando = informe.fecha_visita;
  const n = puntos.puntos.length;
  if (!cuando) {
    return `Este informe recoge el seguimiento de calibre de la finca ${informe.finca} con los datos disponibles${n > 0 ? ` y ${n} ${n === 1 ? "punto" : "puntos"} de muestreo` : ""}, sin visita presencial asociada.`;
  }
  const fecha = formatFechaLarga(cuando);
  const sujeto = quien ? `${quien} se desplazaron` : "El equipo de campo se desplazó";
  return (
    `${sujeto} el ${fecha} a la finca ${informe.finca} para comprobar directamente la situación de la fruta. ` +
    (n > 0
      ? `Durante la visita se seleccionaron ${n} ${n === 1 ? "punto" : "puntos"} de muestreo distribuidos por la finca, registrando en cada uno la referencia de calibre y su posición geográfica. `
      : "") +
    `La visita permite contrastar sobre el terreno la evolución del calibre y vincular la observación presencial con los datos obtenidos mediante ${informe.apoyo_tecnico ?? "Aerobotics"}.`
  );
}

/** El recuadro de criterio de seguimiento. */
export function textoCriterio(
  objetivoMm: number,
  objetivoNota: string | null,
  objetivo: SemanaObjetivo | null,
  horizonte: string | null,
  avisoCurva: string | null,
): string {
  const ref = `La referencia operativa de este informe es ${objetivoMm} mm${objetivoNota ? ` (${objetivoNota})` : ""}.`;
  if (objetivo?.tipo === "medida") {
    return `${ref} El calibre medido ya supera esa referencia desde la ${etiquetaSemana(objetivo.semana).toLowerCase()} (${mm1(objetivo.mm)}).`;
  }
  if (objetivo?.tipo === "prevision") {
    return (
      `${ref} Según la evolución de Aerobotics, a partir de la ${etiquetaSemana(objetivo.semana).toLowerCase()} la fruta superaría ese calibre (${mm1(objetivo.mm)} previstos). ` +
      `La estimación numérica se considera pendiente de validación durante la campaña.` + (avisoCurva ? ` ${avisoCurva}` : "")
    );
  }
  if (horizonte) {
    return `${ref} La valoración se hace a partir de la ${etiquetaSemana(horizonte).toLowerCase()}.`;
  }
  return `${ref} Con los datos disponibles, la previsión no alcanza esa referencia dentro del horizonte que cubre Aerobotics; habrá que seguir midiendo.`;
}

/** Conclusión: lo que hay, lo que se espera y con qué confianza. */
export function textoConclusion(
  ficha: FichaFincaInforme,
  puntos: ResumenPuntos,
  calibre: CalibreDeParcela,
  objetivoMm: number,
  objetivo: SemanaObjetivo | null,
): string {
  const partes: string[] = [];

  if (puntos.media != null && puntos.minimo != null && puntos.maximo != null) {
    partes.push(
      `En ${etiquetaSemana(puntos.semana).toLowerCase()}, los ${puntos.puntos.length} puntos muestreados en ${ficha.finca} presentan calibres entre ${mm1(puntos.minimo)} y ${mm1(puntos.maximo)}, ` +
      `con una media simple de ${mm1(puntos.media)}.`,
    );
    partes.push(
      puntos.difObjetivo != null && puntos.difObjetivo >= 0
        ? `La media supera ya el objetivo de ${objetivoMm} mm en ${mm1(Math.abs(puntos.difObjetivo))}.`
        : `El objetivo de ${objetivoMm} mm todavía no se alcanza de forma generalizada: faltan ${mm1(Math.abs(puntos.difObjetivo ?? 0))} de media${puntos.porEncima > 0 ? `, aunque ${puntos.porEncima} de los ${puntos.puntos.length} puntos ya lo superan` : ""}.`,
    );
  } else if (calibre.ultimaMedida) {
    partes.push(
      `No se registraron puntos de muestreo en esta visita. La última medida de Aerobotics para ${ficha.finca} es de ${mm1(calibre.ultimaMedida.mm)} en ${etiquetaSemana(calibre.ultimaMedida.semana).toLowerCase()}.`,
    );
  } else {
    partes.push(`No hay medidas de calibre disponibles para ${ficha.finca}, ni de muestreo ni de Aerobotics.`);
  }

  if (calibre.ultimaMedida && puntos.media != null) {
    const dif = puntos.media - calibre.ultimaMedida.mm;
    partes.push(
      Math.abs(dif) <= 1.5
        ? `El panel de Aerobotics da ${mm1(calibre.ultimaMedida.mm)} en ${etiquetaSemana(calibre.ultimaMedida.semana).toLowerCase()}, en línea con el muestreo de campo.`
        : `El panel de Aerobotics da ${mm1(calibre.ultimaMedida.mm)} en ${etiquetaSemana(calibre.ultimaMedida.semana).toLowerCase()}, ${mm1(Math.abs(dif))} ${dif > 0 ? "por debajo" : "por encima"} del muestreo de campo: conviene comprobar a qué se debe la diferencia.`,
    );
  }

  if (objetivo?.tipo === "prevision") {
    partes.push(
      `La previsión operativa es que, a partir de la ${etiquetaSemana(objetivo.semana).toLowerCase()}, la mayoría de la fruta supere los ${objetivoMm} mm. ` +
      `El valor numérico exacto del modelo de Aerobotics no se considera todavía una previsión verificada y deberá contrastarse durante esta campaña con las mediciones reales.`,
    );
  } else if (objetivo?.tipo === "medida") {
    partes.push(`El objetivo de ${objetivoMm} mm ya se ha alcanzado en las mediciones, de modo que la decisión pasa a ser comercial y no de calibre.`);
  }

  if (calibre.aciertos.length > 0) {
    const errorMedio = calibre.aciertos.reduce((s, a) => s + Math.abs(a.error), 0) / calibre.aciertos.length;
    partes.push(
      `Hay ${calibre.aciertos.length} ${calibre.aciertos.length === 1 ? "semana" : "semanas"} en las que ya puede compararse lo previsto con lo medido: la desviación media es de ${mm1(errorMedio)}.`,
    );
  }

  partes.push(
    `La conclusión debe entenderse como una valoración técnica de seguimiento, basada en la observación de campo y en la evolución disponible.`,
  );
  return partes.join(" ");
}

/** "2026-09-04" → "viernes, 4 de septiembre de 2026". */
export function formatFechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(d.getTime())) return fecha;
  const txt = d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
