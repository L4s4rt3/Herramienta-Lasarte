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
 * UNA SOLA FUENTE. Este módulo lo leen la app (análisis por tipo de día), el
 * vigía de negocio (regla de día rojo) y los scripts de Node. Los informes en
 * Python de la encargada y el correo diario leen
 * scripts/informe-produccion/estandar.json; un test (estandarRendimiento.test.ts)
 * comprueba que el JSON y esto dicen lo mismo. Si se sube el listón, se cambia
 * en los dos sitios y el test lo vigila.
 *
 * Revisar cada 4-6 semanas: si se clava el objetivo un mes, subir suelo y
 * objetivo (nota del dueño en el JSON).
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
