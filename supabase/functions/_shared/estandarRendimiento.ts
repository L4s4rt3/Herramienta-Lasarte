/**
 * estandarRendimiento.ts — el estándar de kg/persona POR RÉGIMEN de plantilla,
 * decisión del dueño del 27-08-2026 (análisis por tipo de día).
 *
 * LA DEFINICIÓN ES DEL DUEÑO, no estadística: "reducida" es el régimen de media
 * plantilla que empezó en agosto (25-30 presentes); un día de 45 sigue siendo
 * plantilla completa PERO CON FALTAS. El corte se pone en 35 presentes (≤35 =
 * reducida), que separa limpio los dos regímenes reales (mayo-julio 45-55;
 * agosto 27-31). Con media plantilla la gente rinde MÁS por persona, así que su
 * listón es más alto.
 *
 * UNA SOLA FUENTE, y desde el 04-09-2026 es la TABLA public.estandar_rendimiento
 * (una fila; la edita el admin desde Económico → Rentabilidad → Por tipo de
 * día; las versiones anteriores quedan en estandar_rendimiento_historial con su
 * tramo de vigencia). Este módulo pone el tipo, las funciones que APLICAN el
 * estándar (régimen, calidad, tipo de día) y las que traducen fila ↔ estándar
 * (estandarDesdeFila / filaDesdeEstandar). Lo leen la app (useEstandarRendimiento
 * → análisis por tipo de día), el vigía de negocio (regla de día rojo, con la
 * fila leída en la edge) y los scripts de Node.
 *
 * ESTANDAR_RENDIMIENTO conserva los valores del 27-08 SOLO como respaldo para
 * cuando la tabla no se puede leer: quien lo use, avisa (la app por consola y
 * con un aviso en la tarjeta). scripts/informe-produccion/estandar.json es un
 * ESPEJO de la tabla para los informes en Python de la encargada y el correo
 * diario: lo regenera scripts/sincronizar-estandar.mjs, y el test
 * estandarRendimiento.test.ts vigila que siga siendo válido contra el tipo.
 *
 * Revisar cada 4-6 semanas: si se clava el objetivo un mes, subir suelo y
 * objetivo (desde la app; la nota del dueño va en la propia fila).
 */

export type RegimenPlantilla = "completa" | "reducida";

export interface ListonRegimen {
  /** Por debajo: día malo (rojo). */
  kgPersonaSuelo: number;
  /** Desde aquí: día bueno (verde). Entre suelo y objetivo: medio. */
  kgPersonaObjetivo: number;
}

export interface EstandarRendimiento {
  /** Presentes ≤ corte = plantilla reducida; por encima, completa (aunque haya faltas). */
  cortePlantillaReducida: number;
  regimenes: Record<RegimenPlantilla, ListonRegimen>;
  decididoPor: string;
  fecha: string;
  /** La explicación del dueño (por qué este listón). Vive en la fila; el respaldo no la trae. */
  nota?: string | null;
}

export const ESTANDAR_RENDIMIENTO: EstandarRendimiento = {
  cortePlantillaReducida: 35,
  regimenes: {
    completa: { kgPersonaSuelo: 1700, kgPersonaObjetivo: 2100 },
    reducida: { kgPersonaSuelo: 2200, kgPersonaObjetivo: 2600 },
  },
  decididoPor: "el dueño",
  fecha: "2026-08-27",
};

export const LABEL_REGIMEN: Record<RegimenPlantilla, string> = {
  completa: "Plantilla completa",
  reducida: "Plantilla reducida",
};

export type CalidadDia = "bueno" | "medio" | "malo";
export const CALIDADES_DIA: CalidadDia[] = ["bueno", "medio", "malo"];

/** Régimen de un día por sus presentes: ≤ corte es media plantilla. */
export function regimenPlantilla(presentes: number, est: EstandarRendimiento = ESTANDAR_RENDIMIENTO): RegimenPlantilla {
  return presentes <= est.cortePlantillaReducida ? "reducida" : "completa";
}

export function listonRegimen(regimen: RegimenPlantilla, est: EstandarRendimiento = ESTANDAR_RENDIMIENTO): ListonRegimen {
  return est.regimenes[regimen];
}

/** Bueno / medio / malo contra el listón DE SU RÉGIMEN. */
export function calidadDia(kgPersona: number, regimen: RegimenPlantilla, est: EstandarRendimiento = ESTANDAR_RENDIMIENTO): CalidadDia {
  const l = est.regimenes[regimen];
  if (kgPersona >= l.kgPersonaObjetivo) return "bueno";
  if (kgPersona >= l.kgPersonaSuelo) return "medio";
  return "malo";
}

/** "Plantilla completa · día bueno": la etiqueta con la que se agrupa. */
export function tipoDia(regimen: RegimenPlantilla, calidad: CalidadDia): string {
  return `${LABEL_REGIMEN[regimen]} · día ${calidad}`;
}

/** Los seis tipos en el orden en que se enseñan. */
export const ORDEN_TIPOS_DIA: string[] = (["completa", "reducida"] as RegimenPlantilla[])
  .flatMap((r) => CALIDADES_DIA.map((c) => tipoDia(r, c)));

// ---------------------------------------------------------------------------
// La fila de public.estandar_rendimiento (migración estandar_rendimiento,
// 04-09-2026) y su traducción al estándar y viceversa.
// ---------------------------------------------------------------------------

/**
 * La fila tal cual la devuelve PostgREST. Una sola (id = true). Los kg son
 * enteros en la base y llegan como number; aun así se coercen al leer, por si
 * otro cliente los trae como texto.
 */
export interface FilaEstandarRendimiento {
  id: boolean;
  corte_plantilla_reducida: number;
  completa_suelo: number;
  completa_objetivo: number;
  reducida_suelo: number;
  reducida_objetivo: number;
  decidido_por: string | null;
  fecha: string | null;
  nota: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** Lo que la app escribe al guardar: sin id (es fijo) ni sello (lo pone el trigger de la base). */
export type CambiosEstandarRendimiento = Omit<FilaEstandarRendimiento, "id" | "updated_at" | "updated_by">;

/** Límites del corte de plantilla (los mismos que el CHECK de la tabla): es un número de personas. */
export const LIMITES_ESTANDAR = { corteMin: 1, corteMax: 200 } as const;

const numeroO = (v: unknown, porDefecto: number): number => {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : porDefecto;
};

/**
 * Fila de la tabla → estándar. Sin fila (tabla vacía o ilegible) devuelve
 * ESTANDAR_RENDIMIENTO tal cual, el respaldo del 27-08: la app sigue funcionando
 * y quien llama decide cómo avisa. Una fila a medias (columna a null o texto
 * que no es número) toma el valor por defecto SOLO en ese campo.
 */
export function estandarDesdeFila(fila: Partial<FilaEstandarRendimiento> | null | undefined): EstandarRendimiento {
  if (!fila) return ESTANDAR_RENDIMIENTO;
  const d = ESTANDAR_RENDIMIENTO;
  return {
    cortePlantillaReducida: numeroO(fila.corte_plantilla_reducida, d.cortePlantillaReducida),
    regimenes: {
      completa: {
        kgPersonaSuelo: numeroO(fila.completa_suelo, d.regimenes.completa.kgPersonaSuelo),
        kgPersonaObjetivo: numeroO(fila.completa_objetivo, d.regimenes.completa.kgPersonaObjetivo),
      },
      reducida: {
        kgPersonaSuelo: numeroO(fila.reducida_suelo, d.regimenes.reducida.kgPersonaSuelo),
        kgPersonaObjetivo: numeroO(fila.reducida_objetivo, d.regimenes.reducida.kgPersonaObjetivo),
      },
    },
    decididoPor: fila.decidido_por ?? d.decididoPor,
    fecha: fila.fecha ?? d.fecha,
    nota: fila.nota ?? null,
  };
}

/** Estándar → columnas de la fila (lo que va en el UPDATE). Inversa exacta de estandarDesdeFila. */
export function filaDesdeEstandar(est: EstandarRendimiento): CambiosEstandarRendimiento {
  return {
    corte_plantilla_reducida: est.cortePlantillaReducida,
    completa_suelo: est.regimenes.completa.kgPersonaSuelo,
    completa_objetivo: est.regimenes.completa.kgPersonaObjetivo,
    reducida_suelo: est.regimenes.reducida.kgPersonaSuelo,
    reducida_objetivo: est.regimenes.reducida.kgPersonaObjetivo,
    decidido_por: est.decididoPor,
    fecha: est.fecha,
    nota: est.nota ?? null,
  };
}

/**
 * Problemas de un estándar antes de guardarlo (lista vacía = válido). Son las
 * mismas reglas que los CHECK de la tabla, para que el aviso salga en la app en
 * castellano y no como un error de Postgres: kg enteros y positivos, suelo por
 * debajo del objetivo en cada régimen, corte entre 1 y 200 personas, quién
 * decide y una fecha real.
 */
export function validarEstandarRendimiento(est: EstandarRendimiento): string[] {
  const problemas: string[] = [];
  const esEnteroPositivo = (n: number) => Number.isInteger(n) && n > 0;
  const corte = est.cortePlantillaReducida;
  if (!Number.isInteger(corte) || corte < LIMITES_ESTANDAR.corteMin || corte > LIMITES_ESTANDAR.corteMax) {
    problemas.push(`El corte de plantilla reducida tiene que ser un número entero de personas entre ${LIMITES_ESTANDAR.corteMin} y ${LIMITES_ESTANDAR.corteMax}.`);
  }
  for (const r of ["completa", "reducida"] as RegimenPlantilla[]) {
    const l = est.regimenes[r];
    const nombre = LABEL_REGIMEN[r].toLowerCase();
    if (!esEnteroPositivo(l.kgPersonaSuelo) || !esEnteroPositivo(l.kgPersonaObjetivo)) {
      problemas.push(`Suelo y objetivo de ${nombre} tienen que ser kg enteros mayores que 0.`);
    } else if (l.kgPersonaSuelo >= l.kgPersonaObjetivo) {
      problemas.push(`En ${nombre} el suelo (${l.kgPersonaSuelo}) tiene que ser menor que el objetivo (${l.kgPersonaObjetivo}).`);
    }
  }
  if (String(est.decididoPor ?? "").trim() === "") problemas.push("Falta quién decide el estándar.");
  const fecha = String(est.fecha ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) {
    problemas.push("La fecha de la decisión tiene que ser una fecha válida (AAAA-MM-DD).");
  }
  return problemas;
}
